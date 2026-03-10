import { useState, useEffect, useRef } from 'react'
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Bar, Cell, ComposedChart, Area, Line
} from 'recharts'
import { supabase } from '../lib/supabase'

interface ProfilePoint {
  week: number
  mean: number
  min: number
  max: number
  prob: number
}

interface ClimaticProfileChartProps {
  lat: number
  lon: number
  initialOffset?: { x: number; y: number }
  onClose: () => void
}

export default function ClimaticProfileChart({ lat, lon, initialOffset = { x: 0, y: 0 }, onClose }: ClimaticProfileChartProps) {
  const [data, setData] = useState<ProfilePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Dragging Logic ─────────────────────────────────────────────────────────
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  // Initialize position once on mount
  useEffect(() => {
    // Initial position: center-bottom of the screen
    const centerX = window.innerWidth / 2 - 220 // half width of chart
    const centerY = window.innerHeight - 350 // offset from bottom
    setPos({ 
      x: centerX + initialOffset.x, 
      y: centerY + initialOffset.y 
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only drag from the header area
    const target = e.target as HTMLElement
    if (!target.closest('.drag-handle')) return

    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y
    }
    target.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    setPos({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y
    })
  }

  const handlePointerUp = () => {
    setIsDragging(false)
  }

  useEffect(() => {
    async function fetchProfile() {
      setLoading(true)
      setError(null)
      try {
        const { data: result, error: invokeError } = await supabase.functions.invoke('get-climatic-profile', {
          body: { lat, lon }
        })

        if (invokeError) throw invokeError
        setData(result.profile)
      } catch (err: any) {
        console.error('Failed to fetch climatic profile:', err)
        setError(err.message || 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [lat, lon])

  // Explicit mapping of weeks to months to ensure all months (including August) are labeled
  const getMonthLabel = (week: number) => {
    if (week === 2) return 'Jan'
    if (week === 6) return 'Feb'
    if (week === 10) return 'Mar'
    if (week === 15) return 'Apr'
    if (week === 19) return 'May'
    if (week === 23) return 'Jun'
    if (week === 28) return 'Jul'
    if (week === 32) return 'Aug'
    if (week === 36) return 'Sep'
    if (week === 41) return 'Oct'
    if (week === 45) return 'Nov'
    if (week === 49) return 'Dec'
    return ''
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-night-700 bg-night-900/90 backdrop-blur-md">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
          <span className="text-xs text-night-400">Querying Global Atlas...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-red-900/30 bg-night-900/90 p-6 text-center backdrop-blur-md">
        <span className="mb-2 text-sm font-medium text-red-400">Data Retrieval Error</span>
        <span className="text-xs text-night-500">{error}</span>
        <button 
          onClick={onClose}
          className="mt-4 rounded-lg bg-night-800 px-4 py-1.5 text-xs text-night-200 hover:bg-night-700"
        >
          Close
        </button>
      </div>
    )
  }

  return (
    <div 
      className="pointer-events-auto absolute flex flex-col gap-2 rounded-xl border border-night-700 bg-night-950/95 p-3 shadow-2xl backdrop-blur-xl w-[440px] select-none"
      style={{ 
        left: 0, top: 0, 
        transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
        zIndex: isDragging ? 1100 : 1001,
        boxShadow: isDragging ? '0 20px 25px -5px rgb(0 0 0 / 0.5), 0 8px 10px -6px rgb(0 0 0 / 0.5)' : undefined,
        cursor: isDragging ? 'grabbing' : 'default'
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div className="flex items-center justify-between px-1 drag-handle cursor-grab active:cursor-grabbing">
        <div className="flex flex-col">
          <span className="text-xs font-bold tracking-tight text-night-100 uppercase">Yearly Cloud Stat</span>
          <span className="font-mono text-[10px] text-night-500">
            {lat.toFixed(3)}°N, {lon.toFixed(3)}°E • ERA5 Climatology
          </span>
        </div>
        <button onClick={onClose} className="rounded-full p-1 text-night-500 hover:bg-night-800 hover:text-night-200">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="h-40 w-full mt-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMean" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            
            <XAxis 
              dataKey="week" 
              tickFormatter={getMonthLabel}
              interval={0}
              tick={{fill: '#64748b', fontSize: 10}} 
              axisLine={false}
              tickLine={false}
            />
            
            {/* Left Y Axis: Cloud Cover (Inverted) */}
            <YAxis 
              yAxisId="left"
              orientation="left"
              reversed={true}
              domain={[0, 1]} 
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{fill: '#818cf8', fontSize: 9}}
              axisLine={false}
              tickLine={false}
            />
            
            {/* Right Y Axis: Clear Sky Probability */}
            <YAxis 
              yAxisId="right"
              orientation="right"
              domain={[0, 1]} 
              tickFormatter={(v) => `${Math.round(v * 100)}%`}
              tick={{fill: '#10b981', fontSize: 9}}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '11px' }}
              labelFormatter={(w) => `Week ${w}`}
              formatter={(v: any, name: any) => [`${(Number(v) * 100).toFixed(1)}%`, name]}
            />
            
            {/* Min/Max Cloud Lines (Subtle) */}
            <Line
              yAxisId="left"
              name="Max Year Mean"
              type="monotone"
              dataKey="max"
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              opacity={0.5}
            />
            <Line
              yAxisId="left"
              name="Min Year Mean"
              type="monotone"
              dataKey="min"
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              opacity={0.5}
            />
            
            {/* Mean Cloud (Prominent Line/Area) */}
            <Area 
              yAxisId="left"
              name="Mean Cloud"
              type="monotone" 
              dataKey="mean" 
              stroke="#6366f1" 
              fill="url(#colorMean)" 
              strokeWidth={2}
              dot={false}
            />
            
            {/* Clear Sky Probability (Bars) */}
            <Bar 
              yAxisId="right"
              name="Clear Sky Prob"
              dataKey="prob"
              barSize={4}
            >
              {data.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={entry.prob > 0.6 ? '#10b981' : entry.prob > 0.3 ? '#f59e0b' : '#ef4444'} 
                  fillOpacity={0.4}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-between items-center border-t border-night-800 pt-2 px-2">
        <div className="flex gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-3 rounded-full bg-indigo-500" />
            <span className="text-[9px] text-night-400 uppercase font-semibold">Mean Cloud</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-0.5 w-3 bg-slate-500 opacity-50" />
            <span className="text-[9px] text-night-500 uppercase">Min/Max</span>
          </div>
          <div className="flex items-center gap-1.5 ml-1">
            <div className="h-1.5 w-3 rounded-full bg-emerald-500 opacity-60" />
            <span className="text-[9px] text-night-400 uppercase font-semibold">Clear Sky Prob.</span>
          </div>
        </div>
        <span className="text-[9px] text-night-600 font-mono italic">
          High cloud is down ↓
        </span>
      </div>
    </div>
  )
}
