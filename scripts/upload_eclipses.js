import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

function getArgValue(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function usage() {
  return [
    'Usage:',
    '  node --env-file=.env scripts/upload_eclipses.js --input-dir <path-to-json-dir>',
    '',
    'Required environment variables:',
    '  VITE_SUPABASE_URL',
    '  SUPABASE_SERVICE_ROLE_KEY  (or legacy SUPABASE_SERVICE_KEY)',
    '',
    'Optional:',
    '  ECLIPSE_JSON_DIR can be used instead of --input-dir.',
  ].join('\n')
}

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase admin credentials.\n')
  console.error(usage())
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

const ECLIPSE_JSON_DIR = getArgValue('--input-dir') || process.env.ECLIPSE_JSON_DIR

async function main() {
  if (!ECLIPSE_JSON_DIR) {
    console.error(`Missing input directory.\n\n${usage()}`)
    process.exit(1)
  }

  console.log(`Reading eclipse files from ${ECLIPSE_JSON_DIR}...`)
  
  if (!fs.existsSync(ECLIPSE_JSON_DIR)) {
    console.error(`Directory not found: ${ECLIPSE_JSON_DIR}`)
    process.exit(1)
  }

  const files = fs.readdirSync(ECLIPSE_JSON_DIR).filter(f => f.endsWith('.json'))
  console.log(`Found ${files.length} eclipse files.`)

  let successCount = 0
  let errorCount = 0

  for (const file of files) {
    const filePath = path.join(ECLIPSE_JSON_DIR, file)
    const rawData = fs.readFileSync(filePath, 'utf-8')
    let data
    try {
      data = JSON.parse(rawData)
    } catch (e) {
      console.error(`Failed to parse JSON in ${file}:`, e.message)
      errorCount++
      continue
    }

    // Transform EclipseCalculator JSON into astro_events schema
    const record = {
      id: `solar_eclipse_${data.id}`, // e.g., 'solar_eclipse_20240408'
      event_type: 'solar_eclipse',
      event_date: data.event_date,
      label: data.label,
      kind: data.kind,
      max_duration_sec: data.max_duration_sec,
      metadata: {
        ...(data.metadata || {}),
        centerline_details: data.centerline_details || [],
        ge_time_utc: data.metadata?.ge_time_utc || null,
        duration: data.metadata?.duration || null
      },
      path_geometry: data.geometries?.path || null,
      centerline_geometry: data.geometries?.centerline || null,
      details: data.centerline_details || []
    }

    console.log(`Uploading ${record.id} (${record.label})...`)
    
    const { error } = await supabase
      .from('astro_events')
      .upsert(record, { onConflict: 'id' })

    if (error) {
      console.error(`  Error uploading ${record.id}:`, error.message)
      errorCount++
    } else {
      console.log(`  Success!`)
      successCount++
    }
  }

  console.log('\n--- Upload Complete ---')
  console.log(`Successfully uploaded: ${successCount}`)
  console.log(`Errors: ${errorCount}`)

  if (errorCount > 0) {
    console.log('\nIf you got RLS errors, make sure this script is using a service-role key, not the anon key.')
  }
}

main().catch(console.error)
