/**
 * A contig against the sequence it was expected to be (the designed
 * plasmid, the reference amplicon): which strand it is on, where its start
 * is on the expected circle, and every difference between the two.
 *
 * 1. Anchors: every 15-mer of the expected sequence that occurs at most
 *    four times is indexed; each 15-mer of the contig, read forwards and as
 *    its reverse complement, votes for the diagonal it lands on (expected
 *    position minus contig position, around the circle when the expected
 *    sequence is circular). The strand and diagonal with the most votes win.
 * 2. Rotation: a circular contig is turned (and reverse complemented when
 *    it lies on the other strand) so its start lines up with the expected
 *    sequence's start. A linear contig is left as it is, and a circular
 *    expected sequence is turned instead, so the contig lies inside it.
 * 3. Alignment: the turned contig is aligned to the expected sequence with
 *    affine gaps (assembly/align.ts), end to end for a circular contig, with
 *    free ends on the expected side for a linear one. Only a band of
 *    diagonals is filled in: all those the anchors voted for (so an 800 bp
 *    deletion is spanned), with a margin.
 * 4. Differences: mismatched columns are substitutions, runs of gaps
 *    deletions or insertions, all in expected coordinates, ready for the
 *    variant describer (protein effect, repeats) and clone verification.
 *
 * Lift-over (liftFeatures) moves the expected sequence's features onto the
 * turned contig through the alignment: each end goes to the contig base it
 * aligns to, or the nearest one inside the feature when it was deleted.
 */

import { alignBanded, type AlignEnds } from '../../assembly/align'
import type { AnnotationData } from '../../models/Annotation'

export const ANCHOR_K = 15
/** The band, past the anchors' diagonals, on either side. */
const BAND_MARGIN = 60
/** Most cells the banded alignment may fill. */
export const MAX_CELLS = 60_000_000

const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
export const revcomp = (s: string) => {
  let o = ''
  for (let i = s.length - 1; i >= 0; i--) o += COMP[s[i]] ?? 'N'
  return o
}
const rotate = (s: string, by: number) => (by ? s.slice(by) + s.slice(0, by) : s)
const mod = (x: number, m: number) => ((x % m) + m) % m

export interface Difference {
  type: 'SNP' | 'Insertion' | 'Deletion'
  /** 0-based expected position: the base changed, the first base deleted, or the base an insertion follows (-1 before the first). */
  pos: number
  ref: string
  alt: string
}

export interface Comparison {
  /** The contig lies on the other strand of the expected sequence. */
  reversed: boolean
  /** A circular contig was turned by this many bases (after reverse complementing). */
  shift: number
  /** The contig as it lines up with the expected sequence: on its strand, turned to its start. */
  bases: string
  /** For each expected position, the aligned contig position, or -1 (deleted, or outside a linear contig). */
  toContig: Int32Array
  /** For each contig position, the expected position, or -1 (inserted). */
  toExpected: Int32Array
  matches: number
  mismatches: number
  gaps: number
  identity: number
  /** Expected positions the contig spans, half-open (all of it for a circular contig). */
  from: number
  to: number
  differences: Difference[]
}

function kmers(s: string, k: number, each: (code: number, i: number) => void) {
  let code = 0
  let valid = 0
  const mask = (1 << (2 * k)) - 1
  for (let i = 0; i < s.length; i++) {
    const c = CODE[s[i]]
    if (c === undefined) { valid = 0; code = 0; continue }
    code = ((code << 2) | c) & mask
    if (++valid >= k) each(code >>> 0, i - k + 1)
  }
}

/** Votes per diagonal for one strand of the contig. */
function votes(contig: string, index: Map<number, number[]>, L: number, circular: boolean): Map<number, number> {
  const v = new Map<number, number>()
  kmers(contig, ANCHOR_K, (code, i) => {
    const hits = index.get(code)
    if (!hits) return
    for (const p of hits) {
      const d = circular ? mod(p - i, L) : p - i
      v.set(d, (v.get(d) ?? 0) + 1)
    }
  })
  return v
}

