/**
 * Document model: combines Sequence + Annotations.
 *
 * Edit operations mutate the underlying PieceTable in place and adjust
 * annotations via the IntervalTree. The store layer manages undo/redo
 * using PieceTable snapshots + annotation data snapshots.
 *
 * The immutable-style functions (insertBases, deleteBases, etc.) are kept
 * for backward compatibility with existing tests - they return new
 * DocumentState objects with fresh Sequence/Annotation arrays.
 */

import { Sequence, Topology } from './Sequence'
import type { PieceTableSnapshot } from './Sequence'
import { Annotation, AnnotationData, adjustAnnotation } from './Annotation'
import type { PrimerData } from '../primers/oligo'

export type Strandedness = 'single' | 'double'

/**
 * Where a document came from.
 *
 * On the document rather than on the tab so that `snapshot` and `restore`
 * carry it for free, and so an exported sequence still says what produced
 * it. The explorer turns it into a row badge.
 */
export type DocumentOrigin =
  | 'import'     // read from a file the user opened or dropped
  | 'ncbi'       // fetched by accession
  | 'snapgene'   // read from a .dna file
  | 'cloning'    // product of a cloning simulation
  | 'pcr'        // product of an in-silico PCR
  | 'gel'        // a band cut out of a virtual gel
  | 'optimized'  // output of the codon optimizer
  | 'consensus'  // called from a chromatogram or contig
  | 'paste'      // pasted sequence text
  | 'new'        // created empty

export interface SequenceMetadata {
  strandedness?: Strandedness
  damMethylated?: boolean
  dcmMethylated?: boolean
  ecoKIMethylated?: boolean
  /** 0-based internal position that should display as "position 1". Circular only. */
  displayOrigin?: number
  origin?: DocumentOrigin
}

export interface DocumentState {
  name: string
  description?: string
  sequence: Sequence
  annotations: Annotation[]
  /**
   * Primers and probes carried by this document, as oligos. Where they bind
   * is derived, never stored, so base edits need not touch this list and it
   * rides through every `{ ...state }` edit unchanged.
   */
  primers?: PrimerData[]
  metadata?: SequenceMetadata
}

export interface DocumentSnapshot {
  name: string
  description?: string
  bases: string
  topology: Topology
  annotations: AnnotationData[]
  primers?: PrimerData[]
  metadata?: SequenceMetadata
}

/** Only written when present, so documents without primers serialize as before. */
function primersField(primers: PrimerData[] | undefined): { primers?: PrimerData[] } {
  return primers && primers.length > 0 ? { primers } : {}
}

/** Serialize a DocumentState to a plain object for persistence/duplication. */
export function snapshot(state: DocumentState): DocumentSnapshot {
  return {
    name: state.name,
    description: state.description,
    bases: state.sequence.bases,
    topology: state.sequence.topology,
    annotations: state.annotations.map(a => a.toData()),
    ...primersField(state.primers),
    metadata: state.metadata,
  }
}

/** Restore a DocumentState from a full snapshot. */
export function restore(snap: DocumentSnapshot): DocumentState {
  return {
    name: snap.name,
    description: snap.description,
    sequence: new Sequence(snap.bases, snap.topology),
    annotations: snap.annotations.map(d => new Annotation(d)),
    ...primersField(snap.primers),
    metadata: snap.metadata,
  }
}

/**
 * Lightweight undo snapshot - stores PieceTable tree structure (O(p) where p
 * is the number of pieces, typically <100) instead of materializing the full
 * sequence string (O(n) where n can be millions of bases).
 */
export interface UndoSnapshot {
  ptSnapshot: PieceTableSnapshot
  topology: Topology
  /**
   * The document's annotation array itself, not a copy. Annotations are
   * immutable and edits build new arrays, so consecutive entries share it
   * when an edit left the features alone (typing in a 5,000-feature genome
   * used to copy all 5,000 per keystroke). Plain data after a reload.
   */
  annotations: readonly AnnotationData[]
  primers?: PrimerData[]
  name: string
  description?: string
  metadata?: SequenceMetadata
  /**
   * What the change this entry reverts was, in a few words ("Add feature
   * “lacZ”"), for the Undo and Redo tooltips. Optional: entries saved before
   * labels existed, and edits made outside the store's mutators, have none.
   */
  label?: string
}

