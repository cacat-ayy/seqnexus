import { describe, it, expect } from 'vitest'
import { featureOverlaps, featurePieces, locationError } from './feature-location'

describe('locationError', () => {
  it('accepts a span and refuses empty, out of range or backwards ones', () => {
    expect(locationError(10, 20, null, 100, false)).toBeNull()
    expect(locationError(10, 10, null, 100, false)).toMatch(/empty/)
    expect(locationError(10, 120, null, 100, false)).toMatch(/1 to 100/)
    expect(locationError(80, 20, null, 100, false)).toMatch(/circular/)
    expect(locationError(80, 20, null, 100, true)).toBeNull()
  })

  it('accepts parts that follow one another and refuses ones that do not', () => {
    expect(locationError(10, 60, [[10, 20], [40, 60]], 100, false)).toBeNull()
    expect(locationError(10, 60, [[10, 45], [40, 60]], 100, false)).toMatch(/follow/)
    expect(locationError(10, 60, [[10, 20], [30, 25], [40, 60]], 100, false)).toMatch(/Part 2/)
  })

  it('lets the parts of a wrapped feature cross the origin once', () => {
    expect(locationError(90, 20, [[90, 95], [10, 20]], 100, true)).toBeNull()
    expect(locationError(90, 20, [[90, 95], [10, 12], [5, 20]], 100, true)).toMatch(/follow/)
  })
})

describe('featureOverlaps', () => {
  it('tests both pieces of a feature across the origin', () => {
    expect(featurePieces({ start: 90, end: 10 }, 100)).toEqual([[90, 100], [0, 10]])
    expect(featureOverlaps({ start: 90, end: 10 }, [[5, 6]], 100)).toBe(true)
    expect(featureOverlaps({ start: 90, end: 10 }, [[50, 60]], 100)).toBe(false)
  })

  it('treats the ranges as half-open', () => {
    expect(featureOverlaps({ start: 10, end: 20 }, [[20, 30]], 100)).toBe(false)
    expect(featureOverlaps({ start: 10, end: 20 }, [[19, 30]], 100)).toBe(true)
  })
})
