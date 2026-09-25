/**
 * Viewport clamping for floating panels.
 *
 * This is what keeps the Display popover on screen: its trigger is pinned to
 * the right edge of the panel bar, so the natural left-aligned position puts
 * it past the window edge — and .main-area clips overflow, so it was both cut
 * off and unreachable.
 */
import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useClampedPosition } from './useClampedPosition'

const VW = 1000
const VH = 800
const MARGIN = 8
const W = 212
const H = 240

let originalRect: typeof Element.prototype.getBoundingClientRect

/** Give every element a fixed size so the hook has something to measure. */
function stubSize(width: number, height: number) {
  Element.prototype.getBoundingClientRect = function () {
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  }
}

/** Mount the hook with an element attached, as a real consumer would. */
function place(x: number, y: number) {
  const { result } = renderHook(() => {
    const h = useClampedPosition(x, y)
    const node = document.createElement('div')
    h.ref(node)
    return h
  })
  return result
}

describe('useClampedPosition', () => {
  beforeEach(() => {
    originalRect = Element.prototype.getBoundingClientRect
    window.innerWidth = VW
    window.innerHeight = VH
    stubSize(W, H)
  })
  afterEach(() => { Element.prototype.getBoundingClientRect = originalRect })

  it('leaves a position that already fits alone', () => {
    const r = place(100, 100)
    expect(r.current.pos).toEqual({ left: 100, top: 100 })
  })

  it('pulls a panel back when it would run off the right edge', () => {
    // The Display popover case: trigger sits near the right of the window.
    const r = place(VW - 30, 40)
    expect(r.current.pos.left + W).toBeLessThanOrEqual(VW - MARGIN)
  })

  it('pulls a panel up when it would run off the bottom', () => {
    const r = place(100, VH - 20)
    expect(r.current.pos.top + H).toBeLessThanOrEqual(VH - MARGIN)
  })

  it('clamps both axes at once, in a corner', () => {
    const r = place(VW - 5, VH - 5)
    expect(r.current.pos.left + W).toBeLessThanOrEqual(VW - MARGIN)
    expect(r.current.pos.top + H).toBeLessThanOrEqual(VH - MARGIN)
  })

  it('keeps a margin from the left and top edges', () => {
    const r = place(-50, -50)
    expect(r.current.pos.left).toBe(MARGIN)
    expect(r.current.pos.top).toBe(MARGIN)
  })

  it('prefers the left edge when the panel is wider than the window', () => {
    // Clamping right-first then left-second must not leave it negative.
    stubSize(VW + 200, H)
    const r = place(500, 100)
    expect(r.current.pos.left).toBe(MARGIN)
  })

  it('falls back to the requested point when there is no element yet', () => {
    const { result } = renderHook(() => useClampedPosition(123, 456))
    expect(result.current.pos).toEqual({ left: 123, top: 456 })
  })
})
