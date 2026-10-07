import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runTool } from '../../msa/engines/emscripten'
import { encodeChunk } from '../codec'
import type { ToolRunner } from '../mapper'
import { wasmSimd } from '../jobs'
import { lengthPeaks, pickSeed } from './clusters'
import { containment, kmerSet } from './kmers'
import { addRecord, columnMajority, extension, newPileup, polish, polishLinear } from './polish'
import { assembleLongReads, NO_PRODUCT } from './long'
import { circleDistance, randomSequence, revcomp, rng, sameCircle, simulateReads, type SimRead } from './simulate'
import { DEFAULT_DENOVO_SETTINGS } from './types'

const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')

// The SIMD build where Node has SIMD, as the app picks it (same alignments, much faster).
const simd = wasmSimd()
const glueFile = simd ? 'minimap2-simd.js' : 'minimap2.js'
const wasm = readFileSync(resolve(dir, simd ? 'minimap2-simd.wasm' : 'minimap2.wasm'))
const data = readFileSync(resolve(dir, 'minimap2.data'))
const glue = readFileSync(resolve(dir, glueFile), 'utf8')
const dataPackage = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
const minimap2: ToolRunner = (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage })

const rec = (pos: number, cigar: string, seq: string, flag = 0) => ({
  qname: 'r', flag, ref: 0, pos, mapq: 60, cigar, mateRef: -1, matePos: -1, tlen: 0, seq, qual: '*',
})

function assemble(reads: SimRead[], settings = DEFAULT_DENOVO_SETTINGS) {
  const chunks: Uint8Array[] = []
  for (let i = 0; i < reads.length; i += 50) chunks.push(encodeChunk(reads.slice(i, i + 50)))
  return assembleLongReads({
    readSet: { chunks: chunks.length },
    settings,
    preset: 'map-ont',
    minimap2,
    getChunk: async i => chunks[i],
  })
}

describe('length peaks', () => {
  it('finds sharp peaks and passes over a broad spread', () => {
    const rand = rng(3)
    const lengths: number[] = []
    for (let i = 0; i < 300; i++) lengths.push(200 + Math.floor(rand() * 4800)) // broken plasmids
    for (let i = 0; i < 40; i++) lengths.push(500 + Math.floor(rand() * 20000)) // other DNA
    for (let i = 0; i < 60; i++) lengths.push(5000 + Math.floor(rand() * 40) - 20) // the plasmid
    for (let i = 0; i < 12; i++) lengths.push(10000 + Math.floor(rand() * 60) - 30) // its dimer
    const peaks = lengthPeaks(lengths, { minReads: 5 })
    expect(peaks.length).toBe(2)
    expect(Math.abs(peaks[0].length - 5000)).toBeLessThan(30)
    expect(peaks[0].members.length).toBeGreaterThanOrEqual(60)
    expect(Math.abs(peaks[1].length - 10000)).toBeLessThan(40)
  })

  it('finds nothing in a broad spread alone', () => {
    const rand = rng(4)
    const lengths = Array.from({ length: 400 }, () => 500 + Math.floor(rand() * 15000))
    expect(lengthPeaks(lengths, { minReads: 5 })).toEqual([])
  })

  it('picks the best read near the peak as the seed', () => {
    const lengths = [1000, 1003, 1100, 998]
    const quality = [10, 12, 30, 11]
    expect(pickSeed({ length: 1000, members: [0, 1, 2, 3] }, lengths, quality)).toBe(1)
  })
})

describe('k-mer containment', () => {
  it('sees a dimer as the same sequence and an insert as one way only', () => {
    const rand = rng(5)
    const a = randomSequence(3000, rand)
    const ins = a.slice(0, 1500) + randomSequence(800, rand) + a.slice(1500)
    const ka = kmerSet(a, true)
    expect(containment(kmerSet(a + a, true), ka)).toBe(1)
    expect(containment(ka, kmerSet(revcomp(a + a), true))).toBe(1)
    expect(containment(ka, kmerSet(ins, true))).toBeGreaterThan(0.95)
    expect(containment(kmerSet(ins, true), ka)).toBeLessThan(0.8)
    expect(containment(ka, kmerSet(randomSequence(3000, rand), true))).toBeLessThan(0.01)
  })
})

describe('polishing', () => {
  it('takes the majority base, drops deleted positions and writes insertions in', () => {
    const draft = 'ACGTACGTAC'
    const p = newPileup(10, false)
    // Six reads with A at position 3, position 5 deleted and GG inserted after position 6; four as the draft.
    for (let i = 0; i < 6; i++) addRecord(p, rec(0, '5M1D1M2I3M', 'ACGAAGGGTAC'))
    for (let i = 0; i < 4; i++) addRecord(p, rec(0, '10M', 'ACGTACGTAC'))
    const r = polish(draft, p)
    expect(r.bases).toBe('ACGAAGGGTAC')
    expect(r.changed).toBe(3)
  })

  it('folds positions past the end of a circular draft and closes the circle', () => {
    // The draft has its first two bases again at its end (a seed read a little too long).
    const circle = 'GATTACACCGTTAGC'
    const draft = circle + 'GA'
    const p = newPileup(draft.length, true)
    // Reads across the origin, aligned to draft + draft start: they skip the doubled GA.
    for (let i = 0; i < 4; i++) addRecord(p, rec(10, '7M2D10M', 'TTAGC' + 'GA' + circle.slice(2, 12)))
    const r = polish(draft, p)
    expect(sameCircle(r.bases, circle)).toBe(true)
  })

  it('trims uncovered ends of a linear draft and extends where reads agree', () => {
    const truth = randomSequence(400, rng(6))
    const draft = 'TTTTT' + truth.slice(0, 300) // 5 junk bases, and 100 missing at the end
    const p = newPileup(draft.length, false)
    for (let i = 0; i < 6; i++) addRecord(p, rec(5, `300M100S`, truth))
    const r = polishLinear(draft, p)
    expect(r.trimmedLeft).toBe(5)
    expect(r.extendedRight).toBe(100)
    expect(r.bases).toBe(truth)
  })

  it('stops an extension where the reads stop agreeing', () => {
    const rand = rng(7)
    const shared = randomSequence(60, rand)
    const clips = Array.from({ length: 6 }, () => shared + randomSequence(80, rand))
    const e = extension(clips, 6)
    expect(e.length).toBeGreaterThanOrEqual(60)
    expect(e.length).toBeLessThan(80)
    expect(e.startsWith(shared)).toBe(true)
    expect(columnMajority(['ACG', 'ACT', 'ACT'], 3).seq).toBe('ACT')
  })
})

