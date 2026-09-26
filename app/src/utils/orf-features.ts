/**
 * Turning found ORFs into real features.
 *
 * The ORF overlay is an analysis result, not part of the document — but an ORF
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
import type { AnnotationData } from '../models/Annotation'
import { isCoveredByAnnotation, type Interval } from './auto-annotations'

/** Ids of the synthetic annotations the views draw ORFs as. */
export const ORF_ID_PREFIX = '_orf_'

/**
 * Deliberately tight.
 *
 * A converted ORF matches its own feature exactly, so any threshold excludes
 * it. Keeping the bar high means a merely overlapping CDS — a shorter isoform,
 * a neighbouring gene — does not quietly swallow an ORF the user could add.
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

/** The label the overlay draws, reused verbatim by the feature it becomes. */
export function orfName(orf: ORFResult): string {
  const strandLabel = orf.strand === 1 ? '+' : '−'
  return `ORF ${strandLabel}${orf.frame + 1} (${orf.codons} aa)`
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

/** One ORF as a feature: the label and colour it already had on screen. */
export function orfToAnnotationData(orf: ORFResult): AnnotationData {
  return {
    id: `orf_${idRun}_${++idCounter}`,
    name: orfName(orf),
    type: ORF_FEATURE_TYPE,
    start: orf.start,
    end: orf.end,
    strand: orf.strand,
    color: orfColor(orf.strand, orf.frame),
  }
}
