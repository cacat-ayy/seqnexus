import { describe, it, expect } from 'vitest'
import { annArcSpan, annotationsOverlap, stackAnnotations } from './PlasmidMap'
import { Annotation } from '../models/Annotation'

function ann(start: number, end: number, id = 'a'): Annotation {
  return new Annotation({ id, name: id, type: 'misc_feature', start, end, strand: 1 })
}

describe('annArcSpan', () => {
  const TWO_PI = Math.PI * 2

  it('returns correct span for normal annotation', () => {
    // 100 bp on a 1000 bp sequence = 1/10 of circle
    expect(annArcSpan(0, 100, 1000)).toBeCloseTo(TWO_PI * 0.1)
    expect(annArcSpan(200, 700, 1000)).toBeCloseTo(TWO_PI * 0.5)
  })

  it('returns correct span for origin-spanning annotation', () => {
    // start=900, end=100 on 1000bp → spans 200bp = 1/5 of circle
    expect(annArcSpan(900, 100, 1000)).toBeCloseTo(TWO_PI * 0.2)
  })

  it('returns correct span for the pUC19 ORF case (start=2450, end=27, seqLen=2686)', () => {
    // 2686 - 2450 + 27 = 263 bp → 263/2686 of circle
    const span = annArcSpan(2450, 27, 2686)
    expect(span).toBeCloseTo(TWO_PI * (263 / 2686))
  })

  it('returns full circle when start equals end', () => {
    expect(annArcSpan(500, 500, 1000)).toBeCloseTo(TWO_PI)
  })

  it('always returns a positive value', () => {
    expect(annArcSpan(0, 1, 1000)).toBeGreaterThan(0)
    expect(annArcSpan(999, 1, 1000)).toBeGreaterThan(0)
  })
})

describe('annotationsOverlap', () => {
  it('detects overlap between two normal annotations', () => {
    expect(annotationsOverlap(ann(10, 50), ann(40, 80))).toBe(true)
  })

  it('detects no overlap between two normal annotations', () => {
    expect(annotationsOverlap(ann(10, 30), ann(50, 80))).toBe(false)
  })

  it('detects overlap when one annotation spans origin', () => {
    // wrapping [900, 100) on a 1000bp sequence overlaps [50, 200)
    expect(annotationsOverlap(ann(900, 100), ann(50, 200))).toBe(true)
  })

  it('detects overlap with origin-spanning annotation at tail end', () => {
    // wrapping [900, 100) overlaps [850, 950)
    expect(annotationsOverlap(ann(900, 100), ann(850, 950))).toBe(true)
  })

  it('detects no overlap with origin-spanning annotation in the gap', () => {
    // wrapping [900, 100) does NOT overlap [200, 500) - that's in the gap
    expect(annotationsOverlap(ann(900, 100), ann(200, 500))).toBe(false)
  })

  it('two origin-spanning annotations always overlap', () => {
    expect(annotationsOverlap(ann(900, 100), ann(800, 50))).toBe(true)
  })
})

describe('stackAnnotations', () => {
  it('places non-overlapping annotations in the same ring', () => {
    const rings = stackAnnotations([ann(0, 100, 'a'), ann(200, 300, 'b')])
    expect(rings.length).toBe(1)
    expect(rings[0].length).toBe(2)
  })

  it('places overlapping annotations in separate rings', () => {
    const rings = stackAnnotations([ann(0, 100, 'a'), ann(50, 150, 'b')])
    expect(rings.length).toBe(2)
  })

  it('places origin-spanning annotation in separate ring from overlapping normal', () => {
    const rings = stackAnnotations([
      ann(900, 100, 'wrap'),
      ann(50, 200, 'normal'),
    ])
    expect(rings.length).toBe(2)
  })

  it('places origin-spanning annotation in same ring as non-overlapping normal', () => {
    const rings = stackAnnotations([
      ann(900, 100, 'wrap'),
      ann(300, 500, 'normal'),
    ])
    expect(rings.length).toBe(1)
  })
})
