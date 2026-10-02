/**
 * Edits to a contig. Pure: each takes a document and returns a new one (or
 * the same one when nothing changes), and the store records it as a named
 * undo step. Edits change the contig's copies of the reads, never the reads.
 */

import type { ContigDoc, ContigRow } from './types'

/** Set the base (or '-') of a row at a column. Outside the row's span nothing happens. */
export function setCell(doc: ContigDoc, rowId: string, col: number, ch: string): ContigDoc {
  const rows = doc.rows.map(r => {
    if (r.id !== rowId) return r
    const k = col - r.start
    if (k < 0 || k >= r.seq.length || r.seq[k] === ch) return r
    // Only the base changes; src and qual stay as assembled, so a revert is exact.
    // Edited cells count as confident in the consensus (see computeConsensus).
    return { ...r, seq: r.seq.slice(0, k) + ch + r.seq.slice(k + 1) }
  })
  return rows.some((r, i) => r !== doc.rows[i]) ? { ...doc, rows } : doc
}

/** Set several cells at once (one undo step), e.g. a column made to agree. */
export function setCells(doc: ContigDoc, cells: { rowId: string; col: number; ch: string }[]): ContigDoc {
  let d = doc
  for (const c of cells) d = setCell(d, c.rowId, c.col, c.ch)
  return d
}

/** Insert `count` gap columns before `at`, in the reference and every row that spans it. */
export function insertColumns(doc: ContigDoc, at: number, count = 1): ContigDoc {
  if (count <= 0) return doc
  const gaps = '-'.repeat(count)
  const rows = doc.rows.map(r => {
    if (at <= r.start) return { ...r, start: r.start + count }
    const k = at - r.start
    if (k >= r.seq.length) return r
    return {
      ...r,
      seq: r.seq.slice(0, k) + gaps + r.seq.slice(k),
      orig: r.orig.slice(0, k) + gaps + r.orig.slice(k),
      src: [...r.src.slice(0, k), ...new Array(count).fill(-1), ...r.src.slice(k)],
      qual: [...r.qual.slice(0, k), ...new Array(count).fill(0), ...r.qual.slice(k)],
    }
  })
  const reference = doc.reference
    ? { ...doc.reference, seq: doc.reference.seq.slice(0, at) + gaps + doc.reference.seq.slice(at) }
    : null
  return { ...doc, width: doc.width + count, rows, reference }
}

/**
 * Delete columns [c0, c1) everywhere. Reference bases there are not deleted
 * from the reference itself: columns holding reference bases are skipped.
 */
export function deleteColumns(doc: ContigDoc, c0: number, c1: number): ContigDoc {
  const kill = new Set<number>()
  for (let c = Math.max(0, c0); c < Math.min(doc.width, c1); c++) {
    if (doc.reference && doc.reference.seq[c] !== '-') continue
    kill.add(c)
  }
  if (kill.size === 0) return doc
  const before = (c: number) => { let k = 0; for (const x of kill) if (x < c) k++; return k }
  const rows = doc.rows.map(r => {
    let seq = ''
    let orig = ''
    const src: number[] = []
    const qual: number[] = []
    for (let k = 0; k < r.seq.length; k++) {
      if (kill.has(r.start + k)) continue
      seq += r.seq[k]
      orig += r.orig[k]
      src.push(r.src[k])
      qual.push(r.qual[k])
    }
    return { ...r, start: r.start - before(r.start), seq, orig, src, qual }
  }).filter(r => r.seq.replace(/-/g, '').length > 0)
  const reference = doc.reference
    ? { ...doc.reference, seq: [...doc.reference.seq].filter((_, c) => !kill.has(c)).join('') }
    : null
  return { ...doc, width: doc.width - kill.size, rows, reference }
}

/** Drop columns where every row and the reference have a gap or nothing. */
export function stripGapColumns(doc: ContigDoc): ContigDoc {
  const used = new Uint8Array(doc.width)
  if (doc.reference) for (let c = 0; c < doc.width; c++) if (doc.reference.seq[c] !== '-') used[c] = 1
  for (const r of doc.rows) for (let k = 0; k < r.seq.length; k++) if (r.seq[k] !== '-') used[r.start + k] = 1
  const empty: number[] = []
  for (let c = 0; c < doc.width; c++) if (!used[c]) empty.push(c)
  if (empty.length === 0) return doc
  let d = doc
  // Right to left so earlier columns keep their index.
  for (let i = empty.length - 1; i >= 0; i--) d = deleteColumns(d, empty[i], empty[i] + 1)
  return d
}

export function removeRows(doc: ContigDoc, ids: readonly string[]): ContigDoc {
  const gone = new Set(ids)
  const rows = doc.rows.filter(r => !gone.has(r.id))
  return rows.length === doc.rows.length ? doc : stripGapColumns({ ...doc, rows })
}

/** Put every row's edits back to the bases as assembled. */
export function revertRow(doc: ContigDoc, rowId: string): ContigDoc {
  const rows = doc.rows.map(r => (r.id !== rowId || r.seq === r.orig ? r : revertCells(r, 0, r.seq.length)))
  return rows.some((r, i) => r !== doc.rows[i]) ? { ...doc, rows } : doc
}

function revertCells(r: ContigRow, k0: number, k1: number): ContigRow {
  let seq = r.seq
  for (let k = k0; k < k1; k++) if (seq[k] !== r.orig[k]) seq = seq.slice(0, k) + r.orig[k] + seq.slice(k + 1)
  return { ...r, seq }
}

/** Cell edits in the contig: positions where a row differs from how it was assembled. */
export function editedCells(doc: ContigDoc): number {
  let k = 0
  for (const r of doc.rows) for (let i = 0; i < r.seq.length; i++) if (r.seq[i] !== r.orig[i]) k++
  return k
}
