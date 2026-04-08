"""
import_geonames_peaks.py
────────────────────────
Filter mountains / peaks from the GeoNames allCountries dump and store them
in a local SQLite database table ready for offline use as a replacement for
the Overpass API (which frequently returns 504 Gateway Timeout errors).

Source file
-----------
Download allCountries.zip (~350 MB) from:
    https://download.geonames.org/export/dump/allCountries.zip

The zip contains a single tab-separated text file (allCountries.txt, ~1.7 GB
uncompressed, ~12 M rows) with this column layout:

  0  geonameid        unique integer
  1  name             UTF-8 primary name
  2  asciiname        ASCII transliteration
  3  alternatenames   comma-separated
  4  latitude         decimal degrees
  5  longitude        decimal degrees
  6  feature_class    category letter  (T = mountain/hill/rock …)
  7  feature_code     sub-type code    (MT, PK, MTS, PKS, …)
  8  country_code     ISO 3166-1 alpha-2
  9  cc2              additional country codes
 10  admin1_code
 11  admin2_code
 12  admin3_code
 13  admin4_code
 14  population
 15  elevation        integer metres; empty or -9999 = no data
 16  dem              SRTM/ASTER DEM fallback; same no-data convention
 17  timezone
 18  modification_date

Filtering criteria (all three must be satisfied)
-------------------------------------------------
1. feature_class == 'T'  AND  feature_code in the accepted set
2. name is non-empty
3. A usable elevation exists:  elevation (col 15) ≥ min_elev  OR  dem (col 16) ≥ min_elev
   (GeoNames marks missing elevation as empty string, '0', or '-9999')

Default accepted feature codes
-------------------------------
MT   mountain
PK   peak
MTS  mountains (range centroid — useful for named massifs)
PKS  peaks
MTRT mountain ridge / range
HLL  hill
HLLS hills
RDGE ridge

SQLite schema (table: geonames_peaks)
--------------------------------------
  geonameid    INTEGER  PRIMARY KEY
  name         TEXT     NOT NULL
  asciiname    TEXT
  latitude     REAL     NOT NULL
  longitude    REAL     NOT NULL
  elevation_m  INTEGER  NOT NULL   -- best available (elevation col, then DEM)
  elev_source  TEXT     NOT NULL   -- 'elevation' or 'dem'
  feature_code TEXT     NOT NULL
  country_code TEXT
  admin1_code  TEXT
  timezone     TEXT

Indexes on (latitude, longitude) and (elevation_m DESC) are created
automatically.

Usage
-----
    # defaults: looks for allCountries.zip next to the script
    python scripts/import_geonames_peaks.py

    # explicit paths
    python scripts/import_geonames_peaks.py \\
        --input  C:/Downloads/allCountries.zip \\
        --db     scripts/cache/geonames_peaks.db

    # only include true summits (PK / MT) above 500 m
    python scripts/import_geonames_peaks.py \\
        --codes  MT,PK \\
        --min-elev 500

    # rebuild from scratch
    python scripts/import_geonames_peaks.py --drop

Required Python packages
------------------------
    pip install tqdm          # progress bar (already used by compute_horizon.py)
    # everything else is stdlib
"""

import argparse
import csv
import io
import os
import sqlite3
import sys
import zipfile
from pathlib import Path

try:
    from tqdm import tqdm
    _HAS_TQDM = True
except ImportError:
    _HAS_TQDM = False

# ── Defaults ──────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
DEFAULT_ZIP  = SCRIPT_DIR / "allCountries.zip"
DEFAULT_DB   = SCRIPT_DIR / "cache" / "geonames_peaks.db"

# GeoNames feature codes to keep (all belong to feature_class 'T')
DEFAULT_CODES = {"MT", "PK", "MTS", "PKS", "MTRT", "HLL", "HLLS", "RDGE"}

# Elevation sentinel values that mean "no data" in GeoNames
_NO_DATA = {-9999, 0}          # 0 is ambiguous but usually means absent
_NO_DATA_STRICT_BELOW = -500   # anything below −500 m is certainly no-data noise

TABLE_DDL = """
CREATE TABLE IF NOT EXISTS geonames_peaks (
    geonameid    INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    asciiname    TEXT,
    latitude     REAL    NOT NULL,
    longitude    REAL    NOT NULL,
    elevation_m  INTEGER NOT NULL,
    elev_source  TEXT    NOT NULL,
    feature_code TEXT    NOT NULL,
    country_code TEXT,
    admin1_code  TEXT,
    timezone     TEXT
);
"""

INDEX_DDL = [
    "CREATE INDEX IF NOT EXISTS idx_gnp_latlon ON geonames_peaks (latitude, longitude);",
    "CREATE INDEX IF NOT EXISTS idx_gnp_elev   ON geonames_peaks (elevation_m DESC);",
    "CREATE INDEX IF NOT EXISTS idx_gnp_fcode  ON geonames_peaks (feature_code);",
    "CREATE INDEX IF NOT EXISTS idx_gnp_cc     ON geonames_peaks (country_code);",
]

