/** A single segment of the local horizon profile (azimuth → minimum elevation) */
export interface HorizonSegment {
  azimuth: number
  min_elevation: number
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
  horizon_profile: HorizonSegment[] | null
  is_public: boolean
  created_at: string
  updated_at: string
}

/** Per-user settings – mirrors the `user_preferences` table */
export interface UserPreferences {
  id: string
  user_id: string
  home_latitude: number | null
  home_longitude: number | null
  max_distance_km: number
  min_weather_score: number
  min_darkness_score: number
  preferred_bortle_max: number
  created_at: string
  updated_at: string
}

/** Scored location ready for map rendering */
export interface ScoredLocation extends Location {
  weather_score: number | null
  darkness_score: number | null
  clima_score: number | null
  final_score: number | null
}

export type ScoreColor = 'green' | 'yellow' | 'red' | 'unknown'

export function getScoreColor(score: number | null): ScoreColor {
  if (score === null) return 'unknown'
  if (score >= 70) return 'green'
  if (score >= 40) return 'yellow'
  return 'red'
}
