import { describe, expect, it } from 'vitest'
import { parseSamLine } from './mapper'
import { MappingBuilder, mappingStorageIds, type MappingStorage } from './builder'
import { clipLeft, clipPrimer, clipRight, oligoSites, primerSites } from './primerClip'
import { differingRows, matrixCsv, samplesMatrix, verifySample } from './samples'
import { clipConsensus, decodeJunctions, describeJunction, findJunctions, findPartner } from './junctions'
import { decodePage } from './alignments'
import { describeVariant, VARIANT_PRESETS, type Variant } from '../assembly/variants'
import { sanitizeAssembly } from '../assembly/container'
import { DEFAULT_VERIFY } from '../assembly/verify'

function memoryStorage(): MappingStorage {
  const map = new Map<string, Uint8Array>()
  return {
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
  }
}
const sam = (line: string) => parseSamLine(line, n => (n === 'ref' ? 0 : -1))
const program = { id: 'x', name: 'x', version: '', command: '' }

describe('primer clipping', () => {
  it('soft-clips what aligns before or after a position, insertions and deletions at the edge included', () => {
    expect(clipLeft('10M', 100, 104)).toEqual({ cigar: '4S6M', pos: 104 })
    expect(clipLeft('2S10M', 100, 104)).toEqual({ cigar: '6S6M', pos: 104 })
    // A deletion straddling the edge is dropped; an insertion before it is clipped with it.
    expect(clipLeft('3M2I2D5M', 100, 104)).toEqual({ cigar: '5S5M', pos: 105 })
    expect(clipLeft('5H10M', 100, 103)).toEqual({ cigar: '5H3S7M', pos: 103 })
    expect(clipLeft('4M', 100, 110)).toBeNull()
    expect(clipRight('10M', 100, 106)).toEqual({ cigar: '6M4S', pos: 100 })
    expect(clipRight('6M2I4M3S', 100, 106)).toEqual({ cigar: '6M9S', pos: 100 })
    expect(clipRight('4M', 100, 100)).toBeNull()
  })

  it("clips a read's primer at its 5' end only, by strand", () => {
    const sites = primerSites([{ start: 100, end: 120 }, { start: 280, end: 300 }], 1000)
    const fwd = sam('a\t0\tref\t101\t60\t150M\t*\t0\t0\t*\t*')
    expect(clipPrimer(fwd, sites)).toBe('clipped')
    expect(fwd).toMatchObject({ pos: 120, cigar: '20S130M' })
    const rev = sam('b\t16\tref\t151\t60\t150M\t*\t0\t0\t*\t*')
    expect(clipPrimer(rev, sites)).toBe('clipped')
    expect(rev).toMatchObject({ pos: 150, cigar: '130M20S' })
    // A forward read whose start is not in a primer is left alone, whatever its end.
    const other = sam('c\t0\tref\t201\t60\t90M\t*\t0\t0\t*\t*')
    expect(clipPrimer(other, sites)).toBe('kept')
    expect(other.cigar).toBe('90M')
    const inside = sam('d\t0\tref\t103\t60\t10M\t*\t0\t0\t*\t*')
    expect(clipPrimer(inside, sites)).toBe('emptied')
    expect(inside.flag & 0x4).toBe(4)
  })

  it('splits a site across a circular origin and finds library oligos on a reference', () => {
    expect(primerSites([{ start: 990, end: 10 }], 1000)).toEqual([{ start: 0, end: 10 }, { start: 990, end: 1000 }])
    const ref = 'ACGT'.repeat(5) + 'GATTACAGGCTTTCCAAGGTCA' + 'TTGCA'.repeat(10)
    const r = oligoSites([{ id: 'p1', name: 'F', sequence: 'GATTACAGGCTTTCCAAGG', role: 'primer' } as never], [{ bases: ref, circular: false }])
    expect(r.bound).toBe(1)
    expect(r.sites[0]).toEqual([{ start: 20, end: 39 }])
  })

  it('clips primers while a mapping is stored, and reports it', async () => {
    const REF = 'ACGTTGCA'.repeat(40)
    const storage = memoryStorage()
    const b = new MappingBuilder({
      storageId: 'p', refs: [{ name: 'ref', tabId: null, bases: REF, circular: false }], paired: false, storage, expectedBases: 1000,
      primerSites: [[{ start: 0, end: 20 }]],
    })
    for (let i = 0; i < 3; i++) await b.add(sam(`r${i}\t0\tref\t1\t60\t60M\t*\t0\t0\t${REF.slice(0, 60)}\t*`), i)
    const report = await b.finish({ preset: 'sr', program })
    expect(report.primers).toEqual({ sites: 1, clipped: 3, emptied: 0 })
    const page = decodePage((await storage.get(mappingStorageIds('p').pages, 0))!)
    expect(page[0]).toMatchObject({ start: 20, cigar: '20S40M', clipL: REF.slice(0, 20) })
  })
})

const v = (position: number, frequency: number, coverage: number): Variant => describeVariant({
  c0: position - 1, c1: position, type: 'SNP', pos: position - 1, ref: 'A', alt: 'G',
  coverage, count: Math.round(frequency * coverage), pValue: 1e-20,
  forward: { ref: 5, alt: 5 }, reverse: { ref: 5, alt: 5 }, meanQuality: 35,
}, { refSeq: 'A'.repeat(100), features: [], againstConsensus: false })

