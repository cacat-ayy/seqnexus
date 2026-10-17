/**
 * Two oligos annealed into a part, instead of a piece cut out of a plasmid.
 *
 * Short inserts are not cut from anything: they are ordered as a pair of
 * complementary oligos, annealed, and ligated into a cut vector. A CRISPR
 * guide is the standard case. The pair is written the way it is ordered,
 *
 *   top     5' CACCG GTCAGCATGCATCGAGTTAC    3'
 *   bottom  5' AAAC GTAACTCGATGCATGCTGAC C   3'
 *
 * and the overhangs are not stated anywhere: they follow from where the two
 * strands pair, which is what makes this worth computing rather than asking
 * for. The pair above leaves CACCG and AAAC as 5' overhangs, which is what
 * the BsmBI-cut vector offers.
 *
 * The oligos are aligned by sliding one along the other and taking the offset
 * that pairs the most bases, so a pair that anneals off-register (an oligo
 * ordered a base short) is still read the way it would behave in the tube,
 * with the mismatch reported rather than hidden.
 *
 * Synthetic oligos are supplied without a 5' phosphate, so by default both
 * ends are unphosphorylated: a duplex going into a vector is sealed by the
 * vector's phosphates, and two duplexes cannot ligate to each other at all.
 * That is the behaviour at the bench, and it is why a design that
 * dephosphorylates the vector as well gives nothing.
 */

import { complementBase, reverseComplement } from '../models/complement'
import type { End } from './ends'
import { bluntEnd } from './ends'
import type { Fragment } from './fragment'

/** The pair of oligos a duplex part is made of. */
export interface OligoDuplex {
  /** One strand, 5'→3'. */
  top: string
  /** The other strand, 5'→3', as it would be ordered. */
  bottom: string
  /** Whether the oligos were ordered with a 5' phosphate. */
  phosphate?: boolean
}

export interface AnnealedDuplex {
  /** The top strand, 5'→3': what a fragment carries as `top`. */
  top: string
  left: End
  right: End
  /** How many base pairs the two strands actually pair over. */
  core: number
  /** Positions in the overlap where the two strands do not pair. */
  mismatches: number
  /** What is wrong with the pair, in the words of someone at the bench. */
  warnings: string[]
}

/**
 * Shortest run of paired bases that counts as annealed at all, for oligos
 * long enough to ask it of: a pair that only lines up over six bases has
 * found a chance palindrome, not a duplex (the standing mistake of writing
 * the second oligo in the same sense as the first lines up GCATGC and
 * nothing more). A short adapter is held to half its length instead, since a
 * ten-mer pair cannot offer eight paired bases and two overhangs.
 */
const MIN_CORE = 8

/** How much of a run the shorter of the two oligos has to pair over. */
function minimumRun(top: string, bottom: string): number {
  return Math.min(MIN_CORE, Math.floor(Math.min(top.length, bottom.length) / 2))
}

const clean = (s: string) => s.replace(/\s/g, '').toUpperCase()

/**
 * Where the two oligos pair, as an offset of the bottom strand's reverse
 * complement along the top strand.
 *
 * Alignments are judged by their longest unbroken run of paired bases, not
 * by how many bases pair in total. That is what holds a duplex together: a
 * run of twenty is a duplex, while twenty matches scattered through forty
 * bases is two oligos that have nothing to do with each other. Ties go to
 * more paired bases, then a longer overlap, then the most centred offset, so
 * a fully complementary pair reads as the blunt duplex it is.
 */
function bestOffset(
  top: string,
  rc: string,
): { offset: number; matches: number; overlap: number; run: number } {
  let best = { offset: 0, matches: -1, overlap: 0, run: -1 }
  for (let k = -(rc.length - 1); k <= top.length - 1; k++) {
    const from = Math.max(0, k)
    const to = Math.min(top.length, k + rc.length)
    if (to <= from) continue
    let matches = 0
    let run = 0
    let longest = 0
    for (let i = from; i < to; i++) {
      if (top[i] === rc[i - k]) {
        matches++
        run++
        if (run > longest) longest = run
      } else {
        run = 0
      }
    }
    const overlap = to - from
    const better =
      longest > best.run ||
      (longest === best.run && matches > best.matches) ||
      (longest === best.run && matches === best.matches && overlap > best.overlap) ||
      (longest === best.run && matches === best.matches && overlap === best.overlap &&
        Math.abs(k) < Math.abs(best.offset))
    if (better) best = { offset: k, matches, overlap, run: longest }
  }
  return best
}

/**
 * Anneal a pair of oligos: the duplex they form, with the ends it offers.
 *
 * The ends follow the convention of ./ends: a span is written 5'→3' along
 * the strand that protrudes, so an overhang on the bottom strand is read
 * along the bottom strand and anneals to a cut vector by the same test as
 * any other end.
 */
