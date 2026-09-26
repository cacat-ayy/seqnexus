/**
 * Auto-annotation proposals: the layer between a scan result and a real feature.
 *
 * A scan produces `AnnotationMatch`es. Those are drawn on the sequence as
 * provisional features the user can pick, and only become part of the document
 * when the user converts them. Everything here is a pure function of a match
 * list plus the document's existing annotations, which is what lets the same
 * rules drive the canvas, the Annotate modal and the store action without the
 * three drifting apart.
 */

import { Annotation } from '../models/Annotation'
import type { AnnotationMatch } from '../workers/annotate-list'

/**
 * Proposal ids are prefixed like ORF and primer overlays (`_orf_`, `_primer_`)
 * so the rest of the app keeps treating them as "not a real feature".
 */
export const AUTO_ID_PREFIX = '_auto_'

/**
 * Identity of a match, stable across re-scans.
 *
 * A re-scan at the same settings produces the same key for the same hit, so a
 * pick survives the scan that a threshold change triggers.
 */
export function matchKey(m: AnnotationMatch): string {
  return `${m.refName}:${m.start}:${m.end}:${m.strand}`
}

export function autoIdFor(m: AnnotationMatch): string {
  return AUTO_ID_PREFIX + matchKey(m)
}

/** The key back out of a proposal's annotation id, or null if it isn't one. */
export function keyFromAutoId(id: string): string | null {
  return id.startsWith(AUTO_ID_PREFIX) ? id.slice(AUTO_ID_PREFIX.length) : null
}

export function isAutoAnnotationId(id: string): boolean {
  return id.startsWith(AUTO_ID_PREFIX)
}

/** Length of an annotation, counting an origin-spanning one as wrapping. */
function annLength(start: number, end: number): number {
  return Math.max(0, end - start)
}

/** The shape both auto-annotation matches and ORFs reduce to for coverage. */
export interface Interval {
  type: string
  strand: number
  start: number
  end: number
}

/**
 * Is this candidate already covered by a feature the document has?
 *
 * Reciprocal overlap: both the candidate and the feature must be covered by at
 * least `overlapThreshold` percent of the shared region. One-sided overlap
 * would suppress a whole gene because a 20 bp primer site sits inside it.
 *
 * This is the rule that keeps a conversion converted — something that was just
 * turned into a feature covers itself 100% — while leaving genuinely new
 * candidates (from a lower similarity threshold, a newly enabled database, or
 * looser ORF settings) free to appear, since nothing in the document covers
 * those. Shared with the ORF overlay, which needs the same guarantee.
 */
export function isCoveredByAnnotation(
  candidate: Interval,
  annotations: readonly Interval[],
  overlapThreshold: number,
): boolean {
  const cLen = annLength(candidate.start, candidate.end)
  for (const ann of annotations) {
    if (ann.type !== candidate.type) continue
    if (ann.strand !== candidate.strand) continue
    const overlapLen = Math.max(0, Math.min(candidate.end, ann.end) - Math.max(candidate.start, ann.start))
    if (overlapLen === 0) continue
    const annLen = annLength(ann.start, ann.end)
    const candidateOverlap = cLen > 0 ? (overlapLen / cLen) * 100 : 0
    const annOverlap = annLen > 0 ? (overlapLen / annLen) * 100 : 0
    if (candidateOverlap >= overlapThreshold && annOverlap >= overlapThreshold) return true
  }
  return false
}

/** Is this match already covered by a feature the document has? */
export function isAlreadyAnnotated(
  m: AnnotationMatch,
  annotations: readonly Interval[],
  overlapThreshold: number,
): boolean {
  return isCoveredByAnnotation(
    { type: m.refType, strand: m.strand, start: m.start, end: m.end },
    annotations,
    overlapThreshold,
  )
}

/** The matches worth proposing: everything the document does not already have. */
export function proposalsFrom(
  matches: readonly AnnotationMatch[],
  annotations: readonly { type: string; strand: number; start: number; end: number }[],
  overlapThreshold: number,
): AnnotationMatch[] {
  if (matches.length === 0) return []
  if (annotations.length === 0) return [...matches]
  return matches.filter(m => !isAlreadyAnnotated(m, annotations, overlapThreshold))
}

/** Display name for a proposal, e.g. `AmpR (98%)`. */
export function proposalName(m: AnnotationMatch): string {
  return `${m.refName} (${m.similarity}%)`
}

/**
 * Proposals as `Annotation`s, for the views.
 *
 * Same trick the ORF and primer overlays use: hand the canvas ordinary
 * annotations with reserved ids, and drawing, hit-testing, hover and the
 * feature tooltip all work with no special cases.
 */
export function proposalAnnotations(proposals: readonly AnnotationMatch[]): Annotation[] {
  return proposals.map(m => new Annotation({
    id: autoIdFor(m),
    name: proposalName(m),
    type: m.refType,
    start: m.start,
    end: m.end,
    strand: m.strand,
    // Undefined lets Annotation fall back to its per-type colour, which is how
    // an imported database with no colour column still looks native.
    color: m.color,
  }))
}
