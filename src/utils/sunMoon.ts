/**
 * sunMoon.ts
 *
 * Utility functions for sun/moon position-based calculations used by the
 * Actual Meteogram component. All position arithmetic is delegated to SunCalc.
 */
import SunCalc from 'suncalc'

// ── Sun/Moon position helpers ─────────────────────────────────────────────────

/** Returns Sun altitude in degrees (-90…+90). */
export function getSunAltDeg(date: Date, lat: number, lon: number): number {
  return SunCalc.getPosition(date, lat, lon).altitude * (180 / Math.PI)
}

/** Returns Moon altitude in degrees (-90…+90). */
export function getMoonAltDeg(date: Date, lat: number, lon: number): number {
  return SunCalc.getMoonPosition(date, lat, lon).altitude * (180 / Math.PI)
}

/** Returns Moon phase 0–1 (0 = new moon, 0.5 = full moon, 1 = new moon again). */
export function getMoonPhase(date: Date): number {
  return SunCalc.getMoonIllumination(date).phase
}

// ── Color scale: cloud cover ──────────────────────────────────────────────────

/**
 * Map cloud cover percentage to a background color.
 * 0 % = black (perfectly clear), rising through green → yellow → orange → red.
 */
export function cloudCoverColor(pct: number): string {
  if (pct <= 0)  return '#000'      // crystal clear
  if (pct < 25)  return '#15803d'   // dark green
  if (pct < 50)  return '#ca8a04'   // amber
  if (pct < 75)  return '#ea580c'   // orange
  return '#dc2626'                   // red — heavily overcast
}

// ── Color scale: sky darkness ─────────────────────────────────────────────────

/**
 * Map Sun altitude (degrees) + Moon presence to a CSS grey shade.
 *
 * Shade levels:
 *   0 = #000 (black)      → astronomical night, Sun > 20° below
 *   1 = #333 (dark grey)  → Sun 15–20° below
 *   2 = #666 (mid grey)   → Sun 10–15° below
 *   3 = #aaa (light grey) → Sun 0–10° below (civil/nautical twilight)
 *   4 = #fff (white)      → Sun above horizon
 *
 * Moon above horizon → shift one level lighter (except white stays white).
 */
const SHADE_COLORS = ['#000', '#333', '#666', '#aaa', '#fff'] as const

export function skyDarknessColor(sunAltDeg: number, moonAbove: boolean): string {
  let level: number
  if      (sunAltDeg >= 0)   level = 4
  else if (sunAltDeg >= -10) level = 3
  else if (sunAltDeg >= -15) level = 2
  else if (sunAltDeg >= -20) level = 1
  else                        level = 0

  if (moonAbove && level < 4) level++
  return SHADE_COLORS[level]
}

// ── Moon phase emoji ──────────────────────────────────────────────────────────

/**
 * Return the Unicode moon phase emoji that best matches the given SunCalc
 * phase value (0–1, where 0/1 = new moon, 0.5 = full moon).
 */
export function moonPhaseEmoji(phase: number): string {
  // 8 symbols, each covers 1/8 of the cycle
  const symbols = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
  const idx = Math.round(phase * 8) % 8
  return symbols[idx]
}
