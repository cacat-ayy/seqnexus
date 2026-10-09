/**
 * QC figures for a read set, gathered a read at a time as it is imported.
 *
 * A read's mean quality is computed from error probabilities, not by
 * averaging Phred scores: Q = -10 log10(mean of 10^(-q/10)). Averaging the
 * scores overstates it, because one Q5 base (a 32% chance of error) costs far
 * more accuracy than one Q40 base gains; a read of Q40 and Q5 bases half and
 * half has a mean score of 22.5 but an expected error rate of 16% (Q8). This is
 * how Nanopore and PacBio tools report read quality.
 *
 * Per-position quality is kept as a histogram of scores at each position (up
 * to MAX_POSITION) and reported as percentiles, the way FastQC draws it.
 * Long reads skip it: position along a 20 kb read says little.
 */

import type { Histogram, PositionQuality, ReadSetStats } from './types'

export const MAX_POSITION = 1000
const QBINS = 64

/** Error probability of each Phred score. */
const ERR = Float64Array.from({ length: 94 }, (_, q) => 10 ** (-q / 10))

const BASE_GC = new Uint8Array(128)
for (const c of 'GCgcSs') BASE_GC[c.charCodeAt(0)] = 1
const BASE_ACGT = new Uint8Array(128)
for (const c of 'ACGTacgtSsWw') BASE_ACGT[c.charCodeAt(0)] = 1

export class StatsAccumulator {
  private reads = 0
  private bases = 0
  private q20 = 0
  private q30 = 0
  private nBases = 0
  private gcBases = 0
  private acgtBases = 0
  private anyQuality = false
  private readonly lengthCounts = new Map<number, number>()
  /** Mean read quality in 0.5 steps, 0 to 60. */
  private readonly readQ = new Uint32Array(121)
  private readonly gc = new Uint32Array(101)
  private readonly positions: Uint32Array[]
  private readonly long: boolean

  constructor(long: boolean, mates: 1 | 2) {
    this.long = long
    this.positions = long ? [] : Array.from({ length: mates }, () => new Uint32Array(MAX_POSITION * QBINS))
  }

  /** One read: bases, Phred+33 qualities ('' for none), and which mate it is. */
  add(seq: string, qual: string, mate = 0): void {
    const n = seq.length
    this.reads++
    this.bases += n
    this.lengthCounts.set(n, (this.lengthCounts.get(n) ?? 0) + 1)
    let gc = 0
    let acgt = 0
    for (let i = 0; i < n; i++) {
      const c = seq.charCodeAt(i)
      if (c < 128) { gc += BASE_GC[c]; acgt += BASE_ACGT[c] }
      if (c === 78 || c === 110) this.nBases++
    }
    this.gcBases += gc
    this.acgtBases += acgt
    if (acgt) this.gc[Math.round((gc / acgt) * 100)]++
    if (!qual || n === 0) return
    let err = 0
    let any = false
    const pos = this.positions[mate]
    for (let i = 0; i < n; i++) {
      const q = Math.min(93, Math.max(0, qual.charCodeAt(i) - 33))
      if (q) any = true
      err += ERR[q]
      if (q >= 20) { this.q20++; if (q >= 30) this.q30++ }
      if (pos && i < MAX_POSITION) pos[i * QBINS + Math.min(QBINS - 1, q)]++
    }
    if (any) this.anyQuality = true
    const meanQ = -10 * Math.log10(err / n)
    this.readQ[Math.min(120, Math.max(0, Math.round(meanQ * 2)))]++
  }

