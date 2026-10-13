/**
 * Clone verification: does a construct's sequencing confirm it?
 *
 * Given reads mapped to the designed construct, every feature of interest
 * is checked for coverage (how much of it the reads cover, optionally on
 * both strands) and for differences (positions where most reads disagree
 * with the design, with what that does to a protein). The verdict is
 * "Verified" only when every feature checked is fully covered and matches.
 */

import { callVariants, DEFAULT_VARIANT_SETTINGS, referenceIndex, type RefFeature, type Variant } from './variants'
import type { ContigDoc } from './types'
import { allCoding, codingLabel, codingSummary } from './effects'
import { csvCell } from '../utils/csv-cell'

export interface VerifySettings {
  /** Reads needed over a base for it to count as covered. */
  minDepth: number
  /** Also need a forward and a reverse read over it. */
  bothStrands: boolean
  /** Features to check; null checks every feature except "source". */
  featureIds: string[] | null
}

export const DEFAULT_VERIFY: VerifySettings = { minDepth: 1, bothStrands: false, featureIds: null }

export type VerifyStatus = 'verified' | 'differences' | 'incomplete'

export interface FeatureCheck {
  feature: RefFeature
  length: number
  /** Share of the feature's bases that are covered. */
  covered: number
  /** Share covered by reads on both strands. */
  bothStrands: number
  minDepth: number
  differences: Variant[]
  status: VerifyStatus
}

export interface VerifyReport {
  verdict: VerifyStatus
  reference: { name: string; length: number; circular: boolean }
  reads: number
  covered: number
  bothStrands: number
  /** Stretches of the reference that are not covered, 1-based inclusive. */
  uncovered: { from: number; to: number }[]
  /** Every position where the consensus of the reads differs from the design. */
  differences: Variant[]
  features: FeatureCheck[]
  settings: VerifySettings
}

export function verifyClone(doc: ContigDoc, consensus: string, features: readonly RefFeature[], s: VerifySettings): VerifyReport | null {
  if (!doc.reference) return null
  const L = doc.reference.length
  const refIdx = referenceIndex(doc)
  const depth = new Uint16Array(L)
  const fwd = new Uint8Array(L)
  const rev = new Uint8Array(L)
  for (const r of doc.rows) {
    for (let k = 0; k < r.seq.length; k++) {
      const p = refIdx[r.start + k]
      if (p < 0) continue
      depth[p] = Math.min(65535, depth[p] + 1)
      if (r.reversed) rev[p] = 1
      else fwd[p] = 1
    }
  }
  // Differences: what most reads say, whatever the quality (low-confidence ones are flagged by their P-value).
  const differences = callVariants(doc, consensus, features, {
    ...DEFAULT_VARIANT_SETTINGS, minFrequency: 0.5, maxPValue: 1,
  })
  return verifyPileup({
    reference: { name: doc.reference.name, length: L, circular: doc.reference.circular },
    reads: doc.rows.length,
    depth,
    bothStrands: p => fwd[p] === 1 && rev[p] === 1,
    differences,
    features,
    settings: s,
  })
}

/**
 * The verdict from a pileup, whatever made it: depth at each reference
 * position, whether both strands cover it, and the differences most reads
 * show. Shared by Sanger contigs (verifyClone) and NGS samples, whose depth
 * comes from the stored coverage.
 */
