import { useMapSettings } from '../store/mapSettings'

// Minimum zoom level at which the Street View button is shown
const STREETVIEW_ZOOM_THRESHOLD = 15

// ── Icons ─────────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true" className="h-2.5 w-2.5">
      <path
        d="M1.5 5 L3.8 7.5 L8.5 2.5"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Pegman-style icon matching Google Maps Street View symbol */
function StreetViewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      {/* Head */}
      <circle cx="8" cy="3.5" r="2" fill="currentColor" />
      {/* Body */}
      <line x1="8" y1="5.5" x2="8" y2="10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Arms */}
      <line x1="5.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Legs */}
      <line x1="8" y1="10" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="10" x2="10" y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ── Checkbox row ──────────────────────────────────────────────────────────────

interface CheckRowProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  icon?: React.ReactNode
}

function CheckRow({ checked, onChange, label, icon }: CheckRowProps) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-night-200 hover:text-night-100">
      {/* Hidden native checkbox – keeps the label/input relationship for a11y */}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />

      {/* Custom visual checkbox */}
      <span
        aria-hidden="true"
        className={[
          'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center',
          'rounded border transition-colors duration-150',
          checked
            ? 'border-indigo-400 bg-indigo-500'
            : 'border-night-500 bg-transparent',
        ].join(' ')}
      >
        {checked && <CheckIcon />}
      </span>

      {icon}
      <span>{label}</span>
    </label>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MapControlsProps {
  zoom:   number
  center: { lat: number; lng: number }
}

/**
 * Layers HUD panel — positioned by the parent (MapView) inside a shared
 * bottom-anchored flex row so its top edge stays aligned with the Site Score box.
 * Each layer is a checkbox row; when checked the layer is visible.
 * LP also exposes an opacity slider when active.
 * When zoom ≥ 15, a Street View button appears that opens Google Maps
 * Street View in a new browser tab centred on the current map view.
 */
export default function MapControls({ zoom, center }: MapControlsProps) {
  const { lpVisible, setLpVisible, lpOpacity, setLpOpacity } = useMapSettings()

  const pct = Math.round(lpOpacity * 100)
  const canStreetView = zoom >= STREETVIEW_ZOOM_THRESHOLD

  function openStreetView() {
    const lat = center.lat.toFixed(6)
    const lng = center.lng.toFixed(6)
    const url = `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="pointer-events-auto flex min-w-[172px] flex-col gap-2.5 rounded-lg border border-night-700 bg-night-900/85 px-3 py-2.5 text-xs backdrop-blur-sm">

      {/* ── Header ── */}
      <span className="font-semibold tracking-wide text-night-100">Layers</span>

      {/* ── Light-pollution checkbox ── */}
      <CheckRow
        checked={lpVisible}
        onChange={setLpVisible}
        label="Light pollution"
      />

      {/* ── Opacity slider – shown only when LP is checked ── */}
      {lpVisible && (
        <div className="flex items-center gap-2 pl-5 text-night-400">
          <span className="w-7 text-right tabular-nums text-night-300">{pct}%</span>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={pct}
            onChange={(e) => setLpOpacity(Number(e.target.value) / 100)}
            title="Adjust light-pollution opacity"
            className="h-1.5 w-20 cursor-pointer accent-indigo-400"
          />
        </div>
      )}

      {/* ── Street View button – visible only at zoom ≥ 15 ── */}
      {canStreetView && (
        <>
          <hr className="border-night-700" />
          <button
            onClick={openStreetView}
            className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-night-300 transition-colors duration-150 hover:bg-night-800 hover:text-night-100"
            title="Open Google Street View at map centre"
          >
            <StreetViewIcon />
            <span>Street View</span>
          </button>
        </>
      )}
    </div>
  )
}
