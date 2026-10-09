/** Short figures for read sets: counts in thousands and millions, read lengths, sizes. */

import { isLongRead, TECHNOLOGY_LABEL, type ReadSetRecord } from './types'
import { formatBp } from '../utils/format'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat('en')

/** 950, 12.4K, 1.7M. */
export function compactCount(n: number): string {
  return n < 10_000 ? whole.format(n) : compact.format(n)
}

/** How the reads are shaped: 2×150 bp for a pair, N50 for long reads. */
export function readShape(r: ReadSetRecord): string {
  const s = r.stats
  if (isLongRead(r.technology)) return `N50 ${formatBp(s.n50)}`
  const len = Math.round(s.maxLength)
  return r.paired ? `2×${len} bp` : `${len} bp`
}

/** "1.7M pairs", "84.2K reads". */
export function readCountLabel(r: ReadSetRecord): string {
  if (r.paired) return `${compactCount(r.stats.reads / 2)} ${r.stats.reads === 2 ? 'pair' : 'pairs'}`
  return `${compactCount(r.stats.reads)} ${r.stats.reads === 1 ? 'read' : 'reads'}`
}

export function technologyLabel(r: ReadSetRecord): string {
  return TECHNOLOGY_LABEL[r.technology]
}
