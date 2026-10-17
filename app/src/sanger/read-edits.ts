/**
 * A sequencing read as the session holds it: the trace, the trim, the base
 * edits the user made, and their undo history; and how the edits apply to
 * the trace's bases to give the sequence shown and exported.
 */

import type { Ab1Data } from '../io/ab1'

export type BaseEdit =
  /** `by: 'mixed'`: an IUPAC call made from second peaks, not typed by the user. */
  | { type: 'substitute'; pos: number; original: string; base: string; by?: 'mixed' }
  | { type: 'insert'; pos: number; offset: number; base: string }
  | { type: 'delete'; pos: number; original: string }

export interface SeqUndoSnapshot {
  edits: BaseEdit[]
  trimStart: number
  trimEnd: number
  trimBy?: string
  /** What the change after this snapshot did ("Delete 3 bases"), for undo labels. */
  label?: string
}

export interface SequencingRead {
  id: string
  data: Ab1Data
  /** When it was imported. Absent in sessions written before the field. */
  createdAt: number
  trimStart: number
  trimEnd: number
  /** The rule that set the trim ("the Q20 score", "an error limit of 0.05", "hand"), shown beside it. */
  trimBy?: string
  edits: BaseEdit[]
  undoStack: SeqUndoSnapshot[]
  redoStack: SeqUndoSnapshot[]
  /** Shown reverse complemented (a reverse-primer read). A view choice; the data stays forward. */
  reversed?: boolean
}

/**
 * Apply edits to the original base string and return the edited sequence
 * plus a per-character edit-type map for rendering.
 */
export function applyEdits(
  originalBases: string,
  edits: BaseEdit[],
): { bases: string; editMap: Array<'original' | 'substitute' | 'insert' | 'delete'> } {
  if (edits.length === 0) {
    return {
      bases: originalBases,
      editMap: Array(originalBases.length).fill('original'),
    }
  }

  const bases: string[] = []
  const editMap: Array<'original' | 'substitute' | 'insert' | 'delete'> = []

  // Index edits by original position for fast lookup
  const editsByPos = new Map<number, BaseEdit[]>()
  for (const e of edits) {
    const arr = editsByPos.get(e.pos) || []
    arr.push(e)
    editsByPos.set(e.pos, arr)
  }

  for (let i = 0; i < originalBases.length; i++) {
    const posEdits = editsByPos.get(i)
    if (!posEdits) {
      bases.push(originalBases[i])
      editMap.push('original')
      continue
    }

    // Process inserts before this position, sorted by offset
    const inserts = posEdits.filter((e): e is BaseEdit & { type: 'insert' } => e.type === 'insert').sort((a, b) => a.offset - b.offset)
    for (const e of inserts) {
      bases.push(e.base)
      editMap.push('insert')
    }

    // Check for delete or substitute at this position
    const del = posEdits.find(e => e.type === 'delete')
    const sub = posEdits.find(e => e.type === 'substitute')
    if (del) {
      // deleted - skip this base but mark it
      bases.push(originalBases[i])
      editMap.push('delete')
    } else if (sub) {
      bases.push(sub.base)
      editMap.push('substitute')
    } else {
      bases.push(originalBases[i])
      editMap.push('original')
    }
  }

  // Handle inserts past the end
  const endEdits = editsByPos.get(originalBases.length)
  if (endEdits) {
    const endInserts = endEdits.filter((e): e is BaseEdit & { type: 'insert' } => e.type === 'insert').sort((a, b) => a.offset - b.offset)
    for (const e of endInserts) {
      bases.push(e.base)
      editMap.push('insert')
    }
  }

  return { bases: bases.join(''), editMap }
}