/** Create a lightweight undo snapshot. O(p) - no string materialization. */
export function undoSnapshot(state: DocumentState): UndoSnapshot {
  return {
    ptSnapshot: state.sequence.pieceTable.snapshot(),
    topology: state.sequence.topology,
    annotations: state.annotations,
    // PrimerData objects are never mutated, only replaced, so sharing them
    // with the snapshot is safe.
    ...primersField(state.primers),
    name: state.name,
    description: state.description,
    metadata: state.metadata,
  }
}

/**
 * Restore a DocumentState from a lightweight undo snapshot.
 * Restores the PieceTable tree in-place on the current document's Sequence,
 * preserving the original and add buffers.
 *
 * The snapshot's tree points into those buffers, so it is only valid against
 * the PieceTable it was taken from. Anything that changes a document must keep
 * its PieceTable (edit it in place, or wrap it with Sequence.fromPieceTable)
 * rather than swap in a new one, or older entries restore the wrong bases.
 */
export function restoreUndo(snap: UndoSnapshot, currentSequence: Sequence): DocumentState {
  const pt = currentSequence.pieceTable
  pt.restoreSnapshot(snap.ptSnapshot)
  const topology = snap.topology ?? currentSequence.topology
  return {
    name: snap.name,
    description: snap.description,
    sequence: topology === currentSequence.topology
      ? currentSequence
      : Sequence.fromPieceTable(pt, topology),
    annotations: snap.annotations.every(a => a instanceof Annotation)
      ? snap.annotations as Annotation[]
      : snap.annotations.map(d => d instanceof Annotation ? d : new Annotation(d)),
    ...primersField(snap.primers),
    metadata: snap.metadata,
  }
}

/** The new list, or the old one itself when no annotation changed. */
function keepIfSame(before: Annotation[], after: Annotation[]): Annotation[] {
  return after.length === before.length && after.every((a, i) => a === before[i]) ? before : after
}

/**
 * In-place insert: mutates the sequence's PieceTable and adjusts annotations.
 * Returns a new DocumentState object (for React re-render) but the underlying
 * PieceTable is mutated in O(log p) instead of O(n).
 */
export function insertBasesInPlace(
  state: DocumentState,
  pos: number,
  fragment: string,
): DocumentState {
  const circular = state.sequence.topology === 'circular'
  const seqLen = state.sequence.length
  state.sequence.insertInPlace(pos, fragment)
  const annotations = state.annotations
    .map(a => adjustAnnotation(a, pos, fragment.length, seqLen, circular))
    .filter((a): a is Annotation => a !== null)
  return { ...state, annotations: keepIfSame(state.annotations, annotations) }
}

/**
 * In-place delete: mutates the sequence's PieceTable and adjusts annotations.
 */
export function deleteBasesInPlace(
  state: DocumentState,
  start: number,
  end: number,
): DocumentState {
  const circular = state.sequence.topology === 'circular'
  const seqLen = state.sequence.length
  const delta = -(end - start)
  state.sequence.deleteInPlace(start, end)
  const annotations = state.annotations
    .map(a => adjustAnnotation(a, start, delta, seqLen, circular))
    .filter((a): a is Annotation => a !== null)
  return { ...state, annotations: keepIfSame(state.annotations, annotations) }
}

/**
 * In-place substitution: rewrite bases without moving anything.
 *
 * Every edit must be the same length as the span it replaces, which is what
 * makes this different from replaceBasesInPlace and why it exists. Codon
 * optimization rewrites a CDS in situ; routing that through delete-then-insert
 * would run the annotations through adjustAnnotation, and an annotation that
 * sits entirely inside a deleted range is dropped. The CDS being optimized is
 * exactly such an annotation, so the feature would delete itself.
 *
 * Coordinates do not change, so no annotation needs adjusting at all.
 */