describe('samples matrix', () => {
  it('lists every variant passing in some sample, telling 0% apart from not covered', () => {
    const s = { ...VARIANT_PRESETS.illumina, excludeStrandBias: false }
    const cov = (d: number) => new Array(100).fill(d)
    const rows = samplesMatrix([
      { variants: [v(10, 1, 50), v(20, 0.5, 50)], coverage: cov(50) },
      { variants: [v(10, 0.95, 40)], coverage: cov(40) },
      { variants: [], coverage: Object.assign(cov(30), { 19: 2 }) },
    ], s)
    expect(rows.map(r => r.variant.position)).toEqual([10, 20])
    expect(rows[0].cells.map(c => c.frequency)).toEqual([1, 0.95, 0])
    expect(rows[1].cells.map(c => c.frequency)).toEqual([0.5, 0, null])
    expect(rows[0].passing).toBe(2)
    expect(differingRows(rows, s).map(r => r.variant.position)).toEqual([10, 20])
    const csv = matrixCsv(rows, ['A', 'B', 'C'], () => 'ref').split('\n')
    expect(csv[0]).toBe('Reference,Position,Type,Change,Effect,A frequency,A depth,B frequency,B depth,C frequency,C depth')
    expect(csv[2]).toBe('ref,20,SNP,A>G,,0.500,50,0.000,40,,2')
  })

  it('verifies a sample against its features from coverage and its variants', () => {
    const L = 100
    const coverage = new Uint32Array(L).fill(30)
    const levels = [{ binSize: 16, mean: new Float32Array(7).fill(30), max: new Float32Array(7).fill(30), forward: new Float32Array(7).fill(15) }]
    const feat = { id: 'f', name: 'gene', type: 'CDS', start: 10, end: 40, strand: 1 as const }
    const ok = verifySample({ reference: { name: 'r', length: L, circular: false }, reads: 10, coverage, levels, variants: [], features: [feat], settings: { ...DEFAULT_VERIFY, minDepth: 10, bothStrands: true } })
    expect(ok.verdict).toBe('verified')
    const diff = { ...v(20, 0.9, 30), features: ['gene'] }
    expect(verifySample({ reference: { name: 'r', length: L, circular: false }, reads: 10, coverage, levels, variants: [diff], features: [feat], settings: { ...DEFAULT_VERIFY, minDepth: 10 } }).verdict).toBe('differences')
    coverage[30] = 3
    expect(verifySample({ reference: { name: 'r', length: L, circular: false }, reads: 10, coverage, levels, variants: [], features: [feat], settings: { ...DEFAULT_VERIFY, minDepth: 10 } }).verdict).toBe('incomplete')
  })

  it('reads an assembly saved with one mapping as one with one sample', () => {
    const report = { version: 2, references: [], reads: 1, mapped: 1 }
    const a = sanitizeAssembly({ id: 'a', contigIds: [], ngs: { readSetId: 'rs', readSetName: 'S', storageId: 'asm_1', report } })
    expect(a?.samples).toHaveLength(1)
    expect(a?.samples?.[0]).toMatchObject({ readSetName: 'S', storageId: 'asm_1' })
    expect(a && 'ngs' in a).toBe(false)
  })
})

describe('soft-clip junctions', () => {
  // A 40-base stretch deleted from the sample: reads run up to it and on after it.
  const seed = { v: 3 }
  const REF = Array.from({ length: 600 }, () => { seed.v = (seed.v * 1103515245 + 12345) % 2 ** 31; return 'ACGT'[(seed.v >>> 16) % 4] }).join('')
  const sample = REF.slice(0, 300) + REF.slice(340)

  it('takes the majority base at each distance while two reads reach it', () => {
    expect(clipConsensus(['ACGT', 'ACGA', 'TCG'])).toBe('ACGN')
    expect(clipConsensus(['AC'])).toBe('')
  })

  it('finds where reads are clipped at a deletion and where their clipped bases continue', async () => {
    const storage = memoryStorage()
    const b = new MappingBuilder({ storageId: 'j', refs: [{ name: 'ref', tabId: null, bases: REF, circular: false }], paired: false, storage, expectedBases: 5000 })
    // Reads over the deletion, aligned to its left and soft-clipped after it.
    for (let i = 0; i < 5; i++) {
      const s0 = 220 + i * 5
      const seq = sample.slice(s0, s0 + 120)
      const aligned = 300 - s0
      await b.add(sam(`L${i}\t${i % 2 ? 16 : 0}\tref\t${s0 + 1}\t60\t${aligned}M${120 - aligned}S\t*\t0\t0\t${seq}\t*`), i)
    }
    // And reads covering the left side normally, so the depth is known.
    for (let i = 0; i < 10; i++) await b.add(sam(`N${i}\t0\tref\t${101 + i}\t60\t150M\t*\t0\t0\t${REF.slice(100 + i, 250 + i)}\t*`), 10 + i)
    await b.finish({ preset: 'sr', program })
    await findJunctions({ storageId: 'j', storage, references: [{ name: 'ref', length: REF.length, circular: false }] })
    const js = decodeJunctions((await storage.get(mappingStorageIds('j').junctions, 0))!)
    expect(js).toHaveLength(1)
    const j = js[0]
    expect(j).toMatchObject({ pos: 300, side: 'right', reads: 5, forward: 3, reverse: 2 })
    expect(j.clipped.startsWith(REF.slice(340, 360))).toBe(true)
    expect(j.partner).toEqual({ ref: 0, pos: 340, strand: 1 })
    expect(describeJunction(j, 0, ['ref'])).toMatch(/deletion of 40 bases/)
  })

  it('places a left junction where its clipped bases end', () => {
    const p = findPartner({ side: 'left', clipped: [...REF.slice(280, 300)].reverse().join('') }, [{ bases: REF, circular: false }])
    expect(p).toEqual({ ref: 0, pos: 300, strand: 1 })
  })
})
