import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, WMSTileLayer, ImageOverlay, useMap, useMapEvents } from 'react-leaflet'
// TileLayer: base maps + GIBS IR satellite overlay
// WMSTileLayer: EUMETSAT EUMETView Meteosat IR (fills the Europe/Africa gap)
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import { useMapSettings } from '../store/mapSettings'
import MapControls from './MapControls'
import ExternalActions from './ExternalActions'
import SearchBar, { type SearchSelectPayload } from './SearchBar'
import LocationMarkers from './LocationMarkers'
import { preloadLp, sampleLpAt, type LpSample } from '../utils/lpSampler'
import EventSelector from './EventSelector'
import AstroEventLayer from './AstroEventLayer'
import TimeController from './TimeController'

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

const PANE_ESRI   = 'paneEsri'
const PANE_TOPO   = 'paneTopo'
const PANE_SAT    = 'paneSat'
const PANE_LP     = 'paneLp'
const PANE_SAT_IR  = 'paneSatIr'    // IR satellite cloud layer (NASA GIBS)
const PANE_FORECAST = 'paneForecast' // OWM cloud-cover forecast (Weather Maps 2.0)
const PANE_CLOUD   = 'paneCloud'    // Precipitation radar (RainViewer)

// ESRI Physical: simple darken – preserves the hypsometric palette.
const FILTER_ESRI = 'brightness(0.60) contrast(1.10) saturate(0.85)'
// OpenTopoMap: slight darken + desaturate so contour lines stay readable.
const FILTER_TOPO = 'brightness(0.50) contrast(1.10) saturate(0.65)'
// ESRI Satellite: mild darkening only – keeps terrain features identifiable.
const FILTER_SAT  = 'brightness(0.82) contrast(1.06) saturate(0.88)'
// LP overlay: no filter – the Lorenz color palette is already dark-sky themed.
// IR satellite: no filter – GIBS tiles use a calibrated IR colour scale; transparent where clear.
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
  const mpp     = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * Math.pow(2, zoom))
  const maxM    = mpp * SCALE_MAX_PX
  const niceM   = SCALE_NICE_METRES.filter((v) => v <= maxM).pop() ?? SCALE_NICE_METRES[0]
  const px      = niceM / mpp
  const label   = niceM >= 1_000 ? `${niceM / 1_000} km` : `${niceM} m`
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
    if (!map.getPane(PANE_SAT_IR)) {
      const p = map.createPane(PANE_SAT_IR)
      // Sits above LP (400); IR cloud below forecast so forecast is clearly readable
      p.style.zIndex = '410'
      // Grayscale: normalises all four satellite sources to uniform B&W.
      // Cold cloud tops = bright white; clear sky = dark.
      p.style.filter = 'grayscale(1)'
    }
    if (!map.getPane(PANE_FORECAST)) {
      const p = map.createPane(PANE_FORECAST)
      // Between IR satellite (410) and precipitation radar (420)
      p.style.zIndex = '415'
      // No filter — OWM cloud tiles use a clear blue/white palette that works
      // well on a dark map without any colour transformation.
    }
    if (!map.getPane(PANE_CLOUD)) {
      const p = map.createPane(PANE_CLOUD)
      // Sits above forecast (415) so active precipitation is the topmost cue
      p.style.zIndex = '420'
      p.style.filter = FILTER_CLOUD
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

// ── IR satellite cloud overlay ───────────────────────────────────────────────

/**
 * NASA GIBS IR satellite overlay — three geostationary satellites for near-global coverage.
 * Source: NASA GIBS (Global Imagery Browse Services) — free, no API key required.
 *
 * Satellites used (Band 13, 10.3 μm clean IR window):
 *   GOES-East  (75.2°W) — Americas, Atlantic, western Europe edge
 *   GOES-West (137.2°W) — Pacific, western Americas
 *   Himawari   (140.7°E) — Asia, Australia, eastern Pacific
 *
 * Together they provide near-global coverage. The only gap is ~15°E–60°E
 * (Europe/Africa/Indian Ocean — Meteosat territory), which is not available
 * on the NASA GIBS free API.
 *
 * Tile URL format:
 *   {GIBS_BASE}{layer}/default/{YYYY-MM-DDTHH:MM:00Z}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png
 *   • Tiles are transparent PNG where the satellite disk doesn't reach — the base
 *     map simply shows through, so overlapping layers compose seamlessly.
 *   • maxNativeZoom = 6 for all three satellites.
 *
 * Processing delays:
 *   GOES-East / GOES-West: ~50 min behind real-time
 *   Himawari:              ~70 min behind real-time
 */
const GIBS_BASE   = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
const GIBS_TMSID  = 'GoogleMapsCompatible_Level6'

const SAT_IR_REFRESH_MS = 10 * 60 * 1_000  // 10 minutes

/** Per-satellite descriptor: layer name, processing delay in minutes, short label. */
const SAT_IR_LAYERS = [
  { id: 'goes-east', layer: 'GOES-East_ABI_Band13_Clean_Infrared', delay: 50, label: 'GOES-East' },
  { id: 'goes-west', layer: 'GOES-West_ABI_Band13_Clean_Infrared', delay: 50, label: 'GOES-West' },
  { id: 'himawari',  layer: 'Himawari_AHI_Band13_Clean_Infrared',  delay: 70, label: 'Himawari'  },
] as const

/**
 * Round the current UTC clock back by `delayMinutes` and floor to the nearest
 * 10-minute boundary, returning an ISO-8601 string like "2026-03-01T17:10:00Z".
 */
function gibsTime(delayMinutes: number): string {
  const d = new Date(Date.now() - delayMinutes * 60 * 1_000)
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10, 0, 0)
  return d.toISOString().slice(0, 19) + 'Z'
}

