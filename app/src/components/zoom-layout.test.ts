import { describe, it, expect } from 'vitest'
import { getLayout, RowLayoutMap, rowHeightForLanes } from './zoom-layout'

describe('RowLayoutMap base <-> y', () => {
  const L = getLayout(10, 1000, false, 10_000)
  const bpr = L.basesPerRow
  const rows = 20
  const seqLen = rows * bpr

  /** Rows 0-9 bare, rows 10-19 with the maximum annotation lanes. */
  const uneven = () => {
    const rl = new RowLayoutMap(rows)
    for (let r = 10; r < rows; r++) rl.lanes[r] = L.maxAnnotationRows
    rl.build(L)
    return rl
  }

  it('maps the top of a row to its first base', () => {
    const rl = uneven()
    expect(rl.baseAtY(rl.rowY(12), bpr, seqLen)).toBe(12 * bpr)
  })

  it('round-trips through yAtBase', () => {
    const rl = uneven()
    for (const base of [0, bpr / 2, 3 * bpr + 7, 11.5 * bpr, 19 * bpr + 1]) {
      expect(rl.baseAtY(rl.yAtBase(base, bpr), bpr, seqLen)).toBeCloseTo(base, 6)
    }
  })

  it('differs from the scroll fraction when rows are uneven', () => {
    const rl = uneven()
    // The bare first half of the rows is less than half the height, so
    // halfway down the scroll is already past halfway through the bases.
    expect(rowHeightForLanes(L, L.maxAnnotationRows)).toBeGreaterThan(rowHeightForLanes(L, 0))
    const midBase = rl.baseAtY(rl.totalHeight / 2, bpr, seqLen)
    expect(midBase).toBeGreaterThan(seqLen / 2)
  })

  it('clamps past the end', () => {
    const rl = uneven()
    expect(rl.baseAtY(rl.totalHeight + 500, bpr, seqLen)).toBe(seqLen)
    expect(rl.yAtBase(-5, bpr)).toBe(0)
  })
})
