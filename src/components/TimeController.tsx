import { useState, useEffect, useRef, useCallback } from 'react'
import { useTimeStore } from '../store/timeStore'

const MIN_YEAR = 2000
const MAX_YEAR = 2050
const MS_PER_DAY = 1000 * 60 * 60 * 24

function formatTwoDigits(n: number) {
  return n.toString().padStart(2, '0')
}

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
}

export default function TimeController() {
  const { appTimeMs, setAppTimeMs, resetToNow } = useTimeStore()
  const [expanded, setExpanded] = useState(false)
  const collapseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimer = useCallback(() => {
    if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    if (expanded) {
      collapseTimerRef.current = setTimeout(() => {
        setExpanded(false)
      }, 10000)
    }
  }, [expanded])

  useEffect(() => {
    resetTimer()
    return () => {
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current)
    }
  }, [expanded, resetTimer])

  // Use UTC for all derived values
  const d = new Date(appTimeMs)
  const currentYear = d.getUTCFullYear()
  const startOfYearMs = Date.UTC(currentYear, 0, 1)
  
  // Year slider: 2000 to 2050
  
  // Day of Year slider: 1 to 365/366
  const daysInYear = isLeapYear(currentYear) ? 366 : 365
  const dayOfYear = Math.floor((appTimeMs - startOfYearMs) / MS_PER_DAY) + 1
  
  // Time slider: minutes since midnight (UTC)
  const minutesSinceMidnight = d.getUTCHours() * 60 + d.getUTCMinutes()

  // Format strings for display (UTC/GMT)
  const yyyy = d.getUTCFullYear()
  const mm = formatTwoDigits(d.getUTCMonth() + 1)
  const dd = formatTwoDigits(d.getUTCDate())
  const hh = formatTwoDigits(d.getUTCHours())
  const min = formatTwoDigits(d.getUTCMinutes())
  
  const dateStr = `${yyyy}-${mm}-${dd}`
  const timeStr = `${hh}:${min}`

  const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetTimer()
    const newYear = parseInt(e.target.value, 10)
    // Create new UTC date with new year, preserving month, date, hours, minutes
    const newMs = Date.UTC(newYear, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), 0, 0)
    setAppTimeMs(newMs)
  }

  const handleDayOfYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetTimer()
    const newDayOfYear = parseInt(e.target.value, 10)
    // Add (newDayOfYear - 1) days to the start of the current year
    const newMs = startOfYearMs + (newDayOfYear - 1) * MS_PER_DAY + minutesSinceMidnight * 60 * 1000
    setAppTimeMs(newMs)
  }

  const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    resetTimer()
    const newMinutes = parseInt(e.target.value, 10)
    const newHours = Math.floor(newMinutes / 60)
    const newMins = newMinutes % 60
    
    // Preserve year, month, date, just change time
    const newMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), newHours, newMins, 0, 0)
    setAppTimeMs(newMs)
  }

  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-[1000] -translate-x-1/2 flex flex-col items-center gap-2 rounded-xl border border-night-700 bg-night-900/80 px-4 py-3 backdrop-blur-md shadow-lg w-72 transition-all duration-300">
      
      {/* Header / Readout */}
      <div className="flex w-full items-center justify-between">
        <button 
          onClick={() => setExpanded(!expanded)}
          className="flex flex-col text-left hover:opacity-80 transition-opacity"
          title={expanded ? "Click to hide sliders" : "Click to show time sliders"}
        >
          <span className="text-[10px] font-semibold tracking-wider text-night-400 uppercase flex items-center gap-1">
            App Time (GMT)
            <svg viewBox="0 0 16 16" fill="none" className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="font-mono text-sm text-night-100 flex gap-2">
            <span className="text-amber-200">{dateStr}</span>
            <span>{timeStr}</span>
          </span>
        </button>
        <button 
          onClick={resetToNow}
          className="rounded border border-night-700 bg-night-800 px-2 py-1 text-[10px] font-medium text-night-300 transition-colors hover:bg-night-700 hover:text-white"
          title="Reset to current time"
        >
          NOW
        </button>
      </div>

      {/* Sliders Container */}
      {expanded && (
        <div 
          className="w-full flex flex-col gap-3 mt-2 pt-3 border-t border-night-700 animate-in fade-in slide-in-from-top-2 duration-200"
          onPointerMove={resetTimer}
        >
          {/* Year Slider */}
          <div className="w-full flex flex-col gap-1">
            <div className="flex justify-between text-[9px] text-night-500">
              <span>{MIN_YEAR}</span>
              <span>Year</span>
              <span>{MAX_YEAR}</span>
            </div>
            <input 
              type="range" 
              min={MIN_YEAR} 
              max={MAX_YEAR} 
              value={Math.max(MIN_YEAR, Math.min(MAX_YEAR, yyyy))} 
              onChange={handleYearChange}
              className="w-full h-1.5 bg-night-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
            />
          </div>

          {/* Day of Year Slider */}
          <div className="w-full flex flex-col gap-1">
            <div className="flex justify-between text-[9px] text-night-500">
              <span>Jan 1</span>
              <span>Date</span>
              <span>Dec 31</span>
            </div>
            <input 
              type="range" 
              min={1} 
              max={daysInYear} 
              value={dayOfYear} 
              onChange={handleDayOfYearChange}
              className="w-full h-1.5 bg-night-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Time Slider */}
          <div className="w-full flex flex-col gap-1">
            <div className="flex justify-between text-[9px] text-night-500">
              <span>00:00</span>
              <span>Time</span>
              <span>23:59</span>
            </div>
            <input 
              type="range" 
              min={0} 
              max={1439} 
              value={minutesSinceMidnight} 
              onChange={handleTimeChange}
              className="w-full h-1.5 bg-night-700 rounded-lg appearance-none cursor-pointer accent-indigo-400"
            />
          </div>
        </div>
      )}

    </div>
  )
}
