import { describe, expect, it } from 'vitest'
import { encodeChunk } from '../codec'
import { BASE_CODE, KmerRoller, KmerTable, hashWords, kmerText, packKmer, revcompWords, shiftAppend } from './kmer'
import { analyseSpectrum, readSetSpectrum } from './spectrum'
import { applyThreshold, buildUnitigs, cleanGraph, n50, unitigLinks } from './dbg'
import { dedupeLinks, toGfa } from './graph'
import { assembleShortReads, kChoices, solidThreshold } from './short'
import { circleDistance, randomSequence, revcomp, rng, sameCircle, simulateReads, type SimRead } from './simulate'
import { DEFAULT_SHORT_SETTINGS } from './types'

const ILLUMINA = { sub: 0.003, ins: 0.0001, del: 0.0001 }

function chunksOf(reads: SimRead[]): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < reads.length; i += 2000) out.push(encodeChunk(reads.slice(i, i + 2000)))
  return out
}

function tableOf(seqs: string[], k: number): KmerTable {
  const t = new KmerTable(k)
  const r = new KmerRoller(k)
  for (const s of seqs) {
    r.reset()
    for (let i = 0; i < s.length; i++) if (r.push(BASE_CODE[s.charCodeAt(i)])) t.add(r.canonical(), 1)
  }
  return t
}

describe('packed k-mers', () => {
  it('rolls forward and reverse complement for every k', () => {
    const s = randomSequence(300, rng(1))
    for (const k of [5, 16, 17, 21, 32, 33, 63, 77, 127]) {
      const r = new KmerRoller(k)
      for (let i = 0; i < s.length; i++) {
        if (!r.push(BASE_CODE[s.charCodeAt(i)])) continue
        const want = s.slice(i - k + 1, i + 1)
        expect(kmerText(r.fwd, 0, k)).toBe(want)
        expect(kmerText(r.rev, 0, k)).toBe(revcomp(want))
      }
      const w = packKmer(s.slice(0, k))
      expect(kmerText(revcompWords(w, 0, k, new Uint32Array(w.length)), 0, k)).toBe(revcomp(s.slice(0, k)))
      expect(kmerText(shiftAppend(w, 0, k, 2, new Uint32Array(w.length)), 0, k)).toBe(s.slice(1, k) + 'G')
    }
  })

  it('stays fast when the keys are sampled by their hash', () => {
    // Only hashes below a limit, as the spectrum samples: placing keys by that
    // same value once crowded them into one end of the table.
    const t = new KmerTable(21)
    const key = new Uint32Array(2)
    const rand = rng(9)
    const start = performance.now()
    let n = 0
    for (let i = 0; i < 1_000_000; i++) {
      key[0] = Math.floor(rand() * 1024)
      key[1] = Math.floor(rand() * 4294967296)
      const h = hashWords(key, 0, 2)
      if (h >= 0.3 * 4294967296) continue
      t.add(key, 1, 0, h)
      n++
    }
    expect(t.size).toBe(n)
    expect(performance.now() - start).toBeLessThan(5000)
  })

  it('counts canonical k-mers, growing as it fills', () => {
    const s = randomSequence(20000, rng(2))
    const t = tableOf([s, revcomp(s)], 31)
    expect(t.size).toBeGreaterThan(19900)
    const r = new KmerRoller(31)
    for (let i = 0; i < 31; i++) r.push(BASE_CODE[s.charCodeAt(1000 + i)])
    expect(t.count(r.canonical())).toBe(2)
  })
})

describe('k-mer spectrum', () => {
  it('finds the trough and peak and estimates the genome length', () => {
    // Errors falling from 1, a genome peak at 30.
    const counts = [0, 50000, 8000, 1500, 300, 120, 100, 130, 200]
    for (let c = 9; c <= 60; c++) counts.push(Math.round(5000 * Math.exp(-((c - 30) ** 2) / 50)))
    const a = analyseSpectrum(counts, 1)
    // The lowest point before the peak, where the genome's tail meets the errors' tail.
    expect(a.trough).toBe(9)
    expect(a.peak).toBe(30)
    expect(a.genomeSize).toBeGreaterThan(55000)
    expect(a.genomeSize).toBeLessThan(70000)
    expect(analyseSpectrum([0, 100, 50, 20, 10], 1).genomeSize).toBeNull()
  })

  it('estimates a genome from reads, sampled or not', async () => {
    const genome = randomSequence(50000, rng(3))
    const reads = simulateReads(genome, { n: 10000, circular: true, length: () => 150, errors: ILLUMINA, seed: 4 })
    const chunks = chunksOf(reads)
    const s = await readSetSpectrum({ chunks: chunks.length, bases: 1_500_000, getChunk: async i => chunks[i] })
    expect(s.fraction).toBe(1)
    expect(Math.abs((s.genomeSize ?? 0) - 50000)).toBeLessThan(2500)
    // Sampling at a tenth of the k-mers keeps the estimate.
    const sampled = await readSetSpectrum({ chunks: chunks.length, bases: 320_000_000, getChunk: async i => chunks[i] })
    expect(sampled.fraction).toBeLessThan(0.11)
    expect(Math.abs((sampled.genomeSize ?? 0) - 50000)).toBeLessThan(7500)
  })
})

