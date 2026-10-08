/**
 * Axis ticks for a chart whose values start at 0: round steps of 1, 2 or 5
 * times a power of ten, up to the first tick at or above the maximum so the
 * tallest bar fits. Shared by the charts on screen and in PDF reports.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw
  const out: number[] = [0]
  while (out[out.length - 1] < max - step * 0.001) out.push(out.length * step)
  return out
}