/**
 * IR satellite overlay — three NASA GIBS Band 13 TileLayers stacked in the
 * same pane.  Each layer covers its satellite's hemisphere; transparent areas
 * fall through to the layer below, producing seamless near-global coverage.
 *
 * No external API fetch needed — tile URLs are derived from the system clock.
 * Lazy (activates only on first enable) + auto-refreshing every 10 min.
 */
function SatIrOverlay() {
  const { satIrVisible, satIrOpacity } = useMapSettings()
  // A refresh counter that increments every 10 min → forces URL recomputation
  const [refreshCount, setRefreshCount] = useState(0)
  const [everShown, setEverShown] = useState(false)

  useEffect(() => {
    if (satIrVisible) setEverShown(true)
  }, [satIrVisible])

  useEffect(() => {
    if (!everShown) return
    const id = setInterval(() => setRefreshCount((c) => c + 1), SAT_IR_REFRESH_MS)
    return () => clearInterval(id)
  }, [everShown])

  if (!everShown) return null

  const opacity = satIrVisible ? satIrOpacity : 0

  return (
    <>
      {/* ── GIBS: GOES-East, GOES-West, Himawari (Americas / Pacific / Asia) ── */}
      {SAT_IR_LAYERS.map(({ id, layer, delay, label }) => {
        const time = gibsTime(delay)
        const url  = `${GIBS_BASE}${layer}/default/${time}/${GIBS_TMSID}/{z}/{y}/{x}.png`
        return (
          <TileLayer
            // key changes on each refresh → Leaflet remounts and flushes stale tiles
            key={`${id}-${refreshCount}`}
            url={url}
            attribution={`IR satellite &copy; <a href="https://earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs">NASA GIBS</a> / ${label}`}
            pane={PANE_SAT_IR}
            opacity={opacity}
            maxNativeZoom={6}
            maxZoom={MAP_MAX_ZOOM}
            tileSize={256}
          />
        )
      })}

      {/*
       * ── EUMETSAT Meteosat MSG: fills the Europe / Africa / Indian Ocean gap ──
       *
       * Source: EUMETSAT EUMETView WMS — free, no API key required.
       * Layer: msg_fes:ir108 — Meteosat Second Generation, full Earth scan,
       *        10.8 μm clean-IR window (equivalent to GOES Band 13).
       * Coverage: ~80°W – 80°E, 80°S – 80°N (centred on 0° longitude).
       * Update:   every 15 min; WMS serves the latest available frame by default.
       *
       * react-leaflet's WMSTileLayer slices the WMS into 256-px tiles using
       * GetMap requests — no manual tile URL computation needed.
       */}
      <WMSTileLayer
        key={`meteosat-${refreshCount}`}
        url="https://view.eumetsat.int/geoserver/ows"
        layers="msg_fes:ir108"
        format="image/png"
        transparent={true}
        version="1.1.1"
        attribution='IR satellite &copy; <a href="https://www.eumetsat.int/">EUMETSAT</a> / Meteosat'
        pane={PANE_SAT_IR}
        opacity={opacity}
      />
    </>
  )
}

