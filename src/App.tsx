import MapView from './components/MapView'
import { isSupabaseConfigured } from './lib/supabase'

// B4: Render a friendly error screen when Supabase env vars are missing,
// instead of a blank page caused by a module-level throw in supabase.ts.
function ConfigError() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-night-950 px-6 text-center">
      <svg className="h-12 w-12 text-red-500" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2L2 20h20L12 2z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
        />
        <line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="12" cy="17" r="0.75" fill="currentColor" />
      </svg>
      <h1 className="text-lg font-semibold text-night-100">Configuration Error</h1>
      <p className="max-w-sm text-sm text-night-400">
        Supabase credentials are missing. Copy <code className="rounded bg-night-800 px-1 font-mono text-night-200">.env.example</code> to{' '}
        <code className="rounded bg-night-800 px-1 font-mono text-night-200">.env</code> and fill in{' '}
        <code className="rounded bg-night-800 px-1 font-mono text-night-200">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-night-800 px-1 font-mono text-night-200">VITE_SUPABASE_ANON_KEY</code>.
      </p>
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigError />

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-night-950">
      <main className="flex-1 overflow-hidden">
        <MapView />
      </main>
    </div>
  )
}
