import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runTool } from '../../msa/engines/emscripten'
import { encodeChunk } from '../codec'
import type { ToolRunner } from '../mapper'
import { wasmSimd } from '../jobs'
import { scanReads } from './long'
import { assembleLongGenome, redundantDrafts, selectReads, sharedKmers } from './genome'
import {
  buildGraph, classify, OverlapKind, selfOverlapPeriod, transitiveReduction, trimReads, unitigs, unitigSequence, type Overlap,
} from './olc'
import { compareToExpected } from './compare'
import { kmerSet } from './kmers'
import { randomSequence, rng, simulateReads, withErrors, NANOPORE_ERRORS, type SimRead } from './simulate'
import { reverseComplement as revcomp } from '../../models/complement'
import { DEFAULT_DENOVO_SETTINGS } from './types'
import { longMethod } from './run'

const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')
const simd = wasmSimd()
const wasm = readFileSync(resolve(dir, simd ? 'minimap2-simd.wasm' : 'minimap2.wasm'))
const data = readFileSync(resolve(dir, 'minimap2.data'))
const glue = readFileSync(resolve(dir, simd ? 'minimap2-simd.js' : 'minimap2.js'), 'utf8')
const dataPackage = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
const minimap2: ToolRunner = (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage })

function chunksOf(reads: SimRead[]): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < reads.length; i += 200) out.push(encodeChunk(reads.slice(i, i + 200)))
  return out
}

async function assemble(reads: SimRead[], extra: Partial<Parameters<typeof assembleLongGenome>[0]> = {}) {
  const chunks = chunksOf(reads)
  const getChunk = async (i: number) => chunks[i]
  const scan = await scanReads(chunks.length, getChunk)
  return assembleLongGenome({
    readSet: { chunks: chunks.length, getChunk, technology: 'nanopore' },
    settings: { ...DEFAULT_DENOVO_SETTINGS, method: 'long-olc', rounds: 3 },
    preset: 'map-ont', minimap2, scan, ...extra,
  })
}

/** Differences between a contig and the true sequence, by banded alignment. */
function differences(contig: string, circular: boolean, truth: string): number {
  return compareToExpected({ contig, contigCircular: circular, expected: truth, expectedCircular: true }).differences.length
}

const ov = (q: number, qs: number, qe: number, t: number, ts: number, te: number, rev = false): Overlap =>
  ({ q, t, qs, qe, ts, te, rev, matches: qe - qs, block: qe - qs })

