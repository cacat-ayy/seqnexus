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
  const bases = annotationBases(ann, sequence)
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
