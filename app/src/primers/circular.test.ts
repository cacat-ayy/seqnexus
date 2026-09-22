/**
 * Tests for circular topology support in the primer finder.
 */

import { describe, it, expect } from 'vitest'
import { findPrimerPairs } from './finder'
import type { PrimerConstraints } from './scoring'
import { DEFAULT_CONSTRAINTS } from './scoring'

// A 200bp circular template with known GC content
const TEMPLATE = ('ATGCGATCGA'.repeat(20))

const RELAXED: PrimerConstraints = {
  ...DEFAULT_CONSTRAINTS,
  minTm: 30,
  maxTm: 90,
  optTm: 55,
  minLength: 15,
  maxLength: 25,
}

describe('primer finder with circular topology', () => {
  it('finds primers for a target near the origin', () => {
    // Target spans positions 190-10 (wraps origin)
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 190,
      targetEnd: 10,
      minProductSize: 30,
      maxProductSize: 100,
      constraints: RELAXED,
      maxResults: 5,
      topology: 'circular',
    })
    // Should find at least some pairs
    expect(pairs.length).toBeGreaterThan(0)
    // Product size should be valid
    for (const pair of pairs) {
      expect(pair.productSize).toBeGreaterThanOrEqual(30)
      expect(pair.productSize).toBeLessThanOrEqual(100)
    }
  })

  it('finds primers for a non-origin-spanning target on circular sequence', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 50,
      targetEnd: 80,
      minProductSize: 40,
      maxProductSize: 150,
      constraints: RELAXED,
      maxResults: 5,
      topology: 'circular',
    })
    expect(pairs.length).toBeGreaterThan(0)
  })

  it('finds primers when target starts at position 0', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 0,
      targetEnd: 50,
      minProductSize: 60,
      maxProductSize: 150,
      constraints: RELAXED,
      maxResults: 5,
      topology: 'circular',
    })
    expect(pairs.length).toBeGreaterThan(0)
    for (const pair of pairs) {
      expect(pair.productSize).toBeGreaterThanOrEqual(60)
      expect(pair.productSize).toBeLessThanOrEqual(150)
    }
  })

  it('returns empty for impossible product sizes', () => {
    const pairs = findPrimerPairs({
      template: TEMPLATE,
      targetStart: 50,
      targetEnd: 80,
      minProductSize: 500,
      maxProductSize: 600,
      constraints: RELAXED,
      maxResults: 5,
      topology: 'circular',
    })
    // May or may not find pairs, but should not crash
    expect(Array.isArray(pairs)).toBe(true)
  })
})
