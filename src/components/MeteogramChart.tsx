import { useState, useEffect, useRef, useMemo } from 'react'
import { fetchMeteogramData, type MeteogramApiResponse } from '../lib/openmeteo'
import {
  getSunAltDeg, getMoonAltDeg, getMoonPhase,
  cloudCoverColor, skyDarknessColor, moonPhaseEmoji,
} from '../utils/sunMoon'

// ── Layout constants ──────────────────────────────────────────────────────────

const NUM_ROWS = 10
const HOURS    = 24
const CELL_W   = 15    // px per hour column
const CLOUD_H  = 20    // px — cloud cover band (upper 2/3 of cell)
const DARK_H   = 9     // px — sky darkness band (lower 1/3 of cell)
const CELL_H   = CLOUD_H + DARK_H
// Date is overlaid on the first columns — no separate label column
const INNER_W  = HOURS * CELL_W  // 24 × 15 = 360 px

/** Local hour for column index j (column 0 = 12:00 LT, column 12 = 00:00 LT). */
const colToLocalHour = (j: number) => (j + 12) % 24

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
  const times      = hourly.time
  const offsetSec  = api.utc_offset_seconds  // e.g. 7200 for UTC+2

  // ── Find "today" in the location's local time ──────────────────────────────
  // Shift the current UTC epoch by the location offset so that getUTC*() methods
  // return local wall-clock values (the "local-as-UTC" trick).
  const nowLocalAsUtcMs = Date.now() + offsetSec * 1000
  const nowLocalAsUtc   = new Date(nowLocalAsUtcMs)

  // Local noon today  (stored as "local-as-UTC" epoch for formatDate compatibility)
  const startNoonLocalAsUtc = new Date(Date.UTC(
    nowLocalAsUtc.getUTCFullYear(), nowLocalAsUtc.getUTCMonth(), nowLocalAsUtc.getUTCDate(), 12, 0, 0,
  ))
  const startNoonMs = startNoonLocalAsUtc.getTime()   // "local noon as UTC" epoch

  // The API now returns times in local time (timezone=auto), e.g. "2026-04-06T12:00".
  // We look for the "T12:00" entry that matches today's local date.
  const startStr = startNoonLocalAsUtc.toISOString().slice(0, 16)  // "YYYY-MM-DDT12:00"
  let startIdx = times.findIndex(t => t === startStr)
  if (startIdx < 0) {
    // fallback: compute offset from first timestamp
    const firstLocalAsUtcMs = new Date(times[0] + 'Z').getTime()
    startIdx = Math.round((startNoonMs - firstLocalAsUtcMs) / 3_600_000)
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

      // Parse the local time string as if it were UTC (gives "local-as-UTC" ms).
      // getUTC*() on this Date gives correct local wall-clock values for display.
      const localAsUtcMs = new Date(times[idx] + 'Z').getTime()

      // Derive real UTC for astronomical calculations: local - offset = UTC
      const realUtcDate  = new Date(localAsUtcMs - offsetSec * 1000)

      const sunAlt  = getSunAltDeg(realUtcDate, lat, lon)
      const moonAlt = getMoonAltDeg(realUtcDate, lat, lon)
      const phase   = getMoonPhase(realUtcDate)

      cells.push({
        timeMs:     localAsUtcMs,
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

    rows.push({ noonMs: startNoonMs + r * 86_400_000, cells })
  }

  return rows
}

// ── Component ─────────────────────────────────────────────────────────────────

interface MeteogramChartProps {
  lat: number
  lon: number
  locationName?: string
  initialOffset?: { x: number; y: number }
  onClose: () => void
}

export default function MeteogramChart({
  lat, lon,
  locationName,
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
      y: window.innerHeight - 560 + offsetRef.current.y,
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
      <div className="drag-handle flex cursor-grab select-none items-center justify-between px-3 pt-2 pb-0 active:cursor-grabbing">
        <span style={{ fontSize: 9.5 }} className="font-bold uppercase tracking-wider text-night-100">
          Meteogram{locationName ? <span className="text-indigo-300"> — {locationName}</span> : ''}
          <span className="font-mono font-bold text-white" style={{ fontSize: 8 }}>
            {' '}({lat.toFixed(3)}&deg;N {lon.toFixed(3)}&deg;E &middot; ECMWF IFS &middot; LT)
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

      {/* ── Hour header (local time) ── */}
      <div className="flex select-none px-3" style={{ marginBottom: 1 }}>
        {Array.from({ length: HOURS }, (_, j) => {
          const h = colToLocalHour(j)
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

          // Per-row min/max for temperature labels
          const rowMaxCell = row.cells.reduce((b, c) => c.tempC > b.tempC ? c : b, row.cells[0])
          const rowMinCell = row.cells.reduce((b, c) => c.tempC < b.tempC ? c : b, row.cells[0])
          const rowMaxIdx  = row.cells.indexOf(rowMaxCell)
          const rowMinIdx  = row.cells.indexOf(rowMinCell)

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

              {/* Temperature polyline + min/max labels */}
              <svg
                style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
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
                {/* Max temp label — warm amber, placed just below the peak */}
                {row.cells.length > 0 && (
                  <text
                    x={(rowMaxIdx * CELL_W + CELL_W / 2).toFixed(1)}
                    y={(tempY(rowMaxCell.tempC) + 7).toFixed(1)}
                    textAnchor="middle"
                    fontSize={6}
                    fontWeight="bold"
                    fontFamily="ui-monospace, monospace"
                    fill="rgba(255,210,80,0.95)"
                  >
                    {Math.round(rowMaxCell.tempC)}°
                  </text>
                )}
                {/* Min temp label — cool blue, placed just above the trough */}
                {row.cells.length > 0 && rowMinIdx !== rowMaxIdx && (
                  <text
                    x={(rowMinIdx * CELL_W + CELL_W / 2).toFixed(1)}
                    y={(tempY(rowMinCell.tempC) - 1).toFixed(1)}
                    textAnchor="middle"
                    dominantBaseline="auto"
                    fontSize={6}
                    fontWeight="bold"
                    fontFamily="ui-monospace, monospace"
                    fill="rgba(130,200,255,0.95)"
                  >
                    {Math.round(rowMinCell.tempC)}°
                  </text>
                )}
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
                    <span style={{ position: 'absolute', left: 0, top: 0, fontSize: 12 }} title="Sunrise">&#9728;&#8593;</span>
                  )}
                  {cell.isSunset && (
                    <span style={{ position: 'absolute', left: 0, top: 0, fontSize: 12 }} title="Sunset">&#9728;&#8595;</span>
                  )}
                  {cell.isMoonrise && (
                    <span style={{ position: 'absolute', left: 0, top: CLOUD_H - 1, fontSize: 11 }} title="Moonrise">
                      {moonPhaseEmoji(cell.moonPhase)}&#8593;
                    </span>
                  )}
                  {cell.isMoonset && (
                    <span style={{ position: 'absolute', left: 0, top: CLOUD_H - 1, fontSize: 11 }} title="Moonset">
                      {moonPhaseEmoji(cell.moonPhase)}&#8595;
                    </span>
                  )}
                  {cell.precipMm > 0.15 && (
                    <span style={{ position: 'absolute', left: 0, top: 4, fontSize: 11 }} title={`${cell.precipMm.toFixed(1)} mm/h`}>&#128167;</span>
                  )}
                  {cell.windMs > 10 && (
                    <span style={{ position: 'absolute', left: 0, top: 11, fontSize: 11 }} title={`${cell.windMs.toFixed(0)} m/s`}>&#128168;</span>
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
          <span className="text-[7px] font-bold text-white">&#128167;&gt;0.15mm</span>
          <span className="text-[7px] font-bold text-white">&#128168;&gt;10m/s</span>
        </div>
      </div>
    </div>
  )
}
