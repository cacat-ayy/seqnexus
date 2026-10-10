/**
 * Several samples mapped to the same references, compared.
 *
 * The matrix has one row per variant found in at least one sample (passing
 * the thresholds there) and one column per sample. A cell says how often
 * that sample's reads carry the variant, or that too few of its reads cover
 * the position to say: a blank cell and a 0% cell mean different things. A
 * sample in which the position was not even a candidate site (fewer than 5%
 * of reads differed there, pileup.ts) shows 0% at its stored depth.
 *
 * Each sample also gets a clone verification verdict (assembly/verify.ts):
 * its depth from the stored coverage, both strands from the 16-base coverage
 * summary (a bin with reads on each strand counts for every base in it), and
 * as differences the variants most of its reads carry.
 */

import type { CoverageLevel } from './alignments'
import {
  variantFilters, variantKey, variantLabel, type RefFeature, type Variant, type VariantSettings,
} from '../assembly/variants'
import { verifyPileup, type VerifyReport, type VerifySettings } from '../assembly/verify'
import { codingLabel } from '../assembly/effects'

export interface SampleVariants {
  /** Every candidate variant of the sample on this reference (siteVariants). */
  variants: readonly Variant[]
  /** Depth at each position of the reference. */
  coverage: ArrayLike<number>
}

export interface MatrixCell {
  /** Share of the sample's reads carrying it; null when too few reads cover the position. */
  frequency: number | null
  depth: number
  count: number
  /** It passes the thresholds in this sample. */
  passes: boolean
}

export interface MatrixRow {
  key: string
  /** The variant as the first sample that carries it describes it. */
  variant: Variant
  label: string
  cells: MatrixCell[]
  /** Samples it passes in. */
  passing: number
}

/** Depth used for a variant's position: at the base, or for an insertion at the base before it. */
function depthAt(coverage: ArrayLike<number>, v: Variant): number {
  const p = Math.max(0, v.position - 1)
  return p < coverage.length ? coverage[p] : 0
}

export function samplesMatrix(samples: readonly SampleVariants[], s: VariantSettings): MatrixRow[] {
  const byKey = samples.map(x => new Map(x.variants.map(v => [variantKey(v), v])))
  const rows = new Map<string, Variant>()
  for (const x of samples) {
    for (const v of x.variants) {
      if (variantFilters(v, s).length) continue
      const k = variantKey(v)
      if (!rows.has(k)) rows.set(k, v)
    }
  }
  const out: MatrixRow[] = []
  for (const [key, variant] of rows) {
    const cells = samples.map((x, i): MatrixCell => {
      const v = byKey[i].get(key)
      if (v) return { frequency: v.coverage >= s.minCoverage ? v.frequency : null, depth: v.coverage, count: v.count, passes: variantFilters(v, s).length === 0 }
      const depth = depthAt(x.coverage, variant)
      return { frequency: depth >= Math.max(1, s.minCoverage) ? 0 : null, depth, count: 0, passes: false }
    })
    out.push({ key, variant, label: variantLabel(variant), cells, passing: cells.filter(c => c.passes).length })
  }
  return out.sort((a, b) => a.variant.position - b.variant.position || a.key.localeCompare(b.key))
}

/** Rows where the samples disagree: carried (passing) by some and seen at under the threshold by another that covers it. */
export function differingRows(rows: readonly MatrixRow[], s: VariantSettings): MatrixRow[] {
  return rows.filter(r => r.cells.some(c => c.passes) && r.cells.some(c => c.frequency !== null && c.frequency < s.minFrequency))
}

export function matrixCsv(rows: readonly MatrixRow[], sampleNames: readonly string[], refName: (r: MatrixRow) => string): string {
  const q = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)
  const head = ['Reference', 'Position', 'Type', 'Change', 'Effect', ...sampleNames.flatMap(n => [`${n} frequency`, `${n} depth`])]
  const lines = rows.map(r => [
    refName(r), String(r.variant.position), r.variant.type, r.label,
    r.variant.coding ? codingLabel(r.variant.coding) : r.variant.features.join('; '),
    ...r.cells.flatMap(c => [c.frequency === null ? '' : c.frequency.toFixed(3), String(c.depth)]),
  ].map(q).join(','))
  return [head.map(q).join(','), ...lines].join('\n') + '\n'
}

/** Clone verification of one NGS sample against its reference (see the file's comment). */
export function verifySample(o: {
  reference: { name: string; length: number; circular: boolean }
  reads: number
  coverage: ArrayLike<number>
  levels: readonly CoverageLevel[]
  variants: readonly Variant[]
  features: readonly RefFeature[]
  settings: VerifySettings
}): VerifyReport {
  const fine = o.levels.find(l => l.binSize === 16) ?? o.levels[0]
  const bothStrands = (p: number) => {
    if (!fine) return false
    const b = Math.floor(p / fine.binSize)
    const mean = fine.mean[b] ?? 0
    const fwd = fine.forward[b] ?? 0
    return fwd > 0 && mean - fwd > 1e-6
  }
  // What most reads say: the differences that count against the design.
  const differences = o.variants.filter(v => v.frequency >= 0.5 && v.count >= 2 && v.coverage >= o.settings.minDepth)
  return verifyPileup({
    reference: o.reference,
    reads: o.reads,
    depth: o.coverage,
    bothStrands,
    differences: [...differences],
    features: o.features,
    settings: o.settings,
  })
}
