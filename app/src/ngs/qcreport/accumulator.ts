/**
 * Gathers the quality report a read at a time, beside StatsAccumulator,
 * while reads are imported or trimmed (or later, from the stored reads).
 *
 * Each module follows FastQC's method (FastQC 0.12, Simon Andrews, Babraham
 * Bioinformatics, GPL 3 or later, reimplemented here) so that its numbers and
 * its pass, warn and fail calls agree with FastQC's. Where SeqNexus departs
 * from it, the comment at the site says so and why; the README lists them.
 *
 * Long reads get the modules that describe whole reads (quality, GC, length);
 * the ones that look along a read, or compare read starts, are skipped.
 */

import { lengthHistogram, MAX_POSITION } from '../stats'
import type { PositionQuality, ReadSetStats } from '../types'
import { findContaminant } from './contaminants'
import { ADAPTERS } from './sequences'
import {
  FASTQC_LIMITS as L, MODULES, QC_REPORT_VERSION,
  type MateReport, type ModuleId, type ModuleStatus, type OverrepresentedSequence, type QcReport,
} from './types'

/** A, C, G, T, N, anything else (IUPAC ambiguity codes, '.'). */
const SLOTS = 6
const CODE = new Uint8Array(128).fill(5)
for (const [i, b] of ['A', 'C', 'G', 'T', 'N'].entries()) {
  CODE[b.charCodeAt(0)] = i
  CODE[b.toLowerCase().charCodeAt(0)] = i
}

/** FastQC tracks this many distinct sequences for duplication, then only counts the ones it has. */
export const DUPLICATION_TRACKED = 100_000
/** Longer reads are compared by their first this-many bases, as FastQC does. */
export const DUPLICATION_PREFIX = 50
/** FastQC gives up on tiles past this many: the names are being read wrongly. */
const MAX_TILES = 2500
const PROBE = 12

/**
 * Adapter probes as 2-bit codes of their 12 bases, and a table of which
 * probes end in each 5 bases, so most positions are ruled out by one look-up.
 * A read counts once per adapter, at its first match. The cumulative count
 * is made at the end, from every read, rather than as FastQC does while
 * reading, where a position only counts the reads after the first read long
 * enough to reach it.
 */
const PROBE_MASK = (1 << (2 * PROBE)) - 1
const PROBE_CODES = ADAPTERS.map(a => [...a.seq].reduce((k, b) => (k << 2) | CODE[b.charCodeAt(0)], 0))
const PROBE_BUCKET = new Uint8Array(1024)
PROBE_CODES.forEach((k, a) => { PROBE_BUCKET[k & 1023] |= 1 << a })

interface TileSums { sum: Float64Array; n: Uint32Array }

class MateQc {
  reads = 0
  bases = 0
  minLength = Infinity
  maxLength = 0
  emptyReads = 0
  readonly calls = new Float64Array(4)
  lowestQuality = Infinity
  /** Per position: counts of A, C, G, T, N, other. Short reads only. */
  readonly positions: Uint32Array | null
  readonly seqQuality = new Map<number, number>()
  readonly gc = new Float64Array(101)
  readonly lengths = new Map<number, number>()
  readonly dup = new Map<string, number>()
  dupFrozen = false
  dupCountAtLimit = 0
  /** Per adapter: reads whose first match starts at each position. */
  readonly adapterStarts: Uint32Array[]
  tiles: Map<number, TileSums> | null = new Map()
  tileField = -1
  tileNote = ''
  /** Reads with qualities so far, for sampling the tiles. */
  tileReads = 0

  constructor(long: boolean) {
    this.positions = long ? null : new Uint32Array(MAX_POSITION * SLOTS)
    this.adapterStarts = long ? [] : ADAPTERS.map(() => new Uint32Array(MAX_POSITION))
    if (long) this.tiles = null
  }

