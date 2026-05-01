import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LocationMarkerRow } from '../types/location'

export interface LocationBounds {
  south: number
  west: number
  north: number
  east: number
}

const LOCATION_MARKER_COLUMNS = 'id, name, description, latitude, longitude, elevation_m, bortle_class, is_public, created_at, updated_at'

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Fetches all public locations from Supabase.
 * Results are cached for 5 minutes via React Query.
 *
 * B6: Only the columns actually rendered by LocationMarkers are selected,
 * avoiding over-fetching horizon_profile (large JSON) and unused cache columns.
 */
export function useLocations(bounds?: LocationBounds | null) {
  return useQuery<LocationMarkerRow[], Error>({
    queryKey: ['locations', bounds?.south, bounds?.west, bounds?.north, bounds?.east],
    queryFn: async () => {
      let query = supabase
        .from('locations')
        .select(LOCATION_MARKER_COLUMNS)
        .order('name')

      if (bounds) {
        query = query
          .gte('latitude', bounds.south)
          .lte('latitude', bounds.north)
          .gte('longitude', bounds.west)
          .lte('longitude', bounds.east)
      }

      const { data, error } = await query

      if (error) throw new Error(error.message)
      return data as LocationMarkerRow[]
    },
    staleTime: 5 * 60 * 1000,
  })
}

export async function fetchNearestLocation(lat: number, lng: number): Promise<LocationMarkerRow | null> {
  const { data, error } = await supabase
    .from('locations')
    .select(LOCATION_MARKER_COLUMNS)

  if (error) throw new Error(error.message)
  const locations = data as LocationMarkerRow[] | null
  if (!locations?.length) return null

  return locations.reduce((best, loc) => {
    const bestDistance = distanceKm(lat, lng, best.latitude, best.longitude)
    const locDistance = distanceKm(lat, lng, loc.latitude, loc.longitude)
    return locDistance < bestDistance ? loc : best
  }, locations[0])
}
