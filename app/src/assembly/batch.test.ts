import { describe, it, expect } from 'vitest'
import { reverseComplement } from '../models/complement'
import { assembleBatch, guessReferences, referenceAgreement } from './batch'
import { describeGrouping, groupByName, groupKey, sanitizeGrouping, suggestGrouping, type NameGrouping } from './groups'
import { sequenceInput } from './input'
import { runAssembly } from './run'
import { sanitizeAssembly } from './container'
import { testContig, testRow } from './testing'
import { DEFAULT_ASSEMBLY, type AssemblyInput } from './types'
import type { MapReference } from './map'

function dna(n: number, seed = 1): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += 'ACGT'[(x >> 16) & 3]
  }
  return s
}

const input = (name: string, seq: string): AssemblyInput => sequenceInput(name, seq)
const ref = (name: string, bases: string): MapReference => ({ name, tabId: null, bases, circular: false })
const UNDERSCORE_2: NameGrouping = { separator: '_', take: 'first', parts: 2 }

describe('grouping reads by name', () => {
  it('takes the first parts, or all but the last', () => {
    expect(groupKey('Achl_ACHLO006-09_1_F', UNDERSCORE_2)).toBe('Achl_ACHLO006-09')
    expect(groupKey('Achl_ACHLO006-09_1_F', { separator: '_', take: 'all-but-last', parts: 2 })).toBe('Achl_ACHLO006-09')
    expect(groupKey('A03.1', { separator: '.', take: 'first', parts: 1 })).toBe('A03')
  })

  it('keeps a name with too few parts as a clone of its own', () => {
    expect(groupKey('stray', UNDERSCORE_2)).toBe('stray')
    expect(groupKey('a_b', UNDERSCORE_2)).toBe('a_b')
  })

  it('groups in the order first met', () => {
    const g = groupByName(['b_1', 'a_1', 'b_2', 'a_2'], n => n, { separator: '_', take: 'first', parts: 1 })
    expect(g.map(x => [x.key, x.items])).toEqual([['b', ['b_1', 'b_2']], ['a', ['a_1', 'a_2']]])
  })

  it('suggests the grouping that pairs the reads of a plate', () => {
    const plate = ['Achl_ACHLO006-09_1_F', 'Achl_ACHLO006-09_2_R', 'Achl_ACHLO007-09_1_F', 'Achl_ACHLO007-09_2_R', 'Achl_ACHLO040-09_1_F', 'Achl_ACHLO040-09_2_R']
    expect(suggestGrouping(plate)).toEqual(UNDERSCORE_2)
    expect(suggestGrouping(['pX12_M13F', 'pX12_M13R', 'pX13_M13F', 'pX13_M13R'])).toEqual({ separator: '_', take: 'first', parts: 1 })
    expect(suggestGrouping(['A03.1', 'A03.2', 'B05.1', 'B05.2'])).toEqual({ separator: '.', take: 'first', parts: 1 })
    expect(suggestGrouping(['clone1-F', 'clone1-R', 'clone2-F', 'clone2-R'])).toEqual({ separator: '-', take: 'first', parts: 1 })
  })

  it('suggests nothing when no two reads go together', () => {
    expect(suggestGrouping(['alpha', 'beta', 'gamma'])).toBeNull()
    expect(suggestGrouping(['x_1', 'y_2'])).toBeNull()
  })

  it('describes and sanitizes a grouping', () => {
    expect(describeGrouping(UNDERSCORE_2)).toBe('the first 2 parts of the name, split at underscore (_)')
    expect(sanitizeGrouping(UNDERSCORE_2)).toEqual(UNDERSCORE_2)
    expect(sanitizeGrouping({ separator: '/', take: 'first', parts: 1 })).toBeNull()
    expect(sanitizeGrouping({ separator: '_', take: 'first', parts: 0 })).toBeNull()
    expect(sanitizeGrouping(null)).toBeNull()
  })
})

