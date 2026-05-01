import { useState } from 'react'
import { useMapSettings } from '../store/mapSettings'

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

/** Three stacked diamond shapes — standard "layers" metaphor */
function LayersIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <path d="M2 5.5 L8 3 L14 5.5 L8 8 Z"   stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M2 8.5 L8 11 L14 8.5"          stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 11.5 L8 14 L14 11.5"        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Checkbox row ──────────────────────────────────────────────────────────────

interface CheckRowProps {
  checked:  boolean
  onChange: (v: boolean) => void
  label:    string
}

function CheckRow({ checked, onChange, label }: CheckRowProps) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-night-200 hover:text-night-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={[
          'flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center',
          'rounded border transition-colors duration-150',
          checked ? 'border-indigo-400 bg-indigo-500' : 'border-night-500 bg-transparent',
        ].join(' ')}
      >
        {checked && <CheckIcon />}
      </span>
      <span>{label}</span>
    </label>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Collapsible Layers HUD panel — light-pollution + cloud-coverage toggles with
 * per-layer opacity sliders.
 * Street View and other external links live in ExternalActions.
 */
export default function MapControls() {
  const lpVisible       = useMapSettings((s) => s.lpVisible)
  const setLpVisible    = useMapSettings((s) => s.setLpVisible)
  const lpOpacity       = useMapSettings((s) => s.lpOpacity)
  const setLpOpacity    = useMapSettings((s) => s.setLpOpacity)
  const cloudVisible    = useMapSettings((s) => s.cloudVisible)
  const setCloudVisible = useMapSettings((s) => s.setCloudVisible)
  const cloudOpacity    = useMapSettings((s) => s.cloudOpacity)
  const setCloudOpacity = useMapSettings((s) => s.setCloudOpacity)
  const clearSkyVisible = useMapSettings((s) => s.clearSkyVisible)
  const setClearSkyVisible = useMapSettings((s) => s.setClearSkyVisible)
  const clearSkyOpacity = useMapSettings((s) => s.clearSkyOpacity)
  const setClearSkyOpacity = useMapSettings((s) => s.setClearSkyOpacity)
  const [open, setOpen] = useState(false)

  const lpPct       = Math.round(lpOpacity       * 100)
  const cloudPct    = Math.round(cloudOpacity    * 100)
  const clearSkyPct = Math.round(clearSkyOpacity * 100)

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-night-700 bg-night-900/80 px-3 py-1.5 text-xs text-night-400 backdrop-blur-sm transition-colors duration-150 hover:border-night-600 hover:text-night-200"
        title="Open layer controls"
        aria-expanded={false}
      >
        <LayersIcon />
        <span>Layers</span>
      </button>
    )
  }

  // ── Expanded ───────────────────────────────────────────────────────────────
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">

      <button
        onClick={() => setOpen(false)}
        className="flex items-center gap-1.5 rounded-full border border-indigo-500/70 bg-night-900/90 px-3 py-1.5 text-xs text-night-100 backdrop-blur-sm transition-colors duration-150 hover:bg-night-800/90"
        title="Close layer controls"
        aria-expanded={true}
      >
        <LayersIcon />
        <span>Layers</span>
      </button>

      <div className="flex min-w-[172px] flex-col gap-2.5 rounded-lg border border-night-700 bg-night-900/85 px-3 py-2.5 text-xs backdrop-blur-sm">

        {/* ── Light pollution ── */}
        <CheckRow
          checked={lpVisible}
          onChange={setLpVisible}
          label="Light pollution"
        />

        {lpVisible && (
          <div className="flex items-center gap-2 pl-5 text-night-400">
            <span className="w-7 text-right tabular-nums text-night-300">{lpPct}%</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={lpPct}
              onChange={(e) => setLpOpacity(Number(e.target.value) / 100)}
              title="Adjust light-pollution opacity"
              className="h-1.5 w-20 cursor-pointer accent-indigo-400"
            />
          </div>
        )}

        {/* ── Clear-sky probability (ERA5 climatology, weekly PNG) ── */}
        <div className="border-t border-night-700/60 pt-2">
          <CheckRow
            checked={clearSkyVisible}
            onChange={setClearSkyVisible}
            label="Clear-sky clim."
          />
        </div>

        {clearSkyVisible && (
          <div className="flex items-center gap-2 pl-5 text-night-400">
            <span className="w-7 text-right tabular-nums text-night-300">{clearSkyPct}%</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={clearSkyPct}
              onChange={(e) => setClearSkyOpacity(Number(e.target.value) / 100)}
              title="Adjust clear-sky probability opacity"
              className="h-1.5 w-20 cursor-pointer accent-white"
            />
          </div>
        )}

        {/* ── Precipitation radar (RainViewer, ~5 min refresh) ── */}
        <div className="border-t border-night-700/60 pt-2">
          <CheckRow
            checked={cloudVisible}
            onChange={setCloudVisible}
            label="Precipitation radar"
          />
        </div>

        {cloudVisible && (
          <div className="flex items-center gap-2 pl-5 text-night-400">
            <span className="w-7 text-right tabular-nums text-night-300">{cloudPct}%</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={cloudPct}
              onChange={(e) => setCloudOpacity(Number(e.target.value) / 100)}
              title="Adjust cloud-coverage opacity"
              className="h-1.5 w-20 cursor-pointer accent-sky-400"
            />
          </div>
        )}
      </div>
    </div>
  )
}
