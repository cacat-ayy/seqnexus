/**
 * Turning found ORFs into real features.
 *
 * The ORF overlay is an analysis result, not part of the document, but an ORF
 * a user recognises as a gene is exactly the thing they then want annotated.
 * This mirrors the auto-annotation flow: pick ORFs on the canvas, convert the
 * picked ones in a single undoable step.
 *
 * Unlike auto-annotation suggestions, ORFs are *not* hidden once something
 * covers them. The overlay answers "where are the open reading frames", and
 * the answer does not change because one of them is now annotated. What the
 * coverage rule governs here is only what a conversion would add, so pressing
 * Add twice cannot produce two copies of the same CDS.
 */

import type { ORFResult } from '../workers/orf-finder'
import { orfColor } from '../workers/orf-finder'
import { orfAminoAcids } from '../orfs/finder'
import { DEFAULT_GENETIC_CODE_ID, geneticCode } from '../codon/genetic-codes'
import type { Sequence } from '../models/Sequence'
import { reverseComplement } from '../models/complement'
import type { AnnotationData } from '../models/Annotation'
import { isCoveredByAnnotation, type Interval } from './auto-annotations'

/** Ids of the synthetic annotations the views draw ORFs as. */
export const ORF_ID_PREFIX = '_orf_'

/**
 * Deliberately tight.
 *
 * A converted ORF matches its own feature exactly, so any threshold excludes
 * it. Keeping the bar high means a merely overlapping CDS (a shorter isoform,
 * a neighbouring gene) does not quietly swallow an ORF the user could add.
 */
export const ORF_COVERAGE_THRESHOLD = 90

/** Features an ORF conversion creates. Its own type, so it reads as a CDS. */
const ORF_FEATURE_TYPE = 'CDS'

/**
 * Identity of an ORF, stable across re-scans.
 *
 * Position and frame rather than the index in the result list: re-running the
 * finder with different settings reorders that list, and a pick has to survive
 * the scan a settings change triggers.
 */
export function orfKey(orf: ORFResult): string {
  return `${orf.strand}:${orf.frame}:${orf.start}:${orf.end}`
}

export function orfIdFor(orf: ORFResult): string {
  return ORF_ID_PREFIX + orfKey(orf)
}

/** The key back out of an ORF's annotation id, or null if it isn't one. */
export function keyFromOrfId(id: string): string | null {
  return id.startsWith(ORF_ID_PREFIX) ? id.slice(ORF_ID_PREFIX.length) : null
}

export function isOrfId(id: string): boolean {
  return id.startsWith(ORF_ID_PREFIX)
}

/**
 * The label the overlay draws, reused verbatim by the feature it becomes.
 * It counts residues: the stop codon encodes none.
 */
export function orfName(orf: ORFResult): string {
  const partial = orf.partialStart || orf.partialEnd ? ', partial' : ''
  return `ORF ${orfFrameLabel(orf)} (${orfAminoAcids(orf)} aa${partial})`
}

function orfInterval(orf: ORFResult): Interval {
  return { type: ORF_FEATURE_TYPE, strand: orf.strand, start: orf.start, end: orf.end }
}

/** Is there already a CDS on this exact reading frame stretch? */
export function isOrfAnnotated(orf: ORFResult, annotations: readonly Interval[]): boolean {
  return isCoveredByAnnotation(orfInterval(orf), annotations, ORF_COVERAGE_THRESHOLD)
}

/** The ORFs a conversion would actually add. */
export function convertibleOrfs(
  orfs: readonly ORFResult[],
  annotations: readonly Interval[],
): ORFResult[] {
  if (orfs.length === 0) return []
  if (annotations.length === 0) return [...orfs]
  return orfs.filter(orf => !isOrfAnnotated(orf, annotations))
}

// Session-unique suffix: a plain counter restarts at 1 next session and would
// collide with the ids a restored document already carries.
const idRun = Date.now().toString(36)
let idCounter = 0

/**
 * An ORF's feature fields, all but its id: the label and colour it has on
 * screen, and, when it was found with a code other than the standard one,
 * that code in /transl_table. Without it the feature would be read with the
 * standard code: a mitochondrial ORF would show a stop at every TGA.
 */
function orfData(orf: ORFResult, geneticCodeId: number): Omit<AnnotationData, 'id'> {
  return {
    name: orfName(orf),
    type: ORF_FEATURE_TYPE,
    start: orf.start,
    end: orf.end,
    strand: orf.strand,
    color: orfColor(orf.strand, orf.frame),
    ...(geneticCodeId !== DEFAULT_GENETIC_CODE_ID ? { qualifiers: { transl_table: [String(geneticCodeId)] } } : {}),
  }
}

/** One ORF as a feature of the document. */
export function orfToAnnotationData(orf: ORFResult, geneticCodeId: number = DEFAULT_GENETIC_CODE_ID): AnnotationData {
  return { id: `orf_${idRun}_${++idCounter}`, ...orfData(orf, geneticCodeId) }
}

/**
 * An ORF as the overlay draws it, with an id that carries its identity so a
 * pick survives a re-scan, and its code, so its translation (the hover
 * card, Copy protein) is read the way the finder read it.
 */
export function orfOverlayData(orf: ORFResult, geneticCodeId: number = DEFAULT_GENETIC_CODE_ID): AnnotationData {
  // Open at its 5' end, it has no start codon to read as methionine. Scanned
  // in a range, that end can be anywhere, not only at the sequence's edge.
  return { id: orfIdFor(orf), ...orfData(orf, geneticCodeId), ...(orf.partialStart ? { truncated: true } : {}) }
}

/** `n` bases from `from`, reading on across the origin of a circle. */
function basesFrom(sequence: Sequence, from: number, n: number): string {
  const L = sequence.length
  const s = ((from % L) + L) % L
  return s + n <= L ? sequence.basesIn(s, s + n) : sequence.basesIn(s, L) + sequence.basesIn(0, s + n - L)
}

/**
 * An ORF's start and stop codons, each read on its own strand: null where it
 * has none (a partial ORF runs off the end of the sequence there).
 */
export function orfCodons(orf: ORFResult, sequence: Sequence): { start: string | null; stop: string | null } {
  if (sequence.length < 3) return { start: null, stop: null }
  const head = (pos: number) => basesFrom(sequence, pos, 3).toUpperCase()
  const forward = orf.strand === 1
  // The 5' codon of a plus-strand ORF is at its start; of a minus-strand one, at its end.
  const fivePrime = forward ? head(orf.start) : reverseComplement(head(orf.end - 3))
  const threePrime = forward ? head(orf.end - 3) : reverseComplement(head(orf.start))
  return { start: orf.partialStart ? null : fivePrime, stop: orf.partialEnd ? null : threePrime }
}

/**
 * The start codons a scan uses: the genetic code's own initiation codons
 * (NCBI's list for that table), or the ones chosen by hand.
 */
export function orfStartCodonsFor(fromCode: boolean, chosen: readonly string[], geneticCodeId: number): string[] {
  return fromCode ? [...geneticCode(geneticCodeId).starts] : [...chosen]
}

/** A frame as the finder and the translation rows write it: +1 to +3, −1 to −3. */
export function orfFrameLabel(orf: Pick<ORFResult, 'strand' | 'frame'>): string {
  return `${orf.strand === 1 ? '+' : '−'}${orf.frame + 1}`
}
