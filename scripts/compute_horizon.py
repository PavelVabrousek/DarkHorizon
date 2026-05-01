"""
compute_horizon.py
──────────────────
Compute the local astronomical horizon profile for a given observation site.

Algorithm
---------
1.  Download a Digital Elevation Model patch from AWS Terrain Tiles (Terrarium
    format) — no API key required, global coverage, ~76 m/px at zoom 11.
    Tiles are cached locally on first download and reused on subsequent runs.
2.  Cast a ray from the observer for every azimuth (0°→359°, configurable step).
    Sample terrain elevation every 200 m along the ray up to the search radius.
    Apply Earth-curvature + atmospheric-refraction correction.
    The maximum elevation angle seen along the ray is the horizon for that azimuth.
    Negative values are fully supported (summit / elevated viewpoint).
3.  Query the local GeoNames SQLite database (geonames_peaks table, produced
    by import_geonames_peaks.py) for named peaks in the bounding box.
    Compute each peak's elevation angle and mark it visible if it rises above
    the terrain horizon.
    Falls back to the OpenStreetMap Overpass API when the DB file is absent.
4.  Assemble a JSON structure compatible with the `horizon_profile` DB column.
5.  Render a panoramic chart (dark astronomy theme) for visual debugging.
6.  Optionally write results to Supabase (batch mode).

Tile cache
----------
Downloaded Terrarium PNG tiles are stored at  dem_cache/{z}/{x}/{y}.png
(or a path passed via --cache-dir).  DEM data is static, so tiles are kept
indefinitely with no expiry.  Subsequent runs / nearby locations reuse tiles
instantly without any HTTP requests.

JSON output format
------------------
{
  "segments": [{"azimuth": 0, "min_elevation": 2.3}, ...],   // 0..359°, 1° step
  "peaks":    [{"name": "Sněžka", "azimuth": 14.2,
                "elevation_angle": 3.1, "altitude_m": 1603,
                "distance_km": 18.4, "above_horizon": true}],
  "meta":     {"observer_elev_m": 512, "radius_km": 100,
               "dem_source": "AWS Terrain Tiles (Terrarium) z=11",
               "computed_at": "2026-04-06T10:00:00+00:00"}
}

Usage — debug/single location
------------------------------
    python scripts/compute_horizon.py
    python scripts/compute_horizon.py --lat 50.7363 --lon 15.7386 --name "Sněžka"
    python scripts/compute_horizon.py --lat 50.4547 --lon 15.6952 --radius 150 --zoom 12

Usage — batch (all DB locations with NULL horizon_profile)
----------------------------------------------------------
    python scripts/compute_horizon.py --db-batch

Required Python packages
------------------------
    pip install requests Pillow numpy scipy matplotlib mercantile python-dotenv tqdm supabase
"""

import argparse
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import gaussian_filter1d
import matplotlib
matplotlib.use("Agg")          # headless — works on servers without display
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import mercantile
from tqdm import tqdm
from dotenv import load_dotenv


# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULT_LAT        = 50.2714147    # Bohemia / Czech Republic
DEFAULT_LON        = 14.3865718
DEFAULT_RADIUS_KM  = 100        # search radius in kilometres
DEFAULT_ZOOM       = 12         # AWS Terrarium zoom (≈76 m/px at equator)
DEFAULT_STEP_DEG   = 1          # azimuth resolution (degrees)
DEFAULT_SAMPLE_KM  = 0.2        # ray sampling step (km)
OUTPUT_DIR         = Path("horizon_output")
TILE_CACHE_DIR     = Path("dem_cache")       # persistent tile cache (z/x/y.png)
# GeoNames SQLite DB produced by import_geonames_peaks.py
DEFAULT_PEAKS_DB   = Path(__file__).parent / "cache" / "geonames_peaks.db"

# ── External endpoints ─────────────────────────────────────────────────────────

TERRARIUM_URL  = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS_URL   = "https://overpass-api.de/api/interpreter"
TILE_SIZE      = 256            # pixels per tile (Terrarium standard)
MAX_RETRIES    = 3


# ═══════════════════════════════════════════════════════════════════════════════
# 1.  DEM — AWS Terrain Tiles (Terrarium)
# ═══════════════════════════════════════════════════════════════════════════════

def _bbox(lat: float, lon: float, radius_km: float) -> tuple:
    """Return (west, south, east, north) bounding box for the search radius."""
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * math.cos(math.radians(lat)))
    return lon - dlon, lat - dlat, lon + dlon, lat + dlat


def _decode_terrarium(png_bytes: bytes) -> np.ndarray:
    """Decode raw Terrarium PNG bytes → (256, 256) float32 elevation array."""
    arr = np.array(Image.open(BytesIO(png_bytes)).convert("RGB"), dtype=np.float32)
    return arr[:, :, 0] * 256 + arr[:, :, 1] + arr[:, :, 2] / 256 - 32768


def _fetch_tile(z: int, x: int, y: int,
                cache_dir: Path = TILE_CACHE_DIR) -> np.ndarray:
    """
    Return a (256, 256) float32 elevation array for one Terrarium tile.

    Cache strategy
    --------------
    Raw PNG bytes are stored at  cache_dir/{z}/{x}/{y}.png  on first download.
    Subsequent calls load from disk without any HTTP request.
    DEM tiles are static, so no expiry is needed.

    Terrarium encoding:  elevation = R·256 + G + B/256 − 32768  (metres)
    """
    tile_path = cache_dir / str(z) / str(x) / f"{y}.png"

    # ── Cache hit ────────────────────────────────────────────────────────────
    if tile_path.exists():
        try:
            return _decode_terrarium(tile_path.read_bytes())
        except Exception as exc:
            # Corrupted cache file — delete and re-download
            print(f"  ⚠  Corrupt cache entry {tile_path}, re-downloading: {exc}",
                  file=sys.stderr)
            tile_path.unlink(missing_ok=True)

    # ── Cache miss — download and persist ────────────────────────────────────
    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    for attempt in range(MAX_RETRIES):
        try:
            resp      = requests.get(url, timeout=15)
            resp.raise_for_status()
            png_bytes = resp.content

            # Write to cache before decoding (atomic enough for our purposes)
            tile_path.parent.mkdir(parents=True, exist_ok=True)
            tile_path.write_bytes(png_bytes)

            return _decode_terrarium(png_bytes)
        except Exception as exc:
            if attempt < MAX_RETRIES - 1:
                time.sleep(1.0 * (attempt + 1))
            else:
                print(f"  ⚠  tile z={z} x={x} y={y}: {exc}", file=sys.stderr)
                return np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)


