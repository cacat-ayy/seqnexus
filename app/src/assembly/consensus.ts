/**
 * Consensus, coverage and disagreements of a contig, per column.
 *
 * "Highest quality" weighs each read's base by its Phred quality, so one
 * clean read outvotes two noisy ones at a messy position; the consensus
 * quality is the winning weight minus everything against it (capped at 90),
 * which is what Geneious reports too. "Majority" counts reads. With an
 * ambiguity threshold, every base holding at least that share of the weight
 * goes into an IUPAC code, which is how a heterozygous position shows up.
 */

import { baseBits, codeForBits } from '../msa/iupac'
import { MANUAL_QUALITY } from '../sanger/edits'
import type { ContigDoc } from './types'

export interface ConsensusSettings {
  method: 'quality' | 'majority'
  /** 0 for none; otherwise the share of weight a base needs to enter an IUPAC code. */
  ambiguity: number
}

export const DEFAULT_CONSENSUS: ConsensusSettings = { method: 'quality', ambiguity: 0 }

export interface Consensus {
  /** Per column: the consensus base, '-' where gaps win, ' ' where no read covers it. */
  bases: string
  quality: Uint8Array
  coverage: Uint16Array
  /** 1 where some covering read disagrees with the consensus. */
  disagree: Uint8Array
  /** Columns that disagree, in order. */
  disagreements: number[]
}

const BASES = ['A', 'C', 'G', 'T'] as const

export function computeConsensus(doc: ContigDoc, s: ConsensusSettings = DEFAULT_CONSENSUS): Consensus {
  const W = doc.width
  // Weights per column: A C G T gap.
  const w = new Float64Array(W * 5)
  const coverage = new Uint16Array(W)
  for (const r of doc.rows) {
    const gq = gapQualities(r.seq, r.qual)
    for (let k = 0; k < r.seq.length; k++) {
      const c = r.start + k
      if (c < 0 || c >= W) continue
      coverage[c]++
      const ch = r.seq[k]
      // A base changed in the contig is a call made by hand: weigh it as a confident one.
      const q = ch !== r.orig[k] && ch !== '-' ? MANUAL_QUALITY : r.qual[k]
      const weight = s.method === 'majority' ? 1 : Math.max(1, ch === '-' ? gq[k] : q)
      if (ch === '-') { w[c * 5 + 4] += weight; continue }
      const bits = baseBits(ch)
      // An ambiguous call spreads its weight over the bases it could be.
      const n = popcount(bits)
      if (n === 0) continue
      for (let b = 0; b < 4; b++) if (bits & (1 << b)) w[c * 5 + b] += weight / n
    }
  }
  const bases: string[] = new Array(W)
  const quality = new Uint8Array(W)
  for (let c = 0; c < W; c++) {
    if (coverage[c] === 0) { bases[c] = ' '; continue }
    // The best base; a gap wins only by outweighing it (a tie goes to the
    // base, which some read actually called).
    let best = 0
    let total = 0
    for (let b = 0; b < 5; b++) {
      total += w[c * 5 + b]
      if (b < 4 && w[c * 5 + b] > w[c * 5 + best]) best = b
    }
    if (w[c * 5 + 4] > w[c * 5 + best]) best = 4
    const top = w[c * 5 + best]
    if (best === 4) {
      bases[c] = '-'
    } else if (s.ambiguity > 0) {
      let bits = 0
      for (let b = 0; b < 4; b++) if (w[c * 5 + b] >= s.ambiguity * total && w[c * 5 + b] > 0) bits |= 1 << b
      bases[c] = popcount(bits) > 1 ? codeForBits(bits) : BASES[best]
    } else {
      bases[c] = BASES[best]
    }
    quality[c] = Math.max(0, Math.min(90, Math.round(s.method === 'majority' ? (top / total) * 60 : top - (total - top))))
  }
  const cons = bases.join('')

  const disagree = new Uint8Array(W)
  const disagreements: number[] = []
  for (const r of doc.rows) {
    for (let k = 0; k < r.seq.length; k++) {
      const c = r.start + k
      if (c < 0 || c >= W || disagree[c]) continue
      if (!sameBase(r.seq[k], cons[c])) disagree[c] = 1
    }
  }
  for (let c = 0; c < W; c++) if (disagree[c]) disagreements.push(c)
  return { bases: cons, quality, coverage, disagree, disagreements }
}

/** Does a read's base agree with the consensus? Within an IUPAC consensus counts. */
export function sameBase(read: string, consensus: string): boolean {
  if (read === consensus) return true
  if (read === '-' || consensus === '-' || consensus === ' ') return false
  const a = baseBits(read)
  const b = baseBits(consensus)
  return a !== 0 && (a & b) === a
}

/** Quality for each gap: the lower of the qualities either side of it. */
function gapQualities(seq: string, qual: readonly number[]): Float32Array {
  const n = seq.length
  const out = new Float32Array(n)
  let prev = 0
  const left = new Float32Array(n)
  for (let k = 0; k < n; k++) { if (seq[k] !== '-') prev = qual[k]; left[k] = prev }
  let next = 0
  for (let k = n - 1; k >= 0; k--) {
    if (seq[k] !== '-') next = qual[k]
    out[k] = Math.min(left[k] || next, next || left[k])
  }
  return out
}

function popcount(x: number): number {
  let n = 0
  for (; x; x &= x - 1) n++
  return n
}

/** The consensus as a sequence: gaps dropped, uncovered stretches inside the contig as N. */
export function consensusSequence(c: Consensus): string {
  const first = c.bases.search(/[^ ]/)
  if (first < 0) return ''
  const last = c.bases.length - 1 - [...c.bases].reverse().findIndex(ch => ch !== ' ')
  let out = ''
  for (let k = first; k <= last; k++) {
    const ch = c.bases[k]
    if (ch === '-') continue
    out += ch === ' ' ? 'N' : ch
  }
  return out
}
