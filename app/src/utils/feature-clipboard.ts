/**
 * Copy and paste with features, as SnapGene does.
 *
 * The system clipboard holds text, so a copy of a stretch of sequence
 * carries its bases and nothing else. The stretch's features and primers are
 * remembered here as well; a paste whose text is those same bases puts them
 * back, shifted to where the bases land, in another sequence or the same one.
 * Text copied anywhere else (another program, another tab of the browser)
 * pastes as bases only, as before.
 *
 * A feature comes along when it lies wholly inside the copied stretch, and a
 * primer when it binds wholly inside it. A feature cut by the edge of the
 * copy is left behind rather than pasted as a piece of itself.
 */

import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { Sequence } from '../models/Sequence'
import type { Alphabet } from '../models/alphabet'
import { newPrimerId, type PrimerData } from '../primers/oligo'
import { findBindingSites } from '../primers/binding'

export interface CopiedFragment {
  /** The bases, upper case. */
  bases: string
  /** Features, with positions counted from the start of the stretch. */
  annotations: AnnotationData[]
  primers: PrimerData[]
  /** Where it came from, for the paste's notice. */
  source: string
}

let last: CopiedFragment | null = null

/** The stretch [start, end) of `doc`, with what lies wholly inside it. */
export function fragmentOf(doc: DocumentState, start: number, end: number): CopiedFragment {
  const annotations: AnnotationData[] = []
  for (const a of doc.annotations) {
    if (a.start > a.end || a.start < start || a.end > end || a.start === a.end) continue
    const data = a.toData()
    annotations.push({
      ...data,
      start: a.start - start,
      end: a.end - start,
      ...(data.segments ? { segments: data.segments.map(([s, e]) => [s - start, e - start] as [number, number]) } : {}),
    })
  }
  const primers: PrimerData[] = []
  const all = doc.primers ?? []
  if (all.length > 0) {
    const sites = findBindingSites(all, doc.sequence.bases, doc.sequence.topology)
    for (const p of all) {
      if ((sites.get(p.id) ?? []).some(s => s.start >= start && s.end <= end && s.start < s.end)) primers.push(p)
    }
  }
  return { bases: doc.sequence.basesIn(start, end).toUpperCase(), annotations, primers, source: doc.name }
}

/** Remember a copied stretch, replacing the last one (null: a copy with no single stretch). */
export function rememberFragment(fragment: CopiedFragment | null): void {
  last = fragment
}

/** The remembered stretch, if `bases` are its bases (a paste of that copy). */
export function fragmentFor(bases: string): CopiedFragment | null {
  return last && last.bases === bases.toUpperCase() ? last : null
}

/**
 * The fragment's features and primers placed at `at` in a sequence that
 * already has `existing` primers: features get new ids, and a primer the
 * sequence already carries (same oligo) is not added twice.
 */
export function placeFragment(fragment: CopiedFragment, at: number, existing: readonly PrimerData[]): { annotations: AnnotationData[]; primers: PrimerData[] } {
  const stamp = Date.now().toString(36)
  const annotations = fragment.annotations.map((a, i) => ({
    ...a,
    id: `ann_${stamp}_p${i}`,
    start: a.start + at,
    end: a.end + at,
    ...(a.segments ? { segments: a.segments.map(([s, e]) => [s + at, e + at] as [number, number]) } : {}),
  }))
  const have = new Set(existing.map(p => p.sequence.toUpperCase()))
  const primers = fragment.primers
    .filter(p => !have.has(p.sequence.toUpperCase()))
    .map(p => ({ ...p, id: newPrimerId() }))
  return { annotations, primers }
}

/** The stretch as a linear document of its own, for "Copy as GenBank". */
export function fragmentDocument(fragment: CopiedFragment, name: string, alphabet: Alphabet): DocumentState {
  return {
    name,
    description: `From ${fragment.source}`,
    sequence: new Sequence(fragment.bases, 'linear', alphabet),
    annotations: fragment.annotations.map(a => new Annotation(a)),
    ...(fragment.primers.length > 0 ? { primers: fragment.primers } : {}),
  }
}
