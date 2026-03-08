"""
convert_cloudcover.py
─────────────────────
Converts 53 weekly ERA5/Copernicus clear-sky-probability GeoTIFFs into
Mercator-corrected RGBA PNGs suitable for Leaflet ImageOverlay.

WHY REPROJECTION IS NEEDED
───────────────────────────
Leaflet's map uses Web Mercator (Y ∝ ln tan(π/4 + lat/2)).  ImageOverlay
stretches the supplied image *linearly* in Mercator screen space between the
SW and NE corners.  The ERA5 GeoTIFFs are plate carree (Y ∝ latitude), so
placing them directly produces severe N–S misalignment at higher latitudes
(e.g. at 50°N the overlay would show data from ~35°N, ~1 700 km south).

The fix (same algorithm as download_lp.py) is a pure Y-axis remap:
  for each output row compute the latitude that corresponds to that
  Mercator Y, then sample the source plate-carree row for that latitude.

Input:   public/cloudcover/clear_sky_prob_week_NN.tif
          • EPSG:4326, 1440×721 pixels (0.25° global), float64, range 0–1
          • Values: 0.0 = always cloudy, 1.0 = always clear sky
Output:  public/cloudcover/clear_sky_prob_week_NN.png
          • RGBA PNG, Mercator-remapped, latitude range LAT_MIN–LAT_MAX

Colour ramp (probability 0 → 1):
  0.00 (always cloudy)  → solid white   (fully opaque cloud overlay)
  0.50 (50 % clear)     → semi-transparent white
  0.95 – 1.00 (clear)   → fully transparent (nothing overlaid)

Leaflet ImageOverlay bounds to use (in MapView.tsx):
  [[LAT_MIN, -180], [LAT_MAX, 180]]   (currently -85, +85)

Usage:
    python scripts/convert_cloudcover.py
"""

import math
import os
import sys
import numpy as np
import rasterio
from PIL import Image

# ── Geographic extent for the output PNGs ────────────────────────────────────
# Mercator is undefined at ±90°, so we clip to ±85°.  This covers all
# inhabited land and matches the range Leaflet natively renders at zoom 0.
LAT_MIN = -85.0
LAT_MAX =  85.0

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CLOUDCOVER_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "public", "cloudcover")

# ── Colour LUT (lookup table) ─────────────────────────────────────────────────

def build_lut() -> np.ndarray:
    """
    Return a (256, 4) uint8 LUT mapping probability index 0-255 to RGBA.

    Grayscale colour logic (input = clear sky probability):
      - 0.0 (always cloudy) → white (255)
      - 1.0 (always clear)  → dark gray (30)
      
    Alpha is kept reasonably opaque (e.g. 180) across the board so the
    color is always readable against the map, rather than relying on transparency.
    
    The curve is remapped using a smoothstep-like sigmoid curve:
      f(x) = 3x^2 - 2x^3
    This makes the transition steeper in the middle (0.5) and flatter near the
    extremes (0.0 and 1.0), increasing the visual contrast between "mostly clear"
    and "mostly cloudy".
    """
    lut = np.zeros((256, 4), dtype=np.uint8)
    for i in range(256):
        v = i / 255.0  # normalised clear-sky probability (0 = cloudy, 1 = clear)

        # Apply steeper double-sigmoid curve:
        # We want to push values away from 0.5 towards 0.0 or 1.0 even faster.
        # This increases the visual contrast between "cloudy" and "clear".
        # f(x) = (sin(pi * (x - 0.5)) + 1) / 2 gives a slightly steeper S-curve.
        # To make it much steeper, we can chain the smoothstep function:
        # f1(x) = 3x^2 - 2x^3
        # f2(x) = f1(f1(x))
        v_s1 = (3 * (v ** 2)) - (2 * (v ** 3))
        v_curved = (3 * (v_s1 ** 2)) - (2 * (v_s1 ** 3))

        # Convert mapped clear-sky probability → cloud probability (inverse)
        # 1.0 = thick cloud (white), 0.0 = clear sky (dark gray)
        cloud = 1.0 - v_curved

        # Map to grayscale: 30 (dark gray) to 255 (white)
        val = int(30 + (cloud * 225))
        
        # Alpha fully opaque (255) as requested.
        # The user will control the transparency purely via the UI opacity slider.
        alpha = 255

        lut[i] = (val, val, val, alpha)

    return lut


LUT = build_lut()