// ── Cloud-coverage forecast overlay — Open-Meteo ─────────────────────────────

/**
 * Compute the Unix timestamp (seconds UTC) for the next local midnight at the
 * given longitude. Uses a simple lng/15 → UTC-offset estimate (±30 min error
 * for most regions) which is sufficient for hourly forecast purposes.
 *
 * @param lngDeg  Map-centre longitude in degrees (−180 to +180)
 * @returns       Unix timestamp in seconds for the next 00:00 local time
 */
function nextMidnightTimestamp(lngDeg: number): number {
  const utcOffsetMs       = Math.round(lngDeg / 15) * 3_600_000
  const nowLocalMs        = Date.now() + utcOffsetMs
  const dayMs             = 86_400_000
  // Always the *next* day boundary — i.e. "tonight's midnight"
  const nextMidnightLocal = (Math.floor(nowLocalMs / dayMs) + 1) * dayMs
  return (nextMidnightLocal - utcOffsetMs) / 1000  // → UTC seconds
}

// ── Open-Meteo grid helpers ───────────────────────────────────────────────────

/**
 * Compute the grid step (°) so we get roughly 50–150 points for any viewport.
 * Derived from the viewport's longer axis rather than zoom, so global views
 * get a coarser step (20°→162 pts) and local views a finer one (0.5°→~25 pts).
 */
function computeGridStep(bounds: L.LatLngBounds): number {
  const latRange  = bounds.getNorth() - bounds.getSouth()
  const lngRange  = Math.min(bounds.getEast() - bounds.getWest(), 360)
  const maxRange  = Math.max(latRange, lngRange)
  // Target ~10 divisions along the longer axis → max ~100 points per axis
  const ideal     = maxRange / 10
  const niceSteps = [0.25, 0.5, 1, 2, 5, 10, 20]
  return niceSteps.find(s => s >= ideal) ?? 20
}

interface GridPoint { lat: number; lng: number }

/**
 * Generate a 2-D grid of lat/lng points covering `bounds`, snapped to
 * multiples of `step` degrees. Returns at most 250 points (safe for the
 * Open-Meteo batch API).
 * Longitudes are clamped to [−180, 180] for API compatibility.
 */
function generateGrid(bounds: L.LatLngBounds, step: number): GridPoint[] {
  const points: GridPoint[] = []
  const south = Math.floor(bounds.getSouth() / step) * step
  const north = Math.ceil (bounds.getNorth() / step) * step
  const west  = Math.floor(bounds.getWest()  / step) * step
  const east  = Math.ceil (bounds.getEast()  / step) * step

  // Use integer counters to avoid floating-point drift
  const latN = Math.round((north - south) / step)
  const lngN = Math.round((east  - west)  / step)

  for (let r = 0; r <= latN; r++) {
    const lat = south + r * step
    if (lat < -90 || lat > 90) continue
    for (let c = 0; c <= lngN; c++) {
      const rawLng = west + c * step
      // Normalise to [−180, 180] for the Open-Meteo API
      const lng = ((rawLng + 180) % 360 + 360) % 360 - 180
      points.push({ lat, lng })
      if (points.length >= 250) return points
    }
  }
  return points
}

/**
 * Fetch hourly `cloud_cover` (0–100 %) from Open-Meteo for a grid of points.
 * Uses the batch API (comma-separated lat/lng lists).
 * Returns cloud cover at the target UTC timestamp for each point.
 *
 * IMPORTANT: URL is built as a raw template literal — NOT via URLSearchParams —
 * because URLSearchParams.set() percent-encodes commas as %2C, which the
 * Open-Meteo batch endpoint does not always handle correctly.
 *
 * Free, no API key, global coverage, forecast up to 7 days.
 */
