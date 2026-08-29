export function elapsedMs(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round((endedAt - startedAt) * 100) / 100)
}
