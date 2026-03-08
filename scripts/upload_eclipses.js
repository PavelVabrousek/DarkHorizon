import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials. Run with: node --env-file=.env scripts/upload_eclipses.js')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const ECLIPSE_JSON_DIR = 'C:\\Users\\ASUS\\Documents\\GitHub\\EclipseCalculator\\Output_JSON'

async function main() {
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
    console.log('\nIf you got RLS errors, make sure you ran the SQL script to create the table and allow inserts/updates.')
  }
}

main().catch(console.error)
