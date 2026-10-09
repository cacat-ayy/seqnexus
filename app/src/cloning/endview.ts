/**
 * An end of a fragment drawn as its two strands, the way it is written on a
 * bench sheet: the top strand 5'→3' over the bottom strand 3'→5', aligned
 * base for base, with the single-stranded overhang sticking out of one of
 * them.
 *
 *   EcoRI, left end of the piece        HindIII, right end
 *     AATTCGCC...                         ...GGCA
 *         GCGG...                         ...CCGTTCGA
 *
 * Both lines of a view have the same length; a space is a base that strand
 * does not have.
 */

import { complementBase } from '../models/complement'
import { coreOf, type Fragment } from './fragment'

export interface EndView {
  top: string
  bottom: string
}

const complement = (s: string) => [...s].map(complementBase).join('')
const reverse = (s: string) => [...s].reverse().join('')
const blank = (n: number) => ' '.repeat(n)

/**
 * The `side` end of a linear fragment, with `n` double-stranded bases of
 * context next to the overhang. Undefined for a circle, which has no ends.
 */
export function endView(f: Fragment, side: 'left' | 'right', n = 4): EndView | undefined {
  const end = side === 'left' ? f.left : f.right
  if (f.topology === 'circular' || !end) return undefined
  const core = coreOf(f).toUpperCase()
  const span = end.span.toUpperCase()

  if (side === 'left') {
    const ds = core.slice(0, n)
    if (end.kind === 'five_prime') return { top: span + ds, bottom: blank(span.length) + complement(ds) }
    // The bottom strand protrudes; written 3'→5' it reads backwards.
    if (end.kind === 'three_prime') return { top: blank(span.length) + ds, bottom: reverse(span) + complement(ds) }
    return { top: ds, bottom: complement(ds) }
  }

  const ds = core.slice(Math.max(0, core.length - n))
  if (end.kind === 'three_prime') return { top: ds + span, bottom: complement(ds) + blank(span.length) }
  if (end.kind === 'five_prime') return { top: ds + blank(span.length), bottom: complement(ds) + reverse(span) }
  return { top: ds, bottom: complement(ds) }
}
