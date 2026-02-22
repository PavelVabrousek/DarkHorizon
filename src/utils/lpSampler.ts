/**
 * lpSampler.ts
 *
 * Samples the reprojected Lorenz LP PNG at a given lat/lng and returns
 * the Bortle-scale class by nearest-colour matching in RGB space.
 *
 * The image (/lp/world_low3.png) is in Web Mercator projection covering
 * lat [-65 °, 75 °] × lng [-180 °, 180 °], matching the bounds used in
 * scripts/download_lp.py.  The image is loaded once into a hidden canvas
 * and the raw ImageData is cached for zero-latency subsequent lookups.
 */

const LP_URL = '/lp/world_low3.png'

// Geographic bounds of the reprojected image (must match download_lp.py)
const LAT_MIN = -65
const LAT_MAX =  75

// Web Mercator Y helper  (standard formula, unitless log ratio)
const mercY = (lat: number) =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 180 / 2))

const MERC_Y_MAX = mercY(LAT_MAX)
const MERC_Y_MIN = mercY(LAT_MIN)

// ── Bortle colour table ───────────────────────────────────────────────────────

export interface BortleEntry {
  scale: string   // "0" | "1a" | "1b" | … | "7b"
  name:  string   // human-readable colour name
  r: number
  g: number
  b: number
}

export const BORTLE_TABLE: BortleEntry[] = [
  { scale: '0',  name: 'Black',        r:  13, g:  13, b:  13 },
  { scale: '1a', name: 'Very Dark Gray',r:  43, g:  43, b:  43 },
  { scale: '1b', name: 'Dark Gray',    r:  70, g:  72, b:  78 },
  { scale: '2a', name: 'Dark Blue',    r:  29, g:  60, b: 130 },
  { scale: '2b', name: 'Blue',         r:  42, g:  95, b: 211 },
  { scale: '3a', name: 'Dark Green',   r:  22, g:  98, b:  28 },
  { scale: '3b', name: 'Green',        r:  41, g: 168, b:  52 },
  { scale: '4a', name: 'Olive',        r: 120, g: 110, b:  39 },
  { scale: '4b', name: 'Yellow-Olive', r: 171, g: 154, b:  29 },
  { scale: '5a', name: 'Orange',       r: 196, g: 110, b:  40 },
  { scale: '5b', name: 'Light Orange', r: 234, g: 139, b:  73 },
  { scale: '6a', name: 'Red',          r: 231, g:  83, b:  65 },
  { scale: '6b', name: 'Salmon',       r: 230, g: 141, b: 127 },
  { scale: '7a', name: 'Gray',         r: 152, g: 152, b: 152 },
  { scale: '7b', name: 'Light Gray',   r: 226, g: 226, b: 226 },
]

function nearestBortle(r: number, g: number, b: number): BortleEntry {
  let best     = BORTLE_TABLE[0]
  let bestDist = Infinity
  for (const entry of BORTLE_TABLE) {
    const dist =
      (r - entry.r) ** 2 +
      (g - entry.g) ** 2 +
      (b - entry.b) ** 2
    if (dist < bestDist) { bestDist = dist; best = entry }
  }
  return best
}

// ── Singleton canvas state ────────────────────────────────────────────────────

type Status = 'idle' | 'loading' | 'ready' | 'error'

let status:    Status    = 'idle'
let imageData: ImageData | null = null
let imgWidth   = 0
let imgHeight  = 0
let loadPromise: Promise<void> | null = null

function load(): Promise<void> {
  if (loadPromise) return loadPromise

  loadPromise = new Promise<void>((resolve, reject) => {
    status = 'loading'
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('No 2d context')); return }
      ctx.drawImage(img, 0, 0)
      imgWidth   = canvas.width
      imgHeight  = canvas.height
      imageData  = ctx.getImageData(0, 0, imgWidth, imgHeight)
      status     = 'ready'
      resolve()
    }
    img.onerror = () => {
      status = 'error'
      reject(new Error('Failed to load LP image'))
    }
    img.src = LP_URL
  })

  return loadPromise
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LpSample {
  scale: string
  name:  string
}

/**
 * Returns the Bortle class for the given geographic coordinates, or null
 * if the point is outside the image bounds or the image failed to load.
 *
 * The first call triggers an image download; all subsequent calls read
 * from the cached ImageData with no latency.
 */
export async function sampleLpAt(lat: number, lng: number): Promise<LpSample | null> {
  // Out of bounds check
  if (lat < LAT_MIN || lat > LAT_MAX || lng < -180 || lng > 180) return null

  if (status !== 'ready') {
    try { await load() } catch { return null }
  }

  if (!imageData) return null

  // Web Mercator → normalised [0,1] coordinates
  const nx = (lng + 180) / 360
  const ny = (MERC_Y_MAX - mercY(lat)) / (MERC_Y_MAX - MERC_Y_MIN)

  const px = Math.round(nx * (imgWidth  - 1))
  const py = Math.round(ny * (imgHeight - 1))

  if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) return null

  const i = (py * imgWidth + px) * 4
  const { data } = imageData
  const entry = nearestBortle(data[i], data[i + 1], data[i + 2])
  return { scale: entry.scale, name: entry.name }
}

/**
 * Kick off the image download in the background.
 * Call once on app init so the canvas is warm before the first lookup.
 */
export function preloadLp(): void {
  load().catch(() => { /* silently ignore */ })
}
