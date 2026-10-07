/**
 * Short reads to contigs with a de Bruijn graph (dbg.ts).
 *
 * 1. The read set's k-mer spectrum (spectrum.ts) gives the genome's length
 *    and coverage.
 * 2. Reads are sampled down to about TARGET_DEPTH of that genome (at most
 *    MAX_BASES): past that, more reads add error k-mers but no contiguity.
 * 3. The graph is built at several k, from 21 up to what the read length
 *    allows while k-mer coverage stays at least MIN_KMER_COVERAGE. A larger
 *    k spans longer repeats, so joins more, but needs more coverage. Each k
 *    gets its own solid-k-mer threshold (the valley of its spectrum), and
 *    the k giving the best N50 (then the fewest contigs, then the larger k)
 *    is kept, as SPAdes and Unicycler weigh several k. On a genome of a
 *    megabase or more, k under 55 is skipped when two larger k qualify: a
 *    bacterial genome's repeats break a small-k graph into far more pieces,
 *    and each k costs a pass over all the sampled reads.
 * 4. Unitigs at least `minContig` long are the contigs.
 * 5. Paired reads join contigs across repeats shorter than their insert
 *    (pairs.ts).
 *
 * The k-mer table and the Bloom filter in front of it are sized once from
 * the spectrum (the genome's k-mers, and the error k-mers the sampled reads
 * will bring), rather than grown by doubling.
 */

import type { AssembledContig, DeNovoContigInfo, DeNovoSettings, ShortAssemblyReport } from './types'
import { applyThreshold, cleanGraph, n50, unitigLinks, type Unitig } from './dbg'
import { dedupeLinks, type GraphLink, type StoredGraph, type Strand } from './graph'
import { countKmers, readSetSpectrum, tableHistogram, type KmerSpectrum } from './spectrum'
import { joinWithPairs, type PairUnitig } from './pairs'

export const TARGET_DEPTH = 100
export const MAX_BASES = 300_000_000
export const MIN_KMER_COVERAGE = 10
export const K_CANDIDATES = [21, 33, 55, 77, 99, 127]
/** Genomes past this are refused (memory of the k-mer tables). */
export const MAX_GENOME = 15_000_000
/** From this genome length, small k are skipped when larger ones qualify. */
export const LARGE_GENOME = 1_000_000
/** Pairs placed for joining: about this depth of them. */
export const PAIR_DEPTH = 40

export interface ShortAssemblyOptions {
  readSet: { chunks: number; bases: number; meanLength: number; paired?: boolean }
  settings: DeNovoSettings
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  onProgress?: (done: number, total: number) => void
}

/**
 * The solid threshold for a k: the lowest point of the valley between the
 * error k-mers and the genome's peak (the first such count when several are
 * as low, as when deep coverage leaves the valley empty), kept between 2 and
 * a third of the peak, so a stretch of the genome covered at a third of the
 * usual depth still stays in.
 */
export function solidThreshold(counts: readonly number[]): number {
  let rise = 2
  for (let c = 2; c + 1 < counts.length; c++) {
    if (counts[c] < counts[c + 1]) { rise = c; break }
  }
  let peak = rise
  for (let c = rise; c < counts.length; c++) if (counts[c] > counts[peak]) peak = c
  let valley = 2
  for (let c = 2; c < peak; c++) if (counts[c] < counts[valley]) valley = c
  return Math.max(2, Math.min(valley, Math.floor(peak / 3)))
}

/** The k-values worth trying for reads of this length at this depth, for a genome this long. */
export function kChoices(meanLength: number, depth: number | null, fixed: number | null, genome: number | null = null): number[] {
  if (fixed) return [fixed]
  const ks = K_CANDIDATES.filter(k => {
    if (k > meanLength * 0.8) return false
    // k-mer coverage: each read of length L has L - k + 1 k-mers.
    return depth === null || depth * (meanLength - k + 1) / meanLength >= MIN_KMER_COVERAGE || k === 21
  })
  if (genome !== null && genome >= LARGE_GENOME && ks.filter(k => k >= 55).length >= 2) return ks.filter(k => k >= 55)
  return ks
}

