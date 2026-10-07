/**
 * Laying out an assembly graph for drawing, the way Bandage does: each
 * segment is a chain of points, more points the longer it is, so long
 * contigs are long strokes and short pieces short ones; a circle's chain
 * closes on itself. Springs hold each chain together and join the ends that
 * links join; every point pushes its near neighbours away; and each inner
 * point of a chain is pulled toward the middle of its two neighbours, which
 * keeps strokes smooth. The forces run for a few hundred steps of shrinking
 * size (simulated annealing), from a start where linked segments sit near
 * each other.
 *
 * Each connected component is laid out on its own and the components are
 * then packed in rows, largest first, so a chromosome and its plasmids sit
 * side by side rather than drifting apart. Repulsion only looks at points in
 * the neighbouring cells of a grid, so a step costs about the number of
 * points.
 */

import { components, type AssemblyGraph } from './graph'

export interface GraphLayout {
  /** Per segment, its chain's points: x0, y0, x1, y1, ... */
  points: Float64Array[]
  width: number
  height: number
}

/** About this many points in all, shared out by length. */
export const LAYOUT_POINTS = 700
const MAX_CHAIN = 90
const STEPS = 500
/** Up to this many points, every pair of points pushes apart; above it, only near ones (a grid). */
const ALL_PAIRS = 1200

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

interface Comp {
  segs: number[]
  /** Point coordinates, interleaved. */
  xy: Float64Array
  /** First point of each segment in xy (by position in segs), and how many. */
  start: number[]
  count: number[]
  springs: [number, number, number, number][]
}

export function layoutGraph(g: AssemblyGraph, seed = 1): GraphLayout {
  const rand = rng(seed)
  const total = g.segments.reduce((n, s) => n + s.length, 0)
  const unit = Math.max(20, total / LAYOUT_POINTS)
  const chain = (i: number) => {
    const s = g.segments[i]
    const n = Math.ceil(s.length / unit) + 1
    return Math.max(s.circular ? 8 : 2, Math.min(MAX_CHAIN, n))
  }
  const points: Float64Array[] = g.segments.map(() => new Float64Array(0))
  const comps = components(g)
  const boxes: { comp: Comp; minX: number; minY: number; w: number; h: number }[] = []
  for (const segs of comps) {
    const comp = layoutComponent(g, segs, chain, rand)
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
    for (let p = 0; p < comp.xy.length; p += 2) {
      minX = Math.min(minX, comp.xy[p]); maxX = Math.max(maxX, comp.xy[p])
      minY = Math.min(minY, comp.xy[p + 1]); maxY = Math.max(maxY, comp.xy[p + 1])
    }
    boxes.push({ comp, minX, minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) })
  }
  // Pack in rows, largest first, rows about as wide as the whole is tall.
  const gap = 3
  const area = boxes.reduce((a, b) => a + (b.w + gap) * (b.h + gap), 0)
  const rowWidth = Math.max(...boxes.map(b => b.w), Math.sqrt(area) * 1.4)
  let x = 0; let y = 0; let rowH = 0; let width = 0
  for (const b of boxes) {
    if (x > 0 && x + b.w > rowWidth) { x = 0; y += rowH + gap; rowH = 0 }
    const { comp } = b
    comp.segs.forEach((seg, k) => {
      const out = new Float64Array(comp.count[k] * 2)
      for (let p = 0; p < comp.count[k]; p++) {
        out[2 * p] = comp.xy[2 * (comp.start[k] + p)] - b.minX + x
        out[2 * p + 1] = comp.xy[2 * (comp.start[k] + p) + 1] - b.minY + y
      }
      points[seg] = out
    })
    x += b.w + gap
    width = Math.max(width, x - gap)
    rowH = Math.max(rowH, b.h)
  }
  return { points, width: Math.max(1, width), height: Math.max(1, y + rowH) }
}

