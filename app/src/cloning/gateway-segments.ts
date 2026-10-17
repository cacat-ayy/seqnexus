/**
 * Reading the stretch between two att sites, and the stretch outside them.
 *
 * Two things the simple arithmetic of "lowest end to highest start" cannot do,
 * and that real plasmids need constantly:
 *
 * - **The sites may point the other way.** An entry clone's att sites are
 *   often cloned in reverse. The cassette then runs leftwards along the top
 *   strand, and what goes into the product is its reverse complement, with
 *   the features turned round to match.
 * - **A circular source has no first base.** The cassette, or the backbone
 *   around it, can run across the origin. Taking a plain slice loses it or
 *   returns nothing at all.
 *
 * Everything here works in the direction site 1 → site 2, which is the
 * direction the cassette reads in the product.
 */

import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { sliceAnnotations } from './cut'
import { withoutSegments } from './fragment'
import { SPACERS, SPACER_LENGTH, spacerOffsetOf, type AttSiteMatch } from './gateway-sites'

export interface Segment {
  bases: string
  /** Coordinates relative to `bases`. */
  annotations: AnnotationData[]
  /** True when the stretch was read on the bottom strand. */
  reversed: boolean
  /** Where it starts on the source's top strand. */
  start: number
  /** Where it ends on the source's top strand, exclusive. */
  end: number
}

/** Bases from `start` for `length`, wrapping the origin when circular. */
function read(bases: string, start: number, length: number, circular: boolean): string {
  const n = bases.length
  if (length <= 0) return ''
  if (!circular) return bases.slice(Math.max(0, start), Math.max(0, start) + length)
  let out = ''
  for (let i = start; i < start + length; i++) out += bases[((i % n) + n) % n]
  return out
}

/** How far it is from `from` to `to` going forward, around the origin if need be. */
function forwardDistance(from: number, to: number, length: number, circular: boolean): number {
  if (!circular) return to - from
  return ((to - from) % length + length) % length
}

function collect(
  doc: DocumentState,
  start: number,
  length: number,
  reversed: boolean,
): Segment {
  const bases = doc.sequence.bases
  const circular = doc.sequence.topology === 'circular'
  const n = bases.length
  const raw = read(bases, start, length, circular)
  const end = circular ? (start + length) % n : start + length
  const annotations = sliceAnnotations(
    doc.annotations.map(a => withoutSegments(a.toData())),
    ((start % n) + n) % n,
    ((end % n) + n) % n,
    n,
    circular,
  )

  if (!reversed) {
    return { bases: raw, annotations, reversed: false, start, end }
  }
  return {
    bases: reverseComplement(raw),
    annotations: annotations.map(ann => ({
      ...ann,
      start: raw.length - ann.end,
      end: raw.length - ann.start,
      strand: ann.strand === 1 ? -1 : ann.strand === -1 ? 1 : ann.strand,
    })),
    reversed: true,
    start,
    end,
  }
}

/**
 * The cassette between two att sites, read from site 1 to site 2.
 *
 * When the sites sit on the bottom strand the cassette is read backwards
 * along the top strand and returned reverse complemented, so it always comes
 * out in the orientation it will have in the product.
 */
export function betweenSites(
  doc: DocumentState,
  site1: AttSiteMatch,
  site2: AttSiteMatch,
): Segment {
  const bases = doc.sequence.bases
  const circular = doc.sequence.topology === 'circular'
  const reversed = site1.reverseStrand

  if (!reversed) {
    const start = site1.end
    const length = forwardDistance(start, site2.start, bases.length, circular)
    return collect(doc, start, length, false)
  }
  // Site 1 reads right-to-left, so the cassette lies to its left and site 2
  // is further left again.
  const start = site2.end
  const length = forwardDistance(start, site1.start, bases.length, circular)
  return collect(doc, start, length, true)
}

/**
 * The backbone: everything that is not between the two att sites, read so
 * that it runs from site 2 round to site 1, the direction it joins the
 * incoming cassette in.
 */
export function outsideSites(
  doc: DocumentState,
  site1: AttSiteMatch,
  site2: AttSiteMatch,
): Segment {
  const bases = doc.sequence.bases
  const circular = doc.sequence.topology === 'circular'
  const reversed = site1.reverseStrand

  if (!reversed) {
    const start = site2.end
    const length = forwardDistance(start, site1.start, bases.length, circular)
    return collect(doc, start, length, false)
  }
  const start = site1.end
  const length = forwardDistance(start, site2.start, bases.length, circular)
  return collect(doc, start, length, true)
}

/**
 * Where a site's two parents cross over: the stretch its spacer occupies on
 * the document's top strand, and which way the site reads.
 *
 * Recombination happens inside the spacer, so this is the one position a
 * product junction can be built around. Everything to one side of it comes
 * from one parent and everything to the other side from the other.
 */
export interface Crossover {
  /** Where the spacer starts on the top strand. */
  at: number
  /** How long it is: seven bases for every att site. */
  length: number
  /** True when the site reads on the bottom strand. */
  reverseStrand: boolean
  /** The spacer as the site itself reads it, 5'→3'. */
  spacer: string
}

export function crossoverOf(match: AttSiteMatch): Crossover {
  const offset = spacerOffsetOf(match.site)
  const spacer = SPACERS[match.site.number]
  // A site on the bottom strand reads leftwards along the top strand, so its
  // spacer is that far in from the core's right-hand edge.
  const at = match.reverseStrand
    ? match.end - offset - SPACER_LENGTH
    : match.start + offset
  return { at, length: SPACER_LENGTH, reverseStrand: match.reverseStrand, spacer }
}

/**
 * Whether two att sites are arranged so that a recombinase can act on the
 * stretch between them: they must point towards each other, which puts them
 * on opposite strands.
 *
 * That is how every working vector is built. An entry clone carries attL1
 * reading into the cassette and attL2 reading back out of it; a destination
 * vector carries attR1 and attR2 around its stuffer the same way. Two sites
 * pointing the same way would invert the stretch between them instead of
 * swapping it.
 */
export function facing(site1: AttSiteMatch, site2: AttSiteMatch): boolean {
  return site1.reverseStrand !== site2.reverseStrand
}

/**
 * The spacer as it reads in the product, when the product is being written in
 * the direction of `reference`.
 */
export function spacerAsRead(site: Crossover, reference: Crossover): string {
  return site.reverseStrand === reference.reverseStrand
    ? site.spacer
    : reverseComplement(site.spacer)
}

/**
 * The cassette between two crossovers, read from the first one outwards: the
 * bases strictly between the two spacers, in the direction site 1 points.
 */
export function readBetween(doc: DocumentState, from: Crossover, to: Crossover): Segment {
  const bases = doc.sequence.bases
  const circular = doc.sequence.topology === 'circular'
  if (!from.reverseStrand) {
    const start = from.at + from.length
    return collect(doc, start, forwardDistance(start, to.at, bases.length, circular), false)
  }
  const start = to.at + to.length
  return collect(doc, start, forwardDistance(start, from.at, bases.length, circular), true)
}

/**
 * Everything that is not between the two crossovers, read so that it runs
 * from site 2 round to site 1: the direction it meets an incoming cassette in.
 */
export function readOutside(doc: DocumentState, from: Crossover, to: Crossover): Segment {
  const bases = doc.sequence.bases
  const circular = doc.sequence.topology === 'circular'
  if (!from.reverseStrand) {
    const start = to.at + to.length
    return collect(doc, start, forwardDistance(start, from.at, bases.length, circular), false)
  }
  const start = from.at + from.length
  return collect(doc, start, forwardDistance(start, to.at, bases.length, circular), true)
}
