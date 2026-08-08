
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

export function DailyBand({ date, volume }: { date: string; volume: number }) {
  return (
    <div className="daily-band" aria-hidden="true">
      <span
        className="daily-band-field daily-band-desktop"
        style={{ boxShadow: dailyShadows(date, volume, 620, 64) }}
      />
      <span
        className="daily-band-field daily-band-phone"
        style={{ boxShadow: dailyShadows(date, volume, 340, 54) }}
      />
    </div>
  )
}

/** Date-seeded value noise, ordered through a Bayer matrix into four ink levels. */
export function dailyShadows(date: string, volume: number, width: number, height: number): string {
  const seed = hash(date)
  const ink = Math.min(1, Math.log2(Math.max(0, volume) + 1) / 5)
  const shadows: string[] = []

  for (let y = 0; y < height; y += 5) {
    for (let x = 0; x < width; x += 5) {
      const gridX = x / 5
      const gridY = y / 5
      const noise = valueNoise(seed, gridX / 9, gridY / 7)
      const threshold = (BAYER_4[gridY % 4]?.[gridX % 4] ?? 0) / 16
      const value = noise * 0.72 + ink * 0.48 - threshold * 0.28
      const level = value > 0.82 ? 3 : value > 0.62 ? 2 : value > 0.42 ? 1 : 0
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
