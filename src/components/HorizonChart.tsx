/**
 * HorizonChart.tsx
 * ─────────────────
 * Faithful SVG replication of the Python `draw_horizon` function
 * (scripts/compute_horizon.py) rendered entirely in the browser without
 * any external charting library.
 *
 * Visual elements (matching the Python output):
 *   • Gaussian-smoothed terrain silhouette (scipy gaussian_filter1d sigma=0.7)
 *   • Blue fill (#1e3a5f) where terrain blocks sky (elevation > 0°)
 *   • Green fill (#0d3320) where horizon dips below flat (summit views)
 *   • Dashed flat-horizon reference at 0°
 *   • X-axis: tick every 10°, cardinal directions (N/NE/E…) at every 45°
 *   • Y-axis: integer-degree ticks only
 *   • Gold ▲ peak markers with staggered name + altitude labels (5-tier)
 */

import { useState, useMemo, useRef, useEffect } from 'react'
import { useHorizon } from '../hooks/useHorizon'
import type { HorizonPeak } from '../types/location'

// ── Props ─────────────────────────────────────────────────────────────────────

interface HorizonChartProps {
  locationId: string
  name: string
  onClose: () => void
}

// ── Palette (matching Python draw_horizon constants) ──────────────────────────

const DARK_BG    = '#0a0a1a'
const PLOT_BG    = '#0d1117'
const COL_TEXT   = '#c9d1d9'
const COL_DIM    = '#8b949e'
const COL_GRID   = '#21262d'
const COL_BLUE   = '#58a6ff'  // terrain line
const COL_PEAK   = '#f0c040'  // gold peak markers

// ── Layout constants ──────────────────────────────────────────────────────────

const SVG_W  = 790
const SVG_H  = 270
const PAD_L  = 38   // left  — Y-axis labels
const PAD_R  = 6
const PAD_T  = 10
const PAD_B  = 30   // bottom — X-axis labels
const PW     = SVG_W - PAD_L - PAD_R   // plot width
const PH     = SVG_H - PAD_T - PAD_B   // plot height

// ── Gaussian 1-D smoothing (mirrors scipy.ndimage.gaussian_filter1d) ──────────

function gaussianFilter1D(data: number[], sigma: number): number[] {
  const radius = Math.ceil(3 * sigma)
  const kernel: number[] = []
  let ksum = 0
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel.push(v)
    ksum += v
  }
  const norm = kernel.map(v => v / ksum)
  const n = data.length
  return data.map((_, i) => {
    let s = 0
    for (let j = 0; j < norm.length; j++) {
      let idx = i + (j - radius)
      // 'reflect' boundary (scipy default)
      if (idx < 0)   idx = -idx - 1
      if (idx >= n)  idx = 2 * n - idx - 1
      s += (data[idx] ?? 0) * norm[j]
    }
    return s
  })
}

// ── Cardinal direction labels ─────────────────────────────────────────────────

