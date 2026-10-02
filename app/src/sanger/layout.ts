/**
 * A read laid out as columns, one per base as edited.
 *
 * Every called base is a column; a base the user inserted is a column of its
 * own; a deleted base keeps its column (drawn struck through) so the trace
 * under it stays visible and the deletion can be taken back. Columns are
 * evenly spaced, and the trace is warped piecewise-linearly so each call's
 * peak sits in the middle of its column. That keeps letters legible at every
 * zoom, gives inserted bases room, and is what lets traces line up under an
 * alignment's columns later.
 *
 * Positions along a row are in column units: column c spans [c, c+1) and its
 * centre is c + 0.5. `posOfSample` / `sampleOfPos` convert between trace
 * samples and positions. Everything here is in the read's forward
 * orientation; a reverse-complemented display mirrors it (see `mirror`).
 */

import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'

export const KIND_ORIGINAL = 0
export const KIND_SUBSTITUTE = 1
export const KIND_INSERT = 2
export const KIND_DELETE = 3
export type ColumnKind = typeof KIND_ORIGINAL | typeof KIND_SUBSTITUTE | typeof KIND_INSERT | typeof KIND_DELETE

export interface ReadLayout {
  /** Number of columns. */
  n: number
  /** The base shown in each column (the original base for a deleted one). */
  bases: string
  kind: Uint8Array
  /**
   * The called base a column stands for: its index for original, substituted
   * and deleted columns; for an inserted column, the base it sits before
   * (bases.length when it is past the end).
   */
  origin: Int32Array
  /** Order among the inserts before the same base; -1 for other columns. */
  insertOffset: Int32Array
  /** Trace sample under each column's centre; strictly increasing. */
  sample: Float64Array
  /** Column of each called base, by index. */
  columnOfBase: Int32Array
  traceLength: number
  /** Number of edited columns (substituted, inserted or deleted). */
  edited: number
  /** 1 where a substitution is a mixed-base call made from second peaks. */
  auto: Uint8Array
}

/** Lay out a read and its edits. */
export function buildLayout(data: TraceData, edits: readonly BaseEdit[]): ReadLayout {
  const len = data.bases.length
  const subs = new Map<number, string>()
  const autoSubs = new Set<number>()
  const dels = new Set<number>()
  const inserts = new Map<number, { offset: number; base: string }[]>()
  for (const e of edits) {
    if (e.pos < 0 || e.pos > len) continue
    if (e.type === 'substitute' && e.pos < len) {
      subs.set(e.pos, e.base)
      if (e.by === 'mixed') autoSubs.add(e.pos)
      else autoSubs.delete(e.pos)
    }
    else if (e.type === 'delete' && e.pos < len) dels.add(e.pos)
    else if (e.type === 'insert') {
      const list = inserts.get(e.pos)
      if (list) list.push({ offset: e.offset, base: e.base })
      else inserts.set(e.pos, [{ offset: e.offset, base: e.base }])
    }
  }
  for (const list of inserts.values()) list.sort((a, b) => a.offset - b.offset)

  let n = len
  for (const list of inserts.values()) n += list.length

  const kind = new Uint8Array(n)
  const origin = new Int32Array(n)
  const insertOffset = new Int32Array(n).fill(-1)
  const columnOfBase = new Int32Array(len)
  const auto = new Uint8Array(n)
  const out: string[] = new Array(n)
  let edited = 0
  let c = 0
  const pushInserts = (pos: number) => {
    const list = inserts.get(pos)
    if (!list) return
    list.forEach((ins, k) => {
      kind[c] = KIND_INSERT
      origin[c] = pos
      insertOffset[c] = k
      out[c] = ins.base
      edited++
      c++
    })
  }
  for (let i = 0; i < len; i++) {
    pushInserts(i)
    columnOfBase[i] = c
    origin[c] = i
    if (dels.has(i)) { kind[c] = KIND_DELETE; out[c] = data.bases[i]; edited++ }
    else if (subs.has(i) && subs.get(i) !== data.bases[i]) { kind[c] = KIND_SUBSTITUTE; out[c] = subs.get(i)!; edited++; if (autoSubs.has(i)) auto[c] = 1 }
    else { kind[c] = KIND_ORIGINAL; out[c] = data.bases[i] }
    c++
  }
  pushInserts(len)

  const traceLength = Math.max(data.traces.A.length, data.traces.C.length, data.traces.G.length, data.traces.T.length)
  const sample = columnSamples(data, kind, origin, n, traceLength)
  return { n, bases: out.join(''), kind, origin, insertOffset, sample, columnOfBase, traceLength, edited, auto }
}

/**
 * Trace sample under each column. Called bases sit on their peaks; inserted
 * ones are spread evenly between the called bases around them; past either
 * end the average spacing continues. Forced strictly increasing, since a few
 * files repeat a peak position.
 */
