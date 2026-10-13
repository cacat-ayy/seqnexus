import { describe, expect, it } from 'vitest'
import { parseSamLine } from './mapper'
import { MappingBuilder, mappingStorageIds, type MappingStorage } from './builder'
import { callMapping, decodeCalls, siteConsensus, siteVariants } from './calls'
import {
  DEFAULT_VARIANT_SETTINGS, homopolymerRun, poissonTail, VARIANT_PRESETS, variantFilters, variantQual, type RefFeature,
} from '../assembly/variants'
import { vcfAlleles, writeVcf } from '../assembly/vcf'
import { liftFeatures } from './denovo/compare'

function memoryStorage(): MappingStorage {
  const map = new Map<string, Uint8Array>()
  return {
    put: async (id, i, d) => { map.set(`${id}:${i}`, d) },
    get: async (id, i) => map.get(`${id}:${i}`),
    remove: async ids => { for (const k of [...map.keys()]) if (ids.includes(k.slice(0, k.lastIndexOf(':')))) map.delete(k) },
  }
}

// CDS from 3: ATG AAA GCT TGG TAA (M K A W *).
const REF = 'CCCATGAAAGCTTGGTAAGGGGGGTTACGATCGATCGTACG' // 41 bp
const CDS: RefFeature = { id: 'f', name: 'gene', type: 'CDS', start: 3, end: 18, strand: 1 }
const Q = (n: number) => 'I'.repeat(n)

/** Reads of the whole reference, with the given changes. */
async function mapping(reads: { seq: string; cigar: string; flag?: number }[], circular = false) {
  const storage = memoryStorage()
  const refs = [{ name: 'ref', tabId: null, bases: REF, circular }]
  const b = new MappingBuilder({ storageId: 'm', refs, paired: false, storage, expectedBases: 2000, bucketBases: 50, spillBytes: 1 })
  let i = 0
  for (const r of reads) await b.add(parseSamLine(`r${i++}\t${r.flag ?? (i % 2 ? 0 : 16)}\tref\t1\t60\t${r.cigar}\t*\t0\t0\t${r.seq}\t${Q(r.seq.length)}`, n => (n === 'ref' ? 0 : -1)), i)
  await b.finish({ preset: 'sr', program: { id: 'x', name: 'x', version: '', command: '' } })
  await callMapping({ storageId: 'm', storage, references: [{ name: 'ref', length: REF.length, circular }] })
  const calls = decodeCalls((await storage.get(mappingStorageIds('m').calls, 0))!)
  return calls
}

const snp = REF.slice(0, 7) + 'G' + REF.slice(8) // AAA -> AGA at 7: K2R
const del = REF.slice(0, 20) + REF.slice(22) // GG deleted from the G run at 18-23
const ins = REF.slice(0, 30) + 'TT' + REF.slice(30)

