import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { getEnzyme } from '../enzymes/db'
import { digestFragments, ligateFragments, partialDigestFragments, extractOverhang, areOverhangsCompatible } from './digest'

function makeDoc(
  name: string,
  bases: string,
  topology: 'linear' | 'circular' = 'linear',
  annotations: Annotation[] = [],
): DocumentState {
  return { name, sequence: new Sequence(bases, topology), annotations }
}

// EcoRI: GAATTC, fwd_cut=1, rev_cut=5 → 5' overhang AATT
const EcoRI = getEnzyme('EcoRI')!
// BamHI: GGATCC, fwd_cut=1, rev_cut=5 → 5' overhang GATC
const BamHI = getEnzyme('BamHI')!
// SmaI: CCCGGG, fwd_cut=3, rev_cut=3 → blunt (available for future tests)
// EcoRV: GATATC, fwd_cut=3, rev_cut=3 → blunt
const EcoRV = getEnzyme('EcoRV')!

describe('extractOverhang', () => {
  it('returns blunt when fwdCut === revCut', () => {
    const oh = extractOverhang('ATGCCCGGGATG', 5, 5)
    expect(oh.type).toBe('blunt')
    expect(oh.sequence).toBe('')
  })

  it('returns 5-prime overhang when fwdCut < revCut', () => {
    // EcoRI at position 3: GAATTC → fwdCut=4, revCut=8
    // Overhang = bases[4..8) = ATTC... wait, let me think about this.
    // EcoRI: recognition GAATTC, fwd_cut=1, rev_cut=5
    // If site starts at pos 3: fwdCut = 3+1 = 4, revCut = 3+5 = 8
    // Overhang = bases[4..8) = the 4 bases between cuts
    const seq = 'AAAGAATTCAAA'
    const oh = extractOverhang(seq, 4, 8)
    expect(oh.type).toBe('five_prime')
    expect(oh.sequence).toBe('AATT')
  })

  it('returns 3-prime overhang when fwdCut > revCut', () => {
    // KpnI: GGTACC, fwd_cut=5, rev_cut=1 → 3' overhang
    // If site at pos 3: fwdCut=8, revCut=4
    // Overhang = reverseComplement(bases[4..8))
    const seq = 'AAAGGTACCAAA'
    const oh = extractOverhang(seq, 8, 4)
    expect(oh.type).toBe('three_prime')
    // bases[4..8) = GTAC, reverseComplement(GTAC) = GTAC (palindromic)
    expect(oh.sequence).toBe('GTAC')
  })
})

describe('areOverhangsCompatible', () => {
  it('blunt + blunt are compatible', () => {
    expect(areOverhangsCompatible(
      { sequence: '', type: 'blunt' },
      { sequence: '', type: 'blunt' },
    )).toBe(true)
  })

  it('blunt + sticky are incompatible', () => {
    expect(areOverhangsCompatible(
      { sequence: '', type: 'blunt' },
      { sequence: 'AATT', type: 'five_prime' },
    )).toBe(false)
  })

  it('matching 5-prime overhangs are compatible (reverse complements)', () => {
    // EcoRI produces AATT on both ends - AATT is self-complementary
    expect(areOverhangsCompatible(
      { sequence: 'AATT', type: 'five_prime' },
      { sequence: 'AATT', type: 'five_prime' },
    )).toBe(true)
  })

  it('non-matching 5-prime overhangs are incompatible', () => {
    expect(areOverhangsCompatible(
      { sequence: 'AATT', type: 'five_prime' },
      { sequence: 'GATC', type: 'five_prime' },
    )).toBe(false)
  })

  it('different overhang types are incompatible', () => {
    expect(areOverhangsCompatible(
      { sequence: 'AATT', type: 'five_prime' },
      { sequence: 'AATT', type: 'three_prime' },
    )).toBe(false)
  })

  it('BamHI GATC overhangs are self-compatible', () => {
    // GATC reverse complement is GATC
    expect(areOverhangsCompatible(
      { sequence: 'GATC', type: 'five_prime' },
      { sequence: 'GATC', type: 'five_prime' },
    )).toBe(true)
  })
})

