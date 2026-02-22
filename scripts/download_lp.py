"""
download_lp.py
Downloads Lorenz 2024 light pollution PNGs, reprojects them from plate carree
(equirectangular) to Web Mercator, and saves the corrected files to public/lp/
for self-hosting via Vercel.

WHY REPROJECTION IS NEEDED
───────────────────────────
Leaflet's map uses Web Mercator (Y ∝ ln tan(π/4 + lat/2)).  ImageOverlay
stretches the supplied image *linearly* in Mercator screen space between the
SW and NE corners.  The Lorenz source PNGs are plate carree (Y ∝ latitude),
so placing them directly in an ImageOverlay produces a severe N–S misalignment:
at 50°N the overlay would show LP data from ~35°N (~1 700 km south).

The fix is a pure Y-axis remap:  for each output row we compute the latitude
that corresponds to that Mercator Y value, then sample the source row that
contains that latitude.  The X axis is identical in both projections (linear
longitude), so no horizontal change is needed.

WORKFLOW
─────────
  download ──► scripts/cache/lp/   (gitignored, original plate-carree PNGs)
  reproject ─► public/lp/          (committed, Web-Mercator-corrected PNGs)

Running the script again re-reprojects from cache without re-downloading.

Usage:
    pip install pillow numpy        # if not already installed
    python scripts/download_lp.py

Leaflet ImageOverlay bounds per output file (sw_lat, sw_lon → ne_lat, ne_lon):
  world_low3.png    [[-65, -180], [75,  180]]   world overview (zoom 0–3)
  NorthAmerica.png  [[  7, -180], [75,  -51]]
  SouthAmerica.png  [[-57,  -93], [14,  -33]]
  Europe2024.png    [[ 34,  -32], [75,   70]]
  Africa.png        [[-36,  -26], [38,   64]]
  Asia.png          [[  5,   60], [75,  180]]
  Australia.png     [[-48,   94], [ 8,  180]]
"""

import math
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

# The large continent PNGs (up to ~126 Mpx) exceed PIL's default safety limit,
# which is intended to block malicious files.  These are known-good scientific
# data files so we disable the limit for this script.
Image.MAX_IMAGE_PIXELS = None


# ── Directories ───────────────────────────────────────────────────────────────

SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
CACHE_DIR    = os.path.join(SCRIPT_DIR,   "cache", "lp")  # gitignored
OUTPUT_DIR   = os.path.join(PROJECT_ROOT, "public", "lp") # committed

_BASE = "https://djlorenz.github.io/astronomy/lp2024"

# lat_min / lat_max are the stated geographic extents of each source PNG.
FILES = [
    {
        "url":         f"{_BASE}/world2024_low3.png",
        "filename":    "world_low3.png",
        "description": "World LP 2024 — 1/40°, 65°S–75°N, 180°W–180°E",
        "lat_min": -65.0, "lat_max": 75.0,
    },
    {
        "url":         f"{_BASE}/NorthAmerica2024.png",
        "filename":    "NorthAmerica.png",
        "description": "North America LP 2024 — 1/120°, 7–75°N, 180–51°W",
        "lat_min":   7.0, "lat_max": 75.0,
    },
    {
        "url":         f"{_BASE}/SouthAmerica2024.png",
        "filename":    "SouthAmerica.png",
        "description": "South America LP 2024 — 1/120°, 57°S–14°N, 93–33°W",
        "lat_min": -57.0, "lat_max": 14.0,
    },
    {
        "url":         f"{_BASE}/Europe2024.png",
        "filename":    "Europe2024.png",
        "description": "Europe LP 2024 — 1/120°, 34–75°N, 32°W–70°E",
        "lat_min":  34.0, "lat_max": 75.0,
    },
    {
        "url":         f"{_BASE}/Africa2024.png",
        "filename":    "Africa.png",
        "description": "Africa LP 2024 — 1/120°, 36°S–38°N, 26°W–64°E",
        "lat_min": -36.0, "lat_max": 38.0,
    },
    {
        "url":         f"{_BASE}/Asia2024.png",
        "filename":    "Asia.png",
        "description": "Asia LP 2024 — 1/120°, 5–75°N, 60–180°E",
        "lat_min":   5.0, "lat_max": 75.0,
    },
    {
        "url":         f"{_BASE}/Australia2024.png",
        "filename":    "Australia.png",
        "description": "Australia LP 2024 — 1/120°, 48°S–8°N, 94–180°E",
        "lat_min": -48.0, "lat_max":  8.0,
    },
]


# ── Download ──────────────────────────────────────────────────────────────────