describe('de Bruijn graph', () => {
  it('chains a circle into one circular unitig', () => {
    const s = randomSequence(3000, rng(5))
    const t = tableOf([s + s.slice(0, 40)], 41)
    const u = buildUnitigs(t)
    expect(u.length).toBe(1)
    expect(u[0].circular).toBe(true)
    expect(sameCircle(u[0].seq, s)).toBe(true)
  })

  it('breaks at a repeat longer than k and keeps the pieces', () => {
    const rand = rng(6)
    const rep = randomSequence(100, rand)
    const s = randomSequence(1000, rand) + rep + randomSequence(1000, rand) + rep + randomSequence(1000, rand)
    const u = buildUnitigs(tableOf([s], 41))
    expect(u.length).toBe(4)
    expect(u.reduce((n, x) => n + x.seq.length, 0)).toBeGreaterThan(3000)
  })

  it('links the pieces around a repeat, in the right orientation, and writes GFA', () => {
    const rand = rng(16)
    const rep = randomSequence(100, rand)
    const [a, b, c] = [randomSequence(800, rand), randomSequence(800, rand), randomSequence(800, rand)]
    // The second copy of the repeat is reverse complemented.
    const s = a + rep + b + revcomp(rep) + c
    const t = tableOf([s], 31)
    const u = buildUnitigs(t)
    const links = dedupeLinks(unitigLinks(t, u))
    const find = (x: string) => u.findIndex(q => q.seq.includes(x.slice(100, 140)) || q.seq.includes(revcomp(x.slice(100, 140))))
    const ia = find(a)
    const ir = u.findIndex(q => q.seq.length < 200)
    expect(u.length).toBe(4)
    // Every piece joins the repeat, four joins in all.
    expect(links.length).toBe(4)
    expect(links.every(([x, , y]) => x === ir || y === ir)).toBe(true)
    // Following the joins from a reads a, then the repeat, as in the sequence.
    const [x, xs, y, ys] = links.find(l => l[0] === ia || l[2] === ia)!
    const piece = (i: number, st: string) => (st === '+' ? u[i].seq : revcomp(u[i].seq))
    const joined = x === ia ? piece(x, xs) + piece(y, ys).slice(30) : piece(y, ys === '+' ? '-' : '+') + piece(x, xs === '+' ? '-' : '+').slice(30)
    expect(joined.includes(a.slice(-50) + rep.slice(0, 50)) || joined.includes(revcomp(a.slice(-50) + rep.slice(0, 50)))).toBe(true)
    const gfa = toGfa({ version: 1, overlap: 30, coverageUnit: 'k-mer', links, sequences: u.map(q => q.seq),
      segments: u.map((q, i) => ({ name: `Piece ${i + 1}`, length: q.seq.length, coverage: q.coverage, circular: false, contig: null })) })
    expect(gfa.split('\n').filter(l => l.startsWith('S')).length).toBe(4)
    expect(gfa).toMatch(/^L\tPiece_\d\t[+-]\tPiece_\d\t[+-]\t30M$/m)
  })

  it('links a circle to itself', () => {
    const s = randomSequence(1000, rng(17))
    const t = tableOf([s + s.slice(0, 30)], 31)
    const u = buildUnitigs(t)
    expect(unitigLinks(t, u)).toEqual([[0, '+', 0, '+']])
  })

  it('clips error tips and pops error bubbles', () => {
    const rand = rng(7)
    const s = randomSequence(2000, rand)
    const seqs: string[] = []
    for (let i = 0; i < 30; i++) seqs.push(s)
    // An error in the middle (a bubble) and near the end (a tip), each in 3 reads.
    const bubble = s.slice(0, 1000) + (s[1000] === 'A' ? 'C' : 'A') + s.slice(1001)
    const tip = s.slice(0, 1990) + (s[1990] === 'A' ? 'C' : 'A') + s.slice(1991)
    for (let i = 0; i < 3; i++) seqs.push(bubble, tip)
    const t = tableOf(seqs, 31)
    applyThreshold(t, 2)
    expect(buildUnitigs(t).length).toBeGreaterThan(3)
    const { unitigs } = cleanGraph(t)
    expect(unitigs.length).toBe(1)
    expect(unitigs[0].seq === s || unitigs[0].seq === revcomp(s)).toBe(true)
  })

  it('picks the solid threshold at the trough, and the k-values to try', () => {
    expect(solidThreshold([0, 900, 100, 20, 8, 12, 50, 300, 50])).toBe(2)
    expect(solidThreshold([0, 9000, 2000, 500, 100, 60, 40, 50, 80, 200, 600, 900, 1200, 900, 300])).toBe(4)
    expect(kChoices(150, 100, null)).toEqual([21, 33, 55, 77, 99])
    expect(kChoices(150, 15, null)).toEqual([21, 33])
    expect(kChoices(250, null, null)).toEqual([21, 33, 55, 77, 99, 127])
    expect(kChoices(150, 100, 61)).toEqual([61])
    expect(n50([10, 20, 30, 40])).toBe(30)
  })
})

