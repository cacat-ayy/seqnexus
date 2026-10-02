import { describe, it, expect } from 'vitest'
import { computeConsensus } from './consensus'
import { findTandemRepeats } from './repeats'
import { testContig, testRow } from './testing'
import {
  callVariants, codingChange, DEFAULT_VARIANT_SETTINGS, fisherExact, poissonBinomialTail, variantsCsv, type RefFeature,
} from './variants'
import { DEFAULT_VERIFY, verifyClone, verifyCsv, verifyHtml } from './verify'

// ATG AAA GCT TGG TAA: M K A W *, as a CDS from 3 to 18 on a reference of 24.
const REF = 'CCC' + 'ATGAAAGCTTGGTAA' + 'GGGGGG'
const CDS: RefFeature = { id: 'f1', name: 'gfp', type: 'CDS', start: 3, end: 18, strand: 1 }
const all = { ...DEFAULT_VARIANT_SETTINGS, maxPValue: 1 }

const call = (rows: ReturnType<typeof testRow>[], features: RefFeature[] = [CDS], s = all) => {
  const doc = testContig(rows, REF)
  return callVariants(doc, computeConsensus(doc).bases, features, s)
}

describe('variant calling', () => {
  it('calls a SNP with its codon and protein change', () => {
    // AAA (K2) → GAA (E2) at reference position 7.
    const alt = REF.slice(0, 6) + 'G' + REF.slice(7)
    const vs = call([testRow('a', 0, alt), testRow('b', 0, alt, { reversed: true })])
    expect(vs).toHaveLength(1)
    const v = vs[0]
    expect(v).toMatchObject({ type: 'SNP', position: 7, ref: 'A', alt: 'G', coverage: 2, count: 2, frequency: 1 })
    expect(v.coding).toMatchObject({ feature: 'gfp', cdna: 'c.4A>G', protein: 'K2E', effect: 'Missense', codonFrom: 'AAA', codonTo: 'GAA' })
    expect(v.forward.alt + v.reverse.alt).toBe(2)
  })

  it('tells synonymous, nonsense and stop-lost changes apart', () => {
    const at = (p: number, b: string) => REF.slice(0, p) + b + REF.slice(p + 1)
    // Codons sit at 3 ATG, 6 AAA, 9 GCT, 12 TGG, 15 TAA.
    expect(call([testRow('a', 0, at(11, 'C'))])[0].coding).toMatchObject({ protein: 'A3A', effect: 'Synonymous' }) // GCT→GCC
    expect(call([testRow('a', 0, at(13, 'A'))])[0].coding).toMatchObject({ protein: 'W4*', effect: 'Nonsense' }) // TGG→TAG
    expect(call([testRow('a', 0, at(15, 'C'))])[0].coding).toMatchObject({ protein: '*5Q', effect: 'Stop lost' }) // TAA→CAA
    expect(call([testRow('a', 0, at(5, 'A'))])[0].coding).toMatchObject({ protein: 'M1I', effect: 'Start lost' }) // ATG→ATA
  })

  it('names insertions and deletions, with frameshifts in coding features', () => {
    // Delete one base of the AAA codon (columns 6..9 hold AAA).
    const del = REF.slice(0, 7) + '-' + REF.slice(8)
    const d = call([testRow('a', 0, del)])
    expect(d[0]).toMatchObject({ type: 'Deletion', ref: 'A', alt: '', position: 8 })
    expect(d[0].coding?.effect).toBe('Frameshift')
    // Three deleted bases in a row are one in-frame deletion.
    const del3 = REF.slice(0, 9) + '---' + REF.slice(12)
    const d3 = call([testRow('a', 0, del3)])
    expect(d3).toHaveLength(1)
    expect(d3[0]).toMatchObject({ type: 'Deletion', ref: 'GCT', position: 10 })
    expect(d3[0].coding?.effect).toBe('In-frame deletion')
  })

  it('applies frequency, P-value and coding-only filters', () => {
    const alt = REF.slice(0, 20) + 'T' + REF.slice(21) // outside the CDS
    const rows = [testRow('a', 0, alt), testRow('b', 0, REF), testRow('c', 0, REF), testRow('d', 0, REF)]
    expect(call(rows)).toHaveLength(1)
    expect(call(rows, [CDS], { ...all, minFrequency: 0.3 })).toHaveLength(0)
    expect(call(rows, [CDS], { ...all, codingOnly: true })).toHaveLength(0)
    // One read at Q40 has p = 1e-4/3; a bar of 1e-6 needs more evidence.
    expect(call([testRow('a', 0, alt)], [CDS], { ...all, maxPValue: 1e-6 })).toHaveLength(0)
  })

  it('counts a heterozygous IUPAC call as half of each base', () => {
    const het = REF.slice(0, 6) + 'R' + REF.slice(7) // A/G
    const vs = call([testRow('a', 0, het)])
    expect(vs[0]).toMatchObject({ alt: 'G', count: 0.5, frequency: 0.5 })
  })

  it('calls against the consensus when there is no reference', () => {
    const doc = testContig([testRow('a', 0, 'ACGTACGT'), testRow('b', 0, 'ACGTACGT'), testRow('c', 0, 'ACCTACGT')])
    const vs = callVariants(doc, computeConsensus(doc).bases, [], all)
    expect(vs).toHaveLength(1)
    expect(vs[0]).toMatchObject({ position: 3, ref: 'G', alt: 'C', againstConsensus: true, coding: null })
  })

  it('writes CSV with a header and one line per variant', () => {
    const vs = call([testRow('a', 0, REF.slice(0, 6) + 'G' + REF.slice(7))])
    const csv = variantsCsv(vs).trim().split('\n')
    expect(csv).toHaveLength(2)
    expect(csv[0]).toMatch(/^Position,Type,Reference,Variant/)
    expect(csv[1]).toMatch(/^7,SNP,A,G,/)
  })
})

