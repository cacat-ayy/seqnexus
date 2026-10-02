/**
 * The ORF finder, tested directly. (The old test re-implemented the worker's
 * logic in the test file, so it tested its own copy, not the app's.)
 */
import { describe, it, expect } from 'vitest'
import { findOrfs, filterInterior, type ORFRequest, type ORFResult } from './finder'
import { reverseComplement } from '../models/complement'

function find(bases: string, opts: Partial<ORFRequest> = {}): ORFResult[] {
  return findOrfs({ bases, minCodons: 3, maxCodons: 0, startCodons: ['ATG'], allowInterior: true, ...opts })
}

describe('ORF finder', () => {
  it('finds a simple ORF', () => {
    expect(find('ATGAAAGGGCCCTAA')).toEqual([{ start: 0, end: 15, strand: 1, frame: 0, codons: 5 }])
  })

  it('respects minimum and maximum codon counts', () => {
    const seq = 'ATGAAAGGGCCCTAA' // 5 codons
    expect(find(seq, { minCodons: 5 })).toHaveLength(1)
    expect(find(seq, { minCodons: 6 })).toHaveLength(0)
    expect(find(seq, { maxCodons: 5 })).toHaveLength(1)
    expect(find(seq, { maxCodons: 4 })).toHaveLength(0)
  })

  it('finds ORFs in other frames and on the reverse strand', () => {
    expect(find('XATGAAAGGGCCCTAAYYY').filter(o => o.frame === 1).map(o => o.start)).toEqual([1])
    const reverse = find(reverseComplement('ATGAAAGGGCCCTAA')).filter(o => o.strand === -1)
    expect(reverse.map(o => [o.start, o.end, o.codons])).toEqual([[0, 15, 5]])
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
  it('removes an ORF inside another on the same strand only', () => {
    const outer: ORFResult = { start: 0, end: 300, strand: 1, frame: 0, codons: 100 }
    const inner: ORFResult = { start: 50, end: 200, strand: 1, frame: 2, codons: 50 }
    const other: ORFResult = { start: 50, end: 200, strand: -1, frame: 0, codons: 50 }
    expect(filterInterior([inner, outer, other], 1000)).toEqual([outer, other])
  })
})

describe('genetic codes (M11)', () => {
  it('ends ORFs at the stop codons of the chosen code', () => {
    // TGA: a stop in the standard code, tryptophan in the vertebrate mitochondrial code.
    const seq = 'ATGTGAAAATAA'
    expect(find(seq, { minCodons: 2 }).filter(o => o.strand === 1).map(o => o.end)).toEqual([6])
    expect(find(seq, { minCodons: 2, geneticCode: 2 }).filter(o => o.strand === 1).map(o => o.end)).toEqual([12])
  })
})
