/**
 * De novo assembly at bacterial-genome scale: a simulated 5 Mb chromosome
 * with the repeats a real one has (seven 5 kb rRNA operons, ten 1.3 kb
 * insertion elements, twenty short repeats of 120 to 215 bp each twice), a
 * 60 kb plasmid at two copies and a 4 kb plasmid at ten. Run with
 *
 *   SEQNEXUS_BENCH=1 NODE_OPTIONS=--max-old-space-size=8000 node node_modules/vitest/vitest.mjs run src/ngs/denovo/denovo.bench.test.ts
 *
 * SEQNEXUS_BENCH_ONLY=short or long runs one of the two, SEQNEXUS_BENCH_MB=1 a
 * 1 Mb chromosome for a quick run.
 *
 * Skipped otherwise. Illumina: 2x150 pairs, 350 bp inserts, 60x, through
 * short.ts (spectrum, graphs at each k, pair joining). Nanopore: 40x, read
 * N50 about 20 kb, 3% errors, through genome.ts with the real minimap2
 * (overlaps, layout, polishing). Mapping the reads back is the mapper's
 * work, measured in scale.bench.test.ts. Accuracy is counted by k-mers: a
 * contig 31-mer not in the true sequence marks an error near it.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runTool } from '../../msa/engines/emscripten'
import { encodeChunk } from '../codec'
import type { ToolRunner } from '../mapper'
import { BASE_CODE, KmerRoller, KmerTable } from './kmer'
import { assembleShortReads } from './short'
import { assembleLongGenome } from './genome'
import { scanReads } from './long'
import { n50 } from './dbg'
import { rng } from './simulate'
import { DEFAULT_DENOVO_SETTINGS, DEFAULT_SHORT_SETTINGS } from './types'

const RUN = !!process.env.SEQNEXUS_BENCH
const ONLY = process.env.SEQNEXUS_BENCH_ONLY ?? ''
// Chromosome length; SEQNEXUS_BENCH_MB sets a smaller one for a quick run.
const SIZE = Number(process.env.SEQNEXUS_BENCH_MB ?? 5) * 1e6

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`
let peak = 0
const sample = () => { peak = Math.max(peak, process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers) }

const CMP = new Uint8Array(256)
CMP[65] = 84; CMP[84] = 65; CMP[67] = 71; CMP[71] = 67

function randomBytes(n: number, rand: () => number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = 'ACGT'.charCodeAt((rand() * 4) | 0)
  return out
}
const rcBytes = (s: Uint8Array) => { const o = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) o[i] = CMP[s[s.length - 1 - i]]; return o }
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')

/** The sample: a chromosome with repeats, and two plasmids with their copy numbers. */
function makeGenome() {
  const rand = rng(77)
  const parts: Uint8Array[] = []
  const rrn = randomBytes(5000, rand)
  const is = randomBytes(1300, rand)
  const shorts = Array.from({ length: 20 }, (_, i) => randomBytes(120 + i * 5, rand))
  const repeats: Uint8Array[] = [...Array(7).fill(rrn), ...Array.from({ length: 10 }, (_, i) => (i % 2 ? rcBytes(is) : is)), ...shorts, ...shorts.map(rcBytes)]
  // Shuffle the repeat copies along the chromosome.
  for (let i = repeats.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [repeats[i], repeats[j]] = [repeats[j], repeats[i]] }
  const repeatBases = repeats.reduce((n, r) => n + r.length, 0)
  const gap = Math.floor((SIZE - repeatBases) / repeats.length)
  for (const r of repeats) { parts.push(randomBytes(gap, rand)); parts.push(r) }
  const total = parts.reduce((n, p) => n + p.length, 0)
  const chromosome = new Uint8Array(total)
  let o = 0
  for (const p of parts) { chromosome.set(p, o); o += p.length }
  return { chromosome, plasmids: [{ seq: randomBytes(60000, rand), copies: 2 }, { seq: randomBytes(4000, rand), copies: 10 }] }
}

/** Molecules weighted by length times copies, for drawing reads. */
function picker(mols: { seq: Uint8Array; copies: number }[], rand: () => number) {
  const w = mols.map(m => m.seq.length * m.copies)
  const sum = w.reduce((a, b) => a + b, 0)
  return () => {
    let x = rand() * sum
    for (let i = 0; i < mols.length; i++) { x -= w[i]; if (x <= 0) return mols[i].seq }
    return mols[mols.length - 1].seq
  }
}

