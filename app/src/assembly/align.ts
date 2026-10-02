/**
 * Pairwise alignment for assembly: seeding plus a banded affine-gap
 * aligner (Gotoh) with free end gaps where asked.
 *
 * - Mapping a read to a reference: the read is aligned end to end, the
 *   reference's ends are free ("glocal").
 * - Overlapping two reads, or a read with a growing contig: every end is
 *   free, so one sequence may hang off either end of the other.
 *
 * k-mer seeds pick the diagonal (target position − query position) the
 * sequences line up on, and only a band around it is filled in, so a 1 kb
 * read against a 10 kb plasmid costs about as much as against 1 kb.
 */

import { baseBits } from '../msa/iupac'
import { reverseComplement } from '../models/complement'

export interface AlignScoring {
  match: number
  mismatch: number
  /** Penalty for opening a gap (charged once, on top of the extension). */
  gapOpen: number
  /** Penalty per gapped base. */
  gapExtend: number
}

export const ASSEMBLY_SCORING: AlignScoring = { match: 2, mismatch: 4, gapOpen: 6, gapExtend: 2 }

export interface AlignEnds {
  freeTargetStart: boolean
  freeTargetEnd: boolean
  freeQueryStart: boolean
  freeQueryEnd: boolean
}

export const GLOCAL: AlignEnds = { freeTargetStart: true, freeTargetEnd: true, freeQueryStart: false, freeQueryEnd: false }
export const OVERLAP: AlignEnds = { freeTargetStart: true, freeTargetEnd: true, freeQueryStart: true, freeQueryEnd: true }

export interface PairAlignment {
  /** One letter per column: M aligned pair, I query base against a gap, D target base against a gap. */
  ops: string
  qStart: number
  qEnd: number
  tStart: number
  tEnd: number
  score: number
  matches: number
  mismatches: number
  gaps: number
  /** Matches over aligned columns. */
  identity: number
}

const NEG = -1_000_000_000

/** Score of a pair of bases; IUPAC codes match what they could be. */
function pairScore(a: number, b: number, s: AlignScoring): number {
  if (a === 0 || b === 0) return -s.mismatch
  if (a === b && (a === 1 || a === 2 || a === 4 || a === 8)) return s.match
  if (a === 15 || b === 15) return 0
  return (a & b) !== 0 ? s.match / 2 : -s.mismatch
}

function bitsOf(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length)
  for (let i = 0; i < seq.length; i++) out[i] = baseBits(seq[i].toUpperCase())
  return out
}

/**
 * Align `query` to `target` within the diagonal band [lo, hi] (j − i),
 * or the whole matrix when no band is given.
 */
