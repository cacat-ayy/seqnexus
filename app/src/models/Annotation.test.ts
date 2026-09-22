import { describe, it, expect } from 'vitest'
import { Annotation, adjustAnnotation } from './Annotation'

function makeAnn(start: number, end: number, id = 'a1'): Annotation {
  return new Annotation({
    id,
    name: 'test',
    type: 'CDS',
    start,
    end,
    strand: 1,
  })
}

describe('Annotation', () => {
  it('computes span for normal range', () => {
    const ann = makeAnn(10, 20)
    expect(ann.span(100)).toBe(10)
  })

  it('computes span for origin-spanning feature', () => {
    const ann = makeAnn(90, 10)
    expect(ann.span(100)).toBe(20)
    expect(ann.spansOrigin()).toBe(true)
  })

  it('with() returns new annotation with patched fields', () => {
    const ann = makeAnn(10, 20)
    const updated = ann.with({ name: 'GFP', color: '#00ff00' })
    expect(updated.name).toBe('GFP')
    expect(updated.color).toBe('#00ff00')
    expect(updated.start).toBe(10)
    expect(updated.id).toBe('a1')
  })

  it('defaults color and qualifiers', () => {
    const ann = makeAnn(0, 5)
    expect(ann.color).toBe('#4dabf7')
    expect(ann.qualifiers).toEqual({})
  })
})

describe('adjustAnnotation - insertions', () => {
  it('insertion before annotation shifts both coords', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 5, 3, 100)!
    expect(result.start).toBe(13)
    expect(result.end).toBe(23)
  })

  it('insertion after annotation leaves it unchanged', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 25, 3, 100)!
    expect(result.start).toBe(10)
    expect(result.end).toBe(20)
  })

  it('insertion at annotation start shifts start', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 10, 3, 100)!
    expect(result.start).toBe(13)
    expect(result.end).toBe(23)
  })

  it('insertion at annotation end does not shift end', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 20, 3, 100)!
    expect(result.start).toBe(10)
    expect(result.end).toBe(20)
  })

  it('insertion inside annotation shifts end only', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 15, 3, 100)!
    expect(result.start).toBe(10)
    expect(result.end).toBe(23)
  })
})

describe('adjustAnnotation - deletions', () => {
  it('deletion before annotation shifts both coords', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 2, -3, 100)!
    expect(result.start).toBe(7)
    expect(result.end).toBe(17)
  })

  it('deletion after annotation leaves it unchanged', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 25, -3, 100)!
    expect(result.start).toBe(10)
    expect(result.end).toBe(20)
  })

  it('deletion fully containing annotation returns null', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 5, -20, 100)
    expect(result).toBeNull()
  })

  it('deletion overlapping annotation start collapses start', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 8, -5, 100)!
    // deletes [8, 13) - start 10 is inside deleted region → collapses to 8
    // end 20 → 20 - 5 = 15
    expect(result.start).toBe(8)
    expect(result.end).toBe(15)
  })

  it('deletion overlapping annotation end collapses end', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 18, -5, 100)!
    // deletes [18, 23) - start 10 unchanged, end 20 inside deleted → collapses to 18
    expect(result.start).toBe(10)
    expect(result.end).toBe(18)
  })

  it('deletion inside annotation shrinks it', () => {
    const ann = makeAnn(10, 20)
    const result = adjustAnnotation(ann, 12, -3, 100)!
    // deletes [12, 15) - start 10 unchanged, end 20 → 20 - 3 = 17
    expect(result.start).toBe(10)
    expect(result.end).toBe(17)
  })
})

// --- Circular topology: origin-spanning annotations ---