  /** The tile in a read name, FastQC's way: field 5 of 7 or more colon-separated fields (Casava 1.8), field 3 of 5 or 6 (older names). */
  tileOf(id: string): number | null {
    // Field by field rather than by splitting the name: this runs for every read.
    if (this.tileField < 0) {
      let fields = 1
      for (let c = id.indexOf(':'); c >= 0; c = id.indexOf(':', c + 1)) fields++
      if (fields >= 7) this.tileField = 4
      else if (fields >= 5) this.tileField = 2
      else return this.dropTiles('The read names carry no tile numbers (Illumina read names do), so there is nothing to compare.')
    }
    const broken = () => this.dropTiles(`Read "${id}" has no tile number where the earlier reads had one, so the names cannot be read for tiles.`)
    let start = 0
    for (let k = 0; k < this.tileField; k++) {
      const c = id.indexOf(':', start)
      if (c < 0) return broken()
      start = c + 1
    }
    let end = id.indexOf(':', start)
    if (end < 0) end = id.length
    let i = start
    const sign = id.charCodeAt(i) === 45 ? -1 : 1
    if (id.charCodeAt(i) === 43 || id.charCodeAt(i) === 45) i++
    if (i >= end) return broken()
    let tile = 0
    for (; i < end; i++) {
      const d = id.charCodeAt(i) - 48
      if (d < 0 || d > 9) return broken()
      tile = tile * 10 + d
    }
    return sign * tile
  }

  dropTiles(note: string): null {
    this.tiles = null
    this.tileNote = note
    return null
  }
}

/** For a read length, how many GC counts claim each whole percentage (FastQC's GCModel). */
const claimCache = new Map<number, Int32Array>()
function gcRange(count: number, length: number): [number, number] {
  const low = Math.min(length, Math.max(0, count - 0.5))
  const high = Math.min(length, Math.max(0, count + 0.5))
  return [Math.round((low * 100) / length), Math.round((high * 100) / length)]
}
function gcClaims(length: number): Int32Array {
  let c = claimCache.get(length)
  if (c) return c
  c = new Int32Array(101)
  for (let k = 0; k <= length; k++) {
    const [lo, hi] = gcRange(k, length)
    for (let p = lo; p <= hi; p++) c[p]++
  }
  claimCache.set(length, c)
  return c
}

/**
 * FastQC truncates reads for the GC model, so that few models (one per
 * length) are made: to whole hundreds above 100 bases, whole thousands above
 * 1,000.
 */
function gcLength(n: number): number {
  if (n > 1000) return Math.floor(n / 1000) * 1000
  if (n > 100) return Math.floor(n / 100) * 100
  return n
}

export class QcAccumulator {
  private readonly long: boolean
  private readonly mates: MateQc[]

  constructor(long: boolean, mates: 1 | 2) {
    this.long = long
    this.mates = Array.from({ length: mates }, () => new MateQc(long))
  }

