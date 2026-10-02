/**
 * Melting temperature for a selection readout.
 *
 * The quick figure the sequence view and status bar show beside a selected
 * range: the Wallace rule up to 14 bp, where nearest-neighbour parameters
 * have too few stacks to mean much, and nearest-neighbour above that. Past
 * oligo length a Tm is not a useful number for a selection, so none is given.
 */

import { calcTm } from '../primers/thermodynamics'

/** Shortest selection that gets a Tm. */
export const SELECTION_TM_MIN = 4
/** Longest selection that gets a Tm. */
export const SELECTION_TM_MAX = 200

/** Tm in °C, or null when the length is out of range or the bases can't be scored. */
export function selectionTm(bases: string): number | null {
  if (bases.length < SELECTION_TM_MIN || bases.length > SELECTION_TM_MAX) return null
  const upper = bases.toUpperCase()
  let tm: number
  if (upper.length <= 14) {
    let at = 0, gc = 0
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i]
      if (ch === 'A' || ch === 'T') at++
      else if (ch === 'G' || ch === 'C') gc++
    }
    tm = 2 * at + 4 * gc
  } else {
    tm = calcTm(upper)
  }
  return Number.isFinite(tm) ? tm : null
}
