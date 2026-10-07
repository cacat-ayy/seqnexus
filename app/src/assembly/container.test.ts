import { describe, expect, it } from 'vitest'
import { assemblyName, contigSummary, linkAssemblies, referenceSource, runFromDocs, sanitizeAssembly, type AssemblyRecord } from './container'
import { testContig, testRow } from './testing'

const contig = (id: string, assemblyId?: string) => ({
  id, name: `C ${id}`, createdAt: 5, modifiedAt: 7,
  doc: testContig([testRow('a', 0, 'ACGT', { readId: `r-${id}` })]),
  ...(assemblyId ? { assemblyId } : {}),
})

const assembly = (id: string, contigIds: string[]): AssemblyRecord => ({
  id, name: `A ${id}`, createdAt: 1, modifiedAt: 1, contigIds,
  method: 'de-novo', settings: null, inputs: { readIds: [], reference: null }, unplaced: [],
})

describe('linkAssemblies', () => {
  let n = 0
  const newId = () => `new${++n}`

  it('keeps assemblies with their contigs and points each contig back', () => {
    const out = linkAssemblies([assembly('x', ['1', '2'])], [contig('1', 'x'), contig('2', 'x')], newId)
    expect(out.assemblies.map(a => a.contigIds)).toEqual([['1', '2']])
    expect(out.contigs.map(c => c.assemblyId)).toEqual(['x', 'x'])
    expect(out.wrapped.size).toBe(0)
  })

  it('wraps a contig no assembly lists in an assembly of its own', () => {
    n = 0
    const out = linkAssemblies([], [contig('1')], newId)
    expect(out.assemblies).toHaveLength(1)
    expect(out.assemblies[0]).toMatchObject({ id: 'new1', name: 'C 1', createdAt: 5, modifiedAt: 7, contigIds: ['1'], method: 'de-novo' })
    expect(out.assemblies[0].inputs.readIds).toEqual(['r-1'])
    expect(out.contigs[0].assemblyId).toBe('new1')
    expect(out.wrapped.get('contig:1')).toBe('assembly:new1')
  })

  it('drops missing contigs, and assemblies left with none', () => {
    const out = linkAssemblies([assembly('x', ['1', 'gone']), assembly('y', ['gone'])], [contig('1', 'x')], newId)
    expect(out.assemblies.map(a => [a.id, a.contigIds])).toEqual([['x', ['1']]])
  })

  it('gives a contig listed twice to one assembly only', () => {
    const out = linkAssemblies([assembly('x', ['1']), assembly('y', ['1', '2'])], [contig('1'), contig('2')], newId)
    expect(out.assemblies.map(a => [a.id, a.contigIds])).toEqual([['x', ['1']], ['y', ['2']]])
  })
})

describe('runFromDocs', () => {
  it('reads method, reference and reads back from the contigs', () => {
    const doc = testContig([testRow('a', 0, 'ACGT', { readId: 'r1' }), testRow('b', 1, 'CGT', { readId: 'r1' })], 'ACGT', 'pUC19', 'tab1')
    expect(runFromDocs([doc])).toEqual({
      method: 'reference', settings: null, unplaced: [],
      inputs: { readIds: ['r1'], reference: { tabId: 'tab1', name: 'pUC19' } },
    })
  })
})