  /** One read: its ID (the name up to the first space), bases, Phred+33 qualities ('' for none), and which mate it is. */
  add(id: string, seq: string, qual: string, mate = 0): void {
    const m = this.mates[mate]
    const n = seq.length
    m.reads++
    m.bases += n
    m.lengths.set(n, (m.lengths.get(n) ?? 0) + 1)
    if (n < m.minLength) m.minLength = n
    if (n > m.maxLength) m.maxLength = n
    if (n === 0) m.emptyReads++

    const gcTo = gcLength(n)
    let gc = 0
    let lower = false
    const calls = m.calls
    const pos = m.positions
    if (!pos) {
      for (let i = 0; i < n; i++) {
        const c = seq.charCodeAt(i)
        const code = c < 128 ? CODE[c] : 5
        if (code < 4) {
          calls[code]++
          if ((code === 1 || code === 2) && i < gcTo) gc++
        }
      }
    } else {
      // Short reads: also counts by position, and the adapter probes, found
      // by a rolling code of the last 12 bases rather than six string
      // searches (which took half the time of the whole report).
      let kmer = 0
      let run = 0
      let found = 0
      const starts = m.adapterStarts
      for (let i = 0; i < n; i++) {
        const c = seq.charCodeAt(i)
        const code = c < 128 ? CODE[c] : 5
        if (c >= 97) lower = true
        if (code < 4) {
          calls[code]++
          if ((code === 1 || code === 2) && i < gcTo) gc++
          kmer = ((kmer << 2) | code) & PROBE_MASK
          if (++run >= PROBE) {
            const bits = PROBE_BUCKET[kmer & 1023] & ~found
            if (bits) {
              for (let a = 0; a < PROBE_CODES.length; a++) {
                if (bits & (1 << a) && kmer === PROBE_CODES[a] && i - PROBE + 1 < MAX_POSITION) {
                  found |= 1 << a
                  starts[a][i - PROBE + 1]++
                }
              }
            }
          }
        } else {
          run = 0
        }
        if (i < MAX_POSITION) pos[i * SLOTS + code]++
      }
    }
    if (gcTo > 0) {
      const claims = gcClaims(gcTo)
      const [lo, hi] = gcRange(gc, gcTo)
      for (let p = lo; p <= hi; p++) m.gc[p] += 1 / claims[p]
    }

    if (qual.length > 0) {
      // FastQC samples the tiles: every read of the first 10,000, then one in ten.
      m.tileReads++
      const sampled = m.tileReads <= 10_000 || m.tileReads % 10 === 0
      const tile = m.tiles && sampled ? m.tileOf(id) : null
      let t: TileSums | undefined
      if (tile !== null && m.tiles) {
        t = m.tiles.get(tile)
        if (!t) {
          if (m.tiles.size >= MAX_TILES) {
            m.dropTiles(`The read names give more than ${MAX_TILES.toLocaleString('en-US')} tiles, so they are probably not tile numbers.`)
          } else {
            t = { sum: new Float64Array(0), n: new Uint32Array(0) }
            m.tiles.set(tile, t)
          }
        }
        const need = Math.min(qual.length, MAX_POSITION)
        if (t && t.sum.length < need) {
          const sum = new Float64Array(need)
          const cnt = new Uint32Array(need)
          sum.set(t.sum)
          cnt.set(t.n)
          t.sum = sum
          t.n = cnt
        }
      }
      let total = 0
      let lowest = m.lowestQuality
      for (let i = 0; i < qual.length; i++) {
        const q = qual.charCodeAt(i) - 33
        total += q
        if (q < lowest) lowest = q
        if (t && i < MAX_POSITION) { t.sum[i] += q; t.n[i]++ }
      }
      m.lowestQuality = lowest
      // FastQC's read quality: the whole-number mean of the scores (integer division).
      const mean = Math.floor(total / qual.length)
      m.seqQuality.set(mean, (m.seqQuality.get(mean) ?? 0) + 1)
    }

    if (this.long) return
    const up = lower ? seq.toUpperCase() : seq

    // Duplication: the first 100,000 distinct sequences are tracked; after
    // that only those are counted, and the levels are extrapolated (finish).
    const key = n > DUPLICATION_PREFIX ? up.slice(0, DUPLICATION_PREFIX) : up
    const seen = m.dup.get(key)
    if (seen !== undefined) {
      m.dup.set(key, seen + 1)
      if (!m.dupFrozen) m.dupCountAtLimit = m.reads
    } else if (!m.dupFrozen) {
      m.dup.set(key, 1)
      m.dupCountAtLimit = m.reads
      if (m.dup.size === DUPLICATION_TRACKED) m.dupFrozen = true
    }
  }

  /** The report, given the import's statistics (for quality by position, which StatsAccumulator already gathers). */
  finish(stats: ReadSetStats): QcReport {
    return {
      version: QC_REPORT_VERSION,
      long: this.long,
      mates: this.mates.map((m, i) => this.mateReport(m, stats.positionQuality[i] ?? [], stats.qualityMissing)),
    }
  }

