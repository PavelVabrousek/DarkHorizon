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

/** Actual Meteogram — stylised weather chart icon */
function MeteogramIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      {/* Horizontal baseline */}
      <line x1="1" y1="13" x2="15" y2="13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      {/* Bar chart columns (cloud cover metaphor) */}
      <rect x="2"  y="9"  width="2" height="4" fill="currentColor" opacity="0.5" rx="0.4" />
      <rect x="5"  y="6"  width="2" height="7" fill="currentColor" opacity="0.6" rx="0.4" />
      <rect x="8"  y="4"  width="2" height="9" fill="currentColor" opacity="0.7" rx="0.4" />
      <rect x="11" y="7"  width="2" height="6" fill="currentColor" opacity="0.5" rx="0.4" />
      {/* Temperature line */}
      <polyline
        points="3,8 6,5.5 9,3.5 12,6"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"
        fill="none" opacity="0.9"
      />
    </svg>
  )
}

/** Save Location — pin drop icon */
function SaveLocationIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <path
        d="M8 1.5C5.51 1.5 3.5 3.51 3.5 6c0 3.75 4.5 8.5 4.5 8.5S12.5 9.75 12.5 6C12.5 3.51 10.49 1.5 8 1.5z"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      <circle cx="8" cy="6" r="1.5" fill="currentColor" />
    </svg>
  )
}

/** Nearest saved location — target pin icon */
function NearestLocationIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.5V4 M8 12v2.5 M1.5 8H4 M12 8h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  )
}

/** Yearly Cloud Stat — cloud icon */
function CloudIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0">
      <path
        d="M4 11.5 C2.3 11.5 1 10.2 1 8.5 C1 7.1 2 5.9 3.3 5.6 C3.8 3.5 5.7 2 8 2 C10 2 11.7 3.1 12.4 4.8 C12.6 4.7 12.8 4.7 13 4.7 C14.4 4.7 15.5 5.8 15.5 7.2 C15.5 8.6 14.4 9.7 13 9.7 H4.5 M4.5 11.5 H13 C14.7 11.5 16 10.2 16 8.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
      <path d="M4.5 11.5 H13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  onAddCloudStat:  () => void
  onSaveLocation:  () => void
  onAddMeteogram:  () => void
  onNearestLocation: () => void
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
export default function ExternalActions({ center, onAddCloudStat, onSaveLocation, onAddMeteogram, onNearestLocation }: ExternalActionsProps) {
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
          icon={<MeteogramIcon />}
          label="Actual Meteogram"
          onClick={onAddMeteogram}
          title="Open 7-night ECMWF hourly meteogram for map centre"
        />

        <hr className="border-night-700/50" />

        <ActionButton
          icon={<SaveLocationIcon />}
          label="Save Location"
          onClick={onSaveLocation}
          title="Save current map centre as an observation site"
        />

        <ActionButton
          icon={<NearestLocationIcon />}
          label="Nearest Location"
          onClick={onNearestLocation}
          title="Center on the nearest saved observation site and open its details"
        />

        <hr className="border-night-700/50" />

        <ActionButton
          icon={<CloudIcon />}
          label="Yearly Cloud Stat"
          onClick={onAddCloudStat}
          title="Open yearly cloud coverage statistics for the map center"
        />

        <hr className="border-night-700/50" />

        <ActionButton
          icon={<StreetViewIcon />}
          label="Street View"
          onClick={openStreetView}
          title="Open Google Maps Street View at map centre"
        />

        <hr className="border-night-700/50" />

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