const CARDINALS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE',
  180: 'S', 225: 'SW', 270: 'W', 315: 'NW', 360: 'N',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HorizonChart({ locationId, name, onClose }: HorizonChartProps) {
  const { data: profile, isLoading, isError, error } = useHorizon(locationId)

  // ── Draggable floating window ─────────────────────────────────────────────

  const [pos, setPos]           = useState({ x: 0, y: 0 })
  const [isDragging, setDrag]   = useState(false)
  const dragRef                 = useRef({ x: 0, y: 0 })

  useEffect(() => {
    setPos({
      x: Math.max(10, window.innerWidth  / 2 - SVG_W / 2 - 10),
      y: Math.max(10, window.innerHeight - SVG_H - 80),
    })
  }, [])

  function ptrDown(e: React.PointerEvent) {
    if (!(e.target as HTMLElement).closest('.drag-handle')) return
    setDrag(true)
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function ptrMove(e: React.PointerEvent) {
    if (!isDragging) return
    setPos({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y })
  }
  function ptrUp(e: React.PointerEvent) {
    setDrag(false)
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  // ── Unique clip-path id (avoids collisions when multiple windows open) ─────

  const clipId = useMemo(() => `hc-clip-${locationId.replace(/[^a-zA-Z0-9]/g, '')}`, [locationId])

  // ── Process horizon data ──────────────────────────────────────────────────

  const {
    azArr, elSmooth, peaks,
    yMin, yMax,
  } = useMemo(() => {
    if (!profile?.segments?.length) {
      return { azArr: [], elSmooth: [], peaks: [] as HorizonPeak[], yMin: -1, yMax: 10 }
    }

    // Wrap to 360° (duplicate first point at end for closed line)
    const segs = [...profile.segments, { ...profile.segments[0], azimuth: 360 }]
    const az   = segs.map(s => s.azimuth)
    const el   = segs.map(s => s.min_elevation)

    // Gaussian smoothing (sigma=0.7, matches Python)
    const smooth = gaussianFilter1D(el, 0.7)

    const rawMin = Math.min(...smooth)
    const rawMax = Math.max(...smooth)

    // Adaptive Y range — match Python logic
    const elMin = Math.min(rawMin - 1.0, -0.5)

    // Allow enough room for staggered labels (tier 4 = +0.8 + 4*1.5 = 6.8° above peak)
    const pks    = (profile.peaks ?? []).slice().sort((a, b) => a.azimuth - b.azimuth)
    let labelMax = rawMax
    if (pks.length > 0) {
      pks.forEach((p, idx) => {
        const tier    = idx % 5
        const offset  = 0.8 + tier * 1.5
        labelMax = Math.max(labelMax, p.elevation_angle + offset)
      })
    }
    const elMax = Math.max(rawMax + 3.0, labelMax + 1.5, 5.0)

    return { azArr: az, elSmooth: smooth, peaks: pks, yMin: elMin, yMax: elMax }
  }, [profile])

  // ── Scale helpers ─────────────────────────────────────────────────────────

  const xS = (az: number) => PAD_L + (az / 360) * PW
  const yS = (el: number) => PAD_T + PH - ((el - yMin) / (yMax - yMin)) * PH

  // ── SVG path strings ──────────────────────────────────────────────────────

  // Terrain silhouette
  const terrainD = useMemo(() => {
    if (!elSmooth.length) return ''
    return elSmooth
      .map((el, i) => `${i === 0 ? 'M' : 'L'}${xS(azArr[i]).toFixed(1)},${yS(el).toFixed(1)}`)
      .join(' ')
  }, [elSmooth, azArr, yMin, yMax])

  // Blue fill — terrain above 0° (sky blocked by terrain)
  // Uses clamped path: each point's y = min(yS(el), yS(0)) so fill stays above 0° line
  const skyBlockedD = useMemo(() => {
    if (!elSmooth.length) return ''
    const y0 = yS(0)
    const pts = elSmooth.map((el, i) => ({
      x: xS(azArr[i]),
      y: Math.min(yS(el), y0),  // clamp at 0° — no fill below flat horizon
    }))
    const n  = pts.length
    let d = `M${pts[0].x.toFixed(1)},${y0.toFixed(1)}`
    d    += ` L${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
    for (let i = 1; i < n; i++) d += ` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`
    d    += ` L${pts[n-1].x.toFixed(1)},${y0.toFixed(1)} Z`
    return d
  }, [elSmooth, azArr, yMin, yMax])

  // Green fill — terrain below 0° (open sky at elevated viewpoint)
  const openSkyD = useMemo(() => {
    if (!elSmooth.length) return ''
    const y0 = yS(0)
    const pts = elSmooth.map((el, i) => ({
      x: xS(azArr[i]),
      y: Math.max(yS(el), y0),  // clamp at 0° — no fill above flat horizon
    }))
    const n  = pts.length
    let d = `M${pts[0].x.toFixed(1)},${y0.toFixed(1)}`
    d    += ` L${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
    for (let i = 1; i < n; i++) d += ` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`
    d    += ` L${pts[n-1].x.toFixed(1)},${y0.toFixed(1)} Z`
    return d
  }, [elSmooth, azArr, yMin, yMax])

  // ── Axis ticks ────────────────────────────────────────────────────────────

  const yTicks  = useMemo(() => {
    const ticks: number[] = []
    for (let v = Math.ceil(yMin); v <= Math.floor(yMax); v++) ticks.push(v)
    return ticks
  }, [yMin, yMax])

  const xTicks10 = useMemo(() => Array.from({ length: 37 }, (_, i) => i * 10), [])

  // ── Peak render data ──────────────────────────────────────────────────────

  const peakData = useMemo(() =>
    peaks.map((pk, rank) => {
      const tier    = rank % 5
      const offset  = 0.8 + tier * 1.5   // degrees above peak marker
      const cx      = xS(pk.azimuth)
      const cy      = yS(pk.elevation_angle)
      const labelY  = yS(pk.elevation_angle + offset)
      return { pk, tier, cx, cy, labelY }
    }),
  [peaks, yMin, yMax])

  // ── Window outer style ────────────────────────────────────────────────────

  const outerStyle: React.CSSProperties = {
    position:  'absolute',
    left:      0,
    top:       0,
    transform: `translate3d(${pos.x}px,${pos.y}px,0)`,
    zIndex:    isDragging ? 1100 : 1001,
    cursor:    isDragging ? 'grabbing' : 'default',
    width:     'min(95vw, 800px)',
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="pointer-events-auto rounded-xl border border-night-700 bg-black shadow-2xl"
      style={outerStyle}
      onPointerDown={ptrDown}
      onPointerMove={ptrMove}
      onPointerUp={ptrUp}
      onPointerCancel={ptrUp}
    >
      {/* ── Drag handle / title bar ─────────────────────────────────────── */}
      <div className="drag-handle flex cursor-grab select-none items-center justify-between rounded-t-xl px-3 py-1.5 active:cursor-grabbing"
           style={{ background: '#0d0d1f', borderBottom: `1px solid ${COL_GRID}` }}>
        <span style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
              className="font-bold uppercase tracking-wider text-night-100">
          Horizon Profile
          <span className="text-indigo-300"> — {name}</span>
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

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      <div style={{ background: DARK_BG, borderRadius: '0 0 12px 12px', padding: '4px 6px 6px 6px' }}>

        {isLoading && (
          <div style={{ color: COL_DIM, height: SVG_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'ui-monospace', fontSize: 11 }}>
            Loading horizon data…
          </div>
        )}

        {isError && (
          <div style={{ color: '#ef4444', height: SVG_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'ui-monospace', fontSize: 11 }}>
            {error?.message ?? 'Failed to load horizon'}
          </div>
        )}

        {!isLoading && !isError && !profile && (
          <div style={{ color: COL_DIM, height: SVG_H, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'ui-monospace', fontSize: 11 }}>
            Horizon profile not yet computed for this location.
          </div>
        )}

        {profile && elSmooth.length > 0 && (
          <svg
            width="100%"
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            style={{ display: 'block', fontFamily: 'ui-monospace, monospace', overflow: 'visible' }}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={PAD_L} y={PAD_T} width={PW} height={PH} />
              </clipPath>
            </defs>

            {/* ── Plot background ──────────────────────────────────────── */}
            <rect x={PAD_L} y={PAD_T} width={PW} height={PH} fill={PLOT_BG} />

            {/* ── Horizontal grid lines ──────────────────────────────── */}
            {yTicks.map(v => (
              <line key={`g${v}`}
                x1={PAD_L} x2={PAD_L + PW} y1={yS(v)} y2={yS(v)}
                stroke={COL_GRID} strokeWidth={0.5} />
            ))}

            {/* ── Sky-blocked fill (blue, above 0°) ─────────────────── */}
            <path d={skyBlockedD} fill="#1e3a5f" fillOpacity={0.55} clipPath={`url(#${clipId})`} />

            {/* ── Open-sky fill (green, below 0°) ───────────────────── */}
            <path d={openSkyD}    fill="#0d3320" fillOpacity={0.45} clipPath={`url(#${clipId})`} />

            {/* ── Flat horizon reference line at 0° ─────────────────── */}
            <line
              x1={PAD_L} x2={PAD_L + PW} y1={yS(0)} y2={yS(0)}
              stroke={COL_DIM} strokeWidth={0.9} strokeDasharray="4 4" opacity={0.7}
              clipPath={`url(#${clipId})`}
            />

            {/* ── Gaussian-smoothed terrain silhouette ──────────────── */}
            <path
              d={terrainD}
              fill="none"
              stroke={COL_BLUE}
              strokeWidth={1.6}
              strokeLinejoin="round"
              clipPath={`url(#${clipId})`}
            />

            {/* ── Peak markers + staggered labels ───────────────────── */}
            {peakData.map(({ pk, tier, cx, cy, labelY }) => (
              <g key={`pk-${pk.name}-${pk.azimuth}`}>
                {/* ▲ triangle marker at exact peak position */}
                <path
                  d={`M${cx - 4},${cy + 4} L${cx + 4},${cy + 4} L${cx},${cy - 4} Z`}
                  fill={COL_PEAK}
                  clipPath={`url(#${clipId})`}
                />
                {/* Leader line if pushed to upper tier */}
                {tier > 0 && (
                  <line
                    x1={cx} y1={cy - 5} x2={cx} y2={labelY + 11}
                    stroke={COL_PEAK} strokeWidth={1} opacity={0.65} strokeDasharray="2 2"
                  />
                )}
                {/* Peak name */}
                <text x={cx} y={labelY} textAnchor="middle" fill={COL_PEAK}
                      fontSize={9} fontWeight="bold">
                  {pk.name}
                </text>
                {/* Altitude */}
                {pk.altitude_m != null && (
                  <text x={cx} y={labelY + 9} textAnchor="middle" fill={COL_PEAK} fontSize={8}>
                    {Math.round(pk.altitude_m)}m
                  </text>
                )}
              </g>
            ))}

            {/* ── Y-axis labels (integer degrees) ───────────────────── */}
            {yTicks.map(v => (
              <text key={`yl${v}`}
                x={PAD_L - 4} y={yS(v) + 4}
                textAnchor="end" fill={COL_BLUE} fontSize={9}>
                {v}°
              </text>
            ))}

            {/* ── Chart border ───────────────────────────────────────── */}
            <rect x={PAD_L} y={PAD_T} width={PW} height={PH}
                  fill="none" stroke={COL_GRID} strokeWidth={1} />

            {/* ── X-axis: tick + label every 10°, cardinals at 45° ─── */}
            {xTicks10.map(az => {
              const x          = xS(az)
              const isCardinal = az % 45 === 0
              const label      = isCardinal ? (CARDINALS[az] ?? `${az}`) : `${az}`
              return (
                <g key={`xt${az}`}>
                  <line
                    x1={x} x2={x}
                    y1={PAD_T + PH} y2={PAD_T + PH + (isCardinal ? 5 : 3)}
                    stroke={isCardinal ? COL_TEXT : COL_DIM}
                    strokeWidth={isCardinal ? 1 : 0.5}
                  />
                  <text
                    x={x}
                    y={PAD_T + PH + (isCardinal ? 16 : 12)}
                    textAnchor="middle"
                    fill={isCardinal ? COL_TEXT : COL_DIM}
                    fontSize={isCardinal ? 10 : 7}
                    fontWeight={isCardinal ? 'bold' : 'normal'}
                  >
                    {label}
                  </text>
                </g>
              )
            })}
          </svg>
        )}
      </div>
    </div>
  )
}
