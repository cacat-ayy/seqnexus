/** Reading a stored read set description back. */

import type { ReadSetRecord, Technology } from './types'

const TECHS: readonly Technology[] = ['illumina', 'nanopore', 'pacbio', 'other']

/** A stored read set, or null when it is too damaged to use (its reads are then cleaned up). */
export function sanitizeReadSet(raw: unknown): ReadSetRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<ReadSetRecord>
  if (typeof x.id !== 'string' || !x.id || typeof x.chunks !== 'number' || !x.stats || typeof x.stats !== 'object') return null
  if (typeof x.stats.reads !== 'number') return null
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    ...(x as ReadSetRecord),
    name: typeof x.name === 'string' && x.name ? x.name : 'Reads',
    createdAt: num(x.createdAt),
    modifiedAt: num(x.modifiedAt, num(x.createdAt)),
    technology: TECHS.includes(x.technology as Technology) ? x.technology as Technology : 'other',
    paired: x.paired === true,
    files: Array.isArray(x.files) ? x.files.filter(f => f && typeof f.name === 'string') : [],
    storedBytes: num(x.storedBytes),
  }
}
