/**
 * The two ends of a DNA fragment, and when two of them anneal.
 *
 * A cut leaves a single-stranded protrusion on one strand. Which strand it is
 * decides the end's kind: `five_prime` when the protruding strand's 5' end is
 * at this end of the molecule, `three_prime` when its 3' end is.
 *
 * An end's `span` is always written 5'→3' **along the strand that protrudes**.
 * That is the only convention under which an end reads the same no matter
 * which way round you hold the molecule, so flipping a fragment leaves both
 * ends untouched (see `flip` in ./fragment). It also makes annealing the
 * ordinary base-pairing test: two ends meet when one's span is the reverse
 * complement of the other's.
 *
 * The convention matters. Writing both ends of a cut as the bases of the top
 * strand instead (which is tempting, since that is where they come from)
 * makes annealing an equality test, and mixing the two rules silently
 * restricts ligation to palindromic overhangs.
 */

import { reverseComplement } from '../models/complement'

export type EndKind = 'blunt' | 'five_prime' | 'three_prime'

export interface End {
  /**
   * The protruding bases, 5'→3' on the strand that protrudes.
   * Empty for a blunt end.
   */
  span: string
  kind: EndKind
  /**
   * Whether the 5' terminus at this end carries a phosphate. Exactly one of
   * the two strands ends 5' here, so one flag is enough. Enzymes leave a
   * phosphate; a phosphatase takes it off; a synthetic oligo usually lacks it.
   */
  phosphate: boolean
  /** The enzyme that made this end, when one did. */
  enzyme?: string
}

/** A blunt end, phosphorylated unless told otherwise. */
export function bluntEnd(phosphate = true): End {
  return { span: '', kind: 'blunt', phosphate }
}

const UNAMBIGUOUS = /^[ACGT]*$/

/**
 * Whether two ends can base-pair with each other.
 *
 * Blunt meets blunt. A protrusion meets a protrusion of the same kind whose
 * span is its reverse complement: at a junction the two protruding strands
 * come from opposite strands of the product, so they read as complements.
 *
 * An ambiguous base (N, or any IUPAC code) in a span means we cannot say the
 * ends pair, so they do not. Only a sequence with ambiguity codes in it can
 * produce one.
 */
export function endsAnneal(a: End, b: End): boolean {
  if (a.kind === 'blunt' || b.kind === 'blunt') {
    return a.kind === 'blunt' && b.kind === 'blunt'
  }
  if (a.kind !== b.kind) return false
  if (a.span.length !== b.span.length || a.span.length === 0) return false
  const x = a.span.toUpperCase()
  const y = b.span.toUpperCase()
  if (!UNAMBIGUOUS.test(x) || !UNAMBIGUOUS.test(y)) return false
  return x === reverseComplement(y)
}

/**
 * How many of a junction's two nicks ligase can seal. Each side supplies the
 * phosphate for one of them, so a junction with neither phosphate does not
 * hold together at all, and one with a single phosphate leaves a nicked
 * product, which still transforms, since the cell repairs it.
 */
export function sealedNicks(a: End, b: End): 0 | 1 | 2 {
  return ((a.phosphate ? 1 : 0) + (b.phosphate ? 1 : 0)) as 0 | 1 | 2
}

/** The same end seen from the other strand: what it would pair with. */
export function complementaryEnd(end: End): End {
  if (end.kind === 'blunt') return { ...end }
  return { ...end, span: reverseComplement(end.span.toUpperCase()) }
}

/** `5'-GATC`, `3'-TGCA`, or `blunt`: how an end reads in the UI. */
export function endLabel(end: End): string {
  if (end.kind === 'blunt') return 'blunt'
  return `${end.kind === 'five_prime' ? "5'" : "3'"}-${end.span.toUpperCase()}`
}

/** A stable key for grouping ends that anneal with the same partners. */
export function endKey(end: End): string {
  return end.kind === 'blunt' ? 'blunt' : `${end.kind}:${end.span.toUpperCase()}`
}

/**
 * The end a cut leaves on the piece to the **left** of it, and the one it
 * leaves on the piece to the **right**, from the cut's two strand positions.
 *
 * `fwdCut` is where the top strand breaks and `revCut` where the bottom one
 * does, both as top-strand coordinates. `fwdCut < revCut` leaves the top
 * strand protruding on the right piece (a 5' protrusion on both pieces);
 * `fwdCut > revCut` leaves it protruding on the left piece (a 3' protrusion).
 *
 * `bases` need only cover the span between the two cuts; a circular molecule
 * passes `wrap` so a cut that straddles the origin reads the short way round.
 */
export function cutEnds(
  bases: string,
  fwdCut: number,
  revCut: number,
  enzyme?: string,
  wrap = false,
): { left: End; right: End } {
  if (fwdCut === revCut) {
    return {
      left: { span: '', kind: 'blunt', phosphate: true, ...(enzyme ? { enzyme } : {}) },
      right: { span: '', kind: 'blunt', phosphate: true, ...(enzyme ? { enzyme } : {}) },
    }
  }

  const len = bases.length
  const read = (from: number, n: number): string => {
    if (!wrap) return bases.slice(from, from + n)
    let out = ''
    for (let i = from; i < from + n; i++) out += bases[((i % len) + len) % len]
    return out
  }

  // On a circle either cut may be the one that wrapped, so take the short way
  // round: an overhang is a few bases, never half the plasmid.
  let delta = revCut - fwdCut
  if (wrap) {
    delta = ((delta % len) + len) % len
    if (delta > len / 2) delta -= len
  }

  const tag = enzyme ? { enzyme } : {}
  if (delta > 0) {
    // Top strand protrudes rightwards from fwdCut: a 5' protrusion. The right
    // piece's top strand carries it; the left piece's bottom strand does, and
    // reads as its complement.
    const top = read(fwdCut, delta)
    return {
      left: { span: reverseComplement(top.toUpperCase()), kind: 'five_prime', phosphate: true, ...tag },
      right: { span: top, kind: 'five_prime', phosphate: true, ...tag },
    }
  }
  // Bottom strand breaks first: the top strand protrudes leftwards, so the
  // left piece ends 3' on the top strand and the right piece on the bottom.
  const top = read(revCut, -delta)
  return {
    left: { span: top, kind: 'three_prime', phosphate: true, ...tag },
    right: { span: reverseComplement(top.toUpperCase()), kind: 'three_prime', phosphate: true, ...tag },
  }
}
