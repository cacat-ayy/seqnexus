/**
 * Counting the k-mers of a read set, and its k-mer spectrum.
 *
 * The spectrum is how many distinct k-mers occur once, twice, three
 * times... In reads of a genome sequenced to some depth it has two parts: a
 * steep fall at the left from k-mers seen once or a few times (sequencing
 * errors, each making up to k new k-mers), and a peak at the k-mer coverage,
 * the genome's own k-mers. The valley between them (the trough) separates
 * the two, and the genome's length is the number of k-mers at or past the
 * trough, each counted as often as it occurs, divided by the peak's
 * coverage. Repeats count once per copy, so the estimate is the length of
 * the genome with each repeat counted as often as it occurs, as GenomeScope's
 * simplest estimate.
 *
 * Large read sets are sampled by k-mer, not by read: only k-mers whose hash
 * falls in the lowest share `fraction` of hashes are counted, so each
 * k-mer is either counted every time it occurs or never. The spectrum keeps
 * its shape (a k-mer's count is not thinned), and the genome length is
 * scaled back up by the fraction. That keeps memory to a few million k-mers
 * whatever the read set's size (the idea of FracMinHash sketches).
 */

import { decodeChunk, type ReadChunk } from '../codec'
import { BloomFilter, KmerRoller, KmerTable, hashWords } from './kmer'
import type { Histogram } from '../types'

/** k for the spectrum: long enough to be unique in a bacterial genome, short enough for coverage. */
export const SPECTRUM_K = 21
/** About this many distinct k-mers are counted at most, by sampling. */
export const SPECTRUM_KMERS = 8_000_000
/** Counts above this go in the last bin. */
export const SPECTRUM_MAX = 10_000

export interface KmerSpectrum {
  k: number
  /** Share of k-mers (by hash) counted. */
  fraction: number
  /** Read bases looked at. */
  bases: number
  /** counts[c] = distinct k-mers seen c times (counts[0] unused), up to `max`. */
  counts: number[]
  /** First count where the error k-mers give way to the genome's (null when there is no such valley). */
  trough: number | null
  /** The genome's k-mer coverage: the peak past the trough. */
  peak: number | null
  /** Estimated genome length, bp. */
  genomeSize: number | null
  /** Share of all k-mer occurrences below the trough (mostly sequencing errors). */
  errorShare: number | null
}

/** Code (0-3, -1 for anything else) of each base of read i of a chunk. */
export function readCodes(ch: ReadChunk, i: number): Uint8Array {
  return ch.codes.subarray(ch.offsets[i], ch.offsets[i + 1])
}

/** BAM_NIBBLES order (=ACMGRSVTWYHKDBN) to 0-3, -1 for ambiguity codes. */
export const NIBBLE_TO_CODE = Int8Array.from([-1, 0, 1, -1, 2, -1, -1, -1, 3, -1, -1, -1, -1, -1, -1, -1])

/**
 * Trough and peak of a spectrum: the counts first rise again at some count
 * (from 2); the peak is the count with the most k-mers past that, and the
 * trough the lowest count before the peak. Null when the counts only fall (too little coverage to tell the
 * genome from the errors).
 */
export function analyseSpectrum(counts: readonly number[], fraction: number): Pick<KmerSpectrum, 'trough' | 'peak' | 'genomeSize' | 'errorShare'> {
  let rise: number | null = null
  for (let c = 2; c + 1 < counts.length; c++) {
    if (counts[c] < counts[c + 1]) { rise = c; break }
  }
  if (rise === null) return { trough: null, peak: null, genomeSize: null, errorShare: null }
  let peak = rise
  for (let c = rise; c < counts.length; c++) if (counts[c] > counts[peak]) peak = c
  // The trough is the bottom of the valley (its first count, when deep coverage leaves it empty).
  let trough = 2
  for (let c = 2; c < peak; c++) if (counts[c] < counts[trough]) trough = c
  let genome = 0
  let all = 0
  for (let c = 1; c < counts.length; c++) {
    all += c * counts[c]
    if (c >= trough) genome += c * counts[c]
  }
  // A peak at the very end of the counted range is not a peak.
  if (peak >= counts.length - 1) return { trough, peak: null, genomeSize: null, errorShare: all ? 1 - genome / all : null }
  return { trough, peak, genomeSize: Math.round(genome / peak / fraction), errorShare: all ? 1 - genome / all : null }
}

export interface CountOptions {
  k: number
  chunks: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  /** Count only k-mers whose hash is in this lowest share (1: all). */
  fraction?: number
  /** Keep out k-mers seen once, with a Bloom filter sized for this many distinct k-mers. */
  bloomFor?: number
  /** About how many k-mers the table will hold, to size it once rather than grow it. */
  expected?: number
  /** Look at each read with this chance (deterministic by its index); 1: all. */
  readShare?: number
  /** Stop after this many read bases. */
  maxBases?: number
  onProgress?: (done: number, total: number) => void
}

