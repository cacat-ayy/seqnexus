import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { File as NodeFile } from 'node:buffer'
import { mapReads, minimap2Args, referenceFasta, parseSamLine, type ToolRunner } from './mapper'
import { encodeChunk } from './codec'
import { runTool } from '../msa/engines/emscripten'
import { exportMapping, readMappingIndex } from './sam'
import { MappingBuilder, mappingStorageIds, type MappingStorage } from './builder'
import { decodePage, describeAlignment, encodePage, sequenceOf, storeAlignment, decodeSummaries, type SamFields } from './alignments'
import { decodeSites, PileupCounter } from './pileup'
import { BamParser, inflateBgzf, reg2bin } from './bam'
import { importAlignments, readAlignmentHeader } from './alignmentImport'
import { inflateSync } from 'fflate'

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

function memoryStorage(): MappingStorage & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>()
  return {
    map,
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
  }
}

const sam = (line: string, names: string[] = ['ref0']) => parseSamLine(line, n => names.indexOf(n))

/** jsdom's Blob has no arrayBuffer(); FileReader reads it. */
function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => rej(r.error)
    r.readAsArrayBuffer(b)
  })
}
const blobText = async (b: Blob) => new TextDecoder().decode(await blobBytes(b))

async function* once(b: Uint8Array) { yield b }

async function readBam(bytes: Uint8Array): Promise<{ parser: BamParser; recs: SamFields[] }> {
  const parser = new BamParser()
  const recs: SamFields[] = []
  for await (const block of inflateBgzf(once(bytes))) {
    parser.push(block)
    if (!parser.readHeader()) continue
    for (let f = parser.next(); f; f = parser.next()) recs.push(f)
  }
  return { parser, recs }
}

describe('stored alignments', () => {
  const ref = { bases: 'ACGTACGTAC', circular: true }

  it('writes a read as differences from the reference and back', () => {
    // 2S, 3M with one mismatch, 1I, 2D, 2M, 1S
    const d = describeAlignment(ref, 1, '2S3M1I2D2M1S', 'TTCTTGGTA')
    expect(d).toEqual({ diff: ':1*gt:1+g-ac:2', clipL: 'TT', clipR: 'A' })
    expect(sequenceOf(ref, { start: 1, ...d })).toBe('TTCTTGGTA')
  })

  it('wraps across the origin of a circular reference', () => {
    const a = storeAlignment(ref, sam('r\t0\tref0\t9\t60\t4M\t*\t0\t0\tACAA\tIIII'), 5)
    expect(a).toMatchObject({ start: 8, end: 12, read: 5, diff: ':3*ca' })
    expect(sequenceOf(ref, a)).toBe('ACAA')
    const lin = describeAlignment({ bases: ref.bases, circular: false }, 8, '4M', 'ACAA')
    expect(lin.diff).toBe(':2*na*na')
  })

  it('packs a page and reads it back', () => {
    const recs = [
      storeAlignment(ref, sam('a\t0\tref0\t1\t60\t4M\t*\t0\t0\tACGT\tABCD'), 0),
      storeAlignment(ref, sam('b\t16\tref0\t3\t7\t2S2M\t=\t1\t-5\tTTGT\t*'), -1),
    ]
    expect(decodePage(encodePage(recs))).toEqual(recs)
    expect(decodePage(encodePage([]))).toEqual([])
  })
})

