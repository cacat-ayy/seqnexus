import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'fflate'
import { importReads, readBatches, type ReadSource } from './importer'
import { trimReads, fastpArgs, type FastpRunner } from './trimmer'
import { exportFastq } from './exporter'
import { decodeChunk } from './codec'
import { runTool } from '../msa/engines/emscripten'
import { DEFAULT_TRIM, DEFAULT_LONG_TRIM } from './types'

/** A source that hands out its bytes in small pieces, as a file stream would. */
function source(name: string, bytes: Uint8Array, piece = 997): ReadSource {
  return {
    name,
    size: bytes.length,
    stream: () => new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += piece) c.enqueue(bytes.slice(i, i + piece))
        c.close()
      },
    }),
  }
}
const text = (s: string) => new TextEncoder().encode(s)

/** An in-memory chunk store. */
function store() {
  const chunks = new Map<number, Uint8Array>()
  return {
    chunks,
    put: async (i: number, d: Uint8Array) => { chunks.set(i, d) },
    get: async (i: number) => chunks.get(i),
  }
}

const rnd = (n: number, seed: { v: number }) => Array.from({ length: n }, () => {
  seed.v = (seed.v * 1103515245 + 12345) % 2 ** 31
  // The high bits: an LCG's low bits repeat with a short period.
  return 'ACGT'[(seed.v >>> 16) % 4]
}).join('')
const rc = (s: string) => s.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c]).join('')

/** Paired reads of a 100 bp insert read 150 bp, so each mate runs into the adapter. */
function pairedReads(n: number) {
  const seed = { v: 7 }
  const ADA1 = 'AGATCGGAAGAGCACACGTCTGAACTCCAGTCAC'
  const ADA2 = 'AGATCGGAAGAGCGTCGTGTAGGGAAAGAGTGT'
  let r1 = ''
  let r2 = ''
  for (let i = 0; i < n; i++) {
    const ins = rnd(100, seed)
    const q = 'F'.repeat(150)
    r1 += `@A00123:8:H5:1:1101:${i}:1 1:N:0:ACGT\n${(ins + ADA1 + rnd(40, seed)).slice(0, 150)}\n+\n${q}\n`
    r2 += `@A00123:8:H5:1:1101:${i}:1 2:N:0:ACGT\n${(rc(ins) + ADA2 + rnd(40, seed)).slice(0, 150)}\n+\n${q}\n`
  }
  return { r1, r2 }
}

describe('importReads', () => {
  it('imports a gzipped pair (several gzip members each), mates side by side, in chunks', async () => {
    const { r1, r2 } = pairedReads(300)
    // BGZF-like: each file is several gzip members back to back.
    const members = (s: string) => {
      const half = s.indexOf('@', s.length / 2)
      const a = gzipSync(text(s.slice(0, half)))
      const b = gzipSync(text(s.slice(half)))
      const out = new Uint8Array(a.length + b.length)
      out.set(a)
      out.set(b, a.length)
      return out
    }
    const st = store()
    let lastProgress = 0
    const res = await importReads({
      sources: [source('x_R1.fastq.gz', members(r1)), source('x_R2.fastq.gz', members(r2))],
      layout: 'pair', technology: 'illumina', put: st.put, chunkReads: 256,
      onProgress: (d, t) => { lastProgress = d / t },
    })
    expect(lastProgress).toBe(1)
    expect(res.stats.reads).toBe(600)
    expect(res.chunks).toBe(3)
    expect(res.stats.positionQuality).toHaveLength(2)
    const first = decodeChunk(st.chunks.get(0)!)
    expect(first.ids.slice(0, 2)).toEqual(['A00123:8:H5:1:1101:0:1', 'A00123:8:H5:1:1101:0:1'])
    expect(first.seq(0)).toBe(r1.split('\n')[1])
    expect(first.seq(1)).toBe(r2.split('\n')[1])
  })

  it('refuses mates out of order and files of different lengths', async () => {
    const a = '@r1\nACGT\n+\nIIII\n@r2\nACGT\n+\nIIII\n'
    const b = '@r2\nACGT\n+\nIIII\n@r1\nACGT\n+\nIIII\n'
    await expect(importReads({ sources: [source('a', text(a)), source('b', text(b))], layout: 'pair', technology: 'illumina', put: store().put }))
      .rejects.toThrow(/not two mates of one run/)
    await expect(importReads({ sources: [source('a', text(a)), source('b', text('@r1\nACGT\n+\nIIII\n'))], layout: 'pair', technology: 'illumina', put: store().put }))
      .rejects.toThrow(/different numbers of reads/)
  })

  it('checks an interleaved file pair by pair', async () => {
    const ok = '@a/1\nAC\n+\nII\n@a/2\nGT\n+\nII\n@b/1\nAC\n+\nII\n@b/2\nGT\n+\nII\n'
    const res = await importReads({ sources: [source('i', text(ok), 5)], layout: 'interleaved', technology: 'illumina', put: store().put })
    expect(res.stats.reads).toBe(4)
    await expect(importReads({ sources: [source('i', text(ok + '@c/1\nAC\n+\nII\n'))], layout: 'interleaved', technology: 'illumina', put: store().put }))
      .rejects.toThrow(/has no mate/)
  })
})