describe('adjustAnnotation - circular origin-spanning insertions', () => {
  // Annotation [90, 10) on a 100bp circular sequence spans the origin:
  //   tail = [90, 100), head = [0, 10)

  it('insertion in the head segment shifts both coords', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 5, 3, 100, true)!
    // Insert at pos 5 (inside head [0,10)): start shifts +3, end shifts +3
    expect(result.start).toBe(93)
    expect(result.end).toBe(13)
    expect(result.spansOrigin()).toBe(true)
  })

  it('insertion in the tail segment leaves coords unchanged', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 95, 3, 100, true)!
    // Insert at pos 95 (inside tail [90,100)): feature grows, coords stay
    expect(result.start).toBe(90)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('insertion in the gap shifts start only', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 50, 5, 100, true)!
    // Insert at pos 50 (in gap [10,90)): start shifts +5, end stays
    expect(result.start).toBe(95)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('insertion at head boundary (pos 0) shifts both coords', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 0, 3, 100, true)!
    expect(result.start).toBe(93)
    expect(result.end).toBe(13)
  })

  it('insertion at the start of the tail (pos == start)', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 90, 5, 100, true)!
    // Insertion at exactly start - in the gap boundary, shifts start
    expect(result.start).toBe(90)
    expect(result.end).toBe(10)
  })
})

describe('adjustAnnotation - circular origin-spanning deletions', () => {
  // Annotation [90, 10) on a 100bp circular sequence
  //   tail = [90, 100), head = [0, 10)

  it('deletion in the gap leaves annotation unchanged', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 40, -5, 100, true)!
    // Delete [40, 45) - in the gap. start shifts -5, end stays
    expect(result.start).toBe(85)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('deletion fully consuming the tail collapses to head only', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 90, -10, 100, true)!
    // Delete [90, 100) - entire tail gone. Head [0,10) survives.
    expect(result.start).toBe(0)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(false)
  })

  it('deletion fully consuming the head collapses to tail only', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 0, -10, 100, true)!
    // Delete [0, 10) - entire head gone. Tail [90,100) survives → shifted to [80, 90)
    expect(result.start).toBe(80)
    expect(result.end).toBe(90)
    expect(result.spansOrigin()).toBe(false)
  })

  it('deletion of both segments returns null', () => {
    // Small annotation [8, 2) on a 10bp sequence: tail=[8,10), head=[0,2)
    const ann = makeAnn(8, 2)
    // Delete [0, 10) - everything
    const result = adjustAnnotation(ann, 0, -10, 10, true)
    expect(result).toBeNull()
  })

  it('partial deletion of the tail shrinks it', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 95, -5, 100, true)!
    // Delete [95, 100) - tail shrinks from [90,100) to [90,95). Head stays.
    expect(result.start).toBe(90)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('partial deletion of the head shrinks it', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 0, -5, 100, true)!
    // Delete [0, 5) - head shrinks from [0,10) to [0,5) → shifted to [0,5).
    // Tail [90,100) → shifted to [85, 95). Still spans origin.
    expect(result.start).toBe(85)
    expect(result.end).toBe(5)
    expect(result.spansOrigin()).toBe(true)
  })

  it('deletion overlapping tail start trims the tail', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 85, -10, 100, true)!
    // Delete [85, 95) - overlaps tail start. Tail [90,100) → [95,100) → shifted to [85,90).
    // Head [0,10) stays at [0,10).
    expect(result.start).toBe(85)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('deletion overlapping head end trims the head', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 5, -10, 100, true)!
    // Delete [5, 15) - overlaps head end. Head [0,10) → [0,5).
    // Tail [90,100) → shifted to [80, 90).
    expect(result.start).toBe(80)
    expect(result.end).toBe(5)
    expect(result.spansOrigin()).toBe(true)
  })

  it('deletion inside the tail shrinks it', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 92, -3, 100, true)!
    // Delete [92, 95) - inside tail. Tail shrinks. Head stays.
    expect(result.start).toBe(90)
    expect(result.end).toBe(10)
    expect(result.spansOrigin()).toBe(true)
  })

  it('deletion inside the head shrinks it', () => {
    const ann = makeAnn(90, 10)
    const result = adjustAnnotation(ann, 2, -3, 100, true)!
    // Delete [2, 5) - inside head. Head [0,10) → [0,7). Tail shifted to [87,97).
    expect(result.start).toBe(87)
    expect(result.end).toBe(7)
    expect(result.spansOrigin()).toBe(true)
  })
})
