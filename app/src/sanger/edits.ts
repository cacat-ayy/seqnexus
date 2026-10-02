/**
 * Editing a read's calls, in forward columns of its layout.
 *
 * Edits are stored against the original calls (BaseEdit), so the trace and
 * the instrument's calls are never changed and every edit can be taken back
 * one column at a time. These functions take the current edits and return
 * new ones; the caller records the change as one undo step.
 */

import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import { complementBase, reverseComplement } from '../models/complement'
import { baseBits } from '../msa/iupac'
import { buildLayout, inTrim, KIND_DELETE, KIND_INSERT, type ReadLayout } from './layout'

/** Quality given to a base the user typed: a call made by hand is a confident one. */
export const MANUAL_QUALITY = 40

/** Bases the editor accepts: the four bases, N and the IUPAC ambiguity codes. */
export const EDIT_BASE = /^[ACGTNRYSWKMBDHV]$/

/** Set column `col` to `base`. Setting a called base back to its original removes the edit. */
export function substitute(data: TraceData, edits: readonly BaseEdit[], layout: ReadLayout, col: number, base: string): BaseEdit[] {
  if (col < 0 || col >= layout.n) return [...edits]
  const pos = layout.origin[col]
  if (layout.kind[col] === KIND_INSERT) {
    const offset = layout.insertOffset[col]
    return edits.map(e => (e.type === 'insert' && e.pos === pos && offsetRank(edits, e) === offset ? { ...e, base } : e))
  }
  const rest = edits.filter(e => !(e.pos === pos && (e.type === 'substitute' || e.type === 'delete')))
  if (data.bases[pos] === base) return rest
  return [...rest, { type: 'substitute', pos, original: data.bases[pos], base }]
}

/**
 * Insert `bases` before forward column `col` (col = n appends). Returns the
 * new edits; the inserted bases take columns col .. col + bases.length - 1.
 */
export function insertBefore(data: TraceData, edits: readonly BaseEdit[], layout: ReadLayout, col: number, bases: string): BaseEdit[] {
  if (bases.length === 0) return [...edits]
  const c = Math.max(0, Math.min(layout.n, col))
  let pos: number
  let at: number
  if (c === layout.n) {
    pos = data.bases.length
    at = countInserts(edits, pos)
  } else if (layout.kind[c] === KIND_INSERT) {
    pos = layout.origin[c]
    at = layout.insertOffset[c]
  } else {
    pos = layout.origin[c]
    at = countInserts(edits, pos)
  }
  // Renumber the inserts at `pos` so offsets are 0..k-1 in order, leaving room.
  const here = edits
    .filter((e): e is Extract<BaseEdit, { type: 'insert' }> => e.type === 'insert' && e.pos === pos)
    .sort((a, b) => a.offset - b.offset)
  const others = edits.filter(e => !(e.type === 'insert' && e.pos === pos))
  const renumbered: BaseEdit[] = here.map((e, k) => ({ ...e, offset: k < at ? k : k + bases.length }))
  const added: BaseEdit[] = [...bases].map((b, k) => ({ type: 'insert', pos, offset: at + k, base: b }))
  return [...others, ...renumbered, ...added]
}

/**
 * Delete forward columns [c0, c1): called bases are marked deleted (they
 * keep their column), inserted bases are removed outright.
 */
export function deleteColumns(data: TraceData, edits: readonly BaseEdit[], layout: ReadLayout, c0: number, c1: number): BaseEdit[] {
  const drop = new Set<string>()
  const mark: number[] = []
  for (let c = Math.max(0, c0); c < Math.min(layout.n, c1); c++) {
    const pos = layout.origin[c]
    if (layout.kind[c] === KIND_INSERT) drop.add(`${pos}:${layout.insertOffset[c]}`)
    else if (layout.kind[c] !== KIND_DELETE) mark.push(pos)
  }
  const marked = new Set(mark)
  let next = edits.filter(e => {
    if (e.type === 'insert') return !drop.has(`${e.pos}:${offsetRank(edits, e)}`)
    return !(marked.has(e.pos) && e.type === 'substitute')
  })
  next = renumberInserts(next)
  for (const pos of mark) next.push({ type: 'delete', pos, original: data.bases[pos] })
  return next
}

/** Undo every edit in forward columns [c0, c1): substitutions, deletions and inserts. */
export function revertColumns(edits: readonly BaseEdit[], layout: ReadLayout, c0: number, c1: number): BaseEdit[] {
  const positions = new Set<number>()
  const inserts = new Set<string>()
  for (let c = Math.max(0, c0); c < Math.min(layout.n, c1); c++) {
    if (layout.kind[c] === KIND_INSERT) inserts.add(`${layout.origin[c]}:${layout.insertOffset[c]}`)
    else positions.add(layout.origin[c])
  }
  const next = edits.filter(e => {
    if (e.type === 'insert') return !inserts.has(`${e.pos}:${offsetRank(edits, e)}`)
    return !positions.has(e.pos)
  })
  return renumberInserts(next)
}

