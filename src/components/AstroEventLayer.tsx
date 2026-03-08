import { useEffect, useState, useRef } from 'react'
import { GeoJSON, useMap, Marker } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../lib/supabase'

interface AstroEventLayerProps {
  eventId: string | null
}

interface LabelData {
  position: [number, number]
  time: string
  duration: string
}

export default function AstroEventLayer({ eventId }: AstroEventLayerProps) {
  const map = useMap()
  const [geoData, setGeoData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [labelPositions, setLabelPositions] = useState<LabelData[]>([])
  const layerRef = useRef<L.GeoJSON>(null)

  useEffect(() => {
    // Immediately clear old geometry when eventId changes
    setGeoData(null)
    setLabelPositions([])
    
    if (!eventId) {
      return
    }

    let ignore = false

    supabase
      .from('astro_events')
      .select('path_geometry, centerline_geometry, kind, label, event_date, metadata, details')
      .eq('id', eventId)
      .single()
      .then(({ data: eventData, error }) => {
        if (ignore) return
        
        if (error || !eventData) {
          console.error("Failed to load event geometry:", error)
          return
        }
        
        const features: GeoJSON.Feature[] = []

        const data = eventData as any
        
        if (data.path_geometry) {
          features.push({
            type: 'Feature',
            properties: { type: 'path', kind: data.kind },
            geometry: data.path_geometry
          })
        }

        if (data.centerline_geometry) {
          features.push({
            type: 'Feature',
            properties: { type: 'centerline' },
            geometry: data.centerline_geometry
          })
          
          // Calculate label positions every ~200km along centerline using details column
          const geom = data.centerline_geometry
          const centerlineDetails = Array.isArray(data.details) ? data.details : []
          
          if (geom && geom.type === 'LineString' && geom.coordinates && geom.coordinates.length > 0 && centerlineDetails.length > 0) {
            const labels: LabelData[] = []
            const targetDistanceKm = 300
            let accumulatedDistance = 0
            let lastLabelDistance = 0
            
            // Helper: Haversine distance in km
            const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
              const R = 6371 // Earth radius in km
              const dLat = (lat2 - lat1) * Math.PI / 180
              const dLon = (lon2 - lon1) * Math.PI / 180
              const a = 
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2)
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
            }
            
            // Format time from ISO string — show HH:MM only
            const formatTime = (isoTime: string) => {
              const d = new Date(isoTime)
              return d.toISOString().split('T')[1].substring(0, 5)
            }
            
            // Format duration from seconds — Xm Ys only, no label
            const formatDuration = (seconds: number) => {
              const mins = Math.floor(seconds / 60)
              const secs = Math.round(seconds % 60)
              return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
            }
            
            // Always place first label using first centerline detail
            if (centerlineDetails[0]) {
              const detail = centerlineDetails[0]
              const [lng, lat] = detail.coords
              labels.push({
                position: [lat, lng],
                time: formatTime(detail.time),
                duration: formatDuration(detail.duration_sec)
              })
            }
            
            // Place labels at ~200km intervals using details data
            for (let i = 1; i < centerlineDetails.length; i++) {
              const prevDetail = centerlineDetails[i - 1]
              const currDetail = centerlineDetails[i]
              
              const [lng1, lat1] = prevDetail.coords
              const [lng2, lat2] = currDetail.coords
              
              const segmentDist = haversine(lat1, lng1, lat2, lng2)
              accumulatedDistance += segmentDist
              
              if (accumulatedDistance - lastLabelDistance >= targetDistanceKm) {
                labels.push({
                  position: [lat2, lng2],
                  time: formatTime(currDetail.time),
                  duration: formatDuration(currDetail.duration_sec)
                })
                lastLabelDistance = accumulatedDistance
              }
            }
            
            setLabelPositions(labels)
          }
        }

        setGeoData({
          type: 'FeatureCollection',
          features
        })
      })
      
    return () => { ignore = true }
  }, [eventId])

  // Fit map to bounds when new data is loaded
  useEffect(() => {
    if (geoData && layerRef.current) {
      try {
        const bounds = layerRef.current.getBounds()
        if (bounds.isValid()) {
          // Add some padding and don't zoom in too much for global events
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5, animate: true, duration: 1.5 })
        }
      } catch (e) {
        console.warn("Could not fit bounds to event geometry", e)
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
            return { color: '#ef4444', weight: 2, opacity: 0.8 } // Red
          }
          
          // Path polygon
          const kind = feature?.properties.kind
          if (kind === 'Annular') {
            return { color: '#f97316', weight: 1, fillColor: '#f97316', fillOpacity: 0.3 }
          }
          
          // Total eclipse default
          return { color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.3 }
        }}
        // Ensure this layer sits below typical markers but above base map
        pane="overlayPane"
      />
      
      {/* Labels along centerline every 250km */}
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
          iconSize: [0, 0],
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