describe('digestFragments', () => {
  it('returns uncut fragment when no sites found', () => {
    const doc = makeDoc('test', 'ATGCATGCATGC')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(1)
    expect(frags[0].name).toContain('uncut')
    expect(frags[0].sequence).toBe('ATGCATGCATGC')
  })

  it('digests linear sequence with single EcoRI site into 2 fragments', () => {
    // EcoRI: GAATTC, fwd_cut=1, rev_cut=5
    // Sequence: AAAGAATTCAAA (12 bp)
    // Site at pos 3, fwdCut=4, revCut=8
    // Fragment 1: bases[0..4) = AAAG (4 bp), blunt 5', AATT 3'
    // Fragment 2: bases[4..12) = AATTCAAA (8 bp), AATT 5', blunt 3'
    const doc = makeDoc('test', 'AAAGAATTCAAA')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(2)

    expect(frags[0].sequence).toBe('AAAG')
    expect(frags[0].overhang5Type).toBe('blunt')
    expect(frags[0].overhang3Type).toBe('five_prime')
    expect(frags[0].overhang3).toBe('AATT')

    expect(frags[1].sequence).toBe('AATTCAAA')
    expect(frags[1].overhang5Type).toBe('five_prime')
    expect(frags[1].overhang5).toBe('AATT')
    expect(frags[1].overhang3Type).toBe('blunt')
  })

  it('digests linear sequence with two EcoRI sites into 3 fragments', () => {
    // Two EcoRI sites
    const seq = 'AAAGAATTCTTTTGAATTCAAA'
    // Site 1 at pos 3: fwdCut=4
    // Site 2 at pos 13: fwdCut=14
    const doc = makeDoc('test', seq)
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(3)
    expect(frags[0].sequence).toBe('AAAG')
    expect(frags[1].sequence).toBe('AATTCTTTTG')
    expect(frags[2].sequence).toBe('AATTCAAA')
  })

  it('digests with blunt cutter (EcoRV)', () => {
    // EcoRV: GATATC, fwd_cut=3, rev_cut=3 → blunt
    const seq = 'AAAGATATCAAA'
    const doc = makeDoc('test', seq)
    const { fragments: frags } = digestFragments(doc, [EcoRV])
    expect(frags).toHaveLength(2)
    expect(frags[0].overhang3Type).toBe('blunt')
    expect(frags[0].overhang3).toBe('')
    expect(frags[1].overhang5Type).toBe('blunt')
    expect(frags[1].overhang5).toBe('')
  })

  it('double digest with EcoRI + BamHI', () => {
    // EcoRI at pos 3, BamHI at pos 15
    const seq = 'AAAGAATTCAAAAAGGATCCAAA'
    const doc = makeDoc('test', seq)
    const { fragments: frags } = digestFragments(doc, [EcoRI, BamHI])
    expect(frags).toHaveLength(3)

    // First fragment: blunt 5', EcoRI 3'
    expect(frags[0].overhang3).toBe('AATT')
    // Middle fragment: EcoRI 5', BamHI 3'
    expect(frags[1].overhang5).toBe('AATT')
    expect(frags[1].overhang3).toBe('GATC')
    // Last fragment: BamHI 5', blunt 3'
    expect(frags[2].overhang5).toBe('GATC')
  })

  it('digests circular sequence with single site into 1 linearized fragment', () => {
    const seq = 'AAAGAATTCAAA'
    const doc = makeDoc('test', seq, 'circular')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(1)
    // The single fragment should have compatible EcoRI overhangs on both ends
    expect(frags[0].overhang5).toBe('AATT')
    expect(frags[0].overhang3).toBe('AATT')
  })

  it('transfers annotations within fragments', () => {
    const ann = new Annotation({ id: 'a1', name: 'GFP', type: 'CDS', start: 5, end: 8, strand: 1 })
    // EcoRI at pos 3: fwdCut=4
    // Fragment 2 starts at pos 4, so annotation at [5,8) becomes [1,4) in fragment-local coords
    const doc = makeDoc('test', 'AAAGAATTCAAA', 'linear', [ann])
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(2)
    expect(frags[0].annotations).toHaveLength(0) // annotation is in fragment 2
    expect(frags[1].annotations).toHaveLength(1)
    expect(frags[1].annotations[0].name).toBe('GFP')
    expect(frags[1].annotations[0].start).toBe(1)
    expect(frags[1].annotations[0].end).toBe(4)
  })

  it('truncates annotations that span a cut boundary', () => {
    // Annotation spans the EcoRI cut site at position 4
    const ann = new Annotation({ id: 'a1', name: 'big', type: 'CDS', start: 2, end: 10, strand: 1 })
    const doc = makeDoc('test', 'AAAGAATTCAAA', 'linear', [ann])
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    // Annotation [2,10) spans the cut at position 4 – should be truncated in both fragments
    expect(frags[0].annotations).toHaveLength(1)
    expect(frags[0].annotations[0].start).toBe(2)
    expect(frags[0].annotations[0].end).toBe(4)
    expect(frags[0].annotations[0].truncated).toBe(true)

    expect(frags[1].annotations).toHaveLength(1)
    expect(frags[1].annotations[0].start).toBe(0) // 4 - 4 = 0 (fragment-local)
    expect(frags[1].annotations[0].end).toBe(6)   // 10 - 4 = 6 (fragment-local)
    expect(frags[1].annotations[0].truncated).toBe(true)
  })
})