function layoutComponent(g: AssemblyGraph, segs: number[], chain: (i: number) => number, rand: () => number): Comp {
  const local = new Map(segs.map((s, k) => [s, k]))
  const start: number[] = []
  const count: number[] = []
  let n = 0
  for (const s of segs) { start.push(n); const c = chain(s); count.push(c); n += c }
  const xy = new Float64Array(n * 2)
  const springs: [number, number, number, number][] = []
  // Chains: neighbouring points one unit apart; a circle closes.
  segs.forEach((s, k) => {
    for (let p = 0; p + 1 < count[k]; p++) springs.push([start[k] + p, start[k] + p + 1, 1, 0.5])
    if (g.segments[s].circular) springs.push([start[k] + count[k] - 1, start[k], 1, 0.5])
  })
  // Links: the end a link leaves from to the end it enters.
  const exitOf = (k: number, strand: string) => (strand === '+' ? start[k] + count[k] - 1 : start[k])
  const entryOf = (k: number, strand: string) => (strand === '+' ? start[k] : start[k] + count[k] - 1)
  for (const [a, as, b, bs] of g.links) {
    const ka = local.get(a)
    const kb = local.get(b)
    if (ka === undefined || kb === undefined) continue
    if (a === b && g.segments[a].circular) continue
    springs.push([exitOf(ka, as), entryOf(kb, bs), 0.5, 1.5])
  }

  // Start: segments in breadth-first order from the largest, each chain
  // starting next to the end of one already placed, in a random direction.
  const placed = new Uint8Array(segs.length)
  const order: number[] = []
  const adj: number[][] = segs.map(() => [])
  for (const [p, q] of springs) {
    const kp = segOf(p, start)
    const kq = segOf(q, start)
    if (kp !== kq) { adj[kp].push(kq); adj[kq].push(kp) }
  }
  const first = segs.reduce((best, s, k) => (g.segments[s].length > g.segments[segs[best]].length ? k : best), 0)
  const queue = [first]
  placed[first] = 1
  while (order.length < segs.length) {
    if (queue.length === 0) {
      const k = placed.indexOf(0)
      placed[k] = 1
      queue.push(k)
    }
    const k = queue.shift()!
    order.push(k)
    for (const j of adj[k]) if (!placed[j]) { placed[j] = 1; queue.push(j) }
  }
  const at = new Uint8Array(segs.length)
  for (const k of order) {
    // Next to a placed neighbour's last point, or at the origin.
    let ox = 0; let oy = 0
    const nb = adj[k].find(j => at[j])
    if (nb !== undefined) { ox = xy[2 * (start[nb] + count[nb] - 1)]; oy = xy[2 * (start[nb] + count[nb] - 1) + 1] }
    const angle = rand() * Math.PI * 2
    const c = count[k]
    if (g.segments[segs[k]].circular) {
      const r = c / (2 * Math.PI)
      for (let p = 0; p < c; p++) {
        xy[2 * (start[k] + p)] = ox + r * Math.cos(angle + (p / c) * 2 * Math.PI) + rand() * 0.1
        xy[2 * (start[k] + p) + 1] = oy + r * Math.sin(angle + (p / c) * 2 * Math.PI) + rand() * 0.1
      }
    } else {
      for (let p = 0; p < c; p++) {
        xy[2 * (start[k] + p)] = ox + Math.cos(angle) * (p + 1) + rand() * 0.1
        xy[2 * (start[k] + p) + 1] = oy + Math.sin(angle) * (p + 1) + rand() * 0.1
      }
    }
    at[k] = 1
  }

  // Inner chain points, with their two neighbours, for smoothing.
  const inner: [number, number, number][] = []
  segs.forEach((s, k) => {
    const c = count[k]
    const circ = g.segments[s].circular
    for (let p = 0; p < c; p++) {
      if (!circ && (p === 0 || p === c - 1)) continue
      inner.push([start[k] + p, start[k] + ((p - 1 + c) % c), start[k] + ((p + 1) % c)])
    }
  })

  simulate(xy, n, springs, inner)
  return { segs, xy, start, count, springs }
}

