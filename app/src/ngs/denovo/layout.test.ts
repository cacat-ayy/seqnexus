import { describe, expect, it } from 'vitest'
import { layoutGraph } from './layout'
import type { AssemblyGraph } from './graph'

const seg = (length: number, circular = false) => ({ name: `s${length}`, length, coverage: 10, circular, contig: null })

describe('graph layout', () => {
  it('draws every segment as a chain, keeps linked ends together and components apart', () => {
    const g: AssemblyGraph = {
      version: 1, overlap: 30, coverageUnit: 'k-mer',
      // A repeat (2) between three pieces, and a separate circle (4).
      segments: [seg(5000), seg(4000), seg(150), seg(3000), seg(2000, true)],
      links: [[0, '+', 2, '+'], [2, '+', 1, '+'], [1, '+', 2, '-'], [2, '-', 3, '-'], [4, '+', 4, '+']],
    }
    const a = layoutGraph(g)
    const b = layoutGraph(g)
    expect(a.points.map(p => Array.from(p))).toEqual(b.points.map(p => Array.from(p)))
    for (const p of a.points) {
      expect(p.length).toBeGreaterThanOrEqual(4)
      for (const v of p) expect(Number.isFinite(v)).toBe(true)
    }
    // Longer segments get more points.
    expect(a.points[0].length).toBeGreaterThan(a.points[2].length)
    const end = (i: number, last: boolean) => { const p = a.points[i]; const k = last ? p.length - 2 : 0; return [p[k], p[k + 1]] }
    const dist = (x: number[], y: number[]) => Math.hypot(x[0] - y[0], x[1] - y[1])
    // Link 0+ to 2+: end of 0 next to the start of 2 (a few units, where four joins pull on one short repeat),
    // against segments a hundred units long.
    expect(dist(end(0, true), end(2, false))).toBeLessThan(4)
    expect(a.width).toBeGreaterThan(40)
    // The circle's chain closes: its last point is as near its first as its points are to each other.
    const ring = a.points[4]
    const steps: number[] = []
    for (let k = 2; k < ring.length; k += 2) steps.push(Math.hypot(ring[k] - ring[k - 2], ring[k + 1] - ring[k - 1]))
    steps.sort((x, y) => x - y)
    expect(dist(end(4, true), end(4, false))).toBeLessThan(1.5 * steps[steps.length >> 1])
    // The circle sits apart from the rest: their boxes do not overlap.
    const box = (ids: number[]) => {
      const xs = ids.flatMap(i => Array.from(a.points[i]).filter((_, k) => k % 2 === 0))
      const ys = ids.flatMap(i => Array.from(a.points[i]).filter((_, k) => k % 2 === 1))
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
    }
    const p = box([0, 1, 2, 3])
    const q = box([4])
    expect(p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0).toBe(true)
    expect(a.width).toBeGreaterThan(0)
  })
})