describe('sanitizeAssembly', () => {
  it('rejects one without contigs and repairs the rest', () => {
    expect(sanitizeAssembly({ id: 'x', contigIds: [] })).toBeNull()
    expect(sanitizeAssembly(null)).toBeNull()
    const a = sanitizeAssembly({ id: 'x', contigIds: ['1', 3], settings: { minIdentity: 0.8 }, unplaced: [{ name: 'r', reason: 'why' }, { bad: 1 }] })
    expect(a).toMatchObject({ id: 'x', name: 'Assembly', contigIds: ['1'], settings: null, method: 'de-novo' })
    expect(a!.unplaced).toEqual([{ name: 'r', reason: 'why', readId: null }])
  })

  it('keeps an NGS de novo report with its mapping, and drops a damaged one', () => {
    const report = {
      version: 2, preset: 'map-ont', program: { id: 'minimap2', name: 'minimap2', version: '2.22', command: '' },
      reads: 10, mapped: 10, supplementary: 0, properlyPaired: null, mapq: { edges: [], counts: [] }, insertSizes: null,
      references: [], pages: 1, storedBytes: 1, skipped: { secondary: 0, otherReference: 0 },
    }
    const denovo = {
      version: 1, settings: { method: 'long-seed', minReads: 5, rounds: 5 }, reads: 10, polishReads: 10,
      lengths: { edges: [0, 100], counts: [10] }, peaks: [], contigs: [],
    }
    const samples = [{ readSetId: 'rs', readSetName: 'R', storageId: 'asm_1', report }]
    expect(sanitizeAssembly({ ...assembly('x', []), samples, denovo })!.denovo).toEqual(denovo)
    expect(sanitizeAssembly({ ...assembly('x', []), samples, denovo: { version: 9 } })!.denovo).toBeUndefined()
    // A long-read genome keeps its layout instead of peaks.
    const genome = { version: 1, settings: { method: 'long-olc', minReads: 5, rounds: 5 }, reads: 10, contigs: [], genome: { readsUsed: 10 } }
    expect(sanitizeAssembly({ ...assembly('x', []), samples, denovo: genome })!.denovo).toEqual(genome)
    expect(sanitizeAssembly({ ...assembly('x', []), samples, denovo: { ...genome, genome: undefined } })!.denovo).toBeUndefined()
  })

  it('keeps complete settings', () => {
    const a = sanitizeAssembly({ ...assembly('x', ['1']), settings: { minIdentity: 0.9, minOverlap: 30, k: 12 } })
    expect(a!.settings).toEqual({ minIdentity: 0.9, minOverlap: 30, k: 12 })
  })
})

describe('referenceSource', () => {
  it('strips gap columns and the circular extension', () => {
    const doc = testContig([testRow('a', 0, 'AC-GTAC')], 'AC-GTAC')
    doc.reference!.length = 4
    expect(referenceSource(doc)).toBe('ACGT')
  })
})

describe('contigSummary', () => {
  it('counts depth over spanned columns and reference covered', () => {
    const doc = testContig([testRow('a', 0, 'ACGT'), testRow('b', 2, 'GT')], 'ACGTAAAA')
    const s = contigSummary(doc)
    expect(s.reads).toBe(2)
    expect(s.width).toBe(8)
    expect(s.meanDepth).toBeCloseTo(6 / 4)
    expect(s.referenceCovered).toBeCloseTo(0.5)
  })

  it('counts the circular extension as the start of the reference', () => {
    // Reference of 4 bases extended by 2: the read across the origin covers bases 3, 0 and 1.
    const doc = testContig([testRow('a', 3, 'TAC')], 'ACGTAC')
    doc.reference!.length = 4
    expect(contigSummary(doc).referenceCovered).toBeCloseTo(3 / 4)
  })

  it('has no reference figure de novo', () => {
    expect(contigSummary(testContig([testRow('a', 0, 'ACGT')])).referenceCovered).toBeNull()
  })
})

describe('assemblyName', () => {
  const day = new Date('2026-10-05T12:00:00Z')
  it('names a mapping after its reference', () => {
    expect(assemblyName(['a', 'b'], 'pUC19', day)).toBe('pUC19 assembly')
  })
  it('names de novo after what the read names share', () => {
    expect(assemblyName(['COI_F_A01.ab1', 'COI_R_A02.ab1'], null, day)).toBe('COI assembly')
  })
  it('falls back to the date', () => {
    expect(assemblyName(['x1', 'y2'], null, day)).toBe('Assembly 2026-10-05')
    expect(assemblyName(['sample1'], null, day)).toBe('Assembly 2026-10-05')
  })
})