/** A stretch of a circular molecule, with substitutions, insertions and deletions at the rates given. */
function cut(m: Uint8Array, start: number, len: number, rev: boolean, sub: number, ins: number, del: number, rand: () => number, out: Uint8Array): number {
  let n = 0
  const L = m.length
  for (let i = 0; i < len; i++) {
    let c = rev ? CMP[m[(start + len - 1 - i) % L]] : m[(start + i) % L]
    const x = rand()
    if (x < del) continue
    if (x < del + sub) c = 'ACGT'.charCodeAt(((('ACGT'.indexOf(String.fromCharCode(c)) + 1 + Math.floor(rand() * 3)) % 4)))
    out[n++] = c
    if (rand() < ins) out[n++] = 'ACGT'.charCodeAt((rand() * 4) | 0)
  }
  return n
}

/** The true sequences' 31-mers, to count contig errors against. */
function truthTable(seqs: Uint8Array[]): KmerTable {
  const t = KmerTable.forKmers(31, seqs.reduce((n, s) => n + s.length, 0))
  const r = new KmerRoller(31)
  for (const s of seqs) {
    r.reset()
    const circ = new Uint8Array(s.length + 30)
    circ.set(s)
    circ.set(s.subarray(0, 30), s.length)
    for (let i = 0; i < circ.length; i++) if (r.push(BASE_CODE[circ[i]])) t.add(r.canonical(), 1)
  }
  return t
}

/** 31-mers of a contig not in the truth: about 31 for each error. */
function wrongKmers(contig: string, truth: KmerTable): number {
  const r = new KmerRoller(31)
  let wrong = 0
  for (let i = 0; i < contig.length; i++) if (r.push(BASE_CODE[contig.charCodeAt(i)]) && truth.count(r.canonical()) === 0) wrong++
  return wrong
}

function summary(label: string, contigs: { bases: string; circular: boolean }[], truth: KmerTable, seconds: number) {
  const lengths = contigs.map(c => c.bases.length)
  const wrong = contigs.reduce((n, c) => n + wrongKmers(c.bases, truth), 0)
  const total = lengths.reduce((a, b) => a + b, 0)
  console.log(`${label}: ${seconds.toFixed(0)} s, peak heap ${mb(peak)}; ${contigs.length} contigs, ${(total / 1e6).toFixed(2)} Mb, N50 ${(n50(lengths) / 1000).toFixed(0)} kb, longest ${(Math.max(...lengths) / 1000).toFixed(0)} kb, ${contigs.filter(c => c.circular).length} circular; about ${(wrong / 31).toFixed(1)} errors (${wrong} wrong 31-mers)`)
  console.log(`  largest: ${contigs.slice(0, 8).map(c => `${(c.bases.length / 1000).toFixed(1)} kb${c.circular ? ' circ' : ''}`).join(', ')}`)
}

