import { useState, useEffect, useRef, useMemo } from 'react'
import { fetchMeteogramData, type MeteogramApiResponse } from '../lib/openmeteo'
import {
  getSunAltDeg, getMoonAltDeg, getMoonPhase,
  cloudCoverColor, skyDarknessColor, moonPhaseEmoji,
} from '../utils/sunMoon'

// ── Layout constants ──────────────────────────────────────────────────────────

const NUM_ROWS = 7
const HOURS    = 24
const CELL_W   = 15    // px per hour column
const CLOUD_H  = 20    // px — cloud cover band (upper 2/3 of cell)
const DARK_H   = 9     // px — sky darkness band (lower 1/3 of cell)
const CELL_H   = CLOUD_H + DARK_H
// Date is overlaid on the first columns — no separate label column
const INNER_W  = HOURS * CELL_W  // 24 × 15 = 360 px

/** UTC hour for column index j (column 0 = 12:00 UTC). */
const colToUTCHour = (j: number) => (j + 12) % 24

// ── Data types ────────────────────────────────────────────────────────────────

interface HourCell {
  timeMs:     number
  cloudPct:   number
  tempC:      number
  windMs:     number
  precipMm:   number
  sunAltDeg:  number
  moonAltDeg: number
  moonPhase:  number
  isSunrise:  boolean
  isSunset:   boolean
  isMoonrise: boolean
  isMoonset:  boolean
}

interface RowData {
  noonMs: number
  cells:  HourCell[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return `${days[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.`
}

function buildRows(
  api: MeteogramApiResponse,
  lat: number,
  lon: number,
): RowData[] {
  const { hourly } = api
  const times = hourly.time

  // Always start at today's noon UTC — row 0 = today even if noon has passed
  const now       = new Date()
  const startNoon = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0,
  ))

  const startStr = startNoon.toISOString().slice(0, 16)
  let startIdx = times.findIndex(t => t === startStr)
  if (startIdx < 0) {
    const firstMs = new Date(times[0] + 'Z').getTime()
    startIdx = Math.round((startNoon.getTime() - firstMs) / 3_600_000)
  }
  startIdx = Math.max(0, startIdx)

  const rows: RowData[] = []

  for (let r = 0; r < NUM_ROWS; r++) {
    const offset = startIdx + r * HOURS
    const cells: HourCell[] = []
    let prevSunAlt:  number | null = null
    let prevMoonAlt: number | null = null

    for (let h = 0; h < HOURS; h++) {
      const idx = offset + h
      if (idx >= times.length) break

      const timeMs = new Date(times[idx] + 'Z').getTime()
      const date   = new Date(timeMs)

      const sunAlt  = getSunAltDeg(date, lat, lon)
      const moonAlt = getMoonAltDeg(date, lat, lon)
      const phase   = getMoonPhase(date)

      cells.push({
        timeMs,
        cloudPct:   hourly.cloudcover[idx]     ?? 0,
        tempC:      hourly.temperature_2m[idx] ?? 0,
        windMs:     hourly.windspeed_10m[idx]  ?? 0,
        precipMm:   hourly.precipitation[idx]  ?? 0,
        sunAltDeg:  sunAlt,
        moonAltDeg: moonAlt,
        moonPhase:  phase,
        isSunrise:  prevSunAlt  !== null && prevSunAlt  < 0  && sunAlt  >= 0,
        isSunset:   prevSunAlt  !== null && prevSunAlt  >= 0 && sunAlt  < 0,
        isMoonrise: prevMoonAlt !== null && prevMoonAlt < 0  && moonAlt >= 0,
        isMoonset:  prevMoonAlt !== null && prevMoonAlt >= 0 && moonAlt < 0,
      })

      prevSunAlt  = sunAlt
      prevMoonAlt = moonAlt
    }

    rows.push({ noonMs: startNoon.getTime() + r * 86_400_000, cells })
  }

  return rows
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MeteogramChartProps {
  lat: number
  lon: number
  initialOffset?: { x: number; y: number }
  onClose: () => void
}