export function alignBanded(
  query: string,
  target: string,
  ends: AlignEnds,
  band?: { lo: number; hi: number },
  s: AlignScoring = ASSEMBLY_SCORING,
): PairAlignment | null {
  const n = query.length
  const m = target.length
  if (n === 0 || m === 0) return null
  const lo = Math.max(band?.lo ?? -n, -n)
  const hi = Math.min(band?.hi ?? m, m)
  if (hi < lo) return null
  const W = hi - lo + 1
  const q = bitsOf(query)
  const t = bitsOf(target)
  const size = (n + 1) * W
  const H = new Int32Array(size).fill(NEG)
  const E = new Int32Array(size).fill(NEG)
  const F = new Int32Array(size).fill(NEG)
  const ptr = new Uint8Array(size)
  const at = (i: number, j: number) => i * W + (j - i - lo)
  const inBand = (i: number, j: number) => j >= 0 && j <= m && j - i >= lo && j - i <= hi
  const open = s.gapOpen + s.gapExtend
  const ext = s.gapExtend

  // Row 0 and column 0.
  for (let j = Math.max(0, lo); j <= Math.min(m, hi); j++) {
    H[at(0, j)] = j === 0 || ends.freeTargetStart ? 0 : -(s.gapOpen + j * ext)
    if (j > 0 && !ends.freeTargetStart) { E[at(0, j)] = H[at(0, j)]; ptr[at(0, j)] = 1 | (j > 1 ? 4 : 0) }
    else if (j > 0) ptr[at(0, j)] = 3
  }
  for (let i = 1; i <= n; i++) {
    if (!inBand(i, 0)) continue
    H[at(i, 0)] = ends.freeQueryStart ? 0 : -(s.gapOpen + i * ext)
    if (!ends.freeQueryStart) { F[at(i, 0)] = H[at(i, 0)]; ptr[at(i, 0)] = 2 | (i > 1 ? 8 : 0) }
    else ptr[at(i, 0)] = 3
  }

  for (let i = 1; i <= n; i++) {
    const j0 = Math.max(1, i + lo)
    const j1 = Math.min(m, i + hi)
    for (let j = j0; j <= j1; j++) {
      const k = at(i, j)
      let p = 0
      // E: gap in the query (consume target), from the left.
      let e = NEG
      if (inBand(i, j - 1)) {
        const l = at(i, j - 1)
        const fromH = H[l] - open
        const fromE = E[l] - ext
        if (fromE > fromH) { e = fromE; p |= 4 } else e = fromH
      }
      // F: gap in the target (consume query), from above.
      let f = NEG
      if (inBand(i - 1, j)) {
        const u = at(i - 1, j)
        const fromH = H[u] - open
        const fromF = F[u] - ext
        if (fromF > fromH) { f = fromF; p |= 8 } else f = fromH
      }
      let h = NEG
      if (inBand(i - 1, j - 1)) {
        const d = H[at(i - 1, j - 1)]
        if (d > NEG / 2) h = d + pairScore(q[i - 1], t[j - 1], s)
      }
      let src = 0
      if (e > h) { h = e; src = 1 }
      if (f > h) { h = f; src = 2 }
      E[k] = e
      F[k] = f
      H[k] = h
      ptr[k] = p | src
    }
  }

  // Where the alignment ends.
  let bi = n
  let bj = Math.min(m, n + hi)
  let best = NEG
  const consider = (i: number, j: number) => {
    if (!inBand(i, j)) return
    const v = H[at(i, j)]
    if (v > best) { best = v; bi = i; bj = j }
  }
  if (ends.freeTargetEnd) for (let j = 0; j <= m; j++) consider(n, j)
  if (ends.freeQueryEnd) for (let i = 0; i <= n; i++) consider(i, m)
  if (!ends.freeTargetEnd && !ends.freeQueryEnd) consider(n, m)
  if (best <= NEG / 2) return null

  // Trace back.
  const ops: string[] = []
  let i = bi
  let j = bj
  let state: 0 | 1 | 2 = 0
  let matches = 0
  let mismatches = 0
  let gaps = 0
  while (i > 0 || j > 0) {
    if (i === 0 && ends.freeTargetStart) break
    if (j === 0 && ends.freeQueryStart) break
    const k = at(i, j)
    const pv = ptr[k]
    if (state === 0) {
      const src = pv & 3
      if (src === 3) break
      if (src === 1) { state = 1; continue }
      if (src === 2) { state = 2; continue }
      const a = q[i - 1]
      const b = t[j - 1]
      if (pairScore(a, b, ASSEMBLY_SCORING) > 0) matches++
      else mismatches++
      ops.push('M')
      i--
      j--
    } else if (state === 1) {
      ops.push('D')
      gaps++
      const extended = (pv & 4) !== 0
      j--
      if (!extended) state = 0
    } else {
      ops.push('I')
      gaps++
      const extended = (pv & 8) !== 0
      i--
      if (!extended) state = 0
    }
  }
  const opStr = ops.reverse().join('')
  const cols = opStr.length
  return {
    ops: opStr, qStart: i, qEnd: bi, tStart: j, tEnd: bj, score: best,
    matches, mismatches, gaps, identity: cols ? matches / cols : 0,
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }

/** Positions of every k-mer of plain bases in `target`, k ≤ 15. */
export function kmerIndex(target: string, k: number): Map<number, number[]> {
  const index = new Map<number, number[]>()
  const mask = (1 << (2 * k)) - 1
  let h = 0
  let valid = 0
  for (let j = 0; j < target.length; j++) {
    const c = CODE[target[j]]
    if (c === undefined) { valid = 0; h = 0; continue }
    h = ((h << 2) | c) & mask
    if (++valid >= k) {
      const pos = j - k + 1
      const list = index.get(h)
      if (!list) index.set(h, [pos])
      else if (list.length < 16) list.push(pos)
    }
  }
  return index
}

export interface Seed {
  /** target − query offset the sequences line up on. */
  diag: number
  votes: number
}

/** The diagonal most k-mer hits fall on (binned, so small indels still agree). */
export function bestDiagonal(query: string, index: Map<number, number[]>, k: number): Seed | null {
  const mask = (1 << (2 * k)) - 1
  const BIN = 24
  const bins = new Map<number, number[]>()
  let h = 0
  let valid = 0
  for (let i = 0; i < query.length; i++) {
    const c = CODE[query[i]]
    if (c === undefined) { valid = 0; h = 0; continue }
    h = ((h << 2) | c) & mask
    if (++valid < k) continue
    const hits = index.get(h)
    if (!hits || hits.length > 8) continue
    const qPos = i - k + 1
    for (const tPos of hits) {
      const d = tPos - qPos
      const b = Math.floor(d / BIN)
      const list = bins.get(b)
      if (list) list.push(d)
      else bins.set(b, [d])
    }
  }
  let best: number[] | null = null
  let bestVotes = 0
  for (const [b, list] of bins) {
    // Hits straddling a bin edge count for both neighbours.
    const votes = list.length + (bins.get(b + 1)?.length ?? 0) * 0.5
    if (votes > bestVotes) { bestVotes = votes; best = [...list, ...(bins.get(b + 1) ?? [])] }
  }
  if (!best) return null
  best.sort((a, b) => a - b)
  return { diag: best[Math.floor(best.length / 2)], votes: best.length }
}

/** A band around a diagonal, wide enough for the indels a read of this length may carry. */
export function bandAround(diag: number, queryLength: number): { lo: number; hi: number } {
  const margin = 24 + Math.ceil(queryLength * 0.04)
  return { lo: diag - margin, hi: diag + margin }
}

export interface OrientedHit {
  reversed: boolean
  seed: Seed
}

/** Seed a query in both orientations against an index; the better one, or null. */
export function seedBothStrands(query: string, index: Map<number, number[]>, k: number, minVotes: number): OrientedHit | null {
  const f = bestDiagonal(query, index, k)
  const r = bestDiagonal(reverseComplement(query), index, k)
  const best = (f?.votes ?? 0) >= (r?.votes ?? 0) ? (f ? { reversed: false, seed: f } : null) : (r ? { reversed: true, seed: r } : null)
  return best && best.seed.votes >= minVotes ? best : null
}