  private mateReport(m: MateQc, baseQuality: PositionQuality[], noQuality: boolean): MateReport {
    const long = this.long
    const status = Object.fromEntries(MODULES.map(x => [x.id, 'pass'])) as Record<ModuleId, ModuleStatus>
    const notes: Partial<Record<ModuleId, string>> = {}
    const skip = (id: ModuleId, note: string) => { status[id] = 'skip'; notes[id] = note }
    const flag = (id: ModuleId, value: number, limit: { warn: number; error: number }, below = false) => {
      const over = (x: number) => (below ? value < x : value > x)
      status[id] = over(limit.error) ? 'fail' : over(limit.warn) ? 'warn' : 'pass'
    }
    const reads = m.reads
    const minLength = reads ? m.minLength : 0
    const P = long ? 0 : Math.min(m.maxLength, MAX_POSITION)
    const [A, C, G, T] = m.calls
    const called = A + C + G + T

    // Basic statistics (always passes, as in FastQC).
    const lowestQuality = noQuality || m.lowestQuality === Infinity ? null : m.lowestQuality
    if (lowestQuality !== null && lowestQuality >= 31) {
      notes.basic = `The lowest quality is Q${lowestQuality}, read as Phred+33. Old Illumina files (pipeline 1.3 to 1.7) use Phred+64, whose scores then read 31 too high; if this is one, convert it before importing.`
    }

    // Per base sequence quality.
    if (long) skip('baseQuality', 'Not run for long reads: position along a read of thousands of bases says little.')
    else if (noQuality || baseQuality.length === 0) skip('baseQuality', 'The reads have no qualities.')
    else {
      let s: ModuleStatus = 'pass'
      for (const q of baseQuality) {
        if (q.p25 < L.baseLower.error || q.p50 < L.baseMedian.error) { s = 'fail'; break }
        if (q.p25 < L.baseLower.warn || q.p50 < L.baseMedian.warn) s = 'warn'
      }
      status.baseQuality = s
    }

    // Per tile sequence quality.
    let tiles: MateReport['tiles'] = null
    if (long) skip('tileQuality', 'Not run for long reads: they have no tiles.')
    else if (noQuality) skip('tileQuality', 'The reads have no qualities.')
    else if (!m.tiles || m.tiles.size === 0) skip('tileQuality', m.tileNote || 'The read names carry no tile numbers.')
    else {
      tiles = tileDeviations(m.tiles, P)
      flag('tileQuality', tiles.maxDeviation, L.tile)
    }

    // Per sequence quality scores.
    const seqQuality = { from: 0, counts: [] as number[] }
    if (noQuality || m.seqQuality.size === 0) skip('seqQuality', 'The reads have no qualities.')
    else {
      const keys = [...m.seqQuality.keys()].sort((a, b) => a - b)
      seqQuality.from = keys[0]
      seqQuality.counts = Array.from({ length: keys[keys.length - 1] - keys[0] + 1 }, (_, i) => m.seqQuality.get(keys[0] + i) ?? 0)
      // FastQC flags the most common mean quality at or below the limit; the first of equal counts wins.
      let mode = keys[0]
      let best = -1
      seqQuality.counts.forEach((c, i) => { if (c > best) { best = c; mode = seqQuality.from + i } })
      status.seqQuality = mode <= L.seqQuality.error ? 'fail' : mode <= L.seqQuality.warn ? 'warn' : 'pass'
    }

    // Per base sequence content and N content.
    const baseContent = { a: [] as number[], c: [] as number[], g: [] as number[], t: [] as number[] }
    const baseN: number[] = []
    if (long) {
      skip('baseContent', 'Not run for long reads: position along a read of thousands of bases says little.')
      skip('baseN', 'Not run for long reads: the share of N calls is on the Summary page.')
    } else if (m.positions) {
      let maxContent = 0
      let maxN = 0
      for (let p = 0; p < P; p++) {
        const o = p * SLOTS
        const [a, c, g, t, nn, other] = m.positions.subarray(o, o + SLOTS)
        const acgt = a + c + g + t
        const pct = (x: number) => (acgt ? (x * 100) / acgt : 0)
        baseContent.a.push(r3(pct(a)))
        baseContent.c.push(r3(pct(c)))
        baseContent.g.push(r3(pct(g)))
        baseContent.t.push(r3(pct(t)))
        maxContent = Math.max(maxContent, Math.abs(pct(a) - pct(t)), Math.abs(pct(g) - pct(c)))
        const all = acgt + nn + other
        const np = all ? (nn * 100) / all : 0
        baseN.push(r3(np))
        maxN = Math.max(maxN, np)
      }
      flag('baseContent', maxContent, L.baseContent)
      flag('baseN', maxN, L.baseN)
    }

    // Per sequence GC content.
    const seqGc = gcFit(m.gc)
    if (reads === 0) skip('seqGc', 'No reads.')
    else flag('seqGc', seqGc.deviation, L.seqGc)

    // Sequence length distribution: FastQC warns when the reads are not all one length, and fails on empty reads.
    status.lengths = m.emptyReads > 0 ? 'fail' : m.lengths.size > 1 ? 'warn' : 'pass'
    if (m.emptyReads > 0) notes.lengths = `${m.emptyReads.toLocaleString('en-US')} ${m.emptyReads === 1 ? 'read has' : 'reads have'} no bases.`

    // Duplication and overrepresented sequences.
    let duplication: MateReport['duplication'] = { levels: [], remaining: 100 }
    let overrepresented: OverrepresentedSequence[] = []
    if (long) {
      skip('duplication', 'Not run for long reads: no two long reads start alike by chance, so read starts say nothing about duplicates.')
      skip('overrepresented', 'Not run for long reads, for the same reason.')
    } else {
      duplication = duplicationLevels(m.dup, m.dupCountAtLimit, reads)
      flag('duplication', duplication.remaining, L.duplication, true)
      overrepresented = overrepresentedSequences(m.dup, reads)
      status.overrepresented = overrepresented.length === 0 ? 'pass' : overrepresented[0].percent > L.overrepresented.error ? 'fail' : 'warn'
      if (m.dupFrozen) {
        notes.duplication = `Only the first ${DUPLICATION_TRACKED.toLocaleString('en-US')} distinct sequences are tracked, as in FastQC; the levels for the rest are estimated from them.`
      }
    }

    // Adapter content.
    const adapters: MateReport['adapters'] = []
    if (long) skip('adapters', 'Not run for long reads: their adapters are cut by the basecaller, and the probes are for Illumina libraries.')
    else if (P < PROBE + 1) {
      // FastQC warns when no read is longer than the probes, as it could not look.
      status.adapters = 'warn'
      notes.adapters = `No read is longer than the ${PROBE}-base adapter probes, so adapters could not be looked for.`
    } else {
      let max = 0
      const positions = P - PROBE + 1
      ADAPTERS.forEach((ad, a) => {
        const percent: number[] = []
        let acc = 0
        for (let p = 0; p < positions; p++) {
          acc += m.adapterStarts[a][p]
          const v = reads ? (acc * 100) / reads : 0
          max = Math.max(max, v)
          percent.push(r3(v))
        }
        adapters.push({ name: ad.name, percent })
      })
      flag('adapters', max, L.adapters)
    }

    return {
      reads,
      bases: m.bases,
      minLength,
      maxLength: m.maxLength,
      gc: called ? r3(((C + G) * 100) / called) : 0,
      lowestQuality,
      baseQuality: long || noQuality ? [] : baseQuality,
      baseContent,
      baseN,
      seqQuality,
      seqGc,
      lengths: lengthHistogram(m.lengths, minLength, m.maxLength, long),
      emptyReads: m.emptyReads,
      duplication,
      overrepresented,
      adapters,
      tiles,
      status,
      notes,
    }
  }
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** Each tile's mean quality at each position less the mean of the tiles there (FastQC averages the tile means, unweighted). */
function tileDeviations(tiles: Map<number, TileSums>, positions: number): NonNullable<MateReport['tiles']> {
  const ids = [...tiles.keys()].sort((a, b) => a - b)
  const means = ids.map(id => {
    const t = tiles.get(id)!
    return Array.from({ length: positions }, (_, p) => (p < t.n.length && t.n[p] ? t.sum[p] / t.n[p] : NaN))
  })
  let maxDeviation = 0
  const deviation = means.map(() => new Array<number>(positions).fill(0))
  for (let p = 0; p < positions; p++) {
    let sum = 0
    let k = 0
    for (const row of means) if (!Number.isNaN(row[p])) { sum += row[p]; k++ }
    if (k === 0) continue
    const avg = sum / k
    means.forEach((row, t) => {
      if (Number.isNaN(row[p])) return
      const d = row[p] - avg
      deviation[t][p] = Math.round(d * 100) / 100
      maxDeviation = Math.max(maxDeviation, Math.abs(d))
    })
  }
  return { ids, deviation, maxDeviation: r3(maxDeviation) }
}

/**
 * FastQC's theoretical GC distribution: a normal distribution centred on the
 * mode (averaged over the neighbouring bins within 10% of the modal count,
 * unless that run reaches 0 or 100%), with the spread of the reads around
 * it. The deviation is the summed difference from it, as a percentage of
 * the reads.
 */
export function gcFit(gc: Float64Array): MateReport['seqGc'] {
  const observed = Array.from(gc, r3)
  let total = 0
  let first = 0
  for (let i = 0; i < gc.length; i++) {
    total += gc[i]
    if (gc[i] > gc[first]) first = i
  }
  if (total === 0) return { observed, theoretical: new Array<number>(101).fill(0), deviation: 0 }
  const near = (i: number) => gc[i] > gc[first] - gc[first] / 10
  let mode = 0
  let k = 0
  let offTop = true
  for (let i = first; i < gc.length; i++) {
    if (near(i)) { mode += i; k++ } else { offTop = false; break }
  }
  let offBottom = true
  for (let i = first - 1; i >= 0; i--) {
    if (near(i)) { mode += i; k++ } else { offBottom = false; break }
  }
  mode = offTop || offBottom ? first : mode / k
  let variance = 0
  for (let i = 0; i < gc.length; i++) variance += (i - mode) ** 2 * gc[i]
  const sd = Math.sqrt(variance / (total - 1))
  const theoretical: number[] = []
  let deviation = 0
  for (let i = 0; i < gc.length; i++) {
    // All reads of one GC: the fit is the spike itself.
    const t = sd > 0 && Number.isFinite(sd)
      ? (total * Math.exp(-((i - mode) ** 2) / (2 * sd * sd))) / Math.sqrt(2 * Math.PI * sd * sd)
      : gc[i]
    theoretical.push(r3(t))
    deviation += Math.abs(t - gc[i])
  }
  return { observed, theoretical, deviation: r3((deviation / total) * 100) }
}

/**
 * The chance-corrected number of distinct sequences seen `observations`
 * times at duplication level `level` (FastQC's getCorrectedCount). Counting
 * stopped adding new sequences after `countAtLimit` reads, so a sequence of
 * this level may have been missed; scale up by the chance of having seen it.
 */
function correctedCount(countAtLimit: number, total: number, level: number, observations: number): number {
  if (countAtLimit === total) return observations
  if (total - observations < countAtLimit) return observations
  let notSeen = 1
  const limitOfCaring = 1 - observations / (observations + 0.01)
  for (let i = 0; i < countAtLimit; i++) {
    notSeen *= (total - i - level) / (total - i)
    if (notSeen < limitOfCaring) { notSeen = 0; break }
  }
  return observations / (1 - notSeen)
}

/** FastQC's bin for a duplication level: 1 to 9, then >10, >50, >100, >500, >1k, >5k, >10k. */
function levelSlot(level: number): number {
  const s = level - 1
  if (s > 9999) return 15
  if (s > 4999) return 14
  if (s > 999) return 13
  if (s > 499) return 12
  if (s > 99) return 11
  if (s > 49) return 10
  if (s > 9) return 9
  return s
}

export function duplicationLevels(seqs: Map<string, number>, countAtLimit: number, total: number): MateReport['duplication'] {
  const byLevel = new Map<number, number>()
  for (const c of seqs.values()) byLevel.set(c, (byLevel.get(c) ?? 0) + 1)
  const levels = new Array<number>(16).fill(0)
  let dedup = 0
  let raw = 0
  for (const [level, n] of byLevel) {
    const c = correctedCount(countAtLimit, total, level, n)
    dedup += c
    raw += c * level
    levels[levelSlot(level)] += c * level
  }
  return {
    levels: levels.map(x => (raw ? r3((x / raw) * 100) : 0)),
    remaining: raw ? r3((dedup / raw) * 100) : 100,
  }
}

/** Sequences making up more than 0.1% of the reads, most common first, with their likely source. */
export function overrepresentedSequences(seqs: Map<string, number>, total: number): OverrepresentedSequence[] {
  if (total === 0) return []
  const out: OverrepresentedSequence[] = []
  for (const [seq, count] of seqs) {
    const percent = (count / total) * 100
    if (percent > L.overrepresented.warn) out.push({ seq, count, percent: r3(percent), source: null })
  }
  out.sort((a, b) => b.count - a.count)
  for (const o of out) o.source = findContaminant(o.seq)
  return out
}