describe('string graph', () => {
  // Reads 0..3 of length 10,000 along a genome, each starting 4,000 on.
  const lengths = [10000, 10000, 10000, 10000]
  const full = { start: Int32Array.from([0, 0, 0, 0]), end: Int32Array.from(lengths) }

  it('classes overlaps as dovetails, containments and internal matches', () => {
    const d = classify(ov(0, 4000, 10000, 1, 0, 6000), full, 2000)
    expect(d.kind).toBe(OverlapKind.Dovetail)
    expect(d.arc).toMatchObject({ v: 0, w: 2, len: 4000, ol: 6000 })
    // The same on the other strand: read 1 reverse complemented.
    const r = classify(ov(0, 4000, 10000, 1, 4000, 10000, true), full, 2000)
    expect(r.arc).toMatchObject({ v: 0, w: 3, len: 4000 })
    expect(classify(ov(0, 0, 10000, 1, 0, 10000), { start: Int32Array.from([0, 0]), end: Int32Array.from([10000, 20000]) }, 2000).kind).toBe(OverlapKind.QueryContained)
    // Sharing only a repeat in their middles.
    expect(classify(ov(0, 4000, 6000, 1, 3000, 5000), full, 1000).kind).toBe(OverlapKind.Internal)
  })

  it('reduces transitive arcs and lays the reads out as one unitig', () => {
    const overlaps = [
      ov(0, 4000, 10000, 1, 0, 6000), ov(1, 4000, 10000, 2, 0, 6000), ov(2, 4000, 10000, 3, 0, 6000),
      ov(0, 8000, 10000, 2, 0, 2000), ov(1, 8000, 10000, 3, 0, 2000),
    ]
    const trim = trimReads(lengths, overlaps, 1, 1000)
    // The last read is covered by others only where read 2 reaches.
    expect(Array.from(trim.end)).toEqual([10000, 10000, 10000, 6000])
    const { graph } = buildGraph(4, overlaps, full, 1500)
    expect(transitiveReduction(graph)).toBe(4)
    const tigs = unitigs(graph, () => 10000)
    expect(tigs.length).toBe(1)
    expect(tigs[0].path.length).toBe(4)
    const genome = randomSequence(22000, rng(3))
    const read = (r: number) => genome.slice(r * 4000, r * 4000 + 10000)
    const seq = unitigSequence(tigs[0], read)
    expect(seq === genome || revcomp(seq) === genome).toBe(true)
  })

  it('trims a read to the stretch other reads cover', () => {
    // Read 0 is covered by three others from 2000 to 9000 only.
    const overlaps = [ov(1, 0, 6000, 0, 2000, 8000), ov(2, 0, 7000, 0, 2000, 9000), ov(3, 0, 6000, 0, 3000, 9000)]
    const t = trimReads([10000, 6000, 7000, 6000], overlaps, 3, 1000)
    expect([t.start[0], t.end[0]]).toEqual([3000, 8000])
  })

  it('finds the period of a circle read on past its origin', () => {
    const rand = rng(5)
    const circle = randomSequence(30000, rand)
    const read = withErrors(circle + circle.slice(0, 6000), NANOPORE_ERRORS, rand)
    const p = selfOverlapPeriod(read)
    expect(p).not.toBeNull()
    expect(Math.abs(p! - 30000)).toBeLessThan(400)
    expect(selfOverlapPeriod(withErrors(randomSequence(30000, rand), NANOPORE_ERRORS, rand))).toBeNull()
    // Reads that ran on for 12 kb past the origin, far past the 5 kb probe.
    const longer = withErrors(circle + circle.slice(0, 12000), NANOPORE_ERRORS, rand)
    expect(Math.abs((selfOverlapPeriod(longer) ?? 0) - 30000)).toBeLessThan(400)
    // A start that comes back once in the middle is not a circle.
    expect(selfOverlapPeriod(withErrors(circle.slice(0, 20000) + circle.slice(0, 3000) + randomSequence(15000, rand), NANOPORE_ERRORS, rand))).toBeNull()
  })

  it('counts shared k-mers without a set of the larger sequence', () => {
    const rand = rng(6)
    const plasmid = randomSequence(3000, rand)
    const genome = randomSequence(20000, rand) + revcomp(plasmid) + randomSequence(20000, rand)
    const k = kmerSet(plasmid, false)
    expect(sharedKmers(k, genome, false)).toBe(k.size)
  })

  it('tells a whole-plasmid run from a genome by the share of bases in length peaks', () => {
    const rand = rng(7)
    const plasmid = randomSequence(5000, rand)
    const genome = randomSequence(200000, rand)
    const scan = (reads: SimRead[]) => ({ lengths: reads.map(r => r.seq.length), quality: reads.map(() => 15) })
    const wholePlasmid = [
      ...simulateReads(plasmid, { n: 120, circular: true, length: r => 5000 - r() * 20, seed: 8 }),
      ...simulateReads(plasmid, { n: 80, circular: true, length: r => 300 + r() * 4500, seed: 9 }),
    ]
    expect(longMethod(scan(wholePlasmid), 5).method).toBe('long-seed')
    // A genome library with a small plasmid's peak among its reads.
    const genomeRun = [
      ...simulateReads(genome, { n: 600, circular: true, length: r => 1000 + -Math.log(1 - r()) * 8000, seed: 10 }),
      ...simulateReads(plasmid, { n: 30, circular: true, length: r => 5000 - r() * 20, seed: 11 }),
    ]
    const g = longMethod(scan(genomeRun), 5)
    expect(g.method).toBe('long-olc')
    expect(g.share).toBeGreaterThan(0)
  })

  it('takes the longest reads up to the depth wanted', () => {
    const scan = { lengths: [500, 5000, 20000, 15000, 3000], quality: [20, 20, 20, 20, 20] }
    expect(selectReads(scan, 1000)).toEqual([1, 2, 3])
    expect(selectReads(scan, null)).toEqual([1, 2, 3, 4])
  })
})

