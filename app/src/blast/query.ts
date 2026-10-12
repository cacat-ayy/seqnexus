/**
 * Placing a BLAST search's hits back on the document it was run from, and
 * numbering its alignments.
 *
 * A query is one stretch of the document, two for a selection across the
 * origin of a circular sequence, or the translation of a coding feature's
 * parts. Hits come back in query coordinates, so a search keeps its segments
 * and a fingerprint of their bases: a hit is placed on the document only
 * while that document still holds the same bases there.
 */

import type { Sequence } from '../models/Sequence'
import type { Strand } from '../models/Annotation'
import { translatesHit, translatesQuery, type BlastHsp, type BlastQuery } from './types'

/** FNV-1a over the bases, with the length: enough to tell an edited query from the one searched. */
export function fingerprint(bases: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bases.length; i++) {
    h ^= bases.charCodeAt(i) & 0xdf // case-insensitive: soft-masked bases are the same bases
    h = Math.imul(h, 0x01000193)
  }
  return `${bases.length}:${(h >>> 0).toString(16)}`
}

/** The query's bases: its segments of the sequence, joined in query order. */
export function queryBases(seq: Pick<Sequence, 'basesIn'>, segments: [number, number][]): string {
  return segments.map(([s, e]) => seq.basesIn(s, e)).join('')
}

/** Whether a search's hits can go on its document, or why they cannot. */
export type Placement = { ok: true } | { ok: false; reason: string }

/**
 * A search is kept with the document it was run on, so the only question is
 * whether the query still holds the bases that were searched: an edit
 * elsewhere that keeps the length is harmless, anything else would shift
 * every hit.
 */
export function placementOf(query: BlastQuery, seq: Pick<Sequence, 'length' | 'basesIn'>): Placement {
  if (query.segments.length === 0) {
    return { ok: false, reason: 'This result came from a file whose query could not be matched to the sequence, so its hits are not placed on it.' }
  }
  const edited = { ok: false as const, reason: 'The sequence has been edited since this search, so its hits no longer line up with it.' }
  if (seq.length !== query.seqLength) return edited
  if (query.segments.some(([s, e]) => s < 0 || e > seq.length || s > e)) return edited
  if (fingerprint(queryBases(seq, query.segments)) !== query.fingerprint) return edited
  return { ok: true }
}

/** The document position of a 0-based query position. */
function toDoc(segments: [number, number][], q: number): number {
  let offset = q
  for (const [s, e] of segments) {
    if (offset < e - s) return s + offset
    offset -= e - s
  }
  // Past the end: the query's last position (a report never says this).
  const [, e] = segments[segments.length - 1]
  return e - 1
}

/**
 * A 1-based inclusive query range as an annotation's start and end on the
 * document (0-based, end exclusive). A range across the joint of a query
 * that crosses the origin comes out with start > end: a feature across the
 * origin, the way annotations store one.
 */
export function queryRangeToDoc(segments: [number, number][], from: number, to: number): { start: number; end: number } {
  return { start: toDoc(segments, from - 1), end: toDoc(segments, to - 1) + 1 }
}

/**
 * A hit's 1-based inclusive query range on the document, for any query.
 *
 * A translation's query positions are residues: residue r covers coding
 * bases 3(r-1) to 3r-1, which run through the coding parts in sequence order
 * on the plus strand, and from the far end on the minus strand (the coding
 * sequence is then the reverse complement of the parts joined). A range
 * across an intron keeps the span over it; across the origin it wraps.
 */
export function hitRangeOnDoc(query: BlastQuery, from: number, to: number): { start: number; end: number } {
  if (!query.translation) return queryRangeToDoc(query.segments, from, to)
  const total = query.segments.reduce((n, [s, e]) => n + e - s, 0)
  const c1 = (from - 1) * 3
  const c2 = Math.min(to * 3, total) - 1
  if (query.translation.strand > 0) {
    return { start: toDoc(query.segments, c1), end: toDoc(query.segments, c2) + 1 }
  }
  return { start: toDoc(query.segments, total - 1 - c2), end: toDoc(query.segments, total - 1 - c1) + 1 }
}

