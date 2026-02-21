/** Hourly weather forecast record – mirrors the `weather_cache` table */
export interface WeatherCache {
  id: string
  location_id: string
  forecast_time: string
  fetched_at: string

  cloud_cover_pct: number
  precipitation_mm: number
  wind_speed_ms: number
  temperature_c: number
  humidity_pct: number

  /** Atmospheric seeing quality (0–5 scale, computed from stability indices) */
  seeing_score: number | null

  /** Composite weather score 0–100 */
  weather_score: number
}

/** Long-term climate statistics – mirrors the `clima_stat` table */
export interface ClimaStat {
  id: string
  location_id: string

  /** Day of year (1–366) */
  day_of_year: number

  /** Hour of day in UTC (0–23) */
  hour_of_day: number

  cloud_cover_avg: number
  clear_sky_probability: number
  precipitation_prob: number
  wind_speed_avg_ms: number

  /** Composite climate score 0–100 */
  clima_score: number

  /** Number of historical samples used */
  sample_count: number

  updated_at: string
}

/** Scoring weights for weather_score calculation */
export const WEATHER_SCORE_WEIGHTS = {
  cloud_cover: 0.60,
  precipitation: 0.25,
  stability: 0.15,
} as const

/** Scoring weights for clima_score calculation */
export const CLIMA_SCORE_WEIGHTS = {
  clear_sky_probability: 0.70,
  precipitation: 0.20,
  wind: 0.10,
} as const
