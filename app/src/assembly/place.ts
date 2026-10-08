/**
 * Changing one read inside an existing contig: its trimmed ends, and
 * placing it again with a different trim.
 *
 * A read goes into an assembly trimmed, and the contig keeps only the bases
 * inside the trim. The rest of the read is still in its trace: rowClips
 * finds a row's trimmed-off bases there, so the contig can show them faded
 * beyond the row's ends, as Geneious shows soft-trimmed regions.
 *
 * Trimming a row further needs no alignment: its bases past the cut are
 * dropped and the rest keep their columns (and their edits). Extending it
 * places the read again: its row is taken out (with any column only it
 * needed), the read with its new trim is aligned to the contig's backbone
 * and laid out in the columns already there, adding columns where it has
 * more inserted bases than the others, and the row goes back where it was
 * in the list. Every other row, and every edit in them, stays as it is. The
 * read's own trim is not changed: the contig keeps its own copy of the
 * reads, as it always has.
 *
 * The backbone is the reference, for a contig mapped to one: the read is
 * aligned end to end (as mapping does), so bases that do not belong lower
 * its identity, and below the assembly's lowest identity it is refused with
 * the figure. De novo, the backbone is the contig's consensus, and the read
 * must line up with it to one of its ends or the consensus's: an end that
 * matches nothing would otherwise be laid out as an overhang in the middle
 * of the contig.
 */

import { alignBanded, bandAround, bestDiagonal, GLOCAL, kmerIndex, OVERLAP, seedBothStrands, type PairAlignment } from './align'
import { computeConsensus, DEFAULT_CONSENSUS } from './consensus'
import { removeRows, stripGapColumns } from './edit'
import { addAligned, backboneColumns, orient, type Pileup } from './pileup'
import type { AssemblyInput, AssemblySettings, ContigDoc, ContigRow } from './types'
import { reverseComplement } from '../models/complement'

/** Bases a de novo alignment may stop short of an end and still count as reaching it. */
const END_SLACK = 8

export type PlaceResult = { doc: ContigDoc } | { reason: string }

/**
 * A row's extent in its read: the first and last called bases it holds, in
 * the read's forward direction. Null when it holds none (typed bases only).
 */
export function rowCalledRange(row: ContigRow): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const s of row.src) if (s >= 0) { if (s < lo) lo = s; if (s > hi) hi = s }
  return lo <= hi ? [lo, hi] : null
}

/** One trimmed-off base, as shown beside its row. */
export interface ClipBase {
  ch: string
  /** Its called-base index in the read (-2 for a base typed into the read). */
  src: number
}

/**
 * A row's trimmed-off bases, in contig orientation: `left` reads left to
 * right up to the row's start, `right` from its end on. `full` is the whole
 * read as an assembly input (readInput with the trim [0, length]).
 */
export function rowClips(row: ContigRow, full: AssemblyInput): { left: ClipBase[]; right: ClipBase[] } | null {
  const range = rowCalledRange(row)
  if (!range) return null
  const i0 = full.src.indexOf(range[0])
  const i1 = full.src.lastIndexOf(range[1])
  if (i0 < 0 || i1 < i0) return null
  const take = (a: number, b: number): ClipBase[] => {
    const out: ClipBase[] = []
    for (let i = a; i < b; i++) out.push({ ch: full.seq[i], src: full.src[i] })
    return out
  }
  const before = take(0, i0)
  const after = take(i1 + 1, full.seq.length)
  if (!row.reversed) return { left: before, right: after }
  // Reverse complemented in the contig: the read's end is on the left.
  const flip = (xs: ClipBase[]) => xs.reverse().map(b => ({ ...b, ch: reverseComplement(b.ch) }))
  return { left: flip(after), right: flip(before) }
}

/**
 * Columns to show a row's trimmed-off bases in: outward from its ends, one
 * base a column, skipping the reference's gap columns (bases other reads
 * inserted). Past the contig's edges the columns go on (below 0, and from
 * its width up): the trimmed ends of the outermost reads are the ones most
 * worth extending, so the view keeps a margin for them. Where the trimmed
 * bases truly align is only known once the read is placed again; this
 * shows how much is there and roughly where.
 */
