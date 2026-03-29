import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Location } from '../types/location'

/**
 * Fetches all public locations from Supabase.
 * Results are cached for 5 minutes via React Query.
 *
 * B6: Only the columns actually rendered by LocationMarkers are selected,
 * avoiding over-fetching horizon_profile (large JSON) and unused cache columns.
 */
export function useLocations() {
  return useQuery<Location[], Error>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('id, name, description, latitude, longitude, elevation_m, bortle_class, is_public, created_at, updated_at')
        .order('name')

      if (error) throw new Error(error.message)
      return data as Location[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
