"""
generate_climatic_atlas.py
─────────────────────────
Processes global ERA5 cloud cover NetCDF files (2016-2025) and packs them into 
a single high-performance binary atlas for random-access retrieval.

Output Format: climatic_atlas.bin (Raw Bytes)
  - Layout:  Latitude (721) x Longitude (1440) x Week (52) x Parameters (4)
  - Total Points: 1,038,240
  - Payload per Point: 208 bytes (52 weeks * 4 parameters)
  - Parameters (uint8, 0-255): 
      0: MeanCloudCover
      1: MinYearMeanCloud
      2: MaxYearMeanCloud
      3: ClearSkyProbability (TCC < 0.2)
  - Total Size: ~216 MB

Usage:
    python scripts/generate_climatic_atlas.py
"""

import os
import glob
import numpy as np
import xarray as xr
import pandas as pd
from tqdm import tqdm

# ── Configuration ─────────────────────────────────────────────────────────────
DATA_DIR = r"C:\Data\ERA5\GlobalYearlyCloudCover"
OUTPUT_FILE_PREFIX = "public/climatic_atlas"
CSV_FILE = "public/climatic_climatology_sample.csv"

# Supabase Free Tier 50MB file limit. 216MB total / 5 = ~43.2MB per file.
N_PARTS = 5

# ERA5 0.25 deg grid dimensions
NLAT, NLON = 721, 1440
NWEEKS = 52

def main():
    files = sorted(glob.glob(os.path.join(DATA_DIR, "*_clouds.nc")))
    if not files:
        print(f"No NetCDF files found in {DATA_DIR}")
        return

    print(f"Processing {len(files)} years of global cloud data...")

    # We need to accumulate stats across years. 
    # To save memory, we'll store sums and min/max in float32 arrays
    # shape: (NWEEKS, NLAT, NLON)
    sum_tcc = np.zeros((NWEEKS, NLAT, NLON), dtype=np.float32)
    sum_prob = np.zeros((NWEEKS, NLAT, NLON), dtype=np.float32)
    min_tcc = np.full((NWEEKS, NLAT, NLON), 1.0, dtype=np.float32)
    max_tcc = np.zeros((NWEEKS, NLAT, NLON), dtype=np.float32)
    year_count = 0

    for f in tqdm(files, desc="Years"):
        ds = xr.open_dataset(f)
        
        # 1. Resample to ISO Week
        # Note: We compute clear sky mask (TCC < 0.2) before averaging
        is_clear = (ds.tcc < 0.2).astype(np.float32)
        
        # Group by week
        # ISO week can be 1-53, we'll clamp to 1-52 for the atlas
        weeks = ds.valid_time.dt.isocalendar().week.values
        unique_weeks = np.unique(weeks)
        
        for w in unique_weeks:
            if w > 52: continue # Simplified for atlas
            idx = w - 1
            
            # Extract data for this week
            mask = (weeks == w)
            week_tcc = ds.tcc.values[mask].mean(axis=0)
            week_prob = is_clear.values[mask].mean(axis=0)
            
            # Accumulate
            sum_tcc[idx] += week_tcc
            sum_prob[idx] += week_prob
            min_tcc[idx] = np.minimum(min_tcc[idx], week_tcc)
            max_tcc[idx] = np.maximum(max_tcc[idx], week_tcc)
            
        ds.close()
        year_count += 1

    print("\nComputing final averages and packing binary atlas...")
    
    # Calculate means
    mean_tcc = sum_tcc / year_count
    mean_prob = sum_prob / year_count
    
    # Map all to uint8 (0-255)
    # Clamp to 0-1 just in case of float precision issues
    mean_tcc_u8 = (np.clip(mean_tcc, 0, 1) * 255).astype(np.uint8)
    min_tcc_u8 = (np.clip(min_tcc, 0, 1) * 255).astype(np.uint8)
    max_tcc_u8 = (np.clip(max_tcc, 0, 1) * 255).astype(np.uint8)
    prob_u8 = (np.clip(mean_prob, 0, 1) * 255).astype(np.uint8)

    # ── Packing ──
    # Desired layout: [Lat, Lon, Week, Param]
    # Current shape: (Week, Lat, Lon)
    # We'll stack parameters as the last dimension
    # (Week, Lat, Lon, 4)
    packed = np.stack([mean_tcc_u8, min_tcc_u8, max_tcc_u8, prob_u8], axis=-1)
    
    # Transpose to (Lat, Lon, Week, 4) for optimal geographic locality
    # This makes fetching all 52 weeks for one (Lat,Lon) a contiguous read!
    final_atlas = packed.transpose(1, 2, 0, 3)
    
    print(f"Final Atlas Shape: {final_atlas.shape}")
    
    # ── Split and Save ──
    # We divide the NLAT (721) into N_PARTS
    lats_per_part = int(np.ceil(NLAT / N_PARTS))
    
    for p in range(N_PARTS):
        start_lat = p * lats_per_part
        end_lat = min((p + 1) * lats_per_part, NLAT)
        
        part_data = final_atlas[start_lat:end_lat]
        part_filename = f"{OUTPUT_FILE_PREFIX}_part{p+1}.bin"
        
        print(f"Writing Part {p+1} (Rows {start_lat}-{end_lat}) to {part_filename}...")
        with open(part_filename, "wb") as bf:
            part_data.tofile(bf)
            
        size_mb = os.path.getsize(part_filename) / (1024*1024)
        print(f"  Saved: {size_mb:.1f} MB")

    print(f"\nAll parts generated successfully.")

    # ── CSV Output ──
    print(f"Generating CSV summary for validation...")
    
    # We'll export a sample of points to CSV (e.g. every 10th degree)
    # or just the first few weeks for all points if requested.
    # To keep the CSV manageable, we'll iterate and write.
    
    lats = np.linspace(90, -90, NLAT)
    lons = np.linspace(0, 359.75, NLON)
    
    csv_data = []
    # Progress for CSV generation
    for i in tqdm(range(0, NLAT, 20), desc="CSV Lats"): # Sampling every 5 degrees for CSV
        lat = lats[i]
        for j in range(0, NLON, 20):
            lon = lons[j]
            for w in range(NWEEKS):
                row = final_atlas[i, j, w]
                csv_data.append({
                    'Lat': round(lat, 2),
                    'Lon': round(lon, 2),
                    'Week': w + 1,
                    'MeanCloudCover': round(row[0] / 255.0, 3),
                    'MinCloudCover': round(row[1] / 255.0, 3),
                    'MaxCloudCover': round(row[2] / 255.0, 3),
                    'ClearSkyProb': round(row[3] / 255.0, 3)
                })
    
    df_csv = pd.DataFrame(csv_data)
    df_csv.to_csv(CSV_FILE, index=False)
    print(f"Saved CSV sample to {CSV_FILE}")

if __name__ == "__main__":
    main()