describe('assembling a plate', () => {
  // Two constructs in one vector: the inserts differ, the backbone is shared.
  const vector = dna(1500, 3)
  const insertA = dna(700, 11)
  const insertB = dna(700, 12)
  const pA = vector.slice(0, 600) + insertA + vector.slice(600)
  const pB = vector.slice(0, 600) + insertB + vector.slice(600)
  // Forward reads from the vector into the insert; reverse reads back from the other side.
  const fwd = (p: string) => p.slice(450, 1150)
  const rev = (p: string) => reverseComplement(p.slice(850, 1450))

  it('maps each clone to its own construct, one contig per clone', () => {
    const inputs = [input('c1_F', fwd(pA)), input('c1_R', rev(pA)), input('c2_F', fwd(pB)), input('c2_R', rev(pB))]
    const report = assembleBatch({
      mode: 'reference', references: [ref('pA', pA), ref('pB', pB)], inputs,
      grouping: { separator: '_', take: 'first', parts: 1 }, settings: DEFAULT_ASSEMBLY,
    })
    expect(report.unplaced).toEqual([])
    expect(report.contigs.map(c => [c.name, c.doc.reference?.name, c.doc.rows.length])).toEqual([['c1', 'pA', 2], ['c2', 'pB', 2]])
    expect(report.contigs[0].doc.rows.find(r => r.name === 'c1_R')?.reversed).toBe(true)
  })

  it('tells apart designs that differ in one base, by alignment', () => {
    const at = 900
    const swap = (s: string) => s.slice(0, at) + (s[at] === 'A' ? 'C' : 'A') + s.slice(at + 1)
    const mutant = swap(pA)
    const inputs = [input('m_F', fwd(mutant)), input('m_R', rev(mutant)), input('w_F', fwd(pA)), input('w_R', rev(pA))]
    // The mutant listed first: seeds tie, so alignment must decide both ways.
    const report = assembleBatch({
      mode: 'reference', references: [ref('wild type', pA), ref('mutant', mutant)], inputs,
      grouping: { separator: '_', take: 'first', parts: 1 }, settings: DEFAULT_ASSEMBLY,
    })
    expect(report.contigs.map(c => [c.name, c.doc.reference?.name])).toEqual([['m', 'mutant'], ['w', 'wild type']])
  })

  it('leaves out a clone that matches no reference, saying why', () => {
    const inputs = [input('c1_F', fwd(pA)), input('x_F', dna(600, 99)), input('x_R', dna(600, 98))]
    const report = assembleBatch({
      mode: 'reference', references: [ref('pA', pA), ref('pB', pB)], inputs,
      grouping: { separator: '_', take: 'first', parts: 1 }, settings: DEFAULT_ASSEMBLY,
    })
    expect(report.contigs.map(c => c.name)).toEqual(['c1'])
    expect(report.unplaced.map(u => u.name)).toEqual(['x_F', 'x_R'])
    // A chance seed or two may hold a random read against one reference: the reason then names it.
    for (const u of report.unplaced) expect(u.reason).toMatch(/^No match to any of the references$|^Only \d+% identical to p[AB], the closest reference/)
  })

  it('without grouping, sends each read to its best reference, one contig per reference', () => {
    const inputs = [input('one', fwd(pA)), input('two', fwd(pB)), input('three', rev(pA))]
    const report = runAssembly({
      mode: 'reference', reference: null, references: [ref('pA', pA), ref('pB', pB)], inputs, settings: DEFAULT_ASSEMBLY,
    })
    expect(report.contigs.map(c => [c.doc.reference?.name, c.doc.rows.map(r => r.name).sort()])).toEqual([
      ['pA', ['one', 'three']], ['pB', ['two']],
    ])
  })

  it('assembles each clone on its own de novo, named after it', () => {
    const inputs = [input('c1_F', fwd(pA)), input('c1_R', rev(pA)), input('c2_F', fwd(pB)), input('c2_R', rev(pB))]
    const apart = runAssembly({ mode: 'de-novo', reference: null, inputs, grouping: { separator: '_', take: 'first', parts: 1 }, settings: { ...DEFAULT_ASSEMBLY, minIdentity: 0.9 } })
    expect(apart.contigs.map(c => [c.name, c.doc.rows.map(r => r.name).sort()])).toEqual([['c1', ['c1_F', 'c1_R']], ['c2', ['c2_F', 'c2_R']]])
  })

  it('never joins reads of two clones de novo, however alike', () => {
    // Two clones of the same construct: alone, all four reads make one contig.
    const inputs = [input('c1_F', fwd(pA)), input('c1_R', rev(pA)), input('c2_F', fwd(pA)), input('c2_R', rev(pA))]
    const together = runAssembly({ mode: 'de-novo', reference: null, inputs, settings: DEFAULT_ASSEMBLY })
    const apart = runAssembly({ mode: 'de-novo', reference: null, inputs, grouping: { separator: '_', take: 'first', parts: 1 }, settings: DEFAULT_ASSEMBLY })
    expect(together.contigs).toHaveLength(1)
    expect(apart.contigs.map(c => c.doc.rows.length)).toEqual([2, 2])
  })

  it('keeps the reference features in the contig', () => {
    const features = [{ id: 'f1', name: 'insert', type: 'CDS', start: 600, end: 1300, strand: 1 as const }]
    const report = runAssembly({
      mode: 'reference', reference: null, references: [{ ...ref('pA', pA), features }, ref('pB', pB)],
      inputs: [input('c1_F', fwd(pA))], grouping: UNDERSCORE_2, settings: DEFAULT_ASSEMBLY,
    })
    expect(report.contigs[0].doc.reference?.features).toEqual(features)
  })
})

