import { create } from 'zustand'

interface MapSettingsState {
  /** true = satellite imagery (only active at zoom ≥ 12) */
  satelliteMode: boolean
  setSatelliteMode: (v: boolean) => void

  /** light-pollution overlay on/off */
  lpVisible: boolean
  setLpVisible: (v: boolean) => void

  /** LP overlay opacity, 0–1 (UI exposes 10–90 % in 5 % steps) */
  lpOpacity: number
  setLpOpacity: (v: number) => void

  /**
   * Precipitation-radar overlay on/off.
   * Powered by RainViewer radar composites — free, no API key required.
   * Tiles auto-refresh every 5 minutes to stay current.
   */
  cloudVisible: boolean
  setCloudVisible: (v: boolean) => void

  /** Radar overlay opacity, 0–1 (UI exposes 10–90 % in 5 % steps) */
  cloudOpacity: number
  setCloudOpacity: (v: number) => void

  /**
   * Clear-sky probability overlay (ERA5 / Copernicus, weekly climatology).
   * Shows statistical probability of clear sky for the current App Time week.
   * Tiles pre-converted from GeoTIFF to RGBA PNG via scripts/convert_cloudcover.py.
   */
  clearSkyVisible: boolean
  setClearSkyVisible: (v: boolean) => void

  /** Clear-sky overlay opacity, 0–1 */
  clearSkyOpacity: number
  setClearSkyOpacity: (v: number) => void
}

export const useMapSettings = create<MapSettingsState>()((set) => ({
  satelliteMode:    false,
  setSatelliteMode: (satelliteMode) => set({ satelliteMode }),

  lpVisible:    false,
  setLpVisible: (lpVisible) => set({ lpVisible }),

  lpOpacity:    0.4,
  setLpOpacity: (lpOpacity) => set({ lpOpacity }),

  cloudVisible:    false,
  setCloudVisible: (cloudVisible) => set({ cloudVisible }),

  cloudOpacity:    0.7,
  setCloudOpacity: (cloudOpacity) => set({ cloudOpacity }),

  clearSkyVisible:    false,
  setClearSkyVisible: (clearSkyVisible) => set({ clearSkyVisible }),

  clearSkyOpacity:    0.7,
  setClearSkyOpacity: (clearSkyOpacity) => set({ clearSkyOpacity }),
}))