describe.skipIf(!RUN)('de novo at bacterial scale', () => {
  const g = makeGenome()
  const mols = [{ seq: g.chromosome, copies: 1 }, ...g.plasmids]
  const truth = truthTable(mols.map(m => m.seq))

  it.skipIf(ONLY === 'long')('Illumina 2x150 at 60x', async () => {
    const rand = rng(78)
    const pick = picker(mols, rand)
    const pairs = Math.round((g.chromosome.length * 60) / 300)
    const chunks: Uint8Array[] = []
    let batch: { id: string; seq: string; qual: string }[] = []
    const qual = 'I'.repeat(150)
    const b1 = new Uint8Array(400)
    const b2 = new Uint8Array(400)
    let bases = 0
    for (let p = 0; p < pairs; p++) {
      const m = pick()
      const z = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
      const ins = Math.max(150, Math.round(350 + z * 40))
      const st = Math.floor(rand() * m.length)
      const rev = rand() < 0.5
      // Mate 1 from the fragment's start, mate 2 from its end on the other strand.
      const n1 = cut(m, rev ? st + ins - 150 : st, 150, rev, 0.003, 0, 0, rand, b1)
      const n2 = cut(m, rev ? st : st + ins - 150, 150, !rev, 0.003, 0, 0, rand, b2)
      batch.push({ id: `p${p}/1`, seq: text(b1.subarray(0, n1)), qual }, { id: `p${p}/2`, seq: text(b2.subarray(0, n2)), qual })
      bases += n1 + n2
      if (batch.length >= 20000) { chunks.push(encodeChunk(batch)); batch = [] }
    }
    if (batch.length) chunks.push(encodeChunk(batch))
    console.log(`Illumina: ${(pairs * 2).toLocaleString()} reads, ${(bases / 1e6).toFixed(0)} Mb, stored in ${mb(chunks.reduce((n, c) => n + c.length, 0))}`)
    peak = 0
    const t = performance.now()
    let last = -1
    const r = await assembleShortReads({
      readSet: { chunks: chunks.length, bases, meanLength: 150, paired: true },
      settings: DEFAULT_SHORT_SETTINGS,
      getChunk: async i => { sample(); return chunks[i] },
      onProgress: d => { const pct = Math.floor(d / 100); if (pct !== last) { last = pct; console.log(`  ${pct * 10}% at ${((performance.now() - t) / 1000).toFixed(0)} s, heap ${mb(process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers)}`) } },
    })
    const secs = (performance.now() - t) / 1000
    console.log(`  genome ${r.report.spectrum.genomeSize?.toLocaleString()} bp from the spectrum; k ${r.report.k} of ${r.report.tried.map(x => `${x.k}: ${x.contigs} contigs N50 ${x.n50}`).join('; ')}`)
    console.log(`  pairs: ${JSON.stringify(r.report.pairs)}`)
    summary('Illumina de novo', r.contigs, truth, secs)
    expect(r.contigs.length).toBeGreaterThan(0)
  }, 3_600_000)

  it.skipIf(ONLY === 'short')('Nanopore at 40x', async () => {
    const rand = rng(79)
    const pick = picker(mols, rand)
    const target = g.chromosome.length * 40
    const chunks: Uint8Array[] = []
    let batch: { id: string; seq: string; qual: string }[] = []
    const buf = new Uint8Array(400_000)
    let bases = 0
    let n = 0
    while (bases < target) {
      const m = pick()
      const len = Math.min(m.length, Math.round(1000 + -Math.log(1 - rand()) * 12000))
      const k = cut(m, Math.floor(rand() * m.length), len, rand() < 0.5, 0.01, 0.01, 0.01, rand, buf)
      const seq = text(buf.subarray(0, k))
      batch.push({ id: `r${n++}`, seq, qual: String.fromCharCode(33 + 15).repeat(k) })
      bases += k
      if (batch.length >= 2000) { chunks.push(encodeChunk(batch)); batch = [] }
    }
    if (batch.length) chunks.push(encodeChunk(batch))
    console.log(`Nanopore: ${n.toLocaleString()} reads, ${(bases / 1e6).toFixed(0)} Mb, stored in ${mb(chunks.reduce((s, c) => s + c.length, 0))}`)
    const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')
    const data = readFileSync(resolve(dir, 'minimap2.data'))
    const glue = readFileSync(resolve(dir, 'minimap2-simd.js'), 'utf8')
    const wasm = readFileSync(resolve(dir, 'minimap2-simd.wasm'))
    const dataPackage = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    let mmTime = 0
    const minimap2: ToolRunner = async (args, files, outputs) => {
      const t0 = performance.now()
      const res = await runTool(glue, wasm, { args, files, outputs, dataPackage })
      mmTime += performance.now() - t0
      console.log(`  minimap2 ${args.slice(0, 3).join(' ')}: ${((performance.now() - t0) / 1000).toFixed(0)} s`)
      return res
    }
    peak = 0
    const t = performance.now()
    const getChunk = async (i: number) => { sample(); return chunks[i] }
    const scan = await scanReads(chunks.length, getChunk)
    const r = await assembleLongGenome({
      readSet: { chunks: chunks.length, getChunk, technology: 'nanopore' },
      settings: { ...DEFAULT_DENOVO_SETTINGS, method: 'long-olc', rounds: 3 }, preset: 'map-ont', minimap2, scan,
    })
    const secs = (performance.now() - t) / 1000
    console.log(`  minimap2 in all ${(mmTime / 1000).toFixed(0)} s; layout ${JSON.stringify(r.report.genome)}`)
    summary('Nanopore de novo', r.contigs, truth, secs)
    expect(r.contigs.length).toBeGreaterThan(0)
  }, 3_600_000)
})
