import { CircleMarker, Popup } from 'react-leaflet'
import { useLocations } from '../hooks/useLocations'
import { getScoreColor } from '../types/location'
import type { Location, ScoreColor } from '../types/location'

// ── Colour palette (mirrors tailwind.config.js score / night tokens) ──────────

const MARKER_FILL: Record<ScoreColor, string> = {
  green:   '#22c55e',
  yellow:  '#eab308',
  red:     '#ef4444',
  unknown: '#6366f1',   // indigo – DarkHorizon primary accent
}

const MARKER_STROKE: Record<ScoreColor, string> = {
  green:   '#15803d',
  yellow:  '#a16207',
  red:     '#b91c1c',
  unknown: '#4338ca',
}

// ── Bortle class labels ────────────────────────────────────────────────────────

const BORTLE_LABEL: Record<number, string> = {
  1: 'Exceptional dark sky',
  2: 'Truly dark sky',
  3: 'Rural sky',
  4: 'Rural / suburban transition',
  5: 'Suburban sky',
  6: 'Bright suburban sky',
  7: 'Suburban / urban transition',
  8: 'City sky',
  9: 'Inner-city sky',
}

// ── Single marker ─────────────────────────────────────────────────────────────

function LocationMarker({ loc }: { loc: Location }) {
  // No scores yet — will be wired up once weather_cache / sunmoon_cache are populated
  const color  = getScoreColor(null)
  const fill   = MARKER_FILL[color]
  const stroke = MARKER_STROKE[color]

  return (
    <CircleMarker
      center={[loc.latitude, loc.longitude]}
      radius={9}
      pathOptions={{
        fillColor:    fill,
        fillOpacity:  0.90,
        color:        stroke,
        weight:       2,
      }}
    >
      <Popup minWidth={200} maxWidth={280} className="dh-popup">
        <div className="dh-popup-inner">

          {/* Name row */}
          <div className="dh-popup-name">{loc.name}</div>

          {/* Score badge – greyed out until scores are available */}
          <div className="dh-popup-score-row">
            <span
              className="dh-popup-badge"
              style={{ background: fill, color: '#fff' }}
            >
              Score: —
            </span>
          </div>

          {/* Stats grid */}
          <dl className="dh-popup-grid">
            <dt>Bortle</dt>
            <dd>
              <strong>B{loc.bortle_class}</strong>
              <span className="dh-popup-muted"> — {BORTLE_LABEL[loc.bortle_class] ?? '—'}</span>
            </dd>

            <dt>Elevation</dt>
            <dd>{loc.elevation_m} m a.s.l.</dd>

            {loc.description && (
              <>
                <dt>Note</dt>
                <dd>{loc.description}</dd>
              </>
            )}
          </dl>

          {/* Coordinates */}
          <div className="dh-popup-coords">
            {Math.abs(loc.latitude).toFixed(4)}° {loc.latitude >= 0 ? 'N' : 'S'}
            {'  ·  '}
            {Math.abs(loc.longitude).toFixed(4)}° {loc.longitude >= 0 ? 'E' : 'W'}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  )
}

// ── Container ─────────────────────────────────────────────────────────────────

/**
 * Renders a CircleMarker + Popup for every location fetched from Supabase.
 * Must be placed inside a react-leaflet <MapContainer>.
 */
export default function LocationMarkers() {
  const { data: locations, isLoading, isError } = useLocations()

  // Nothing to render during load / error — MapView's HUD can show status
  if (isLoading || isError || !locations) return null

  return (
    <>
      {locations.map((loc) => (
        <LocationMarker key={loc.id} loc={loc} />
      ))}
    </>
  )
}
