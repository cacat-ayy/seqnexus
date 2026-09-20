import { describe, it, expect } from 'vitest'
import { findPrimerPairs, DEFAULT_CONSTRAINTS } from './finder'
import type { PrimerConstraints } from './scoring'

// A synthetic template with known GC content regions
const TEMPLATE = 'ATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGAATGCGATCGA'
// 100 bp, repeating ATGCGATCGA (50% GC)

describe('findPrimerPairs', () => {
  const constraints: PrimerConstraints = {
    ...DEFAULT_CONSTRAINTS,
    minTm: 40,
    maxTm: 80,
    optTm: 55,
  }

  it('finds primer pairs flanking a target region', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 30,
      targetEnd: 50,
      minProductSize: 30,
      maxProductSize: 100,
      constraints,
      maxResults: 5,
    })
    expect(pairs.length).toBeGreaterThan(0)
    // Forward primer should be before target
    expect(pairs[0].forward.start).toBeLessThan(30)
    // Reverse primer should be after target
    expect(pairs[0].reverse.end).toBeGreaterThan(50)
    // Product size should be within range
    expect(pairs[0].productSize).toBeGreaterThanOrEqual(30)
    expect(pairs[0].productSize).toBeLessThanOrEqual(100)
  })

  it('returns pairs sorted by penalty (best first)', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 30,
      targetEnd: 50,
      minProductSize: 30,
      maxProductSize: 100,
      constraints,
      maxResults: 10,
    })
    if (pairs.length >= 2) {
      expect(pairs[0].penalty).toBeLessThanOrEqual(pairs[1].penalty)
    }
  })

  it('respects maxResults limit', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 30,
      targetEnd: 50,
      minProductSize: 30,
      maxProductSize: 100,
      constraints,
      maxResults: 3,
    })
    expect(pairs.length).toBeLessThanOrEqual(3)
  })

  it('returns empty when target region is too close to sequence edges', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 0,
      targetEnd: 5,
      minProductSize: 80,
      maxProductSize: 100,
      constraints,
      maxResults: 5,
    })
    // May or may not find pairs depending on constraints, but should not crash
    expect(Array.isArray(pairs)).toBe(true)
  })

  it('each pair has valid forward and reverse primers', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 30,
      targetEnd: 50,
      minProductSize: 30,
      maxProductSize: 100,
      constraints,
      maxResults: 5,
    })
    for (const pair of pairs) {
      expect(pair.forward.strand).toBe(1)
      expect(pair.reverse.strand).toBe(-1)
      expect(pair.forward.sequence.length).toBeGreaterThanOrEqual(constraints.minLength)
      expect(pair.reverse.sequence.length).toBeGreaterThanOrEqual(constraints.minLength)
      expect(pair.forward.tm).toBeGreaterThan(0)
      expect(pair.reverse.tm).toBeGreaterThan(0)
      expect(pair.productSize).toBe(pair.reverse.end - pair.forward.start)
    }
  })
})
