/**
 * Pure maths behind the minimap: ticks, pointer mapping, viewport dragging,
 * lane packing and binning. Kept free of the DOM so it can be tested alone.
 */

import type { Viewport } from './types'

/** A "nice" tick spacing (1, 2, 2.5 or 5 x 10^n) about `targetPx` apart. */
export function niceTickInterval(length: number, widthPx: number, targetPx = 80): number {
  if (length <= 0 || widthPx <= 0) return 1
  const raw = (length / widthPx) * targetPx
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))))
  const nice = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) ?? 10
  // Positions are whole units; a spacing below 1 would label a base twice.
  return Math.max(1, nice * mag)
}

/** The position (units, fractional) under pixel `x` of a bar from `x0` spanning `w`. */
export function posAtX(x: number, x0: number, w: number, length: number): number {
  if (w <= 0) return 0
  return Math.max(0, Math.min(length, ((x - x0) / w) * length))
}

/** Keep a viewport of `span` units inside [0, length]. */
export function clampStart(start: number, span: number, length: number): number {
  return Math.max(0, Math.min(Math.max(0, length - span), start))
}

/**
 * Begin a drag at `pos`.
 *
 * Grabbing the viewport keeps the grab point under the pointer; pressing
 * anywhere else first centres the viewport there (the returned `start`),
 * then drags from its middle.
 */
export function grabViewport(pos: number, vp: Viewport, length: number): { offset: number; start: number | null } {
  const span = Math.max(0, vp.end - vp.start)
  if (pos >= vp.start && pos <= vp.end) return { offset: pos - vp.start, start: null }
  return { offset: span / 2, start: clampStart(pos - span / 2, span, length) }
}

/** Where the viewport should start while dragging with `offset` held. */
export function dragViewport(pos: number, offset: number, vp: Viewport, length: number): number {
  const span = Math.max(0, vp.end - vp.start)
  return clampStart(pos - offset, span, length)
}

export interface Span {
  start: number
  /** Exclusive. Smaller than `start` when the span wraps the origin. */
  end: number
}

/**
 * Greedy lane packing that never drops anything.
 *
 * Items pack into as many lanes as they need. When that is more than
 * `maxLanes`, the first `maxLanes - 1` lanes are kept and every remaining
 * item goes into `overflow`, which the caller draws as a final, merged lane —
 * the old minimap silently discarded these, so dense maps lost features.
 * A wrapping item occupies both [start, length) and [0, end).
 */
export function packLanes<T extends Span>(items: readonly T[], maxLanes: number): { lanes: T[][]; overflow: T[] } {
  const sorted = [...items].sort((a, b) => a.start - b.start || spanOf(b) - spanOf(a))
  const lanes: { items: T[]; lastEnd: number; firstStart: number }[] = []
  for (const item of sorted) {
    const wraps = item.end < item.start
    let lane = lanes.find(l => l.lastEnd <= item.start && (!wraps || item.end <= l.firstStart))
    if (!lane) {
      lane = { items: [], lastEnd: 0, firstStart: Infinity }
      lanes.push(lane)
    }
    lane.items.push(item)
    if (lane.items.length === 1 && !wraps) lane.firstStart = item.start
    lane.lastEnd = wraps ? Infinity : item.end
  }
  const all = lanes.map(l => l.items)
  if (all.length <= maxLanes) return { lanes: all, overflow: [] }
  const keep = Math.max(0, maxLanes - 1)
  return { lanes: all.slice(0, keep), overflow: all.slice(keep).flat() }
}

/** Unwrapped length; wrapping spans sort as long so they claim lanes early. */
function spanOf(s: Span): number {
  return s.end >= s.start ? s.end - s.start : Number.MAX_SAFE_INTEGER
}

/** Whether `pos` falls inside a (possibly wrapping) span, padded by `slop`. */
export function spanContains(s: Span, pos: number, slop = 0): boolean {
  if (s.end >= s.start) return pos >= s.start - slop && pos < s.end + slop
  return pos >= s.start - slop || pos < s.end + slop
}

/**
 * Summarise `values` into `bins` buckets.
 *
 * Every value lands in exactly one bucket, so nothing between two sampled
 * columns is skipped — the alignment minimap used to read one column per
 * pixel and miss isolated gaps on long alignments. With more buckets than
 * values, each bucket repeats the value it falls on.
 */
export function binValues(values: ArrayLike<number>, bins: number, mode: 'mean' | 'min' | 'max'): Float32Array {
  const n = values.length
  const out = new Float32Array(Math.max(0, bins))
  if (n === 0 || bins <= 0) return out
  for (let b = 0; b < bins; b++) {
    const s = Math.floor((b * n) / bins)
    const e = Math.max(s + 1, Math.floor(((b + 1) * n) / bins))
    let acc = mode === 'min' ? Infinity : mode === 'max' ? -Infinity : 0
    for (let i = s; i < e && i < n; i++) {
      const v = values[i]
      if (mode === 'min') acc = Math.min(acc, v)
      else if (mode === 'max') acc = Math.max(acc, v)
      else acc += v
    }
    out[b] = mode === 'mean' ? acc / (Math.min(e, n) - s) : acc
  }
  return out
}

/** Prefix sums of G/C counts over fixed-size blocks, for windowed GC queries. */
export interface GcIndex {
  length: number
  blockSize: number
  /** prefix[k] = G+C count in blocks [0, k). */
  prefix: Uint32Array
}

/** Blocks keep the index small on genome-scale sequences. */
const GC_MAX_BLOCKS = 16384

export function buildGcIndex(bases: string): GcIndex {
  const n = bases.length
  const blockSize = Math.max(1, Math.ceil(n / GC_MAX_BLOCKS))
  const blocks = Math.ceil(n / blockSize)
  const prefix = new Uint32Array(blocks + 1)
  let acc = 0
  for (let b = 0; b < blocks; b++) {
    const end = Math.min(n, (b + 1) * blockSize)
    for (let i = b * blockSize; i < end; i++) {
      const ch = bases.charCodeAt(i) | 0x20 // fold case
      if (ch === 103 || ch === 99 || ch === 115) acc++ // g, c, s (strong)
    }
    prefix[b + 1] = acc
  }
  return { length: n, blockSize, prefix }
}

/**
 * GC fraction per bin, each taken over a window at least `minWindow` units
 * wide centred on the bin. Without the floor, a 1 kb sequence on a wide
 * screen gets one base per bin and the plot is a comb of 0% and 100%.
 */
export function gcProfile(idx: GcIndex, bins: number, minWindow: number): Float32Array {
  const out = new Float32Array(Math.max(0, bins))
  const { length: n, blockSize: bs, prefix } = idx
  if (n === 0 || bins <= 0) return out
  const blocks = prefix.length - 1
  const binSpan = n / bins
  const half = Math.max(binSpan, minWindow) / 2
  for (let b = 0; b < bins; b++) {
    const mid = (b + 0.5) * binSpan
    const s = Math.max(0, mid - half)
    const e = Math.min(n, mid + half)
    const sb = Math.min(blocks - 1, Math.floor(s / bs))
    const eb = Math.min(blocks, Math.max(sb + 1, Math.round(e / bs)))
    const count = prefix[eb] - prefix[sb]
    const size = Math.min(n, eb * bs) - sb * bs
    out[b] = size > 0 ? count / size : 0
  }
  return out
}

/** Mean GC fraction of the whole sequence. */
export function gcMean(idx: GcIndex): number {
  return idx.length > 0 ? idx.prefix[idx.prefix.length - 1] / idx.length : 0
}
