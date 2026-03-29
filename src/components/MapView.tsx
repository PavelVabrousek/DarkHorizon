import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, ImageOverlay, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { useMapSettings } from '../store/mapSettings'
import { useTimeStore } from '../store/timeStore'
import MapControls from './MapControls'
import ExternalActions from './ExternalActions'
import SearchBar, { type SearchSelectPayload } from './SearchBar'
import LocationMarkers from './LocationMarkers'
// A8: LP_URL imported from lpSampler (single source of truth — no local duplicate)
import { preloadLp, sampleLpAt, type LpSample, LP_URL } from '../utils/lpSampler'
// A1: fetchElevation replaces the inline Open-Meteo fetch inside scheduleElevFetch
import { fetchElevation } from '../lib/openmeteo'
import EventSelector from './EventSelector'
import AstroEventLayer from './AstroEventLayer'
import TimeController from './TimeController'
import ClimaticProfileChart from './ClimaticProfileChart'
import MeteogramChart from './MeteogramChart'
import SaveLocationModal from './SaveLocationModal'

interface ActiveProfile {
  id: string
  lat: number
  lng: number
}

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
 * LP_URL is imported from utils/lpSampler (A8 — single source of truth).
 *
 * The six 1/120° continent PNGs (NorthAmerica, Europe, …) also live in
 * public/lp/ and are ready for a future zoom-adaptive, higher-resolution
 * implementation. They are not used here because their bounds overlap at
 * continental borders, which would cause double-brightness artifacts when
 * stacked at the same opacity.
 */

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

const PANE_ESRI      = 'paneEsri'
const PANE_TOPO      = 'paneTopo'
const PANE_SAT       = 'paneSat'
const PANE_LP        = 'paneLp'
const PANE_CLOUD     = 'paneCloud'     // Precipitation radar (RainViewer)
const PANE_CLEAR_SKY = 'paneClearSky' // ERA5 clear-sky climatology (weekly PNG)

// ESRI Physical: simple darken – preserves the hypsometric palette.
const FILTER_ESRI = 'brightness(0.60) contrast(1.10) saturate(0.85)'
// OpenTopoMap: slight darken + desaturate so contour lines stay readable.
const FILTER_TOPO = 'brightness(0.50) contrast(1.10) saturate(0.65)'
// ESRI Satellite: mild darkening only – keeps terrain features identifiable.
const FILTER_SAT  = 'brightness(0.82) contrast(1.06) saturate(0.88)'
// Radar overlay: slight blue tint to make precipitation visually distinct.
const FILTER_CLOUD = 'hue-rotate(200deg) saturate(1.4) brightness(0.95)'

// ── Scale bar ─────────────────────────────────────────────────────────────────

const SCALE_NICE_METRES = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
  100_000, 200_000, 500_000, 1_000_000, 2_000_000,
]
const SCALE_MAX_PX = 120

/**
 * Compute a "nice" scale bar given the current latitude and zoom level.
 * Returns the bar width in CSS pixels and a human-readable distance label.
 */
function computeScale(lat: number, zoom: number): { px: number; label: string } {
  const mpp   = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
  const maxM  = mpp * SCALE_MAX_PX
  const niceM = SCALE_NICE_METRES.filter((v) => v <= maxM).pop() ?? SCALE_NICE_METRES[0]
  const px    = niceM / mpp
  const label = niceM >= 1_000 ? `${niceM / 1_000} km` : `${niceM} m`
  return { px, label }
}

// ── Inner components ──────────────────────────────────────────────────────────

