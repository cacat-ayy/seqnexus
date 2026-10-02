/**
 * Building a contig's column layout one aligned read at a time.
 *
 * Every read is aligned to a backbone: the reference, or for de novo
 * assembly the consensus of what is already laid out. Backbone positions
 * sit in columns; between two of them there may already be insertion
 * columns from earlier reads. A read with more inserted bases there than
 * there are columns gets new columns, which every other row (and the
 * reference) receives as gaps. Inserted bases are placed left-aligned in
 * their run of columns.
 */

import type { PairAlignment } from './align'
import type { AssemblyInput, ContigDoc, ContigReference, ContigRow } from './types'
import { reverseComplement } from '../models/complement'

/** Mutable working copy of a contig while it is being built. */
export interface Pileup {
  width: number
  rows: ContigRow[]
  /** Reference across all columns, or null (de novo). */
  ref: string[] | null
}

export function emptyPileup(reference: string | null): Pileup {
  return { width: reference ? reference.length : 0, rows: [], ref: reference ? [...reference] : null }
}

/** Insert `count` all-gap columns before column `at`. */
export function insertColumns(p: Pileup, at: number, count: number): void {
  if (count <= 0) return
  p.width += count
  if (p.ref) p.ref.splice(at, 0, ...new Array(count).fill('-'))
  p.rows = p.rows.map(r => {
    if (at <= r.start) return { ...r, start: r.start + count }
    const k = at - r.start
    if (k >= r.seq.length) return r
    const gaps = '-'.repeat(count)
    return {
      ...r,
      seq: r.seq.slice(0, k) + gaps + r.seq.slice(k),
      orig: r.orig.slice(0, k) + gaps + r.orig.slice(k),
      src: [...r.src.slice(0, k), ...new Array(count).fill(-1), ...r.src.slice(k)],
      qual: [...r.qual.slice(0, k), ...new Array(count).fill(0), ...r.qual.slice(k)],
    }
  })
}

/** The read as aligned: oriented bases with their trace indices and qualities. */
export interface OrientedRead {
  input: AssemblyInput
  reversed: boolean
  seq: string
  qual: number[]
  src: number[]
}

export function orient(input: AssemblyInput, reversed: boolean): OrientedRead {
  if (!reversed) return { input, reversed, seq: input.seq, qual: input.qual, src: input.src }
  return {
    input, reversed,
    seq: reverseComplement(input.seq),
    qual: [...input.qual].reverse(),
    src: [...input.src].reverse(),
  }
}

/**
 * Lay out one read aligned to the backbone. `colOf[b]` is the column of
 * backbone position b (strictly increasing). Read bases hanging off either
 * end of the backbone (de novo overlaps) extend the contig.
 */
export function addAligned(p: Pileup, read: OrientedRead, aln: PairAlignment, colOf: number[], rowId: string): void {
  const ops = aln.ops
  let leadIns = 0
  while (leadIns < ops.length && ops[leadIns] === 'I') leadIns++
  let tailIns = 0
  while (tailIns < ops.length - leadIns && ops[ops.length - 1 - tailIns] === 'I') tailIns++
  const core = ops.slice(leadIns, ops.length - tailIns)
  if (core.length === 0) return

  // Read bases before the first aligned backbone position (clipped overhang
  // plus leading inserts), placed right against it; and after the last one,
  // placed right after it.
  const lead = aln.qStart + leadIns
  const trail = tailIns + (read.seq.length - aln.qEnd)

  // 1. Inserted runs inside the alignment, keyed by the backbone position they precede.
  const insertsBefore = new Map<number, number>()
  let b = aln.tStart
  let run = 0
  for (const op of core) {
    if (op === 'I') { run++; continue }
    if (run > 0) { insertsBefore.set(b, run); run = 0 }
    b++
  }
  const firstB = aln.tStart
  const lastB = b - 1

  // 2. Make room, right to left so earlier positions stay put while we work.
  const cols = [...colOf]
  const shiftFrom = (pos: number, by: number) => { for (let k = pos; k < cols.length; k++) cols[k] += by }
  const nextColAfter = (pos: number) => (pos + 1 < cols.length ? cols[pos + 1] : p.width)
  if (trail > 0) {
    const room = nextColAfter(lastB) - cols[lastB] - 1
    if (trail > room) {
      const add = trail - room
      insertColumns(p, cols[lastB] + 1 + room, add)
      shiftFrom(lastB + 1, add)
    }
  }
  for (const [pos, count] of [...insertsBefore.entries()].sort((x, y) => y[0] - x[0])) {
    const room = cols[pos] - cols[pos - 1] - 1
    if (count > room) {
      const add = count - room
      insertColumns(p, cols[pos], add)
      shiftFrom(pos, add)
    }
  }
  if (lead > 0) {
    const room = cols[firstB] - (firstB > 0 ? cols[firstB - 1] + 1 : 0)
    if (lead > room) {
      const add = lead - room
      insertColumns(p, cols[firstB], add)
      shiftFrom(firstB, add)
    }
  }

  // 3. Write the row.
  const seq: string[] = []
  const qual: number[] = []
  const src: number[] = []
  const put = (qi: number) => { seq.push(read.seq[qi]); qual.push(read.qual[qi] ?? 0); src.push(read.src[qi] ?? -2) }
  const gap = () => { seq.push('-'); qual.push(0); src.push(-1) }
  const start = cols[firstB] - lead
  let qi = 0
  while (qi < lead) put(qi++)
  let col = cols[firstB]
  b = firstB
  let pending = 0
  for (const op of core) {
    if (op === 'I') { pending++; continue }
    // Inserted bases sit left-aligned after the previous backbone column.
    for (; pending > 0; pending--) { put(qi++); col++ }
    while (col < cols[b]) { gap(); col++ }
    if (op === 'M') put(qi++)
    else gap()
    col++
    b++
  }
  while (qi < read.seq.length) put(qi++)

  const s = seq.join('')
  p.rows.push({
    id: rowId,
    readId: read.input.readId,
    name: read.input.name,
    reversed: read.reversed,
    start,
    seq: s,
    orig: s,
    src,
    qual,
  })
  if (start + s.length > p.width) p.width = start + s.length
}

/** Columns that hold a backbone position: reference letters, or (de novo) consensus letters. */
export function backboneColumns(seqAcross: readonly string[]): { bases: string; colOf: number[] } {
  let bases = ''
  const colOf: number[] = []
  for (let c = 0; c < seqAcross.length; c++) {
    const ch = seqAcross[c]
    if (ch && ch !== '-' && ch !== ' ') { bases += ch; colOf.push(c) }
  }
  return { bases, colOf }
}

export function toDoc(p: Pileup, method: ContigDoc['method'], reference: Omit<ContigReference, 'seq'> | null): ContigDoc {
  return {
    method,
    reference: reference && p.ref ? { ...reference, seq: p.ref.join('') } : null,
    width: p.width,
    rows: p.rows,
  }
}