export function assertSubstitutions(
  state: DocumentState,
  edits: readonly { start: number; end: number; bases: string }[],
): void {
  for (const edit of edits) {
    if (edit.end - edit.start !== edit.bases.length) {
      throw new Error('substituteBasesInPlace requires equal-length edits')
    }
    if (edit.start < 0 || edit.end > state.sequence.length) {
      throw new Error('substituteBasesInPlace edit is out of range')
    }
  }
}

export function substituteBasesInPlace(
  state: DocumentState,
  edits: readonly { start: number; end: number; bases: string }[],
): DocumentState {
  if (edits.length === 0) return state
  assertSubstitutions(state, edits)
  for (const edit of edits) {
    state.sequence.replaceInPlace(edit.start, edit.end, edit.bases)
  }
  return { ...state }
}

/**
 * In-place replace: mutates the sequence's PieceTable and adjusts annotations.
 */
export function replaceBasesInPlace(
  state: DocumentState,
  start: number,
  end: number,
  fragment: string,
): DocumentState {
  let s = deleteBasesInPlace(state, start, end)
  if (fragment.length > 0) {
    s = insertBasesInPlace(s, start, fragment)
  }
  return s
}

/**
 * Insert bases at `pos` and adjust all annotations.
 */
export function insertBases(
  state: DocumentState,
  pos: number,
  fragment: string,
): DocumentState {
  const circular = state.sequence.topology === 'circular'
  const sequence = state.sequence.insert(pos, fragment)
  const annotations = state.annotations
    .map(a => adjustAnnotation(a, pos, fragment.length, state.sequence.length, circular))
    .filter((a): a is Annotation => a !== null)
  return { ...state, sequence, annotations }
}

/**
 * Delete bases in [start, end) and adjust all annotations.
 */
export function deleteBases(
  state: DocumentState,
  start: number,
  end: number,
): DocumentState {
  const circular = state.sequence.topology === 'circular'
  const delta = -(end - start)
  const sequence = state.sequence.delete(start, end)
  const annotations = state.annotations
    .map(a => adjustAnnotation(a, start, delta, state.sequence.length, circular))
    .filter((a): a is Annotation => a !== null)
  return { ...state, sequence, annotations }
}

/**
 * Replace bases in [start, end) with `fragment` and adjust all annotations.
 */
export function replaceBases(
  state: DocumentState,
  start: number,
  end: number,
  fragment: string,
): DocumentState {
  let s = deleteBases(state, start, end)
  if (fragment.length > 0) {
    s = insertBases(s, start, fragment)
  }
  return s
}

/**
 * Add an annotation.
 */
export function addAnnotation(
  state: DocumentState,
  data: AnnotationData,
): DocumentState {
  return {
    ...state,
    annotations: [...state.annotations, new Annotation(data)],
  }
}

/**
 * Remove an annotation by id.
 */
export function removeAnnotation(
  state: DocumentState,
  id: string,
): DocumentState {
  return {
    ...state,
    annotations: state.annotations.filter(a => a.id !== id),
  }
}

/**
 * Update an annotation by id.
 */
export function updateAnnotation(
  state: DocumentState,
  id: string,
  patch: Partial<Omit<AnnotationData, 'id'>>,
): DocumentState {
  return {
    ...state,
    annotations: state.annotations.map(a =>
      a.id === id ? a.with(patch) : a,
    ),
  }
}

/**
 * Remove many annotations in one pass.
 *
 * Calling `removeAnnotation` in a loop is O(n) per id — it rebuilds the whole
 * array each time — so deleting 50 features from a 500-feature plasmid walked
 * 25,000 entries. This walks it once.
 */
export function removeAnnotations(
  state: DocumentState,
  ids: Iterable<string>,
): DocumentState {
  const doomed = new Set(ids)
  if (doomed.size === 0) return state
  const annotations = state.annotations.filter(a => !doomed.has(a.id))
  if (annotations.length === state.annotations.length) return state
  return { ...state, annotations }
}

// ---------------------------------------------------------------------------
// Primers. No coordinates to maintain: binding is recomputed from the bases.
// Each returns `state` itself for a no-op, so the store's transact() can tell
// nothing happened and skip the undo entry.
// ---------------------------------------------------------------------------

