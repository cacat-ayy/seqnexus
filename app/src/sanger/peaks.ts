/**
 * Per-base peak heights for a Sanger trace.
 *
 * For every called base, how tall each of the four channels is at that
 * call. The called channel is the primary peak, the tallest of the other
 * three the secondary one. Their ratio is what mixed-base (heterozygote)
 * calling, the hover readout and the QC summary all work from.
 *
 * Heights are measured in a narrow window around the call, about a third of
 * the local peak spacing either side. A neighbouring base's peak rising into
 * the window is a shoulder, not a peak of its own; when a channel is still
 * climbing at the window edge its height at the call position is used, so a
 * sharp G→A transition does not read as a mixed base.
 */

import { TRACE_BASES, type TraceData } from '../io/trace'

export interface PeakTable {
  /** Number of called bases. */
  length: number
  /** Height of channel c (0=A 1=C 2=G 3=T) at base i, at index i*4+c. */
  heights: Float32Array
  /** Channel of the called base, or the tallest channel for N and IUPAC calls. */
  primaryBase: Uint8Array
  primary: Float32Array
  /** Tallest channel other than the primary. */
  secondaryBase: Uint8Array
  secondary: Float32Array
}

const CHANNEL: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }

const cache = new WeakMap<TraceData, PeakTable>()

/** Peak table of a trace; computed once per trace object. */
export function peakTable(data: TraceData): PeakTable {
  let table = cache.get(data)
  if (!table) {
    table = computePeakTable(data)
    cache.set(data, table)
  }
  return table
}

/** Secondary height as a fraction of the primary at base i (0 when the primary is flat). */
export function secondaryRatio(table: PeakTable, i: number): number {
  const p = table.primary[i]
  return p > 0 ? table.secondary[i] / p : 0
}

export function computePeakTable(data: TraceData): PeakTable {
  const n = Math.min(data.bases.length, data.peakLocations.length)
  const channels = TRACE_BASES.map(b => data.traces[b])
  const heights = new Float32Array(n * 4)
  const primaryBase = new Uint8Array(n)
  const primary = new Float32Array(n)
  const secondaryBase = new Uint8Array(n)
  const secondary = new Float32Array(n)
  const peaks = data.peakLocations
  const fallbackSpacing = data.metadata.averageSpacing ?? 12

  for (let i = 0; i < n; i++) {
    const p = peaks[i]
    const left = i > 0 ? p - peaks[i - 1] : fallbackSpacing
    const right = i < n - 1 ? peaks[i + 1] - p : fallbackSpacing
    const spacing = Math.max(2, Math.min(left, right) > 0 ? Math.min(left, right) : fallbackSpacing)
    const w = Math.max(1, Math.round(spacing / 3))

    for (let c = 0; c < 4; c++) {
      heights[i * 4 + c] = windowPeak(channels[c], p, w)
    }

    const called = CHANNEL[data.bases[i]]
    let pc = called ?? 0
    if (called === undefined) {
      for (let c = 1; c < 4; c++) if (heights[i * 4 + c] > heights[i * 4 + pc]) pc = c
    }
    let sc = pc === 0 ? 1 : 0
    for (let c = 0; c < 4; c++) {
      if (c !== pc && heights[i * 4 + c] > heights[i * 4 + sc]) sc = c
    }
    primaryBase[i] = pc
    primary[i] = heights[i * 4 + pc]
    secondaryBase[i] = sc
    secondary[i] = heights[i * 4 + sc]
  }

  return { length: n, heights, primaryBase, primary, secondaryBase, secondary }
}

/**
 * Height of a channel's peak near sample p: the window maximum when the
 * maximum is a real local peak, otherwise the value at p.
 */
function windowPeak(trace: number[], p: number, w: number): number {
  const len = trace.length
  if (len === 0 || p < 0 || p >= len) return 0
  const lo = Math.max(0, p - w)
  const hi = Math.min(len - 1, p + w)
  let best = lo
  for (let s = lo + 1; s <= hi; s++) if (trace[s] > trace[best]) best = s
  const atEdge =
    (best === lo && lo > 0 && trace[lo - 1] > trace[lo]) ||
    (best === hi && hi < len - 1 && trace[hi + 1] > trace[hi])
  return Math.max(0, atEdge ? trace[p] : trace[best])
}
