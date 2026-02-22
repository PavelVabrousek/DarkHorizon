import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, ImageOverlay, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { useMapSettings } from '../store/mapSettings'
import MapControls from './MapControls'
import { preloadLp, sampleLpAt, type LpSample } from '../utils/lpSampler'

// ── Fix Leaflet's broken default marker icons when bundled with Vite ──────────
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
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

/**
 * ESRI World Imagery – high-resolution satellite / aerial photography.
 * No API key required. Max native zoom: 19 in most areas.
 * Non-commercial / hobby use only (ESRI Master Agreement).
 */
const ESRI_SAT_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_SAT_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — ' +
  'Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'

// Zoom level at which we transition from hypsometric overview to topo detail
const TOPO_ZOOM_THRESHOLD = 3

// Minimum zoom at which satellite mode is available
const SAT_ZOOM_THRESHOLD = 12

// ── Light-pollution overlay ───────────────────────────────────────────────────

/**
 * Lorenz 2024 world LP map (medium resolution, 1/40° ≈ 2.5 km).
 * Self-hosted in public/lp/ – generated once with scripts/download_lp.py.
 * Bounds: 65°S – 75°N, 180°W – 180°E (plate carree, no reprojection needed).
 *
 * The six 1/120° continent PNGs (NorthAmerica, Europe, …) also live in
 * public/lp/ and are ready for a future zoom-adaptive, higher-resolution
 * implementation. They are not used here because their bounds overlap at
 * continental borders, which would cause double-brightness artifacts when
 * stacked at the same opacity.
 */
const LP_URL = '/lp/world_low3.png'

// Three copies shifted by ±360° so the overlay wraps seamlessly when the user
// scrolls past the ±180° meridian (same technique tile layers use internally).
// The browser fetches the PNG once and reuses the cached response for all copies.
const LP_COPIES: [[number, number], [number, number]][] = [
  [[-65, -540], [75, -180]],  // western world copy
  [[-65, -180], [75,  180]],  // primary
  [[-65,  180], [75,  540]],  // eastern world copy
]

// ── Map configuration ─────────────────────────────────────────────────────────

const MAP_CENTER: [number, number] = [50.0, 15.0]
const MAP_ZOOM     = 6
const MAP_MIN_ZOOM = 3
const MAP_MAX_ZOOM = 20

// ── Pane names & CSS filters ──────────────────────────────────────────────────

const PANE_ESRI = 'paneEsri'
const PANE_TOPO = 'paneTopo'
const PANE_SAT  = 'paneSat'
const PANE_LP   = 'paneLp'

// ESRI Physical: simple darken – preserves the hypsometric palette.
const FILTER_ESRI = 'brightness(0.60) contrast(1.10) saturate(0.85)'
// OpenTopoMap: slight darken + desaturate so contour lines stay readable.
const FILTER_TOPO = 'brightness(0.50) contrast(1.10) saturate(0.65)'
// ESRI Satellite: mild darkening only – keeps terrain features identifiable.
const FILTER_SAT  = 'brightness(0.82) contrast(1.06) saturate(0.88)'
// LP overlay: no filter – the Lorenz color palette is already dark-sky themed.

// ── Inner components ──────────────────────────────────────────────────────────

/** Creates named panes and wires up their CSS dark filters. */
function SetupPanes() {
  const map = useMap()

  useEffect(() => {
    if (!map.getPane(PANE_ESRI)) {
      const p = map.createPane(PANE_ESRI)
      p.style.zIndex = '200'
      p.style.filter = FILTER_ESRI
    }
    if (!map.getPane(PANE_TOPO)) {
      const p = map.createPane(PANE_TOPO)
      p.style.zIndex = '201'
      p.style.filter = FILTER_TOPO
    }
    if (!map.getPane(PANE_SAT)) {
      const p = map.createPane(PANE_SAT)
      p.style.zIndex = '202'
      p.style.filter = FILTER_SAT
    }
    if (!map.getPane(PANE_LP)) {
      const p = map.createPane(PANE_LP)
      p.style.zIndex = '400'
    }
  }, [map])

  return null
}

/** Fires onZoomChange whenever the zoom level changes. */
function ZoomRouter({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  })
  return null
}

/** Fires callbacks when the map starts moving and when it settles. */
function CenterTracker({
  onCenterChange,
  onMoveStart,
}: {
  onCenterChange: (lat: number, lng: number) => void
  onMoveStart:    () => void
}) {
  const map = useMapEvents({
    movestart: () => onMoveStart(),
    zoomstart: () => onMoveStart(),
    moveend:   () => { const c = map.getCenter(); onCenterChange(c.lat, c.lng) },
    zoomend:   () => { const c = map.getCenter(); onCenterChange(c.lat, c.lng) },
  })
  return null
}

