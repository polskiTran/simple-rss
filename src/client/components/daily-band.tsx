import type { CSSProperties } from 'react'

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

export const BAND_WIDTH_PX = 708
export const BAND_HEIGHT_PX = 114

const PITCH_PX = 5

export function DailyBand({ date, volume }: { date: string; volume: number }) {
  const geometry = {
    '--daily-band-height': `${BAND_HEIGHT_PX}px`,
    '--daily-band-pitch': `${PITCH_PX}px`,
  } as CSSProperties

  return (
    <div className="daily-band" aria-hidden="true" style={geometry}>
      <span
        className="daily-band-field"
        style={{ boxShadow: dailyShadows(date, volume, BAND_WIDTH_PX, BAND_HEIGHT_PX) }}
      />
    </div>
  )
}

/** Date-seeded value noise, ordered through a Bayer matrix into four ink levels. */
export function dailyShadows(date: string, volume: number, width: number, height: number): string {
  const seed = hash(date)
  const ink = Math.min(1, Math.log2(Math.max(0, volume) + 1) / 5)

  const bar = 0.74 - 0.3 * ink

  const shadows: string[] = []

  for (let y = 0; y < height; y += PITCH_PX) {
    for (let x = 0; x < width; x += PITCH_PX) {
      const gridX = x / PITCH_PX
      const gridY = y / PITCH_PX
      const drift = valueNoise(seed, gridX / 17 + gridY * 0.045 + 0.37, gridY / 8.6 + gridX * 0.012 + 0.61)
      const grain = valueNoise(seed ^ 0x9e3779b9, gridX / 5.7 + 0.29, gridY / 3.2 + gridX * 0.02 + 0.83)
      const noise = drift * 0.68 + grain * 0.32
      const dither = ((BAYER_4[gridY % 4]?.[gridX % 4] ?? 0) - 7.5) / 16
      const value = noise - bar + dither * 0.11
      const level = value <= 0 ? 0 : value < 0.09 ? 1 : value < 0.19 ? 2 : 3
      shadows.push(`${x}px ${y}px 0 var(--band-${level})`)
    }
  }

  return shadows.join(',')
}

function valueNoise(seed: number, x: number, y: number): number {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const horizontal = smooth(x - left)
  const vertical = smooth(y - top)
  const upper = interpolate(random(seed, left, top), random(seed, left + 1, top), horizontal)
  const lower = interpolate(random(seed, left, top + 1), random(seed, left + 1, top + 1), horizontal)
  return interpolate(upper, lower, vertical)
}

function random(seed: number, x: number, y: number): number {
  let value = seed ^ Math.imul(x, 374_761_393) ^ Math.imul(y, 668_265_263)
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177)
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value)
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function hash(value: string): number {
  let result = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16_777_619)
  }
  return result >>> 0
}