describe('NGS variant calling', () => {
  it('recounts the candidate sites and calls a SNP, a deletion and an insertion', async () => {
    const reads = [
      ...Array.from({ length: 8 }, () => ({ seq: snp, cigar: '41M' })),
      ...Array.from({ length: 2 }, () => ({ seq: REF, cigar: '41M' })),
      ...Array.from({ length: 6 }, () => ({ seq: del, cigar: '20M2D19M' })),
      ...Array.from({ length: 5 }, () => ({ seq: ins, cigar: '30M2I11M' })),
    ]
    const calls = await mapping(reads)
    const vs = siteVariants(calls, REF, [CDS], 'illumina')
    const s = vs.find(v => v.type === 'SNP')!
    expect(s).toMatchObject({ position: 8, ref: 'A', alt: 'G', count: 8, coverage: 21 })
    expect(s.coding).toMatchObject({ protein: 'K2R', effect: 'Missense' })
    expect(s.forward.alt + s.reverse.alt).toBe(8)
    expect(s.alleles?.find(a => a.allele === 'G')?.meanQuality).toBe(40)
    const d = vs.find(v => v.type === 'Deletion')!
    expect(d).toMatchObject({ position: 21, ref: 'GG', count: 6, homopolymer: 6 })
    const i = vs.find(v => v.type === 'Insertion')!
    expect(i).toMatchObject({ position: 30, alt: 'TT', count: 5 })
    // Nanopore thresholds leave out the deletion in the run of six Gs.
    expect(variantFilters(d, VARIANT_PRESETS.nanopore)).toContain('homopolymer')
    expect(variantFilters(s, { ...VARIANT_PRESETS.illumina, excludeStrandBias: false })).toEqual([])
  })

  it('builds a consensus with a threshold, masking low coverage and writing mixed bases as IUPAC codes', async () => {
    const reads = [
      ...Array.from({ length: 6 }, () => ({ seq: snp, cigar: '41M' })),
      ...Array.from({ length: 2 }, () => ({ seq: REF, cigar: '41M' })),
      ...Array.from({ length: 12 }, () => ({ seq: del, cigar: '20M2D19M' })),
    ]
    const calls = await mapping(reads)
    const cov = new Uint32Array(REF.length).fill(20)
    cov[40] = 3
    // Per-base coverage counts aligned bases only: the 8 reads that keep the deleted Gs.
    cov[20] = 8
    cov[21] = 8
    const half = siteConsensus(REF, cov, calls, { threshold: 0.5, minDepth: 10, iupac: true })
    // 6 of 20 reads carry the G and 12 of 20 the deletion: at 0.5 the G loses to A, the deletion is in.
    expect(half.bases).toBe(REF.slice(0, 20) + REF.slice(22, 40) + 'N')
    expect(half.masked).toBe(1)
    const strict = siteConsensus(REF, cov, calls, { threshold: 0.9, minDepth: 10, iupac: true })
    expect(strict.bases[7]).toBe('R')
  })

  it('maps reference positions onto the consensus, so the reference\'s features come along', async () => {
    const reads = [
      ...Array.from({ length: 12 }, () => ({ seq: del, cigar: '20M2D19M' })),
      ...Array.from({ length: 12 }, () => ({ seq: ins, cigar: '30M2I11M' })),
    ]
    const calls = await mapping(reads)
    const r = siteConsensus(REF, null, calls, { threshold: 0.5, minDepth: 0, iupac: true })
    expect(r.bases).toBe(REF.slice(0, 20) + REF.slice(22, 30) + 'TT' + REF.slice(30))
    // Before the deletion nothing moves, the deleted bases have no place, and after it everything is two
    // back, until the inserted TT (written after reference base 29) puts it level again.
    expect(r.toConsensus[3]).toBe(3)
    expect([r.toConsensus[20], r.toConsensus[21]]).toEqual([-1, -1])
    expect(r.toConsensus[25]).toBe(23)
    expect(r.toConsensus[35]).toBe(35)
    const lifted = liftFeatures([
      { id: 'cds', name: 'gene', type: 'CDS', start: 3, end: 18, strand: 1 },
      { id: 'run', name: 'G run', type: 'misc_feature', start: 18, end: 24, strand: 1 },
      { id: 'gone', name: 'gone', type: 'misc_feature', start: 20, end: 22, strand: 1 },
      { id: 'tail', name: 'tail', type: 'misc_feature', start: 28, end: 41, strand: 1 },
    ], { toContig: r.toConsensus, bases: r.bases }, false)
    expect(lifted.features.map(f => [f.id, f.start, f.end])).toEqual([['cds', 3, 18], ['run', 18, 22], ['tail', 26, 41]])
    expect(lifted.dropped).toEqual(['gone'])
    // The G run lost the deleted Gs; the tail holds the inserted TT.
    expect(lifted.changed).toEqual(['G run', 'tail'])
  })

  it('counts a read across a circular origin at the sites at the start', async () => {
    // Starts 6 before the end and runs 12 bases: 35-40 then 0-5, with C>T at 1.
    const wrapped = REF.slice(35) + 'C' + 'T' + REF.slice(2, 6)
    const reads = Array.from({ length: 4 }, () => ({ seq: wrapped, cigar: '12M' }))
    const storage = memoryStorage()
    const refs = [{ name: 'ref', tabId: null, bases: REF, circular: true }]
    const b = new MappingBuilder({ storageId: 'c', refs, paired: false, storage, expectedBases: 200, bucketBases: 50, spillBytes: 1 })
    let n = 0
    for (const r of reads) await b.add(parseSamLine(`w${n++}\t0\tref\t36\t60\t${r.cigar}\t*\t0\t0\t${r.seq}\t${Q(12)}`, () => 0), n)
    await b.finish({ preset: 'sr', program: { id: 'x', name: 'x', version: '', command: '' } })
    await callMapping({ storageId: 'c', storage, references: [{ name: 'ref', length: REF.length, circular: true }] })
    const calls = decodeCalls((await storage.get(mappingStorageIds('c').calls, 0))!)
    const v = siteVariants(calls, REF, [], 'illumina')
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ position: 2, ref: 'C', alt: 'T', count: 4 })
  })
})

