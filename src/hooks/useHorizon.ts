import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { HorizonProfile } from '../types/location'

/**
 * Fetches the horizon profile (JSON) for a specific location.
 * Cached to avoid re-fetching heavy JSON during the session.
 */
export function useHorizon(locationId: string) {
  return useQuery<HorizonProfile | null, Error>({
    queryKey: ['horizon', locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select('horizon_profile')
        .eq('id', locationId)
        .single()

      if (error) throw new Error(error.message)
      return (data as unknown as { horizon_profile: unknown })?.horizon_profile as unknown as HorizonProfile || null
    },
    staleTime: 60 * 60 * 1000, // 1 hour (terrain doesn't change)
    enabled: !!locationId,
  })
}