describe('coding changes on the reverse strand', () => {
  it('reads the codon from the other strand', () => {
    // Reverse-strand CDS over the same bases: its first codon is TTA (L) read from the end.
    const rev: RefFeature = { ...CDS, strand: -1 }
    const c = codingChange('SNP', 17, 'A', 'C', [rev], REF)!
    expect(c.cdna).toBe('c.1T>G')
    expect(c.protein.startsWith('L1')).toBe(true)
  })
})

describe('statistics', () => {
  it('computes a Poisson-binomial tail', () => {
    expect(poissonBinomialTail([0.5, 0.5], 1)).toBeCloseTo(0.75)
    expect(poissonBinomialTail([0.1, 0.1, 0.1], 3)).toBeCloseTo(0.001)
    expect(poissonBinomialTail([0.2], 0)).toBe(1)
  })

  it("runs Fisher's exact test", () => {
    expect(fisherExact(3, 0, 0, 3)).toBeCloseTo(0.1, 2)
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 5)
    expect(fisherExact(10, 0, 0, 10)).toBeLessThan(1e-4)
  })
})

describe('tandem repeats', () => {
  it('finds mono-, di- and trinucleotide repeats and not shorter runs', () => {
    const seq = 'GCGT' + 'A'.repeat(9) + 'GCG' + 'CA'.repeat(6) + 'TTG' + 'CAG'.repeat(4) + 'GG' + 'TTTT'
    const r = findTandemRepeats(seq)
    // The CAG run follows a G, so it reads as (GCA)4 from its first base: the same repeat.
    expect(r.map(x => `(${x.unit})${x.copies}`)).toEqual(['(A)9', '(CA)6', '(GCA)4'])
  })

  it('flags a variant inside a repeat', () => {
    const ref = 'GCGTAC' + 'CA'.repeat(6) + 'TTGACCTG'
    const read = ref.slice(0, 7) + '--' + ref.slice(9)
    const doc = testContig([testRow('a', 0, read)], ref)
    const vs = callVariants(doc, computeConsensus(doc).bases, [], all)
    expect(vs[0].repeat).toBe('(CA)6')
  })
})

describe('clone verification', () => {
  const promoter: RefFeature = { id: 'p', name: 'lac promoter', type: 'promoter', start: 0, end: 3, strand: 1 }

  it('verifies a construct covered and matching everywhere', () => {
    const doc = testContig([testRow('f', 0, REF), testRow('r', 0, REF, { reversed: true })], REF)
    const r = verifyClone(doc, computeConsensus(doc).bases, [CDS, promoter], DEFAULT_VERIFY)!
    expect(r.verdict).toBe('verified')
    expect(r.covered).toBe(1)
    expect(r.bothStrands).toBe(1)
    expect(r.features.map(f => f.status)).toEqual(['verified', 'verified'])
  })

  it('reports differences with their effect, and stretches not covered', () => {
    const mutated = REF.slice(0, 6) + 'G' + REF.slice(7, 20)
    const doc = testContig([testRow('f', 0, mutated)], REF)
    const r = verifyClone(doc, computeConsensus(doc).bases, [CDS, promoter], DEFAULT_VERIFY)!
    expect(r.verdict).toBe('differences')
    expect(r.features[0]).toMatchObject({ status: 'differences' })
    expect(r.features[0].differences[0].coding?.protein).toBe('K2E')
    expect(r.uncovered).toEqual([{ from: 21, to: 24 }])
    expect(verifyCsv(r)).toContain('K2E')
    expect(verifyHtml(r, 'Contig')).toContain('Differences found')
  })

  it('calls a feature incomplete when it needs both strands and has one', () => {
    const doc = testContig([testRow('f', 0, REF)], REF)
    const r = verifyClone(doc, computeConsensus(doc).bases, [CDS], { ...DEFAULT_VERIFY, bothStrands: true })!
    expect(r.verdict).toBe('incomplete')
    expect(r.features[0].bothStrands).toBe(0)
  })
})
