/**
 * Open-Meteo API client
 * https://open-meteo.com/en/docs
 */

export const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1'

export interface OpenMeteoParams {
  latitude: number
  longitude: number
  hourly: string[]
  forecast_days?: number
  timezone?: string
}

export async function fetchWeatherForecast(params: OpenMeteoParams) {
  const url = new URL(`${OPEN_METEO_BASE_URL}/forecast`)
  url.searchParams.set('latitude', String(params.latitude))
  url.searchParams.set('longitude', String(params.longitude))
  url.searchParams.set('hourly', params.hourly.join(','))
  url.searchParams.set('forecast_days', String(params.forecast_days ?? 7))
  url.searchParams.set('timezone', params.timezone ?? 'auto')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

// ── Meteogram (10-day hourly forecast, ECMWF IFS 0.25°) ──────────────────────

export interface MeteogramHourly {
  time:           string[]   // "YYYY-MM-DDTHH:MM" UTC
  cloudcover:     number[]   // 0-100 %
  temperature_2m: number[]   // °C
  windspeed_10m:  number[]   // m/s
  precipitation:  number[]   // mm/h
}

export interface MeteogramDaily {
  time:    string[]   // "YYYY-MM-DD"
  sunrise: string[]   // ISO UTC datetime
  sunset:  string[]   // ISO UTC datetime
}

export interface MeteogramApiResponse {
  hourly:              MeteogramHourly
  daily:               MeteogramDaily
  /** Signed offset from UTC in seconds (e.g. 7200 for UTC+2). Provided by Open-Meteo. */
  utc_offset_seconds:  number
}

/**
 * Fetch 11 days of hourly forecast data from the ECMWF IFS 0.25° model.
 * Returns time series in UTC so the caller can do local time conversion.
 * (rows start at noon UTC, so 10 display days need noon-to-noon coverage
 *  which requires the 11th day's morning hours — 10 days would truncate the last row)
 */
export async function fetchMeteogramData(
  lat: number,
  lon: number,
): Promise<MeteogramApiResponse> {
  const url = new URL(`${OPEN_METEO_BASE_URL}/forecast`)
  url.searchParams.set('latitude',      lat.toFixed(4))
  url.searchParams.set('longitude',     lon.toFixed(4))
  url.searchParams.set('hourly',        'cloudcover,temperature_2m,windspeed_10m,precipitation')
  url.searchParams.set('daily',         'sunrise,sunset')
  url.searchParams.set('models',        'ecmwf_ifs025')
  url.searchParams.set('forecast_days', '11')
  url.searchParams.set('timezone',      'auto')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Open-Meteo meteogram error: ${response.status} ${response.statusText}`)
  }
  return response.json() as Promise<MeteogramApiResponse>
}

// ── Elevation ─────────────────────────────────────────────────────────────────

/**
 * A1: Elevation lookup via the Open-Meteo elevation API.
 * Returns the terrain elevation in metres (rounded to integer), or null if the
 * response is outside valid bounds or the request fails.
 *
 * @param lat     WGS-84 latitude  (-90 … 90)
 * @param lng     WGS-84 longitude (-180 … 180)
 * @param signal  Optional AbortSignal to cancel an in-flight request
 */
export async function fetchElevation(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<number | null> {
  const url = new URL(`${OPEN_METEO_BASE_URL}/elevation`)
  url.searchParams.set('latitude',  lat.toFixed(4))
  url.searchParams.set('longitude', lng.toFixed(4))

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) {
    throw new Error(`Open-Meteo elevation error: ${response.status} ${response.statusText}`)
  }
  const json = await response.json() as { elevation?: number[] }
  return typeof json.elevation?.[0] === 'number' ? Math.round(json.elevation[0]) : null
}
