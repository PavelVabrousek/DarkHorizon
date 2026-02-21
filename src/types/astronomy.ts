/** Civil / nautical / astronomical twilight types */
export type TwilightType =
  | 'day'
  | 'civil_twilight'
  | 'nautical_twilight'
  | 'astronomical_twilight'
  | 'night'

/** Moon phase names */
export type MoonPhaseName =
  | 'new_moon'
  | 'waxing_crescent'
  | 'first_quarter'
  | 'waxing_gibbous'
  | 'full_moon'
  | 'waning_gibbous'
  | 'last_quarter'
  | 'waning_crescent'

/** Hourly Sun/Moon position cache – mirrors the `sunmoon_cache` table */
export interface SunMoonCache {
  id: string
  location_id: string
  forecast_time: string
  computed_at: string

  /* Sun */
  sun_azimuth: number
  sun_elevation: number
  sun_twilight_type: TwilightType

  /* Moon */
  moon_azimuth: number
  moon_elevation: number

  /** 0–100 (0 = new moon, 100 = full moon) */
  moon_illumination_pct: number

  /** 0–100 representing position in the lunar cycle */
  moon_phase_pct: number

  /** Composite darkness score 0–100 */
  darkness_score: number
}

/** Scoring weights for darkness_score calculation */
export const DARKNESS_SCORE_WEIGHTS = {
  sun_position: 0.70,
  moon: 0.30,
} as const

/** User observation log – mirrors the `observations` table */
export interface Observation {
  id: string
  user_id: string
  location_id: string
  observed_at: string

  /** Sky Quality Meter reading from processed photo (mag/arcsec²) */
  actual_sqm: number | null

  notes: string | null
  image_path: string | null

  weather_score_actual: number | null
  darkness_score_actual: number | null

  created_at: string
}

/** Final composite score weights */
export const FINAL_SCORE_WEIGHTS = {
  weather: 0.50,
  darkness: 0.30,
  clima: 0.20,
} as const

/** Compute the final score from component scores */
export function computeFinalScore(
  weatherScore: number,
  darknessScore: number,
  climaScore: number,
): number {
  return (
    weatherScore * FINAL_SCORE_WEIGHTS.weather +
    darknessScore * FINAL_SCORE_WEIGHTS.darkness +
    climaScore * FINAL_SCORE_WEIGHTS.clima
  )
}
