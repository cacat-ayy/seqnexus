/**
 * Where a feature is, for the feature panel: checking a location typed into
 * its editor before it reaches the document, and testing it against the
 * selection.
 *
 * Coordinates are 0-based half-open, as everywhere in the model. A feature
 * whose start is after its end wraps the origin of a circular sequence.
 */

import type { Annotation } from '../models/Annotation'

/**
 * Why a location cannot be stored, or null when it can.
 *
 * The model keeps parts only while they agree with start and end and run
 * forward (crossing the origin at most once, and only when the feature
 * wraps); anything else it drops without a word. Checking here first means
 * an edit that would turn a joined feature into one piece is refused with a
 * reason instead.
 */
export function locationError(
  start: number,
  end: number,
  parts: readonly (readonly [number, number])[] | null,
  seqLen: number,
  circular: boolean,
): string | null {
  const inBounds = (n: number) => Number.isInteger(n) && n >= 0 && n <= seqLen
  if (!inBounds(start) || !inBounds(end)) return `Positions run from 1 to ${seqLen}`
  if (start === end) return 'The feature would be empty'
  if (start > end && !circular) return 'Start is after end (only a circular sequence can wrap)'
  if (!parts) return null

  if (parts.length < 2) return 'A joined feature needs at least two parts'
  let descents = 0
  for (let k = 0; k < parts.length; k++) {
    const [s, e] = parts[k]
    if (!inBounds(s) || !inBounds(e)) return `Positions run from 1 to ${seqLen}`
    if (!(s < e)) return `Part ${k + 1} ends before it starts`
    if (k > 0 && s < parts[k - 1][1]) descents++
  }
  if (descents > (start > end ? 1 : 0)) return 'Parts must follow one another along the sequence'
  return null
}

/** The span of a feature as one or two pieces, split at the origin. */
export function featurePieces(ann: Pick<Annotation, 'start' | 'end'>, seqLen: number): [number, number][] {
  if (ann.start <= ann.end) return [[ann.start, ann.end]]
  const pieces: [number, number][] = []
  if (ann.start < seqLen) pieces.push([ann.start, seqLen])
  if (ann.end > 0) pieces.push([0, ann.end])
  return pieces
}

/** Whether a feature's span shares a base with any of the ranges. */
export function featureOverlaps(
  ann: Pick<Annotation, 'start' | 'end'>,
  ranges: readonly (readonly [number, number])[],
  seqLen: number,
): boolean {
  for (const [s, e] of featurePieces(ann, seqLen)) {
    for (const [rs, re] of ranges) {
      if (s < re && rs < e) return true
    }
  }
  return false
}
