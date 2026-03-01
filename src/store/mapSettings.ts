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
   * IR satellite cloud overlay on/off.
   * Powered by NASA GIBS GOES-East Band 13 infrared — free, no API key required.
   * Shows all cloud types (not just precipitating); tiles lag ~50 min.
   * Tiles auto-refresh every 10 minutes.
   */
  satIrVisible: boolean
  setSatIrVisible: (v: boolean) => void

  /** IR satellite overlay opacity, 0–1 (UI exposes 10–90 % in 5 % steps) */
  satIrOpacity: number
  setSatIrOpacity: (v: number) => void

  /**
   * OWM Weather Maps 2.0 cloud-coverage forecast overlay on/off.
   * Requires VITE_OWM_API_KEY. Shows forecast cloud cover for a chosen
   * Unix timestamp (default = next local midnight at the map centre).
   * Phase 2 will expose a ±7-day slider; for now the timestamp is
   * auto-computed when the layer is first enabled.
   */
  forecastVisible: boolean
  setForecastVisible: (v: boolean) => void

  /** Forecast overlay opacity, 0–1 (UI exposes 10–90 % in 5 % steps) */
  forecastOpacity: number
  setForecastOpacity: (v: number) => void

  /**
   * Unix timestamp (seconds UTC) for which the OWM forecast tile is shown.
   * 0 = not yet set (auto-compute on first enable).
   */
  forecastTimestamp: number
  setForecastTimestamp: (v: number) => void
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

  satIrVisible:    false,
  setSatIrVisible: (satIrVisible) => set({ satIrVisible }),

  satIrOpacity:    0.75,
  setSatIrOpacity: (satIrOpacity) => set({ satIrOpacity }),

  forecastVisible:      false,
  setForecastVisible:   (forecastVisible)   => set({ forecastVisible }),

  forecastOpacity:      0.7,
  setForecastOpacity:   (forecastOpacity)   => set({ forecastOpacity }),

  forecastTimestamp:    0,                   // 0 = auto-compute on first enable
  setForecastTimestamp: (forecastTimestamp) => set({ forecastTimestamp }),
}))
