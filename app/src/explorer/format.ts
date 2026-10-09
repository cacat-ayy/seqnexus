/**
 * Formatting for explorer metadata lines.
 *
 * These strings sit under a name in a narrow sidebar, so they are terse by
 * design: three or four characters of number and a unit, never a full
 * sentence. Same spirit as `formatBytes` in StorageIndicator.
 */

/** 0.9734 -> "97%". Fractions, as the alignment engine reports them. */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** Pluralise a count with its noun: (1, 'read') -> "1 read". */
export function formatCount(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`
}

/**
 * Mean Phred score over a quality track.
 *
 * Returns null for an empty track rather than NaN, so callers can drop the
 * stat instead of printing "Q NaN".
 */
export function meanQuality(scores: readonly number[]): number | null {
  if (scores.length === 0) return null
  let sum = 0
  for (const q of scores) sum += q
  return sum / scores.length
}
