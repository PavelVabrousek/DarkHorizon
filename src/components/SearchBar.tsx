import { useCallback, useEffect, useRef, useState } from 'react'

const PHOTON_URL  = 'https://photon.komoot.io/api/'
const DEBOUNCE_MS = 350
const MAX_RESULTS = 6

// ── Photon API types ───────────────────────────────────────────────────────────

interface PhotonProperties {
  name?:      string
  city?:      string
  county?:    string
  state?:     string
  country?:   string
  type?:      string
  osm_key?:   string
  osm_value?: string
  extent?:    [number, number, number, number] // [west, north, east, south]
}

interface PhotonFeature {
  geometry:   { coordinates: [number, number] }  // [lng, lat]
  properties: PhotonProperties
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface SearchSelectPayload {
  lat:    number
  lng:    number
  extent?: [number, number, number, number]
}

interface SearchBarProps {
  onSelect: (payload: SearchSelectPayload) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a human-readable label from Photon properties, removing duplicates. */
function buildLabel(p: PhotonProperties): string {
  const parts: string[] = []
  const seen = new Set<string>()
  for (const v of [p.name, p.city, p.county, p.state, p.country]) {
    if (v && !seen.has(v)) { seen.add(v); parts.push(v) }
  }
  return parts.slice(0, 3).join(', ') || '—'
}

/** Return a short type hint (e.g. "city", "peak", "street") for the result row. */
function buildTypeHint(p: PhotonProperties): string {
  return p.osm_value ?? p.type ?? ''
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 flex-shrink-0 text-night-400" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-night-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeDasharray="42 14" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="3" x2="3"  y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="mt-0.5 h-3 w-3 flex-shrink-0 text-indigo-400" aria-hidden="true">
      <path d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5S12.5 9.75 12.5 6C12.5 3.51 10.49 1.5 8 1.5z"
        stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6" r="1.5" fill="currentColor" />
    </svg>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function SearchBar({ onSelect }: SearchBarProps) {
  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState<PhotonFeature[]>([])
  const [open,      setOpen]      = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside the widget
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const runSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (!q.trim()) { setResults([]); setOpen(false); return }

    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const res  = await fetch(
          `${PHOTON_URL}?q=${encodeURIComponent(q)}&limit=${MAX_RESULTS}`,
          { signal: ctrl.signal },
        )
        const json = await res.json() as { features: PhotonFeature[] }
        setResults(json.features ?? [])
        setOpen(true)
        setActiveIdx(-1)
      } catch {
        // Aborted or network error – silently ignore
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    runSearch(v)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && activeIdx >= 0) selectResult(results[activeIdx])
  }

  function selectResult(f: PhotonFeature) {
    const [lng, lat] = f.geometry.coordinates
    setQuery(buildLabel(f.properties))
    setOpen(false)
    onSelect({ lat, lng, extent: f.properties.extent })
  }

  function clearQuery() {
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.focus()
  }

  const showDropdown = open && query.trim().length > 0

  return (
    <div ref={wrapRef} className="relative w-72">

      {/* ── Input pill ── */}
      <div className={[
        'flex items-center gap-2 rounded-full border px-3 py-1.5 backdrop-blur-sm',
        'bg-night-900/90 transition-colors duration-150',
        open
          ? 'border-indigo-500/70'
          : 'border-night-600 focus-within:border-indigo-500/70',
      ].join(' ')}>
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search location…"
          className="flex-1 bg-transparent text-xs text-night-100 placeholder-night-500 outline-none"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search for a location"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
        />
        {loading  && <SpinnerIcon />}
        {!loading && query && (
          <button
            onClick={clearQuery}
            className="text-night-500 transition-colors hover:text-night-300"
            aria-label="Clear search"
            tabIndex={-1}
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {/* ── Dropdown ── */}
      {showDropdown && (
        <ul
          className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-night-700 bg-night-900/95 shadow-2xl backdrop-blur-sm"
          role="listbox"
        >
          {results.length > 0
            ? results.map((f, i) => {
                const label = buildLabel(f.properties)
                const hint  = buildTypeHint(f.properties)
                return (
                  <li key={i} role="option" aria-selected={i === activeIdx}>
                    <button
                      onPointerDown={(e) => { e.preventDefault(); selectResult(f) }}
                      onMouseEnter={() => setActiveIdx(i)}
                      className={[
                        'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors duration-100',
                        i === activeIdx
                          ? 'bg-night-800 text-night-100'
                          : 'text-night-200 hover:bg-night-800 hover:text-night-100',
                        i > 0 ? 'border-t border-night-800' : '',
                      ].join(' ')}
                    >
                      <PinIcon />
                      <span className="flex-1 leading-tight">{label}</span>
                      {hint && (
                        <span className="flex-shrink-0 text-[10px] text-night-500">{hint}</span>
                      )}
                    </button>
                  </li>
                )
              })
            : (
              <li className="px-3 py-2 text-xs text-night-500">
                No results found.
              </li>
            )
          }
        </ul>
      )}
    </div>
  )
}