export function clipColumns(doc: ContigDoc, row: ContigRow, clips: { left: ClipBase[]; right: ClipBase[] }): { left: (ClipBase & { col: number })[]; right: (ClipBase & { col: number })[] } {
  // Inside the contig, a column the reference holds a gap in is another read's insertion.
  const usable = (c: number) => c < 0 || c >= doc.width || !doc.reference || doc.reference.seq[c] !== '-'
  const left: (ClipBase & { col: number })[] = []
  let c = row.start - 1
  for (let i = clips.left.length - 1; i >= 0; i--) {
    while (!usable(c)) c--
    left.push({ ...clips.left[i], col: c-- })
  }
  const right: (ClipBase & { col: number })[] = []
  c = row.start + row.seq.length
  for (let i = 0; i < clips.right.length; i++) {
    while (!usable(c)) c++
    right.push({ ...clips.right[i], col: c++ })
  }
  return { left: left.reverse(), right }
}

/**
 * The trim, in the read's own forward direction (called-base indices,
 * half-open), that extends the row to take in the trimmed-off read base
 * `src`, keeping its other end.
 */
export function extendedTrim(row: ContigRow, src: number): [number, number] | null {
  const range = rowCalledRange(row)
  if (!range || src < 0) return null
  return [Math.min(range[0], src), Math.max(range[1] + 1, src + 1)]
}

/**
 * Cut a row at column `col`, keeping that column and what the contig shows
 * after it (`keep: 'from'`) or before it (`keep: 'to'`). No alignment: the
 * bases kept stay in their columns, with their edits; gaps left at the new
 * end go, and so does any column no row or reference base needs any more.
 * Null when the cut would leave the row no base.
 */
export function cutRow(doc: ContigDoc, rowId: string, col: number, keep: 'from' | 'to'): ContigDoc | null {
  const row = doc.rows.find(r => r.id === rowId)
  if (!row) return null
  let a = keep === 'from' ? col - row.start : 0
  let b = keep === 'to' ? col - row.start + 1 : row.seq.length
  a = Math.max(0, a)
  b = Math.min(row.seq.length, b)
  while (a < b && row.seq[a] === '-') a++
  while (b > a && row.seq[b - 1] === '-') b--
  if (b <= a) return null
  if (a === 0 && b === row.seq.length) return doc
  const cut: ContigRow = {
    ...row,
    start: row.start + a,
    seq: row.seq.slice(a, b),
    orig: row.orig.slice(a, b),
    src: row.src.slice(a, b),
    qual: row.qual.slice(a, b),
  }
  return stripGapColumns({ ...doc, rows: doc.rows.map(r => (r.id === rowId ? cut : r)) })
}

/**
 * Lay a read into an existing contig as row `rowId`. With `reversed`, the
 * read keeps that orientation (placing it again); otherwise the strand it
 * matches is used.
 */
