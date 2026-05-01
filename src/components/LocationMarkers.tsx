import { useEffect, useMemo, useRef } from 'react'
import { CircleMarker, Popup } from 'react-leaflet'
import type L from 'leaflet'
import { useLocations, type LocationBounds } from '../hooks/useLocations'
import type { LocationMarkerRow } from '../types/location'
import { BORTLE_TABLE } from '../utils/lpSampler'

// ── Zoom-adaptive radius ──────────────────────────────────────────────────────

/**
 * Return a CircleMarker radius (CSS px) that scales with the Leaflet zoom level
 * so markers shrink when zoomed out and don't overlap each other.
 */
function zoomToRadius(zoom: number): number {
  if (zoom <= 4)  return 3
  if (zoom <= 6)  return 4
  if (zoom <= 8)  return 5
  if (zoom <= 10) return 6
  if (zoom <= 12) return 7
  if (zoom <= 14) return 8
  if (zoom <= 16) return 9
  return 10
}

// ── Bortle class → LP colour palette ─────────────────────────────────────────

/**
 * Map integer Bortle class (1–9) to the fine-grained LP scale entry.
 * Uses the "b" (brighter) sub-scale for each integer so the marker colors
 * are vivid and visually consistent with the LP overlay on the map.
 *
 * Bortle 8 and 9 share the lightest LP scale ("7b") since the Lorenz palette
 * only goes up to class 7.
 */
const BORTLE_SCALE_MAP: Record<number, string> = {
  1: '1b',   // Dark Gray
  2: '2b',   // Blue
  3: '3b',   // Green
  4: '4b',   // Yellow-Olive
  5: '5b',   // Light Orange
  6: '6b',   // Salmon
  7: '7a',   // Medium Gray
  8: '7b',   // Light Gray
  9: '7b',   // Light Gray (same as 8 — LP scale maxes at 7)
}

function toHex(r: number, g: number, b: number): string {
  return (
    '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    b.toString(16).padStart(2, '0')
  )
}

/**
 * Returns fill and stroke hex colors for a given integer Bortle class,
 * derived directly from the Lorenz LP colour table.
 *
 * Stroke heuristic:
 *  • Dark fills (luminance < 80) → white stroke so the marker is visible on
 *    the dark base map.
 *  • Light/medium fills           → 50 % darkened version of the fill color.
 */