export default function MeteogramChart({
  lat, lon,
  initialOffset = { x: 0, y: 0 },
  onClose,
}: MeteogramChartProps) {
  const [apiData,    setApiData]    = useState<MeteogramApiResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [pos,        setPos]        = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  const dragRef   = useRef({ x: 0, y: 0 })
  const offsetRef = useRef(initialOffset)

  useEffect(() => {
    setPos({
      x: window.innerWidth  / 2 - (INNER_W + 24) / 2 + offsetRef.current.x,
      y: window.innerHeight - 480 + offsetRef.current.y,
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchMeteogramData(lat, lon)
      .then(setApiData)
      .catch(err => {
        console.error('MeteogramChart fetch error:', err)
        setError(err instanceof Error ? err.message : 'Failed to load forecast')
      })
      .finally(() => setLoading(false))
  }, [lat, lon])

  const rows = useMemo(() => {
    if (!apiData) return []
    return buildRows(apiData, lat, lon)
  }, [apiData, lat, lon])

  const { tempMin, tempMax } = useMemo(() => {
    const temps = rows.flatMap(r => r.cells.map(c => c.tempC))
    if (temps.length === 0) return { tempMin: 0, tempMax: 1 }
    return { tempMin: Math.min(...temps), tempMax: Math.max(...temps) }
  }, [rows])

  function tempY(t: number): number {
    const range = tempMax - tempMin || 1
    return CLOUD_H - 2 - ((t - tempMin) / range) * (CLOUD_H - 4)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!(e.target as HTMLElement).closest('.drag-handle')) return
    setIsDragging(true)
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!isDragging) return
    setPos({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y })
  }
  function onPointerUp() { setIsDragging(false) }

  const outerStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate3d(${pos.x}px,${pos.y}px,0)`,
    zIndex: isDragging ? 1100 : 1001,
    cursor: isDragging ? 'grabbing' : 'default',
    width: INNER_W + 24,
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="pointer-events-auto flex h-40 items-center justify-center rounded-xl border border-night-700 bg-black shadow-2xl"
        style={outerStyle}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="text-xs text-night-400">Fetching ECMWF forecast…</span>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="pointer-events-auto flex h-40 flex-col items-center justify-center gap-3 rounded-xl border border-red-900/30 bg-black p-4 shadow-2xl"
        style={outerStyle}
      >
        <span className="text-sm font-medium text-red-400">Forecast unavailable</span>
        <span className="break-words text-center text-xs text-night-500">{error}</span>
        <button onClick={onClose} className="rounded-lg bg-night-800 px-4 py-1.5 text-xs text-night-200 hover:bg-night-700">
          Close
        </button>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="pointer-events-auto rounded-xl border border-night-700 bg-black shadow-2xl"
      style={outerStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* ── Header — title + lat/lon + source inline, single line ── */}
      <div className="drag-handle flex cursor-grab select-none items-center justify-between px-3 pt-2 pb-1 active:cursor-grabbing">
        <span style={{ fontSize: 9.5 }} className="font-bold uppercase tracking-wider text-night-100">
          Actual Meteogram
          <span className="font-mono font-bold text-white" style={{ fontSize: 8 }}>
            {' '}({lat.toFixed(3)}°N {lon.toFixed(3)}°E · ECMWF IFS)
          </span>
        </span>
        <button
          onClick={onClose}
          className="ml-2 flex-shrink-0 rounded-full p-0.5 text-night-600 hover:bg-night-800 hover:text-night-200"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Hour header ── */}
      <div className="flex select-none px-3" style={{ marginBottom: 1 }}>
        {Array.from({ length: HOURS }, (_, j) => {
          const h = colToUTCHour(j)
          return (
            <div
              key={j}
              style={{ width: CELL_W, minWidth: CELL_W, textAlign: 'center' }}
            >
              {h % 3 === 0 && (
                <span className="text-[8px] font-bold leading-none text-white">
                  {h.toString().padStart(2, '0')}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* ── Data rows ── */}
      <div className="flex select-none flex-col gap-px px-3 pb-2">
        {rows.map((row, ri) => {
          const tempPoints = row.cells
            .map((c, j) => `${(j * CELL_W + CELL_W / 2).toFixed(1)},${tempY(c.tempC).toFixed(1)}`)
            .join(' ')

          return (
            <div key={ri} className="relative flex" style={{ height: CELL_H }}>
              {/* Background cells */}
              {row.cells.map((cell, j) => (
                <div key={j} style={{ width: CELL_W, flexShrink: 0 }}>
                  <div style={{ height: CLOUD_H, background: cloudCoverColor(cell.cloudPct) }} />
                  <div style={{ height: DARK_H, background: skyDarknessColor(cell.sunAltDeg, cell.moonAltDeg > 0) }} />
                </div>
              ))}

              {/* Date label — overlaid on the first columns */}
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  zIndex: 5,
                  fontSize: 8,
                  fontFamily: 'ui-monospace, monospace',
                  color: '#fff',
                  fontWeight: 'bold',
                  background: 'rgba(0,0,0,0.65)',
                  padding: '1px 3px 1px 2px',
                  borderRadius: '0 0 3px 0',
                  pointerEvents: 'none',
                  lineHeight: 1.4,
                }}
              >
                {formatDate(row.noonMs)}
              </span>

              {/* Temperature polyline */}
              <svg
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                width={HOURS * CELL_W}
                height={CLOUD_H}
              >
                <polyline
                  points={tempPoints}
                  stroke="rgba(255,255,255,0.72)"
                  strokeWidth="1.3"
                  fill="none"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>

              {/* Event icons */}
              {row.cells.map((cell, j) => (
                <span
                  key={j}
                  style={{
                    position: 'absolute',
                    left: j * CELL_W,
                    top: 0,
                    width: CELL_W,
                    height: CELL_H,
                    lineHeight: 1,
                    pointerEvents: 'none',
                  }}
                >
                  {cell.isSunrise && (
                    <span style={{ position: 'absolute', left: 0, top: 0, fontSize: 12 }} title="Sunrise">☀↑</span>
                  )}
                  {cell.isSunset && (
                    <span style={{ position: 'absolute', left: 0, top: 0, fontSize: 12 }} title="Sunset">☀↓</span>
                  )}
                  {cell.isMoonrise && (
                    <span style={{ position: 'absolute', left: 0, top: CLOUD_H - 1, fontSize: 11 }} title="Moonrise">
                      {moonPhaseEmoji(cell.moonPhase)}↑
                    </span>
                  )}
                  {cell.isMoonset && (
                    <span style={{ position: 'absolute', left: 0, top: CLOUD_H - 1, fontSize: 11 }} title="Moonset">
                      {moonPhaseEmoji(cell.moonPhase)}↓
                    </span>
                  )}
                  {cell.precipMm > 0.15 && (
                    <span style={{ position: 'absolute', left: 0, top: 4, fontSize: 11 }} title={`${cell.precipMm.toFixed(1)} mm/h`}>💧</span>
                  )}
                  {cell.windMs > 10 && (
                    <span style={{ position: 'absolute', left: 0, top: 11, fontSize: 11 }} title={`${cell.windMs.toFixed(0)} m/s`}>💨</span>
                  )}
                </span>
              ))}
            </div>
          )
        })}
      </div>

      {/* ── Legend ── */}
      <div className="flex select-none flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-night-900 px-3 py-1">
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-bold text-white">Cloud:</span>
          {([
            ['#000', '0%'], ['#15803d', '<25%'], ['#ca8a04', '<50%'],
            ['#ea580c', '<75%'], ['#dc2626', '>75%'],
          ] as const).map(([bg, label]) => (
            <span key={label} className="flex items-center gap-0.5">
              <span style={{ display: 'inline-block', width: 7, height: 7, background: bg, border: '1px solid #333', borderRadius: 1 }} />
              <span className="text-[7px] font-bold text-white">{label}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[7px] font-bold text-white">── temp</span>
          <span className="text-[7px] font-bold text-white">💧&gt;0.15mm</span>
          <span className="text-[7px] font-bold text-white">💨&gt;10m/s</span>
        </div>
      </div>
    </div>
  )
}
