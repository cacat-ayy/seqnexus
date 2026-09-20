import { describe, it, expect } from 'vitest'
import {
  maxHomopolymerRun,
  hasGCClamp,
  selfComplementarity,
  endSelfComplementarity,
  hairpinScore,
  scorePrimer,
  reverseComplement,
  DEFAULT_CONSTRAINTS,
} from './scoring'

describe('maxHomopolymerRun', () => {
  it('detects single-base runs', () => {
    expect(maxHomopolymerRun('ATGC')).toBe(1)
  })

  it('detects longer runs', () => {
    expect(maxHomopolymerRun('AATTTGC')).toBe(3)
    expect(maxHomopolymerRun('AAAAGC')).toBe(4)
    expect(maxHomopolymerRun('GCCCCCG')).toBe(5)
  })
})

describe('hasGCClamp', () => {
  it('returns true when 3\' end has G or C', () => {
    expect(hasGCClamp('ATGC')).toBe(true)
    expect(hasGCClamp('ATGG')).toBe(true)
    expect(hasGCClamp('ATCG')).toBe(true)
  })

  it('returns false when 3\' end is all A/T', () => {
    expect(hasGCClamp('GCGAT')).toBe(false)
    expect(hasGCClamp('GCCAA')).toBe(false)
  })
})

describe('reverseComplement', () => {
  it('computes reverse complement', () => {
    expect(reverseComplement('ATGC')).toBe('GCAT')
    expect(reverseComplement('AAAA')).toBe('TTTT')
    expect(reverseComplement('GCTA')).toBe('TAGC')
  })
})

describe('selfComplementarity', () => {
  it('returns low score for non-complementary sequences', () => {
    const score = selfComplementarity('ATGATGATGATG')
    expect(score).toBeLessThan(5)
  })

  it('returns high score for palindromic sequences', () => {
    // AATTAATT is self-complementary
    const score = selfComplementarity('AATTAATT')
    expect(score).toBeGreaterThanOrEqual(4)
  })
})

describe('endSelfComplementarity', () => {
  it('returns low score for non-complementary 3\' ends', () => {
    const score = endSelfComplementarity('ATGCGATCGAATGCG')
    expect(score).toBeLessThanOrEqual(5)
  })
})

describe('hairpinScore', () => {
  it('returns 0 for sequences too short to form hairpins', () => {
    expect(hairpinScore('ATGCGA')).toBe(0)
  })

  it('detects hairpin-forming sequences', () => {
    // GCGC...loop...GCGC can form a stem
    const score = hairpinScore('GCGCAAAGCGC')
    expect(score).toBeGreaterThanOrEqual(2)
  })
})

describe('scorePrimer', () => {
  it('scores a good primer with low penalty', () => {
    // A well-designed 20-mer with ~50% GC
    const result = scorePrimer('ATGCGATCGAATGCGATCGA', 0, 1, DEFAULT_CONSTRAINTS)
    expect(result.length).toBe(20)
    expect(result.tm).toBeGreaterThan(45)
    expect(result.gc).toBeCloseTo(50, 0)
    expect(result.strand).toBe(1)
    expect(result.start).toBe(0)
    expect(result.end).toBe(20)
  })

  it('rejects primers with Tm out of range', () => {
    // Very short AT-rich sequence - low Tm
    const result = scorePrimer('AATTAATTAATTAATTAA', 0, 1, {
      ...DEFAULT_CONSTRAINTS,
      minTm: 70,
      maxTm: 80,
      optTm: 75,
    })
    expect(result.ok).toBe(false)
    expect(result.problems.length).toBeGreaterThan(0)
  })

  it('rejects primers with extreme GC content', () => {
    const result = scorePrimer('GGGGGGGGGGGGGGGGGGGG', 0, 1, DEFAULT_CONSTRAINTS)
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('GC'))).toBe(true)
  })

  it('rejects primers with long homopolymer runs', () => {
    const result = scorePrimer('ATGCGAAAAAGCGATCGATC', 0, 1, {
      ...DEFAULT_CONSTRAINTS,
      maxHomopolymer: 3,
    })
    expect(result.ok).toBe(false)
    expect(result.problems.some(p => p.includes('Homopolymer'))).toBe(true)
  })

  it('penalizes primers without GC clamp', () => {
    const withClamp = scorePrimer('ATGCGATCGAATGCGATCGC', 0, 1, DEFAULT_CONSTRAINTS)
    const withoutClamp = scorePrimer('ATGCGATCGAATGCGATCAA', 0, 1, DEFAULT_CONSTRAINTS)
    // The one without GC clamp should have higher penalty (if both pass)
    if (withClamp.ok && withoutClamp.ok) {
      expect(withoutClamp.penalty).toBeGreaterThan(withClamp.penalty)
    }
  })
})
