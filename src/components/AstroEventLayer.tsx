import { useEffect, useState, useRef } from 'react'
import { GeoJSON, useMap, Marker } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

// B3: Typed from the Database schema — no `as any` escape hatch
type AstroEventRow = Database['public']['Tables']['astro_events']['Row']

interface AstroEventLayerProps {
  eventId: string | null
}

interface LabelData {
  position: [number, number]
  time: string
  duration: string
}

// ── C2: Module-scope helpers (previously recreated inside useEffect) ──────────

/** Haversine great-circle distance in km between two WGS-84 points. */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Format an ISO timestamp string as HH:MM (UTC only). */
function formatTime(isoTime: string): string {
  return new Date(isoTime).toISOString().split('T')[1].substring(0, 5)
}

/** Format a duration in seconds as "Xm Ys" (or "Ys" when < 1 min). */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AstroEventLayer({ eventId }: AstroEventLayerProps) {
  const map = useMap()
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [labelPositions, setLabelPositions] = useState<LabelData[]>([])
  const layerRef = useRef<L.GeoJSON>(null)

  useEffect(() => {
    // Clear old geometry immediately when eventId changes
    setGeoData(null)
    setLabelPositions([])

    if (!eventId) return

    let ignore = false

    supabase
      .from('astro_events')
      .select('path_geometry, centerline_geometry, kind, label, event_date, metadata, details')
      .eq('id', eventId)
      .single()
      .then(({ data: eventData, error }) => {
        if (ignore) return

        if (error || !eventData) {
          console.error('Failed to load event geometry:', error)
          return
        }

        // B3: Use the typed row — cast geometry columns to their GeoJSON shapes.
        //     The DB stores these as JSON; we assert the expected GeoJSON type
        //     rather than escaping with `as any`.
        const data          = eventData as AstroEventRow
        const pathGeom      = data.path_geometry      as GeoJSON.Geometry | null
        const centerlineGeom = data.centerline_geometry as (GeoJSON.LineString & { coordinates: [number, number][] }) | null

        const features: GeoJSON.Feature[] = []

        if (pathGeom) {
          features.push({
            type: 'Feature',
            properties: { type: 'path', kind: data.kind },
            geometry: pathGeom,
          })
        }

        if (centerlineGeom) {
          features.push({
            type: 'Feature',
            properties: { type: 'centerline' },
            geometry: centerlineGeom,
          })

          // Place labels every ~300 km along the centerline using per-point details
          const centerlineDetails = Array.isArray(data.details) ? data.details as Array<{
            coords: [number, number]
            time: string
            duration_sec: number
          }> : []

          if (
            centerlineGeom.type === 'LineString' &&
            centerlineGeom.coordinates.length > 0 &&
            centerlineDetails.length > 0
          ) {
            const labels: LabelData[] = []
            const targetDistanceKm = 300
            let accumulatedDistance = 0
            let lastLabelDistance   = 0

            // Always place a label at the first point
            if (centerlineDetails[0]) {
              const [lng, lat] = centerlineDetails[0].coords
              labels.push({
                position: [lat, lng],
                time:     formatTime(centerlineDetails[0].time),
                duration: formatDuration(centerlineDetails[0].duration_sec),
              })
            }

            for (let i = 1; i < centerlineDetails.length; i++) {
              const prev = centerlineDetails[i - 1]
              const curr = centerlineDetails[i]
              const [lng1, lat1] = prev.coords
              const [lng2, lat2] = curr.coords

              accumulatedDistance += haversine(lat1, lng1, lat2, lng2)

              if (accumulatedDistance - lastLabelDistance >= targetDistanceKm) {
                labels.push({
                  position: [lat2, lng2],
                  time:     formatTime(curr.time),
                  duration: formatDuration(curr.duration_sec),
                })
                lastLabelDistance = accumulatedDistance
              }
            }

            setLabelPositions(labels)
          }
        }

        setGeoData({ type: 'FeatureCollection', features })
      })

    return () => { ignore = true }
  }, [eventId])

  // Fit map to event bounds when new data is loaded
  useEffect(() => {
    if (geoData && layerRef.current) {
      try {
        const bounds = layerRef.current.getBounds()
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5, animate: true, duration: 1.5 })
        }
      } catch (e) {
        console.warn('Could not fit bounds to event geometry', e)
      }
    }
  }, [geoData, map])

  if (!geoData || !eventId) return null

  return (
    <>
      <GeoJSON
        key={eventId}
        ref={layerRef}
        data={geoData}
        style={(feature) => {
          if (feature?.properties.type === 'centerline') {
            return { color: '#ef4444', weight: 2, opacity: 0.8 }
          }
          const kind = feature?.properties.kind
          if (kind === 'Annular') {
            return { color: '#f97316', weight: 1, fillColor: '#f97316', fillOpacity: 0.3 }
          }
          return { color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.3 }
        }}
        pane="overlayPane"
      />

      {/* Labels along centerline every ~300 km */}
      {labelPositions.map((label, idx) => {
        const labelIcon = L.divIcon({
          className: '',
          html: `
            <div style="
              background: transparent;
              border: none;
              white-space: nowrap;
              font-size: 11px;
              font-weight: 600;
              font-family: ui-monospace, monospace;
              color: #000;
              pointer-events: none;
              line-height: 1.5;
              text-shadow:
                -1px -1px 0 rgba(255,255,255,0.9),
                 1px -1px 0 rgba(255,255,255,0.9),
                -1px  1px 0 rgba(255,255,255,0.9),
                 1px  1px 0 rgba(255,255,255,0.9);
            ">
              <div>${label.time}</div>
              ${label.duration ? `<div>${label.duration}</div>` : ''}
            </div>
          `,
          iconSize:   [0, 0],
          iconAnchor: [0, 0],
        })

        return (
          <Marker
            key={`${eventId}-label-${idx}`}
            position={label.position}
            icon={labelIcon}
            interactive={false}
          />
        )
      })}
    </>
  )
}
