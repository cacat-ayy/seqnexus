/**
 * Extending a selection with Shift and a key or a click. On a circular
 * sequence a caret before the anchor means a selection across the origin, so
 * a leftward selection must be stored in order with `reverse` set, or
 * Shift+Left selects nearly the whole plasmid.
 */
import { describe, it, expect } from 'vitest'
import {
  extendSelection, selectionEnds, selectionLength, selectionSegments, isOriginSpanningSelection,
  type Selection,
} from './store'

const L = 100
const steps = (sel: Selection, by: number, n: number, topology = 'circular', len = L): Selection => {
  let s = sel
  for (let i = 0; i < n; i++) s = extendSelection(s, { by }, topology, len)
  return s
}
const caret = (p: number): Selection => ({ anchor: p, caret: p })

describe('Shift+arrows on a circular sequence', () => {
  it('selects leftwards without spanning the origin', () => {
    const s = steps(caret(50), -4, 1)
    expect(s).toEqual({ anchor: 46, caret: 50, reverse: true })
    expect(isOriginSpanningSelection(s, 'circular')).toBe(false)
    expect(selectionLength(s, 'circular', L)).toBe(4)
  })

  it('selects leftwards from the end of the sequence', () => {
    const s = steps(caret(L), -1, 4)
    expect(s).toEqual({ anchor: 96, caret: 100, reverse: true })
    expect(selectionLength(s, 'circular', L)).toBe(4)
  })

  it('crosses the origin when the keys carry it there, both ways', () => {
    const left = steps(caret(2), -1, 4)
    expect(selectionSegments(left, 'circular', L)).toEqual([[98, 100], [0, 2]])
    expect(selectionEnds(left, 'circular')).toEqual({ fixed: 2, focus: 98 })
    const right = steps(caret(98), 1, 4)
    expect(selectionSegments(right, 'circular', L)).toEqual([[98, 100], [0, 2]])
    expect(selectionEnds(right, 'circular')).toEqual({ fixed: 98, focus: 2 })
  })

  it('turns back through the fixed end', () => {
    const back = steps(caret(10), -1, 3)
    expect(back).toEqual({ anchor: 7, caret: 10, reverse: true })
    const forth = steps(back, 1, 5)
    expect(forth).toEqual({ anchor: 10, caret: 12, reverse: false })
    expect(steps(forth, -1, 2)).toEqual({ anchor: 10, caret: 10 })
  })

  it('moves by rows the same way', () => {
    const s = extendSelection(caret(30), { by: -20 }, 'circular', L)
    expect(s).toEqual({ anchor: 10, caret: 30, reverse: true })
  })

  it('stops short of a whole turn unless it starts at the origin', () => {
    expect(selectionLength(steps(caret(10), 1, L + 5), 'circular', L)).toBe(L - 1)
    expect(extendSelection(caret(0), { by: L }, 'circular', L)).toEqual({ anchor: 0, caret: L, reverse: false })
  })
})

describe('Shift+Home, End and clicks', () => {
  it('select between the fixed end and the target, never across the origin', () => {
    expect(extendSelection(caret(10), { to: 0 }, 'circular', L)).toEqual({ anchor: 0, caret: 10, reverse: true })
    const rev = { anchor: 20, caret: 40, reverse: true }
    // The fixed end of a leftward selection is its right end.
    expect(extendSelection(rev, { to: L }, 'circular', L)).toEqual({ anchor: 40, caret: L, reverse: false })
    expect(extendSelection(rev, { to: 5 }, 'circular', L)).toEqual({ anchor: 5, caret: 40, reverse: true })
  })
})

describe('linear sequences', () => {
  it('clamp at the ends', () => {
    expect(extendSelection(caret(3), { by: -10 }, 'linear', L)).toEqual({ anchor: 0, caret: 3, reverse: true })
    expect(extendSelection(caret(97), { by: 10 }, 'linear', L)).toEqual({ anchor: 97, caret: L, reverse: false })
  })

  it('read an old-style selection with the caret first as leftward', () => {
    const legacy = { anchor: 50, caret: 40 }
    expect(selectionEnds(legacy, 'linear')).toEqual({ fixed: 50, focus: 40 })
    expect(extendSelection(legacy, { by: -5 }, 'linear', L)).toEqual({ anchor: 35, caret: 50, reverse: true })
  })
})
