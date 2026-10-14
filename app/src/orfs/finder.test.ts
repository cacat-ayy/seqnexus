/**
 * The ORF finder, tested directly. (The old test re-implemented the worker's
 * logic in the test file, so it tested its own copy, not the app's.)
 */
import { describe, it, expect } from 'vitest'
import { findOrfs, filterInterior, orfAminoAcids, type ORFRequest, type ORFResult } from './finder'
import { reverseComplement } from '../models/complement'

function find(bases: string, opts: Partial<ORFRequest> = {}): ORFResult[] {
  return findOrfs({ bases, minAminoAcids: 2, maxAminoAcids: 0, startCodons: ['ATG'], allowInterior: true, ...opts })
}

describe('ORF finder', () => {
  it('finds a simple ORF', () => {
    expect(find('ATGAAAGGGCCCTAA')).toEqual([{ start: 0, end: 15, strand: 1, frame: 0, codons: 5 }])
  })

  it('respects minimum and maximum sizes, in residues', () => {
    const seq = 'ATGAAAGGGCCCTAA' // 5 codons, 4 residues
    expect(find(seq, { minAminoAcids: 4 })).toHaveLength(1)
    expect(find(seq, { minAminoAcids: 5 })).toHaveLength(0)
    expect(find(seq, { maxAminoAcids: 4 })).toHaveLength(1)
    expect(find(seq, { maxAminoAcids: 3 })).toHaveLength(0)
  })

  it('finds ORFs in other frames and on the reverse strand', () => {
    expect(find('XATGAAAGGGCCCTAAYYY').filter(o => o.frame === 1).map(o => o.start)).toEqual([1])
    const reverse = find(reverseComplement('ATGAAAGGGCCCTAA')).filter(o => o.strand === -1)
    expect(reverse.map(o => [o.start, o.end, o.codons])).toEqual([[0, 15, 5]])
  })

  it('ends an ORF at an ambiguous codon only when every reading of it is a stop', () => {
    expect(find('ATGAAAGGGCCCTARAAAAAATAA')).toEqual([{ start: 0, end: 15, strand: 1, frame: 0, codons: 5 }])
    expect(find('ATGAAAGGGCCCTNAAAAAAATAA').filter(o => o.strand === 1).map(o => o.codons)).toEqual([8])
  })

  it('finds several, none, and copes with an empty sequence', () => {
    expect(find('ATGAAAGGGCCCTAA' + 'NNNNNNNNN' + 'ATGCCCGGGAAATAG').filter(o => o.strand === 1)).toHaveLength(2)
    expect(find('AAAAAAAAAAAAAAAA')).toEqual([])
    expect(find('')).toEqual([])
  })

  it('uses alternative start codons only when asked', () => {
    expect(find('GTGAAAGGGCCCTAA')).toEqual([])
    expect(find('GTGAAAGGGCCCTAA', { startCodons: ['ATG', 'GTG'] })).toHaveLength(1)
  })
})

describe('ORF finder on circular sequences (M11)', () => {
  it('reports an ORF once, with the frame of its real start, when the length is not a multiple of 3', () => {
    // 20 bp: reading on past the end meets the same ATG again in another frame.
    const orfs = find('ATGAAATAA' + 'C'.repeat(11), { topology: 'circular' }).filter(o => o.strand === 1)
    expect(orfs).toEqual([{ start: 0, end: 9, strand: 1, frame: 0, codons: 3 }])
  })

  // 30 bp, no C so nothing on the reverse strand. An ORF from 24 reads across
  // the origin to a stop at 12-15; a shorter one at 1-10 lies inside it.
  const CIRCLE = 'GATGGGGTAAGG' + 'TAA' + 'G'.repeat(9) + 'ATG' + 'GGG'

  it('finds the ORF that crosses the origin', () => {
    expect(find(CIRCLE, { topology: 'circular' })).toEqual([
      { start: 1, end: 10, strand: 1, frame: 1, codons: 3 },
      { start: 24, end: 15, strand: 1, frame: 0, codons: 7 },
    ])
  })

  it('hides an ORF nested in one that crosses the origin, not the other way round', () => {
    expect(find(CIRCLE, { topology: 'circular', allowInterior: false }))
      .toEqual([{ start: 24, end: 15, strand: 1, frame: 0, codons: 7 }])
  })
})

describe('filterInterior', () => {
  it('removes an ORF inside a longer one, in any frame and on either strand', () => {
    const outer: ORFResult = { start: 0, end: 300, strand: 1, frame: 0, codons: 100 }
    const inner: ORFResult = { start: 50, end: 200, strand: 1, frame: 2, codons: 50 }
    const antisense: ORFResult = { start: 50, end: 200, strand: -1, frame: 0, codons: 50 }
    const overlapping: ORFResult = { start: 250, end: 400, strand: -1, frame: 1, codons: 50 }
    expect(filterInterior([inner, outer, antisense, overlapping], 1000)).toEqual([outer, overlapping])
  })
})