  finish(): ReadSetStats {
    const lengths = [...this.lengthCounts.keys()].sort((a, b) => a - b)
    const minLength = lengths[0] ?? 0
    const maxLength = lengths[lengths.length - 1] ?? 0
    let n50 = 0
    let acc = 0
    for (let i = lengths.length - 1; i >= 0; i--) {
      acc += lengths[i] * this.lengthCounts.get(lengths[i])!
      if (acc * 2 >= this.bases) { n50 = lengths[i]; break }
    }
    const qualityMissing = !this.anyQuality
    return {
      reads: this.reads,
      bases: this.bases,
      minLength,
      maxLength,
      meanLength: this.reads ? this.bases / this.reads : 0,
      n50,
      q20: this.bases && !qualityMissing ? this.q20 / this.bases : 0,
      q30: this.bases && !qualityMissing ? this.q30 / this.bases : 0,
      nFraction: this.bases ? this.nBases / this.bases : 0,
      gc: this.acgtBases ? this.gcBases / this.acgtBases : 0,
      medianReadQuality: qualityMissing ? 0 : medianOf(this.readQ) / 2,
      qualityMissing,
      lengths: lengthHistogram(this.lengthCounts, minLength, maxLength, this.long),
      readQuality: qualityMissing ? { edges: [], counts: [] } : trimHistogram(this.readQ, 0.5),
      gcContent: trimHistogram(this.gc, 1),
      positionQuality: qualityMissing ? [] : this.positions.map(p => positionQuantiles(p, maxLength)),
    }
  }
}

/** The bin index the median falls in. */
function medianOf(counts: Uint32Array): number {
  let total = 0
  for (const c of counts) total += c
  let acc = 0
  for (let i = 0; i < counts.length; i++) {
    acc += counts[i]
    if (acc * 2 >= total) return i
  }
  return 0
}

/** Bins of `width` from 0, without the empty bins at either end. */
function trimHistogram(counts: Uint32Array, width: number): Histogram {
  let lo = 0
  let hi = counts.length - 1
  while (lo < hi && counts[lo] === 0) lo++
  while (hi > lo && counts[hi] === 0) hi--
  const edges: number[] = []
  const out: number[] = []
  for (let i = lo; i <= hi; i++) { edges.push(i * width); out.push(counts[i]) }
  edges.push((hi + 1) * width)
  return { edges, counts: out }
}

/**
 * Read lengths binned for a chart: one bin per length when there are few,
 * otherwise 60 bins, evenly spaced for short reads and on a log scale for
 * long ones (whose lengths span orders of magnitude).
 */
export function lengthHistogram(counts: Map<number, number>, min: number, max: number, long: boolean): Histogram {
  if (counts.size === 0) return { edges: [], counts: [] }
  if (max - min < 60 && !long) {
    const edges: number[] = []
    const out: number[] = []
    for (let l = min; l <= max; l++) { edges.push(l); out.push(counts.get(l) ?? 0) }
    edges.push(max + 1)
    return { edges, counts: out }
  }
  const BINS = 60
  const logScale = long && min > 0 && max / min > 10
  const edgeAt = (i: number) => (logScale
    ? Math.round(min * (max / min) ** (i / BINS))
    : Math.round(min + ((max + 1 - min) * i) / BINS))
  const edges = Array.from({ length: BINS + 1 }, (_, i) => edgeAt(i))
  edges[BINS] = max + 1
  const out = new Array<number>(BINS).fill(0)
  for (const [len, c] of counts) {
    let lo = 0
    let hi = BINS - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (edges[mid] <= len) lo = mid
      else hi = mid - 1
    }
    out[lo] += c
  }
  return { edges, counts: out }
}

/** Percentiles of each position's score histogram, up to the longest read. */
function positionQuantiles(hist: Uint32Array, maxLength: number): PositionQuality[] {
  const out: PositionQuality[] = []
  const n = Math.min(maxLength, MAX_POSITION)
  for (let p = 0; p < n; p++) {
    const row = hist.subarray(p * QBINS, (p + 1) * QBINS)
    let total = 0
    let sum = 0
    for (let q = 0; q < QBINS; q++) { total += row[q]; sum += row[q] * q }
    if (total === 0) break
    const at = (f: number) => {
      const target = f * total
      let acc = 0
      for (let q = 0; q < QBINS; q++) { acc += row[q]; if (acc >= target) return q }
      return QBINS - 1
    }
    out.push({ mean: sum / total, p10: at(0.1), p25: at(0.25), p50: at(0.5), p75: at(0.75), p90: at(0.9) })
  }
  return out
}
