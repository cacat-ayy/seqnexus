/**
 * Whole plasmids and amplicons from long reads: seed and polish.
 *
 * 1. Peaks: the read lengths are scanned for peaks (clusters.ts); each peak
 *    is a product sequenced whole, and its best read near the peak's length
 *    is the product's first draft.
 * 2. Polishing: the best reads (all of them, or the highest-quality ones up
 *    to POLISH_BASES) are aligned to every draft at once with minimap2, so
 *    each read goes to the product it came from, and each draft becomes the
 *    reads' majority consensus (polish.ts). This repeats until a round
 *    changes nothing, or for `rounds` rounds.
 * 3. In the first round each draft is judged:
 *    - circular when reads run across its origin (it is aligned to as
 *      circular in that round, with its start appended), linear when they
 *      stop there. A circular draft closes itself: bases a seed read had
 *      twice, or lacked, at its ends are deleted or inserted by the reads
 *      across the origin;
 *    - dropped when too few reads line up with it end to end (a peak of
 *      broken molecules that happened to share a length), when it is a
 *      dimer or a repeat of a shorter product (both have the same k-mers,
 *      kmers.ts), or when it is a linear piece of another product.
 *    A linear contig's ends are trimmed back to where reads cover them and
 *    extended where reads go on past them and agree on what is there.
 *
 * A seed read has a few percent of errors; the first round removes most of
 * them, and two or three more leave what the reads' consensus says. What a
 * majority consensus of raw reads cannot fix stays: on nanopore reads,
 * mainly homopolymer lengths that most reads get wrong the same way, which
 * a model-based polisher (medaka) would correct.
 */

import { decodeChunk } from '../codec'
import { minimap2Args, parseSamLine, referenceFasta, type MapPreset, type ToolRunner } from '../mapper'
import type { Histogram } from '../types'
import { lengthPeaks, pickSeed } from './clusters'
import { containment, kmerSet } from './kmers'
import { addRecord, medianDepth, newPileup, polish, polishLinear, type DraftPileup } from './polish'
import type { AssembledContig, DeNovoContigInfo, DeNovoPeak, DeNovoReport, DeNovoSettings } from './types'

/** Read bases used for polishing at most: the highest-quality reads up to this. */
export const POLISH_BASES = 20_000_000
/**
 * Share of a polished contig's k-mers another must have for it to count as
 * inside the other. Polished contigs keep nearly all their k-mers, while a
 * plasmid with an 800 bp deletion still has 85% of the full one's, so the
 * bar is high, and two contigs count as the same sequence only when their
 * lengths also agree.
 */
export const CONTAINED = 0.9
/** Lengths within this share of each other, for two contigs with the same k-mers to be the same sequence. */
const SAME_LENGTH = 0.01
/** First round: at most this many of a peak's reads polish its seed. */
export const PEAK_READS = 200
/** A product at least this many times as long as another with the same k-mers is its dimer (or trimer). */
const MULTIMER = 1.6

export interface LongAssemblyOptions {
  readSet: { chunks: number }
  settings: DeNovoSettings
  preset: MapPreset
  minimap2: ToolRunner
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  /** Lengths and qualities already read (scanReads), to save a pass. */
  scan?: ReadScan
  onProgress?: (done: number, total: number) => void
}

/** Every read's length and mean quality, in read set order. */
export interface ReadScan {
  lengths: number[]
  quality: number[]
}

/** One pass over the reads for their lengths and mean qualities. */
export async function scanReads(chunks: number, getChunk: (index: number) => Promise<Uint8Array | undefined>, onChunk?: () => void): Promise<ReadScan> {
  const lengths: number[] = []
  const quality: number[] = []
  for (let c = 0; c < chunks; c++) {
    const packed = await getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const ch = decodeChunk(packed)
    for (let i = 0; i < ch.count; i++) {
      lengths.push(ch.length(i))
      quality.push(ch.hasQuality ? meanQuality(ch.qual, ch.offsets[i], ch.offsets[i + 1]) : 0)
    }
    onChunk?.()
  }
  return { lengths, quality }
}