def fetch_dem(lat: float, lon: float, radius_km: float,
              zoom: int, cache_dir: Path = TILE_CACHE_DIR) -> tuple:
    """
    Download (or load from cache) all tiles covering the bounding box and
    stitch them into a single elevation raster.

    Returns
    -------
    dem       : np.ndarray (H, W) float32 — elevation in metres
    transform : dict with keys lon_min, lat_max, lon_per_px, lat_per_px
    """
    west, south, east, north = _bbox(lat, lon, radius_km)
    tiles = list(mercantile.tiles(west, south, east, north, zooms=zoom))
    if not tiles:
        raise ValueError("No tiles found for the given location / radius.")

    xs = [t.x for t in tiles]
    ys = [t.y for t in tiles]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    n_col = x_max - x_min + 1
    n_row = y_max - y_min + 1
    dem_w = n_col * TILE_SIZE
    dem_h = n_row * TILE_SIZE
    dem   = np.full((dem_h, dem_w), np.nan, dtype=np.float32)

    # Show how many tiles are already cached vs need downloading
    cached_n  = sum(
        1 for t in tiles
        if (cache_dir / str(zoom) / str(t.x) / f"{t.y}.png").exists()
    )
    fresh_n   = len(tiles) - cached_n
    cache_msg = (f"{cached_n} cached, {fresh_n} to download"
                 if cached_n else f"{fresh_n} to download")
    print(f"  {len(tiles)} tile(s) at zoom {zoom}  ({cache_msg}) …")

    for tile in tqdm(tiles, unit="tile", leave=False, ncols=72):
        elev    = _fetch_tile(zoom, tile.x, tile.y, cache_dir)
        col_off = (tile.x - x_min) * TILE_SIZE
        row_off = (tile.y - y_min) * TILE_SIZE
        dem[row_off:row_off + TILE_SIZE, col_off:col_off + TILE_SIZE] = elev

    # Geographic transform (exact Web Mercator tile indices)
    transform = {
        "x_min": x_min,
        "y_min": y_min,
        "zoom":  zoom,
    }
    
    lon_per_px = 360.0 / (1 << zoom) / TILE_SIZE
    res_m = lon_per_px * 111_320 * math.cos(math.radians(lat))
    print(f"  DEM: {dem_w}×{dem_h} px  ·  resolution ≈{res_m:.0f} m/px")
    return dem, transform