async function fetchCloudCoverGrid(
  points:    GridPoint[],
  timestamp: number,
  signal:    AbortSignal,
  attempt  = 0,
): Promise<number[]> {
  if (points.length === 0) return []

  const lats = points.map(p => p.lat.toFixed(2)).join(',')
  const lngs = points.map(p => p.lng.toFixed(2)).join(',')
  // Raw commas in the URL — do NOT use new URL() + searchParams here
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lats}&longitude=${lngs}` +
    `&hourly=cloud_cover&forecast_days=7&timezone=UTC`

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)

  const data = await res.json() as unknown

  // API error payload → { error: true, reason: "..." }
  if (data && typeof data === 'object' && !Array.isArray(data) &&
      'error' in (data as object)) {
    const reason = (data as Record<string, unknown>).reason ?? res.status
    // Retry once after 3 s on transient errors (rate-limit / cold-start)
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 3_000))
      return fetchCloudCoverGrid(points, timestamp, signal, attempt + 1)
    }
    throw new Error(`Open-Meteo error: ${reason}`)
  }

  // Single point → plain object; multiple points → array
  const locations: Array<{ hourly: { time: string[]; cloud_cover: number[] } }> =
    Array.isArray(data) ? data : [data as { hourly: { time: string[]; cloud_cover: number[] } }]

  // Target hour as ISO-8601 prefix: "2026-03-02T00:00"
  const target = new Date(timestamp * 1000).toISOString().slice(0, 16)

  return locations.map(loc => {
    const idx = loc.hourly?.time?.findIndex((t: string) => t.startsWith(target)) ?? -1
    return idx !== -1 ? (loc.hourly.cloud_cover[idx] ?? 0) : 0
  })
}

/**
 * Render cloud cover values onto a tiny canvas (1 pixel per grid point).
 * Leaflet's ImageOverlay stretches this to the map bounds with smooth
 * bilinear interpolation — effectively free IDW visualisation.
 *
 * Colour: RGBA(195, 210, 230, α) — cool blue-gray overcast tones.
 * Alpha:  0 for <10 % cloud; proportional up to 210/255 at 100 % cloud.
 */
function renderCloudCanvas(rows: number, cols: number, values: number[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width  = Math.max(1, cols)
  canvas.height = Math.max(1, rows)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(cols, rows)

  for (let i = 0; i < rows * cols; i++) {
    const cloud = values[i] ?? 0
    const alpha = cloud < 10 ? 0 : Math.round((cloud / 100) * 210)
    img.data[i * 4]     = 195   // R
    img.data[i * 4 + 1] = 210   // G
    img.data[i * 4 + 2] = 230   // B — cool blue-gray
    img.data[i * 4 + 3] = alpha
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Cloud-coverage FORECAST overlay — Open-Meteo batch API, free, no key.
 *
 * Strategy:
 *  1. On enable / map pan / zoom: generate a coarse lat/lng grid (~2° steps).
 *  2. Batch-fetch `cloud_cover` for all grid points from Open-Meteo.
 *  3. Render a tiny canvas (1 px / grid point) with colour ∝ cloud %.
 *  4. Set as the source of an <ImageOverlay> covering the same bounds.
 *  5. Browser upscales the canvas with bilinear interpolation → smooth gradient.
 *
 * Refreshes are debounced 800 ms after each pan/zoom to avoid excessive calls.
 */
function ForecastCanvasOverlay() {
  const { forecastVisible, forecastOpacity, forecastTimestamp } = useMapSettings()
  const map = useMap()

  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [imageBounds, setImageBounds] =
    useState<[[number, number], [number, number]] | null>(null)
  const [everShown, setEverShown] = useState(false)

  const abortRef    = useRef<AbortController | null>(null)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable ref always pointing to the latest refresh fn — used by the stable
  // debounced listener so map.on/off only fires once per everShown toggle.
  const refreshRef  = useRef<() => void>(() => { /* placeholder */ })

  useEffect(() => {
    if (forecastVisible) setEverShown(true)
  }, [forecastVisible])

  const refresh = useCallback(async () => {
    if (!forecastVisible || forecastTimestamp === 0) return

    // Cancel any previous in-flight request
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const bounds = map.getBounds()
    const step   = computeGridStep(bounds)   // viewport-aware step
    const pts    = generateGrid(bounds, step)
    if (pts.length === 0) return

    // Pre-compute grid dimensions for canvas layout
    const south = Math.floor(bounds.getSouth() / step) * step
    const north = Math.ceil (bounds.getNorth() / step) * step
    const west  = Math.floor(bounds.getWest()  / step) * step
    const east  = Math.ceil (bounds.getEast()  / step) * step
    const rows  = Math.round((north - south) / step) + 1
    const cols  = Math.round((east  - west)  / step) + 1

    try {
      const raw = await fetchCloudCoverGrid(pts, forecastTimestamp, abortRef.current.signal)

      // Place values into row-major order; row 0 = northernmost (canvas top).
      // Use raw loop index to map each point to its grid cell — no re-normalisation
      // needed because pts is generated in strict south→north, west→east order.
      const grid = new Array<number>(rows * cols).fill(0)
      let idx = 0
      for (let r = 0; r <= Math.round((north - south) / step); r++) {
        const lat = south + r * step
        if (lat < -90 || lat > 90) { idx++; continue }
        for (let c = 0; c <= Math.round((east - west) / step); c++) {
          if (idx >= raw.length) break
          const row = Math.round((north - lat) / step)
          if (row >= 0 && row < rows && c >= 0 && c < cols) {
            grid[row * cols + c] = raw[idx]
          }
          idx++
        }
      }

      const canvas = renderCloudCanvas(rows, cols, grid)
      setImageUrl(canvas.toDataURL('image/png'))
      setImageBounds([
        [bounds.getSouth(), bounds.getWest()],
        [bounds.getNorth(), bounds.getEast()],
      ])
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        console.warn('[ForecastCanvasOverlay] fetch error:', e)
        // Keep the last good image — layer stays visible until next successful refresh
      }
    }
  }, [forecastVisible, forecastTimestamp, map])

  // Keep refreshRef pointing to the latest refresh so the stable debounced
  // listener always calls the current version without causing re-registration.
  useEffect(() => { refreshRef.current = refresh }, [refresh])

  // Trigger refresh immediately when first enabled or when the timestamp changes.
  useEffect(() => {
    if (!everShown || forecastTimestamp === 0) return
    refreshRef.current()
  }, [everShown, forecastTimestamp])

  // Stable debounced listener — empty deps so the function reference never
  // changes → map.on/off fires exactly once (when everShown toggles).
  const debouncedRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => refreshRef.current(), 800)
  }, []) // intentionally no deps — stable via refreshRef

  // Register map event listeners once when the layer is first activated.
  useEffect(() => {
    if (!everShown) return
    map.on('moveend', debouncedRefresh)
    map.on('zoomend', debouncedRefresh)
    return () => {
      map.off('moveend', debouncedRefresh)
      map.off('zoomend', debouncedRefresh)
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [everShown, map, debouncedRefresh])

  if (!everShown || !imageUrl || !imageBounds) return null

  return (
    <ImageOverlay
      key={imageUrl}
      url={imageUrl}
      bounds={imageBounds}
      opacity={forecastVisible ? forecastOpacity : 0}
      pane={PANE_FORECAST}
    />
  )
}

// ── Cloud coverage overlay ────────────────────────────────────────────────────

/**
 * Shape of the RainViewer public weather-maps API response.
 * Endpoint: https://api.rainviewer.com/public/weather-maps.json
 * No API key required — completely free.
 *
 * Note: satellite.infrared is returned empty by the free API tier.
 * We use radar.past instead, which is always populated and equally
 * useful for astronomy planning (shows active precipitation systems).
 */
interface RainViewerResponse {
  /** CDN host, e.g. "https://tilecache.rainviewer.com" */
  host: string
  radar: {
    /** Available radar frames, sorted oldest → newest (~5-min cadence). */
    past: Array<{ time: number; path: string }>
  }
  satellite: {
    /** Free tier returns this as an empty array; kept for future fallback. */
    infrared: Array<{ time: number; path: string }>
  }
}

/**
 * How often (ms) we poll the RainViewer API to get a fresh tile timestamp.
 * RainViewer updates radar composites every ~5 minutes.
 */
const CLOUD_REFRESH_MS = 5 * 60 * 1_000   // 5 minutes

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json'

/**
 * Precipitation-radar TileLayer driven by RainViewer's free radar composites.
 *
 * Tile URL anatomy:
 *   {host}{path}/256/{z}/{x}/{y}/{colorScheme}/{options}.png
 *   color scheme 7 = "Dark Sky" — dark background, cyan/blue precipitation tones,
 *                     ideal for dark-themed maps
 *   options 1_1    = smooth=1, snow=1
 *
 * Source priority:
 *   1. satellite.infrared (infrared cloud coverage) – preferred but currently
 *      empty on the free tier
 *   2. radar.past (precipitation radar) – reliably available on the free tier
 *
 * Behaviour:
 *  • Lazy: the first API fetch only fires once the user enables the layer.
 *  • Auto-refresh: a 5-min interval keeps the timestamp current while
 *    the overlay remains visible.
 *  • Graceful: fetch errors are silently ignored; the last good tile URL
 *    stays in place until the next successful refresh.
 */
function CloudOverlay() {
  const { cloudVisible, cloudOpacity } = useMapSettings()
  const [tileUrl, setTileUrl]   = useState<string | null>(null)
  const [everShown, setEverShown] = useState(false)

  // Only start fetching once the user has turned the layer on at least once
  useEffect(() => {
    if (cloudVisible) setEverShown(true)
  }, [cloudVisible])

  const fetchLatestTileUrl = useCallback(async () => {
    try {
      const res  = await fetch(RAINVIEWER_API)
      const data = await res.json() as RainViewerResponse

      // Prefer infrared satellite (shows all clouds); fall back to radar
      const satFrames   = data.satellite?.infrared
      const radarFrames = data.radar?.past

      if (satFrames?.length) {
        // Infrared satellite: color 2 "Universal Blue"
        const latest = satFrames[satFrames.length - 1]
        setTileUrl(`${data.host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`)
      } else if (radarFrames?.length) {
        // Precipitation radar: color 7 "Dark Sky" — fits the dark map theme
        const latest = radarFrames[radarFrames.length - 1]
        setTileUrl(`${data.host}${latest.path}/256/{z}/{x}/{y}/7/1_1.png`)
      }
    } catch {
      // Silently keep the previous tile URL on any network / parse error
    }
  }, [])

  // Fetch immediately when the layer is first enabled, then refresh every 5 min
  useEffect(() => {
    if (!everShown) return
    fetchLatestTileUrl()
    const id = setInterval(fetchLatestTileUrl, CLOUD_REFRESH_MS)
    return () => clearInterval(id)
  }, [everShown, fetchLatestTileUrl])

  if (!everShown || !tileUrl) return null

  return (
    <TileLayer
      // Re-mount when the URL changes so Leaflet flushes stale tiles
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

  // ── Search bar expand / auto-collapse ────────────────────────────────────────
  const [searchExpanded, setSearchExpanded] = useState(false)
  const searchCollapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Astro Events ─────────────────────────────────────────────────────────────
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const {
    satelliteMode, setSatelliteMode,
    forecastVisible, forecastTimestamp, setForecastTimestamp,
  } = useMapSettings()

  /**
   * When the cloud-forecast layer is first enabled, auto-compute and set the
   * forecast timestamp to the next local midnight at the current map centre.
   * Does nothing after the first set (forecastTimestamp !== 0).
   */
  useEffect(() => {
    if (forecastVisible && forecastTimestamp === 0) {
      setForecastTimestamp(nextMidnightTimestamp(center.lng))
    }
  }, [forecastVisible, forecastTimestamp, center.lng, setForecastTimestamp])

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

  /** Fly to a location returned by the search bar, then auto-collapse after 10 s. */
  const handleSearchSelect = useCallback(({ lat, lng, extent }: SearchSelectPayload) => {
    const map = mapRef.current
    if (!map) return
    if (extent) {
      const [west, north, east, south] = extent
      map.fitBounds([[south, west], [north, east]], { padding: [60, 60], maxZoom: 15, animate: true, duration: 1.2 })
    } else {
      map.flyTo([lat, lng], Math.min(Math.max(zoom, 12), 15), { duration: 1.2 })
    }
    // Auto-collapse the search bar 10 s after a result is selected
    if (searchCollapseTimerRef.current) clearTimeout(searchCollapseTimerRef.current)
    searchCollapseTimerRef.current = setTimeout(() => setSearchExpanded(false), 10_000)
  }, [zoom])

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
        <MapRefCapture mapRef={mapRef} />
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

        {/* ── Overlay: IR satellite – NASA GIBS GOES-East Band 13 (optional, user-toggled) ── */}
        <SatIrOverlay />

        {/* ── Overlay: Cloud forecast – Open-Meteo canvas (optional, user-toggled) ── */}
        <ForecastCanvasOverlay />

        {/* ── Overlay: Precipitation radar – RainViewer (optional, user-toggled) ── */}
        <CloudOverlay />

        {/* ── Astro Event Layer (e.g. Solar Eclipses) ── */}
        <AstroEventLayer eventId={selectedEventId} />

        {/* ── Observation sites fetched from Supabase ── */}
        <LocationMarkers />

      </MapContainer>

      {/* ── Global Time Controller ── */}
      <TimeController />

      {/* ── Crosshair — fixed center-of-map indicator ── */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-[999] -translate-x-1/2 -translate-y-1/2 opacity-30">
        <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-white" aria-hidden="true">
          {/* Horizontal arms with center gap */}
          <line x1="0"  y1="12" x2="9"  y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="15" y1="12" x2="24" y2="12" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          {/* Vertical arms with center gap */}
          <line x1="12" y1="0"  x2="12" y2="9"  stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="12" y1="15" x2="12" y2="24" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          {/* Centre dot */}
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

      {/* ── HUD: search buttons / expandable bars — top-left, below branding ── */}
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

      {/* ── HUD: layer indicator / satellite toggle pill ──────────────────────────
            • zoom < 12  → plain informational text (non-interactive)
            • zoom ≥ 12  → clickable button toggling topo ↔ satellite
            Active satellite state gets an indigo tint so the mode is unmistakable. ── */}
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
          {/* Small camera icon */}
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

      {/* ── HUD: coordinate bar — top-right, below the layer indicator ── */}
      <div className="pointer-events-none absolute right-3 top-10 z-[1000] rounded-full border border-night-700 bg-night-900/80 px-3 py-1 font-mono text-xs text-night-300 backdrop-blur-sm">
        {formatCoord(center.lat, center.lng)}
      </div>

      {/* ── HUD: scale bar — top-right, below coordinate bar ── */}
      {(() => {
        const { px, label } = computeScale(center.lat, zoom)
        const barW = Math.round(px)
        return (
          <div className="pointer-events-none absolute right-3 top-16 z-[1000] flex flex-col items-end gap-1 rounded-full border border-night-700 bg-night-900/80 px-3 py-1.5 opacity-50 backdrop-blur-sm">
            <span className="font-mono text-xs leading-none text-night-300">
              {label}
            </span>
            {/* Scale bar: left tick + horizontal line + right tick */}
            <div className="flex items-end">
              <div className="h-[9px] w-px bg-night-300" />
              <div style={{ width: barW - 2 }} className="mb-[4px] h-[2px] bg-night-300" />
              <div className="h-[9px] w-px bg-night-300" />
            </div>
          </div>
        )
      })()}

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

          {/* Elevation row — fetched from Open-Meteo after map settles */}
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

        {/* Right-side controls: External Actions above Layers */}
        <div className="flex flex-col items-end gap-2">
          <ExternalActions center={center} />
          <MapControls />
        </div>

      </div>
    </div>
  )
}
