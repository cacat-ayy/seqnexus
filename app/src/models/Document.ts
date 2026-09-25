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

export type Strandedness = 'single' | 'double'

export interface SequenceMetadata {
  strandedness?: Strandedness
  damMethylated?: boolean
  dcmMethylated?: boolean
  ecoKIMethylated?: boolean
  /** 0-based internal position that should display as "position 1". Circular only. */
  displayOrigin?: number
}

export interface DocumentState {
  name: string
  description?: string
  sequence: Sequence
  annotations: Annotation[]
  metadata?: SequenceMetadata
}

export interface DocumentSnapshot {
  name: string
  description?: string
  bases: string
  topology: Topology
  annotations: AnnotationData[]
  metadata?: SequenceMetadata
}

/** Serialize a DocumentState to a plain object for persistence/duplication. */
export function snapshot(state: DocumentState): DocumentSnapshot {
  return {
    name: state.name,
    description: state.description,
    bases: state.sequence.bases,
    topology: state.sequence.topology,
    annotations: state.annotations.map(a => a.toData()),
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
  annotations: AnnotationData[]
  name: string
  description?: string
  metadata?: SequenceMetadata
}

/** Create a lightweight undo snapshot. O(p) - no string materialization. */
export function undoSnapshot(state: DocumentState): UndoSnapshot {
  return {
    ptSnapshot: state.sequence.pieceTable.snapshot(),
    topology: state.sequence.topology,
    annotations: state.annotations.map(a => a.toData()),
    name: state.name,
    description: state.description,
    metadata: state.metadata,
  }
}

/**
 * Restore a DocumentState from a lightweight undo snapshot.
 * Restores the PieceTable tree in-place on the current document's Sequence,
 * preserving the original and add buffers.
 */
export function restoreUndo(snap: UndoSnapshot, currentSequence: Sequence): DocumentState {
  currentSequence.pieceTable.restoreSnapshot(snap.ptSnapshot)
  return {
    name: snap.name,
    description: snap.description,
    sequence: currentSequence,
    annotations: snap.annotations.map(d => new Annotation(d)),
    metadata: snap.metadata,
  }
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
  return { ...state, annotations }
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
  return { ...state, annotations }
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

/**
 * Physically rotate a circular sequence so that `newOrigin` becomes position 0.
 * Adjusts all annotation coordinates. Resets displayOrigin to 0.
 */
export function rotateOrigin(
  state: DocumentState,
  newOrigin: number,
): DocumentState {
  const seqLen = state.sequence.length
  if (seqLen === 0 || newOrigin === 0) return state

  const bases = state.sequence.bases
  const rotated = bases.slice(newOrigin) + bases.slice(0, newOrigin)
  const sequence = new Sequence(rotated, state.sequence.topology)

  const annotations = state.annotations.map(a => {
    const newStart = (a.start - newOrigin + seqLen) % seqLen
    let newEnd = (a.end - newOrigin + seqLen) % seqLen
    // end===0 after modulo means the annotation ended exactly at the new origin;
    // it should wrap to seqLen (the full sequence end), not become zero-length.
    if (newEnd === 0 && a.end !== a.start) newEnd = seqLen
    return a.with({ start: newStart, end: newEnd })
  })

  return {
    ...state,
    sequence,
    annotations,
    metadata: { ...state.metadata, displayOrigin: 0 },
  }
}


