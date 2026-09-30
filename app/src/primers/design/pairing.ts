/**
 * Scoring two primers as a pair.
 *
 * Deliberately independent of how the two were found: the search uses it on
 * candidates, and the workbench uses it on whatever the user has picked or
 * edited by hand, so a pair reads the same whichever way it was made.
 */

import { nnParams } from '../thermodynamics'
import { reverseComplement } from '../scoring'
import type { PenaltyTerm } from '../scoring'
import type { PairEvaluation } from './types'

export interface PairOligo {
  sequence: string
  tm: number
  /** The primer's own penalty; 0 for a hand-made oligo that was never scored. */
  penalty: number
}

export interface PairContext {
  minProductSize: number
  maxProductSize: number
}

export function evaluatePair(
  fwd: PairOligo,
  rev: PairOligo,
  productSize: number,
  ctx: PairContext,
): PairEvaluation {
  const terms: PenaltyTerm[] = []
  const add = (label: string, value: number) => { if (value > 0) terms.push({ label, penalty: value }) }
  const warnings: string[] = []

  const tmDiff = Math.abs(fwd.tm - rev.tm)
  add('Tm mismatch', tmDiff * 1.0)
  if (tmDiff > 3) warnings.push(`Tms differ by ${tmDiff.toFixed(1)} °C: the primers may anneal unevenly`)

  const optProduct = (ctx.minProductSize + ctx.maxProductSize) / 2
  add('Product size off centre', Math.abs(productSize - optProduct) * 0.01)
  if (productSize < ctx.minProductSize || productSize > ctx.maxProductSize) {
    warnings.push(`Product ${productSize} bp is outside ${ctx.minProductSize}–${ctx.maxProductSize} bp`)
  }

  const crossDimer = crossDimerScore(fwd.sequence, rev.sequence)
  if (crossDimer.maxRun >= 6) add('Cross-dimer', 4.0)
  else if (crossDimer.maxRun >= 4) add('Cross-dimer', 2.0)
  if (crossDimer.dG < -9) add('Stable heterodimer', 4.0)
  else if (crossDimer.dG < -6) add('Stable heterodimer', 2.0)
  if (crossDimer.endRun >= 3) {
    add('3′ cross-dimer', 3.0)
    warnings.push(`The primers pair with each other at a 3′ end (${crossDimer.endRun} bp): primer-dimer risk`)
  }

  const pairPenalty = terms.reduce((s, t) => s + t.penalty, 0)
  return {
    productSize,
    tmDiff,
    crossDimer,
    terms,
    penalty: fwd.penalty + rev.penalty + pairPenalty,
    warnings,
  }
}

/**
 * Cross-dimer analysis between two primer sequences.
 *
 * Slides the reverse complement of primer B across primer A to find:
 * - maxRun: longest contiguous complementary stretch (any position)
 * - endRun: longest complementary stretch involving the 3' end of either primer
 * - dG: most stable (most negative) ΔG across all alignments with ≥3bp overlap
 */
export function crossDimerScore(
  seqA: string,
  seqB: string,
): { maxRun: number; endRun: number; dG: number } {
  const a = seqA.toUpperCase()
  const rcB = reverseComplement(seqB.toUpperCase())
  let maxRun = 0
  let endRun = 0
  let bestDG = 0 // least negative = least stable

  const runDG = (from: number, len: number) => {
    const { dH, dS } = nnParams(a.slice(from, from + len))
    return (dH - (273.15 + 37) * dS) / 1000
  }

  for (let offset = -(rcB.length - 1); offset < a.length; offset++) {
    let run = 0
    let bestRunThisOffset = 0
    let matchStart = -1

    for (let i = 0; i < a.length; i++) {
      const j = i - offset
      if (j < 0 || j >= rcB.length) {
        run = 0
        continue
      }
      if (a[i] === rcB[j]) {
        if (run === 0) matchStart = i
        run++
        if (run > bestRunThisOffset) bestRunThisOffset = run
      } else {
        if (run >= 3) bestDG = Math.min(bestDG, runDG(matchStart, run))
        run = 0
      }
    }
    if (run >= 3) bestDG = Math.min(bestDG, runDG(matchStart, run))

    if (bestRunThisOffset > maxRun) maxRun = bestRunThisOffset

    // 3' involvement: does a run touch the last base of a, or the first base
    // of rcB? rcB[0] is the complement of b's last base, i.e. b's 3' end.
    // (The old finder checked rcB's last base, which is b's 5' end, so a
    // dimer on the reverse primer's 3' end went unpenalised.)
    if (bestRunThisOffset >= 2) {
      const aEnd = a.length - 1
      const jForAEnd = aEnd - offset
      if (jForAEnd >= 0 && jForAEnd < rcB.length && a[aEnd] === rcB[jForAEnd]) {
        let eRun = 1
        for (let k = 1; k < bestRunThisOffset; k++) {
          const ai = aEnd - k
          const ji = ai - offset
          if (ai < 0 || ji < 0 || ji >= rcB.length || a[ai] !== rcB[ji]) break
          eRun++
        }
        endRun = Math.max(endRun, eRun)
      }
      const iForB3 = offset // column of rcB[0]
      if (iForB3 >= 0 && iForB3 < a.length && a[iForB3] === rcB[0]) {
        let eRun = 1
        for (let k = 1; k < bestRunThisOffset; k++) {
          const ai = iForB3 + k
          if (ai >= a.length || k >= rcB.length || a[ai] !== rcB[k]) break
          eRun++
        }
        endRun = Math.max(endRun, eRun)
      }
    }
  }

  return { maxRun, endRun, dG: bestDG }
}
