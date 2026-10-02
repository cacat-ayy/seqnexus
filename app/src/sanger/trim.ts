/**
 * Planning where to trim a read.
 *
 * Trimming runs in a fixed order, each step only ever cutting further in:
 *
 * 1. Quality: the best stretch by error probability (Mott's algorithm, as
 *    Geneious and phred do) or by a quality cut-off, or the current trim.
 * 2. Fixed cuts from either end.
 * 3. Primers: a primer (or its reverse complement) found near the start cuts
 *    the start to after it; near the end, cuts the end to before it. An
 *    amplicon read that runs into the opposite primer ends there.
 * 4. Vector: a stretch at either end matching a chosen vector (cloning
 *    vector sequence read before the insert starts, or after it ends) is cut.
 *
 * Positions are called-base indices, half-open, like the read's trim.
 */

import type { TraceData } from '../io/trace'
import { autoTrim } from '../io/ab1'
import { reverseComplement } from '../models/complement'
import { baseBits } from '../msa/iupac'

export interface TrimPrimer {
  name: string
  sequence: string
}

export interface TrimVector {
  name: string
  sequence: string
  circular: boolean
}

export interface TrimSettings {
  method: 'error' | 'quality' | 'keep'
  /** Error probability limit for 'error' (Geneious defaults to 0.05). */
  errorLimit: number
  /** Quality cut-off for 'quality'. */
  minQuality: number
  /** Bases always removed from each end. */
  cutStart: number
  cutEnd: number
  primers: TrimPrimer[]
  primerMismatches: number
  vector: TrimVector | null
  /** Reads shorter than this after trimming are reported. */
  minLength: number
}

export const DEFAULT_TRIM: TrimSettings = {
  method: 'error',
  errorLimit: 0.05,
  minQuality: 20,
  cutStart: 0,
  cutEnd: 0,
  primers: [],
  primerMismatches: 2,
  vector: null,
  minLength: 50,
}

export interface TrimPlan {
  start: number
  end: number
  notes: string[]
  tooShort: boolean
}

/** Where to trim `data`, starting from its current trim [curStart, curEnd). */
export function planTrim(data: TraceData, current: [number, number], s: TrimSettings): TrimPlan {
  const n = data.bases.length
  const notes: string[] = []
  let [start, end] = current

  if (s.method !== 'keep') {
    if (data.metadata.qualityMissing) {
      start = 0
      end = n
      notes.push('No quality values: not quality-trimmed')
    } else {
      const [a, b] = s.method === 'error' ? errorTrim(data.qualityScores, s.errorLimit) : autoTrim(data.qualityScores, s.minQuality)
      if (b > a) { start = a; end = b } else { start = 0; end = 0; notes.push('No stretch passes the quality limit') }
    }
  }

  if (s.cutStart > 0) start = Math.max(start, Math.min(n, s.cutStart))
  if (s.cutEnd > 0) end = Math.min(end, Math.max(0, n - s.cutEnd))

  for (const p of s.primers) {
    const hit = findPrimer(data.bases, p.sequence, s.primerMismatches)
    if (!hit) continue
    const label = `${p.name} at ${hit.start + 1}–${hit.end}${hit.reverse ? ' (reverse complement)' : ''}`
    if ((hit.start + hit.end) / 2 < n / 2) {
      if (hit.end > start) { start = hit.end; notes.push(`${label}: start trimmed after it`) }
    } else if (hit.start < end) {
      end = hit.start
      notes.push(`${label}: end trimmed before it`)
    }
  }

  if (s.vector) {
    const v = vectorEnds(data.bases, s.vector.sequence, s.vector.circular)
    if (v.startEnd !== null && v.startEnd > start) {
      start = v.startEnd
      notes.push(`${s.vector.name} sequence up to base ${v.startEnd}: trimmed`)
    }
    if (v.endStart !== null && v.endStart < end) {
      end = v.endStart
      notes.push(`${s.vector.name} sequence from base ${v.endStart + 1}: trimmed`)
    }
  }

  if (end < start) end = start
  const tooShort = end - start < s.minLength
  if (tooShort) notes.push(`Only ${end - start} bases left (under ${s.minLength})`)
  return { start, end, notes, tooShort }
}

/**
 * Mott's trimming by error probability: each base scores limit − P(error),
 * and the stretch with the highest total is kept. A higher limit keeps more.
 */