describe('trimReads', () => {
  const wasmDir = resolve(process.cwd(), '..', 'wasm', 'fastp', '0.20.1')
  const glue = readFileSync(resolve(wasmDir, 'fastp.js'), 'utf8')
  const wasm = readFileSync(resolve(wasmDir, 'fastp.wasm'))
  const data = readFileSync(resolve(wasmDir, 'fastp.data'))
  const fastp: FastpRunner = (args, files, outputs) =>
    runTool(glue, wasm, { args, files, outputs, dataPackage: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer })

  it('cuts adapters with fastp in batches and keeps mates together', async () => {
    const { r1, r2 } = pairedReads(500)
    const raw = store()
    const imported = await importReads({ sources: [source('a', text(r1)), source('b', text(r2))], layout: 'pair', technology: 'illumina', put: raw.put, chunkReads: 256 })
    const out = store()
    const res = await trimReads({
      chunks: imported.chunks, getChunk: raw.get, paired: true, technology: 'illumina',
      settings: DEFAULT_TRIM, put: out.put, fastp, batchReads: 400,
    })
    expect(res.readsBefore).toBe(1000)
    expect(res.stats.reads).toBe(1000)
    // Reads are cut back to the 100 bp insert (fastp may leave a few adapter bases on some).
    expect(res.stats.meanLength).toBeLessThan(100.5)
    expect(res.stats.maxLength).toBeLessThan(150)
    expect(res.adapterTrimmedReads).toBeGreaterThan(980)
    const first = decodeChunk(out.chunks.get(0)!)
    expect(first.ids[0]).toBe(first.ids[1])
  }, 30_000)

  it('builds fastp arguments from the settings', () => {
    expect(fastpArgs(DEFAULT_TRIM, true)).toEqual([
      '-i', 'in1.fq', '-o', 'out1.fq', '-I', 'in2.fq', '-O', 'out2.fq', '-j', 'report.json', '-h', 'report.html', '-w', '1',
      '--detect_adapter_for_pe', '--cut_front', '--cut_tail', '-W', '4', '-M', '20', '-l', '20',
    ])
    expect(fastpArgs({ ...DEFAULT_TRIM, adapters: false, windowQuality: 0 }, false)).toContain('-A')
  })

  it('filters long reads by length and read quality', async () => {
    const reads = '@long_good\n' + 'A'.repeat(1500) + '\n+\n' + 'I'.repeat(1500) + '\n'
      + '@short\n' + 'A'.repeat(500) + '\n+\n' + 'I'.repeat(500) + '\n'
      + '@long_bad\n' + 'A'.repeat(1500) + '\n+\n' + '%'.repeat(1500) + '\n'
    const raw = store()
    const imported = await importReads({ sources: [source('ont', text(reads))], layout: 'single', technology: 'nanopore', put: raw.put })
    const out = store()
    const res = await trimReads({ chunks: imported.chunks, getChunk: raw.get, paired: false, technology: 'nanopore', settings: DEFAULT_LONG_TRIM, put: out.put })
    expect(res.stats.reads).toBe(1)
    expect(decodeChunk(out.chunks.get(0)!).ids).toEqual(['long_good'])
  })
})

describe('exportFastq', () => {
  it('writes R1 and R2 as gzip members that read back as the same reads', async () => {
    const { r1, r2 } = pairedReads(50)
    const raw = store()
    const imported = await importReads({ sources: [source('a', text(r1)), source('b', text(r2))], layout: 'pair', technology: 'illumina', put: raw.put, chunkReads: 32 })
    const files = await exportFastq({ chunks: imported.chunks, getChunk: raw.get, paired: true, layout: 'pair' })
    expect(files).toHaveLength(2)
    expect(files[0].length).toBeGreaterThan(1)
    const join = (parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
      let o = 0
      for (const p of parts) { out.set(p, o); o += p.length }
      return out
    }
    const back = []
    for await (const b of readBatches(source('R1.fastq.gz', join(files[0])))) back.push(...b)
    expect(back).toHaveLength(50)
    expect(back[0].seq).toBe(r1.split('\n')[1])
    expect(back[0].qual).toBe('F'.repeat(150))
  })
})