INSERT_SQL = """
INSERT OR REPLACE INTO geonames_peaks
    (geonameid, name, asciiname, latitude, longitude,
     elevation_m, elev_source, feature_code, country_code, admin1_code, timezone)
VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""

BATCH_SIZE = 10_000


# ═══════════════════════════════════════════════════════════════════════════════
# Elevation helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_elev(raw: str) -> int | None:
    """
    Parse a GeoNames elevation field (string) to an integer or None.

    Returns None for:
      - empty string
      - non-numeric value
      - sentinel −9999
      - values below −500 m (almost certainly data noise)
    """
    raw = raw.strip()
    if not raw:
        return None
    try:
        v = int(raw)
    except ValueError:
        return None
    if v <= _NO_DATA_STRICT_BELOW:
        return None
    return v


def _best_elevation(elev_raw: str, dem_raw: str, min_elev: int) -> tuple[int, str] | None:
    """
    Return (elevation_m, source) using the priority chain:
      1. elevation column (col 15)
      2. dem column (col 16)
    Returns None if no usable value is found or if value < min_elev.
    """
    e = _parse_elev(elev_raw)
    if e is not None and e not in _NO_DATA and e >= min_elev:
        return e, "elevation"

    d = _parse_elev(dem_raw)
    if d is not None and d not in _NO_DATA and d >= min_elev:
        return d, "dem"

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# Database setup
# ═══════════════════════════════════════════════════════════════════════════════

def setup_db(db_path: Path, drop: bool) -> sqlite3.Connection:
    """Open (or create) the SQLite file and ensure the schema exists."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA cache_size=-65536;")   # ~64 MB page cache

    if drop:
        print("  Dropping existing geonames_peaks table …")
        conn.execute("DROP TABLE IF EXISTS geonames_peaks;")
        conn.commit()

    conn.execute(TABLE_DDL)
    for idx in INDEX_DDL:
        conn.execute(idx)
    conn.commit()
    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# Input stream — zip or plain text
# ═══════════════════════════════════════════════════════════════════════════════

def _open_input(input_path: Path):
    """
    Return a text iterator over the GeoNames data lines.

    Supports:
      - .zip  — reads the first .txt member in-stream (no full extraction)
      - .txt  — opens directly
    """
    suffix = input_path.suffix.lower()
    if suffix == ".zip":
        zf = zipfile.ZipFile(str(input_path), "r")
        # Find the allCountries.txt member (may be the only member)
        members = [m for m in zf.namelist() if m.endswith(".txt")]
        if not members:
            zf.close()
            raise FileNotFoundError(
                f"No .txt file found inside {input_path}. "
                "Expected allCountries.txt."
            )
        member = members[0]
        print(f"  Reading '{member}' from {input_path.name} …")
        raw_stream = zf.open(member)
        text_stream = io.TextIOWrapper(raw_stream, encoding="utf-8", errors="replace")
        return text_stream, zf          # caller must close zf
    elif suffix in (".txt", ".tsv", ""):
        print(f"  Reading {input_path.name} …")
        return open(str(input_path), encoding="utf-8", errors="replace"), None
    else:
        raise ValueError(f"Unsupported input file type: {input_path.suffix}")


# ═══════════════════════════════════════════════════════════════════════════════
# Main import loop
# ═══════════════════════════════════════════════════════════════════════════════