describe('MappingBuilder', () => {
  const refs = [{ name: 'p', tabId: null, bases: 'ACGTACGTAC', circular: true }]

  it('counts coverage, folds the circular extension, sorts across spills, and counts the report', async () => {
    const storage = memoryStorage()
    const b = new MappingBuilder({ storageId: 'm', refs, paired: true, storage, expectedBases: 20, bucketBases: 4, spillBytes: 1 })
    const lines = [
      'a\t99\tref0\t1\t60\t3M2D2M\t=\t5\t9\tACGCG\t*',
      'a\t147\tref0\t5\t60\t2M\t=\t1\t-9\tAC\t*',
      'b\t77\t*\t0\t0\t*\t*\t0\t0\tAA\t*',
      'c\t2048\tref0\t9\t0\t4M\t*\t0\t0\tACAC\t*',
      'd\t256\tref0\t2\t0\t2M\t*\t0\t0\tCG\t*',
    ]
    for (const l of lines) await b.add(sam(l), 0)
    // 3M at 0-2, deletion over 3-4, 2M at 5-6; mate 2M at 4-5; supplementary 4M at 8, 9, 0, 1.
    expect([...b.coverage[0]]).toEqual([2, 2, 1, 0, 1, 2, 1, 0, 1, 1])
    const report = await b.finish({ preset: 'sr', program: { id: 'x', name: 'x', version: '', command: '' } })
    expect(report).toMatchObject({ version: 2, reads: 3, mapped: 2, supplementary: 1, skipped: { secondary: 1, otherReference: 0 } })
    expect(report.properlyPaired).toBe(1)
    const index = await readMappingIndex(storage, 'm')
    const all = (await Promise.all(index.refs[0].pages.map(async p => decodePage((await storage.get(`m-pg`, p.index))!)))).flat()
    expect(all.map(a => a.start)).toEqual([0, 4, 8])
    // No sort buckets left behind.
    expect([...storage.map.keys()].some(k => k.startsWith('m-t'))).toBe(false)
    const levels = decodeSummaries((await storage.get(mappingStorageIds('m').summary, 0))!)
    expect(levels[0].binSize).toBe(16)
    expect(levels[0].max[0]).toBe(2)
  })

  it('finds candidate sites in the pileup', () => {
    const r = { bases: 'ACGTACGTACGT', circular: false }
    const p = new PileupCounter(r)
    for (let i = 0; i < 7; i++) p.add(storeAlignment(r, sam(`r${i}\t0\tref0\t1\t60\t12M\t*\t0\t0\tACGTACGTACGT\t*`), i))
    for (let i = 0; i < 3; i++) p.add(storeAlignment(r, sam(`s${i}\t16\tref0\t1\t60\t12M\t*\t0\t0\tACGTAGGTACGT\t*`), i))
    // One read with a low-quality mismatch, which is not counted.
    p.add(storeAlignment(r, sam('q\t0\tref0\t1\t60\t12M\t*\t0\t0\tACTTACGTACGT\tIII#IIIIIIII'), 0))
    const sites = p.finish()
    expect(sites.map(s => s.pos)).toEqual([5])
    expect(sites[0].depth).toBe(11)
    // C on the forward strand 8, G on the reverse strand 3.
    expect(sites[0].counts[1 * 2]).toBe(8)
    expect(sites[0].counts[2 * 2 + 1]).toBe(3)
  })

  it('computes BAM bins', () => {
    expect(reg2bin(0, 1)).toBe(4681)
    expect(reg2bin(0, 16385)).toBe(585)
    expect(reg2bin(0, 1 << 29)).toBe(0)
  })
})