/** Captures the Leaflet map instance into a ref accessible outside MapContainer. */
function MapRefCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
    return () => { mapRef.current = null }
  }, [map, mapRef])
  return null
}

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
    if (!map.getPane(PANE_CLOUD)) {
      const p = map.createPane(PANE_CLOUD)
      p.style.zIndex = '420'
      p.style.filter = FILTER_CLOUD
    }
    if (!map.getPane(PANE_CLEAR_SKY)) {
      const p = map.createPane(PANE_CLEAR_SKY)
      // Sits below all real-time overlays (LP=400) — statistical background layer
      p.style.zIndex = '390'
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

// ── Clear-sky probability overlay (ERA5 weekly climatology) ──────────────────

/**
 * Compute the ISO week number (1–53) for a given UTC timestamp in ms.
 * Uses Thursday-based ISO 8601 algorithm.
 */
function isoWeekNumber(ms: number): number {
  const d = new Date(ms)
  const day = d.getUTCDay() || 7          // 1 = Mon … 7 = Sun
  d.setUTCDate(d.getUTCDate() + 4 - day)  // set to Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
}

/**
 * ERA5/Copernicus clear-sky probability overlay — weekly RGBA PNG.
 * PNGs live in public/cloudcover/ and are generated by scripts/convert_cloudcover.py.
 * White = high cloud probability, transparent = high clear-sky probability.
 *
 * The active file is determined by the ISO week number of the global App Time.
 * The overlay updates instantly when the user scrolls the TimeController.
 */
function ClearSkyOverlay() {
  const { clearSkyVisible, clearSkyOpacity } = useMapSettings()
  const { appTimeMs } = useTimeStore()
  const [everShown, setEverShown] = useState(false)

  useEffect(() => {
    if (clearSkyVisible) setEverShown(true)
  }, [clearSkyVisible])

  if (!everShown) return null

  const week    = isoWeekNumber(appTimeMs)
  const weekStr = String(week).padStart(2, '0')
  const url     = `/cloudcover/clear_sky_prob_week_${weekStr}.png`

  return (
    <ImageOverlay
      key={url}           // re-mount when week changes → forces image refresh
      url={url}
      bounds={[[-85, -180], [85, 180]]}
      opacity={clearSkyVisible ? clearSkyOpacity : 0}
      pane={PANE_CLEAR_SKY}
    />
  )
}

// ── Cloud coverage overlay ────────────────────────────────────────────────────

interface RainViewerResponse {
  host: string
  radar:     { past:     Array<{ time: number; path: string }> }
  satellite: { infrared: Array<{ time: number; path: string }> }
}

const CLOUD_REFRESH_MS = 5 * 60 * 1_000   // 5 minutes
const RAINVIEWER_API   = 'https://api.rainviewer.com/public/weather-maps.json'

/**
 * Precipitation-radar TileLayer driven by RainViewer's free radar composites.
 * Lazy: first API fetch fires only once the user enables the layer.
 * Auto-refresh: 5-min interval keeps the timestamp current while visible.
 */
function CloudOverlay() {
  const { cloudVisible, cloudOpacity } = useMapSettings()
  const [tileUrl,   setTileUrl]   = useState<string | null>(null)
  const [everShown, setEverShown] = useState(false)

  useEffect(() => {
    if (cloudVisible) setEverShown(true)
  }, [cloudVisible])

  const fetchLatestTileUrl = useCallback(async () => {
    try {
      const res  = await fetch(RAINVIEWER_API)
      const data = await res.json() as RainViewerResponse

      const satFrames   = data.satellite?.infrared
      const radarFrames = data.radar?.past

      if (satFrames?.length) {
        const latest = satFrames[satFrames.length - 1]
        setTileUrl(`${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`)
      } else if (radarFrames?.length) {
        const latest = radarFrames[radarFrames.length - 1]
        setTileUrl(`${data.host}${latest.path}/256/{z}/{x}/{y}/7/1_1.png`)
      }
    } catch {
      // Silently keep the previous tile URL on any network / parse error
    }
  }, [])

  useEffect(() => {
    if (!everShown) return
    fetchLatestTileUrl()
    const id = setInterval(fetchLatestTileUrl, CLOUD_REFRESH_MS)
    return () => clearInterval(id)
  }, [everShown, fetchLatestTileUrl])

  if (!everShown || !tileUrl) return null

  return (
    <TileLayer
      key={tileUrl}
      url={tileUrl}
      attribution='Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
      pane={PANE_CLOUD}
      opacity={cloudVisible ? cloudOpacity : 0}
      maxNativeZoom={6}
      maxZoom={MAP_MAX_ZOOM}
      tileSize={256}
    />
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MapView() {
  const [zoom,   setZoom]   = useState(MAP_ZOOM)
  const [center, setCenter] = useState({ lat: MAP_CENTER[0], lng: MAP_CENTER[1] })

  const mapRef = useRef<L.Map | null>(null)

  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const [activeProfiles,    setActiveProfiles]    = useState<ActiveProfile[]>([])
  const [activeMeteograms,  setActiveMeteograms]  = useState<ActiveProfile[]>([])
  const [showSaveModal,     setShowSaveModal]     = useState(false)

  const addClimaticProfile = useCallback(() => {
    const id = `${center.lat.toFixed(3)}-${center.lng.toFixed(3)}`
    if (activeProfiles.find(p => p.id === id)) return
    setActiveProfiles(prev => [...prev, { id, lat: center.lat, lng: center.lng }])
  }, [center, activeProfiles])

  const removeClimaticProfile = useCallback((id: string) => {
    setActiveProfiles(prev => prev.filter(p => p.id !== id))
  }, [])

  const addMeteogram = useCallback(() => {
    const id = `${center.lat.toFixed(3)}-${center.lng.toFixed(3)}`
    if (activeMeteograms.find(m => m.id === id)) return
    setActiveMeteograms(prev => [...prev, { id, lat: center.lat, lng: center.lng }])
  }, [center, activeMeteograms])

  const removeMeteogram = useCallback((id: string) => {
    setActiveMeteograms(prev => prev.filter(m => m.id !== id))
  }, [])

  const { satelliteMode, setSatelliteMode } = useMapSettings()

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
    if (z < SAT_ZOOM_THRESHOLD) setSatelliteMode(false)
  }, [setSatelliteMode])

  const [lpIndex, setLpIndex] = useState<LpSample | null>(null)

  // ── Elevation fetch ─────────────────────────────────────────────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [elevation,   setElevation]   = useState<number | null>(null)
  const [elevLoading, setElevLoading] = useState(false)

  const cancelElevFetch = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (abortRef.current) { abortRef.current.abort();        abortRef.current = null }
  }, [])

  /**
   * Wait 5 s of map stillness, then fetch elevation via the shared
   * fetchElevation utility (A1). Any previous pending call is cancelled first.
   */
  const scheduleElevFetch = useCallback((lat: number, lng: number) => {
    cancelElevFetch()
    timerRef.current = setTimeout(async () => {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setElevLoading(true)
      try {
        // A1: uses fetchElevation from lib/openmeteo instead of inline fetch
        const elev = await fetchElevation(lat, lng, ctrl.signal)
        setElevation(elev)
      } catch {
        // Silently ignore — aborted or network error
      } finally {
        setElevLoading(false)
      }
    }, 5_000)
  }, [cancelElevFetch])

  useEffect(() => {
    preloadLp()
    scheduleElevFetch(MAP_CENTER[0], MAP_CENTER[1])
    sampleLpAt(MAP_CENTER[0], MAP_CENTER[1]).then(setLpIndex)
    return cancelElevFetch
  }, [scheduleElevFetch, cancelElevFetch])

  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setCenter({ lat, lng })
    scheduleElevFetch(lat, lng)
    sampleLpAt(lat, lng).then(setLpIndex)
  }, [scheduleElevFetch])

  const handleMoveStart = useCallback(() => {
    cancelElevFetch()
    setElevation(null)
    setElevLoading(false)
  }, [cancelElevFetch])

  const handleSearchSelect = useCallback(({ lat, lng, extent }: SearchSelectPayload) => {
    const map = mapRef.current
    if (!map) return
    if (extent) {
      const [west, north, east, south] = extent
      map.fitBounds([[south, west], [north, east]], { padding: [60, 60], maxZoom: 15, animate: true, duration: 1.2 })
    } else {
      map.flyTo([lat, lng], Math.min(Math.max(zoom, 12), 15), { duration: 1.2 })
    }
    if (searchCollapseTimerRef.current) clearTimeout(searchCollapseTimerRef.current)
    searchCollapseTimerRef.current = setTimeout(() => setSearchExpanded(false), 10_000)
  }, [zoom])

  // ── Derived display flags ────────────────────────────────────────────────────

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
        <MapRefCapture mapRef={mapRef} />
        <SetupPanes />
        <ZoomRouter    onZoomChange={handleZoomChange} />
        <CenterTracker onCenterChange={handleCenterChange} onMoveStart={handleMoveStart} />

        {/* ── Layer 1: ESRI Physical – C1: only mounted at zoom ≤ TOPO_ZOOM_THRESHOLD+1
              A +1 buffer above threshold (3) prevents a blank flash at the transition. ── */}
        {zoom <= TOPO_ZOOM_THRESHOLD + 1 && (
          <TileLayer
            url={ESRI_PHYSICAL_URL}
            attribution={ESRI_PHYSICAL_ATTRIBUTION}
            pane={PANE_ESRI}
            maxNativeZoom={8}
            maxZoom={MAP_MAX_ZOOM}
            opacity={showEsri ? 1 : 0}
          />
        )}

        {/* ── Layer 2: OpenTopoMap – primary base layer, always mounted ── */}
        <TileLayer
          url={OPEN_TOPO_URL}
          attribution={OPEN_TOPO_ATTRIBUTION}
          pane={PANE_TOPO}
          subdomains={['a', 'b', 'c']}
          maxNativeZoom={17}
          maxZoom={MAP_MAX_ZOOM}
          opacity={showTopo ? 1 : 0}
        />

        {/* ── Layer 3: ESRI Satellite – C1: only mounted when zoom ≥ SAT_ZOOM_THRESHOLD (12)
              High-res tiles are never pre-fetched at overview zoom levels. ── */}
        {canToggleSat && (
          <TileLayer
            url={ESRI_SAT_URL}
            attribution={ESRI_SAT_ATTRIBUTION}
            pane={PANE_SAT}
            maxNativeZoom={19}
            maxZoom={MAP_MAX_ZOOM}
            opacity={showSat ? 1 : 0}
          />
        )}

        {/* ── Overlay: Light-pollution (optional, user-toggled) ── */}
        <LpOverlay />

        {/* ── Overlay: Clear-sky probability – ERA5 weekly climatology ── */}
        <ClearSkyOverlay />

        {/* ── Overlay: Precipitation radar – RainViewer ── */}
        <CloudOverlay />

        {/* ── Astro Event Layer (e.g. Solar Eclipses) ── */}
        <AstroEventLayer eventId={selectedEventId} />

        {/* ── Observation sites fetched from Supabase ── */}
        <LocationMarkers zoom={zoom} />

      </MapContainer>

      {/* ── Global Time Controller ── */}
      <TimeController />

      {/* ── Crosshair — fixed center-of-map indicator ── */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[999] -translate-x-1/2 -translate-y-1/2 opacity-30">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-white" aria-hidden="true">
          <line x1="0"  y1="12" x2="9"  y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="15" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="12" y1="0"  x2="12" y2="9"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="12" y1="15" x2="12" y2="24" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      </div>

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

      {/* ── HUD: search + event selector — top-left, below branding ── */}
      <div className="pointer-events-auto absolute left-4 top-12 z-[1001] flex flex-col gap-2 items-start">
        {searchExpanded ? (
          <SearchBar
            onSelect={handleSearchSelect}
            onEscape={() => {
              setSearchExpanded(false)
              if (searchCollapseTimerRef.current) { clearTimeout(searchCollapseTimerRef.current); searchCollapseTimerRef.current = null }
            }}
          />
        ) : (
          <button
            onClick={() => setSearchExpanded(true)}
            className="flex items-center gap-1.5 rounded-full border border-night-700 bg-night-900/80 px-3 py-1.5 text-night-400 backdrop-blur-sm transition-colors duration-150 hover:border-indigo-500/70 hover:text-night-200"
            aria-label="Open location search"
            title="Search for a location"
          >
            <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <line x1="10" y1="10" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="text-xs">Search</span>
          </button>
        )}

        <EventSelector
          selectedEventId={selectedEventId}
          onSelectEvent={setSelectedEventId}
        />
      </div>

      {/* ── HUD: layer indicator / satellite toggle — top-right ── */}
      {canToggleSat ? (
        <button
          onClick={() => setSatelliteMode(!satelliteMode)}
          className={[
            'absolute right-3 top-3 z-[1000]',
            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
            'backdrop-blur-sm transition-colors duration-150',
            showSat
              ? 'border-indigo-500 bg-indigo-950/85 text-indigo-300 hover:bg-indigo-900/85'
              : 'border-night-600 bg-night-900/80 text-night-200 hover:border-indigo-500 hover:text-indigo-300',
          ].join(' ')}
          title={showSat ? 'Switch to Topographic' : 'Switch to Satellite'}
        >
          <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 flex-shrink-0" aria-hidden="true">
            <rect x="1" y="4" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
            <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M5 4V3.5A1.5 1.5 0 0 1 6.5 2h3A1.5 1.5 0 0 1 11 3.5V4" stroke="currentColor" strokeWidth="1.4"/>
          </svg>
          {showSat ? 'Satellite' : 'Topographic'} · zoom {zoom}
        </button>
      ) : (
        <div className="pointer-events-none absolute right-3 top-3 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 text-xs text-night-300 backdrop-blur-sm">
          {showEsri ? 'Physical' : 'Topographic'} · zoom {zoom}
        </div>
      )}

      {/* ── HUD: coordinate bar ── */}
      <div className="pointer-events-none absolute right-3 top-10 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 font-mono text-xs text-night-300 backdrop-blur-sm">
        {formatCoord(center.lat, center.lng)}
      </div>

      {/* ── HUD: scale bar ── */}
      {(() => {
        const { px, label } = computeScale(center.lat, zoom)
        const barW = Math.round(px)
        return (
          <div className="pointer-events-none absolute right-3 top-16 z-[1000] flex flex-col items-end gap-1 rounded-full border border-night-700 bg-night-900/80 px-3 py-1.5 opacity-50 backdrop-blur-sm">
            <span className="font-mono text-xs leading-none text-night-300">{label}</span>
            <div className="flex items-end">
              <div className="h-[9px] w-px bg-night-300" />
              <div style={{ width: barW - 2 }} className="mb-[4px] h-[2px] bg-night-300" />
              <div className="h-[9px] w-px bg-night-300" />
            </div>
          </div>
        )
      })()}

      {/* ── HUD: bottom strip — site score (left) + controls (right) ── */}
      <div className="pointer-events-none absolute bottom-10 left-4 right-4 z-[1000] flex items-start justify-between">

        <div className="flex flex-col gap-1 rounded-lg border border-night-700 bg-night-900/80 px-3 py-2 text-xs text-night-300 backdrop-blur-sm">
          <span className="mb-1 font-semibold text-night-100">Site score</span>

          <span className="flex items-center gap-1.5 border-b border-night-700 pb-1.5 text-night-200">
            <span className="text-night-400">LP index:</span>
            {lpIndex
              ? <span className="font-semibold text-night-100">{lpIndex.scale}</span>
              : <span className="text-night-600">—</span>
            }
          </span>

          <span className="flex items-center gap-1.5 border-b border-night-700 pb-1.5 text-night-200">
            <span className="text-night-400">Elevation:</span>
            {elevLoading
              ? <span className="text-night-500">…</span>
              : elevation !== null
                ? <span className="font-semibold text-night-100">{elevation} m</span>
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

        <div className="flex flex-col items-end gap-2">
          <ExternalActions
            center={center}
            onAddCloudStat={addClimaticProfile}
            onSaveLocation={() => setShowSaveModal(true)}
            onAddMeteogram={addMeteogram}
          />
          <MapControls />
        </div>

      </div>

      {/* ── Yearly Cloud Stat Charts (Persistent Multi-Window) ── */}
      <div className="pointer-events-none absolute inset-0 z-[1001]">
        {activeProfiles.map((p, idx) => (
          <ClimaticProfileChart
            key={p.id}
            lat={p.lat}
            lon={p.lng}
            initialOffset={{ x: 0, y: idx * 20 }}
            onClose={() => removeClimaticProfile(p.id)}
          />
        ))}
      </div>

      {/* ── Meteogram Windows (Persistent Multi-Window) ── */}
      <div className="pointer-events-none absolute inset-0 z-[1001]">
        {activeMeteograms.map((m, idx) => (
          <MeteogramChart
            key={m.id}
            lat={m.lat}
            lon={m.lng}
            initialOffset={{ x: 0, y: idx * 30 }}
            onClose={() => removeMeteogram(m.id)}
          />
        ))}
      </div>

      {/* ── Save Location Modal ── */}
      {showSaveModal && (
        <SaveLocationModal
          lat={center.lat}
          lng={center.lng}
          elevation={elevation}
          lpIndex={lpIndex}
          onClose={() => setShowSaveModal(false)}
          onSaved={() => setShowSaveModal(false)}
        />
      )}

    </div>
  )
}