function bortleToLpColor(bortleClass: number): { fill: string; stroke: string } {
  const clampedClass = Math.max(1, Math.min(9, bortleClass))
  const scale  = BORTLE_SCALE_MAP[clampedClass] ?? '5b'
  const entry  = BORTLE_TABLE.find(e => e.scale === scale)

  if (!entry) return { fill: '#6366f1', stroke: '#4338ca' }  // fallback: indigo

  const { r, g, b } = entry
  // Perceived luminance (standard Rec. 601 weights)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b

  if (lum < 80) {
    // Very dark fill — use a white stroke so the marker isn't invisible
    return { fill: toHex(r, g, b), stroke: '#ffffff' }
  }
  return {
    fill:   toHex(r, g, b),
    stroke: toHex(Math.round(r * 0.5), Math.round(g * 0.5), Math.round(b * 0.5)),
  }
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

interface LocationMarkerProps {
  loc: LocationMarkerRow
  radius: number
  shouldOpen: boolean
  onOpened: () => void
  onOpenMeteogram: (lat: number, lng: number, name: string) => void
  onOpenCloudStat: (lat: number, lng: number, name: string) => void
  onOpenHorizon: (locationId: string, name: string) => void
}

function LocationMarker({ loc, radius, shouldOpen, onOpened, onOpenMeteogram, onOpenCloudStat, onOpenHorizon }: LocationMarkerProps) {
  const markerRef = useRef<L.CircleMarker | null>(null)
  const { fill, stroke } = bortleToLpColor(loc.bortle_class)

  useEffect(() => {
    if (!shouldOpen) return
    markerRef.current?.openPopup()
    onOpened()
  }, [shouldOpen, onOpened])

  return (
    <CircleMarker
      ref={markerRef}
      center={[loc.latitude, loc.longitude]}
      radius={radius}
      pathOptions={{
        fillColor:   fill,
        fillOpacity: 0.90,
        color:       stroke,
        weight:      2,
      }}
    >
      <Popup minWidth={200} maxWidth={280} className="dh-popup">
        <div className="dh-popup-inner">

          {/* Name row */}
          <div className="dh-popup-name">{loc.name}</div>

          {/* Chart launch buttons */}
          <div className="dh-popup-score-row" style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <button
              onClick={() => onOpenMeteogram(loc.latitude, loc.longitude, loc.name)}
              style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4,
                background: '#1e1b4b', color: '#a5b4fc',
                border: '1px solid #4338ca', cursor: 'pointer', lineHeight: 1.4,
              }}
              title="Open 10-day meteogram for this location"
            >
              Meteo
            </button>
            <button
              onClick={() => onOpenCloudStat(loc.latitude, loc.longitude, loc.name)}
              style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4,
                background: '#064e3b', color: '#6ee7b7',
                border: '1px solid #059669', cursor: 'pointer', lineHeight: 1.4,
              }}
              title="Open yearly cloud statistics for this location"
            >
              Clima
            </button>
            <button
              onClick={() => onOpenHorizon(loc.id, loc.name)}
              style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 4,
                background: '#451a03', color: '#fcd34d',
                border: '1px solid #b45309', cursor: 'pointer', lineHeight: 1.4,
              }}
              title="View local horizon profile for this location"
            >
              Horizon
            </button>
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

interface LocationMarkersProps {
  /** Current Leaflet zoom level — supplied by MapView so this component
   *  doesn't need its own useMapEvents listener (which interfered with the
   *  LP overlay pane rendering). */
  zoom: number
  viewportBounds: LocationBounds | null
  openLocationId: string | null
  onLocationOpened: () => void
  onOpenMeteogram: (lat: number, lng: number, name: string) => void
  onOpenCloudStat: (lat: number, lng: number, name: string) => void
  onOpenHorizon: (locationId: string, name: string) => void
}

/**
 * Renders a CircleMarker + Popup for every location fetched from Supabase.
 * Marker color matches the Lorenz LP overlay palette keyed to bortle_class.
 * Marker radius scales with zoom so dots shrink at low zoom levels.
 * Must be placed inside a react-leaflet <MapContainer>.
 */
export default function LocationMarkers({ zoom, viewportBounds, openLocationId, onLocationOpened, onOpenMeteogram, onOpenCloudStat, onOpenHorizon }: LocationMarkersProps) {
  const expandedBounds = useMemo<LocationBounds | null>(() => {
    if (!viewportBounds) return null
    // Small margin so markers near edges aren't popping in/out aggressively
    const latPad = 0.3
    const lngPad = 0.3
    return {
      south: Math.max(-90, viewportBounds.south - latPad),
      north: Math.min(90, viewportBounds.north + latPad),
      west: Math.max(-180, viewportBounds.west - lngPad),
      east: Math.min(180, viewportBounds.east + lngPad),
    }
  }, [viewportBounds])

  const { data: locations, isLoading, isError } = useLocations(expandedBounds)

  const radius = zoomToRadius(zoom)

  if (isLoading || isError || !locations) return null

  return (
    <>
      {locations.map((loc) => (
        <LocationMarker
          key={loc.id}
          loc={loc}
          radius={radius}
          shouldOpen={loc.id === openLocationId}
          onOpened={onLocationOpened}
          onOpenMeteogram={onOpenMeteogram}
          onOpenCloudStat={onOpenCloudStat}
          onOpenHorizon={onOpenHorizon}
        />
      ))}
    </>
  )
}
