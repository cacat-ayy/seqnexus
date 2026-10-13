import { describe, it, expect } from 'vitest'
import {
  annArcSpan, annotationsOverlap, stackAnnotations, planTicks, posToAngle, angleToPos, arcSelection,
} from './geometry'
import { displayPosition } from '../models/Document'
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

describe('planTicks', () => {
  it('lays out round numbers with no display origin', () => {
    const ticks = planTicks(5000, 0)
    expect(ticks[0]).toEqual({ pos: 0, label: 1, major: true })
    // 5 kb uses a 100 bp minor step and a 500 bp major step.
    expect(ticks[1]).toEqual({ pos: 99, label: 100, major: false })
    expect(ticks.find(t => t.label === 500)).toEqual({ pos: 499, label: 500, major: true })
    // Nothing is numbered beside the 1 at the top: the last base is the one before it.
    expect(ticks.some(t => t.label === 5000)).toBe(false)
  })

  it('keeps every label a round number under a display origin', () => {
    // The bug this replaces: ticks were stepped in raw positions and then
    // labelled with displayPosition(), so the ring read 4001, 4501, 1, 501.
    const ticks = planTicks(5000, 1000)
    const majors = ticks.filter(t => t.major).map(t => t.label)
    expect(majors).toEqual([1, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500])
  })

  it('puts each label where that base actually is', () => {
    const seqLen = 5000
    const origin = 1000
    for (const tick of planTicks(seqLen, origin)) {
      // displayPosition of the drawn position must be the printed label.
      expect(displayPosition(tick.pos, origin, seqLen)).toBe(tick.label)
    }
  })

  it('puts display position 1 at the top of the circle', () => {
    const first = planTicks(5000, 1234)[0]
    expect(first.label).toBe(1)
    expect(posToAngle(first.pos, 5000)).toBeCloseTo(posToAngle(1234, 5000))
  })

  it('stays bounded at genome scale', () => {
    expect(planTicks(5_000_000, 0).length).toBeLessThanOrEqual(501)
  })

  it('returns nothing for an empty sequence', () => {
    expect(planTicks(0, 0)).toEqual([])
  })
})

describe('angleToPos', () => {
  it('inverts posToAngle', () => {
    for (const pos of [0, 1, 250, 999]) {
      expect(angleToPos(posToAngle(pos, 1000), 1000)).toBe(pos)
    }
  })
})

describe('arcSelection', () => {
  const L = 100
  it('runs clockwise from where the drag began', () => {
    expect(arcSelection(10, 30, 1, true, L)).toEqual({ anchor: 10, caret: 30, reverse: false })
  })

  it('runs anticlockwise as a leftward selection', () => {
    expect(arcSelection(30, 10, -1, true, L)).toEqual({ anchor: 10, caret: 30, reverse: true })
  })

  it('keeps going past the origin instead of taking the short way back', () => {
    // Clockwise from 90 past the top to 5: a range across the origin.
    expect(arcSelection(90, 5, 0.9, true, L)).toEqual({ anchor: 90, caret: 5, reverse: false })
    // Anticlockwise from 5 back past the top to 90: the same bases.
    expect(arcSelection(5, 90, -0.9, true, L)).toEqual({ anchor: 90, caret: 5, reverse: true })
  })

  it('stops one base short of a whole turn', () => {
    expect(arcSelection(10, 10, Math.PI * 2, true, L)).toEqual({ anchor: 10, caret: 9, reverse: false })
  })

  it('never crosses the ends of a linear sequence', () => {
    expect(arcSelection(90, 5, 0.9, false, L)).toEqual({ anchor: 5, caret: 90, reverse: true })
  })
})