describe('variant helpers', () => {
  it('finds the homopolymer an indel is in', () => {
    expect(homopolymerRun('ACGGGGT', 'Deletion', 3, 'G')).toBe(4)
    expect(homopolymerRun('ACGGGGT', 'Insertion', 1, 'G')).toBe(4)
    expect(homopolymerRun('ACGGGGT', 'Insertion', 5, 'G')).toBe(4)
    expect(homopolymerRun('ACGGGGT', 'Deletion', 3, 'GT')).toBeNull()
    expect(homopolymerRun('ACGT', 'Deletion', 1, 'C')).toBeNull()
  })

  it('computes a Poisson tail, deep and tiny', () => {
    expect(poissonTail(1, 1)).toBeCloseTo(1 - Math.exp(-1))
    expect(poissonTail(2, 0)).toBe(1)
    expect(poissonTail(0.1, 50)).toBeGreaterThan(0)
    expect(poissonTail(0.1, 50)).toBeLessThan(1e-100)
    expect(variantQual({ pValue: 1e-3 })).toBeCloseTo(30)
    expect(variantQual({ pValue: 0 })).toBe(999)
  })
})

describe('VCF', () => {
  const v = (type: 'SNP' | 'Insertion' | 'Deletion', position: number, ref: string, alt: string) => ({
    c0: 0, c1: 1, type, position, ref, alt, coverage: 20, count: 10, frequency: 0.5, pValue: 1e-8, strandBiasP: 0.5,
    forward: { ref: 5, alt: 5 }, reverse: { ref: 5, alt: 5 }, meanQuality: 30, features: ['gene'],
    coding: null, otherCoding: [], repeat: null, homopolymer: null, againstConsensus: false,
  })

  it('anchors indels on the base before, or after at the first base', () => {
    expect(vcfAlleles(v('SNP', 8, 'A', 'G'), REF)).toEqual({ pos: 8, ref: 'A', alt: 'G' })
    expect(vcfAlleles(v('Deletion', 21, 'GG', ''), REF)).toEqual({ pos: 20, ref: 'GGG', alt: 'G' })
    expect(vcfAlleles(v('Deletion', 1, 'C', ''), REF)).toEqual({ pos: 1, ref: 'CC', alt: 'C' })
    expect(vcfAlleles(v('Insertion', 30, '', 'TT'), REF)).toEqual({ pos: 30, ref: 'A', alt: 'ATT' })
    expect(vcfAlleles(v('Insertion', 0, '', 'TT'), REF)).toEqual({ pos: 1, ref: 'C', alt: 'TTC' })
  })

  it('writes a header, contigs and records with their filters', () => {
    const text = writeVcf({
      references: [{ name: 'my ref', bases: REF, variants: [{ v: v('SNP', 8, 'A', 'G'), filters: [] }, { v: v('Deletion', 21, 'GG', ''), filters: ['homopolymer', 'quality'] }] }],
      source: 'sample A', referenceName: 'my ref', date: new Date(2026, 9, 6),
    })
    const lines = text.trim().split('\n')
    expect(lines[0]).toBe('##fileformat=VCFv4.2')
    expect(lines).toContain('##fileDate=20261006')
    expect(lines).toContain(`##contig=<ID=my_ref,length=${REF.length}>`)
    const recs = lines.filter(l => !l.startsWith('#'))
    expect(recs[0].split('\t').slice(0, 7)).toEqual(['my_ref', '8', '.', 'A', 'G', '80.0', 'PASS'])
    expect(recs[0]).toContain('DP4=5,5,5,5')
    expect(recs[1].split('\t')[6]).toBe('Homopolymer;LowQual')
  })

  it('keeps the Sanger defaults unchanged', () => {
    expect(DEFAULT_VARIANT_SETTINGS).toMatchObject({ minCoverage: 1, minFrequency: 0.25, maxPValue: 1e-4, minAltReads: 0, excludeHomopolymerIndels: false })
  })
})
