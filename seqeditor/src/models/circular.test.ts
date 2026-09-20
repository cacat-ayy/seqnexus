/**
 * Tests for origin-spanning (circular) support across the codebase.
 */

import { describe, it, expect } from 'vitest'
import { Annotation } from './Annotation'
import { IntervalTree } from './IntervalTree'

describe('IntervalTree with origin-spanning annotations', () => {
  it('finds origin-spanning annotations when querying the tail segment', () => {
    const tree = new IntervalTree()
    // Annotation spanning origin: [90, 10) on a 100bp circular sequence
    const ann = new Annotation({
      id: 'wrap1',
      name: 'origin-span',
      type: 'CDS',
      start: 90,
      end: 10,
      strand: 1,
    })
    tree.insert(ann)

    // Query the tail segment [80, 100) - should find the annotation
    const results = tree.queryRange(80, 100)
    expect(results.some(a => a.id === 'wrap1')).toBe(true)
  })

  it('finds origin-spanning annotations when querying the head segment', () => {
    const tree = new IntervalTree()
    const ann = new Annotation({
      id: 'wrap1',
      name: 'origin-span',
      type: 'CDS',
      start: 90,
      end: 10,
      strand: 1,
    })
    tree.insert(ann)

    // Query the head segment [0, 20) - should find the annotation
    const results = tree.queryRange(0, 20)
    expect(results.some(a => a.id === 'wrap1')).toBe(true)
  })

  it('does not find origin-spanning annotations in the gap', () => {
    const tree = new IntervalTree()
    const ann = new Annotation({
      id: 'wrap1',
      name: 'origin-span',
      type: 'CDS',
      start: 90,
      end: 10,
      strand: 1,
    })
    tree.insert(ann)

    // Query the gap [30, 50) - should NOT find the annotation
    const results = tree.queryRange(30, 50)
    expect(results.some(a => a.id === 'wrap1')).toBe(false)
  })

  it('finds both normal and origin-spanning annotations', () => {
    const tree = new IntervalTree()
    tree.insert(new Annotation({
      id: 'normal',
      name: 'normal',
      type: 'CDS',
      start: 40,
      end: 60,
      strand: 1,
    }))
    tree.insert(new Annotation({
      id: 'wrap',
      name: 'wrap',
      type: 'CDS',
      start: 90,
      end: 10,
      strand: 1,
    }))

    // Query [0, 20) - should find wrap but not normal
    const r1 = tree.queryRange(0, 20)
    expect(r1.some(a => a.id === 'wrap')).toBe(true)
    expect(r1.some(a => a.id === 'normal')).toBe(false)

    // Query [40, 60) - should find normal but not wrap
    const r2 = tree.queryRange(40, 60)
    expect(r2.some(a => a.id === 'normal')).toBe(true)
    expect(r2.some(a => a.id === 'wrap')).toBe(false)
  })
})

describe('Annotation.spansOrigin', () => {
  it('returns true when start > end', () => {
    const ann = new Annotation({
      id: '1', name: 'test', type: 'CDS',
      start: 90, end: 10, strand: 1,
    })
    expect(ann.spansOrigin()).toBe(true)
  })

  it('returns false for normal annotations', () => {
    const ann = new Annotation({
      id: '1', name: 'test', type: 'CDS',
      start: 10, end: 90, strand: 1,
    })
    expect(ann.spansOrigin()).toBe(false)
  })

  it('computes span correctly for origin-spanning', () => {
    const ann = new Annotation({
      id: '1', name: 'test', type: 'CDS',
      start: 90, end: 10, strand: 1,
    })
    expect(ann.span(100)).toBe(20) // 10 bases at end + 10 at start
  })
})
