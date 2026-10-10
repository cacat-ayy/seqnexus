/**
 * How likely a spacer is to work, and why.
 *
 * What this is: a transparent heuristic over sequence properties that are
 * consistently reported to track SpCas9 activity. What it is not: one of the
 * published fitted models. Those are regressions over thousands of measured
 * guides, they need a fixed window of flanking sequence, and their
 * coefficients belong in a data file next to this one. The registry below
 * exists so such a table can be added as data and selected per nuclease
 * without touching the finder or the panel.
 *
 * Because the number is a heuristic, the breakdown matters more than the
 * score: every term is returned with its contribution, so the inspector can
 * show what helped and what hurt rather than asking the user to trust 72 out
 * of 100. Sorting on a single column stays possible, but the reason is always
 * one hover away.
 *
 * A nuclease with no model reports null, which the UI shows as a dash. That is
 * deliberate: borrowing a Cas9 model for Cas12a would read as information
 * while being noise.
 */

import { maxHomopolymerRun, hairpinScore } from '../../primers/scoring'
import type { Nuclease, OnTargetModelId } from '../types'
import { gcFraction } from './rules'

export interface OnTargetTerm {
  label: string
  /** Points added to or taken from the base score. */
  delta: number
}

export interface OnTargetBreakdown {
  model: OnTargetModelId
  /** 0 to 100, or null when no model applies to this nuclease. */
  score: number | null
  terms: OnTargetTerm[]
  /** One line naming what the model is, shown above the breakdown. */
  caveat: string
}

const BASE_SCORE = 50
/** GC fraction the heuristic treats as ideal. */
export const GC_OPTIMUM = 0.55
/** How far from the optimum GC costs the full GC term. */
const GC_SPAN = 0.35
const GC_WEIGHT = 20

const HEURISTIC_CAVEAT =
  'A transparent heuristic over sequence properties, not a fitted model. Use it to rank candidates, not as a probability.'

/** Round to one decimal so a breakdown adds up to what the score shows. */
function r1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * The SpCas9 heuristic. Terms, in the order they are shown:
 *
 * - GC content, best near the optimum and falling off either side.
 * - T at the four bases next to the PAM, which tracks poor activity.
 * - The base immediately next to the PAM, where G does best.
 * - The first base of an NGG PAM, a mild and well reported preference.
 * - Penalties for a terminator run, a long homopolymer and self-folding.
 */
function heuristicCas9(spacer: string, nuclease: Nuclease, pam: string): OnTargetBreakdown {
  const s = spacer.toUpperCase()
  const terms: OnTargetTerm[] = []
  if (s.length === 0) {
    return { model: 'heuristic-cas9', score: null, terms, caveat: HEURISTIC_CAVEAT }
  }

  const gc = gcFraction(s)
  const gcDelta = GC_WEIGHT * (1 - Math.min(1, Math.abs(gc - GC_OPTIMUM) / GC_SPAN))
  terms.push({ label: `GC ${Math.round(gc * 100)}%`, delta: r1(gcDelta - GC_WEIGHT / 2) })

  // The PAM-proximal end is where mismatches and weak bases cost most. For a
  // 3' PAM that is the last four bases of the spacer, for a 5' PAM the first
  // four, since the spacer is always written 5' to 3'.
  const proximal = nuclease.pamSide === 'threePrime' ? s.slice(-4) : s.slice(0, 4)
  const tCount = [...proximal].filter(c => c === 'T').length
  if (tCount > 0) terms.push({ label: `${tCount} T next to the PAM`, delta: -4 * tCount })

  const adjacent = nuclease.pamSide === 'threePrime' ? s[s.length - 1] : s[0]
  const adjacentDelta = adjacent === 'G' ? 6 : adjacent === 'C' ? 2 : adjacent === 'T' ? -6 : 0
  if (adjacentDelta !== 0) terms.push({ label: `${adjacent} against the PAM`, delta: adjacentDelta })

  if (/^[ACGT]GG$/.test(pam.toUpperCase())) {
    const first = pam[0].toUpperCase()
    const pamDelta = first === 'G' ? 4 : first === 'A' ? 2 : first === 'T' ? -2 : 0
    if (pamDelta !== 0) terms.push({ label: `${pam} PAM`, delta: pamDelta })
  }

  if (s.includes('TTTT')) terms.push({ label: 'TTTT in the spacer', delta: -25 })

  const run = maxHomopolymerRun(s)
  if (run >= 5) terms.push({ label: `${run}-base run`, delta: -8 })

  const stem = hairpinScore(s)
  if (stem >= 7) terms.push({ label: `${stem}-bp self-folding stem`, delta: -8 })

  const raw = terms.reduce((sum, t) => sum + t.delta, BASE_SCORE)
  return {
    model: 'heuristic-cas9',
    score: Math.max(0, Math.min(100, Math.round(raw))),
    terms,
    caveat: HEURISTIC_CAVEAT,
  }
}

export interface OnTargetModel {
  id: OnTargetModelId
  name: string
  /** Whether the model needs flanking sequence beyond the site itself. */
  needsContext: boolean
  run(spacer: string, nuclease: Nuclease, pam: string): OnTargetBreakdown
}

/**
 * Every model the app can apply. A fitted model arrives as one more entry
 * whose `run` reads its coefficients from a data file, and as one changed
 * field on the nuclease rows it was fitted for.
 */
export const ON_TARGET_MODELS: readonly OnTargetModel[] = [
  { id: 'heuristic-cas9', name: 'Sequence heuristic (Cas9)', needsContext: false, run: heuristicCas9 },
]

const NO_MODEL: OnTargetBreakdown = {
  model: 'none',
  score: null,
  terms: [],
  caveat: 'No activity model is fitted for this nuclease, so no score is shown. The flags and the specificity still apply.',
}

/** Score a spacer with whichever model its nuclease names. */
export function onTargetScore(spacer: string, nuclease: Nuclease, pam: string): OnTargetBreakdown {
  const model = ON_TARGET_MODELS.find(m => m.id === nuclease.onTargetModel)
  if (!model) return NO_MODEL
  return model.run(spacer, nuclease, pam)
}

/** The model's display name, for a column header or a tooltip. */
export function onTargetModelName(id: OnTargetModelId): string {
  return ON_TARGET_MODELS.find(m => m.id === id)?.name ?? 'No model'
}
