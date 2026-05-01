/** location.ts — Location domain types used across the DarkHorizon app. */

/** A single segment of the local horizon profile (azimuth → minimum elevation) */
export interface HorizonSegment {
  azimuth: number
  min_elevation: number
}

export interface HorizonPeak {
  name: string
  azimuth: number
  elevation_angle: number
  altitude_m: number | null
  distance_km: number
  above_horizon: boolean
  label_position: 'above' | 'below'
}

export interface HorizonProfile {
  segments: HorizonSegment[]
  peaks: HorizonPeak[]
  meta: {
    observer_lat: number
    observer_lon: number
    observer_elev_m: number
    radius_km: number
    step_deg: number
    dem_source: string
    peak_source: string
    computed_at: string
  }
}

/** Observation site – mirrors the `locations` table */
export interface Location {
  id: string
  user_id: string | null
  name: string
  description: string | null
  latitude: number
  longitude: number
  elevation_m: number
  bortle_class: number
  horizon_profile: HorizonProfile | null
  is_public: boolean
  created_at: string
  updated_at: string
}

/** Lightweight projection used by the map marker layer. */
export type LocationMarkerRow = Omit<Location, 'horizon_profile' | 'user_id'>


