/**
 * Deriving bases and protein from an annotation.
 *
 * This logic used to exist in three places (the hover tooltip, the linear
 * view's context menu and the plasmid map's context menu), each with its own
 * copy of the origin-spanning special case. They have to agree: the context
 * menu shows the translated sequence and offers to copy it, so display and
 * clipboard reading differently is a bug the user can see.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import { reverseComplement } from '../models/complement'
import { translate } from '../utils/codon'
import { codeFromTranslTable, translateWith, type GeneticCode } from '../codon/genetic-codes'

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
export function codonStartOffset(ann: Annotation): number {
  const raw = ann.qualifiers?.codon_start?.[0]
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return n === 2 || n === 3 ? n - 1 : 0
}

/**
 * The genetic code a feature declares with `/transl_table` (2 for vertebrate
 * mitochondria, 11 for bacteria and so on), or null when it declares none.
 * A mitochondrial CDS read with the standard code shows false internal stops
 * wherever TGA codes for tryptophan.
 */
export function annotationCode(ann: Pick<Annotation, 'qualifiers'>): GeneticCode | null {
  return codeFromTranslTable(ann.qualifiers)
}

/**
 * The codons a CDS may start on: its code's initiators, or the common three
 * when it declares no code.
 */
export function initiatorCodons(ann: Pick<Annotation, 'qualifiers'>): ReadonlySet<string> {
  const code = annotationCode(ann)
  return code ? new Set(code.starts) : START_CODONS
}

/**
 * Whether `codon`, a CDS's first, is its initiator and so read as
 * methionine whichever start codon it is (GTG, TTG...), as NCBI translates
 * a complete CDS: the initiator tRNA carries methionine. Only from
 * /codon_start 1, and not for a CDS that begins at the 5' edge of a linear
 * sequence, which may be the 3' part of a longer gene (a GenBank `<` is not
 * kept on import, so that is the only sign of it). An ORF on the overlay
 * begins on one of the start codons the finder was asked for, by
 * construction, whichever code they belong to.
 */
export function isInitiatorCodon(ann: Annotation, sequence: Sequence, codon: string): boolean {
  if (ann.type !== 'CDS' || codonStartOffset(ann) !== 0) return false
  if (sequence.topology === 'linear' && (ann.strand === -1 ? ann.end === sequence.length : ann.start === 0)) return false
  return ann.id.startsWith('_orf_') || initiatorCodons(ann).has(codon.toUpperCase())
}

/** Coding bases translated with the feature's own code, the standard one by default. */
function translateAnnotationBases(ann: Annotation, coding: string): string {
  const code = annotationCode(ann)
  return code ? translateWith(code, coding) : translate(coding)
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
  const coding = annotationCodingBases(ann, sequence)
  const protein = translateAnnotationBases(ann, coding)
  return protein.length > 0 && isInitiatorCodon(ann, sequence, coding.slice(0, 3)) ? 'M' + protein.slice(1) : protein
}

/**
 * Whether a translation is worth showing or offering to copy: the feature must
 * be a coding type and long enough to yield at least one codon once the
 * reading frame offset is applied.
 */
export function canTranslateAnnotation(ann: Annotation, sequence: Sequence): boolean {
  // A protein's features are already residues.
  if (sequence.alphabet === 'protein') return false
  if (!isCodingAnnotation(ann)) return false
  return annotationCodingBases(ann, sequence).length >= 3
}

const START_CODONS = new Set(['ATG', 'GTG', 'TTG'])

export interface TranslationIssues {
  /** Stop codons before the last codon. */
  internalStops: number
  /** Bases left over after the last whole codon (0 when in frame). */
  leftover: number
  /** The first codon, when it is not a start codon (ATG, GTG, TTG, or those of the feature's /transl_table). */
  badStart: string | null
  /**
   * In frame, but the last codon is not a stop. A GenBank CDS includes its
   * stop codon, so this is a feature that ends early or one whose 3′ end is
   * partial. Not reported for a feature cut short at a cloning junction,
   * which is partial by construction.
   */
  missingStop: boolean
}

/**
 * What looks wrong with a CDS read in its declared frame: the signs of a
 * feature drawn on the wrong bases or in the wrong frame. Null for anything
 * that is not a CDS (a `gene` may include UTRs; an ORF is right by
 * construction) and for a CDS with nothing to report. The start codon is
 * only checked when `/codon_start` is 1, since a feature that starts
 * mid-codon is partial by declaration. The stop is only checked when the
 * feature is a whole number of codons: out of frame, the last codon read is
 * not the one the feature ends on.
 */
export function translationIssues(ann: Annotation, sequence: Sequence): TranslationIssues | null {
  if (ann.type !== 'CDS' || ann.id.startsWith('_orf_')) return null
  const coding = annotationCodingBases(ann, sequence).toUpperCase()
  if (coding.length < 3) return null
  const protein = translateAnnotationBases(ann, coding)
  const internalStops = [...protein.slice(0, -1)].filter(aa => aa === '*').length
  const leftover = coding.length % 3
  const first = coding.slice(0, 3)
  const starts = initiatorCodons(ann)
  const badStart = codonStartOffset(ann) === 0 && !starts.has(first) ? first : null
  const missingStop = leftover === 0 && !ann.truncated && !protein.endsWith('*')
  if (internalStops === 0 && leftover === 0 && !badStart && !missingStop) return null
  return { internalStops, leftover, badStart, missingStop }
}

export interface IssueMessage {
  text: string
  /** A warning says the feature is probably drawn wrong; a note may be intended. */
  severity: 'warning' | 'note'
}

/**
 * The issues in words, worst first, as every view shows them. A wrong start
 * or a missing stop is a note: a partial CDS or an alternative start is
 * common and correct.
 */
export function issueMessages(issues: TranslationIssues | null): IssueMessage[] {
  if (!issues) return []
  const out: IssueMessage[] = []
  if (issues.internalStops > 0) {
    const n = issues.internalStops
    out.push({ severity: 'warning', text: `${n} internal stop codon${n === 1 ? '' : 's'}: wrong frame or boundaries?` })
  }
  if (issues.leftover > 0) {
    const n = issues.leftover
    out.push({ severity: 'warning', text: `Not a whole number of codons (${n} base${n === 1 ? '' : 's'} left over)` })
  }
  if (issues.badStart) out.push({ severity: 'note', text: `Starts with ${issues.badStart}, not a start codon` })
  if (issues.missingStop) out.push({ severity: 'note', text: 'Does not end on a stop codon: partial, or ends early?' })
  return out
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