/** Fewest anchor votes for a contig to be taken as the expected sequence (or part of it). */
const minAnchors = (C: number, L: number) => Math.max(5, Math.min(C, L) * 0.01)

/** The expected sequence's rare 15-mers, and the strand and diagonal the contig's 15-mers vote for most. */
function anchorsOf(contig: string, expected: string, circular: boolean) {
  const L = expected.length
  const index = new Map<number, number[]>()
  const ext = circular ? expected + expected.slice(0, ANCHOR_K - 1) : expected
  kmers(ext, ANCHOR_K, (code, i) => {
    const list = index.get(code)
    if (!list) index.set(code, [i])
    else if (list.length <= 4) list.push(i)
  })
  for (const [k, list] of index) if (list.length > 4) index.delete(k)
  const best = (v: Map<number, number>) => {
    let d = 0
    let n = 0
    for (const [k, c] of v) if (c > n) { n = c; d = k }
    return { d, n, v }
  }
  const fwd = best(votes(contig, index, L, circular))
  const rev = best(votes(revcomp(contig), index, L, circular))
  const reversed = rev.n > fwd.n
  return { index, top: reversed ? rev : fwd, reversed }
}

/**
 * How strongly a contig matches an expected sequence: the anchor votes on
 * its best strand and diagonal, or 0 when too few to line them up. Cheap
 * (no alignment), for picking which of several open sequences a contig is.
 */
export function anchorScore(contig: string, expected: string, expectedCircular: boolean): number {
  const e = expected.toUpperCase()
  const c = contig.toUpperCase()
  if (e.length < 50 || c.length < 50) return 0
  const { top } = anchorsOf(c, e, expectedCircular)
  return top.n >= minAnchors(c.length, e.length) ? top.n : 0
}