export function addPrimers(state: DocumentState, primers: readonly PrimerData[]): DocumentState {
  if (primers.length === 0) return state
  return { ...state, primers: [...(state.primers ?? []), ...primers] }
}

export function updatePrimer(
  state: DocumentState,
  id: string,
  patch: Partial<Omit<PrimerData, 'id'>>,
): DocumentState {
  const list = state.primers ?? []
  if (!list.some(p => p.id === id)) return state
  return { ...state, primers: list.map(p => (p.id === id ? { ...p, ...patch } : p)) }
}

export function removePrimers(state: DocumentState, ids: Iterable<string>): DocumentState {
  const doomed = new Set(ids)
  const list = state.primers ?? []
  const primers = list.filter(p => !doomed.has(p.id))
  if (primers.length === list.length) return state
  return { ...state, primers }
}

/**
 * Apply the same patch to many annotations in one pass.
 *
 * Returns `state` unchanged when nothing matched, so callers can skip pushing
 * an undo entry for a no-op.
 */
export function updateAnnotations(
  state: DocumentState,
  ids: Iterable<string>,
  patch: Partial<Omit<AnnotationData, 'id'>>,
): DocumentState {
  const targets = new Set(ids)
  if (targets.size === 0) return state
  let changed = false
  const annotations = state.annotations.map(a => {
    if (!targets.has(a.id)) return a
    changed = true
    return a.with(patch)
  })
  return changed ? { ...state, annotations } : state
}

/**
 * Convert an internal 0-based position to a 1-based display position,
 * accounting for a custom display origin on circular sequences.
 */
export function displayPosition(
  internalPos: number,
  displayOrigin: number,
  seqLen: number,
): number {
  if (seqLen === 0 || displayOrigin === 0) return internalPos + 1
  return ((internalPos - displayOrigin + seqLen) % seqLen) + 1
}

/**
 * Convert a 1-based display position back to a 0-based internal position.
 */
export function internalPosition(
  displayPos: number,
  displayOrigin: number,
  seqLen: number,
): number {
  if (seqLen === 0 || displayOrigin === 0) return displayPos - 1
  return (displayPos - 1 + displayOrigin) % seqLen
}

/** A feature's parts after moving the origin to `newOrigin`; a part the new origin cuts becomes two. */
function rotateSegments(
  segments: readonly [number, number][] | undefined,
  newOrigin: number,
  seqLen: number,
): [number, number][] | undefined {
  if (!segments) return undefined
  const out: [number, number][] = []
  for (const [s, e] of segments) {
    const ns = (s - newOrigin + seqLen) % seqLen
    const ne = ns + (e - s)
    if (ne > seqLen) out.push([ns, seqLen], [0, ne - seqLen])
    else out.push([ns, ne])
  }
  return out
}

/**
 * Physically rotate a circular sequence so that `newOrigin` becomes position 0.
 * Adjusts all annotation coordinates. Resets displayOrigin to 0.
 *
 * In place, like the other *InPlace edits: the bases before the new origin
 * move to the end of the same PieceTable, so undo snapshots taken earlier
 * still point at valid buffers.
 */
export function rotateOriginInPlace(
  state: DocumentState,
  newOrigin: number,
): DocumentState {
  const seqLen = state.sequence.length
  if (seqLen === 0 || newOrigin <= 0 || newOrigin >= seqLen) return state

  const head = state.sequence.basesIn(0, newOrigin)
  state.sequence.deleteInPlace(0, newOrigin)
  state.sequence.insertInPlace(seqLen - newOrigin, head)
  const sequence = state.sequence

  const annotations = state.annotations.map(a => {
    const newStart = (a.start - newOrigin + seqLen) % seqLen
    let newEnd = (a.end - newOrigin + seqLen) % seqLen
    // end===0 after modulo means the annotation ended exactly at the new origin;
    // it should wrap to seqLen (the full sequence end), not become zero-length.
    if (newEnd === 0 && a.end !== a.start) newEnd = seqLen
    return a.with({ start: newStart, end: newEnd, segments: rotateSegments(a.segments, newOrigin, seqLen) })
  })

  return {
    ...state,
    sequence,
    annotations,
    metadata: { ...state.metadata, displayOrigin: 0 },
  }
}


