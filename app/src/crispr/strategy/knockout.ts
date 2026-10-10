/**
 * Guides for knocking a gene out.
 *
 * A cut anywhere in a coding sequence is not equally useful. Too close to the
 * start codon and translation can restart downstream of the damage; too close
 * to the stop and a frameshifted protein keeps almost all of itself and often
 * keeps working. So the candidates are ranked by where they cut along the
 * coding sequence first, and the usual scores break the ties.
 *
 * The ranking is lexicographic rather than a weighted sum, for the same
 * reason the panel keeps its three score columns apart: a single number would
 * hide which property a guide was chosen for. The order is stated in
 * `rankKnockout` and shown in the panel as the reason on each row.
 */

import type { GuideCandidate, Nuclease } from '../types'
import { cutPosition } from '../finder'
import { worstSeverity } from '../score/rules'
import { codingIndex, codonAt, type CodingTarget } from './coding'

export interface KnockoutSettings {
  /** The stretch of the coding sequence to prefer, as fractions from its start. */
  windowStart: number
  windowEnd: number
  /** Out-of-frame share below which a guide is only a fallback. */
  minOutOfFrame: number
}

export const DEFAULT_KNOCKOUT: KnockoutSettings = {
  windowStart: 0.05,
  windowEnd: 0.65,
  minOutOfFrame: 50,
}

export interface KnockoutPick {
  candidate: GuideCandidate
  /** Where the cut falls along the coding sequence, 0 at the start codon. */
  codingFraction: number
  /** The codon the cut falls in, 1-based, and how many there are. */
  codon: number
  codons: number
  outOfFrame: number | null
  /** True when the cut is inside the preferred stretch. */
  inWindow: boolean
  /** Why this one is where it is in the list, in the panel's words. */
  reasons: string[]
  warnings: string[]
}

/**
 * Rank order, best first:
 *
 * 1. cuts inside the preferred stretch of the coding sequence
 * 2. no disqualifying flag
 * 3. out-of-frame share, when it is known
 * 4. the activity score, when the nuclease has a model
 * 5. earlier in the gene
 */
function rankKnockout(a: KnockoutPick, b: KnockoutPick): number {
  if (a.inWindow !== b.inWindow) return a.inWindow ? -1 : 1
  const bad = (p: KnockoutPick) => (worstSeverity(p.candidate.scores.flags) === 'bad' ? 1 : 0)
  if (bad(a) !== bad(b)) return bad(a) - bad(b)
  const oof = (p: KnockoutPick) => p.outOfFrame ?? -1
  if (oof(a) !== oof(b)) return oof(b) - oof(a)
  const on = (p: KnockoutPick) => p.candidate.scores.onTarget ?? -1
  if (on(a) !== on(b)) return on(b) - on(a)
  return a.codingFraction - b.codingFraction
}

export interface KnockoutPlan {
  target: CodingTarget
  picks: KnockoutPick[]
  /** Candidates that cut outside the gene, which are not knockout guides. */
  outside: number
}

export function planKnockout(
  candidates: readonly GuideCandidate[],
  target: CodingTarget,
  seqLen: number,
  circular: boolean,
  nuclease: Nuclease,
  settings: KnockoutSettings = DEFAULT_KNOCKOUT,
): KnockoutPlan {
  const picks: KnockoutPick[] = []
  let outside = 0
  const codons = Math.floor(target.length / 3)

  for (const candidate of candidates) {
    if (nuclease.cleaves === 'none' || candidate.site.offEnd) { outside++; continue }
    const cut = cutPosition(candidate.site, seqLen, circular)
    const coding = codingIndex(target, cut)
    if (coding === null) { outside++; continue }

    const codingFraction = target.length > 0 ? coding / target.length : 0
    const inWindow = codingFraction >= settings.windowStart && codingFraction <= settings.windowEnd
    const { codon } = codonAt(coding)
    const outOfFrame = candidate.scores.outOfFrame

    const reasons: string[] = []
    const warnings: string[] = []
    reasons.push(`codon ${codon} of ${codons}, ${Math.round(codingFraction * 100)}% in`)
    if (outOfFrame !== null) {
      reasons.push(`${Math.round(outOfFrame)}% of its likely deletions shift the frame`)
      if (outOfFrame < settings.minOutOfFrame) {
        warnings.push('Most of its likely deletions keep the reading frame, so the protein may survive.')
      }
    }
    if (codingFraction < settings.windowStart) {
      warnings.push('Very near the start codon, where translation can restart past the damage.')
    }
    if (codingFraction > settings.windowEnd) {
      warnings.push('Late in the gene, where a frameshifted protein keeps most of itself.')
    }
    if (worstSeverity(candidate.scores.flags) === 'bad') {
      warnings.push('Carries a flag that usually rules a spacer out.')
    }

    picks.push({ candidate, codingFraction, codon, codons, outOfFrame, inWindow, reasons, warnings })
  }

  picks.sort(rankKnockout)
  return { target, picks, outside }
}