export function placeRead(doc: ContigDoc, input: AssemblyInput, s: AssemblySettings, rowId: string, reversed?: boolean): PlaceResult {
  if (input.seq.length < 20) return { reason: 'Too short' }
  const d = doc.reference?.circular ? withExtension(doc, input.seq.length + 50) : doc
  const pile: Pileup = { width: d.width, rows: [...d.rows], ref: d.reference ? [...d.reference.seq] : null }
  const backbone = d.reference ? backboneColumns(pile.ref!) : backboneColumns([...computeConsensus(d, DEFAULT_CONSENSUS).bases])
  if (backbone.bases.length < s.k) return { reason: 'The contig is too short to place a read in' }
  const index = kmerIndex(backbone.bases.toUpperCase(), s.k)

  let strand: boolean
  let diag: number
  if (reversed === undefined) {
    const hit = seedBothStrands(input.seq, index, s.k, 3)
    if (!hit) return { reason: d.reference ? 'No match to the reference' : 'No match to the contig' }
    strand = hit.reversed
    diag = hit.seed.diag
  } else {
    const seed = bestDiagonal(reversed ? reverseComplement(input.seq) : input.seq, index, s.k)
    if (!seed) return { reason: d.reference ? 'No match to the reference' : 'No match to the contig' }
    strand = reversed
    diag = seed.diag
  }
  const read = orient(input, strand)
  let aln: PairAlignment | null = alignBanded(read.seq, backbone.bases.toUpperCase(), d.reference ? GLOCAL : OVERLAP, bandAround(diag, read.seq.length))
  const pct = (x: number) => Math.round(x * 100)
  if (!aln || aln.identity < s.minIdentity) {
    return { reason: `Only ${pct(aln?.identity ?? 0)}% identical to the ${d.reference ? 'reference' : 'contig'} (needs ${pct(s.minIdentity)}%)` }
  }
  if (!d.reference) {
    const reachesStart = aln.qStart <= END_SLACK || aln.tStart <= END_SLACK
    const reachesEnd = read.seq.length - aln.qEnd <= END_SLACK || backbone.bases.length - aln.tEnd <= END_SLACK
    if (!reachesStart || !reachesEnd) return { reason: 'Part of the read does not line up with the contig' }
    if (aln.tEnd - aln.tStart < s.minOverlap) return { reason: 'Too little of the read overlaps the contig' }
  }
  const L = d.reference?.length ?? 0
  // A read lying wholly in the circular extension also lies at the start: use that copy.
  if (d.reference?.circular && aln.tStart >= L) aln = { ...aln, tStart: aln.tStart - L, tEnd: aln.tEnd - L }
  addAligned(pile, read, aln, backbone.colOf, rowId)
  const placed: ContigDoc = {
    ...d,
    width: pile.width,
    rows: pile.rows,
    reference: d.reference && pile.ref ? { ...d.reference, seq: pile.ref.join('') } : null,
  }
  return { doc: d.reference?.circular ? trimExtension(placed) : placed }
}

/**
 * Place a row's read again with a different trim (`input`, the read with
 * that trim). The row keeps its id, orientation and place in the list; its
 * edits in the contig are not carried over, since its bases are laid out
 * afresh.
 */
export function replaceRow(doc: ContigDoc, rowId: string, input: AssemblyInput, s: AssemblySettings): PlaceResult {
  const at = doc.rows.findIndex(r => r.id === rowId)
  if (at < 0) return { reason: 'The read is no longer in the contig' }
  const old = doc.rows[at]
  if (doc.rows.length === 1) {
    // Alone in a de novo contig: it is the contig.
    if (!doc.reference) {
      const read = orient(input, old.reversed)
      const row: ContigRow = { ...old, start: 0, seq: read.seq, orig: read.seq, src: [...read.src], qual: [...read.qual] }
      return { doc: { ...doc, width: read.seq.length, rows: [row] } }
    }
  }
  const without = doc.rows.length === 1 ? { ...doc, rows: [] } : removeRows(doc, [rowId])
  const placed = placeRead(without, input, s, rowId, old.reversed)
  if ('reason' in placed) return placed
  const rows = placed.doc.rows.filter(r => r.id !== rowId)
  const row = placed.doc.rows.find(r => r.id === rowId)!
  rows.splice(Math.min(at, rows.length), 0, { ...row, name: old.name, readId: old.readId })
  return { doc: { ...placed.doc, rows } }
}

/** A circular contig's reference extended past its end until it holds at least `extra` bases of the start again. */
function withExtension(doc: ContigDoc, extra: number): ContigDoc {
  const ref = doc.reference!
  const bases = ref.seq.replace(/-/g, '')
  const want = ref.length + Math.min(ref.length, extra)
  if (bases.length >= want) return doc
  const start = bases.slice(0, ref.length)
  let add = ''
  for (let p = bases.length; p < want; p++) add += start[p % ref.length]
  return { ...doc, width: doc.width + add.length, reference: { ...ref, seq: ref.seq + add } }
}

/** Drop circular-extension columns past the reference's end that no read reaches. */
function trimExtension(doc: ContigDoc): ContigDoc {
  const ref = doc.reference!
  let reach = 0
  for (const r of doc.rows) reach = Math.max(reach, r.start + r.seq.length)
  // The column after the reference's last base.
  let n = 0
  let endCol = doc.width
  for (let c = 0; c < doc.width; c++) if (ref.seq[c] !== '-' && ++n === ref.length) { endCol = c + 1; break }
  const keep = Math.max(endCol, reach)
  if (keep >= doc.width) return doc
  return { ...doc, width: keep, reference: { ...ref, seq: ref.seq.slice(0, keep) } }
}