describe('seed and polish with minimap2', () => {
  it('assembles a circular plasmid exactly from nanopore-like reads', async () => {
    const rand = rng(11)
    const plasmid = randomSequence(4000, rand)
    const reads = [
      ...simulateReads(plasmid, { n: 50, circular: true, length: r => 4000 - r() * 30, seed: 1, prefix: 'full' }),
      ...simulateReads(plasmid, { n: 40, circular: true, length: r => 300 + r() * 3500, seed: 2, prefix: 'part' }),
    ]
    const { contigs, report } = await assemble(reads)
    expect(contigs.length).toBe(1)
    expect(contigs[0].circular).toBe(true)
    expect(circleDistance(contigs[0].bases, plasmid)).toBe(0)
    const changes = report.contigs[0].changes ?? []
    expect(changes[0]).toBeGreaterThan(50)
    expect(changes[changes.length - 1]).toBe(0)
    expect(report.peaks?.length).toBe(1)
    expect(report.reads).toBe(90)
  }, 60_000)

  it('separates two plasmids, drops the dimer and gives their shares', async () => {
    const rand = rng(12)
    const a = randomSequence(3500, rand)
    const b = a.slice(0, 1700) + randomSequence(900, rand) + a.slice(1700)
    const reads = [
      ...simulateReads(a, { n: 40, circular: true, length: r => 3500 - r() * 30, seed: 3, prefix: 'a' }),
      ...simulateReads(b, { n: 20, circular: true, length: r => 4400 - r() * 30, seed: 4, prefix: 'b' }),
      ...simulateReads(a, { n: 10, circular: true, length: r => 7000 - r() * 30, seed: 5, prefix: 'dimer' }),
      ...simulateReads(a, { n: 20, circular: true, length: r => 300 + r() * 3000, seed: 6, prefix: 'part' }),
    ]
    const { contigs, report } = await assemble(reads)
    expect(contigs.length).toBe(2)
    expect(circleDistance(contigs[0].bases, a)).toBeLessThanOrEqual(1)
    expect(circleDistance(contigs[1].bases, b)).toBeLessThanOrEqual(1)
    expect(report.contigs[0].share).toBeGreaterThan(report.contigs[1].share ?? 1)
    const dimer = report.peaks?.find(p => p.length > 6000)
    expect(dimer?.contig).toBeNull()
    expect(dimer?.dropped).toMatch(/dimer/)
  }, 60_000)

  it('keeps a deletion variant apart from the full plasmid (a mixed clone)', async () => {
    const rand = rng(15)
    const full = randomSequence(5000, rand)
    const del = full.slice(0, 2000) + full.slice(2750)
    const reads = [
      ...simulateReads(full, { n: 60, circular: true, length: r => 5000 - r() * 25, seed: 9, prefix: 'full' }),
      ...simulateReads(del, { n: 20, circular: true, length: r => 4250 - r() * 25, seed: 10, prefix: 'del' }),
    ]
    const { contigs, report } = await assemble(reads)
    expect(contigs.map(c => c.bases.length)).toEqual([5000, 4250])
    expect(circleDistance(contigs[0].bases, full)).toBe(0)
    expect(circleDistance(contigs[1].bases, del)).toBe(0)
    expect(report.contigs[0].share).toBeGreaterThan(0.6)
  }, 60_000)

  it('assembles a linear amplicon to its ends', async () => {
    const rand = rng(13)
    const amplicon = randomSequence(2000, rand)
    const reads = simulateReads(amplicon, { n: 40, circular: false, length: () => 2000, endLoss: 6, seed: 7 })
    const { contigs, report } = await assemble(reads)
    expect(contigs.length).toBe(1)
    expect(contigs[0].circular).toBe(false)
    const c = contigs[0].bases
    // Exact, short at most of the bases some reads lost at the ends.
    expect(amplicon.includes(c) || amplicon.includes(revcomp(c))).toBe(true)
    expect(c.length).toBeGreaterThanOrEqual(1988)
    expect(report.contigs[0].trimmed).toBeDefined()
  }, 60_000)

  it('says why when there is no product', async () => {
    const rand = rng(14)
    const genome = randomSequence(30000, rand)
    const reads = simulateReads(genome, { n: 60, circular: false, length: r => 500 + r() * 6000, seed: 8 })
    await expect(assemble(reads)).rejects.toThrow(NO_PRODUCT(5).slice(0, 40))
  }, 60_000)
})