describe('mapReads with minimap2', () => {
  it('maps paired reads, across the origin too, exports SAM and BAM, and imports them back', async () => {
    const genome = rnd(5000)
    const reads: { id: string; seq: string; qual: string }[] = []
    for (let i = 0; i < 200; i++) {
      // Fragments start anywhere, so some run across the origin.
      const start = Math.floor((i / 200) * 5000)
      const frag = (genome + genome).slice(start, start + 300)
      reads.push({ id: `p${i}`, seq: frag.slice(0, 100), qual: 'I'.repeat(100) })
      reads.push({ id: `p${i}`, seq: rc(frag).slice(0, 100), qual: 'I'.repeat(100) })
    }
    // A variant in a third of the reads over position 2500 (0-based).
    const alt = genome[2500] === 'A' ? 'C' : 'A'
    for (let i = 0; i < 30; i++) {
      const s = 2450 + i
      const seq = genome.slice(s, s + 100)
      reads.push({ id: `v${i}`, seq: seq.slice(0, 2500 - s) + alt + seq.slice(2501 - s), qual: 'I'.repeat(100) })
      reads.push({ id: `v${i}`, seq: rc(genome.slice(s + 150, s + 250)), qual: 'I'.repeat(100) })
    }
    reads.push({ id: 'junk', seq: rnd(100), qual: 'I'.repeat(100) }, { id: 'junk', seq: rnd(100), qual: 'I'.repeat(100) })
    const chunks = [encodeChunk(reads.slice(0, 200)), encodeChunk(reads.slice(200))]
    const storage = memoryStorage()
    const report = await mapReads({
      storageId: 'asm_1',
      readSet: { id: 'rs', chunks: 2, paired: true, technology: 'illumina', maxLength: 100, bases: reads.length * 100 },
      refs: [{ name: 'p X', tabId: 't1', bases: genome, circular: true }],
      preset: 'sr', minimap2,
      getChunk: async i => chunks[i],
      storage,
      batchBases: 15_000,
    })
    expect(report.reads).toBe(462)
    expect(report.mapped).toBeGreaterThanOrEqual(458)
    expect(report.mapped).toBeLessThan(462)
    expect(report.properlyPaired).toBeGreaterThan(0.95)
    // Every base covered, the origin included.
    expect(report.references[0].breadth1).toBe(1)
    expect(report.references[0].meanDepth).toBeGreaterThan(8)
    expect(report.pages).toBeGreaterThanOrEqual(1)
    expect(report.program.command).toBe(['minimap2', ...minimap2Args('sr', true)].join(' '))
    const sites = decodeSites((await storage.get(mappingStorageIds('asm_1').sites, 0))!)
    expect(sites.some(s => s.pos === 2500)).toBe(true)

    const references = [{ name: 'p X', length: 5000, circular: true }]
    const program = report.program
    // SAM: sorted, and every full-length alignment's bases are the reference's at its position.
    const out = await exportMapping({ format: 'sam', storageId: 'asm_1', storage, references, program })
    const text = await blobText(out.file)
    const lines = text.split('\n').filter(Boolean)
    expect(lines[1]).toBe('@SQ\tSN:p_X\tLN:5000')
    const recs = lines.filter(l => l[0] !== '@').map(l => l.split('\t'))
    expect(recs.length).toBe(report.mapped + report.supplementary)
    expect(recs.map(r => Number(r[3]))).toEqual([...recs.map(r => Number(r[3]))].sort((a, b) => a - b))
    let checked = 0
    for (const r of recs) {
      expect(r[10]).toMatch(/^I+$/)
      if (r[5] !== '100M' || r[0].startsWith('v')) continue
      const at = Number(r[3]) - 1
      expect(r[9]).toBe((genome + genome).slice(at, at + 100))
      checked++
    }
    expect(checked).toBeGreaterThan(300)
    expect(recs.some(r => Number(r[1]) & 16)).toBe(true)
    // Names and bases come from the stored pages, as the reads were.
    expect(recs.find(r => r[0] === 'v3' && !(Number(r[1]) & 16))?.[9]).toBe(reads.find(x => x.id === 'v3')!.seq)

    // BAM holds the same records.
    const bamOut = await exportMapping({ format: 'bam', storageId: 'asm_1', storage, references, program })
    const bamBytes = await blobBytes(bamOut.file)
    const { parser, recs: bamRecs } = await readBam(bamBytes)
    expect(parser.header?.refs).toEqual([{ name: 'p_X', length: 5000 }])
    expect(parser.header?.program?.name).toBe('minimap2')
    expect(bamRecs.length).toBe(recs.length)
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]
      const f = bamRecs[i]
      expect([f.qname, f.flag, f.pos + 1, f.mapq, f.cigar, f.seq, f.qual, f.tlen]).toEqual([r[0], Number(r[1]), Number(r[3]), Number(r[4]), r[5], r[9], r[10], Number(r[8])])
    }
    // The index finds every record overlapping a region through its bins.
    const bai = await blobBytes(bamOut.index!)
    expect([...bai.subarray(0, 4)]).toEqual([66, 65, 73, 1])
    const chunksFor = baiChunks(bai)
    const voffsets = recordOffsets(bamBytes)
    for (let i = 0; i < bamRecs.length; i += 37) {
      const v = voffsets[i]
      expect(chunksFor.some(([b, e]) => v >= b && v < e)).toBe(true)
    }

    // Read back, from either file: the same report.
    for (const [name, blob] of [['x.sam', out.file], ['x.bam', bamOut.file]] as const) {
      // Node's File, which streams (jsdom's does not).
      const file = new NodeFile([await blobBytes(blob)], name) as unknown as File
      const header = await readAlignmentHeader(file)
      expect(header.refs).toEqual([{ name: 'p_X', length: 5000 }])
      const back = memoryStorage()
      const r2 = await importAlignments({ file, fileName: name, storageId: 'imp', storage: back, refs: [{ name: 'p X', tabId: null, bases: genome, circular: true }] })
      expect(r2.mapped).toBe(report.mapped)
      expect(r2.supplementary).toBe(report.supplementary)
      expect(r2.references[0].meanDepth).toBeCloseTo(report.references[0].meanDepth, 6)
      expect(r2.importedFrom).toBe(name)
      expect(r2.preset).toBeNull()
      const again = await exportMapping({ format: 'sam', storageId: 'imp', storage: back, references, program: r2.program })
      const body = (t: string) => t.split('\n').filter(l => l && l[0] !== '@').sort()
      expect(body(await blobText(again.file))).toEqual(body(text))
    }
  }, 60_000)

  it('builds minimap2 arguments and extends circular references', () => {
    expect(minimap2Args('sr', true)).toEqual(['-a', '-x', 'sr', '--secondary=no', '-t', '1', '-o', 'out.sam', 'ref.fa', 'r1.fq', 'r2.fq'])
    expect(referenceFasta([{ name: 'p', tabId: null, bases: 'acgtacgt', circular: true }], 3)).toBe('>ref0\nACGTACGTACG\n')
  })
})

