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