/** The largest of many numbers (the spread operator overflows the stack past about 100,000). */
export function maxOf(xs: readonly number[]): number {
  let m = 0
  for (const x of xs) if (x > m) m = x
  return m
}

export const NO_PRODUCT = (minReads: number) =>
  `No product was found: no read length is shared by at least ${minReads} reads standing out from the rest. ` +
  'This method assembles plasmids and amplicons sequenced whole, whose full-length reads make a peak in the read lengths (see the read set\'s length chart).'

const ERR = Array.from({ length: 94 }, (_, q) => 10 ** (-q / 10))

/** Mean quality of a read from its error chances (as stats.ts computes it). */
export function meanQuality(q: Uint8Array, from: number, to: number): number {
  if (to <= from) return 0
  let e = 0
  for (let p = from; p < to; p++) e += ERR[Math.min(93, q[p])]
  return -10 * Math.log10(Math.max(1e-10, e / (to - from)))
}

/** A histogram of read lengths up to a little past the longest peak. */
export function lengthHistogram(lengths: readonly number[], top: number): Histogram {
  const hi = Math.max(100, top)
  const raw = hi / 100
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const n = Math.ceil(hi / step)
  const counts = new Array<number>(n).fill(0)
  for (const l of lengths) {
    const b = Math.floor(l / step)
    if (b < n) counts[b]++
  }
  return { edges: Array.from({ length: n + 1 }, (_, i) => i * step), counts }
}

interface Draft {
  peak: number
  seed: string
  bases: string
  /** Null until the first round has decided. */
  circular: boolean | null
  changes: number[]
  trimmed: number
  extended: number
  fullLength: number
}

const draftRef = (name: string) => (name.startsWith('ref') ? Number(name.slice(3)) : -1)