def import_peaks(input_path: Path,
                 db_path: Path,
                 codes: set,
                 min_elev: int,
                 drop: bool) -> None:
    """
    Stream through the GeoNames file, filter, and insert into SQLite.
    """
    if not input_path.exists():
        print(f"✗  Input file not found: {input_path}", file=sys.stderr)
        print("   Download from: https://download.geonames.org/export/dump/allCountries.zip",
              file=sys.stderr)
        sys.exit(1)

    print(f"\nGeoNames peak importer")
    print(f"  Input  : {input_path}  ({input_path.stat().st_size / 1_048_576:.0f} MB)")
    print(f"  Output : {db_path}")
    print(f"  Codes  : {', '.join(sorted(codes))}")
    print(f"  Min elev: {min_elev} m")
    print()

    conn = setup_db(db_path, drop)

    text_stream, zf = _open_input(input_path)

    # Estimate total rows for tqdm (rough: ~145 bytes/row in the zip)
    zip_size    = input_path.stat().st_size
    est_rows    = int(zip_size / 150) if input_path.suffix.lower() == ".zip" else None

    reader = csv.reader(text_stream, delimiter="\t", quoting=csv.QUOTE_NONE)

    # Counters
    n_scanned   = 0
    n_matched   = 0
    n_skipped_code  = 0
    n_skipped_name  = 0
    n_skipped_elev  = 0
    code_counts: dict = {}

    batch: list = []

    def _flush(batch, conn):
        conn.executemany(INSERT_SQL, batch)
        conn.commit()
        batch.clear()

    # ── Progress wrapper ─────────────────────────────────────────────────────
    if _HAS_TQDM:
        rows_iter = tqdm(reader, desc="  Scanning", unit=" rows",
                         total=est_rows, ncols=80, unit_scale=True)
    else:
        rows_iter = reader

    for row in rows_iter:
        n_scanned += 1

        # Guard against malformed lines
        if len(row) < 17:
            continue

        feature_class = row[6]
        feature_code  = row[7]

        # ── Filter 1: feature type ────────────────────────────────────────
        if feature_class != "T" or feature_code not in codes:
            n_skipped_code += 1
            continue

        # ── Filter 2: name ────────────────────────────────────────────────
        name = row[1].strip()
        if not name:
            n_skipped_name += 1
            continue

        # ── Filter 3: elevation ───────────────────────────────────────────
        elev_result = _best_elevation(
            row[15] if len(row) > 15 else "",
            row[16] if len(row) > 16 else "",
            min_elev,
        )
        if elev_result is None:
            n_skipped_elev += 1
            continue

        elevation_m, elev_source = elev_result

        # ── Parse remaining fields ────────────────────────────────────────
        try:
            lat = float(row[4])
            lon = float(row[5])
        except ValueError:
            continue

        geonameid    = int(row[0])
        asciiname    = row[2].strip() or None
        country_code = row[8].strip() or None
        admin1_code  = row[10].strip() or None
        timezone     = row[17].strip() if len(row) > 17 else None

        batch.append((
            geonameid, name, asciiname, lat, lon,
            elevation_m, elev_source, feature_code,
            country_code, admin1_code, timezone,
        ))
        n_matched += 1
        code_counts[feature_code] = code_counts.get(feature_code, 0) + 1

        if len(batch) >= BATCH_SIZE:
            _flush(batch, conn)
            if not _HAS_TQDM and n_scanned % 1_000_000 == 0:
                print(f"  … {n_scanned:,} rows scanned, {n_matched:,} matched …")

    # Flush remainder
    if batch:
        _flush(batch, conn)

    text_stream.close()
    if zf:
        zf.close()
    conn.close()

    # ── Summary ──────────────────────────────────────────────────────────────
    print()
    print("═" * 60)
    print(f"  Rows scanned   : {n_scanned:>12,}")
    print(f"  Rows matched   : {n_matched:>12,}")
    print(f"  Skipped (code) : {n_skipped_code:>12,}")
    print(f"  Skipped (name) : {n_skipped_name:>12,}")
    print(f"  Skipped (elev) : {n_skipped_elev:>12,}")
    print()
    print("  Breakdown by feature_code:")
    for code in sorted(code_counts, key=lambda c: -code_counts[c]):
        print(f"    {code:<8}  {code_counts[code]:>8,}")
    print()
    db_size = db_path.stat().st_size / 1_048_576
    print(f"  SQLite file    : {db_path}  ({db_size:.1f} MB)")
    print("═" * 60)
    print("\nDone.  Use this table as a drop-in alternative to Overpass API.")
    print("Query example:")
    print("""
  SELECT geonameid, name, latitude, longitude, elevation_m
  FROM   geonames_peaks
  WHERE  latitude  BETWEEN :lat_s AND :lat_n
    AND  longitude BETWEEN :lon_w AND :lon_e
  ORDER  BY elevation_m DESC;
""")


# ═══════════════════════════════════════════════════════════════════════════════
# Entry point
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Import GeoNames mountain/peak data into a local SQLite database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
--------
  # Use defaults (allCountries.zip in scripts/, output to scripts/cache/)
  python scripts/import_geonames_peaks.py

  # Explicit paths
  python scripts/import_geonames_peaks.py \\
      --input C:/Downloads/allCountries.zip \\
      --db    scripts/cache/geonames_peaks.db

  # Only real summits above 500 m, rebuild from scratch
  python scripts/import_geonames_peaks.py --codes MT,PK --min-elev 500 --drop
""")

    ap.add_argument(
        "--input", type=Path, default=DEFAULT_ZIP,
        metavar="PATH",
        help=f"Path to allCountries.zip or allCountries.txt  (default: {DEFAULT_ZIP})",
    )
    ap.add_argument(
        "--db", type=Path, default=DEFAULT_DB,
        metavar="PATH",
        help=f"Output SQLite file  (default: {DEFAULT_DB})",
    )
    ap.add_argument(
        "--min-elev", type=int, default=0,
        metavar="METRES",
        help="Discard peaks below this altitude in metres  (default: 0)",
    )
    ap.add_argument(
        "--codes", type=str,
        default=",".join(sorted(DEFAULT_CODES)),
        metavar="CODES",
        help=(
            "Comma-separated GeoNames feature codes to include "
            f"(default: {','.join(sorted(DEFAULT_CODES))})"
        ),
    )
    ap.add_argument(
        "--drop", action="store_true",
        help="Drop and recreate the table before importing (full rebuild)",
    )

    args = ap.parse_args()

    codes = {c.strip().upper() for c in args.codes.split(",") if c.strip()}
    if not codes:
        ap.error("--codes must contain at least one feature code.")

    import_peaks(
        input_path = args.input,
        db_path    = args.db,
        codes      = codes,
        min_elev   = args.min_elev,
        drop       = args.drop,
    )


if __name__ == "__main__":
    main()
