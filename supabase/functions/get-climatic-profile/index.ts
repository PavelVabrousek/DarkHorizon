import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const NLAT = 721
const NLON = 1440
const NWEEKS = 52
const PARAMS_PER_WEEK = 4
const BYTES_PER_POINT = NWEEKS * PARAMS_PER_WEEK // 208 bytes
const LATS_PER_PART = 145 // NLAT (721) / 5 parts = 144.2 -> 145 rows per part

// ── B1: Restrict CORS to the configured deployment origin ─────────────────────
// Set ALLOWED_ORIGIN in Supabase Edge Function secrets:
//   supabase secrets set ALLOWED_ORIGIN=https://darkhorizon.vercel.app
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://darkhorizon.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function parseCoordinate(value: unknown, name: 'lat' | 'lon'): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: expected a finite number.`)
  }

  const min = name === 'lat' ? -90 : -180
  const max = name === 'lat' ?  90 :  180
  if (value < min || value > max) {
    throw new Error(`Invalid ${name}: expected ${min}..${max}.`)
  }

  return value
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => null) as { lat?: unknown; lon?: unknown } | null
    if (!body) throw new Error('Invalid JSON request body.')

    const lat = parseCoordinate(body.lat, 'lat')
    const lon = parseCoordinate(body.lon, 'lon')

    // 1. Calculate Grid Coordinates (Nearest Neighbor)
    // ERA5 grid: lat 90 to -90 (721 pts), lon 0 to 359.75 (1440 pts)
    const latIdx = Math.round((90 - lat) / 0.25)
    if (latIdx < 0 || latIdx >= NLAT) {
      throw new Error('Latitude is outside climatic atlas bounds.')
    }

    // Normalize lon to 0-360
    let lonNorm = lon
    while (lonNorm < 0) lonNorm += 360
    while (lonNorm >= 360) lonNorm -= 360
    const lonIdx = Math.round(lonNorm / 0.25) % NLON

    // 2. Determine which part file to read
    const partNumber = Math.floor(latIdx / LATS_PER_PART) + 1
    const clampedPart = Math.min(partNumber, 5)
    const localLatIdx = latIdx % LATS_PER_PART
    if (clampedPart < 1 || clampedPart > 5 || localLatIdx < 0 || localLatIdx >= LATS_PER_PART) {
      throw new Error('Computed atlas partition is out of bounds.')
    }

    // 3. Calculate Byte Offset in the part file
    // offset = (local_y * NLON + x) * BYTES_PER_POINT
    const byteOffset = (localLatIdx * NLON + lonIdx) * BYTES_PER_POINT
    const byteEnd = byteOffset + BYTES_PER_POINT - 1
    if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteEnd < byteOffset) {
      throw new Error('Computed atlas byte range is invalid.')
    }

    const fileName = `climatic_atlas_part${clampedPart}.bin`

    // 4. Fetch data from Supabase Storage using a signed URL + Range request.
    //    The high-level .download() SDK does not support Range, so we generate
    //    a signed URL and use standard fetch for the byte-range request.
    //    A6: Removed the dead .download() SDK call that previously preceded this.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: urlData, error: urlError } = await supabaseAdmin
      .storage
      .from('climatic-data')
      .createSignedUrl(fileName, 300) // 5-minute TTL — generous for any latency

    if (urlError || !urlData) {
      // B2: Log internal details server-side; return a sanitised message to client
      console.error('get-climatic-profile: signed URL error:', urlError)
      throw new Error('Failed to access climatic data storage.')
    }

    const rangeResponse = await fetch(urlData.signedUrl, {
      headers: { 'Range': `bytes=${byteOffset}-${byteEnd}` }
    })

    if (!rangeResponse.ok && rangeResponse.status !== 206) {
      console.error('get-climatic-profile: range fetch failed:', rangeResponse.status, rangeResponse.statusText)
      throw new Error('Failed to read climatic data.')
    }

    const arrayBuffer = await rangeResponse.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)

    if (bytes.length !== BYTES_PER_POINT) {
      console.error(`get-climatic-profile: expected ${BYTES_PER_POINT} bytes, got ${bytes.length}`)
      throw new Error('Unexpected data length returned from storage.')
    }

    // 5. Decode data into weekly profile
    const profile = []
    for (let w = 0; w < NWEEKS; w++) {
      const start = w * PARAMS_PER_WEEK
      profile.push({
        week: w + 1,
        mean: bytes[start] / 255.0,
        min:  bytes[start + 1] / 255.0,
        max:  bytes[start + 2] / 255.0,
        prob: bytes[start + 3] / 255.0,
      })
    }

    // C5: climatic atlas is static data — safe to cache for 24 hours at CDN/browser level
    return new Response(
      JSON.stringify({
        lat: lat.toFixed(2),
        lon: lon.toFixed(2),
        grid_lat: (90 - latIdx * 0.25).toFixed(2),
        grid_lon: (lonIdx * 0.25).toFixed(2),
        profile
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400', // C5: cache for 24 h
        },
        status: 200
      }
    )

  } catch (error) {
    // B2: Only the sanitised message goes to the client; raw detail already logged above
    const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