/**
 * Distinct k-mers the sampled reads bring at k: the genome's, and the error
 * k-mers, from the 21-mers below the spectrum's trough (each error makes up
 * to k new k-mers, so their number grows with k).
 */
export function expectedKmers(s: KmerSpectrum, k: number, readShare: number): { genome: number; errors: number } {
  const genome = s.genomeSize ?? 0
  let low = 0
  const trough = s.trough ?? 2
  for (let c = 1; c < Math.min(trough, s.counts.length); c++) low += s.counts[c]
  return { genome, errors: (low / s.fraction) * readShare * (k / s.k) }
}

export async function assembleShortReads(o: ShortAssemblyOptions): Promise<{ contigs: AssembledContig[]; report: ShortAssemblyReport; info: DeNovoContigInfo[]; graph: StoredGraph }> {
  const s = o.settings
  const minContig = Math.max(50, s.minContig ?? 200)
  const usePairs = !!o.readSet.paired && s.pairs !== false
  // Progress: spectrum 15%, the k-values 70% (75% without pairs), pairs 15%.
  const part = (from: number, width: number) => (d: number, t: number) => o.onProgress?.(Math.round(1000 * (from + (t ? (d / t) * width : 0))), 1000)
  const kWidth = usePairs ? 0.7 : 0.85

  // 1. Genome length from the spectrum.
  const spectrum: KmerSpectrum = await readSetSpectrum({ chunks: o.readSet.chunks, bases: o.readSet.bases, getChunk: o.getChunk, onProgress: part(0, 0.15) })
  const genome = spectrum.genomeSize
  if (genome !== null && genome > MAX_GENOME) {
    throw new Error(`The genome looks about ${(genome / 1e6).toFixed(1)} Mb long (from its k-mers). Short reads can be assembled de novo for genomes up to ${MAX_GENOME / 1e6} Mb.`)
  }

  // 2. Down to TARGET_DEPTH.
  const wanted = Math.min(MAX_BASES, genome ? genome * TARGET_DEPTH : MAX_BASES)
  const readShare = Math.min(1, wanted / Math.max(1, o.readSet.bases))
  const depth = genome ? (o.readSet.bases * readShare) / genome : null
  const ks = kChoices(o.readSet.meanLength, depth, s.k ?? null, genome)
  if (ks.length === 0) throw new Error('The reads are too short to assemble (k of 21 needs reads of at least 27 bases).')

  // 3. Each k.
  const tried: ShortAssemblyReport['tried'] = []
  let best: { k: number; unitigs: Unitig[]; all: Unitig[]; links: GraphLink[]; threshold: number; removed: number; reads: number; bases: number } | null = null
  let bestScore: [number, number] = [-1, 0]
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    const want = expectedKmers(spectrum, k, readShare)
    const { table, reads, bases } = await countKmers({
      k, chunks: o.readSet.chunks, getChunk: o.getChunk, readShare,
      bloomFor: Math.max(1_000_000, Math.ceil(want.genome + want.errors)),
      // The genome's k-mers, error k-mers seen twice and the filter's false yeses (a few percent of the errors).
      expected: want.genome ? Math.ceil(want.genome * 1.15 + want.errors * 0.04) : undefined,
      onProgress: part(0.15 + (kWidth * i) / ks.length, (kWidth * 0.8) / ks.length),
    })
    const threshold = solidThreshold(tableHistogram(table))
    applyThreshold(table, threshold)
    const { unitigs, removed } = cleanGraph(table)
    const kept = unitigs.filter(u => u.seq.length >= minContig)
    const lengths = kept.map(u => u.seq.length)
    const score: [number, number] = [n50(lengths), -kept.length]
    tried.push({ k, threshold, contigs: kept.length, n50: score[0], total: lengths.reduce((a, b) => a + b, 0) })
    // Ties go to the larger k, which spans longer repeats.
    if (kept.length && (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] >= bestScore[1]))) {
      bestScore = score
      // The joins are read now, while this k's table is at hand.
      best = { k, unitigs: kept, all: unitigs, links: unitigLinks(table, unitigs), threshold, removed, reads, bases }
    }
    o.onProgress?.(Math.round(1000 * (0.15 + (kWidth * (i + 1)) / ks.length)), 1000)
  }
  if (!best) throw new Error(`No contig of ${minContig} bp or more came out at any k tried (${ks.join(', ')}). The reads may have too little coverage, or too many errors.`)

  // 4. Contigs: the long unitigs, joined across short repeats by the pairs when there are pairs.
  const tigs: PairUnitig[] = best.all.map(u => ({ seq: u.seq, circular: u.circular, coverage: u.coverage }))
  const dedupedLinks = dedupeLinks(best.links)
  let made: { seq: string; circular: boolean; coverage: number; parts: [number, Strand][] }[]
  let pairs: ShortAssemblyReport['pairs']
  if (usePairs) {
    const r = await joinWithPairs({
      unitigs: tigs, links: dedupedLinks, k: best.k, minContig, chunks: o.readSet.chunks, getChunk: o.getChunk,
      pairShare: Math.min(1, genome ? (PAIR_DEPTH * genome) / Math.max(1, o.readSet.bases) : 1),
      onProgress: part(0.85, 0.15),
    })
    made = r.contigs
    pairs = r.report
  } else {
    made = tigs.map((u, t) => ({ ...u, parts: [[t, '+']] as [number, Strand][] })).filter(c => c.seq.length >= minContig)
  }
  made = made.filter(c => c.seq.length >= minContig).sort((a, b) => b.seq.length - a.seq.length)
  const contigs: AssembledContig[] = made.map((c, i) => ({ name: `Contig ${i + 1}`, bases: c.seq, circular: c.circular }))
  const info: DeNovoContigInfo[] = made.map((c, i) => ({
    name: `Contig ${i + 1}`, length: c.seq.length, circular: c.circular, kmerCoverage: Math.round(c.coverage * 10) / 10,
  }))
  return {
    contigs,
    info,
    graph: shortGraph(best.all, dedupedLinks, made, best.k),
    report: {
      k: best.k, threshold: best.threshold, tried, spectrum,
      readsUsed: best.reads, basesUsed: best.bases, cleaned: best.removed, minContig,
      ...(pairs ? { pairs } : {}),
    },
  }
}

