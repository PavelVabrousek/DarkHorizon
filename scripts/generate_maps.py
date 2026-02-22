"""
generate_maps.py
Generates two dark-styled static PNG map files with Cross Blended Hypso +
Shaded Relief + Water as the base layer, for use as Leaflet ImageOverlay.

Raster sources (Natural Earth, downloaded & cached on first run):
  50m  HYP_50M_SR_W  (~97 MB zip)   → europe_overview
  10m  HYP_LR_SR_W   (~223 MB zip)  → central_europe_detail

Output:
  scripts/output/europe_overview.png        – lon -25..45, lat 34..72
  scripts/output/central_europe_detail.png  – lon 8..32,  lat 44..58

Usage:
  pip install cartopy matplotlib pillow numpy
  python scripts/generate_maps.py
"""

import os
import sys
import urllib.request
import zipfile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import cartopy.crs as ccrs
import cartopy.feature as cfeature
from cartopy.feature import NaturalEarthFeature
from PIL import Image, ImageEnhance

# ── Directories ───────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "output")
CACHE_DIR  = os.path.join(SCRIPT_DIR, "cache")

os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(CACHE_DIR,  exist_ok=True)

# ── Natural Earth raster sources (NACIS CDN) ──────────────────────────────────
_CDN = "https://naciscdn.org/naturalearth"

RASTERS = {
    "50m": {
        "url":      f"{_CDN}/50m/raster/HYP_50M_SR_W.zip",
        "tif_stem": "HYP_50M_SR_W",
        "label":    "50m Cross Blended Hypso + Shaded Relief + Water (~97 MB zip)",
    },
    "10m": {
        "url":      f"{_CDN}/10m/raster/HYP_LR_SR_W.zip",
        "tif_stem": "HYP_LR_SR_W",
        "label":    "10m Cross Blended Hypso + Shaded Relief + Water, medium (~223 MB zip)",
    },
}

# ── Overlay colours ───────────────────────────────────────────────────────────
COL_COAST  = "#c8d8c8"
COL_BORDER = "#c8d8c8"
COL_RIVER  = "#5a9fd4"
COL_LAKE   = "#1a3a5c"


# ── Download / cache ──────────────────────────────────────────────────────────

