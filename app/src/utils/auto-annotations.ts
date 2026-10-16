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
import type { RejectedSuggestion } from '../models/Document'
import type { AnnotationMatch } from '../workers/annotate-list'

/**
 * Proposal ids are prefixed like ORF and primer overlays (`_orf_`, `_oligo_`)
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

/** The shape both auto-annotation matches and ORFs reduce to for coverage. */
export interface Interval {
  type: string
  strand: number
  start: number
  end: number
}

export interface CoverageOptions {
  /**
   * Length of the sequence, so a span across the origin (end before start)
   * is measured as the two pieces it is. Without it such a span covers
   * nothing and is covered by nothing.
   */
  seqLength?: number
  /**
   * Count only a feature of the same type on the same strand. The ORF
   * overlay wants this: a promoter does not make an ORF a CDS. Suggestions do
   * not: a curator's "protein_bind" lac operator, or an unoriented
   * "polyA_signal", is already the element the library calls "lacO" or "SV40
   * polyA", and proposing it again only duplicates it.
   */
  sameTypeAndStrand?: boolean
}

/** A span as the pieces it occupies: one, or two when it runs across the origin. */
function pieces(start: number, end: number, seqLength?: number): [number, number][] {
  if (end >= start) return [[start, end]]
  return seqLength ? [[start, seqLength], [0, end]] : []
}

function spanLength(p: [number, number][]): number {
  let n = 0
  for (const [s, e] of p) n += e - s
  return n
}

function sharedLength(a: [number, number][], b: [number, number][]): number {
  let n = 0
  for (const [s1, e1] of a) for (const [s2, e2] of b) n += Math.max(0, Math.min(e1, e2) - Math.max(s1, s2))
  return n
}

/**
 * Is this candidate already covered by a feature the document has?
 *
 * Reciprocal overlap: both the candidate and the feature must be covered by at
 * least `overlapThreshold` percent of the shared region. One-sided overlap
 * would suppress a whole gene because a 20 bp primer site sits inside it.
 *
 * This is the rule that keeps a conversion converted (something that was just
 * turned into a feature covers itself 100%) while leaving genuinely new
 * candidates (from a lower similarity threshold, a newly enabled database, or
 * looser ORF settings) free to appear, since nothing in the document covers
 * those. Shared with the ORF overlay, which needs the same guarantee.
 */
export function isCoveredByAnnotation(
  candidate: Interval,
  annotations: readonly Interval[],
  overlapThreshold: number,
  { seqLength, sameTypeAndStrand = true }: CoverageOptions = {},
): boolean {
  const cPieces = pieces(candidate.start, candidate.end, seqLength)
  const cLen = spanLength(cPieces)
  if (cLen === 0) return false
  for (const ann of annotations) {
    if (sameTypeAndStrand && (ann.type !== candidate.type || ann.strand !== candidate.strand)) continue
    const aPieces = pieces(ann.start, ann.end, seqLength)
    const overlapLen = sharedLength(cPieces, aPieces)
    if (overlapLen === 0) continue
    const annLen = spanLength(aPieces)
    const candidateOverlap = (overlapLen / cLen) * 100
    const annOverlap = annLen > 0 ? (overlapLen / annLen) * 100 : 0
    if (candidateOverlap >= overlapThreshold && annOverlap >= overlapThreshold) return true
  }
  return false
}

/**
 * Is this match already covered by a feature the document has? Any feature
 * on the same stretch counts, whatever its type or strand.
 */
export function isAlreadyAnnotated(
  m: AnnotationMatch,
  annotations: readonly Interval[],
  overlapThreshold: number,
  seqLength?: number,
): boolean {
  return isCoveredByAnnotation(
    { type: m.refType, strand: m.strand, start: m.start, end: m.end },
    annotations,
    overlapThreshold,
    { seqLength, sameTypeAndStrand: false },
  )
}

/** The matches worth proposing: everything the document does not already have. */
export function proposalsFrom(
  matches: readonly AnnotationMatch[],
  annotations: readonly { type: string; strand: number; start: number; end: number }[],
  overlapThreshold: number,
  seqLength?: number,
): AnnotationMatch[] {
  if (matches.length === 0) return []
  if (annotations.length === 0) return [...matches]
  return matches.filter(m => !isAlreadyAnnotated(m, annotations, overlapThreshold, seqLength))
}

