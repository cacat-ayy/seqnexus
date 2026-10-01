/**
 * Editing operations on an alignment document.
 *
 * Every function is pure: it returns a new document, or the same one when
 * nothing changed (callers use that to skip empty undo steps). Rows that an
 * edit does not touch are passed through unchanged.
 *
 * Edits that make some rows longer pad the others with trailing gaps, and
 * edits that leave gap-only columns at the right edge drop them, so the
 * document is always rectangular with no dead tail.
 */

import { reverseComplement as rcPlain } from '../models/complement'
import { baseBits, codeForBits } from './iupac'
import {
  GAP, cleanResidues, newRowId, squareUp, ungapped, width,
  type AlnDoc, type AlnOrigin, type AlnRow, type RowInput,
} from './model'

const GAP_CODE = 45

function gaps(n: number): string {
  return n > 0 ? GAP.repeat(n) : ''
}

/** Replace some rows' sequences by id, then square up. */
function withSeqs(doc: AlnDoc, next: Map<string, string>): AlnDoc {
  let changed = false
  const rows = doc.rows.map(r => {
    const s = next.get(r.id)
    if (s === undefined || s === r.seq) return r
    changed = true
    return { ...r, seq: s }
  })
  if (!changed) return doc
  return { ...doc, rows: squareUp(rows) }
}

function idSet(ids: Iterable<string>): Set<string> {
  return ids instanceof Set ? ids as Set<string> : new Set(ids)
}

function clampCol(doc: AlnDoc, col: number): number {
  return Math.max(0, Math.min(width(doc), Math.floor(col)))
}

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

/** Insert `n` gaps at `col` in each given row, pushing its residues right. */
export function insertGaps(doc: AlnDoc, rowIds: Iterable<string>, col: number, n: number): AlnDoc {
  if (n <= 0) return doc
  const ids = idSet(rowIds)
  const c = clampCol(doc, col)
  const next = new Map<string, string>()
  for (const r of doc.rows) {
    if (ids.has(r.id)) next.set(r.id, r.seq.slice(0, c) + gaps(n) + r.seq.slice(c))
  }
  return withSeqs(doc, next)
}

/** Remove every gap in columns [c0, c1) of each given row, pulling its residues left. */
export function deleteGaps(doc: AlnDoc, rowIds: Iterable<string>, c0: number, c1: number): AlnDoc {
  const ids = idSet(rowIds)
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (b <= a) return doc
  const next = new Map<string, string>()
  for (const r of doc.rows) {
    if (!ids.has(r.id)) continue
    const mid = r.seq.slice(a, b)
    if (mid.indexOf(GAP) === -1) continue
    next.set(r.id, r.seq.slice(0, a) + ungapped(mid) + r.seq.slice(b))
  }
  return withSeqs(doc, next)
}

/** Gaps immediately right of column `c1 - 1`, i.e. starting at `c1`. */
function gapRunFrom(seq: string, start: number): number {
  let n = 0
  while (start + n < seq.length && seq.charCodeAt(start + n) === GAP_CODE) n++
  return n
}

/** Gaps immediately left of column `c0`. */
function gapRunBefore(seq: string, c0: number): number {
  let n = 0
  while (c0 - n - 1 >= 0 && seq.charCodeAt(c0 - n - 1) === GAP_CODE) n++
  return n
}

/**
 * How far a block of columns [c0, c1) in the given rows can slide: left as
 * far as every row has gaps before it, right as far as every row has gaps
 * after it (or without limit when pushing).
 */
export function slideRoom(doc: AlnDoc, rowIds: Iterable<string>, c0: number, c1: number): { left: number; right: number } {
  const ids = idSet(rowIds)
  let left = Infinity
  let right = Infinity
  for (const r of doc.rows) {
    if (!ids.has(r.id)) continue
    left = Math.min(left, gapRunBefore(r.seq, c0))
    right = Math.min(right, gapRunFrom(r.seq, c1))
  }
  if (left === Infinity) return { left: 0, right: 0 }
  return { left, right }
}

/**
 * Slide the block of columns [c0, c1) in the given rows by `delta` columns,
 * trading places with the gaps beside it. This is what dragging a selection
 * does.
 *
 * Without `push`, the move stops where the first row runs out of gaps. With
 * `push`, a move right that runs out inserts new gaps instead, shifting the
 * rest of those rows along. Moving left never overwrites residues.
 *
 * Returns the document and the distance actually moved.
 */