/**
 * The parts of a document range the query holds, in query coordinates
 * (0-based, half-open, in query order): how a feature of the document is
 * drawn over the query's axis. `start > end` runs across the origin. A
 * translation's axis counts residues, which a feature does not map onto
 * simply, so it gets none.
 */
export function docRangeToQuery(query: BlastQuery, start: number, end: number): [number, number][] {
  if (query.translation) return []
  const pieces: [number, number][] = start <= end ? [[start, end]] : [[start, query.seqLength], [0, end]]
  const out: [number, number][] = []
  let offset = 0
  for (const [s, e] of query.segments) {
    for (const [a, b] of pieces) {
      const lo = Math.max(s, a), hi = Math.min(e, b)
      if (lo < hi) out.push([offset + lo - s, offset + hi - s])
    }
    offset += e - s
  }
  // Pieces of one feature that meet across the joint of the query become one.
  out.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** The strand of the feature a hit becomes: a translation's own strand, else as annotationStrand. */
export function hitStrandOnDoc(query: BlastQuery, program: string, hsp: Pick<BlastHsp, 'queryStrand' | 'hitStrand'>): Strand {
  return query.translation ? query.translation.strand : annotationStrand(program, hsp)
}

/**
 * The strand of the feature a hit becomes on the query. A translated query
 * (blastx, tblastx) reads the strand of its frame. A blastn hit on the minus
 * strand of its record matches the query's reverse complement, so the
 * feature points the other way. A protein query has no strand to speak of
 * and keeps the forward one.
 */
export function annotationStrand(program: string, hsp: Pick<BlastHsp, 'queryStrand' | 'hitStrand'>): Strand {
  if (translatesQuery(program)) return hsp.queryStrand
  if (program === 'blastn' || program === 'megablast') return (hsp.queryStrand * hsp.hitStrand) as Strand
  return 1
}

/** One line of an alignment, with the first and last positions each side covers. */
export interface AlignmentLine {
  qseq: string
  mid: string
  hseq: string
  qStart: number
  qEnd: number
  hStart: number
  hEnd: number
}

/**
 * Cut an HSP into lines of `width` columns, numbered the way NCBI numbers
 * them. A side on the minus strand counts down from its far end. A
 * translated side covers three bases per residue: a line starts at the first
 * base of its first codon and ends at the last base of its last codon.
 * Gaps take no positions; a line that is all gap on one side shows that
 * side's last position before it.
 */
export function alignmentLines(hsp: BlastHsp, program: string, width = 60): AlignmentLine[] {
  const qStep = translatesQuery(program) ? 3 : 1
  const hStep = translatesHit(program) ? 3 : 1
  let q = hsp.queryStrand < 0 ? hsp.queryTo : hsp.queryFrom
  let h = hsp.hitStrand < 0 ? hsp.hitTo : hsp.hitFrom
  const lines: AlignmentLine[] = []
  for (let i = 0; i < hsp.qseq.length; i += width) {
    const qseq = hsp.qseq.slice(i, i + width)
    const hseq = hsp.hseq.slice(i, i + width)
    const [qStart, qEnd, qNext] = span(q, residues(qseq), qStep, hsp.queryStrand)
    const [hStart, hEnd, hNext] = span(h, residues(hseq), hStep, hsp.hitStrand)
    lines.push({ qseq, mid: hsp.midline.slice(i, i + width), hseq, qStart, qEnd, hStart, hEnd })
    q = qNext
    h = hNext
  }
  return lines
}

function residues(s: string): number {
  let n = 0
  for (const c of s) if (c !== '-') n++
  return n
}

/** [first, last, next line's first] for `n` residues from `at`, `step` bases each, on `strand`. */
function span(at: number, n: number, step: number, strand: 1 | -1): [number, number, number] {
  const next = at + strand * n * step
  if (n === 0) return [at - strand, at - strand, at]
  return [at, next - strand, next]
}