export function errorTrim(quality: readonly number[], limit: number): [number, number] {
  let bestStart = 0
  let bestEnd = 0
  let bestSum = 0
  let curStart = 0
  let curSum = 0
  for (let i = 0; i < quality.length; i++) {
    curSum += limit - Math.pow(10, -quality[i] / 10)
    if (curSum > bestSum) { bestSum = curSum; bestStart = curStart; bestEnd = i + 1 }
    if (curSum < 0) { curSum = 0; curStart = i + 1 }
  }
  return bestEnd > bestStart ? [bestStart, bestEnd] : [0, 0]
}

export interface PrimerHit {
  start: number
  end: number
  mismatches: number
  reverse: boolean
}

/**
 * Best match of a primer (IUPAC allowed) or its reverse complement in the
 * read, with at most `maxMismatches`. The 3' end has to match: its last four
 * bases may not mismatch. Ties go to the earliest hit.
 */
export function findPrimer(read: string, primer: string, maxMismatches: number): PrimerHit | null {
  const p = primer.toUpperCase().replace(/[^ACGTRYSWKMBDHVN]/g, '')
  if (p.length < 12 || read.length < p.length) return null
  let best: PrimerHit | null = null
  for (const [pat, reverse] of [[p, false], [reverseComplement(p), true]] as const) {
    const bits = [...pat].map(baseBits)
    // The primer's 3' end: the last bases of the forward pattern, the first of the reverse one.
    const anchored = (k: number) => (reverse ? k < 4 : k >= pat.length - 4)
    for (let i = 0; i + pat.length <= read.length; i++) {
      let mm = 0
      for (let k = 0; k < pat.length && mm <= maxMismatches; k++) {
        const r = baseBits(read[i + k])
        if (r === 0 || (r & bits[k]) !== r) {
          if (anchored(k)) { mm = maxMismatches + 1; break }
          mm++
        }
      }
      if (mm <= maxMismatches && (!best || mm < best.mismatches)) {
        best = { start: i, end: i + pat.length, mismatches: mm, reverse }
        if (mm === 0) break
      }
    }
  }
  return best
}

const K = 12

/**
 * Stretches at either end of the read that match the vector (either strand).
 * `startEnd`: the read matches vector from near its start up to this base.
 * `endStart`: the read matches vector from this base to near its end.
 */
export function vectorEnds(read: string, vector: string, circular: boolean): { startEnd: number | null; endStart: number | null } {
  const v = vector.toUpperCase().replace(/[^ACGT]/g, '')
  const r = read.toUpperCase()
  if (v.length < K || r.length < K * 2) return { startEnd: null, endStart: null }
  const wrap = circular ? v + v.slice(0, Math.min(v.length, r.length)) : v
  const targets = [wrap, reverseComplement(wrap)]
  const fromStart = startBlock(r, targets)
  const rr = [...r].reverse().join('')
  const fromEnd = startBlock(rr, targets.map(t => [...t].reverse().join('')))
  return {
    startEnd: fromStart,
    endStart: fromEnd === null ? null : r.length - fromEnd,
  }
}

/** End of a vector-matching block that begins near the read's start, or null. */
function startBlock(read: string, targets: string[]): number | null {
  const SEED_SPAN = 90
  const MAX_START = 45
  const MIN_BLOCK = 25
  let best: number | null = null
  for (const t of targets) {
    const index = new Map<string, number[]>()
    for (let j = 0; j + K <= t.length; j++) {
      const kmer = t.slice(j, j + K)
      const list = index.get(kmer)
      if (!list) index.set(kmer, [j])
      else if (list.length < 8) list.push(j)
    }
    const tried = new Set<number>()
    for (let i = 0; i + K <= Math.min(read.length, SEED_SPAN); i++) {
      const hits = index.get(read.slice(i, i + K))
      if (!hits) continue
      for (const j of hits) {
        const d = j - i
        if (tried.has(d)) continue
        tried.add(d)
        const [a, b] = extend(read, t, i, d)
        if (a <= MAX_START && b - a >= MIN_BLOCK && (best === null || b > best)) best = b
      }
    }
  }
  return best
}

/** Grow a seed at read position i on diagonal d both ways until mismatches pile up. */
function extend(read: string, t: string, i: number, d: number): [number, number] {
  const ok = (p: number) => p + d >= 0 && p + d < t.length && read[p] === t[p + d]
  const walk = (from: number, step: 1 | -1) => {
    let last = from
    let window: number[] = []
    for (let p = from; p >= 0 && p < read.length && p + d >= 0 && p + d < t.length; p += step) {
      if (ok(p)) last = p
      else window.push(p)
      window = window.filter(x => Math.abs(x - p) < 12)
      if (window.length >= 4) break
    }
    return last
  }
  const a = walk(i, -1)
  const b = walk(i + K - 1, 1)
  return [a, b + 1]
}
