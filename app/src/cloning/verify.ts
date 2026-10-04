/**
 * Checking a construct once it is built.
 *
 * A clone is confirmed at its junctions: the rest of it came from sequences
 * that were already known, but the seams are where a cloning reaction goes
 * wrong. So a verification plan is a read over every junction, placed far
 * enough upstream that the seam falls in the clean middle of the trace rather
 * than in the first fifty bases, which are never readable.
 */

import type { Assembly } from './product'
import { tileSequencingPrimers, DEFAULT_SEQUENCING, type SequencingPrimer } from '../primers/design/sequencing'
import { DEFAULT_CONSTRAINTS, type PrimerConstraints } from '../primers/scoring'

export interface JunctionRead {
  /** Which junction of the product this read confirms. */
  junction: number
  /** Position of the seam on the product. */
  at: number
  primer: SequencingPrimer
  name: string
}

export interface VerifyPlan {
  reads: JunctionRead[]
  /** Junctions no primer could be placed for. */
  uncovered: number[]
  warnings: string[]
}

/**
 * One primer per junction, reading across it.
 *
 * The primer is looked for in a window ending `lead` bases before the seam,
 * so the seam lands where the trace is good. A junction with no usable primer
 * is reported rather than quietly skipped — it is the one place you most need
 * to see.
 */
export function planJunctionReads(
  product: Assembly,
  options: { lead?: number; constraints?: PrimerConstraints } = {},
): VerifyPlan {
  const constraints = options.constraints ?? DEFAULT_CONSTRAINTS
  const lead = options.lead ?? DEFAULT_SEQUENCING.lead
  const circular = product.topology === 'circular'
  const size = product.sequence.length
  const reads: JunctionRead[] = []
  const uncovered: number[] = []
  const warnings: string[] = []

  if (product.junctions.length === 0) {
    return { reads: [], uncovered: [], warnings: ['This product has no junctions to check.'] }
  }

  product.junctions.forEach((junction, index) => {
    // A short read either side of the seam is all that has to be covered.
    const span = Math.min(400, Math.floor(size / 2))
    const from = junction.at - span
    const to = junction.at + span

    if (!circular && (from < 0 || to > size)) {
      // Near the end of a linear product there may be no room upstream.
      const clampedFrom = Math.max(0, from)
      const clampedTo = Math.min(size, to)
      if (clampedTo - clampedFrom < 100) {
        uncovered.push(index)
        return
      }
    }

    const region = circular
      ? { start: ((from % size) + size) % size, end: ((to % size) + size) % size }
      : { start: Math.max(0, from), end: Math.min(size, to) }

    const plan = tileSequencingPrimers(
      product.sequence,
      product.topology,
      region,
      constraints,
      { ...DEFAULT_SEQUENCING, strands: 'forward', lead, readLength: Math.max(300, span * 2) },
    )

    if ('error' in plan || plan.primers.length === 0) {
      uncovered.push(index)
      return
    }

    // The one whose read covers the seam with the most to spare either side.
    const best = plan.primers.reduce((a, b) => (distanceInto(b, junction.at, size) > distanceInto(a, junction.at, size) ? b : a))
    reads.push({
      junction: index,
      at: junction.at,
      primer: best,
      name: `${product.name} junction ${index + 1}`,
    })
    warnings.push(...plan.warnings)
  })

  if (uncovered.length > 0) {
    warnings.push(
      `No primer could be placed for ${uncovered.length} junction${uncovered.length === 1 ? '' : 's'}: ` +
      'the sequence around the seam may be too repetitive or too extreme in GC.',
    )
  }

  return { reads, uncovered, warnings: [...new Set(warnings)] }
}

/** How far into a primer's read the seam falls, counted from the nearer end. */
function distanceInto(primer: SequencingPrimer, at: number, size: number): number {
  const start = primer.read.start
  const end = primer.read.end > primer.read.start ? primer.read.end : primer.read.end + size
  const seam = at >= start ? at : at + size
  if (seam < start || seam > end) return -1
  return Math.min(seam - start, end - seam)
}
