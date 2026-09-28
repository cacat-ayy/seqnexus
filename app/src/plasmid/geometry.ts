/**
 * Pure geometry for the circular map.
 *
 * Moved out of PlasmidMap.tsx so the layout can be built and tested without a
 * canvas. `annArcSpan`, `annotationsOverlap` and `stackAnnotations` are
 * unchanged from the versions that lived there; `planTicks` is new.
 */

import type { Annotation } from '../models/Annotation'
import { internalPosition } from '../models/Document'

export const TWO_PI = Math.PI * 2

/** Normalise an angle to [0, 2π). */
export function normalizeAngle(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI
}

/** Convert a base position to an angle. 0 = top, increasing clockwise. */
export function posToAngle(pos: number, seqLen: number): number {
  return (pos / seqLen) * TWO_PI - Math.PI / 2
}

/** Inverse of posToAngle: screen angle back to a base position. */
export function angleToPos(angle: number, seqLen: number): number {
  const a = normalizeAngle(angle + Math.PI / 2)
  return Math.round((a / TWO_PI) * seqLen) % seqLen
}

/** Check whether two annotations overlap, accounting for origin-spanning. */
export function annotationsOverlap(a: Annotation, b: Annotation): boolean {
  const aWraps = a.start > a.end
  const bWraps = b.start > b.end
  if (!aWraps && !bWraps) {
    return a.start < b.end && a.end > b.start
  }
  if (aWraps && bWraps) {
    // Both cover the origin, so they always share it.
    return true
  }
  // One wraps, one does not. The wrapping one covers [start, ∞) ∪ [0, end).
  const wrap = aWraps ? a : b
  const norm = aWraps ? b : a
  return norm.start < wrap.end || norm.end > wrap.start
}

/** Stack annotations into non-overlapping rings. */
export function stackAnnotations(annotations: Annotation[]): Annotation[][] {
  const sorted = [...annotations].sort((a, b) => a.start - b.start)
  const rings: Annotation[][] = []
  for (const ann of sorted) {
    let placed = false
    for (const ring of rings) {
      if (!ring.some(existing => annotationsOverlap(ann, existing))) {
        ring.push(ann)
        placed = true
        break
      }
    }
    if (!placed) rings.push([ann])
  }
  return rings
}

/**
 * Angular span for an annotation, from its base positions so that
 * origin-spanning is unambiguous. Always positive, in (0, 2π].
 */
export function annArcSpan(start: number, end: number, seqLen: number): number {
  const spansOrigin = start > end
  let bpSpan = spansOrigin ? seqLen - start + end : end - start
  if (bpSpan <= 0) bpSpan = seqLen // full circle
  return (bpSpan / seqLen) * TWO_PI
}

/** Cap on total ticks, so a genome-scale sequence cannot draw thousands. */
const MAX_TICKS = 500

/** Adaptive tick intervals that stay under MAX_TICKS. */
export function getTickIntervals(seqLen: number): { major: number; minor: number } {
  if (seqLen <= 5_000) return { major: 500, minor: 100 }
  if (seqLen <= 50_000) return { major: 5_000, minor: 1_000 }
  if (seqLen <= 500_000) return { major: 50_000, minor: 10_000 }
  const minor = Math.ceil(seqLen / MAX_TICKS / 1000) * 1000
  return { major: minor * 5, minor }
}

export interface PlannedTick {
  /** Base position to draw at, 0-based internal coordinates. */
  pos: number
  /** 1-based number to print, already in display coordinates. */
  label: number
  major: boolean
}

/**
 * Lay out ruler ticks in *display* space.
 *
 * The old code stepped through raw internal positions and then printed
 * `displayPosition()` of each one. With a display origin set that put ticks at
 * raw multiples of the interval while labelling them with whatever display
 * number happened to fall there, so the ring read 4001, 4501, 1, 501 and the
 * tick labelled 1 was nowhere near the top of the circle.
 *
 * Stepping through display positions and converting back with
 * `internalPosition()` keeps the labels round and puts each one exactly where
 * that base is drawn, which is what the status bar and the linear view show.
 */
export function planTicks(seqLen: number, displayOrigin: number): PlannedTick[] {
  if (seqLen <= 0) return []
  const { major, minor } = getTickIntervals(seqLen)
  const ticks: PlannedTick[] = []
  for (let label = 1; label <= seqLen; label += minor) {
    ticks.push({
      pos: internalPosition(label, displayOrigin, seqLen),
      label,
      // `label` is 1-based, so the round numbers are 1, major+1, 2*major+1.
      major: (label - 1) % major === 0,
    })
  }
  return ticks
}
