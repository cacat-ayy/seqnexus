import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inflateSync } from 'fflate'
import { mapReads, minimap2Args, referenceFasta, SamAccumulator, type ToolRunner } from './mapper'
import { encodeChunk } from './codec'
import { runTool } from '../msa/engines/emscripten'

const dir = resolve(process.cwd(), '..', 'wasm', 'minimap2', '2.22')
const glue = readFileSync(resolve(dir, 'minimap2.js'), 'utf8')
const wasm = readFileSync(resolve(dir, 'minimap2.wasm'))
const data = readFileSync(resolve(dir, 'minimap2.data'))
const dataPackage = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
const minimap2: ToolRunner = (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage })

const seed = { v: 99 }
const rnd = (n: number) => Array.from({ length: n }, () => {
  seed.v = (seed.v * 1103515245 + 12345) % 2 ** 31
  return 'ACGT'[(seed.v >>> 16) % 4]
}).join('')
const rc = (s: string) => s.split('').reverse().map(c => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c]).join('')

describe('SamAccumulator', () => {
  it('counts aligned bases as coverage, folds the circular extension, and numbers reads', () => {
    const acc = new SamAccumulator([10], true)
    const sam = [
      '@HD\tVN:1.6',
      'a\t99\tref0\t1\t60\t3M2D2M\t=\t5\t9\tAAAAA\t*',
      'a\t147\tref0\t5\t60\t2M\t=\t1\t-9\tAA\t*',
      'b\t77\t*\t0\t0\t*\t*\t0\t0\tAA\t*',
      'c\t2048\tref0\t9\t0\t4M\t*\t0\t0\tAAAA\t*',
    ].join('\n')
    const stored = acc.addSam(sam, 100)
    // 3M at 0-2, deletion over 3-4, 2M at 5-6; mate 2M at 4-5; supplementary 4M at 8, 9, 0, 1.
    expect([...acc.coverage[0]]).toEqual([2, 2, 1, 0, 1, 2, 1, 0, 1, 1])
    expect(acc.reads).toBe(3)
    expect(acc.mapped).toBe(2)
    expect(stored.split('\n').map(l => l.split('\t')[2])).toEqual(['100', '101', '-1'])
  })

  it('builds minimap2 arguments and extends circular references', () => {
    expect(minimap2Args('sr', true)).toEqual(['-a', '-x', 'sr', '--secondary=no', '-t', '1', '-o', 'out.sam', 'ref.fa', 'r1.fq', 'r2.fq'])
    expect(referenceFasta([{ name: 'p', tabId: null, bases: 'acgtacgt', circular: true }], 3)).toBe('>ref0\nACGTACGTACG\n')
  })
})

describe('mapReads with minimap2', () => {
  it('maps paired reads, across the origin of a circular reference too', async () => {
    const genome = rnd(5000)
    const reads: { id: string; seq: string; qual: string }[] = []
    for (let i = 0; i < 200; i++) {
      // Fragments start anywhere, so some run across the origin.
      const start = Math.floor((i / 200) * 5000)
      const frag = (genome + genome).slice(start, start + 300)
      reads.push({ id: `p${i}`, seq: frag.slice(0, 100), qual: 'I'.repeat(100) })
      reads.push({ id: `p${i}`, seq: rc(frag).slice(0, 100), qual: 'I'.repeat(100) })
    }
    reads.push({ id: 'junk', seq: rnd(100), qual: 'I'.repeat(100) }, { id: 'junk', seq: rnd(100), qual: 'I'.repeat(100) })
    const chunks = [encodeChunk(reads.slice(0, 200)), encodeChunk(reads.slice(200))]
    const stored: Uint8Array[] = []
    const report = await mapReads({
      readSet: { id: 'rs', chunks: 2, paired: true, technology: 'illumina', maxLength: 100 },
      refs: [{ name: 'pX', tabId: 't1', bases: genome, circular: true }],
      preset: 'sr', minimap2,
      getChunk: async i => chunks[i],
      putAlignments: async (i, d) => { stored[i] = d },
      putCoverage: async () => {},
      batchBases: 15_000,
    })
    expect(report.reads).toBe(402)
    expect(report.mapped).toBeGreaterThanOrEqual(398)
    expect(report.mapped).toBeLessThan(402)
    expect(report.properlyPaired).toBeGreaterThan(0.95)
    // Every base covered, the origin included.
    expect(report.references[0].breadth1).toBe(1)
    expect(report.references[0].meanDepth).toBeGreaterThan(7)
    expect(report.alignmentChunks).toBeGreaterThan(1)
    const first = new TextDecoder().decode(inflateSync(stored[0])).split('\n')[0].split('\t')
    expect(first[2]).toBe('0')
  }, 60_000)
})
