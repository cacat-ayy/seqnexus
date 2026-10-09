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
import type { AttSiteMatch } from './gateway-sites'

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
 * Whether two att sites can recombine as a pair: they must sit on the same
 * strand, or the cassette between them is inverted relative to its flanks and
 * the reaction gives nothing useful.
 */
export function sitesAgree(site1: AttSiteMatch, site2: AttSiteMatch): boolean {
  return site1.reverseStrand === site2.reverseStrand
}