function segOf(point: number, start: number[]): number {
  let lo = 0
  let hi = start.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (start[m] <= point) lo = m
    else hi = m - 1
  }
  return lo
}

function simulate(xy: Float64Array, n: number, springs: readonly [number, number, number, number][], inner: readonly [number, number, number][]) {
  const fx = new Float64Array(n)
  const fy = new Float64Array(n)
  const R = 3.5
  const cell = new Map<number, number[]>()
  const key = (cx: number, cy: number) => cx * 73856093 ^ cy * 19349663
  for (let step = 0; step < STEPS; step++) {
    const t = 1 - step / STEPS
    const maxMove = 0.05 + 1.2 * t
    fx.fill(0)
    fy.fill(0)
    if (n <= ALL_PAIRS) {
      // Every pair: a long-reaching push, which opens a loop that leaves a
      // repeat and comes back to it instead of folding it in two.
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          let ddx = xy[2 * i] - xy[2 * j]
          let ddy = xy[2 * i + 1] - xy[2 * j + 1]
          let d2 = ddx * ddx + ddy * ddy
          if (d2 < 1e-6) { ddx = 0.01 * (i - j); ddy = 0.01; d2 = ddx * ddx + ddy * ddy }
          // Magnitude 0.35 / distance.
          const f = 0.35 / Math.max(d2, 0.05)
          fx[i] += ddx * f; fy[i] += ddy * f
          fx[j] -= ddx * f; fy[j] -= ddy * f
        }
      }
    } else {
    // Repulsion from points in neighbouring cells.
    cell.clear()
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(xy[2 * i] / R), Math.floor(xy[2 * i + 1] / R))
      const list = cell.get(k)
      if (list) list.push(i)
      else cell.set(k, [i])
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(xy[2 * i] / R)
      const cy = Math.floor(xy[2 * i + 1] / R)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const list = cell.get(key(cx + dx, cy + dy))
          if (!list) continue
          for (const j of list) {
            if (j <= i) continue
            let ddx = xy[2 * i] - xy[2 * j]
            let ddy = xy[2 * i + 1] - xy[2 * j + 1]
            let d2 = ddx * ddx + ddy * ddy
            if (d2 > R * R) continue
            if (d2 < 1e-6) { ddx = 0.01 * (i - j); ddy = 0.01; d2 = ddx * ddx + ddy * ddy }
            const f = 0.35 / d2
            fx[i] += ddx * f; fy[i] += ddy * f
            fx[j] -= ddx * f; fy[j] -= ddy * f
          }
        }
      }
    }
    }
    // A weak pull to the middle, so the far-reaching push does not spread the component without end.
    let mx = 0
    let my = 0
    for (let i = 0; i < n; i++) { mx += xy[2 * i]; my += xy[2 * i + 1] }
    mx /= n
    my /= n
    for (let i = 0; i < n; i++) { fx[i] += 0.004 * (mx - xy[2 * i]); fy[i] += 0.004 * (my - xy[2 * i + 1]) }
    // Springs.
    for (const [a, b, rest, stiff] of springs) {
      const ddx = xy[2 * b] - xy[2 * a]
      const ddy = xy[2 * b + 1] - xy[2 * a + 1]
      const d = Math.sqrt(ddx * ddx + ddy * ddy) || 1e-6
      const f = stiff * (d - rest) / d
      fx[a] += ddx * f; fy[a] += ddy * f
      fx[b] -= ddx * f; fy[b] -= ddy * f
    }
    // Smoothing: toward the middle of the two neighbours.
    for (const [p, q, r] of inner) {
      fx[p] += 0.35 * ((xy[2 * q] + xy[2 * r]) / 2 - xy[2 * p])
      fy[p] += 0.35 * ((xy[2 * q + 1] + xy[2 * r + 1]) / 2 - xy[2 * p + 1])
    }
    for (let i = 0; i < n; i++) {
      const m = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i])
      const s = m > maxMove ? maxMove / m : 1
      xy[2 * i] += fx[i] * s
      xy[2 * i + 1] += fy[i] * s
    }
  }
}