/**
 * The cleaned graph of the k kept: the unitigs making each contig first (in
 * contig order; "Contig 2" when one unitig is the whole contig, "Contig 2,
 * part 1" when the pairs joined several), then the shorter pieces, longest
 * first, named Piece 1, Piece 2...
 */
function shortGraph(all: readonly Unitig[], links: readonly GraphLink[], contigs: readonly { parts: [number, Strand][] }[], k: number): StoredGraph {
  const order: number[] = []
  const names: string[] = []
  const contigOf: (number | null)[] = []
  const placed = new Set<number>()
  contigs.forEach((c, i) => {
    const parts = c.parts.filter(([t]) => !placed.has(t))
    parts.forEach(([t], j) => {
      placed.add(t)
      order.push(t)
      names.push(c.parts.length === 1 ? `Contig ${i + 1}` : `Contig ${i + 1}, part ${j + 1}`)
      contigOf.push(i)
    })
  })
  const pieces = all.map((_, t) => t).filter(t => !placed.has(t)).sort((a, b) => all[b].seq.length - all[a].seq.length)
  pieces.forEach((t, j) => { order.push(t); names.push(`Piece ${j + 1}`); contigOf.push(null) })
  const pos = new Map(order.map((t, i) => [t, i]))
  return {
    version: 1,
    overlap: k - 1,
    coverageUnit: 'k-mer',
    segments: order.map((t, i) => ({
      name: names[i],
      length: all[t].seq.length,
      coverage: Math.round(all[t].coverage * 10) / 10,
      circular: all[t].circular,
      contig: contigOf[i],
    })),
    links: dedupeLinks(links.map(([a, as, b, bs]): GraphLink => [pos.get(a)!, as, pos.get(b)!, bs])),
    sequences: order.map(t => all[t].seq),
  }
}