describe('long-read genome assembly with minimap2', () => {
  it('drops a draft that is a rougher copy of another', async () => {
    const rand = rng(61)
    const plasmid = randomSequence(4000, rand)
    const other = randomSequence(20000, rand)
    const copy = withErrors(plasmid.slice(1500) + plasmid.slice(0, 1500), { sub: 0.01, ins: 0.01, del: 0.01 }, rand)
    const drafts = [{ bases: other, circular: false }, { bases: plasmid, circular: true }, { bases: copy, circular: false }]
    // The reads went to the exact copy.
    expect([...await redundantDrafts(drafts, [100, 80, 10], minimap2)]).toEqual([2])
  }, 60_000)

  it('assembles a chromosome with repeats and a plasmid into exact circles', async () => {
    const rand = rng(21)
    // 300 kb with three copies of a 1.5 kb element, and a 30 kb plasmid at 2x the depth.
    const is = randomSequence(1500, rand)
    const pieces = Array.from({ length: 3 }, () => randomSequence(99000, rand))
    const chromosome = pieces[0] + is + pieces[1] + revcomp(is) + pieces[2] + is
    const plasmid = randomSequence(30000, rand)
    const len = (r: () => number) => 2000 + -Math.log(1 - r()) * 9000
    const reads = [
      ...simulateReads(chromosome, { n: 1000, circular: true, length: len, seed: 22, prefix: 'c' }),
      ...simulateReads(plasmid, { n: 200, circular: true, length: len, seed: 23, prefix: 'p' }),
    ]
    const { contigs, report, graph } = await assemble(reads)
    expect(report.genome?.overlaps).toBeGreaterThan(1000)
    const big = contigs[0]
    expect(big.circular).toBe(true)
    expect(Math.abs(big.bases.length - chromosome.length)).toBeLessThan(50)
    expect(differences(big.bases, true, chromosome)).toBeLessThanOrEqual(10)
    const p = contigs.find(c => Math.abs(c.bases.length - plasmid.length) < 300)
    expect(p?.circular).toBe(true)
    expect(differences(p!.bases, true, plasmid)).toBeLessThanOrEqual(5)
    expect(graph.segments.length).toBeGreaterThanOrEqual(2)
    expect(report.settings.method).toBe('long-olc')
  }, 300_000)

  it('adds a small plasmid from its length peak, which the overlaps miss', async () => {
    const rand = rng(31)
    const chromosome = randomSequence(150000, rand)
    // Shorter than the shortest overlap (2 kb): its reads cannot overlap end to end.
    const plasmid = randomSequence(1500, rand)
    const reads = [
      ...simulateReads(chromosome, { n: 500, circular: true, length: r => 2000 + -Math.log(1 - r()) * 9000, seed: 32, prefix: 'c' }),
      // A rapid library opens each plasmid once: full-length reads.
      ...simulateReads(plasmid, { n: 60, circular: true, length: r => 1500 - r() * 10, seed: 33, prefix: 'p' }),
    ]
    const { contigs, report } = await assemble(reads)
    const p = contigs.find(c => Math.abs(c.bases.length - 1500) < 30)
    expect(p?.circular).toBe(true)
    expect(differences(p!.bases, true, plasmid)).toBe(0)
    expect(report.contigs.find(c => c.length === p!.bases.length)?.fromPeak).toBe(true)
    expect(differences(contigs[0].bases, contigs[0].circular, chromosome)).toBeLessThanOrEqual(2)
  }, 300_000)

  it('polishes with short reads where the long reads leave errors', async () => {
    const rand = rng(41)
    const chromosome = randomSequence(60000, rand)
    // Few, noisy long reads: their consensus keeps some errors.
    const noisy = { sub: 0.04, ins: 0.04, del: 0.05 }
    const long = simulateReads(chromosome, { n: 110, circular: true, length: r => 3000 + -Math.log(1 - r()) * 5000, errors: noisy, seed: 42, prefix: 'c' })
    const short = simulateReads(chromosome, { n: 24000, circular: true, length: () => 150, errors: { sub: 0.003, ins: 0.0001, del: 0.0001 }, seed: 43, prefix: 's' })
    const shortChunks = chunksOf(short)
    const plain = await assemble(long, { settings: { ...DEFAULT_DENOVO_SETTINGS, method: 'long-olc', rounds: 3, minReads: 3 } })
    const before = differences(plain.contigs[0].bases, plain.contigs[0].circular, chromosome)
    const { contigs, report } = await assemble(long, {
      settings: { ...DEFAULT_DENOVO_SETTINGS, method: 'long-olc', rounds: 3, minReads: 3 },
      shortReads: { chunks: shortChunks.length, getChunk: async i => shortChunks[i], name: 'illumina', paired: false, bases: 24000 * 150 },
    })
    const after = differences(contigs[0].bases, contigs[0].circular, chromosome)
    expect(before).toBeGreaterThan(0)
    expect(after).toBe(0)
    expect(report.genome?.hybrid?.changes[0]).toBeGreaterThan(0)
    expect(report.contigs[0].hybridChanges?.length).toBeGreaterThan(0)
  }, 300_000)
})