function columnSamples(data: TraceData, kind: Uint8Array, origin: Int32Array, n: number, traceLength: number): Float64Array {
  const sample = new Float64Array(n)
  const peaks = data.peakLocations
  const spacing = averageSpacing(data, traceLength)
  // Anchors: columns of called bases (original, substituted or deleted).
  const anchorCols: number[] = []
  for (let c = 0; c < n; c++) {
    if (kind[c] !== KIND_INSERT) {
      anchorCols.push(c)
      sample[c] = peaks[origin[c]] ?? 0
    }
  }
  for (let k = 1; k < anchorCols.length; k++) {
    const a = anchorCols[k - 1]
    const b = anchorCols[k]
    if (sample[b] <= sample[a]) sample[b] = sample[a] + 0.5
  }
  if (anchorCols.length === 0) {
    for (let c = 0; c < n; c++) sample[c] = (c + 0.5) * spacing
    return sample
  }
  // Inserts before the first anchor and after the last continue the spacing outwards.
  const first = anchorCols[0]
  for (let c = first - 1; c >= 0; c--) sample[c] = sample[c + 1] - spacing
  const last = anchorCols[anchorCols.length - 1]
  for (let c = last + 1; c < n; c++) sample[c] = sample[c - 1] + spacing
  // Inserts between anchors share the gap evenly.
  for (let k = 1; k < anchorCols.length; k++) {
    const a = anchorCols[k - 1]
    const b = anchorCols[k]
    for (let c = a + 1; c < b; c++) sample[c] = sample[a] + ((sample[b] - sample[a]) * (c - a)) / (b - a)
  }
  return sample
}

function averageSpacing(data: TraceData, traceLength: number): number {
  const p = data.peakLocations
  if (p.length >= 2) {
    const s = (p[p.length - 1] - p[0]) / (p.length - 1)
    if (s > 0) return s
  }
  if (data.metadata.averageSpacing) return data.metadata.averageSpacing
  return p.length > 0 ? Math.max(1, traceLength / p.length) : 12
}

/**
 * Position (column units) of a trace sample. Column centres map to their
 * samples exactly; samples in between are interpolated; beyond the ends the
 * outermost spacing continues.
 */
export function posOfSample(layout: ReadLayout, s: number): number {
  const { sample, n } = layout
  if (n === 0) return 0
  if (n === 1) return 0.5 + (s - sample[0]) / 12
  if (s <= sample[0]) return 0.5 + (s - sample[0]) / (sample[1] - sample[0])
  if (s >= sample[n - 1]) return n - 0.5 + (s - sample[n - 1]) / (sample[n - 1] - sample[n - 2])
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sample[mid] <= s) lo = mid
    else hi = mid
  }
  return lo + 0.5 + (s - sample[lo]) / (sample[hi] - sample[lo])
}

/** Trace sample at a position (column units); the inverse of `posOfSample`. */
export function sampleOfPos(layout: ReadLayout, pos: number): number {
  const { sample, n } = layout
  if (n === 0) return 0
  if (n === 1) return sample[0] + (pos - 0.5) * 12
  const f = pos - 0.5
  if (f <= 0) return sample[0] + f * (sample[1] - sample[0])
  if (f >= n - 1) return sample[n - 1] + (f - (n - 1)) * (sample[n - 1] - sample[n - 2])
  const i = Math.floor(f)
  return sample[i] + (f - i) * (sample[i + 1] - sample[i])
}

/** Display column for a forward column, and back (the map is its own inverse). */
export function mirror(layout: ReadLayout, col: number, reversed: boolean): number {
  return reversed ? layout.n - 1 - col : col
}

/** A display range [d0, d1) as the forward columns it covers. */
export function forwardRange(layout: ReadLayout, d0: number, d1: number, reversed: boolean): [number, number] {
  return reversed ? [layout.n - d1, layout.n - d0] : [d0, d1]
}

/**
 * Columns inside the trimmed read: called bases in [trimStart, trimEnd) and
 * inserts between them, including those right at either edge.
 */
export function inTrim(layout: ReadLayout, col: number, trimStart: number, trimEnd: number): boolean {
  const o = layout.origin[col]
  if (layout.kind[col] === KIND_INSERT) return o >= trimStart && o <= trimEnd
  return o >= trimStart && o < trimEnd
}

/** Display columns of the trim edges: kept columns are [start, end). */
export function trimColumns(layout: ReadLayout, trimStart: number, trimEnd: number, reversed: boolean): [number, number] {
  let a = -1
  let b = -1
  for (let c = 0; c < layout.n; c++) {
    if (inTrim(layout, c, trimStart, trimEnd)) {
      if (a < 0) a = c
      b = c + 1
    }
  }
  if (a < 0) {
    // Nothing kept: both edges at the start of the trim.
    const at = trimStart < layout.columnOfBase.length ? layout.columnOfBase[trimStart] : layout.n
    a = at
    b = at
  }
  return reversed ? [layout.n - b, layout.n - a] : [a, b]
}

/** Trim bounds (called-base indices) for a kept range of display columns [d0, d1). */
export function trimForColumns(layout: ReadLayout, d0: number, d1: number, reversed: boolean, baseCount: number): [number, number] {
  const [c0, c1] = forwardRange(layout, d0, d1, reversed)
  if (c1 <= c0) return [0, 0]
  // Start: the first called base at or after c0 (an insert there counts from its base).
  const start = Math.min(baseCount, layout.origin[Math.max(0, Math.min(layout.n - 1, c0))])
  // End: one past the last called base before c1.
  let end = start
  for (let c = c1 - 1; c >= c0; c--) {
    if (layout.kind[c] !== KIND_INSERT) { end = layout.origin[c] + 1; break }
    end = layout.origin[c]
  }
  return [start, Math.max(start, Math.min(baseCount, end))]
}