/** Formats a lat/lng pair as  "50.1234° N · 14.5678° E" */
function formatCoord(lat: number, lng: number): string {
  return (
    `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}` +
    `  ·  ` +
    `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`
  )
}

/**
 * Light-pollution ImageOverlay.
 * Lazy: the PNG is only requested from the server the first time the user
 * enables the overlay; after that toggling on/off only changes CSS opacity
 * (the image stays cached in the browser).
 */
function LpOverlay() {
  const { lpVisible, lpOpacity } = useMapSettings()
  const [everShown, setEverShown] = useState(false)

  useEffect(() => {
    if (lpVisible) setEverShown(true)
  }, [lpVisible])

  if (!everShown) return null

  return (
    <>
      {LP_COPIES.map((bounds, i) => (
        <ImageOverlay
          key={i}
          url={LP_URL}
          bounds={bounds}
          opacity={lpVisible ? lpOpacity : 0}
          pane={PANE_LP}
        />
      ))}
    </>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapView() {
  const [zoom,   setZoom]   = useState(MAP_ZOOM)
  const [center, setCenter] = useState({ lat: MAP_CENTER[0], lng: MAP_CENTER[1] })

  const { satelliteMode, setSatelliteMode } = useMapSettings()

  /** Auto-revert to topo when the user zooms out below the satellite threshold. */
  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
    if (z < SAT_ZOOM_THRESHOLD) setSatelliteMode(false)
  }, [setSatelliteMode])

  // ── LP index (Bortle class at map centre) ───────────────────────────────────
  const [lpIndex, setLpIndex] = useState<LpSample | null>(null)

  // ── Elevation fetch ─────────────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [elevation,   setElevation]   = useState<number | null>(null)
  const [elevLoading, setElevLoading] = useState(false)

  /** Cancel any pending timer and in-flight request. */
  const cancelElevFetch = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (abortRef.current) { abortRef.current.abort();        abortRef.current = null }
  }, [])

  /**
   * Wait ELEV_DELAY ms of stillness, then request elevation from Open-Meteo.
   * Any previous pending call is cancelled first.
   */
  const scheduleElevFetch = useCallback((lat: number, lng: number) => {
    cancelElevFetch()
    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setElevLoading(true)
      try {
        const res  = await fetch(
          `https://api.open-meteo.com/v1/elevation` +
          `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}`,
          { signal: ctrl.signal },
        )
        const json = await res.json() as { elevation?: number[] }
        setElevation(
          typeof json.elevation?.[0] === 'number'
            ? Math.round(json.elevation[0])
            : null,
        )
      } catch {
        // Silently ignore — request was aborted or network error
      } finally {
        setElevLoading(false)
      }
    }, 5_000)
  }, [cancelElevFetch])

  // On mount: pre-warm the LP canvas, schedule the first elevation fetch,
  // and sample the LP index for the initial map centre.
  useEffect(() => {
    preloadLp()
    scheduleElevFetch(MAP_CENTER[0], MAP_CENTER[1])
    sampleLpAt(MAP_CENTER[0], MAP_CENTER[1]).then(setLpIndex)
    return cancelElevFetch
  }, [scheduleElevFetch, cancelElevFetch])

  /** Called by CenterTracker when the map settles after a pan / zoom. */
  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setCenter({ lat, lng })
    scheduleElevFetch(lat, lng)
    sampleLpAt(lat, lng).then(setLpIndex)
  }, [scheduleElevFetch])

  /** Called by CenterTracker the moment the user starts panning / zooming. */
  const handleMoveStart = useCallback(() => {
    cancelElevFetch()
    setElevation(null)
    setElevLoading(false)
  }, [cancelElevFetch])

  // ───────────────────────────────────────────────────────────────────────────

  const canToggleSat = zoom >= SAT_ZOOM_THRESHOLD
  const showSat  = satelliteMode && canToggleSat
  const showEsri = zoom < TOPO_ZOOM_THRESHOLD
  const showTopo = zoom >= TOPO_ZOOM_THRESHOLD && !showSat

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
        <ZoomRouter    onZoomChange={handleZoomChange} />
        <CenterTracker onCenterChange={handleCenterChange} onMoveStart={handleMoveStart} />

        {/* ── Layer 1: ESRI Physical – hypsometric overview (zoom 0–2) ── */}
        <TileLayer
          url={ESRI_PHYSICAL_URL}
          attribution={ESRI_PHYSICAL_ATTRIBUTION}
          pane={PANE_ESRI}
          maxNativeZoom={8}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showEsri ? 1 : 0}
        />

        {/* ── Layer 2: OpenTopoMap – contour detail (zoom 3–17) ── */}
        <TileLayer
          url={OPEN_TOPO_URL}
          attribution={OPEN_TOPO_ATTRIBUTION}
          pane={PANE_TOPO}
          subdomains={['a', 'b', 'c']}
          maxNativeZoom={17}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showTopo ? 1 : 0}
        />

        {/* ── Layer 3: ESRI World Imagery – satellite (zoom 12+, user toggled) ── */}
        <TileLayer
          url={ESRI_SAT_URL}
          attribution={ESRI_SAT_ATTRIBUTION}
          pane={PANE_SAT}
          maxNativeZoom={19}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showSat ? 1 : 0}
        />

        {/* ── Overlay: Light-pollution (optional, user-toggled) ── */}
        <LpOverlay />

        <ZoomControl position="topright" />
      </MapContainer>

      {/* ── HUD: branding ── */}
      <div className="pointer-events-none absolute left-4 top-4 z-[1000] flex items-center gap-2">
        <svg className="h-7 w-7 drop-shadow-lg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45" fill="#0a0a1a" stroke="#6366f1" strokeWidth="4" />
          <circle cx="50" cy="50" r="8"  fill="#f59e0b" />
          <circle cx="72" cy="35" r="4"  fill="#c0c0c0" />
          <path d="M 20 60 Q 50 20 80 60" stroke="#6366f1" strokeWidth="2" fill="none" opacity="0.8" />
        </svg>
        <span className="bg-gradient-to-r from-indigo-400 to-violet-300 bg-clip-text text-xl font-bold text-transparent drop-shadow">
          DarkHorizon
        </span>
      </div>

      {/* ── HUD: layer indicator / satellite toggle pill ──────────────────────────
            • zoom < 12  → plain informational text (non-interactive)
            • zoom ≥ 12  → clickable button toggling topo ↔ satellite
            Active satellite state gets an indigo tint so the mode is unmistakable. ── */}
      {canToggleSat ? (
        <button
          onClick={() => setSatelliteMode(!satelliteMode)}
          className={[
            'absolute right-12 top-3 z-[1000]',
            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
            'backdrop-blur-sm transition-colors duration-150',
            showSat
              ? 'border-indigo-500 bg-indigo-950/85 text-indigo-300 hover:bg-indigo-900/85'
              : 'border-night-600 bg-night-900/80 text-night-200 hover:border-indigo-500 hover:text-indigo-300',
          ].join(' ')}
          title={showSat ? 'Switch to Topographic' : 'Switch to Satellite'}
        >
          {/* Small camera icon */}
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
            <rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5 4V3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V4" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
          {showSat ? 'Satellite' : 'Topographic'} · zoom {zoom}
        </button>
      ) : (
        <div className="pointer-events-none absolute right-12 top-3 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 text-xs text-night-300 backdrop-blur-sm">
          {showEsri ? 'Physical' : 'Topographic'} · zoom {zoom}
        </div>
      )}

      {/* ── HUD: coordinate + elevation status bar — top-right, below the zoom indicator
            Elevation is fetched from Open-Meteo 5 s after the map stops moving. ── */}
      <div className="pointer-events-none absolute right-12 top-10 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 font-mono text-xs text-night-300 backdrop-blur-sm">
        {formatCoord(center.lat, center.lng)}
        {elevLoading && <span className="text-night-500"> · …</span>}
        {!elevLoading && elevation !== null && <span> · {elevation} m</span>}
      </div>

      {/* ── HUD: bottom strip — site score (left) + layer controls (right)
            items-start pins both top edges to the same line regardless of height. ── */}
      <div className="pointer-events-none absolute bottom-10 left-4 right-4 z-[1000] flex items-start justify-between">

        {/* Site score legend */}
        <div className="flex flex-col gap-1 rounded-lg border border-night-700 bg-night-900/80 px-3 py-2 text-xs text-night-300 backdrop-blur-sm">
          <span className="mb-1 font-semibold text-night-100">Site score</span>

          {/* LP index row — always shown once the image is loaded */}
          <span className="flex items-center gap-1.5 border-b border-night-700 pb-1.5 text-night-200">
            <span className="text-night-400">LP index:</span>
            {lpIndex
              ? <span className="font-semibold text-night-100">{lpIndex.scale}</span>
              : <span className="text-night-600">—</span>
            }
          </span>

          <span className="flex items-center gap-2 pt-0.5">
            <span className="h-2.5 w-2.5 rounded-full bg-score-green" /> ≥ 70 – Excellent
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-score-yellow" /> 40–69 – Fair
          </span>
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-score-red" /> &lt; 40 – Poor
          </span>
        </div>

        {/* Layer controls */}
        <MapControls />

      </div>
    </div>
  )
}