export function compareToExpected(o: { contig: string; contigCircular: boolean; expected: string; expectedCircular: boolean }): Comparison {
  const expected = o.expected.toUpperCase()
  const contig0 = o.contig.toUpperCase()
  const L = expected.length
  const C = contig0.length
  if (L < 50 || C < 50) throw new Error('Both sequences need at least 50 bases to compare.')

  // 1. Anchors on both strands.
  const { index, top, reversed } = anchorsOf(contig0, expected, o.expectedCircular)
  if (top.n < minAnchors(C, L)) {
    throw new Error('The contig does not look like the expected sequence: too few 15-mers in common to line them up.')
  }
  let contig = reversed ? revcomp(contig0) : contig0

  // 2. Turn the contig (circular) or the expected sequence (linear contig on a circle).
  let shift = 0
  let expRot = 0
  if (o.contigCircular) {
    // The contig base at the expected start: from the anchor nearest after it (on a well-voted
    // diagonal), since a deletion or insertion elsewhere moves the diagonal along the way.
    let nearest = Infinity
    kmers(contig, ANCHOR_K, (code, i) => {
      for (const p of index.get(code) ?? []) {
        const d = mod(p - i, L)
        if ((top.v.get(d) ?? 0) < 3 || p >= nearest) continue
        nearest = p
        shift = mod(i - p, C)
      }
    })
    contig = rotate(contig, shift)
  } else if (o.expectedCircular) {
    // The contig starts at expected d: turn the expected sequence to start a margin before it.
    const margin = Math.min(Math.floor(Math.max(0, L - C) / 2), 2000)
    expRot = mod(top.d - margin, L)
  }
  const target = rotate(expected, expRot)

  // 3. Band: every diagonal the anchors voted for, on the turned sequences.
  const turned = votes(contig, (() => {
    const idx = new Map<number, number[]>()
    kmers(target, ANCHOR_K, (code, i) => {
      const list = idx.get(code)
      if (!list) idx.set(code, [i])
      else if (list.length <= 4) list.push(i)
    })
    for (const [k, list] of idx) if (list.length > 4) idx.delete(k)
    return idx
  })(), L, false)
  let peak = 0
  for (const c of turned.values()) peak = Math.max(peak, c)
  let lo = Infinity
  let hi = -Infinity
  for (const [d, c] of turned) if (c >= Math.max(3, peak * 0.02)) { lo = Math.min(lo, d); hi = Math.max(hi, d) }
  if (!Number.isFinite(lo)) { lo = 0; hi = 0 }
  if (o.contigCircular) { lo = Math.min(lo, 0, L - C); hi = Math.max(hi, 0, L - C) }
  lo -= BAND_MARGIN
  hi += BAND_MARGIN
  if ((C + 1) * (hi - lo + 1) > MAX_CELLS) {
    throw new Error('The two sequences differ too much in their layout (or are too long) to align here. Map the reads to the expected sequence instead.')
  }
  const ends: AlignEnds = o.contigCircular
    ? { freeTargetStart: false, freeTargetEnd: false, freeQueryStart: false, freeQueryEnd: false }
    : { freeTargetStart: true, freeTargetEnd: true, freeQueryStart: false, freeQueryEnd: false }
  const aln = alignBanded(contig, target, ends, { lo, hi })
  if (!aln) throw new Error('The contig could not be aligned to the expected sequence.')

  // 4. Walk the alignment.
  const toContig = new Int32Array(L).fill(-1)
  const toExpected = new Int32Array(C).fill(-1)
  const differences: Difference[] = []
  let i = aln.qStart
  let j = aln.tStart
  const ePos = (t: number) => mod(t + expRot, L)
  const ops = aln.ops
  for (let k = 0; k < ops.length;) {
    const op = ops[k]
    if (op === 'M') {
      const e = ePos(j)
      toContig[e] = i
      toExpected[i] = e
      if (contig[i] !== target[j]) differences.push({ type: 'SNP', pos: e, ref: target[j], alt: contig[i] })
      i++; j++; k++
    } else if (op === 'D') {
      // Expected bases the contig lacks.
      const j0 = j
      while (k < ops.length && ops[k] === 'D') { j++; k++ }
      differences.push({ type: 'Deletion', pos: ePos(j0), ref: target.slice(j0, j), alt: '' })
    } else {
      // Contig bases the expected sequence lacks, after expected base j - 1.
      const i0 = i
      while (k < ops.length && ops[k] === 'I') { i++; k++ }
      differences.push({ type: 'Insertion', pos: j > 0 ? ePos(j - 1) : -1, ref: '', alt: contig.slice(i0, i) })
    }
  }
  return {
    reversed, shift, bases: contig, toContig, toExpected,
    matches: aln.matches, mismatches: aln.mismatches, gaps: aln.gaps, identity: aln.identity,
    from: o.contigCircular ? 0 : ePos(aln.tStart),
    to: o.contigCircular ? L : ePos(aln.tEnd - 1) + 1,
    differences,
  }
}

/**
 * Move features of the expected sequence onto the turned contig. A feature
 * whose every base was deleted (or lies outside a linear contig) is left
 * out; one that lost or gained bases is moved and listed as changed.
 */
export function liftFeatures(features: readonly AnnotationData[], cmp: Comparison, circular: boolean): { features: AnnotationData[]; dropped: string[]; changed: string[] } {
  const L = cmp.toContig.length
  const C = cmp.bases.length
  const out: AnnotationData[] = []
  const dropped: string[] = []
  const changed: string[] = []
  for (const f of features) {
    const len = f.start <= f.end ? f.end - f.start : L - f.start + f.end
    if (len <= 0) continue
    // First and last aligned base inside the feature.
    let first = -1
    for (let k = 0; k < len && first < 0; k++) first = cmp.toContig[(f.start + k) % L]
    let last = -1
    for (let k = len - 1; k >= 0 && last < 0; k--) last = cmp.toContig[(f.start + k) % L]
    if (first < 0 || last < 0) { dropped.push(f.name); continue }
    const wraps = last < first
    if (wraps && !circular) { dropped.push(f.name); continue }
    const newLen = wraps ? C - first + last + 1 : last - first + 1
    if (newLen !== len) changed.push(f.name)
    const { segments, ...rest } = f
    void segments
    out.push({ ...rest, start: first, end: last + 1 })
  }
  return { features: out, dropped, changed }
}
