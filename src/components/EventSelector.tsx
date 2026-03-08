import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useTimeStore } from '../store/timeStore'

interface EventSelectorProps {
  onSelectEvent: (eventId: string | null) => void
  selectedEventId: string | null
}

interface AstroEventMeta {
  id: string
  event_type: string
  label: string
  event_date: string
  metadata: {
    ge_time_utc?: string
    [key: string]: any
  }
}

function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5 flex-shrink-0 text-amber-400" aria-hidden="true">
      <path d="M8 1.5l2.2 4.46 4.92.71-3.56 3.47.84 4.9L8 12.22l-4.4 2.31.84-4.9L.88 6.67l4.92-.71L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
      <line x1="3" y1="3" x2="13" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="13" y1="3" x2="3"  y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function formatEventType(type: string) {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export default function EventSelector({ onSelectEvent, selectedEventId }: EventSelectorProps) {
  const { appTimeMs, setAppTimeMs } = useTimeStore()
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<AstroEventMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSelectedType(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  // Fetch events when opened for the first time
  useEffect(() => {
    if (open && events.length === 0 && !loading) {
      setLoading(true)
      supabase
        .from('astro_events')
        .select('id, event_type, label, event_date, metadata')
        .order('event_date', { ascending: true })
        .then(({ data, error }) => {
          if (!error && data) {
            setEvents(data as AstroEventMeta[])
          }
          setLoading(false)
        })
    }
  }, [open, events.length, loading])

  const eventTypes = Array.from(new Set(events.map(e => e.event_type)))
  const filteredEvents = selectedType ? events.filter(e => e.event_type === selectedType) : []

  const selectedEvent = events.find(e => e.id === selectedEventId)

  return (
    <div ref={wrapRef} className="relative w-72">
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            setOpen(!open)
            if (open) setSelectedType(null)
          }}
          className={[
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 backdrop-blur-sm transition-colors duration-150',
            open || selectedEventId
              ? 'border-amber-500/70 bg-amber-950/80 text-amber-200'
              : 'border-night-700 bg-night-900/80 text-night-400 hover:border-amber-500/70 hover:text-night-200',
          ].join(' ')}
          aria-label="Astronomical Events"
          title="Astronomical Events"
        >
          <StarIcon />
          <span className="text-xs truncate max-w-[180px]">
            {selectedEvent ? selectedEvent.label : 'Events'}
          </span>
        </button>

        {selectedEventId && (
          <button
            onClick={() => onSelectEvent(null)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-night-700 bg-night-900/80 text-night-400 backdrop-blur-sm transition-colors hover:border-night-500 hover:text-night-200"
            title="Clear event"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-2 w-full overflow-hidden rounded-lg border border-night-700 bg-night-900/95 shadow-2xl backdrop-blur-sm">
          {loading ? (
            <div className="px-3 py-4 text-center text-xs text-night-400">Loading events...</div>
          ) : !selectedType ? (
            // Type Selection List
            <ul className="max-h-60 overflow-y-auto py-1" role="menu">
              {eventTypes.length > 0 ? (
                eventTypes.map(type => (
                  <li key={type} role="none">
                    <button
                      onClick={() => {
                        setSelectedType(type)
                        
                        // If an event of this type is already selected, don't override it.
                        // Just open the list so the user can browse.
                        const currentSelectedEvent = events.find(e => e.id === selectedEventId)
                        if (currentSelectedEvent && currentSelectedEvent.event_type === type) {
                          return
                        }

                        // Pre-select the nearest future event of this type based on appTimeMs
                        const typeEvents = events.filter(e => e.event_type === type)
                        
                        // Find the first event that occurs after or exactly on the current appTimeMs
                        // Since events are sorted ascending by date from Supabase
                        const futureEvent = typeEvents.find(e => {
                          let eventTimeStr = '12:00:00'
                          if (e.metadata && e.metadata.ge_time_utc) {
                            eventTimeStr = e.metadata.ge_time_utc
                          }
                          const eventMs = new Date(`${e.event_date}T${eventTimeStr}Z`).getTime()
                          return eventMs >= appTimeMs
                        })
                        
                        // Fallback to the last event if all are in the past
                        const eventToSelect = futureEvent || typeEvents[typeEvents.length - 1]
                        
                        if (eventToSelect) {
                          onSelectEvent(eventToSelect.id)
                          // Also set the app time to the event time
                          let eventTimeStr = '12:00:00'
                          if (eventToSelect.metadata && eventToSelect.metadata.ge_time_utc) {
                            eventTimeStr = eventToSelect.metadata.ge_time_utc
                          }
                          const eventDateMs = new Date(`${eventToSelect.event_date}T${eventTimeStr}Z`).getTime()
                          setAppTimeMs(eventDateMs)
                        }
                      }}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-night-200 transition-colors hover:bg-night-800 hover:text-night-100"
                      role="menuitem"
                    >
                      <span>{formatEventType(type)}</span>
                      <span className="text-night-500 text-[10px]">
                        {events.filter(e => e.event_type === type).length}
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-xs text-night-500">No events found.</li>
              )}
            </ul>
          ) : (
            // Event Selection List
            <div className="flex flex-col max-h-64">
              <div className="flex items-center gap-2 border-b border-night-800 px-3 py-2 bg-night-950/50">
                <button
                  onClick={() => setSelectedType(null)}
                  className="text-night-400 hover:text-night-100 p-1 -ml-1 rounded"
                  title="Back to categories"
                >
                  <ChevronLeftIcon />
                </button>
                <span className="text-xs font-semibold text-night-300">
                  {formatEventType(selectedType)}
                </span>
              </div>
              <ul className="flex-1 overflow-y-auto py-1" role="menu">
                {filteredEvents.map(e => {
                  const isSelected = e.id === selectedEventId
                  return (
                    <li key={e.id} role="none" ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}>
                      <button
                        onClick={() => {
                          onSelectEvent(e.id)
                          // Update app time
                          let eventTimeStr = '12:00:00'
                          if (e.metadata && e.metadata.ge_time_utc) {
                            eventTimeStr = e.metadata.ge_time_utc
                          }
                          const eventDateMs = new Date(`${e.event_date}T${eventTimeStr}Z`).getTime()
                          setAppTimeMs(eventDateMs)
                          
                          setOpen(false)
                          setSelectedType(null)
                        }}
                        className={[
                          'block w-full px-3 py-2 text-left text-xs transition-colors',
                          isSelected
                            ? 'bg-amber-950/50 text-amber-200'
                            : 'text-night-200 hover:bg-night-800 hover:text-night-100'
                        ].join(' ')}
                        role="menuitem"
                      >
                        {e.label}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
