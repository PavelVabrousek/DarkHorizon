import { useEffect } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ── Fix Leaflet's broken default marker icons when bundled with Vite ──────────
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
})

// ── Tile sources ──────────────────────────────────────────────────────────────

/**
 * OpenTopoMap – best free topo tile source, no API key required.
 * Shows contour lines, shaded relief, elevation labels.
 * Max zoom: 17 | Tile size: 256 px | Projection: EPSG:3857
 * Attribution required: © OpenTopoMap contributors
 */
const OPEN_TOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
const OPEN_TOPO_ATTRIBUTION =
  '© <a href="https://opentopomap.org">OpenTopoMap</a> ' +
  '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) | ' +
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// ── Map configuration ─────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [50.0, 15.0]   // Central Europe
const MAP_ZOOM = 6
const MAP_MIN_ZOOM = 3
const MAP_MAX_ZOOM = 17

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Applies a dark CSS filter to the tile layer pane so OTM reads as night map. */
function DarkTileFilter() {
  const map = useMap()

  useEffect(() => {
    const pane = map.getPane('tilePane')
    if (pane) {
      pane.style.filter = 'brightness(0.65) saturate(0.6) hue-rotate(180deg) invert(1) hue-rotate(180deg)'
    }
  }, [map])

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapView() {
  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        zoomControl={false}
        className="h-full w-full bg-night-950"
      >
        {/* Base topo layer */}
        <TileLayer
          url={OPEN_TOPO_URL}
          attribution={OPEN_TOPO_ATTRIBUTION}
          subdomains={['a', 'b', 'c']}
          maxZoom={MAP_MAX_ZOOM}
          maxNativeZoom={17}
        />

        {/* Dark filter applied to tile pane */}
        <DarkTileFilter />

        {/* Custom zoom control – bottom right */}
        <ZoomControl position="bottomright" />
      </MapContainer>

      {/* HUD overlay – top left branding */}
      <div className="pointer-events-none absolute left-4 top-4 z-[1000] flex items-center gap-2">
        <svg className="h-7 w-7 drop-shadow-lg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="#0a0a1a" stroke="#6366f1" strokeWidth="4" />
          <circle cx="50" cy="50" r="8" fill="#f59e0b" />
          <circle cx="72" cy="35" r="4" fill="#c0c0c0" />
          <path d="M 20 60 Q 50 20 80 60" stroke="#6366f1" strokeWidth="2" fill="none" opacity="0.8" />
        </svg>
        <span className="bg-gradient-to-r from-indigo-400 to-violet-300 bg-clip-text text-xl font-bold text-transparent drop-shadow">
          DarkHorizon
        </span>
      </div>

      {/* Placeholder for future score legend */}
      <div className="pointer-events-none absolute bottom-10 left-4 z-[1000] flex flex-col gap-1 rounded-lg border border-night-700 bg-night-900/80 px-3 py-2 text-xs text-night-300 backdrop-blur-sm">
        <span className="mb-1 font-semibold text-night-100">Site score</span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-score-green" /> ≥ 70 – Excellent
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-score-yellow" /> 40–69 – Fair
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-score-red" /> &lt; 40 – Poor
        </span>
      </div>
    </div>
  )
}