export async function assembleLongReads(o: LongAssemblyOptions): Promise<{ contigs: AssembledContig[]; report: DeNovoReport }> {
  const s = o.settings
  const minReads = Math.max(2, Math.round(s.minReads))
  const rounds = Math.max(1, Math.round(s.rounds))
  const C = o.readSet.chunks
  const total = 2 * C + rounds * 10
  let done = 0
  const step = (n = 1) => { done += n; o.onProgress?.(Math.min(done, total), total) }
  const chunk = async (c: number) => {
    const packed = await o.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    return decodeChunk(packed)
  }

  // 1. Lengths and qualities.
  let lengths: number[]
  let quality: number[]
  if (o.scan) {
    ({ lengths, quality } = o.scan)
    step(C)
  } else {
    ({ lengths, quality } = await scanReads(C, o.getChunk, () => step()))
  }
  const found = lengthPeaks(lengths, { minReads })
  const top = found.reduce((m, p) => Math.max(m, p.length), 0)
  const histogram = lengthHistogram(lengths, top ? Math.min(maxOf(lengths), Math.ceil(top * 1.5)) : maxOf(lengths))
  if (found.length === 0) throw new Error(NO_PRODUCT(minReads))
  const seeds = found.map(p => pickSeed(p, lengths, quality))

  // 2. Reads for polishing. First round: each product's own peak reads (the
  // best PEAK_READS of them). Later rounds: the best reads overall, up to
  // POLISH_BASES, against every product at once.
  const byQuality = lengths.map((_, i) => i).filter(i => lengths[i] >= 100).sort((a, b) => quality[b] - quality[a])
  const polishSet = new Uint8Array(lengths.length)
  let bases = 0
  for (const i of byQuality) {
    if (bases >= POLISH_BASES) break
    polishSet[i] = 1
    bases += lengths[i]
  }
  const peakOf = new Map<number, number>()
  found.forEach((p, k) => {
    for (const i of [...p.members].sort((a, b) => quality[b] - quality[a]).slice(0, PEAK_READS)) peakOf.set(i, k)
  })
  const seedOf = new Map(seeds.map((r, k) => [r, k]))
  const seedSeq: string[] = new Array(seeds.length)
  const seedName: string[] = new Array(seeds.length)
  const fq: string[] = []
  const peakFq: string[][] = found.map(() => [])
  let polishReads = 0
  let polishLongest = 0
  let g = 0
  for (let c = 0; c < C; c++) {
    const ch = await chunk(c)
    for (let i = 0; i < ch.count; i++, g++) {
      const k = seedOf.get(g)
      if (k !== undefined) { seedSeq[k] = ch.seq(i); seedName[k] = ch.ids[i] }
      const peak = peakOf.get(g)
      if (!polishSet[g] && peak === undefined) continue
      const rec = `@r${g}\n${ch.seq(i)}\n+\n${ch.hasQuality ? ch.qualText(i) : 'I'.repeat(ch.length(i))}\n`
      polishLongest = Math.max(polishLongest, ch.length(i))
      if (peak !== undefined) peakFq[peak].push(rec)
      if (polishSet[g]) { fq.push(rec); polishReads++ }
    }
    step()
  }
  const fastq = fq.join('')
  fq.length = 0

  const peaks: DeNovoPeak[] = found.map(p => ({ length: p.length, reads: p.members.length, contig: null }))
  let drafts: Draft[] = found.map((_, k) => ({
    peak: k, seed: seedName[k], bases: seedSeq[k].toUpperCase().replace(/[^ACGT]/g, 'N'),
    circular: null, changes: [], trimmed: 0, extended: 0, fullLength: 0,
  }))

  const align = async (list: readonly Draft[], reads: string): Promise<DraftPileup[]> => {
    const refs = list.map((d, i) => ({ name: `ref${i}`, tabId: null, bases: d.bases, circular: d.circular !== false }))
    const res = await o.minimap2(minimap2Args(o.preset, false), { 'ref.fa': referenceFasta(refs, Math.max(1000, polishLongest + 100)), 'r1.fq': reads }, ['out.sam'])
    const sam = res.files['out.sam']
    if (res.exitCode !== 0 || sam === null) {
      throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    const piles = list.map(d => newPileup(d.bases.length, d.circular !== false))
    let from = 0
    while (from < sam.length) {
      let to = sam.indexOf('\n', from)
      if (to < 0) to = sam.length
      if (sam[from] !== '@' && to > from) {
        const f = parseSamLine(sam.slice(from, to), draftRef)
        if (f.ref >= 0 && f.ref < piles.length) addRecord(piles[f.ref], f)
      }
      from = to + 1
    }
    return piles
  }

  const polishDraft = (d: Draft, p: DraftPileup): number => {
    d.fullLength = p.fullLength
    if (d.circular) {
      const r = polish(d.bases, p)
      d.bases = r.bases
      return r.changed
    }
    p.circular = false
    const r = polishLinear(d.bases, p)
    d.bases = r.bases
    d.trimmed += r.trimmedLeft + r.trimmedRight
    d.extended += r.extendedLeft + r.extendedRight
    return r.changed
  }

  for (let round = 0; round < rounds; round++) {
    let piles: DraftPileup[]
    if (round === 0) {
      // Each seed alone with its peak's reads: two raw reads differ by several
      // percent, too much for a read to tell its own product's seed from a
      // related one's (a plasmid with and without an insert, a dimer).
      piles = []
      for (const d of drafts) piles.push((await align([d], peakFq[d.peak].join('')))[0])
      peakFq.length = 0
      const keep = supported(drafts, piles, peaks, minReads)
      if (keep.length === 0) {
        throw new Error(`No product was kept. ${peaks.map(p => `${p.length.toLocaleString('en-US')} bp: ${p.dropped}`).join('. ')}.`)
      }
      drafts = keep.map(k => drafts[k])
      piles = keep.map(k => piles[k])
    } else {
      piles = await align(drafts, fastq)
    }
    let changed = 0
    drafts.forEach((d, k) => {
      const n = polishDraft(d, piles[k])
      d.changes.push(n)
      changed += n
    })
    // Compared once polished: a raw read's errors break too many of its k-mers.
    if (round === 0) drafts = distinct(drafts, peaks)
    step(10)
    // The first round saw only each product's own reads, so all of them get at least one more.
    if (changed === 0 && round > 0) break
  }
  o.onProgress?.(total, total)

  // Largest share first.
  drafts.sort((a, b) => b.fullLength - a.fullLength || b.bases.length - a.bases.length)
  const fullSum = drafts.reduce((n, d) => n + d.fullLength, 0)
  const contigs: AssembledContig[] = []
  const info: DeNovoContigInfo[] = []
  drafts.forEach((d, k) => {
    const name = `Contig ${k + 1}`
    peaks[d.peak].contig = k
    contigs.push({ name, bases: d.bases, circular: !!d.circular })
    info.push({
      name, length: d.bases.length, circular: !!d.circular, peak: peaks[d.peak].length, seed: d.seed,
      fullLength: d.fullLength, share: fullSum ? d.fullLength / fullSum : 0, changes: d.changes,
      ...(d.circular ? {} : { trimmed: d.trimmed, extended: d.extended }),
    })
  })
  return {
    contigs,
    report: { version: 1, settings: { ...s, minReads, rounds }, reads: lengths.length, polishReads, lengths: histogram, peaks, contigs: info },
  }
}

/**
 * After the first alignment: decide each draft's topology, and drop the
 * drafts too few reads line up with end to end. Returns the indices of the
 * drafts kept; each dropped peak says why.
 */
function supported(drafts: Draft[], piles: DraftPileup[], peaks: DeNovoPeak[], minReads: number): number[] {
  const kept: number[] = []
  drafts.forEach((d, k) => {
    const p = piles[k]
    d.circular = p.acrossOrigin >= Math.max(2, 0.2 * medianDepth(p))
    if (p.fullLength >= minReads) kept.push(k)
    else peaks[d.peak].dropped = `only ${p.fullLength} ${p.fullLength === 1 ? 'read lines' : 'reads line'} up with it end to end (at least ${minReads} needed), so these are broken molecules of about the same length, not a product`
  })
  return kept
}

/**
 * After the first polish: drop the drafts that repeat another product (a
 * dimer, or the same sequence twice) or are a linear piece of a longer one.
 * Shortest first, so a monomer is kept over its dimer.
 */
function distinct(drafts: Draft[], peaks: DeNovoPeak[]): Draft[] {
  const kept: { d: Draft; kmers: Set<number> }[] = []
  const bp = (d: Draft) => `the ${peaks[d.peak].length.toLocaleString('en-US')} bp product`
  const drop = (d: Draft, why: string) => { peaks[d.peak].dropped = why }
  for (const d of [...drafts].sort((a, b) => a.bases.length - b.bases.length)) {
    const kmers = kmerSet(d.bases, !!d.circular)
    let dropped = false
    for (let j = 0; j < kept.length; j++) {
      const a = kept[j]
      const aInD = containment(a.kmers, kmers)
      const dInA = containment(kmers, a.kmers)
      if (aInD >= CONTAINED && dInA >= CONTAINED) {
        const ratio = d.bases.length / a.d.bases.length
        const why = ratio >= MULTIMER ? `a dimer (or longer repeat) of ${bp(a.d)}, the same sequence over again`
          : ratio <= 1 + SAME_LENGTH ? `the same sequence as ${bp(a.d)}`
            : null
        if (why) {
          drop(d, why)
          dropped = true
          break
        }
      }
      if (aInD >= CONTAINED && !a.d.circular) {
        // A shorter linear product inside this one is a piece of it.
        drop(a.d, `a piece of ${bp(d)}`)
        kept.splice(j--, 1)
      }
    }
    if (!dropped) kept.push({ d, kmers })
  }
  return drafts.filter(d => kept.some(x => x.d === d))
}