describe('one ORF per stop codon', () => {
  it('lists an ORF across the origin once, not again from the first start after the origin', () => {
    // 60 bp: an ATG at 54 reads across the origin to the stop at 30-33;
    // the ATG at 3, in the same frame, is part of that ORF.
    const circle = 'GCC' + 'ATG' + 'GCC'.repeat(8) + 'TAA' + 'GCC'.repeat(7) + 'ATG' + 'GCC'
    const plus = find(circle, { topology: 'circular', minAminoAcids: 1 }).filter(o => o.strand === 1)
    expect(plus).toEqual([{ start: 54, end: 33, strand: 1, frame: 0, codons: 13 }])
  })

  it('reads a downstream start in the same frame as part of the ORF, not one of its own', () => {
    const orfs = find('ATG' + 'GCC'.repeat(3) + 'ATG' + 'GCC'.repeat(3) + 'TAA', { minAminoAcids: 1 }).filter(o => o.strand === 1)
    expect(orfs).toEqual([{ start: 0, end: 27, strand: 1, frame: 0, codons: 9 }])
  })
})

describe('partial ORFs at the ends of a linear sequence', () => {
  const partial = (bases: string, opts: Partial<ORFRequest> = {}) =>
    find(bases, { includePartial: true, minAminoAcids: 1, ...opts }).filter(o => o.strand === 1)

  it('are not listed unless asked for', () => {
    expect(find('ATG' + 'GCC'.repeat(5), { minAminoAcids: 1 }).filter(o => o.strand === 1)).toEqual([])
  })

  it('runs from a start codon to the last whole codon when there is no stop', () => {
    expect(partial('ATG' + 'GCC'.repeat(5) + 'GC').filter(o => o.frame === 0)).toEqual([
      { start: 0, end: 18, strand: 1, frame: 0, codons: 6, partialEnd: true },
    ])
  })

  it('runs from the first whole codon to a stop, without a start codon, and takes in a start inside it', () => {
    // Frame 0 is open from base 0 to the TAA; the ATG at 6 lies inside that.
    const orfs = partial('GCCGCCATGGCCTAA' + 'C'.repeat(3)).filter(o => o.frame === 0)
    expect(orfs).toEqual([{ start: 0, end: 15, strand: 1, frame: 0, codons: 5, partialStart: true }])
  })

  it('is open at both ends when a frame has no stop at all, and needs more than a stop', () => {
    expect(partial('GCC'.repeat(4)).filter(o => o.frame === 0)).toEqual([
      { start: 0, end: 12, strand: 1, frame: 0, codons: 4, partialStart: true, partialEnd: true },
    ])
    // A stop as the first codon is no ORF.
    expect(partial('TAA' + 'C'.repeat(3)).filter(o => o.frame === 0)).toEqual([])
  })

  it('places partial ORFs on the reverse strand', () => {
    // The reverse complement of an ORF that runs off the 3' end.
    const minus = find(reverseComplement('ATG' + 'GCC'.repeat(5)), { includePartial: true, minAminoAcids: 1 })
      .filter(o => o.strand === -1 && o.frame === 0)
    expect(minus).toEqual([{ start: 0, end: 18, strand: -1, frame: 0, codons: 6, partialEnd: true }])
  })

  it('has no ends to cut on a circle', () => {
    expect(find('ATG' + 'GCC'.repeat(5), { includePartial: true, minAminoAcids: 1, topology: 'circular' })
      .some(o => o.partialStart || o.partialEnd)).toBe(false)
  })

  it('counts residues without the stop, and every codon of an ORF with none', () => {
    expect(orfAminoAcids({ start: 0, end: 30, strand: 1, frame: 0, codons: 10 })).toBe(9)
    expect(orfAminoAcids({ start: 0, end: 30, strand: 1, frame: 0, codons: 10, partialEnd: true })).toBe(10)
  })
})

describe('genetic codes (M11)', () => {
  it('ends ORFs at the stop codons of the chosen code', () => {
    // TGA: a stop in the standard code, tryptophan in the vertebrate mitochondrial code.
    const seq = 'ATGTGAAAATAA'
    expect(find(seq, { minAminoAcids: 1 }).filter(o => o.strand === 1).map(o => o.end)).toEqual([6])
    expect(find(seq, { minAminoAcids: 1, geneticCode: 2 }).filter(o => o.strand === 1).map(o => o.end)).toEqual([12])
  })
})