export function slideBlock(
  doc: AlnDoc, rowIds: Iterable<string>, c0: number, c1: number, delta: number, push = false,
): { doc: AlnDoc; moved: number } {
  const ids = idSet(rowIds)
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (b <= a || delta === 0 || ids.size === 0) return { doc, moved: 0 }
  const room = slideRoom(doc, ids, a, b)
  const next = new Map<string, string>()
  if (delta > 0) {
    const d = push ? delta : Math.min(delta, room.right)
    if (d === 0) return { doc, moved: 0 }
    for (const r of doc.rows) {
      if (!ids.has(r.id)) continue
      const eat = Math.min(d, gapRunFrom(r.seq, b))
      next.set(r.id, r.seq.slice(0, a) + gaps(d) + r.seq.slice(a, b) + r.seq.slice(b + eat))
    }
    return { doc: withSeqs(doc, next), moved: d }
  }
  const d = Math.min(-delta, room.left)
  if (d === 0) return { doc, moved: 0 }
  for (const r of doc.rows) {
    if (!ids.has(r.id)) continue
    next.set(r.id, r.seq.slice(0, a - d) + r.seq.slice(a, b) + gaps(d) + r.seq.slice(b))
  }
  return { doc: withSeqs(doc, next), moved: -d }
}

// ---------------------------------------------------------------------------
// Residues
// ---------------------------------------------------------------------------

/** Turn every residue in [c0, c1) of the given rows into a gap; columns stay put. */
export function eraseBlock(doc: AlnDoc, rowIds: Iterable<string>, c0: number, c1: number): AlnDoc {
  const ids = idSet(rowIds)
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (b <= a) return doc
  const next = new Map<string, string>()
  for (const r of doc.rows) {
    if (ids.has(r.id)) next.set(r.id, r.seq.slice(0, a) + gaps(b - a) + r.seq.slice(b))
  }
  return withSeqs(doc, next)
}

/** Cut [c0, c1) out of the given rows; what follows moves left. */
export function removeBlock(doc: AlnDoc, rowIds: Iterable<string>, c0: number, c1: number): AlnDoc {
  const ids = idSet(rowIds)
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (b <= a) return doc
  const next = new Map<string, string>()
  for (const r of doc.rows) {
    if (ids.has(r.id)) next.set(r.id, r.seq.slice(0, a) + r.seq.slice(b))
  }
  return withSeqs(doc, next)
}

/** Write `text` over a row from `col` on (typing in overwrite mode). Gaps in `text` are allowed. */
export function overwrite(doc: AlnDoc, rowId: string, col: number, text: string): AlnDoc {
  const t = cleanResidues(text, doc.kind)
  if (!t) return doc
  const row = doc.rows.find(r => r.id === rowId)
  if (!row) return doc
  const c = Math.max(0, Math.floor(col))
  const head = row.seq.length >= c ? row.seq.slice(0, c) : row.seq + gaps(c - row.seq.length)
  return withSeqs(doc, new Map([[rowId, head + t + row.seq.slice(c + t.length)]]))
}

