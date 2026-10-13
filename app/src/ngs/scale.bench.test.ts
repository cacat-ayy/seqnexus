/**
 * Bacterial-genome scale: how long each stage takes, and how much memory it
 * holds, on a 5 Mb genome with 850,000 read pairs (1.7 million reads of
 * 150 bases, about 50x), as wgsim would simulate them. Run with
 *
 *   SEQNEXUS_BENCH=1 node node_modules/vitest/vitest.mjs run src/ngs/scale.bench.test.ts
 *
 * Skipped otherwise. Everything after mapping is ours, so it is measured on
 * the real code with in-memory storage; the alignments themselves are made
 * from the known read positions instead of by minimap2, whose throughput is
 * measured on a sample of the reads and extrapolated (its WebAssembly build
 * runs the same in Node as in a browser).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importReads, type ReadSource } from './importer'
import { MappingBuilder, type MappingStorage } from './builder'
import { callMapping, decodeCalls, siteVariants } from './calls'
import { findJunctions } from './junctions'
import { exportMapping } from './sam'
import { layoutReads, MappingSource, windowPileup, DEFAULT_DOWNSAMPLE } from './view'
import { minimap2Args, referenceFasta } from './mapper'
import { runTool } from '../msa/engines/emscripten'
import type { SamFields } from './alignments'

const RUN = !!process.env.SEQNEXUS_BENCH
const G = 5_000_000
const PAIRS = 850_000
const LEN = 150
const ERR = 0.003
const SNPS = 2000

function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 }
}
const BASES = 'ACGT'
const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
const rc = (s: string) => { let o = ''; for (let i = s.length - 1; i >= 0; i--) o += COMP[s[i]]; return o }

function memoryStorage(): MappingStorage & { bytes: () => number } {
  const map = new Map<string, Uint8Array>()
  return {
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
    bytes: () => { let n = 0; for (const d of map.values()) n += d.length; return n },
  }
}

const mb = (n: number) => `${(n / 1e6).toFixed(0)} MB`
const heap = () => mb(process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers)
const time = async <T>(label: string, f: () => Promise<T> | T): Promise<T> => {
  const t = performance.now()
  const r = await f()
  console.log(`${label.padEnd(44)} ${((performance.now() - t) / 1000).toFixed(1).padStart(6)} s   heap ${heap()}`)
  return r
}

describe.skipIf(!RUN)('bacterial scale', () => {
  it('stores, calls, exports and views a 5 Mb mapping of 1.7 million reads', async () => {
    const rand = rng(42)
    let ref = ''
    for (let i = 0; i < G; i++) ref += BASES[(rand() * 4) | 0]
    // The sample: the reference with SNPs.
    const sample = ref.split('')
    const snpAt = new Set<number>()
    while (snpAt.size < SNPS) {
      const p = (rand() * G) | 0
      snpAt.add(p)
      sample[p] = BASES[(BASES.indexOf(ref[p]) + 1 + ((rand() * 3) | 0)) % 4]
    }
    const sampleSeq = sample.join('')

    // One pair: its fragment, the two reads with errors, and qualities.
    const qual = 'I'.repeat(LEN)
    const pairAt = (k: number) => {
      const r = rng(1000 + k)
      const ins = 300 + ((r() * 100) | 0)
      const s = (r() * (G - ins)) | 0
      const err = (seq: string) => { let o = ''; for (const c of seq) o += r() < ERR ? BASES[(BASES.indexOf(c) + 1) % 4] : c; return o }
      return { s, ins, r1: err(sampleSeq.slice(s, s + LEN)), r2: err(rc(sampleSeq.slice(s + ins - LEN, s + ins))) }
    }

    // ---- Import, from an interleaved FASTQ stream made on the fly ----
    const fastq: ReadSource = {
      name: 'reads.fastq', size: PAIRS * 2 * (LEN * 2 + 40),
      stream: () => {
        let k = 0
        const enc = new TextEncoder()
        return new ReadableStream<Uint8Array>({
          pull(c) {
            if (k >= PAIRS) { c.close(); return }
            let text = ''
            for (let j = 0; j < 2000 && k < PAIRS; j++, k++) {
              const p = pairAt(k)
              text += `@r${k}/1\n${p.r1}\n+\n${qual}\n@r${k}/2\n${p.r2}\n+\n${qual}\n`
            }
            c.enqueue(enc.encode(text))
          },
        })
      },
    }
    const chunks = new Map<number, Uint8Array>()
    const imported = await time('import 1.7M reads (FASTQ, stats, chunks)', () => importReads({
      sources: [fastq], layout: 'interleaved', technology: 'illumina', put: async (i, d) => { chunks.set(i, d) },
    }))
    expect(imported.stats.reads).toBe(PAIRS * 2)
    console.log(`  read set stored in ${mb(imported.storedBytes)}`)
    chunks.clear()

    // ---- minimap2 on a sample, extrapolated ----
    const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')
    const data = readFileSync(resolve(dir, 'minimap2.data'))
    const SAMPLE_PAIRS = 20_000
    let r1 = ''
    let r2 = ''
    for (let k = 0; k < SAMPLE_PAIRS; k++) {
      const p = pairAt(k)
      r1 += `@r${k}\n${p.r1}\n+\n${qual}\n`
      r2 += `@r${k}\n${p.r2}\n+\n${qual}\n`
    }
    const t0 = performance.now()
    const mm = await runTool(readFileSync(resolve(dir, 'minimap2-simd.js'), 'utf8'), readFileSync(resolve(dir, 'minimap2-simd.wasm')), {
      args: minimap2Args('sr', true),
      files: { 'ref.fa': referenceFasta([{ name: 'g', tabId: null, bases: ref, circular: false }], 1000), 'r1.fq': r1, 'r2.fq': r2 },
      outputs: ['out.sam'], dataPackage: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    })
    const mmSec = (performance.now() - t0) / 1000
    expect(mm.exitCode).toBe(0)
    console.log(`minimap2 (SIMD) on ${SAMPLE_PAIRS.toLocaleString('en-US')} pairs ${mmSec.toFixed(1)} s, index included; all ${PAIRS.toLocaleString('en-US')} pairs about ${(mmSec * PAIRS / SAMPLE_PAIRS / 60).toFixed(1)} min at most`)

    // ---- Storing the mapping ----
    const storage = memoryStorage()
    const refs = [{ name: 'genome', tabId: null, bases: ref, circular: false }]
    const report = await time('store 1.7M alignments (sort, pages, sites)', async () => {
      const b = new MappingBuilder({ storageId: 'm', refs, paired: true, storage, expectedBases: PAIRS * 2 * LEN })
      const f = (name: string, flag: number, pos: number, mpos: number, tlen: number, seq: string): SamFields => ({
        qname: name, flag, ref: 0, pos, mapq: 60, cigar: `${LEN}M`, mateRef: 0, matePos: mpos, tlen, seq, qual,
      })
      for (let k = 0; k < PAIRS; k++) {
        const p = pairAt(k)
        const m = p.s + p.ins - LEN
        await b.add(f(`r${k}`, 99, p.s, m, p.ins, p.r1), 2 * k)
        await b.add(f(`r${k}`, 147, m, p.s, -p.ins, rc(p.r2)), 2 * k + 1)
      }
      return b.finish({ preset: 'sr', program: { id: 'x', name: 'x', version: '', command: '' } })
    })
    console.log(`  ${report.pages} pages, ${mb(storage.bytes())} stored, ${report.references[0].sites} candidate sites, ${report.references[0].meanDepth.toFixed(1)}x`)

    // ---- Variants ----
    await time('recount the candidate sites (call variants)', () => callMapping({ storageId: 'm', storage, references: [{ name: 'genome', length: G, circular: false }] }))
    const calls = decodeCalls((await storage.get('m-calls', 0))!)
    const vs = await time('describe every candidate (siteVariants)', () => siteVariants(calls, ref, [], 'illumina'))
    const found = vs.filter(v => v.type === 'SNP' && v.frequency > 0.8 && snpAt.has(v.position - 1)).length
    console.log(`  ${vs.length} candidates, ${found} of ${SNPS} planted SNPs at over 80%`)
    expect(found).toBeGreaterThan(SNPS * 0.98)

    await time('find soft-clip junctions (every page)', () => findJunctions({ storageId: 'm', storage, references: [{ name: 'genome', length: G, circular: false }] }))
    const bam = await time('export BAM with index', () => exportMapping({ format: 'bam', storageId: 'm', storage, references: [{ name: 'genome', length: G, circular: false }], program: report.program }))
    console.log(`  BAM ${mb(bam.file.size)}`)

    // ---- Viewing ----
    const src = new MappingSource(storage, 'm', [{ name: 'genome', length: G, circular: false }])
    await time('open: index, reference, coverage, summaries', async () => { await src.index(); await src.reference(0); await src.coverage(0); await src.summaries(0) })
    const reads = await time('load 300 kb around a 100 kb view', () => src.load(0, 2_400_000, 2_700_000))
    await time(`pileup of the ${reads.length.toLocaleString('en-US')} loaded reads`, () => windowPileup(reads, { bases: ref, circular: false }, 2_400_000, 2_700_000))
    const layout = await time('downsample and lay out in rows', () => layoutReads(reads, { softClips: false, downsample: DEFAULT_DOWNSAMPLE, minMapq: 0, gap: 3, maxRows: 3000 }))
    console.log(`  ${layout.rows.length} rows, ${layout.sampledOut} downsampled`)
  }, 3_600_000)
})
