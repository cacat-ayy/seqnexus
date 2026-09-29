/**
 * One optimization run, end to end.
 *
 * Resolves the target, optimizes each region with the sequence around it as
 * context, and collects the edits and the numbers. The modal renders what this
 * returns and the store applies `edits`; neither has to know how any of it
 * works, and a test can drive a whole run without a DOM.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import type { ConstraintSet, Violation } from './constraints'
import type { GeneticCode } from './genetic-codes'
import { codonMetrics, percentIdentity, type CodonMetrics } from './metrics'
import {
  optimizeRegion, type CodonChange, type OptimizeOptions,
} from './optimize'
import {
  regionEdits, resolveTargets, type TargetKind, type TargetOptions,
} from './targets'
import { unusableResidues, type CodonUsageTable } from './usage-tables'
import { translateWith } from './genetic-codes'

export interface BaseEditSpec {
  start: number
  end: number
  bases: string
}

export interface RegionOutcome {
  id: string
  label: string
  reverse: boolean
  originalBases: string
  optimizedBases: string
  changes: CodonChange[]
  violations: Violation[]
  unresolved: number
  budgetExhausted: boolean
  lockedCodons: number
  before: CodonMetrics
  after: CodonMetrics
  identity: number
  edits: BaseEditSpec[]
}

export interface OptimizationRun {
  regions: RegionOutcome[]
  warnings: string[]
  /** Every edit, ready for the store. Ordered by position. */
  edits: BaseEditSpec[]
  totalChanges: number
  totalViolations: number
}

export interface RunInput {
  kind: TargetKind
  sequence: Sequence
  annotations: readonly Annotation[]
  code: GeneticCode
  table: CodonUsageTable
  constraints: ConstraintSet
  targetOptions: TargetOptions
  optimizeOptions: Omit<OptimizeOptions, 'code' | 'table' | 'constraints'>
  selection?: { start: number; end: number } | null
  featureIds?: ReadonlySet<string>
  /** How much untouched sequence to show the constraints on either side. */
  contextBases?: number
}

/**
 * Flanking sequence, so a motif that straddles the edge of the region is seen.
 *
 * On a circular sequence the context wraps, because the join is not a boundary
 * to a restriction enzyme.
 */
function contextAround(
  sequence: Sequence, map: readonly number[], reverse: boolean, width: number,
): { before: string; after: string } {
  if (width <= 0 || map.length === 0) return { before: '', after: '' }
  const len = sequence.length
  const circular = sequence.topology === 'circular'
  // The map is in coding order, so its own direction says which way to walk.
  const step = reverse ? -1 : 1

  /** Bases at these genomic positions, in coding orientation. */
  const read = (positions: number[]): string => {
    const out: string[] = []
    for (const raw of positions) {
      let at = raw
      if (at < 0 || at >= len) {
        if (!circular) continue
        at = ((at % len) + len) % len
      }
      const base = sequence.baseAt(at).toUpperCase()
      out.push(reverse ? (COMPLEMENT[base] ?? 'N') : base)
    }
    return out.join('')
  }

  const first = map[0]
  const last = map[map.length - 1]
  const beforePositions: number[] = []
  for (let n = width; n >= 1; n--) beforePositions.push(first - step * n)
  const afterPositions: number[] = []
  for (let n = 1; n <= width; n++) afterPositions.push(last + step * n)

  return { before: read(beforePositions), after: read(afterPositions) }
}

const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G', N: 'N' }

export function runOptimization(input: RunInput): OptimizationRun {
  const {
    kind, sequence, annotations, code, table, constraints,
    targetOptions, optimizeOptions, contextBases = 60,
  } = input

  const { regions, warnings } = resolveTargets({
    kind, sequence, annotations, code, options: targetOptions,
    selection: input.selection, featureIds: input.featureIds,
  })

  const outcomes: RegionOutcome[] = []
  const allWarnings = [...warnings]

  for (const region of regions) {
    const unusable = unusableResidues(table, code, translateWith(code, region.codingBases))
    if (unusable.length > 0) {
      allWarnings.push(
        `${region.label}: the usage table has no codon for ${unusable.join(', ')}, those residues were left alone`,
      )
    }

    const context = contextAround(sequence, region.map, region.reverse, contextBases)
    const result = optimizeRegion(region.codingBases, region.locked, {
      ...optimizeOptions, code, table, constraints,
    }, context)

    const before = codonMetrics(region.codingBases, code, table, optimizeOptions.rareThreshold)
    const after = codonMetrics(result.bases, code, table, optimizeOptions.rareThreshold)

    outcomes.push({
      id: region.id,
      label: region.label,
      reverse: region.reverse,
      originalBases: region.codingBases,
      optimizedBases: result.bases,
      changes: result.changes,
      violations: result.violations,
      unresolved: result.unresolved,
      budgetExhausted: result.budgetExhausted,
      lockedCodons: region.locked.size,
      before,
      after,
      identity: percentIdentity(region.codingBases, result.bases),
      edits: result.changes.length > 0 ? regionEdits(region, result.bases) : [],
    })
  }

  const edits = outcomes.flatMap(o => o.edits).sort((a, b) => a.start - b.start)

  return {
    regions: outcomes,
    warnings: allWarnings,
    edits,
    totalChanges: outcomes.reduce((n, o) => n + o.changes.length, 0),
    totalViolations: outcomes.reduce((n, o) => n + o.violations.length, 0),
  }
}

/** Sum of the per-region metrics, for the headline numbers. */
export function combinedMetrics(
  outcomes: readonly RegionOutcome[], pick: 'before' | 'after',
): CodonMetrics | null {
  if (outcomes.length === 0) return null
  if (outcomes.length === 1) return outcomes[0][pick]

  let codons = 0
  let rare = 0
  let gcWeighted = 0
  let gc3Weighted = 0
  let caiLogSum = 0
  let caiCodons = 0
  let runAT = 0
  let runGC = 0
  for (const o of outcomes) {
    const m = o[pick]
    codons += m.codons
    rare += m.rareCodons
    gcWeighted += m.gc * m.codons
    gc3Weighted += m.gc3 * m.codons
    if (m.cai !== null) { caiLogSum += Math.log(m.cai) * m.codons; caiCodons += m.codons }
    runAT = Math.max(runAT, m.longestRunAT)
    runGC = Math.max(runGC, m.longestRunGC)
  }
  return {
    cai: caiCodons > 0 ? Math.exp(caiLogSum / caiCodons) : null,
    gc: codons > 0 ? gcWeighted / codons : 0,
    gc3: codons > 0 ? gc3Weighted / codons : 0,
    codons,
    rareCodons: rare,
    longestRunAT: runAT,
    longestRunGC: runGC,
  }
}