/** Is this match of an element the user has said not to suggest here? */
export function isRejected(m: AnnotationMatch, rejected: readonly RejectedSuggestion[] | undefined): boolean {
  return !!rejected && rejected.some(r => r.name === m.refName && r.type === m.refType)
}

/**
 * How much of each other two suggestions must cover to be one locus: the
 * same stretch, proposed as several related elements (EGFP, ECFP, EYFP on
 * one gene; lac and lacUV5 on one promoter).
 */
export const LOCUS_OVERLAP = 75

/**
 * One place in the document and every element suggested for it.
 *
 * The scan groups versions of one element (the lacZ alphas of a dozen
 * vectors) and keeps the best; relatives with names of their own (EGFP and
 * ECFP, lac and lacUV5) are separate elements to it, so a plasmid with EGFP
 * got two dozen fluorescent proteins stacked on one gene. A locus offers
 * one, the best, with the rest behind it to choose from instead.
 */
export interface SuggestionLocus {
  /** What is offered here: the member the user picked, or else the best. */
  shown: AnnotationMatch
  /** Every suggestion at this locus, best first. */
  members: AnnotationMatch[]
}

function spanOf(m: AnnotationMatch, seqLength?: number): [number, number][] {
  return pieces(m.start, m.end, seqLength)
}

/**
 * Suggestions gathered into loci: the same feature type on stretches that
 * each cover LOCUS_OVERLAP percent of the other. Distinct elements that
 * overlap (a promoter inside a gene, a tag inside a fusion) do not cover
 * each other both ways and stay apart. Best first means most similar, then
 * longest, then by name, so the same scan always gives the same loci.
 */
export function suggestionLoci(
  proposals: readonly AnnotationMatch[],
  seqLength?: number,
  picks?: ReadonlySet<string>,
): SuggestionLocus[] {
  const len = (m: AnnotationMatch) => spanLength(spanOf(m, seqLength))
  const order = [...proposals].sort((a, b) =>
    b.similarity - a.similarity || len(b) - len(a) || a.refName.localeCompare(b.refName) || a.start - b.start)
  const loci: AnnotationMatch[][] = []
  for (const m of order) {
    const mp = spanOf(m, seqLength)
    const mLen = spanLength(mp)
    const home = loci.find(([lead]) => {
      if (lead.refType !== m.refType) return false
      const lp = spanOf(lead, seqLength)
      const shared = sharedLength(mp, lp)
      return mLen > 0 && shared / mLen * 100 >= LOCUS_OVERLAP && shared / spanLength(lp) * 100 >= LOCUS_OVERLAP
    })
    if (home) home.push(m)
    else loci.push([m])
  }
  return loci
    .map(members => ({ members, shown: members.find(x => picks?.has(matchKey(x))) ?? members[0] }))
    .sort((a, b) => a.shown.start - b.shown.start || a.shown.refName.localeCompare(b.shown.refName))
}

/**
 * What auto-annotation offers: the matches the document does not already
 * cover, less the elements the user rejected, one locus per stretch. The
 * dialog, the canvas, the map and the conversion all start from this, so
 * they agree on what "all" is.
 */
export function offeredSuggestions(
  matches: readonly AnnotationMatch[],
  annotations: readonly Interval[],
  overlapThreshold: number,
  seqLength: number | undefined,
  rejected: readonly RejectedSuggestion[] | undefined,
  picks?: ReadonlySet<string>,
): SuggestionLocus[] {
  const open = proposalsFrom(matches, annotations, overlapThreshold, seqLength)
    .filter(m => !isRejected(m, rejected))
  return suggestionLoci(open, seqLength, picks)
}

/**
 * Display name for a proposal, e.g. `AmpR (98%)`, or `AmpR (partial, 91%)`
 * for a copy with an end missing. It becomes the feature's name.
 */
export function proposalName(m: AnnotationMatch): string {
  return m.coverage !== undefined
    ? `${m.refName} (partial, ${m.similarity}%)`
    : `${m.refName} (${m.similarity}%)`
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
    // A copy with an end missing is drawn the way a feature cut short at a
    // cloning junction is.
    truncated: m.coverage !== undefined,
  }))
}