describe('short-read assembly', () => {
  const run = (reads: SimRead[], minContig = 200) => {
    const chunks = chunksOf(reads)
    const bases = reads.reduce((n, r) => n + r.seq.length, 0)
    return assembleShortReads({
      readSet: { chunks: chunks.length, bases, meanLength: bases / reads.length },
      settings: { ...DEFAULT_SHORT_SETTINGS, minContig },
      getChunk: async i => chunks[i],
    })
  }

  it('assembles a plasmid from Illumina-like reads into one exact circle', async () => {
    const plasmid = randomSequence(6000, rng(8))
    const reads = simulateReads(plasmid, { n: 8000, circular: true, length: () => 150, errors: ILLUMINA, seed: 9 })
    const { contigs, report, info } = await run(reads)
    expect(contigs.length).toBe(1)
    expect(contigs[0].circular).toBe(true)
    expect(circleDistance(contigs[0].bases, plasmid)).toBe(0)
    expect(Math.abs((report.spectrum.genomeSize ?? 0) - 6000)).toBeLessThan(600)
    expect(report.tried.length).toBeGreaterThan(2)
    expect(info[0].kmerCoverage).toBeGreaterThan(20)
  }, 60_000)

  it('assembles a linear amplicon to an exact contig', async () => {
    const amplicon = randomSequence(1500, rng(10))
    const reads = simulateReads(amplicon, { n: 4000, circular: false, length: () => 150, errors: ILLUMINA, seed: 11 })
    const { contigs } = await run(reads)
    expect(contigs.length).toBe(1)
    expect(contigs[0].circular).toBe(false)
    const c = contigs[0].bases
    expect(amplicon.includes(c) || amplicon.includes(revcomp(c))).toBe(true)
    expect(c.length).toBeGreaterThan(1450)
  }, 60_000)

  it('keeps two plasmids of different copy number apart, and takes the majority in a mixed site', async () => {
    const rand = rng(12)
    const a = randomSequence(4000, rand)
    const b = randomSequence(2500, rand)
    // 30% of the a molecules carry a substitution at 2000.
    const a2 = a.slice(0, 2000) + (a[2000] === 'A' ? 'G' : 'A') + a.slice(2001)
    const reads = [
      ...simulateReads(a, { n: 5600, circular: true, length: () => 150, errors: ILLUMINA, seed: 13 }),
      ...simulateReads(a2, { n: 2400, circular: true, length: () => 150, errors: ILLUMINA, seed: 14 }),
      ...simulateReads(b, { n: 1500, circular: true, length: () => 150, errors: ILLUMINA, seed: 15 }),
    ]
    const { contigs } = await run(reads)
    expect(contigs.length).toBe(2)
    expect(circleDistance(contigs[0].bases, a)).toBe(0)
    expect(circleDistance(contigs[1].bases, b)).toBe(0)
  }, 60_000)
})
