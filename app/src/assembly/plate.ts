/**
 * A plate of clones checked at once: every contig of an assembly mapped to
 * its designed construct gets the clone verification verdict
 * (verify.ts), under one set of settings for the whole plate.
 *
 * Which features are checked is set by type rather than one by one, since
 * clones may be mapped to different constructs: by default every feature
 * except primer sites and miscellaneous features, as the verification of a
 * single contig starts (a primer site is where a read starts, rarely what
 * the clone is checked for). A construct left with no feature to check is
 * checked whole.
 */

import type { RefFeature } from './variants'
import { describeDifference, STATUS_LABEL, verifyClone, type VerifyReport, type VerifyStatus } from './verify'
import type { ContigDoc } from './types'
import { csvCell } from '../utils/csv-cell'

export interface PlateVerifySettings {
  /** Reads needed over a base for it to count as covered. */
  minDepth: number
  /** Also need a forward and a reverse read over it. */
  bothStrands: boolean
  /** Feature types not checked. */
  skipTypes: string[]
}

export const DEFAULT_PLATE_VERIFY: PlateVerifySettings = { minDepth: 1, bothStrands: false, skipTypes: ['primer_bind', 'misc_feature'] }

/** Never checked: the record itself, and findings saved earlier (variants, junctions). */
const NEVER_CHECKED = new Set(['source', 'variation'])

export function sanitizePlateVerify(raw: unknown): PlateVerifySettings | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Partial<PlateVerifySettings>
  if (typeof x.minDepth !== 'number' || !Number.isInteger(x.minDepth) || x.minDepth < 1 || x.minDepth > 100) return null
  return {
    minDepth: x.minDepth,
    bothStrands: x.bothStrands === true,
    skipTypes: Array.isArray(x.skipTypes) ? x.skipTypes.filter((t): t is string => typeof t === 'string') : DEFAULT_PLATE_VERIFY.skipTypes,
  }
}

/** Feature types that can be checked, across the constructs, in the order first met. */
export function checkableTypes(featureSets: readonly (readonly RefFeature[])[]): string[] {
  const out: string[] = []
  for (const fs of featureSets) for (const f of fs) if (!NEVER_CHECKED.has(f.type) && !out.includes(f.type)) out.push(f.type)
  return out
}

/** One contig's verdict under the plate's settings; null when it was not mapped to a reference. */
export function verifyPlateContig(doc: ContigDoc, consensus: string, features: readonly RefFeature[], s: PlateVerifySettings): VerifyReport | null {
  const featureIds = features.filter(f => !NEVER_CHECKED.has(f.type) && !s.skipTypes.includes(f.type)).map(f => f.id)
  return verifyClone(doc, consensus, features, { minDepth: s.minDepth, bothStrands: s.bothStrands, featureIds })
}

export interface CloneResult {
  contigId: string
  /** The clone (the contig's name). */
  name: string
  /** The construct it was mapped to. */
  reference: string | null
  reads: number
  report: VerifyReport | null
  /** The consensus, gaps removed. */
  consensus: string
}

export type PlateFilter = 'all' | VerifyStatus

export function plateCounts(results: readonly CloneResult[]): Record<PlateFilter, number> {
  const c: Record<PlateFilter, number> = { all: results.length, verified: 0, differences: 0, incomplete: 0 }
  for (const r of results) if (r.report) c[r.report.verdict]++
  return c
}

/** The lowest depth over the features checked, or null when the construct was checked whole. */
export function lowestDepth(r: VerifyReport): number | null {
  return r.features.length ? Math.min(...r.features.map(f => f.minDepth)) : null
}

/** Features not verified: "lacZ (not fully covered), bla (differences found)". */
export function failedFeatures(r: VerifyReport): string {
  return r.features.filter(f => f.status !== 'verified').map(f => `${f.feature.name} (${STATUS_LABEL[f.status].toLowerCase()})`).join(', ')
}

const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

/** One row per clone, for a spreadsheet or a LIMS. */
export function plateCsv(results: readonly CloneResult[], s: PlateVerifySettings): string {
  const q = csvCell
  const lines = [
    `Covered means,at least ${s.minDepth} ${s.minDepth === 1 ? 'read' : 'reads'}${s.bothStrands ? ' on both strands' : ''}`,
    `Not checked,${s.skipTypes.join('; ') || 'nothing'}`,
    '',
    'Clone,Reference,Verdict,Reads,Covered,Both strands,Lowest depth,Features not verified,Differences',
    ...results.map(r => {
      const v = r.report
      return [
        r.name, r.reference ?? '', v ? STATUS_LABEL[v.verdict] : 'Not mapped to a reference', String(r.reads),
        v ? pct(v.covered) : '', v ? pct(v.bothStrands) : '', v ? String(lowestDepth(v) ?? '') : '',
        v ? failedFeatures(v) : '', v ? v.differences.map(d => describeDifference(d)).join('; ') : '',
      ].map(q).join(',')
    }),
  ]
  return lines.join('\n') + '\n'
}

/** The clones' consensus sequences as FASTA, each named after its clone, 70 bases a line. */
export function plateFasta(results: readonly CloneResult[]): string {
  return results.filter(r => r.consensus.length > 0).map(r => {
    const about = [r.reference ? `mapped to ${r.reference}` : '', r.report ? STATUS_LABEL[r.report.verdict].toLowerCase() : ''].filter(Boolean).join(', ')
    const lines = r.consensus.match(/.{1,70}/g) ?? []
    return `>${r.name.replace(/\s+/g, '_')}${about ? ` ${about}` : ''}\n${lines.join('\n')}\n`
  }).join('')
}
