import { describe, it, expect } from 'vitest'
import {
  binValues, buildGcIndex, clampStart, dragViewport, gcMean, gcProfile,
  grabViewport, niceTickInterval, packLanes, posAtX, spanContains,
} from './geometry'
import { createViewportSource } from './viewport'

describe('niceTickInterval', () => {
  it('picks 1/2/2.5/5 steps about 80px apart', () => {
    expect(niceTickInterval(10_000, 800)).toBe(1000)
    expect(niceTickInterval(5_000, 1000)).toBe(500)
    expect(niceTickInterval(3_000, 1000)).toBe(250)
  })

  it('never goes below one unit', () => {
    expect(niceTickInterval(10, 2000)).toBe(1)
  })
})

describe('pointer and viewport maths', () => {
  it('maps x to a clamped position', () => {
    expect(posAtX(54, 4, 100, 1000)).toBe(500)
    expect(posAtX(-20, 4, 100, 1000)).toBe(0)
    expect(posAtX(500, 4, 100, 1000)).toBe(1000)
  })

  it('keeps a viewport inside the sequence', () => {
    expect(clampStart(-5, 100, 1000)).toBe(0)
    expect(clampStart(950, 100, 1000)).toBe(900)
    expect(clampStart(10, 2000, 1000)).toBe(0)
  })

  it('grabbing the viewport keeps the grab point under the pointer', () => {
    const vp = { start: 200, end: 300 }
    const grab = grabViewport(250, vp, 1000)
    expect(grab).toEqual({ offset: 50, start: null })
    expect(dragViewport(450, grab.offset, vp, 1000)).toBe(400)
  })

  it('pressing outside the viewport centres it there first', () => {
    const vp = { start: 0, end: 100 }
    const grab = grabViewport(600, vp, 1000)
    expect(grab).toEqual({ offset: 50, start: 550 })
    expect(dragViewport(990, grab.offset, vp, 1000)).toBe(900)
  })
})

describe('packLanes', () => {
  const f = (id: string, start: number, end: number) => ({ id, start, end })

  it('packs non-overlapping items into one lane', () => {
    const { lanes, overflow } = packLanes([f('a', 0, 10), f('b', 10, 20)], 3)
    expect(lanes.map(l => l.map(i => i.id))).toEqual([['a', 'b']])
    expect(overflow).toEqual([])
  })

  it('moves what does not fit into an overflow lane instead of dropping it', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map(id => f(id, 0, 100))
    const { lanes, overflow } = packLanes(items, 3)
    expect(lanes).toHaveLength(2)
    expect(overflow.map(i => i.id).sort()).toEqual(['c', 'd', 'e'])
    expect(lanes.flat().length + overflow.length).toBe(5)
  })

  it('treats an origin-spanning item as occupying both ends', () => {
    const { lanes } = packLanes([f('head', 0, 50), f('wrap', 900, 20)], 3)
    // The wrap's [0, 20) part collides with head, so it needs its own lane.
    expect(lanes).toHaveLength(2)
    const fits = packLanes([f('mid', 100, 200), f('wrap', 900, 20)], 3)
    expect(fits.lanes).toHaveLength(1)
  })

  it('tests containment across the origin', () => {
    expect(spanContains({ start: 900, end: 20 }, 950)).toBe(true)
    expect(spanContains({ start: 900, end: 20 }, 10)).toBe(true)
    expect(spanContains({ start: 900, end: 20 }, 500)).toBe(false)
  })
})

describe('binValues', () => {
  it('lets every value count: an isolated dip is not skipped', () => {
    const values = new Array(1000).fill(1)
    values[503] = 0
    const bins = binValues(values, 10, 'min')
    expect(bins[5]).toBe(0)
    expect([...bins].filter(v => v === 0)).toHaveLength(1)
  })

  it('averages and repeats values when upsampling', () => {
    expect([...binValues([0, 1, 1, 0], 2, 'mean')]).toEqual([0.5, 0.5])
    expect([...binValues([0, 1], 4, 'mean')]).toEqual([0, 0, 1, 1])
  })
})

describe('GC index', () => {
  it('computes the mean and a windowed profile', () => {
    const seq = 'GGGGGGGGGG' + 'AAAAAAAAAA'
    const idx = buildGcIndex(seq)
    expect(gcMean(idx)).toBe(0.5)
    const p = gcProfile(idx, 2, 1)
    expect(p[0]).toBeCloseTo(1)
    expect(p[1]).toBeCloseTo(0)
  })

  it('counts lower case and S as strong bases', () => {
    expect(gcMean(buildGcIndex('gcSa'))).toBe(0.75)
  })

  it('stays small on genome-scale sequences', () => {
    const idx = buildGcIndex('GC'.repeat(1_000_000))
    expect(idx.prefix.length).toBeLessThanOrEqual(16385)
    expect(gcMean(idx)).toBe(1)
    expect(gcProfile(idx, 800, 100).every(v => Math.abs(v - 1) < 1e-6)).toBe(true)
  })
})

describe('viewport source', () => {
  it('notifies only on real changes', () => {
    const src = createViewportSource()
    let calls = 0
    const off = src.subscribe(() => calls++)
    src.set({ start: 0, end: 0 })
    src.set({ start: 10, end: 20 })
    src.set({ start: 10, end: 20 })
    expect(calls).toBe(1)
    off()
    src.set({ start: 30, end: 40 })
    expect(calls).toBe(1)
    expect(src.get()).toEqual({ start: 30, end: 40 })
  })
})
