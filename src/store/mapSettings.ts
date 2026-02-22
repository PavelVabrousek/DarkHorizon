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
}

export const useMapSettings = create<MapSettingsState>()((set) => ({
  satelliteMode:    false,
  setSatelliteMode: (satelliteMode) => set({ satelliteMode }),

  lpVisible:    false,
  setLpVisible: (lpVisible) => set({ lpVisible }),

  lpOpacity:    0.4,
  setLpOpacity: (lpOpacity) => set({ lpOpacity }),
}))