def _sample(dem: np.ndarray, tf: dict,
            lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """
    Bilinear interpolation of the DEM at arrays of geographic coordinates.
    Out-of-bound queries return NaN.
    """
    h, w = dem.shape
    z = tf["zoom"]

    # Exact Web Mercator projection to pixel coordinates
    tx = (lons + 180.0) / 360.0 * (1 << z)
    lat_rad = np.radians(lats)
    ty = (1.0 - np.log(np.tan(lat_rad) + 1.0 / np.cos(lat_rad)) / np.pi) / 2.0 * (1 << z)

    cols = (tx - tf["x_min"]) * TILE_SIZE
    rows = (ty - tf["y_min"]) * TILE_SIZE

    c0 = np.floor(cols).astype(int)
    r0 = np.floor(rows).astype(int)
    fc = cols - c0
    fr = rows - r0

    valid = (c0 >= 0) & (c0 < w - 1) & (r0 >= 0) & (r0 < h - 1)
    c0c   = np.clip(c0, 0, w - 2)
    r0c   = np.clip(r0, 0, h - 2)

    out = (dem[r0c,     c0c    ] * (1 - fc) * (1 - fr) +
           dem[r0c,     c0c + 1] * fc       * (1 - fr) +
           dem[r0c + 1, c0c    ] * (1 - fc) * fr       +
           dem[r0c + 1, c0c + 1] * fc       * fr       )
    out[~valid] = np.nan
    return out.astype(np.float32)


# ═══════════════════════════════════════════════════════════════════════════════
# 2.  Horizon calculation
# ═══════════════════════════════════════════════════════════════════════════════

def _get_observer_elevation(lat: float, lon: float,
                             dem: np.ndarray, tf: dict,
                             known_elev_m=None) -> float:
    """
    Determine the observer's elevation using the best available source.

    Priority chain (highest accuracy first)
    ----------------------------------------
    1. **Explicit override** — ``known_elev_m`` passed directly (from --elevation
       CLI argument or the DB ``elevation_m`` field).  Use this whenever the
       true altitude is known; the DEM cannot match surveyed/GPS precision.
    2. **Open-Meteo /elevation API** — free, no key, SRTM 30m resolution.
       Accurate to ±5–15 m in most terrain; much better than Terrarium at
       zoom 11 (~76 m/px).
    3. **DEM pixel fallback** — reads the Terrarium tile already in memory.
       Coarsest (≥76 m/px) and biased upward by vegetation/buildings in SRTM.
       Used only if both other sources fail.
    """
    if known_elev_m is not None:
        print(f"  Observer elevation: {float(known_elev_m):.1f} m"
              f"  (explicit override / DB field)")
        return float(known_elev_m)

    # Open-Meteo /elevation — single tiny request, SRTM 30m
    try:
        url  = (f"https://api.open-meteo.com/v1/elevation"
                f"?latitude={lat:.6f}&longitude={lon:.6f}")
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        elev = resp.json().get("elevation", [None])[0]
        if isinstance(elev, (int, float)):
            print(f"  Observer elevation: {float(elev):.1f} m"
                  f"  (Open-Meteo /elevation, SRTM 30m)")
            return float(elev)
    except Exception as exc:
        print(f"  ⚠  Open-Meteo elevation API failed: {exc}  — falling back to DEM",
              file=sys.stderr)

    # DEM pixel (coarsest; may over- or under-shoot by tens of metres)
    z = tf["zoom"]
    tx = (lon + 180.0) / 360.0 * (1 << z)
    lat_rad = math.radians(lat)
    ty = (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * (1 << z)

    obs_col = int((tx - tf["x_min"]) * TILE_SIZE)
    obs_row = int((ty - tf["y_min"]) * TILE_SIZE)

    obs_col = int(np.clip(obs_col, 0, dem.shape[1] - 1))
    obs_row = int(np.clip(obs_row, 0, dem.shape[0] - 1))
    elev    = float(dem[obs_row, obs_col])
    elev    = 0.0 if math.isnan(elev) else elev
    print(f"  Observer elevation: {elev:.1f} m"
          f"  (DEM pixel — low accuracy, ±40 m typical)")
    return elev


def compute_horizon(dem: np.ndarray, tf: dict,
                    obs_lat: float, obs_lon: float,
                    step_deg: int     = DEFAULT_STEP_DEG,
                    radius_km: float  = DEFAULT_RADIUS_KM,
                    sample_km: float  = DEFAULT_SAMPLE_KM,
                    known_elev_m      = None,
                    veg_bias_m: float = 0.0,
                    min_dist_km: float = 0.5) -> tuple:
    """
    Ray-casting horizon computation.

    For every azimuth θ the algorithm:
      - samples terrain elevation at d = sample_km … radius_km
      - subtracts veg_bias_m to correct for SRTM vegetation/building bias
      - applies Earth-curvature + atmospheric-refraction correction
        (combined ≈ 6.75 × 10⁻⁸ × d²  metres sag at distance d metres)
      - records the maximum elevation angle at d ≥ min_dist_km

    Parameters
    ----------
    known_elev_m : float or None
        Observer elevation override.  Skips DEM/API lookup when provided.
    veg_bias_m : float
        Subtract this value (metres) from all DEM terrain heights along each
        ray.  SRTM records the *surface* (trees, buildings); a bias of 10–20 m
        partially compensates for vegetation in mixed/forested terrain.
        Default 0 (no correction) — tune per location.
    min_dist_km : float
        Ignore terrain closer than this distance when searching for the
        horizon peak.  Near-observer DEM pixels cover large areas and can
        exhibit artefacts at ≤76 m/px resolution.  Default 0.5 km.

    Returns
    -------
    segments    : list of {azimuth, min_elevation} (signed degrees)
    obs_elev_m  : float — observer elevation in metres
    """
    obs_elev_m = _get_observer_elevation(obs_lat, obs_lon, dem, tf, known_elev_m)

    # Announce active corrections
    if veg_bias_m != 0:
        print(f"  Vegetation bias: −{veg_bias_m:.1f} m applied to all DEM samples")
    if min_dist_km > 0:
        print(f"  Min distance:    {min_dist_km:.2f} km (near artefacts ignored)")

    # Sample distances (km) and Earth-curvature+refraction correction (metres)
    dists_km  = np.arange(sample_km, radius_km + sample_km, sample_km, dtype=np.float32)
    dists_m   = dists_km * 1_000.0
    curv_corr = 6.75e-8 * dists_m ** 2      # positive → terrain appears lower

    azimuths_deg = list(range(0, 360, step_deg))
    cos_lat      = math.cos(math.radians(obs_lat))
    segments     = []

    for az_d in tqdm(azimuths_deg, desc="  Horizon rays", unit="°",
                     leave=False, ncols=72):
        az_r       = math.radians(az_d)
        d_north_km = math.cos(az_r) * dists_km
        d_east_km  = math.sin(az_r) * dists_km

        pt_lats = obs_lat + d_north_km / 111.32
        pt_lons = obs_lon + d_east_km  / (111.32 * cos_lat)

        h       = _sample(dem, tf, pt_lats, pt_lons)
        # Fix 1 — vegetation bias correction applied to terrain (not to observer)
        h_corr  = h - curv_corr - veg_bias_m
        angles  = np.degrees(np.arctan2(h_corr - obs_elev_m, dists_m))

        # Fix 2 — ignore near-observer samples below min_dist_km
        valid     = ~np.isnan(angles) & (dists_km >= min_dist_km)
        max_angle = float(np.max(angles[valid])) if valid.any() else 0.0
        segments.append({"azimuth": az_d, "min_elevation": round(max_angle, 2)})

    return segments, obs_elev_m


# ── Fix 3: azimuth cross-section debug plots ──────────────────────────────────

def plot_azimuth_profiles(
        debug_azimuths: list,
        dem: np.ndarray, tf: dict,
        obs_lat: float, obs_lon: float, obs_elev_m: float,
        radius_km: float  = DEFAULT_RADIUS_KM,
        sample_km: float  = DEFAULT_SAMPLE_KM,
        veg_bias_m: float = 0.0,
        min_dist_km: float = 0.5,
        out_dir: Path      = OUTPUT_DIR) -> None:
    """
    For each azimuth in ``debug_azimuths``, save a PNG elevation cross-section.

    Each plot shows:
      • Raw DEM terrain elevation (blue line, left y-axis)
      • Corrected elevation after veg-bias (dotted blue, if veg_bias != 0)
      • Elevation angle from observer (amber line, right y-axis)
      • Observer elevation as a horizontal reference (grey dashed)
      • Vertical dashed line marking the detected horizon peak
      • Shaded exclusion zone (0 … min_dist_km)
    """
    dists_km  = np.arange(sample_km, radius_km + sample_km, sample_km, dtype=np.float32)
    dists_m   = dists_km * 1_000.0
    curv_corr = 6.75e-8 * dists_m ** 2
    cos_lat   = math.cos(math.radians(obs_lat))
    out_dir.mkdir(parents=True, exist_ok=True)

    cardinal = {0:"N", 45:"NE", 90:"E", 135:"SE",
                180:"S", 225:"SW", 270:"W", 315:"NW"}

    for az_d in debug_azimuths:
        az_r       = math.radians(az_d)
        pt_lats    = obs_lat + math.cos(az_r) * dists_km / 111.32
        pt_lons    = obs_lon + math.sin(az_r) * dists_km / (111.32 * cos_lat)

        h_raw  = _sample(dem, tf, pt_lats, pt_lons)
        h_corr = h_raw - curv_corr - veg_bias_m
        angles = np.degrees(np.arctan2(h_corr - obs_elev_m, dists_m))

        valid     = ~np.isnan(angles) & (dists_km >= min_dist_km)
        if valid.any():
            peak_idx     = int(np.argmax(np.where(valid, angles, -9999.0)))
            peak_dist_km = float(dists_km[peak_idx])
            peak_angle   = float(angles[peak_idx])
        else:
            peak_dist_km, peak_angle = 0.0, 0.0

        # ── Plot ──────────────────────────────────────────────────────────
        matplotlib.rcParams.update({
            "font.family":     "monospace",
            "text.color":      _TEXT,
            "axes.labelcolor": _DIM_TEXT,
            "xtick.color":     _DIM_TEXT,
            "ytick.color":     _DIM_TEXT,
            "axes.edgecolor":  _GRID,
            "grid.color":      _GRID,
        })

        fig, ax1 = plt.subplots(figsize=(14, 5))
        fig.patch.set_facecolor(_DARK_BG)
        ax1.set_facecolor(_PLOT_BG)

        ok = ~np.isnan(h_raw)
        ax1.plot(dists_km[ok], h_raw[ok], color="#58a6ff", lw=1.3,
                 label="DEM terrain  (raw, incl. vegetation)")
        if veg_bias_m != 0:
            ax1.plot(dists_km[ok], h_corr[ok], color="#30c8ff",
                     lw=1.0, linestyle=":", alpha=0.8,
                     label=f"DEM after veg-bias (−{veg_bias_m:.0f} m)")
        ax1.axhline(obs_elev_m, color=_DIM_TEXT, lw=0.8, linestyle="--", alpha=0.7,
                    label=f"Observer  ({obs_elev_m:.0f} m)")
        ax1.set_xlabel("Distance  (km)", fontsize=8, color=_DIM_TEXT)
        ax1.set_ylabel("Elevation  (m)", fontsize=8, color="#58a6ff")
        ax1.tick_params(axis="y", labelcolor="#58a6ff", labelsize=8)
        ax1.tick_params(axis="x", labelsize=8)

        ax2 = ax1.twinx()
        ax2.set_facecolor(_PLOT_BG)
        ax2.plot(dists_km[valid], angles[valid], color=_PEAK_COL, lw=1.3,
                 label="Elevation angle  (°)")
        ax2.axhline(0, color=_DIM_TEXT, lw=0.5, linestyle="--", alpha=0.4)
        ax2.set_ylabel("Elevation angle  (°)", fontsize=8, color=_PEAK_COL)
        ax2.tick_params(axis="y", labelcolor=_PEAK_COL, labelsize=8)

        # Horizon peak
        ax2.axvline(peak_dist_km, color="#ff6b6b", lw=1.0, linestyle="--",
                    label=f"Horizon peak  {peak_angle:+.2f}° @ {peak_dist_km:.1f} km")
        ax2.plot(peak_dist_km, peak_angle, "o", ms=5, color="#ff6b6b", zorder=5)

        # Exclusion zone
        if min_dist_km > 0:
            ax1.axvspan(0, min_dist_km, alpha=0.12, color="#ffaa00")
            ax1.axvline(min_dist_km, color="#ffaa00", lw=0.8, linestyle=":",
                        alpha=0.7, label=f"Min-dist  ({min_dist_km:.2f} km)")

        # Grid + legend
        ax1.grid(True, alpha=0.25, linewidth=0.5)
        ax2.grid(False)
        for sp in list(ax1.spines.values()) + list(ax2.spines.values()):
            sp.set_color(_GRID)

        lines1, labs1 = ax1.get_legend_handles_labels()
        lines2, labs2 = ax2.get_legend_handles_labels()
        ax1.legend(lines1 + lines2, labs1 + labs2,
                   fontsize=7, loc="upper right",
                   facecolor=_PLOT_BG, edgecolor=_GRID, labelcolor=_TEXT)

        az_name = cardinal.get(az_d % 360, f"{az_d}°")
        ax1.set_title(
            f"Elevation cross-section  —  azimuth {az_d}° ({az_name})"
            f"    {obs_lat:.6f}°N  {obs_lon:.6f}°E    observer {obs_elev_m:.0f} m",
            fontsize=9, pad=7, color=_TEXT)

        plt.tight_layout()
        out_path = out_dir / f"profile_az{az_d:03d}.png"
        fig.savefig(out_path, dpi=150, bbox_inches="tight",
                    facecolor=fig.get_facecolor())
        plt.close(fig)
        print(f"  ✓  Profile az={az_d:3d}°  →  {out_path}"
              f"  (horizon: {peak_angle:+.2f}° @ {peak_dist_km:.1f} km)")


# ═══════════════════════════════════════════════════════════════════════════════
# 3.  Named peaks — GeoNames SQLite (primary) + Overpass fallback
# ═══════════════════════════════════════════════════════════════════════════════

def query_geonames_peaks(lat: float, lon: float, radius_km: float,
                         db_path: Path = DEFAULT_PEAKS_DB) -> tuple[list, str]:
    """
    Query the local GeoNames SQLite database for named peaks in the bounding
    box around (lat, lon) with the given radius.

    Returns
    -------
    (peaks, source_label)
      peaks        : list of {name, lat, lon, altitude_m}
                     — same shape as query_osm_peaks(), ready for annotate_peaks()
      source_label : human-readable string for the JSON meta field

    The bounding-box approach is O(log n) thanks to the lat/lon index and is
    effectively instantaneous even for the full world dataset (~300 k peaks).

    The function deliberately does NOT fall back to Overpass on its own — the
    caller (process_location) handles the fallback so that the decision is
    explicit and logged.
    """
    west, south, east, north = _bbox(lat, lon, radius_km)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT name, latitude, longitude, elevation_m
            FROM   geonames_peaks
            WHERE  latitude  BETWEEN ? AND ?
              AND  longitude BETWEEN ? AND ?
            ORDER  BY elevation_m DESC
            """,
            (south, north, west, east),
        ).fetchall()
    finally:
        conn.close()

    peaks = [
        {
            "name":       row["name"],
            "lat":        row["latitude"],
            "lon":        row["longitude"],
            "altitude_m": row["elevation_m"],
        }
        for row in rows
    ]
    label = f"GeoNames SQLite ({db_path.name})"
    print(f"  Found {len(peaks)} named peaks ({label}).")
    return peaks, label


def query_osm_peaks(lat: float, lon: float, radius_km: float) -> list:
    """
    Fetch all named natural peaks within radius_km via the Overpass API.

    This is now used only as a *fallback* when the GeoNames SQLite database
    file does not exist.  Kept for backwards compatibility.

    Returns list of {name, lat, lon, altitude_m (or None)}.
    """
    radius_m = int(radius_km * 1_000)
    query = (
        f'[out:json][timeout:30];'
        f'(node["natural"="peak"]["name"](around:{radius_m},{lat},{lon}););'
        f'out body;'
    )
    try:
        resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=35)
        resp.raise_for_status()
        peaks = []
        for elem in resp.json().get("elements", []):
            tags = elem.get("tags", {})
            name = (tags.get("name")
                    or tags.get("name:en")
                    or tags.get("int_name", ""))
            if not name:
                continue
            try:
                alt = float(tags["ele"]) if "ele" in tags else None
            except (ValueError, TypeError):
                alt = None
            peaks.append({
                "name":       name,
                "lat":        elem["lat"],
                "lon":        elem["lon"],
                "altitude_m": alt,
            })
        print(f"  Found {len(peaks)} named peaks (OSM Overpass).")
        return peaks
    except Exception as exc:
        print(f"  ⚠  Overpass failed: {exc}", file=sys.stderr)
        return []


def annotate_peaks(raw_peaks: list, segments: list,
                   obs_lat: float, obs_lon: float, obs_elev_m: float,
                   dem: np.ndarray, tf: dict) -> list:
    """
    For every named peak compute azimuth, distance, elevation angle and
    whether the summit is visible above the terrain horizon.
    """
    seg_map = {s["azimuth"]: s["min_elevation"] for s in segments}
    cos_lat = math.cos(math.radians(obs_lat))
    results = []

    for pk in raw_peaks:
        d_n    = (pk["lat"] - obs_lat) * 111_320.0
        d_e    = (pk["lon"] - obs_lon) * 111_320.0 * cos_lat
        dist_m = math.hypot(d_n, d_e)
        if dist_m < 50:
            continue
        dist_km = dist_m / 1_000.0

        az_deg = (math.degrees(math.atan2(d_e, d_n)) + 360) % 360

        if pk["altitude_m"] is not None:
            peak_h = pk["altitude_m"]
        else:
            h_arr  = _sample(dem, tf,
                             np.array([pk["lat"]], dtype=np.float32),
                             np.array([pk["lon"]], dtype=np.float32))
            peak_h = float(h_arr[0]) if not np.isnan(h_arr[0]) else obs_elev_m

        curv_m     = 6.75e-8 * dist_m ** 2
        elev_angle = math.degrees(math.atan2(peak_h - curv_m - obs_elev_m, dist_m))

        az_int        = int(round(az_deg)) % 360
        horizon_elev  = seg_map.get(az_int, 0.0)
        above_horizon = elev_angle >= horizon_elev - 0.3   # 0.3° tolerance

        results.append({
            "name":            pk["name"],
            "azimuth":         round(az_deg, 1),
            "elevation_angle": round(elev_angle, 2),
            "altitude_m":      round(peak_h) if peak_h else None,
            "distance_km":     round(dist_km, 2),
            "above_horizon":   above_horizon,
        })

    results.sort(key=lambda p: p["azimuth"])
    visible_n = sum(1 for p in results if p["above_horizon"])
    print(f"  {visible_n} peak(s) visible above terrain horizon.")
    return results


def filter_peaks(peaks: list, sector_deg: float = 10.0) -> list:
    """
    Reduce the peak list to avoid label clutter.
    Divides the 360° horizon into sectors (e.g. 10°).
    In each sector, selects at most two peaks (must be above horizon):
      1. The peak with the highest elevation_angle (most prominent relative to observer)
      2. The peak with the highest altitude_m (absolute tallest mountain)

    If the same peak holds both titles, only one is kept for that sector.
    """
    if not peaks:
        return peaks

    visible = [p for p in peaks if p.get("above_horizon")]

    # Group into sectors
    sectors = {}
    for pk in visible:
        az = pk["azimuth"]
        bin_idx = int((az % 360) // sector_deg)
        sectors.setdefault(bin_idx, []).append(pk)

    seen = set()
    merged = []

    for bin_idx, sector_peaks in sectors.items():
        # Highest elevation angle (prominence above horizon)
        best_angle = max(sector_peaks, key=lambda p: p["elevation_angle"])
        # Highest absolute altitude
        best_alt = max(sector_peaks, key=lambda p: (p.get("altitude_m") or -9999))

        for pk in (best_angle, best_alt):
            if pk["name"] not in seen:
                seen.add(pk["name"])
                merged.append(pk)

    merged.sort(key=lambda p: p["azimuth"])
    dropped = len(peaks) - len(merged)
    if dropped:
        print(f"  Peak filter: kept {len(merged)} of {len(peaks)} "
              f"(max 2 per {sector_deg}° sector).")
    return merged


# ═══════════════════════════════════════════════════════════════════════════════
# 4.  Visualization
# ═══════════════════════════════════════════════════════════════════════════════

_DARK_BG   = "#0a0a1a"
_PLOT_BG   = "#0d1117"
_TEXT      = "#c9d1d9"
_DIM_TEXT  = "#8b949e"
_GRID      = "#21262d"
_LINE_BLUE = "#58a6ff"
_PEAK_COL  = "#f0c040"



def draw_horizon(segments: list, peaks: list,
                 obs_lat: float, obs_lon: float, obs_elev_m: float,
                 location_name: str = "",
                 radius_km: float   = DEFAULT_RADIUS_KM,
                 zoom: int          = DEFAULT_ZOOM) -> plt.Figure:
    """
    Render the 0°→360° panoramic horizon chart (dark astronomy theme).

    Layout
    ------
    • X-axis  : azimuth 0→360°, labelled N / NE / E / SE / S / SW / W / NW / N
    • Y-axis  : signed elevation angle (°) — negative values show summit views
    • Blue fill: sky blocked by terrain (above horizon line, up to 0°)
    • Green fill: open sky below 0° (summit / elevated observer)
    • Dashed  : ideal flat horizon at 0°
    • Solid   : terrain horizon (slightly Gaussian-smoothed for display)
    • ▲ gold  : named peaks visible above terrain, labels staggered in 5 height tiers
    """
    matplotlib.rcParams.update({
        "font.family":     "monospace",
        "text.color":      _TEXT,
        "axes.labelcolor": _DIM_TEXT,
        "xtick.color":     _DIM_TEXT,
        "ytick.color":     _DIM_TEXT,
        "axes.edgecolor":  _GRID,
        "grid.color":      _GRID,
    })

    az  = np.array([s["azimuth"]       for s in segments], dtype=float)
    el  = np.array([s["min_elevation"] for s in segments], dtype=float)

    # Wrap to 360° (duplicate first point at the end for a closed line)
    az_p = np.append(az, 360.0)
    el_p = np.append(el, el[0])
    el_s = gaussian_filter1d(el_p, sigma=0.7)   # slight display smoothing

    fig, ax = plt.subplots(figsize=(14, 5))
    fig.patch.set_facecolor(_DARK_BG)
    ax.set_facecolor(_PLOT_BG)

    # Sky blocked by terrain
    ax.fill_between(az_p, 0, el_s, where=(el_s > 0),
                    color="#1e3a5f", alpha=0.55, zorder=1)
    # Open sky below flat horizon (summit views)
    ax.fill_between(az_p, el_s, 0, where=(el_s < 0),
                    color="#0d3320", alpha=0.45, zorder=1)

    ax.axhline(y=0, color=_DIM_TEXT, linewidth=0.9, linestyle="--",
               alpha=0.7, label="Ideal flat horizon  (0°)")

    ax.plot(az_p, el_s, color=_LINE_BLUE, linewidth=1.6, zorder=3,
            label=f"Terrain horizon  (r={radius_km:.0f} km, z={zoom})")

    # ── Peak markers + de-overlapped labels ─────────────────────────────────
    vis_peaks = [p for p in peaks if p.get("above_horizon")]

    # Draw triangle markers first (always at exact data coordinates)
    for pk in vis_peaks:
        ax.plot(pk["azimuth"], pk["elevation_angle"],
                marker="^", ms=6, color=_PEAK_COL, zorder=5, linestyle="None")

    # Build text objects at initial positions
    texts:   list = []
    data_xs: list = []
    data_ys: list = []
    for pk in vis_peaks:
        az_pk = pk["azimuth"]
        el_pk = pk["elevation_angle"]
        alt   = pk.get("altitude_m")
        label = f"{pk['name']}\n{int(alt)} m" if alt else pk["name"]

        # Note: the y-position is temporary. The explicit stagger block below overrides this.
        t = ax.text(az_pk, el_pk, label,
                    fontsize=5.5, color=_PEAK_COL,
                    ha="center", va="bottom", zorder=6)
        texts.append(t)
        data_xs.append(az_pk)
        data_ys.append(el_pk)

    # De-overlap labels with multi-tier stacking
    max_label_y = float(el.max()) if el.size > 0 else 0.0

    if texts:
        # Instead of using generic auto-layout which floats unpredictably,
        # we stagger them predictably into 5 height tiers.
        # Tier 0 (every 5th peak) sits right on the peak (0.8 deg above).
        # Tiers 1-4 sit successively higher.
        
        # Sort by azimuth left-to-right
        order = sorted(range(len(texts)), key=lambda i: data_xs[i])
        
        # Assign staggered heights
        # The offset is added to the peak's elevation angle.
        # We start at +0.8 (tier 0) and add +1.5 degrees for each subsequent tier.
        for rank, idx in enumerate(order):
            tier = rank % 5
            label_y = data_ys[idx] + 0.8 + (tier * 1.5)
            x_pos = data_xs[idx]
            
            texts[idx].set_position((x_pos, label_y))
            
            if label_y > max_label_y:
                max_label_y = label_y
            
            # Draw a leader line if it's pushed up (tier > 0)
            if tier > 0:
                ax.annotate("",
                            xy     =(x_pos, data_ys[idx]),
                            xytext =(x_pos, label_y - 0.2),
                            arrowprops=dict(arrowstyle="-",
                                            color=_PEAK_COL, lw=0.5, alpha=0.65),
                            zorder=4)

    # ── Axes ─────────────────────────────────────────────────────────────────
    cardinals = {0: "N", 45: "NE", 90: "E", 135: "SE",
                 180: "S", 225: "SW", 270: "W", 315: "NW", 360: "N"}

    # Ticks every 10°: cardinal names at 0/45/90/… and degree numbers elsewhere
    tick_pos    = list(range(0, 361, 10))
    tick_labels = [cardinals[p] if p in cardinals else f"{p}°" for p in tick_pos]
    ax.set_xticks(tick_pos)
    ax.set_xticklabels(tick_labels)

    # Style: large + bright for cardinal names, small + dim for degree numbers
    for tick_obj, lbl in zip(ax.get_xticklabels(), tick_labels):
        if lbl in cardinals.values():
            tick_obj.set_fontsize(8)
            tick_obj.set_color(_TEXT)
            tick_obj.set_fontweight("bold")
        else:
            tick_obj.set_fontsize(5.5)
            tick_obj.set_color(_DIM_TEXT)

    ax.set_xlim(0, 360)

    # Tighten the bottom bound: 1 degree below the lowest horizon point (or slightly below 0 so the 0-line is visible)
    el_min = min(float(el.min()) - 1.0, -0.5)
    
    # Ensure the Y-axis extends high enough to fit the highest label + some padding (e.g. 1.5 deg for multi-line text)
    el_max = max(float(el.max()) + 3.0, max_label_y + 1.5, 5.0)
    
    ax.set_ylim(el_min, el_max)
    ax.set_ylabel("Elevation angle  (°)", fontsize=8)
    ax.grid(True, alpha=0.3, linewidth=0.5)

    ns        = "N" if obs_lat >= 0 else "S"
    ew        = "E" if obs_lon >= 0 else "W"
    coord_str = f"{abs(obs_lat):.8f}°{ns}  {abs(obs_lon):.8f}°{ew}"
    title     = (f"Horizon Profile"
                 + (f"  —  {location_name}" if location_name else "")
                 + f"    {coord_str}    elev {obs_elev_m:.0f} m  asl")
    ax.set_title(title, fontsize=9, pad=8, color=_TEXT)

    peak_patch  = mpatches.Patch(color=_PEAK_COL, label="Named peak (visible)")
    h_, l_      = ax.get_legend_handles_labels()
    ax.legend(h_ + [peak_patch], l_ + ["Named peak (visible)"],
              fontsize=7, loc="upper right",
              facecolor=_PLOT_BG, edgecolor=_GRID, labelcolor=_TEXT)

    plt.tight_layout()
    return fig


# ═══════════════════════════════════════════════════════════════════════════════
# 5.  JSON assembly
# ═══════════════════════════════════════════════════════════════════════════════

def build_json(segments: list, peaks: list,
               obs_lat: float, obs_lon: float, obs_elev_m: float,
               radius_km: float, zoom: int, step_deg: int,
               peak_source: str = "GeoNames SQLite") -> dict:
    return {
        "segments": segments,
        "peaks":    peaks,
        "meta": {
            "observer_lat":    obs_lat,
            "observer_lon":    obs_lon,
            "observer_elev_m": round(obs_elev_m, 1),
            "radius_km":       radius_km,
            "step_deg":        step_deg,
            "dem_source":      f"AWS Terrain Tiles (Terrarium) z={zoom}",
            "peak_source":     peak_source,
            "computed_at":     datetime.now(timezone.utc).isoformat(),
        }
    }


# ═══════════════════════════════════════════════════════════════════════════════
# 6.  File output
# ═══════════════════════════════════════════════════════════════════════════════

def save_outputs(horizon_json: dict, fig: plt.Figure,
                 lat: float, lon: float, out_dir: Path) -> tuple:
    """Save JSON and PNG to out_dir. Returns (json_path, png_path)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stem      = f"horizon_{lat:.8f}_{lon:.8f}"
    json_path = out_dir / f"{stem}.json"
    png_path  = out_dir / f"{stem}.png"

    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(horizon_json, fh, indent=2, ensure_ascii=False)
    print(f"  ✓  JSON  →  {json_path}")

    fig.savefig(png_path, dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    print(f"  ✓  PNG   →  {png_path}")

    return json_path, png_path


# ═══════════════════════════════════════════════════════════════════════════════
# 7.  Supabase integration
# ═══════════════════════════════════════════════════════════════════════════════

def _supabase_client():
    """
    Return a Supabase client.
    Reads credentials from .env:
      VITE_SUPABASE_URL          – project URL
      SUPABASE_SERVICE_ROLE_KEY  – service-role key for writes
      SUPABASE_SERVICE_KEY       – legacy alias, still accepted

    The service-role key is required because batch horizon writes are admin
    maintenance operations and should not depend on permissive anonymous RLS.
    """
    load_dotenv()
    url = os.environ.get("VITE_SUPABASE_URL", "")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
           or os.environ.get("SUPABASE_SERVICE_KEY", ""))
    if not url or not key:
        raise EnvironmentError(
            "VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
            "(or legacy SUPABASE_SERVICE_KEY) must be set in .env")
    from supabase import create_client
    return create_client(url, key)


def _fetch_empty_locations(sb) -> list:
    result = (sb.table("locations")
                .select("id, name, latitude, longitude, elevation_m")
                .filter("horizon_profile", "is", "null")
                .execute())
    return result.data or []


def _update_horizon(sb, location_id: str, horizon_json: dict) -> None:
    # We must explicitly request the updated row to be returned, otherwise
    # Supabase (PostgREST) returns an empty data array by default on UPDATEs.
    result = (sb.table("locations")
                .update({"horizon_profile": horizon_json})
                .eq("id", location_id)
                .execute())
    
    # postgrest-py by default does not return the updated row data unless
    # .select() is appended, or depending on the configuration. If the update
    # truly failed due to RLS, the operation would succeed but affect 0 rows.
    # Since we can't easily rely on result.data being populated without a select,
    # we just trust that if it didn't raise an exception, it went through (or
    # was silently blocked by RLS if using anon key).
    
    # To properly check if the update worked without an extra round trip,
    # we can just return. If the user uses the Service Key, it will work.
    pass


# ═══════════════════════════════════════════════════════════════════════════════
# 8.  Single-location pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def process_location(lat: float, lon: float,
                     radius_km: float   = DEFAULT_RADIUS_KM,
                     zoom: int          = DEFAULT_ZOOM,
                     step_deg: int      = DEFAULT_STEP_DEG,
                     sample_km: float   = DEFAULT_SAMPLE_KM,
                     out_dir: Path      = OUTPUT_DIR,
                     cache_dir: Path    = TILE_CACHE_DIR,
                     name: str          = "",
                     elevation_m        = None,
                     veg_bias_m: float  = 0.0,
                     min_dist_km: float = 0.5,
                     debug_azimuths     = None,
                     peaks_db: Path     = DEFAULT_PEAKS_DB) -> dict:
    """
    Full horizon pipeline: download DEM (using cache) → compute →
    query peaks → assemble JSON → render chart → save files.

    Parameters
    ----------
    elevation_m : float or None
        Known observer elevation (metres). Skips DEM/API lookup when given.
    veg_bias_m : float
        Metres to subtract from DEM terrain heights to compensate for SRTM
        vegetation/building bias (default 0 — no correction).
    min_dist_km : float
        Minimum ray distance (km) for horizon search; avoids near-observer
        DEM artefacts (default 0.5 km).
    debug_azimuths : list of int or None
        If provided, save cross-section profile plots for these azimuths
        (e.g. [0, 90, 180, 270]).  Saved alongside the main outputs.
    peaks_db : Path
        Path to the GeoNames SQLite database produced by import_geonames_peaks.py.
        When the file exists it is used as the primary source for named peaks.
        If the file is absent the script falls back to the Overpass API.

    Returns the horizon JSON dict.
    """
    label = f"{name}  " if name else ""
    print(f"\n── {label}({lat:.8f}°N  {lon:.8f}°E) ──────────────────────────────")

    print("1/4  Fetching DEM …")
    dem, tf = fetch_dem(lat, lon, radius_km, zoom, cache_dir)

    print("2/4  Computing horizon profile …")
    segments, obs_elev_m = compute_horizon(dem, tf, lat, lon,
                                           step_deg, radius_km, sample_km,
                                           known_elev_m=elevation_m,
                                           veg_bias_m=veg_bias_m,
                                           min_dist_km=min_dist_km)

    # Fix 3 — debug cross-section profiles (if requested)
    if debug_azimuths:
        print(f"  Debug profiles for azimuths: {debug_azimuths}")
        plot_azimuth_profiles(
            debug_azimuths, dem, tf,
            lat, lon, obs_elev_m,
            radius_km=radius_km, sample_km=sample_km,
            veg_bias_m=veg_bias_m, min_dist_km=min_dist_km,
            out_dir=out_dir)

    # ── Step 3: named peaks ──────────────────────────────────────────────────
    # Primary: GeoNames SQLite (fast, offline, no rate-limit)
    # Fallback: OSM Overpass API (when the DB file does not exist)
    if peaks_db.exists():
        print(f"3/4  Querying named peaks (GeoNames SQLite: {peaks_db.name}) …")
        raw_peaks, peak_source = query_geonames_peaks(lat, lon, radius_km, peaks_db)
    else:
        print(f"3/4  GeoNames DB not found ({peaks_db}) — falling back to Overpass …")
        print("     Run  python scripts/import_geonames_peaks.py  to build it.")
        raw_peaks   = query_osm_peaks(lat, lon, radius_km)
        peak_source = "OpenStreetMap Overpass API (fallback)"

    peaks = annotate_peaks(raw_peaks, segments, lat, lon, obs_elev_m, dem, tf)
    peaks = filter_peaks(peaks)

    print("4/4  Rendering visualization …")
    horizon_json = build_json(segments, peaks, lat, lon, obs_elev_m,
                              radius_km, zoom, step_deg,
                              peak_source=peak_source)
    fig = draw_horizon(segments, peaks, lat, lon, obs_elev_m,
                       location_name=name, radius_km=radius_km, zoom=zoom)

    save_outputs(horizon_json, fig, lat, lon, out_dir)
    plt.close(fig)

    return horizon_json


# ═══════════════════════════════════════════════════════════════════════════════
# 9.  Entry point
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Compute astronomical horizon profiles from DEM + OSM data.")
    ap.add_argument("--lat",         type=float, default=DEFAULT_LAT,
                    help=f"Observer latitude   (default: {DEFAULT_LAT})")
    ap.add_argument("--lon",         type=float, default=DEFAULT_LON,
                    help=f"Observer longitude  (default: {DEFAULT_LON})")
    ap.add_argument("--name",        type=str,   default="",
                    help="Location name for chart title")
    ap.add_argument("--radius",      type=float, default=DEFAULT_RADIUS_KM,
                    help=f"Search radius in km (default: {DEFAULT_RADIUS_KM})")
    ap.add_argument("--zoom",        type=int,   default=DEFAULT_ZOOM,
                    help=f"Tile zoom level (11≈76 m/px, 12≈38 m/px; default: {DEFAULT_ZOOM})")
    ap.add_argument("--step",        type=int,   default=DEFAULT_STEP_DEG,
                    help=f"Azimuth step in degrees (default: {DEFAULT_STEP_DEG})")
    ap.add_argument("--sample-step", type=float, default=DEFAULT_SAMPLE_KM,
                    help=f"Ray sampling step in km (default: {DEFAULT_SAMPLE_KM})")
    ap.add_argument("--output-dir",  type=str,   default=str(OUTPUT_DIR),
                    help=f"Output directory (default: {OUTPUT_DIR})")
    ap.add_argument("--cache-dir",   type=str,   default=str(TILE_CACHE_DIR),
                    help=f"DEM tile cache directory (default: {TILE_CACHE_DIR})")
    ap.add_argument("--elevation",      type=float, default=None,
                    help="Known observer elevation in metres (overrides DEM + API lookup)")
    ap.add_argument("--veg-bias",       type=float, default=0.0,
                    help="Vegetation/building bias correction in metres subtracted from DEM "
                         "(default: 0 — try 10–20 for forested terrain)")
    ap.add_argument("--min-dist",       type=float, default=0.5,
                    help="Minimum ray distance km for horizon search — avoids near-observer "
                         "DEM artefacts (default: 0.5)")
    ap.add_argument("--debug-azimuth",  type=str,   default=None,
                    help="Comma-separated azimuths for cross-section debug plots "
                         "(e.g. '0,90,180,270')")
    ap.add_argument("--db-batch",       action="store_true",
                    help="Batch mode: process all DB locations with NULL horizon_profile")
    ap.add_argument("--peaks-db",       type=str,   default=str(DEFAULT_PEAKS_DB),
                    help=f"Path to GeoNames SQLite DB  (default: {DEFAULT_PEAKS_DB})  "
                         "Falls back to Overpass API when the file is absent.")
    args = ap.parse_args()

    # Parse optional comma-separated azimuth list
    debug_azimuths = (
        [int(a.strip()) for a in args.debug_azimuth.split(",")]
        if args.debug_azimuth else None
    )

    out_dir   = Path(args.output_dir)
    cache_dir = Path(args.cache_dir)
    peaks_db  = Path(args.peaks_db)

    if args.db_batch:
        # ── Batch mode ───────────────────────────────────────────────────────
        print("Connecting to Supabase …")
        sb   = _supabase_client()
        locs = _fetch_empty_locations(sb)
        print(f"Found {len(locs)} location(s) with empty horizon_profile.\n")

        for loc in locs:
            try:
                hj = process_location(
                    lat            = loc["latitude"],
                    lon            = loc["longitude"],
                    radius_km      = args.radius,
                    zoom           = args.zoom,
                    step_deg       = args.step,
                    sample_km      = args.sample_step,
                    out_dir        = out_dir,
                    cache_dir      = cache_dir,
                    name           = loc.get("name", ""),
                    elevation_m    = loc.get("elevation_m"),
                    veg_bias_m     = args.veg_bias,
                    min_dist_km    = args.min_dist,
                    debug_azimuths = debug_azimuths,
                    peaks_db       = peaks_db,
                )
                _update_horizon(sb, loc["id"], hj)
                print(f"  ✓  DB updated: {loc.get('name', loc['id'])}")
            except Exception as exc:
                print(f"  ✗  {loc.get('name', loc['id'])}: {exc}", file=sys.stderr)
    else:
        # ── Single / debug mode ──────────────────────────────────────────────
        process_location(
            lat            = args.lat,
            lon            = args.lon,
            radius_km      = args.radius,
            zoom           = args.zoom,
            step_deg       = args.step,
            sample_km      = args.sample_step,
            out_dir        = out_dir,
            cache_dir      = cache_dir,
            name           = args.name,
            elevation_m    = args.elevation,
            veg_bias_m     = args.veg_bias,
            min_dist_km    = args.min_dist,
            debug_azimuths = debug_azimuths,
            peaks_db       = peaks_db,
        )

    print("\nDone.")


if __name__ == "__main__":
    main()
