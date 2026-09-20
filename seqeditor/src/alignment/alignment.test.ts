import { describe, it, expect } from 'vitest'
import { needlemanWunsch } from './nw'
import { smithWaterman } from './sw'
import { progressiveMSA } from './msa'
import { makeDnaScorer, makeProteinScorer, scoreProtein } from './matrices'
import { computeConsensus, computeConservation, pairwiseIdentity, alignmentStats } from './consensus'

const dnaScore = makeDnaScorer(1, -1)
const GO = -10
const GE = -0.5

describe('Needleman-Wunsch', () => {
  it('aligns identical sequences', () => {
    const r = needlemanWunsch('ACGT', 'ACGT', dnaScore, GO, GE)
    expect(r.alignedA).toBe('ACGT')
    expect(r.alignedB).toBe('ACGT')
    expect(r.score).toBe(4)
  })

  it('aligns sequences with a substitution', () => {
    const r = needlemanWunsch('ACGT', 'ACTT', dnaScore, GO, GE)
    expect(r.alignedA).toBe('ACGT')
    expect(r.alignedB).toBe('ACTT')
    expect(r.score).toBe(2) // 3 matches - 1 mismatch
  })

  it('handles insertion', () => {
    const r = needlemanWunsch('ACGT', 'ACGGT', dnaScore, GO, GE)
    // Should introduce a gap in one sequence
    expect(r.alignedA.replace(/-/g, '')).toBe('ACGT')
    expect(r.alignedB.replace(/-/g, '')).toBe('ACGGT')
    expect(r.alignedA.length).toBe(r.alignedB.length)
  })

  it('handles empty sequences', () => {
    const r = needlemanWunsch('', 'ACGT', dnaScore, GO, GE)
    expect(r.alignedA).toBe('----')
    expect(r.alignedB).toBe('ACGT')
  })

  it('handles both empty', () => {
    const r = needlemanWunsch('', '', dnaScore, GO, GE)
    expect(r.alignedA).toBe('')
    expect(r.alignedB).toBe('')
    expect(r.score).toBe(0)
  })

  it('aligns longer sequences', () => {
    const a = 'AGTACGCA'
    const b = 'TATGC'
    const r = needlemanWunsch(a, b, dnaScore, GO, GE)
    expect(r.alignedA.replace(/-/g, '')).toBe(a)
    expect(r.alignedB.replace(/-/g, '')).toBe(b)
    expect(r.alignedA.length).toBe(r.alignedB.length)
  })
})

describe('Smith-Waterman', () => {
  it('finds local alignment', () => {
    const r = smithWaterman('AAACCCAAA', 'GGGCCCGGG', dnaScore, GO, GE)
    // Should find CCC as the best local match
    expect(r.alignedA).toBe('CCC')
    expect(r.alignedB).toBe('CCC')
    expect(r.score).toBe(3)
  })

  it('handles identical sequences', () => {
    const r = smithWaterman('ACGT', 'ACGT', dnaScore, GO, GE)
    expect(r.alignedA).toBe('ACGT')
    expect(r.alignedB).toBe('ACGT')
    expect(r.score).toBe(4)
  })

  it('handles no similarity', () => {
    // With match=1, mismatch=-1, single bases won't form a good alignment
    // if surrounded by mismatches. But individual matches score 1.
    const r = smithWaterman('AAAA', 'CCCC', dnaScore, GO, GE)
    expect(r.score).toBe(0)
  })

  it('handles empty input', () => {
    const r = smithWaterman('', 'ACGT', dnaScore, GO, GE)
    expect(r.score).toBe(0)
  })
})

describe('Progressive MSA', () => {
  it('aligns two sequences (delegates to NW)', () => {
    const r = progressiveMSA(['ACGT', 'ACGT'], dnaScore, GO, GE)
    expect(r).toHaveLength(2)
    expect(r[0]).toBe('ACGT')
    expect(r[1]).toBe('ACGT')
  })

  it('aligns three sequences', () => {
    const r = progressiveMSA(['ACGT', 'ACGT', 'ACGT'], dnaScore, GO, GE)
    expect(r).toHaveLength(3)
    // All identical - should align perfectly
    for (const s of r) {
      expect(s.replace(/-/g, '')).toBe('ACGT')
    }
    // All same length
    expect(new Set(r.map(s => s.length)).size).toBe(1)
  })

  it('aligns three different sequences', () => {
    const r = progressiveMSA(['ACGT', 'ACT', 'ACGGT'], dnaScore, GO, GE)
    expect(r).toHaveLength(3)
    // All same alignment length
    const len = r[0].length
    for (const s of r) expect(s.length).toBe(len)
    // Original sequences preserved
    expect(r[0].replace(/-/g, '')).toBe('ACGT')
    expect(r[1].replace(/-/g, '')).toBe('ACT')
    expect(r[2].replace(/-/g, '')).toBe('ACGGT')
  })

  it('handles single sequence', () => {
    const r = progressiveMSA(['ACGT'], dnaScore, GO, GE)
    expect(r).toEqual(['ACGT'])
  })

  it('handles empty input', () => {
    const r = progressiveMSA([], dnaScore, GO, GE)
    expect(r).toEqual([])
  })
})