describe('ligateFragments', () => {
  it('ligates two EcoRI-compatible fragments into a circular product', () => {
    // Simulate two fragments from an EcoRI digest that can re-ligate
    const doc = makeDoc('test', 'AAAGAATTCAAA')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    const products = ligateFragments(frags)

    // Should find at least one circular product (re-ligation of the two fragments)
    const circular = products.filter(p => p.topology === 'circular')
    expect(circular.length).toBeGreaterThanOrEqual(1)
  })

  it('self-ligation of a single fragment with compatible ends', () => {
    // A single fragment with EcoRI overhangs on both ends (from circular digest)
    const doc = makeDoc('test', 'AAAGAATTCAAA', 'circular')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(1)

    const products = ligateFragments(frags, { allowSelfLigation: true })
    const circular = products.filter(p => p.topology === 'circular')
    expect(circular.length).toBeGreaterThanOrEqual(1)
  })

  it('returns no products for incompatible overhangs', () => {
    // Two fragments with incompatible overhangs
    const products = ligateFragments([
      {
        name: 'frag1',
        sequence: 'AAAA',
        overhang5: 'AATT',
        overhang3: 'CCCC',
        overhang5Type: 'five_prime',
        overhang3Type: 'five_prime',
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
      {
        name: 'frag2',
        sequence: 'TTTT',
        overhang5: 'GGGG',
        overhang3: 'TTTT',
        overhang5Type: 'five_prime',
        overhang3Type: 'five_prime',
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
    ])

    const circular = products.filter(p => p.topology === 'circular')
    expect(circular).toHaveLength(0)
  })

  it('blunt-end ligation works', () => {
    const products = ligateFragments([
      {
        name: 'frag1',
        sequence: 'AAAA',
        overhang5: '',
        overhang3: '',
        overhang5Type: 'blunt',
        overhang3Type: 'blunt',
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
      {
        name: 'frag2',
        sequence: 'TTTT',
        overhang5: '',
        overhang3: '',
        overhang5Type: 'blunt',
        overhang3Type: 'blunt',
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
    ])

    // Blunt ends can ligate in any combination
    const circular = products.filter(p => p.topology === 'circular')
    expect(circular.length).toBeGreaterThanOrEqual(1)
  })

  it('transfers annotations to the product', () => {
    const products = ligateFragments([
      {
        name: 'frag1',
        sequence: 'AAAA',
        overhang5: 'AATT',
        overhang3: 'AATT',
        overhang5Type: 'five_prime',
        overhang3Type: 'five_prime',
        annotations: [{ id: 'a1', name: 'GFP', type: 'CDS', start: 0, end: 4, strand: 1 }],
        sourceName: 'test',
        reversed: false,
      },
      {
        name: 'frag2',
        sequence: 'TTTT',
        overhang5: 'AATT',
        overhang3: 'AATT',
        overhang5Type: 'five_prime',
        overhang3Type: 'five_prime',
        annotations: [{ id: 'a2', name: 'AmpR', type: 'CDS', start: 0, end: 4, strand: 1 }],
        sourceName: 'test',
        reversed: false,
      },
    ])

    const circular = products.filter(p => p.topology === 'circular')
    expect(circular.length).toBeGreaterThanOrEqual(1)
    // The product should have both annotations
    const product = circular[0]
    expect(product.annotations.length).toBeGreaterThanOrEqual(2)
  })

  it('dephosphorylation prevents self-ligation of marked fragments', () => {
    // Two fragments with compatible EcoRI overhangs
    const doc = makeDoc('test', 'AAAGAATTCAAA')
    const { fragments: frags } = digestFragments(doc, [EcoRI])
    expect(frags).toHaveLength(2)

    // Without dephosphorylation: self-ligation produces circular products
    const withSelf = ligateFragments(frags)
    const circularWithSelf = withSelf.filter(p => p.topology === 'circular')
    expect(circularWithSelf.length).toBeGreaterThanOrEqual(1)

    // With both fragments dephosphorylated: no ligation possible
    const withDephos = ligateFragments(frags, {
      dephosphorylatedFragments: new Set([0, 1]),
    })
    const circularDephos = withDephos.filter(p => p.topology === 'circular')
    expect(circularDephos).toHaveLength(0)
  })

  it('dephosphorylation allows ligation between dephos and non-dephos fragments', () => {
    // Fragment 0 is dephosphorylated, fragment 1 is not
    // Ligation should still work at junctions where at least one side has phosphate
    const frags = [
      {
        name: 'vector',
        sequence: 'AAAA',
        overhang5: 'AATT',
        overhang3: 'AATT',
        overhang5Type: 'five_prime' as const,
        overhang3Type: 'five_prime' as const,
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
      {
        name: 'insert',
        sequence: 'TTTT',
        overhang5: 'AATT',
        overhang3: 'AATT',
        overhang5Type: 'five_prime' as const,
        overhang3Type: 'five_prime' as const,
        annotations: [],
        sourceName: 'test',
        reversed: false,
      },
    ]

    // Only vector (index 0) is dephosphorylated
    const products = ligateFragments(frags, {
      dephosphorylatedFragments: new Set([0]),
    })
    // Should still get products (insert provides phosphate at junctions)
    const circular = products.filter(p => p.topology === 'circular')
    expect(circular.length).toBeGreaterThanOrEqual(1)
  })
})

describe('partialDigestFragments', () => {
  it('returns multiple fragment sets for a sequence with 2 cut sites', () => {
    // Two EcoRI sites → 4 combinations: no cuts, cut 1 only, cut 2 only, both cuts
    const seq = 'AAAGAATTCTTTTGAATTCAAA'
    const doc = makeDoc('test', seq)
    const { fragmentSets: results } = partialDigestFragments(doc, [EcoRI])
    // Should have 4 unique fragment sets (2^2 = 4)
    expect(results.length).toBe(4)
    // One of them should be the uncut (1 fragment)
    const uncut = results.find(r => r.length === 1)
    expect(uncut).toBeDefined()
    // One should be the full digest (3 fragments)
    const full = results.find(r => r.length === 3)
    expect(full).toBeDefined()
    // Two should be single-cut (2 fragments each)
    const singleCuts = results.filter(r => r.length === 2)
    expect(singleCuts).toHaveLength(2)
  })

  it('returns single result for sequence with no cut sites', () => {
    const doc = makeDoc('test', 'ATGCATGCATGC')
    const { fragmentSets: results } = partialDigestFragments(doc, [EcoRI])
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveLength(1)
    expect(results[0][0].name).toContain('uncut')
  })
})
