import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Location } from '../types/location'

/**
 * Fetches all public locations from Supabase.
 * Results are cached for 5 minutes via React Query.
 */
export function useLocations() {
  return useQuery<Location[], Error>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('name')

      if (error) throw new Error(error.message)
      return data as Location[]
    },
    staleTime: 5 * 60 * 1000,
  })
}
