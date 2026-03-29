import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LpSample } from '../utils/lpSampler'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert the LP sampler's fine-grained scale string (e.g. "2b", "0", "7a")
 * to the integer Bortle class (1–9) expected by the `locations` table.
 *   "0"         → 1  (exceptional dark sky)
 *   "1a" / "1b" → 1
 *   "2a" / "2b" → 2  …etc.
 *   "7a" / "7b" → 7
 */
function scaleToBortleClass(scale: string): number {
  if (scale === '0') return 1
  const n = parseInt(scale.charAt(0), 10)
  return isNaN(n) ? 5 : Math.min(Math.max(n, 1), 9)
}

/** Display a lat/lng as "50.1234° N · 14.5678° E" */
function formatCoord(lat: number, lng: number): string {
  return (
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}` +
    `  ·  ` +
    `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SaveLocationModalProps {
  lat: number
  lng: number
  elevation: number | null
  lpIndex: LpSample | null
  onClose: () => void
  onSaved: () => void
}

export default function SaveLocationModal({
  lat, lng, elevation, lpIndex, onClose, onSaved,
}: SaveLocationModalProps) {
  const queryClient = useQueryClient()

  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [saved,       setSaved]       = useState(false)

  const bortleClass = lpIndex ? scaleToBortleClass(lpIndex.scale) : 5

  async function handleSave() {
    if (!name.trim()) {
      setError('Location name is required.')
      return
    }

    setLoading(true)
    setError(null)

    // The Database type is hand-written (not generated), so the SDK's strict
    // Insert generic resolves to `never`. We cast to `unknown` first to
    // satisfy TypeScript while keeping the object structure explicit.
    const payload = {
      name:            name.trim(),
      description:     description.trim() || null,
      latitude:        lat,
      longitude:       lng,
      elevation_m:     elevation ?? 0,
      bortle_class:    bortleClass,
      is_public:       true,
      user_id:         null,
      horizon_profile: null,
    }
    const { error: dbError } = await supabase
      .from('locations')
      .insert(payload as unknown as never)

    setLoading(false)

    if (dbError) {
      console.error('SaveLocation: insert failed:', dbError)
      // Show the actual Supabase error so the user (and developer) can diagnose
      // RLS violations, missing columns, type mismatches, etc.
      setError(dbError.message)
      return
    }

    // Invalidate the locations cache so the new marker appears immediately
    queryClient.invalidateQueries({ queryKey: ['locations'] })
    setSaved(true)

    // Close after a brief success flash
    setTimeout(onSaved, 900)
  }

  // ── Success state ──────────────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-night-700 bg-night-950 px-8 py-6 shadow-2xl">
          <svg className="h-8 w-8 text-score-green" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 12.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-night-100">Location saved!</span>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative mx-4 w-full max-w-md rounded-xl border border-night-700 bg-night-950/98 p-6 shadow-2xl backdrop-blur-xl">

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-night-500 transition-colors hover:bg-night-800 hover:text-night-200"
          aria-label="Close"
          title="Close without saving"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="mb-5 pr-6">
          <h2 className="text-base font-bold text-night-100">Save Location</h2>
          <p className="mt-0.5 text-xs text-night-500">New observation site at the current map centre</p>
        </div>

        {/* Read-only site info */}
        <div className="mb-5 rounded-lg border border-night-800 bg-night-900/60 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-4 text-night-300">
            <span className="text-night-500">Coordinates</span>
            <span className="font-mono">{formatCoord(lat, lng)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-night-800 pt-1.5 text-night-300">
            <span className="text-night-500">Elevation</span>
            <span className="font-mono">
              {elevation !== null ? `${elevation} m a.s.l.` : '—'}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-night-800 pt-1.5 text-night-300">
            <span className="text-night-500">Sky quality</span>
            <span className="font-mono">
              {lpIndex
                ? `Bortle ${bortleClass} · ${lpIndex.name}`
                : '—'}
            </span>
          </div>
        </div>

        {/* Name input */}
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-night-300">
            Location name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(null) }}
            placeholder="e.g. Dark Forest Hill"
            maxLength={80}
            className={[
              'w-full rounded-lg border bg-night-900 px-3 py-2 text-sm text-night-100',
              'placeholder-night-600 outline-none transition-colors',
              error && !name.trim()
                ? 'border-red-500/70 focus:border-red-400'
                : 'border-night-700 focus:border-indigo-500/70',
            ].join(' ')}
            autoFocus
          />
        </div>

        {/* Description textarea */}
        <div className="mb-5">
          <label className="mb-1 block text-xs font-medium text-night-300">
            Notes <span className="text-night-600">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Access, conditions, points of interest…"
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-night-700 bg-night-900 px-3 py-2 text-sm text-night-100 placeholder-night-600 outline-none transition-colors focus:border-indigo-500/70"
          />
        </div>

        {/* Error message — shows actual Supabase error for easy debugging */}
        {error && (
          <p className="mb-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-400 break-words">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-night-700 bg-night-900 px-4 py-2 text-xs text-night-300 transition-colors hover:bg-night-800 hover:text-night-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className={[
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-colors',
              loading
                ? 'cursor-wait border border-indigo-700 bg-indigo-900 text-indigo-400'
                : 'border border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500',
            ].join(' ')}
          >
            {loading ? (
              <>
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5"
                    strokeDasharray="42 14" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5S12.5 9.75 12.5 6C12.5 3.51 10.49 1.5 8 1.5z"
                    stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="8" cy="6" r="1.5" fill="currentColor" />
                </svg>
                Save
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  )
}
