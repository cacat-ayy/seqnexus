/**
 * Deriving bases and protein from an annotation.
 *
 * This logic used to exist in three places — the hover tooltip, the linear
 * view's context menu and the plasmid map's context menu — each with its own
 * copy of the origin-spanning special case. They have to agree: the context
 * menu shows the translated sequence and offers to copy it, so display and
 * clipboard reading differently is a bug the user can see.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import { reverseComplement } from '../models/complement'
import { translate } from '../utils/codon'

/**
 * Feature types treated as protein-coding.
 *
 * `gene` is included because plenty of records annotate the coding region as
 * `gene` with no separate CDS, and a user right-clicking it still expects a
 * translation.
 */
export const CODING_TYPES = new Set(['CDS', 'gene', 'ORF'])

export function isCodingAnnotation(ann: Annotation): boolean {
  return CODING_TYPES.has(ann.type) || ann.id.startsWith('_orf_')
}

/**
 * The annotation's bases in genomic orientation (always 5'→3' on the forward
 * strand, regardless of which strand the feature is on).
 *
 * `start > end` means the feature wraps the origin. That is only meaningful on
 * a circular sequence, but it is treated as a wrap whenever it occurs: a
 * malformed linear feature reading as empty is worse than reading as wrapped,
 * and this matches what the tooltip has always displayed.
 */
export function annotationBases(ann: Annotation, sequence: Sequence): string {
  if (sequence.length === 0) return ''
  if (ann.start > ann.end) {
    return sequence.basesIn(ann.start, sequence.length) + sequence.basesIn(0, ann.end)
  }
  return sequence.basesIn(ann.start, ann.end)
}

/**
 * GenBank `/codon_start` is 1-based: 2 means "skip one base before the first
 * codon". Anything absent or unparseable means no offset.
 */
function codonStartOffset(ann: Annotation): number {
  const raw = ann.qualifiers?.codon_start?.[0]
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return n === 2 || n === 3 ? n - 1 : 0
}

/**
 * The bases actually fed to the ribosome: reverse-complemented for features on
 * the minus strand, then offset by `/codon_start` so the reading frame is the
 * one the source record declared.
 */
export function annotationCodingBases(ann: Annotation, sequence: Sequence): string {
  // A spliced feature is read through its exons only, never its introns.
  // (Copying a feature's bases still gives the whole span.)
  const bases = ann.segments
    ? ann.segments.map(([s, e]) => sequence.basesIn(s, e)).join('')
    : annotationBases(ann, sequence)
  const oriented = ann.strand === -1 ? reverseComplement(bases) : bases
  return oriented.slice(codonStartOffset(ann))
}

/** Translated protein for a coding annotation. Trailing partial codons are dropped. */
export function annotationProtein(ann: Annotation, sequence: Sequence): string {
  return translate(annotationCodingBases(ann, sequence))
}

/**
 * Whether a translation is worth showing or offering to copy: the feature must
 * be a coding type and long enough to yield at least one codon once the
 * reading frame offset is applied.
 */
export function canTranslateAnnotation(ann: Annotation, sequence: Sequence): boolean {
  if (!isCodingAnnotation(ann)) return false
  return annotationCodingBases(ann, sequence).length >= 3
}

const START_CODONS = new Set(['ATG', 'GTG', 'TTG'])

export interface TranslationIssues {
  /** Stop codons before the last codon. */
  internalStops: number
  /** Bases left over after the last whole codon (0 when in frame). */
  leftover: number
  /** The first codon, when it is not a start codon (ATG, GTG, TTG). */
  badStart: string | null
}

/**
 * What looks wrong with a CDS read in its declared frame: the signs of a
 * feature drawn on the wrong bases or in the wrong frame. Null for anything
 * that is not a CDS (a `gene` may include UTRs; an ORF is right by
 * construction) and for a CDS with nothing to report. The start codon is
 * only checked when `/codon_start` is 1, since a feature that starts
 * mid-codon is partial by declaration.
 */
export function translationIssues(ann: Annotation, sequence: Sequence): TranslationIssues | null {
  if (ann.type !== 'CDS' || ann.id.startsWith('_orf_')) return null
  const coding = annotationCodingBases(ann, sequence).toUpperCase()
  if (coding.length < 3) return null
  const protein = translate(coding)
  const internalStops = [...protein.slice(0, -1)].filter(aa => aa === '*').length
  const leftover = coding.length % 3
  const first = coding.slice(0, 3)
  const badStart = codonStartOffset(ann) === 0 && !START_CODONS.has(first) ? first : null
  if (internalStops === 0 && leftover === 0 && !badStart) return null
  return { internalStops, leftover, badStart }
}

/**
 * A long string shortened to its two ends, since the end of a feature
 * (where a stop codon or a tag sits) matters as much as its start.
 */
export function headTail(s: string, max: number): { head: string; tail: string } | null {
  if (s.length <= max) return null
  const keep = Math.floor((max - 1) / 2)
  return { head: s.slice(0, keep), tail: s.slice(s.length - keep) }
}

/** The span of a feature in bases, allowing for one that wraps the origin. */
export function annotationLength(ann: Annotation, seqLen: number): number {
  return ann.start > ann.end ? seqLen - ann.start + ann.end : ann.end - ann.start
}
