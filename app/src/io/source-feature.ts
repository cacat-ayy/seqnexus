/**
 * The source feature: what a record is, kept out of the features.
 *
 * Every GenBank record has a `source` feature over the whole sequence,
 * carrying the organism, molecule type, strain and the like. It says what
 * the sequence is, not where anything is on it, so as a feature it is only
 * one more arrow the length of the sequence. Every reader takes it out of
 * the features into the document's metadata, where nothing draws or lists
 * it, and the GenBank writer puts it back as `source 1..<length>`. Its
 * qualifiers are all that is kept: a source over the whole sequence stays
 * over the whole sequence whatever the edits.
 *
 * A source over part of the sequence (one of several in a construct, saying
 * which stretch comes from which organism) is a real feature and stays one.
 */

import type { AnnotationData } from '../models/Annotation'

export type SourceQualifiers = Record<string, string[]>

/** `annotations` without the source features over the whole sequence, and their qualifiers. */
export function takeSource<T extends AnnotationData>(annotations: readonly T[], length: number): {
  annotations: T[]
  source: SourceQualifiers[]
} {
  const source: SourceQualifiers[] = []
  const rest: T[] = []
  for (const a of annotations) {
    if (a.type === 'source' && a.start === 0 && a.end === length && !a.segments) {
      source.push(Object.fromEntries(Object.entries(a.qualifiers ?? {}).map(([k, v]) => [k, [...v]])))
    } else {
      rest.push(a)
    }
  }
  return { annotations: rest, source }
}
