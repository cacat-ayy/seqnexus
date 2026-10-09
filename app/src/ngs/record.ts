/** Reading a stored read set description back. */

import type { ReadSetRecord, Technology } from './types'
import type { QcSummary } from './qcreport/types'
import { LIBRARY_TYPES, type LibraryType } from './qcreport/expected'

const TECHS: readonly Technology[] = ['illumina', 'nanopore', 'pacbio', 'other']

const QC_STATUS = new Set(['pass', 'warn', 'fail', 'skip'])

/** A stored report summary, or undefined when it is missing or damaged. */
function validQc(q: unknown): QcSummary | undefined {
  if (!q || typeof q !== 'object') return undefined
  const s = q as Partial<QcSummary>
  if (typeof s.version !== 'number' || !Array.isArray(s.status) || s.status.length === 0) return undefined
  const ok = s.status.every(m => m && typeof m === 'object' && Object.values(m).every(v => QC_STATUS.has(v as string)))
  return ok ? { version: s.version, status: s.status } : undefined
}

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
    qc: validQc(x.qc),
    library: LIBRARY_TYPES.includes(x.library as LibraryType) ? x.library : undefined,
  }
}