/** Every chunk of every bin in a BAI, for one reference. */
function baiChunks(bai: Uint8Array): [number, number][] {
  const dv = new DataView(bai.buffer, bai.byteOffset)
  let at = 8
  const nBin = dv.getUint32(at, true)
  at += 4
  const out: [number, number][] = []
  const u64 = (o: number) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296
  for (let b = 0; b < nBin; b++) {
    const bin = dv.getUint32(at, true)
    const n = dv.getUint32(at + 4, true)
    at += 8
    for (let c = 0; c < n; c++) {
      if (bin !== 37450) out.push([u64(at), u64(at + 8)])
      at += 16
    }
  }
  return out
}

/** Virtual offsets of each record in a BAM, by walking its blocks. */
function recordOffsets(bytes: Uint8Array): number[] {
  const blocks: { coffset: number; data: Uint8Array }[] = []
  let at = 0
  while (at < bytes.length) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + at)
    const bsize = dv.getUint16(16, true) + 1
    blocks.push({ coffset: at, data: inflateSync(bytes.subarray(at + 18, at + bsize - 8)) })
    at += bsize
  }
  // Uncompressed position to virtual offset.
  const starts: number[] = []
  let u = 0
  for (const b of blocks) { starts.push(u); u += b.data.length }
  const all = new Uint8Array(u)
  blocks.forEach((b, i) => all.set(b.data, starts[i]))
  const voff = (pos: number) => {
    let i = 0
    while (i + 1 < blocks.length && starts[i + 1] <= pos) i++
    return blocks[i].coffset * 65536 + (pos - starts[i])
  }
  const dv = new DataView(all.buffer)
  let p = 4
  const lText = dv.getInt32(p, true)
  p += 4 + lText
  const nRef = dv.getInt32(p, true)
  p += 4
  for (let i = 0; i < nRef; i++) p += 8 + dv.getInt32(p, true)
  const out: number[] = []
  while (p < all.length) {
    out.push(voff(p))
    p += 4 + dv.getInt32(p, true)
  }
  return out
}
