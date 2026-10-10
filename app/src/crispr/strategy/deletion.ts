/**
 * Guide pairs that take a region out.
 *
 * Two cuts, one each side of what is to go, and the ends join. What the user
 * needs to decide between pairs is how much they lose beyond the region they
 * asked for, what the join will read as, and whether both guides are any
 * good, so all three are on the row.
 *
 * The result is enough to build the edited sequence, which the panel does
 * when asked, rather than a description of one.
 */

import type { GuideCandidate, Nuclease } from '../types'
import { cutPosition } from '../finder'
import { worstSeverity } from '../score/rules'
import { shiftFeatures, type FeatureLike } from './coding'

export interface DeletionSettings {
  /** How far outside the region a cut may fall. */
  flank: number
  /** Pairs returned, best first. */
  maxPairs: number
}

export const DEFAULT_DELETION: DeletionSettings = { flank: 300, maxPairs: 40 }

export interface DeletionPair {
  left: GuideCandidate
  right: GuideCandidate
  /** The span that goes, [start, end). */
  start: number
  end: number
  length: number
  /** How much is lost beyond the region asked for, left and right. */
  overshoot: { left: number; right: number }
  /** The bases either side of the join, for reading the result at a glance. */
  junction: string
  warnings: string[]
}

/** Bases either side of a join, as left|right with a few bases of each. */
export function junctionAround(bases: string, start: number, end: number, width = 10): string {
  const left = bases.slice(Math.max(0, start - width), start)
  const right = bases.slice(end, end + width)
  return `${left}|${right}`.toUpperCase()
}

export function planDeletion(
  candidates: readonly GuideCandidate[],
  region: { start: number; end: number },
  bases: string,
  circular: boolean,
  nuclease: Nuclease,
  settings: DeletionSettings = DEFAULT_DELETION,
): DeletionPair[] {
  if (nuclease.cleaves === 'none') return []
  const seqLen = bases.length
  const cuts = candidates
    .filter(c => !c.site.offEnd)
    .map(c => ({ candidate: c, cut: cutPosition(c.site, seqLen, circular) }))

  // A guide cuts on the left when its cut is at or before the region's start
  // and not further out than the flank allows, and likewise on the right.
  const left = cuts.filter(c => c.cut <= region.start && c.cut >= region.start - settings.flank)
  const right = cuts.filter(c => c.cut >= region.end && c.cut <= region.end + settings.flank)

  const pairs: DeletionPair[] = []
  for (const l of left) {
    for (const r of right) {
      if (r.cut <= l.cut) continue
      const warnings: string[] = []
      if (worstSeverity(l.candidate.scores.flags) === 'bad' || worstSeverity(r.candidate.scores.flags) === 'bad') {
        warnings.push('One of the pair carries a flag that usually rules a spacer out.')
      }
      if (l.candidate.site.spacer === r.candidate.site.spacer) {
        warnings.push('Both cuts come from the same spacer, so one guide makes both.')
      }
      pairs.push({
        left: l.candidate,
        right: r.candidate,
        start: l.cut,
        end: r.cut,
        length: r.cut - l.cut,
        overshoot: { left: region.start - l.cut, right: r.cut - region.end },
        junction: junctionAround(bases, l.cut, r.cut),
        warnings,
      })
    }
  }

  // Least lost beyond the region first, then the better pair of guides.
  const quality = (p: DeletionPair) =>
    (p.left.scores.onTarget ?? 50) + (p.right.scores.onTarget ?? 50)
  pairs.sort((a, b) => {
    const over = (p: DeletionPair) => p.overshoot.left + p.overshoot.right
    if (a.warnings.length !== b.warnings.length) return a.warnings.length - b.warnings.length
    if (over(a) !== over(b)) return over(a) - over(b)
    return quality(b) - quality(a)
  })
  return pairs.slice(0, settings.maxPairs)
}

export interface DeletionResult {
  bases: string
  features: (FeatureLike & { truncated?: true })[]
  removed: FeatureLike[]
}

/** The sequence a pair leaves behind, with its features moved. */
export function applyDeletion(
  bases: string,
  features: readonly FeatureLike[],
  pair: Pick<DeletionPair, 'start' | 'end'>,
): DeletionResult {
  const next = bases.slice(0, pair.start) + bases.slice(pair.end)
  const { kept, removed } = shiftFeatures(features, pair.start, pair.end, 0)
  return { bases: next, features: kept, removed }
}
