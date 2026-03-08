import { create } from 'zustand'

interface TimeState {
  appTimeMs: number
  setAppTimeMs: (v: number) => void
  resetToNow: () => void
}

export const useTimeStore = create<TimeState>()((set) => ({
  appTimeMs: Date.now(),
  setAppTimeMs: (appTimeMs) => set({ appTimeMs }),
  resetToNow: () => set({ appTimeMs: Date.now() })
}))
