/**
 * Turning motif hits into real features, the way ORFs are turned into CDS
 * features: the overlay draws every hit, Ctrl-click picks, one conversion
 * adds the picked ones (or all of them) as a single undo step.
 *
 * Like ORFs, hits stay on the overlay once annotated: the overlay answers
 * "where does this pattern occur", and a feature on it does not change the
 * answer. What the coverage rule governs is what a conversion would add, so
 * pressing Add twice cannot produce two copies of the same site.
 */

import type { MotifHit } from '../protein/motifs'
import type { AnnotationData } from '../models/Annotation'

/** Ids of the synthetic annotations the views draw motif hits as. */
export const MOTIF_ID_PREFIX = '_motif_'

/** Identity of a hit, stable across re-scans. */
export function motifKey(hit: MotifHit): string {
  return `${hit.motifId}:${hit.start}:${hit.end}`
}

export function motifIdFor(hit: MotifHit): string {
  return MOTIF_ID_PREFIX + motifKey(hit)
}

/** The key back out of a hit's annotation id, or null if it isn't one. */
export function keyFromMotifId(id: string): string | null {
  return id.startsWith(MOTIF_ID_PREFIX) ? id.slice(MOTIF_ID_PREFIX.length) : null
}

export function isMotifId(id: string): boolean {
  return id.startsWith(MOTIF_ID_PREFIX)
}

/** Is there already a feature of this name on exactly these residues? */
export function isMotifAnnotated(
  hit: MotifHit,
  annotations: readonly { name: string; start: number; end: number }[],
): boolean {
  return annotations.some(a => a.start === hit.start && a.end === hit.end && a.name === hit.name)
}

/** The hits a conversion would actually add. */
export function convertibleMotifs(
  hits: readonly MotifHit[],
  annotations: readonly { name: string; start: number; end: number }[],
): MotifHit[] {
  if (hits.length === 0) return []
  if (annotations.length === 0) return [...hits]
  return hits.filter(h => !isMotifAnnotated(h, annotations))
}

const idRun = Date.now().toString(36)
let idCounter = 0

/** One hit as a feature: the name, type and colour it had on screen. */
export function motifToAnnotationData(hit: MotifHit): AnnotationData {
  return {
    id: `motif_${idRun}_${++idCounter}`,
    name: hit.name,
    type: hit.type,
    start: hit.start,
    end: hit.end,
    strand: 0,
    color: hit.color,
    qualifiers: { note: [`${hit.sequence}, ${hit.category.toLowerCase()}`] },
  }
}