export function verifyPileup(o: {
  reference: VerifyReport['reference']
  reads: number
  depth: ArrayLike<number>
  bothStrands: (p: number) => boolean
  differences: Variant[]
  features: readonly RefFeature[]
  settings: VerifySettings
}): VerifyReport {
  const { depth, settings: s, differences } = o
  const L = o.reference.length
  const ok = (p: number) => depth[p] >= s.minDepth && (!s.bothStrands || o.bothStrands(p))
  let covered = 0
  let both = 0
  const uncovered: { from: number; to: number }[] = []
  for (let p = 0; p < L; p++) {
    if (ok(p)) covered++
    else if (uncovered.length && uncovered[uncovered.length - 1].to === p) uncovered[uncovered.length - 1].to = p + 1
    else uncovered.push({ from: p + 1, to: p + 1 })
    if (o.bothStrands(p)) both++
  }

  const chosen = o.features.filter(f => (s.featureIds ? s.featureIds.includes(f.id) : f.type !== 'source' && f.type !== 'variation'))
  const checks: FeatureCheck[] = chosen.map(f => {
    const positions = featurePositions(f, L)
    let cov = 0
    let bs = 0
    let min = Infinity
    for (const p of positions) {
      if (ok(p)) cov++
      if (o.bothStrands(p)) bs++
      if (depth[p] < min) min = depth[p]
    }
    const n = positions.length || 1
    const diffs = differences.filter(v => v.features.includes(f.name) && overlaps(f, v, L))
    const status: VerifyStatus = diffs.length ? 'differences' : cov < positions.length ? 'incomplete' : 'verified'
    return { feature: f, length: positions.length, covered: cov / n, bothStrands: bs / n, minDepth: Number.isFinite(min) ? min : 0, differences: diffs, status }
  })

  let verdict: VerifyStatus
  if (checks.length > 0) {
    verdict = checks.some(c => c.status === 'differences') ? 'differences' : checks.some(c => c.status === 'incomplete') ? 'incomplete' : 'verified'
  } else {
    verdict = differences.length ? 'differences' : covered < L ? 'incomplete' : 'verified'
  }

  return {
    verdict,
    reference: o.reference,
    reads: o.reads,
    covered: L ? covered / L : 0,
    bothStrands: L ? both / L : 0,
    uncovered,
    differences,
    features: checks,
    settings: s,
  }
}

function featurePositions(f: RefFeature, L: number): number[] {
  const out: number[] = []
  if (f.start <= f.end) for (let p = f.start; p < Math.min(f.end, L); p++) out.push(p)
  else { for (let p = f.start; p < L; p++) out.push(p); for (let p = 0; p < f.end; p++) out.push(p) }
  return out
}

function overlaps(f: RefFeature, v: Variant, L: number): boolean {
  const p = v.position - 1
  const inside = (x: number) => (f.start <= f.end ? x >= f.start && x < f.end : x >= f.start || x < f.end)
  void L
  return inside(p) || (v.type === 'Insertion' && inside(p + 1))
}

export const STATUS_LABEL: Record<VerifyStatus, string> = {
  verified: 'Verified',
  differences: 'Differences found',
  incomplete: 'Not fully covered',
}

const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

/** The report as CSV: one row per feature, then one per difference. */
export function verifyCsv(r: VerifyReport): string {
  const q = csvCell
  const lines = [
    `Clone verification,${q(r.reference.name)},${STATUS_LABEL[r.verdict]}`,
    `Reads,${r.reads}`,
    `Covered,${pct(r.covered)}`,
    `Both strands,${pct(r.bothStrands)}`,
    '',
    'Feature,Type,Status,Length,Covered,Both strands,Lowest depth,Differences',
    ...r.features.map(f => [f.feature.name, f.feature.type, STATUS_LABEL[f.status], String(f.length), pct(f.covered), pct(f.bothStrands), String(f.minDepth), f.differences.map(d => describeDifference(d, f.feature)).join('; ')].map(q).join(',')),
    '',
    'Position,Change,Frequency,Coverage,P-value,Features,cDNA change,Protein change,Effect,Other coding changes',
    ...r.differences.map(v => [String(v.position), describeChange(v), v.frequency.toFixed(2), String(v.coverage), v.pValue.toExponential(1), v.features.join('; '), v.coding?.cdna ?? '', v.coding?.protein ?? '', v.coding?.effect ?? '', v.otherCoding.map(codingSummary).join('; ')].map(q).join(',')),
  ]
  return lines.join('\n') + '\n'
}

export function describeChange(v: Variant): string {
  if (v.type === 'SNP') return `${v.ref}>${v.alt}`
  return v.type === 'Insertion' ? `ins ${v.alt}` : `del ${v.ref}`
}

/**
 * "7 A>G: K2E (missense)". In a feature's row, the change to that feature;
 * otherwise the change to the coding feature it hurts most.
 */
export function describeDifference(v: Variant, feature?: RefFeature): string {
  const c = (feature && allCoding(v).find(x => x.feature === feature.name)) || v.coding
  return `${v.position} ${describeChange(v)}${c ? `: ${codingLabel(c)}` : ''}`
}