describe('Scoring matrices', () => {
  it('BLOSUM62 diagonal scores are positive', () => {
    for (const aa of 'ARNDCQEGHILKMFPSTWYV') {
      expect(scoreProtein(aa, aa)).toBeGreaterThan(0)
    }
  })

  it('BLOSUM62 is symmetric', () => {
    expect(scoreProtein('A', 'R')).toBe(scoreProtein('R', 'A'))
    expect(scoreProtein('W', 'Y')).toBe(scoreProtein('Y', 'W'))
  })

  it('unknown residues score -1', () => {
    expect(scoreProtein('X', 'A')).toBe(-1)
    expect(scoreProtein('A', 'Z')).toBe(-1)
  })
})

describe('Protein alignment', () => {
  const protScore = makeProteinScorer()

  it('aligns identical protein sequences', () => {
    const r = needlemanWunsch('MVLSPADKTNVK', 'MVLSPADKTNVK', protScore, GO, GE)
    expect(r.alignedA).toBe('MVLSPADKTNVK')
    expect(r.alignedB).toBe('MVLSPADKTNVK')
  })

  it('aligns similar proteins with substitutions', () => {
    const r = needlemanWunsch('MVLSPADK', 'MVLSGEEK', protScore, GO, GE)
    expect(r.alignedA.replace(/-/g, '')).toBe('MVLSPADK')
    expect(r.alignedB.replace(/-/g, '')).toBe('MVLSGEEK')
    expect(r.alignedA.length).toBe(r.alignedB.length)
  })
})

describe('Consensus', () => {
  it('computes consensus from identical sequences', () => {
    expect(computeConsensus(['ACGT', 'ACGT', 'ACGT'])).toBe('ACGT')
  })

  it('picks majority base', () => {
    expect(computeConsensus(['ACGT', 'ACGT', 'TTTT'])).toBe('ACGT')
  })

  it('marks gap when majority is gap', () => {
    expect(computeConsensus(['A-GT', '--GT', '---T'])).toBe('--GT')
  })

  it('breaks ties alphabetically', () => {
    // A and T each appear once
    expect(computeConsensus(['A', 'T'])).toBe('A')
  })
})

describe('Conservation', () => {
  it('returns 1.0 for identical columns', () => {
    const cons = computeConsensus(['ACGT', 'ACGT'])
    const cv = computeConservation(['ACGT', 'ACGT'], cons)
    expect(cv).toEqual([1, 1, 1, 1])
  })

  it('returns 0.5 for half-matching columns', () => {
    const cons = computeConsensus(['AC', 'AT'])
    const cv = computeConservation(['AC', 'AT'], cons)
    expect(cv[0]).toBe(1)   // A matches
    expect(cv[1]).toBe(0.5) // C vs T, consensus is C, only 1/2 match
  })
})

describe('Pairwise identity', () => {
  it('returns 1 for identical', () => {
    expect(pairwiseIdentity('ACGT', 'ACGT')).toBe(1)
  })

  it('returns 0.5 for half matching', () => {
    expect(pairwiseIdentity('ACGT', 'ACTT')).toBe(0.75) // 3/4
  })

  it('ignores double-gap columns', () => {
    expect(pairwiseIdentity('A-GT', 'A-GT')).toBe(1)
  })
})

describe('Alignment stats', () => {
  it('computes identity and gaps', () => {
    const s = alignmentStats('AC-GT', 'ACAGT')
    expect(s.alignmentLength).toBe(5)
    expect(s.identity).toBe(1) // 4 matches out of 4 non-gap
    expect(s.gaps).toBe(1 / 5)
  })
})
