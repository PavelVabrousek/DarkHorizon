import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * B4: isSupabaseConfigured lets App.tsx render a user-friendly error screen
 * instead of crashing the entire app with a module-level throw.
 *
 * A module-level `throw` crashes during JS evaluation, before React mounts
 * any ErrorBoundary, resulting in an invisible blank screen with no feedback.
 * Exporting a flag and handling it at render time is far more user-friendly.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.error(
    '[DarkHorizon] Missing Supabase environment variables. ' +
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.',
  )
}

// Always create the client — it will fail gracefully (401/network error) on
// first request when credentials are absent rather than crashing at startup.
export const supabase = createClient<Database>(
  supabaseUrl  ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      persistSession:   true,
      autoRefreshToken: true,
    },
  },
)