/** How many columns in [c0, c1) carry an edit. */
export function editedIn(layout: ReadLayout, c0: number, c1: number): number {
  let k = 0
  for (let c = Math.max(0, c0); c < Math.min(layout.n, c1); c++) if (layout.kind[c] !== 0) k++
  return k
}

function countInserts(edits: readonly BaseEdit[], pos: number): number {
  let k = 0
  for (const e of edits) if (e.type === 'insert' && e.pos === pos) k++
  return k
}

/** An insert's place among the inserts at its position (stored offsets may have gaps). */
function offsetRank(edits: readonly BaseEdit[], ins: Extract<BaseEdit, { type: 'insert' }>): number {
  let k = 0
  for (const e of edits) if (e.type === 'insert' && e.pos === ins.pos && e.offset < ins.offset) k++
  return k
}

function renumberInserts(edits: BaseEdit[]): BaseEdit[] {
  const byPos = new Map<number, Extract<BaseEdit, { type: 'insert' }>[]>()
  const out: BaseEdit[] = []
  for (const e of edits) {
    if (e.type !== 'insert') { out.push(e); continue }
    const list = byPos.get(e.pos)
    if (list) list.push(e)
    else byPos.set(e.pos, [e])
  }
  for (const list of byPos.values()) {
    list.sort((a, b) => a.offset - b.offset).forEach((e, k) => out.push({ ...e, offset: k }))
  }
  return out
}

// ---------------------------------------------------------------------------
// The read as a sequence
// ---------------------------------------------------------------------------

export interface EditedRead {
  bases: string
  quality: number[]
}

/**
 * The read as edited and trimmed: deleted bases dropped, typed bases at
 * MANUAL_QUALITY. With `reversed`, reverse complemented.
 */
export function editedRead(
  data: TraceData,
  edits: readonly BaseEdit[],
  trimStart: number,
  trimEnd: number,
  opts: { reversed?: boolean; layout?: ReadLayout; trim?: boolean } = {},
): EditedRead {
  const layout = opts.layout ?? buildLayout(data, edits)
  const trim = opts.trim ?? true
  let bases = ''
  const quality: number[] = []
  for (let c = 0; c < layout.n; c++) {
    const k = layout.kind[c]
    if (k === KIND_DELETE) continue
    if (trim && !inTrim(layout, c, trimStart, trimEnd)) continue
    bases += layout.bases[c]
    quality.push(k === 0 ? (data.qualityScores[layout.origin[c]] ?? 0) : MANUAL_QUALITY)
  }
  if (opts.reversed) return { bases: reverseComplement(bases), quality: quality.reverse() }
  return { bases, quality }
}

/** Phred scores as FASTQ quality characters (Sanger offset 33). */
export function fastqQuality(quality: readonly number[]): string {
  return quality.map(q => String.fromCharCode(Math.max(0, Math.min(93, Math.round(q))) + 33)).join('')
}

export function toFastq(name: string, r: EditedRead): string {
  return `@${name}\n${r.bases}\n+\n${fastqQuality(r.quality)}\n`
}

export function toFasta(name: string, bases: string): string {
  const lines = bases.match(/.{1,70}/g) ?? ['']
  return `>${name}\n${lines.join('\n')}\n`
}

/** A display base: the forward base, complemented in a reversed view. */
export function displayBase(base: string, reversed: boolean): string {
  return reversed ? complementBase(base) : base
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

/**
 * Display columns where `query` (IUPAC allowed) matches the shown bases,
 * skipping deleted columns. Each hit is [c0, c1) in display columns.
 */
export function findInColumns(shown: string, deleted: (col: number) => boolean, query: string, limit = 2000): [number, number][] {
  const q = query.toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, '').replace(/U/g, 'T')
  if (!q) return []
  const cols: number[] = []
  let s = ''
  for (let c = 0; c < shown.length; c++) {
    if (deleted(c)) continue
    cols.push(c)
    s += shown[c]
  }
  const qBits = [...q].map(baseBits)
  const hits: [number, number][] = []
  for (let i = 0; i + q.length <= s.length; i++) {
    let ok = true
    for (let k = 0; k < q.length; k++) {
      const b = baseBits(s[i + k])
      if (b === 0 || (b & qBits[k]) !== b) { ok = false; break }
    }
    if (ok) {
      hits.push([cols[i], cols[i + q.length - 1] + 1])
      if (hits.length >= limit) break
    }
  }
  return hits
}