# ── Mercator reprojection ─────────────────────────────────────────────────────

def _merc_y(lat_deg: float) -> float:
    """Web Mercator Y (Gudermannian) for a given latitude in degrees."""
    return math.log(math.tan(math.pi / 4.0 + math.radians(lat_deg) / 2.0))


def reproject_to_mercator(arr: np.ndarray, src_lat_min: float, src_lat_max: float,
                          dst_lat_min: float, dst_lat_max: float) -> np.ndarray:
    """
    Remap the Y axis of a plate-carree RGBA array to Web Mercator.

    For each output row: compute the Mercator Y → invert to lat →
    sample the corresponding source row (nearest-neighbour).

    Output has the same width and number of rows as the input.
    """
    src_h = arr.shape[0]
    out_h = src_h

    merc_max = _merc_y(dst_lat_max)
    merc_min = _merc_y(dst_lat_min)

    # Output row fractions: 0 = top (north), 1 = bottom (south)
    fraction = np.arange(out_h, dtype=np.float64) / (out_h - 1)

    # Mercator Y for each output row → geographic latitude
    merc_vals = merc_max - fraction * (merc_max - merc_min)
    lats = np.degrees(2.0 * np.arctan(np.exp(merc_vals)) - math.pi / 2.0)

    # Source row index (nearest-neighbour, clamped)
    y_src = np.clip(
        np.round((src_lat_max - lats) / (src_lat_max - src_lat_min) * src_h).astype(np.int32),
        0,
        src_h - 1,
    )

    return arr[y_src]  # vectorised row selection


# ── Conversion ─────────────────────────────────────────────────────────────────

def convert(tif_path: str, png_path: str) -> float:
    """Convert a single GeoTIFF to a Mercator-corrected colour-mapped RGBA PNG.

    Returns the output file size in KB.
    """
    with rasterio.open(tif_path) as src:
        data = src.read(1).astype(np.float64)
        # Actual geographic extent of the source data
        src_lat_min = src.bounds.bottom
        src_lat_max = src.bounds.top

    # Clamp to 0–1 (ERA5 data should already be in range)
    data = np.clip(data, 0.0, 1.0)

    # Map probability → 8-bit index
    indices = (data * 255).astype(np.uint8)

    # Apply LUT: (H, W) → (H, W, 4)
    rgba = LUT[indices]

    # Reproject from plate carree to Web Mercator (Y-axis remap)
    rgba = reproject_to_mercator(rgba, src_lat_min, src_lat_max, LAT_MIN, LAT_MAX)

    img = Image.fromarray(rgba, mode="RGBA")
    img.save(png_path, "PNG", optimize=True)

    return os.path.getsize(png_path) / 1024.0


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    tif_files = sorted(
        f for f in os.listdir(CLOUDCOVER_DIR)
        if f.lower().endswith(".tif")
    )

    if not tif_files:
        print(f"No .tif files found in {CLOUDCOVER_DIR}")
        sys.exit(1)

    print(f"Converting {len(tif_files)} GeoTIFFs → PNG in {CLOUDCOVER_DIR}\n")

    total_tif_kb = 0
    total_png_kb = 0

    for tif_file in tif_files:
        tif_path = os.path.join(CLOUDCOVER_DIR, tif_file)
        png_file = tif_file.replace(".tif", ".png")
        png_path = os.path.join(CLOUDCOVER_DIR, png_file)

        tif_kb = os.path.getsize(tif_path) / 1024.0
        total_tif_kb += tif_kb

        png_kb = convert(tif_path, png_path)
        total_png_kb += png_kb

        ratio = tif_kb / png_kb if png_kb > 0 else 0
        print(f"  {tif_file:40s}  {tif_kb:7.0f} KB  →  {png_file}  {png_kb:5.0f} KB  ({ratio:.1f}×)")

    print(f"\n{'─' * 72}")
    print(f"  Total TIFF: {total_tif_kb / 1024:.1f} MB   →   Total PNG: {total_png_kb / 1024:.1f} MB")
    print(f"  Overall compression: {total_tif_kb / total_png_kb:.1f}×  (TIF uncompressed float64)")
    print(f"\nMercator-corrected PNGs cover latitude {LAT_MIN}° – {LAT_MAX}°.")
    print(f"Use bounds [[{LAT_MIN}, -180], [{LAT_MAX}, 180]] in the Leaflet ImageOverlay.")
    print("\nConversion complete!")


if __name__ == "__main__":
    main()