export function annealOligos(duplex: OligoDuplex): AnnealedDuplex {
  const top = clean(duplex.top)
  const bottom = clean(duplex.bottom)
  const phosphate = duplex.phosphate ?? false
  const warnings: string[] = []

  if (top.length === 0 || bottom.length === 0) {
    return {
      top,
      left: bluntEnd(phosphate),
      right: bluntEnd(phosphate),
      core: 0,
      mismatches: 0,
      warnings: ['A duplex needs both oligos: give the top and the bottom strand.'],
    }
  }

  const rc = reverseComplement(bottom)
  const { offset, matches, overlap, run } = bestOffset(top, rc)
  const mismatches = overlap - matches

  // Left end. Positive offset means the top strand reaches further left, so
  // it is the one protruding, with its 5' terminus at this end.
  const left: End =
    offset > 0
      ? { span: top.slice(0, offset), kind: 'five_prime', phosphate }
      : offset < 0
        // The bottom strand reaches further left, and its 3' terminus is the
        // one at this end, so the protruding bases are its last ones.
        ? { span: bottom.slice(bottom.length + offset), kind: 'three_prime', phosphate }
        : bluntEnd(phosphate)

  // Right end, the same argument the other way round: the top strand's 3'
  // terminus is at the right, the bottom strand's 5' terminus is.
  const rcEnd = offset + rc.length
  const right: End =
    top.length > rcEnd
      ? { span: top.slice(rcEnd), kind: 'three_prime', phosphate }
      : rcEnd > top.length
        ? { span: bottom.slice(0, rcEnd - top.length), kind: 'five_prime', phosphate }
        : bluntEnd(phosphate)

  const shorter = Math.min(top.length, bottom.length)
  if (run < minimumRun(top, bottom)) {
    warnings.push(
      'These two oligos do not anneal: there is no stretch long enough where they pair. ' +
      'Both strands are written 5’→3’, so the second one reads backwards against the first: ' +
      'it should be the reverse complement of the stretch it pairs with.',
    )
  } else {
    if (run < shorter / 2) {
      warnings.push(
        `The oligos pair over only ${run} bases, so most of each strand is left single-stranded. ` +
        'A part going into a ligation should be double-stranded but for its overhangs.',
      )
    }
    if (mismatches > 0) {
      warnings.push(
        `The oligos pair over ${overlap} bases with ${mismatches} mismatch${mismatches === 1 ? '' : 'es'}, ` +
        'so the duplex is not fully paired. Check that each strand is the other’s reverse complement.',
      )
    }
  }

  return { top, left, right, core: matches, mismatches, warnings }
}

/**
 * The pair written out as two lines, the way it would be drawn on a bench
 * sheet: the top strand 5'→3' and the bottom strand beneath it running the
 * other way, each indented so that paired bases sit above each other and
 * the overhangs stick out at the ends.
 */
export function duplexLines(duplex: OligoDuplex): { top: string; bottom: string } {
  const { top, left } = annealOligos(duplex)
  // The bottom strand read in the top strand's direction: base for base, the
  // partner each position pairs with.
  const alongTop = reverseComplement(clean(duplex.bottom))
  // Whichever strand reaches further left is the one flush with the margin.
  const topIndent = left.kind === 'three_prime' ? left.span.length : 0
  const bottomIndent = left.kind === 'five_prime' ? left.span.length : 0
  return {
    top: ' '.repeat(topIndent) + top,
    // Drawn 3'→5', so it reads as the complement of the strand above rather
    // than backwards against it.
    bottom: ' '.repeat(bottomIndent) + [...alongTop].map(complementBase).join(''),
  }
}

/** The ends of an annealed pair, for showing what it offers before it is used. */
export function duplexEnds(duplex: OligoDuplex): { left: End; right: End } {
  const { left, right } = annealOligos(duplex)
  return { left, right }
}

/**
 * The annealed pair as a fragment, ready to go into the pot beside the pieces
 * of a digest. It is named `id:0` like a digest's first piece, so everything
 * that tracks a piece back to its part keeps working.
 */
export function duplexFragment(
  duplex: OligoDuplex,
  part: { id: string; name: string },
): { fragment: Fragment; warnings: string[] } {
  const annealed = annealOligos(duplex)
  return {
    fragment: {
      id: `${part.id}:0`,
      name: part.name,
      topology: 'linear',
      top: annealed.top,
      left: annealed.left,
      right: annealed.right,
      annotations: [],
      source: { name: part.name, id: part.id, start: 0, end: annealed.top.length, circular: false },
      reversed: false,
    },
    warnings: annealed.warnings.map(w => `${part.name}: ${w}`),
  }
}
