import { useState } from 'react'

// ── Icons ─────────────────────────────────────────────────────────────────────

/** Arrow-up-right — universal "external link / actions" metaphor */
function ActionsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <path d="M3 13 L13 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M7 3 H13 V9"  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Pegman-style icon matching Google Maps Street View symbol */
function StreetViewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <circle cx="8" cy="3.5" r="2" fill="currentColor" />
      <line x1="8" y1="5.5"  x2="8"    y2="10"   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="5.5" y1="7.5" x2="10.5" y2="7.5"  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="10"   x2="6"    y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="10"   x2="10"   y2="13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Clear Outside — simplified cloud + star icon */
function ClearOutsideIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      {/* Cloud outline */}
      <path
        d="M4 11 C2.5 11 1.5 10 1.5 8.5 C1.5 7.2 2.4 6.2 3.6 6 C3.6 4.1 5.1 2.5 7 2.5 C8.5 2.5 9.8 3.4 10.3 4.7 C10.5 4.65 10.7 4.6 11 4.6 C12.4 4.6 13.5 5.7 13.5 7.1 C13.5 8.5 12.4 9.5 11 9.5 H4"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
      />
      {/* Star / moon hint */}
      <circle cx="8" cy="13" r="1" fill="currentColor" opacity="0.7" />
      <circle cx="5" cy="13.5" r="0.7" fill="currentColor" opacity="0.5" />
      <circle cx="11" cy="13.5" r="0.7" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

/** Reusable action-link row inside the panel */
function ActionButton({
  icon,
  label,
  onClick,
  title,
}: {
  icon:    React.ReactNode
  label:   string
  onClick: () => void
  title:   string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-night-300 transition-colors duration-150 hover:bg-night-800 hover:text-night-100"
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ExternalActionsProps {
  center: { lat: number; lng: number }
}

/**
 * Collapsible "External Actions" HUD panel.
 * Contains links that open third-party sites in a new browser tab,
 * centred on the current map location.
 *
 * Actions:
 *  • Street View  — Google Maps Street View at exact centre (6 dp)
 *  • Clear Outside — weather/sky forecast at centre (2 dp)
 */
export default function ExternalActions({ center }: ExternalActionsProps) {
  const [open, setOpen] = useState(false)

  function openStreetView() {
    const lat = center.lat.toFixed(6)
    const lng = center.lng.toFixed(6)
    window.open(
      `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0`,
      '_blank', 'noopener,noreferrer',
    )
  }

  function openClearOutside() {
    const lat = center.lat.toFixed(2)
    const lng = center.lng.toFixed(2)
    window.open(
      `https://clearoutside.com/forecast/${lat}/${lng}`,
      '_blank', 'noopener,noreferrer',
    )
  }

  // ── Collapsed ──────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-night-700 bg-night-900/80 px-3 py-1.5 text-xs text-night-400 backdrop-blur-sm transition-colors duration-150 hover:border-night-600 hover:text-night-200"
        title="Open external actions"
        aria-expanded={false}
      >
        <ActionsIcon />
        <span>Actions</span>
      </button>
    )
  }

  // ── Expanded ───────────────────────────────────────────────────────────────
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-2">

      {/* Toggle button — active state */}
      <button
        onClick={() => setOpen(false)}
        className="flex items-center gap-1.5 rounded-full border border-indigo-500/70 bg-night-900/90 px-3 py-1.5 text-xs text-night-100 backdrop-blur-sm transition-colors duration-150 hover:bg-night-800/90"
        title="Close external actions"
        aria-expanded={true}
      >
        <ActionsIcon />
        <span>Actions</span>
      </button>

      {/* Panel */}
      <div className="flex min-w-[172px] flex-col gap-1.5 rounded-lg border border-night-700 bg-night-900/85 px-3 py-2.5 text-xs backdrop-blur-sm">

        <ActionButton
          icon={<StreetViewIcon />}
          label="Street View"
          onClick={openStreetView}
          title="Open Google Maps Street View at map centre"
        />

        <hr className="border-night-700" />

        <ActionButton
          icon={<ClearOutsideIcon />}
          label="Clear Outside"
          onClick={openClearOutside}
          title="Open Clear Outside sky forecast for map centre"
        />

      </div>
    </div>
  )
}
