import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
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
 * ESRI World Physical Map – hypsometric coloring, no API key required.
 * Dark ocean → light ocean → green lowlands → yellow hills → brown mountains.
 * Max native zoom: 8  (upscaled by Leaflet beyond that)
 */
const ESRI_PHYSICAL_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}'
const ESRI_PHYSICAL_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — ' +
  'Source: US National Park Service'

/**
 * OpenTopoMap – contour lines + terrain detail for close-up site selection.
 * No API key required. Max zoom: 17.
 */
const OPEN_TOPO_URL = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'
const OPEN_TOPO_ATTRIBUTION =
  '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> ' +
  '(<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>) | ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Zoom level at which we transition from hypsometric overview to topo detail
const TOPO_ZOOM_THRESHOLD = 3

// ── Map configuration ─────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [50.0, 15.0]
const MAP_ZOOM     = 6
const MAP_MIN_ZOOM = 3
const MAP_MAX_ZOOM = 17

// ── CSS dark filters per layer ────────────────────────────────────────────────
//
// ESRI Physical: simple darken – preserves the hypsometric palette.
//   • Deep ocean  #1a5276 → very dark navy  ✓
//   • Lowlands    #a8c882 → muted dark green ✓
//   • Highlands   #d4b483 → warm ochre       ✓
//   • Mountains   #c4a060 → dark brown       ✓
//
// OpenTopoMap: slight darken + desaturate so contour lines stay readable
//   against the dark UI without inverting colours.

const FILTER_ESRI  = 'brightness(0.60) contrast(1.10) saturate(0.85)'
const FILTER_TOPO  = 'brightness(0.50) contrast(1.10) saturate(0.65)'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PANE_ESRI = 'paneEsri'
const PANE_TOPO = 'paneTopo'

/** Creates two named panes and wires up their CSS dark filters. */
function SetupPanes() {
  const map = useMap()

  useEffect(() => {
    // Create panes only once
    if (!map.getPane(PANE_ESRI)) {
      const esriPane = map.createPane(PANE_ESRI)
      esriPane.style.zIndex = '200'
      esriPane.style.filter = FILTER_ESRI
    }
    if (!map.getPane(PANE_TOPO)) {
      const topoPane = map.createPane(PANE_TOPO)
      topoPane.style.zIndex = '201'
      topoPane.style.filter = FILTER_TOPO
    }
  }, [map])

  return null
}

/** Switches layer visibility based on current zoom level. */
function ZoomRouter({
  onZoomChange,
}: {
  onZoomChange: (zoom: number) => void
}) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  })
  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapView() {
  const [zoom, setZoom] = useState(MAP_ZOOM)

  const showEsri = zoom < TOPO_ZOOM_THRESHOLD
  const showTopo = zoom >= TOPO_ZOOM_THRESHOLD

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
        <SetupPanes />
        <ZoomRouter onZoomChange={setZoom} />

        {/* ── Layer 1: ESRI Physical – hypsometric overview (zoom 0–9) ── */}
        <TileLayer
          url={ESRI_PHYSICAL_URL}
          attribution={ESRI_PHYSICAL_ATTRIBUTION}
          pane={PANE_ESRI}
          maxNativeZoom={8}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showEsri ? 1 : 0}
        />

        {/* ── Layer 2: OpenTopoMap – contour detail (zoom 10–17) ── */}
        <TileLayer
          url={OPEN_TOPO_URL}
          attribution={OPEN_TOPO_ATTRIBUTION}
          pane={PANE_TOPO}
          subdomains={['a', 'b', 'c']}
          maxNativeZoom={17}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showTopo ? 1 : 0}
        />

        <ZoomControl position="bottomright" />
      </MapContainer>

      {/* ── HUD: branding ── */}
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

      {/* ── HUD: current layer indicator ── */}
      <div className="pointer-events-none absolute right-14 top-4 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 text-xs text-night-300 backdrop-blur-sm">
        {showEsri ? 'Physical · zoom ' + zoom : 'Topographic · zoom ' + zoom}
      </div>

      {/* ── HUD: score legend ── */}
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