/** Insert `text` into a row at `col` (typing in insert mode); the rest of the row moves right. */
export function insertText(doc: AlnDoc, rowId: string, col: number, text: string): AlnDoc {
  const t = cleanResidues(text, doc.kind)
  if (!t) return doc
  const row = doc.rows.find(r => r.id === rowId)
  if (!row) return doc
  const c = clampCol(doc, col)
  return withSeqs(doc, new Map([[rowId, row.seq.slice(0, c) + t + row.seq.slice(c)]]))
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/** Insert `n` gap-only columns before `col`. */
export function insertColumns(doc: AlnDoc, col: number, n: number): AlnDoc {
  if (n <= 0 || doc.rows.length === 0) return doc
  const c = clampCol(doc, col)
  // Columns added at the right edge would be trimmed straight away.
  if (c >= width(doc)) return doc
  return { ...doc, rows: doc.rows.map(r => ({ ...r, seq: r.seq.slice(0, c) + gaps(n) + r.seq.slice(c) })) }
}

/** Delete the columns flagged in `mask` (1 = delete) from every row. */
export function deleteColumns(doc: AlnDoc, mask: Uint8Array): AlnDoc {
  const w = width(doc)
  let any = false
  for (let c = 0; c < w; c++) if (mask[c]) { any = true; break }
  if (!any) return doc
  const rows = doc.rows.map(r => {
    let out = ''
    let runStart = 0
    for (let c = 0; c <= w; c++) {
      if (c === w || mask[c]) {
        if (c > runStart) out += r.seq.slice(runStart, c)
        runStart = c + 1
      }
    }
    return { ...r, seq: out }
  })
  return { ...doc, rows: squareUp(rows) }
}

/** Delete columns [c0, c1). */
export function deleteColumnRange(doc: AlnDoc, c0: number, c1: number): AlnDoc {
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (b <= a) return doc
  const mask = new Uint8Array(width(doc))
  mask.fill(1, a, b)
  return deleteColumns(doc, mask)
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * Add ungapped (or already gapped) rows at `at` (default: the end). They are
 * left-aligned and padded; aligning them properly is the engine's job.
 */
export function addRows(doc: AlnDoc, inputs: readonly RowInput[], at?: number): { doc: AlnDoc; ids: string[] } {
  if (inputs.length === 0) return { doc, ids: [] }
  const added = inputs.map((r): AlnRow => {
    const row: AlnRow = { id: newRowId(), name: r.name.trim() || 'Unnamed', seq: cleanResidues(r.seq, doc.kind) }
    if (r.source) row.source = r.source
    if (r.start !== undefined && r.start !== 1) row.start = r.start
    return row
  })
  const i = at === undefined ? doc.rows.length : Math.max(0, Math.min(doc.rows.length, at))
  const rows = [...doc.rows.slice(0, i), ...added, ...doc.rows.slice(i)]
  return { doc: { ...doc, rows: squareUp(rows) }, ids: added.map(r => r.id) }
}

export function removeRows(doc: AlnDoc, rowIds: Iterable<string>): AlnDoc {
  const ids = idSet(rowIds)
  const rows = doc.rows.filter(r => !ids.has(r.id))
  if (rows.length === doc.rows.length) return doc
  return {
    ...doc,
    rows: squareUp(rows),
    referenceId: doc.referenceId && ids.has(doc.referenceId) ? null : doc.referenceId,
  }
}

export function renameRow(doc: AlnDoc, rowId: string, name: string): AlnDoc {
  const n = name.trim()
  if (!n) return doc
  let changed = false
  const rows = doc.rows.map(r => {
    if (r.id !== rowId || r.name === n) return r
    changed = true
    return { ...r, name: n }
  })
  return changed ? { ...doc, rows } : doc
}

/** Set the number of a row's first residue (1-based). */
export function setRowStart(doc: AlnDoc, rowId: string, start: number): AlnDoc {
  const s = Math.round(start)
  if (!Number.isFinite(s)) return doc
  let changed = false
  const rows = doc.rows.map(r => {
    if (r.id !== rowId || (r.start ?? 1) === s) return r
    changed = true
    const next = { ...r }
    if (s === 1) delete next.start
    else next.start = s
    return next
  })
  return changed ? { ...doc, rows } : doc
}

/**
 * Move the given rows, keeping their order, so they sit before the row that
 * was at index `before` (rows.length moves them to the end).
 */
export function moveRows(doc: AlnDoc, rowIds: Iterable<string>, before: number): AlnDoc {
  const ids = idSet(rowIds)
  const moving = doc.rows.filter(r => ids.has(r.id))
  if (moving.length === 0) return doc
  const anchor = doc.rows.slice(Math.max(0, before)).find(r => !ids.has(r.id))
  const rest = doc.rows.filter(r => !ids.has(r.id))
  const at = anchor ? rest.indexOf(anchor) : rest.length
  const rows = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  if (rows.every((r, i) => r === doc.rows[i])) return doc
  return { ...doc, rows }
}

/** Put rows in a given order (by id). Unlisted rows keep their place at the end. */
export function orderRows(doc: AlnDoc, ids: readonly string[]): AlnDoc {
  const byId = new Map(doc.rows.map(r => [r.id, r]))
  const listed = ids.map(id => byId.get(id)).filter((r): r is AlnRow => !!r)
  const seen = new Set(listed)
  const rows = [...listed, ...doc.rows.filter(r => !seen.has(r))]
  if (rows.every((r, i) => r === doc.rows[i])) return doc
  return { ...doc, rows }
}

export function setReference(doc: AlnDoc, rowId: string | null): AlnDoc {
  const id = rowId && doc.rows.some(r => r.id === rowId) ? rowId : null
  return id === doc.referenceId ? doc : { ...doc, referenceId: id }
}

/** Reverse-complement the whole alignment (every row; the columns flip). DNA only. */
export function reverseComplementAll(doc: AlnDoc): AlnDoc {
  if (doc.kind !== 'dna' || doc.rows.length === 0) return doc
  const rows = doc.rows.map(r => {
    // Gaps survive the complement as gaps; everything else goes through the shared table.
    const parts = r.seq.split(GAP).map(p => rcPlain(p)).reverse()
    const next: AlnRow = { ...r, seq: parts.join(GAP) }
    if (r.source) next.source = { ...r.source, reversed: !r.source.reversed }
    if (next.source && !next.source.reversed) delete next.source.reversed
    return next
  })
  return { ...doc, rows }
}

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

export type JoinConflict = 'ambiguity' | 'first'

/**
 * Merge several rows into one, column by column: where only one row has a
 * residue it is kept; where they agree it is kept; where they disagree the
 * result is an ambiguity code (DNA) or 'X' (protein), or the first row's
 * residue with `conflict: 'first'`.
 *
 * The merged row takes the first row's place; the others are removed.
 * Returns the columns that disagreed so the caller can show them.
 */
export function joinRows(
  doc: AlnDoc, rowIds: Iterable<string>, opts: { name?: string; conflict?: JoinConflict } = {},
): { doc: AlnDoc; rowId: string | null; conflicts: number[] } {
  const ids = idSet(rowIds)
  const picked = doc.rows.filter(r => ids.has(r.id))
  if (picked.length < 2) return { doc, rowId: null, conflicts: [] }
  const w = width(doc)
  const conflictMode = opts.conflict ?? 'ambiguity'
  const conflicts: number[] = []
  let seq = ''
  for (let c = 0; c < w; c++) {
    let first = ''
    let bits = 0
    let clash = false
    for (const r of picked) {
      const ch = r.seq[c]
      if (ch === GAP) continue
      if (!first) first = ch
      else if (ch !== first) clash = true
      bits |= baseBits(ch)
    }
    if (!first) { seq += GAP; continue }
    if (!clash) { seq += first; continue }
    conflicts.push(c)
    if (conflictMode === 'first') seq += first
    else seq += doc.kind === 'dna' && bits ? codeForBits(bits) : 'X'
  }
  const head = picked[0]
  const merged: AlnRow = {
    id: newRowId(),
    name: opts.name?.trim() || picked.map(r => r.name).join(' + '),
    seq,
  }
  if (head.start !== undefined) merged.start = head.start
  const uids = new Set(picked.map(r => r.source?.uid))
  if (head.source && uids.size === 1) merged.source = head.source
  const rows: AlnRow[] = []
  for (const r of doc.rows) {
    if (r === head) rows.push(merged)
    else if (!ids.has(r.id)) rows.push(r)
  }
  const referenceId = doc.referenceId && ids.has(doc.referenceId) ? merged.id : doc.referenceId
  return { doc: { ...doc, rows: squareUp(rows), referenceId }, rowId: merged.id, conflicts }
}

/**
 * Join two alignments end to end, e.g. two genes for the same taxa. Rows are
 * matched by name (the default) or by position; a row missing from one side
 * is filled with gaps for that stretch. Both must be the same kind.
 */
export function concatenate(a: AlnDoc, b: AlnDoc, match: 'name' | 'order' = 'name', origin?: AlnOrigin): AlnDoc {
  if (a.kind !== b.kind) throw new Error('Cannot join a DNA alignment to a protein alignment')
  const wa = width(a)
  const wb = width(b)
  const rows: AlnRow[] = []
  const usedB = new Set<AlnRow>()
  const bByName = new Map<string, AlnRow>()
  for (const r of b.rows) if (!bByName.has(r.name)) bByName.set(r.name, r)
  a.rows.forEach((ra, i) => {
    const rb = match === 'name' ? bByName.get(ra.name) : b.rows[i]
    if (rb) usedB.add(rb)
    rows.push({ ...ra, seq: ra.seq + (rb ? rb.seq : gaps(wb)) })
  })
  for (const rb of b.rows) {
    if (!usedB.has(rb)) rows.push({ ...rb, id: newRowId(), seq: gaps(wa) + rb.seq })
  }
  return {
    kind: a.kind,
    rows: squareUp(rows),
    referenceId: a.referenceId,
    origin: origin ?? { method: 'manual', detail: 'Joined alignments', at: Date.now() },
  }
}

/**
 * Put a realigned block back: rows `rowIds` get `aligned[i]` in place of
 * their columns [c0, c1). If the block grew, the other rows get gap columns
 * at its end; if it shrank, the realigned rows are padded with trailing gaps
 * (or, when every row was realigned, the block simply gets narrower).
 */
export function replaceRegion(
  doc: AlnDoc, rowIds: readonly string[], c0: number, c1: number, aligned: readonly string[],
): AlnDoc {
  const a = clampCol(doc, c0)
  const b = clampCol(doc, c1)
  if (aligned.length !== rowIds.length) throw new Error('Realigned rows do not match the selection')
  const newW = aligned[0]?.length ?? 0
  const all = rowIds.length === doc.rows.length
  const regionW = all ? newW : Math.max(newW, b - a)
  const byId = new Map(rowIds.map((id, i) => [id, aligned[i]]))
  const rows = doc.rows.map(r => {
    const mid = byId.get(r.id)
    const block = mid !== undefined
      ? mid + gaps(regionW - mid.length)
      : r.seq.slice(a, b) + gaps(regionW - (b - a))
    return { ...r, seq: r.seq.slice(0, a) + block + r.seq.slice(b) }
  })
  return { ...doc, rows: squareUp(rows) }
}

/** A row's residues without gaps, optionally only within columns [c0, c1). */
export function extractRow(doc: AlnDoc, rowId: string, c0 = 0, c1 = Infinity): string {
  const row = doc.rows.find(r => r.id === rowId)
  if (!row) return ''
  return ungapped(row.seq.slice(Math.max(0, c0), Math.min(row.seq.length, c1)))
}