describe('guessing the references', () => {
  it('ticks the sequences the reads come from, not the others', () => {
    const vector = dna(1500, 3)
    const pA = vector.slice(0, 600) + dna(700, 11) + vector.slice(600)
    const reads = [input('a_F', pA.slice(450, 1150)), input('a_R', reverseComplement(pA.slice(850, 1450)))]
    const other = dna(2686, 77)
    expect(guessReferences(reads, [{ bases: other, circular: true }, { bases: pA, circular: false }, { bases: 'ACGT', circular: false }])).toEqual([false, true, false])
  })
})

describe('agreement with the reference', () => {
  it('counts matches and charges mismatches and gaps', () => {
    const doc = testContig([testRow('r', 0, 'ACGTT-'), testRow('s', 2, 'GT')], 'ACG-TA')
    // r: A C G (T vs -) T (- vs A) = 3 + -2 + 1 + -2; s: G (T vs -) = 1 - 2
    expect(referenceAgreement(doc)).toBe(-1)
  })
})

describe('stored plate assemblies', () => {
  it('keep their grouping and references', () => {
    const a = sanitizeAssembly({
      id: 'asm_1', name: 'Plate 1', contigIds: ['c1'], method: 'reference', settings: DEFAULT_ASSEMBLY,
      inputs: { readIds: ['r1'], reference: { name: 'pA', tabId: 't1' }, references: [{ name: 'pA', tabId: 't1' }, { name: 'pB', tabId: null }] },
      unplaced: [], grouping: UNDERSCORE_2,
    })!
    expect(a.grouping).toEqual(UNDERSCORE_2)
    expect(a.inputs.references).toEqual([{ name: 'pA', tabId: 't1' }, { name: 'pB', tabId: null }])
    const plain = sanitizeAssembly({ id: 'asm_2', name: 'x', contigIds: ['c'], method: 'reference', inputs: { readIds: [], reference: null }, unplaced: [], grouping: { separator: '?' } })!
    expect(plain.grouping).toBeUndefined()
    expect(plain.inputs.references).toBeUndefined()
  })
})