def _download_file(url: str, dest_path: str):
    """Download url -> dest_path with browser headers and a progress bar."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Referer":         "https://www.naturalearthdata.com/",
        },
    )
    with urllib.request.urlopen(req) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        block = 1 << 16
        with open(dest_path, "wb") as f:
            while True:
                chunk = resp.read(block)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 / total
                    bar = "#" * int(pct / 2)
                    sys.stdout.write(f"\r    [{bar:<50}] {pct:5.1f}%  {downloaded/1e6:6.1f}/{total/1e6:.1f} MB")
                    sys.stdout.flush()
    print()


def get_raster_path(resolution: str) -> str:
    """Return path to the cached .tif, downloading & extracting if needed."""
    cfg      = RASTERS[resolution]
    tif_stem = cfg["tif_stem"]

    for fname in os.listdir(CACHE_DIR):
        if fname.lower().startswith(tif_stem.lower()) and fname.lower().endswith(".tif"):
            path = os.path.join(CACHE_DIR, fname)
            print(f"  Using cached raster: {fname}")
            return path

    zip_path = os.path.join(CACHE_DIR, tif_stem + ".zip")
    print(f"  Downloading {cfg['label']} ...")
    _download_file(cfg["url"], zip_path)

    print(f"  Extracting {os.path.basename(zip_path)} ...")
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(CACHE_DIR)
    os.remove(zip_path)

    for root, _, files in os.walk(CACHE_DIR):
        for fname in files:
            if fname.lower().startswith(tif_stem.lower()) and fname.lower().endswith(".tif"):
                src = os.path.join(root, fname)
                dst = os.path.join(CACHE_DIR, fname)
                if src != dst:
                    os.rename(src, dst)
                return dst

    raise FileNotFoundError(
        f"Could not find a .tif matching '{tif_stem}' after extracting the zip."
    )


# ── Raster processing ─────────────────────────────────────────────────────────

def crop_and_darken(
    tif_path: str,
    lon_min: float, lon_max: float,
    lat_min: float, lat_max: float,
    brightness: float = 0.65,
    saturation: float = 0.70,
) -> np.ndarray:
    img = Image.open(tif_path).convert("RGB")
    w, h = img.size
    px0 = int((lon_min + 180) / 360 * w)
    px1 = int((lon_max + 180) / 360 * w)
    py0 = int((90 - lat_max) / 180 * h)
    py1 = int((90 - lat_min) / 180 * h)
    cropped = img.crop((px0, py0, px1, py1))
    cropped = ImageEnhance.Brightness(cropped).enhance(brightness)
    cropped = ImageEnhance.Color(cropped).enhance(saturation)
    return np.array(cropped)


# ── Matplotlib / Cartopy helpers ──────────────────────────────────────────────

def make_figure(width_px: int, height_px: int, dpi: int = 300):
    return plt.figure(
        figsize=(width_px / dpi, height_px / dpi),
        dpi=dpi,
        facecolor="#0d1b2a",
    )


def add_ax(fig, lon_min, lon_max, lat_min, lat_max):
    ax = fig.add_axes([0, 0, 1, 1], projection=ccrs.PlateCarree())
    ax.set_extent([lon_min, lon_max, lat_min, lat_max], crs=ccrs.PlateCarree())
    ax.set_facecolor("#0d1b2a")
    ax.spines["geo"].set_visible(False)
    return ax


def add_vector_overlays(ax, resolution: str = "10m", include_rivers: bool = False):
    lakes = NaturalEarthFeature(
        "physical", "lakes", resolution,
        facecolor=COL_LAKE, edgecolor=COL_COAST, linewidth=0.3,
    )
    ax.add_feature(lakes, zorder=5)
    ax.add_feature(
        cfeature.COASTLINE.with_scale(resolution),
        edgecolor=COL_COAST, linewidth=0.6, zorder=6,
    )
    borders = NaturalEarthFeature(
        "cultural", "admin_0_boundary_lines_land", resolution,
        facecolor="none", edgecolor=COL_BORDER, linewidth=0.5,
    )
    ax.add_feature(borders, zorder=7)
    if include_rivers:
        rivers = NaturalEarthFeature(
            "physical", "rivers_lake_centerlines", resolution,
            facecolor="none", edgecolor=COL_RIVER, linewidth=0.45,
        )
        ax.add_feature(rivers, zorder=8)


def save_figure(fig, out_path: str, dpi: int):
    fig.savefig(out_path, dpi=dpi, bbox_inches="tight", pad_inches=0, facecolor="#0d1b2a")
    plt.close(fig)
    size_mb = os.path.getsize(out_path) / 1_048_576
    print(f"  OK  Saved: {out_path}  ({size_mb:.1f} MB)")


# ── Map generators ────────────────────────────────────────────────────────────

def generate_europe_overview():
    print("\nGenerating europe_overview.png ...")
    LON_MIN, LON_MAX = -25, 45
    LAT_MIN, LAT_MAX =  34, 72
    W_PX, H_PX, DPI  = 10000, 6000, 300
    tif_path  = get_raster_path("50m")
    img_array = crop_and_darken(tif_path, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX, brightness=0.65, saturation=0.70)
    fig = make_figure(W_PX, H_PX, DPI)
    ax  = add_ax(fig, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX)
    ax.imshow(img_array, origin="upper", extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX],
              transform=ccrs.PlateCarree(), zorder=1, interpolation="lanczos")
    add_vector_overlays(ax, resolution="10m", include_rivers=False)
    save_figure(fig, os.path.join(OUTPUT_DIR, "europe_overview.png"), DPI)


def generate_central_europe_detail():
    print("\nGenerating central_europe_detail.png ...")
    LON_MIN, LON_MAX =  8, 32
    LAT_MIN, LAT_MAX = 44, 58
    W_PX, H_PX, DPI  = 8000, 5000, 300
    tif_path  = get_raster_path("10m")
    img_array = crop_and_darken(tif_path, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX, brightness=0.65, saturation=0.70)
    fig = make_figure(W_PX, H_PX, DPI)
    ax  = add_ax(fig, LON_MIN, LON_MAX, LAT_MIN, LAT_MAX)
    ax.imshow(img_array, origin="upper", extent=[LON_MIN, LON_MAX, LAT_MIN, LAT_MAX],
              transform=ccrs.PlateCarree(), zorder=1, interpolation="lanczos")
    add_vector_overlays(ax, resolution="10m", include_rivers=True)
    save_figure(fig, os.path.join(OUTPUT_DIR, "central_europe_detail.png"), DPI)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    generate_europe_overview()
    generate_central_europe_detail()
    print("\nAll maps generated successfully.")