def _download(url: str, dest: str) -> None:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; DarkHorizon/1.0)",
            "Referer":    "https://djlorenz.github.io/astronomy/lp/",
        },
    )
    with urllib.request.urlopen(req) as resp:
        total      = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        block      = 1 << 16
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(block)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 / total
                    bar = "#" * int(pct / 2)
                    sys.stdout.write(
                        f"\r    [{bar:<50}] {pct:5.1f}%  "
                        f"{downloaded / 1e6:5.1f} / {total / 1e6:.1f} MB"
                    )
                    sys.stdout.flush()
    print()


# ── Reprojection ──────────────────────────────────────────────────────────────

def _merc_y(lat_deg: float) -> float:
    """Web Mercator Y (Gudermannian) for a given latitude in degrees."""
    return math.log(math.tan(math.pi / 4.0 + math.radians(lat_deg) / 2.0))


def reproject(src_path: str, dst_path: str, lat_min: float, lat_max: float) -> None:
    """
    Remap the Y axis of a plate-carree PNG to Web Mercator.

    Algorithm (vectorised, nearest-neighbour):
      For every output row y_out:
        1. Compute the Mercator Y value that row represents.
        2. Invert Mercator Y → geographic latitude.
        3. Map that latitude to a source row in the plate-carree image.
        4. Copy that source row to the output.

    Output dimensions:
      Width  – unchanged (longitude is linear in both projections).
      Height – kept equal to the source height.  At high latitudes Mercator
               expands the image (rows are repeated); at low latitudes it
               compresses (some rows are skipped).  This is geometrically
               correct and produces an output whose row distribution matches
               Mercator screen space, allowing Leaflet ImageOverlay to display
               it without distortion.

    Image mode:
      Palette (P / 8-bit indexed) images are kept in palette mode to preserve
      the Lorenz colour scale and keep file sizes small.  RGB / RGBA images
      are handled identically.  The palette, including any transparency entry,
      is copied to the output unchanged.
    """
    img = Image.open(src_path)
    is_palette = (img.mode == "P")
    palette    = img.getpalette() if is_palette else None
    transparency = img.info.get("transparency")

    arr   = np.array(img)   # shape (H, W) for P-mode, (H, W, C) for RGB
    src_h = arr.shape[0]
    out_h = src_h

    merc_max = _merc_y(lat_max)
    merc_min = _merc_y(lat_min)

    # Output row indices as fractions: 0 = top (lat_max), 1 = bottom (lat_min)
    fraction = np.arange(out_h, dtype=np.float64) / (out_h - 1)

    # Mercator Y for each output row → geographic latitude
    merc_vals = merc_max - fraction * (merc_max - merc_min)
    lats      = np.degrees(2.0 * np.arctan(np.exp(merc_vals)) - math.pi / 2.0)

    # Source row index for each output row (nearest-neighbour, clamped)
    y_src = np.clip(
        np.round((lat_max - lats) / (lat_max - lat_min) * src_h).astype(np.int32),
        0,
        src_h - 1,
    )

    out_arr = arr[y_src]  # vectorised row selection — no Python loop needed

    out_img = Image.fromarray(out_arr, mode=img.mode)
    if is_palette and palette:
        out_img.putpalette(palette)

    save_kwargs: dict = {}
    if transparency is not None:
        save_kwargs["transparency"] = transparency

    out_img.save(dst_path, **save_kwargs)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    os.makedirs(CACHE_DIR,  exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for entry in FILES:
        filename = entry["filename"]
        cache_path  = os.path.join(CACHE_DIR,  filename)
        output_path = os.path.join(OUTPUT_DIR, filename)

        # ── Step 1: download to cache (skip if already present) ──
        if os.path.exists(cache_path):
            size_mb = os.path.getsize(cache_path) / 1_048_576
            print(f"  Cache hit ({size_mb:.1f} MB): {filename}")
        else:
            print(f"  Downloading {entry['description']} …")
            _download(entry["url"], cache_path)
            size_mb = os.path.getsize(cache_path) / 1_048_576
            print(f"  Cached  ({size_mb:.1f} MB): {cache_path}")

        # ── Step 2: reproject plate-carree → Web Mercator ──
        print(f"  Reprojecting {filename} (lat {entry['lat_min']}° – {entry['lat_max']}°) …", end=" ")
        reproject(cache_path, output_path, entry["lat_min"], entry["lat_max"])
        size_mb = os.path.getsize(output_path) / 1_048_576
        print(f"done  ({size_mb:.1f} MB -> {output_path})")
        print()

    total_mb = sum(
        os.path.getsize(os.path.join(OUTPUT_DIR, e["filename"])) / 1_048_576
        for e in FILES
        if os.path.exists(os.path.join(OUTPUT_DIR, e["filename"]))
    )
    print(f"All done.  {len(FILES)} Mercator-corrected LP files in public/lp/  "
          f"(total: {total_mb:.1f} MB)")
    print("Commit public/lp/ to git — Vercel serves everything as static files.")


if __name__ == "__main__":
    main()