/** Deterministic pseudo-random number in [0, 1) for a read index. */
export function readDraw(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Count the canonical k-mers of a read set. With `bloomFor`, a k-mer goes in
 * the table only from its second sighting (counted as 2 then), so the
 * one-off error k-mers never take a slot.
 */
export async function countKmers(o: CountOptions): Promise<{ table: KmerTable; bases: number; reads: number }> {
  const roller = new KmerRoller(o.k)
  const table = o.expected ? KmerTable.forKmers(o.k, o.expected) : new KmerTable(o.k, 1 << 16)
  const bloom = o.bloomFor ? new BloomFilter(o.bloomFor) : null
  const limit = o.fraction !== undefined && o.fraction < 1 ? Math.floor(o.fraction * 4294967296) : null
  const W = roller.W
  let bases = 0
  let reads = 0
  let g = 0
  for (let c = 0; c < o.chunks; c++) {
    const packed = await o.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const ch = decodeChunk(packed)
    for (let i = 0; i < ch.count; i++, g++) {
      if (o.readShare !== undefined && o.readShare < 1 && readDraw(g) >= o.readShare) continue
      const codes = readCodes(ch, i)
      bases += codes.length
      reads++
      roller.reset()
      for (let p = 0; p < codes.length; p++) {
        if (!roller.push(NIBBLE_TO_CODE[codes[p]])) continue
        const key = roller.canonical()
        const h = hashWords(key, 0, W)
        if (limit !== null && h >= limit) continue
        if (bloom) {
          // From the second sighting: inserted as 2, then counted on.
          if (bloom.seen(key, 0, W, h)) table.add(key, 1, 0, h, 2)
        } else table.add(key, 1, 0, h)
      }
      if (o.maxBases && bases >= o.maxBases) break
    }
    o.onProgress?.(c + 1, o.chunks)
    if (o.maxBases && bases >= o.maxBases) break
  }
  return { table, bases, reads }
}

/** counts[c] = k-mers in the table seen c times, up to `max` (the last bin holds everything above). */
export function tableHistogram(table: KmerTable, max = SPECTRUM_MAX): number[] {
  const counts = new Array<number>(max + 1).fill(0)
  for (const s of table.slots()) counts[Math.min(max, table.counts[s])]++
  return counts
}

/** The k-mer spectrum of a read set, sampled to about SPECTRUM_KMERS distinct k-mers. */
export async function readSetSpectrum(o: {
  chunks: number
  bases: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  onProgress?: (done: number, total: number) => void
}): Promise<KmerSpectrum> {
  // Distinct k-mers grow with the bases (errors) and the genome; take a share
  // that keeps them to about SPECTRUM_KMERS even if one in four bases started a new one.
  const fraction = Math.min(1, SPECTRUM_KMERS / Math.max(1, o.bases * 0.25))
  const { table, bases } = await countKmers({ k: SPECTRUM_K, chunks: o.chunks, getChunk: o.getChunk, fraction, onProgress: o.onProgress })
  const counts = tableHistogram(table)
  // Trailing empty bins are not kept.
  let last = counts.length - 1
  while (last > 1 && counts[last] === 0) last--
  const kept = counts.slice(0, last + 1)
  return { k: SPECTRUM_K, fraction, bases, counts: kept, ...analyseSpectrum(kept, fraction) }
}

/**
 * The spectrum as a chart: k-mers by how often they occur, each weighted by
 * that count (so the bars are k-mer occurrences, and the genome's peak is
 * not dwarfed by the many error k-mers seen once), up to three times the
 * peak or as far as 99.5% of the occurrences, in at most about 80 bins.
 */
export function spectrumBins(s: KmerSpectrum): Histogram {
  const last = s.counts.length - 1
  // As far as 99.5% of the occurrences go (a high-copy plasmid's peak far right included), at least three times the peak.
  let total = 0
  for (let c = 1; c <= last; c++) total += c * s.counts[c]
  let reach = 1
  for (let acc = 0; reach <= last; reach++) { acc += reach * s.counts[reach]; if (acc >= 0.995 * total) break }
  const top = Math.max(2, Math.min(last, Math.max(reach, s.peak ? Math.max(3 * s.peak, 20) : 100)))
  const width = Math.max(1, Math.ceil(top / 80))
  const edges: number[] = [1]
  const counts: number[] = []
  for (let lo = 1; lo <= top; lo += width) {
    let sum = 0
    for (let c = lo; c < lo + width && c <= top; c++) sum += c * (s.counts[c] ?? 0)
    counts.push(sum)
    edges.push(Math.min(lo + width, top + 1))
  }
  return { edges, counts }
}
