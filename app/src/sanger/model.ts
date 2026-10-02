/**
 * What the trace view shows, per display column.
 *
 * Built from a read, its edits, trim and orientation. Display columns run
 * left to right as drawn: in a reversed (reverse-complemented) view display
 * column d is forward column n-1-d and every base is complemented. The trace
 * view, the inspector and the figure export all read this, so they always
 * agree on what is where.
 */

import type { TraceBase, TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import { complementBase } from '../models/complement'
import { translateCodon } from '../utils/codon'
import { buildLayout, KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE, trimColumns, type ReadLayout } from './layout'
import { peakTable, type PeakTable } from './peaks'

const CHANNELS: TraceBase[] = ['A', 'C', 'G', 'T']

export interface TraceModel {
  data: TraceData
  layout: ReadLayout
  peaks: PeakTable
  reversed: boolean
  /** Number of columns. */
  n: number
  /** Base shown in each display column. */
  shown: string
  kind: Uint8Array
  /** 1 where the call is a mixed-base call made from second peaks. */
  auto: Uint8Array
  /** Quality of the call under each display column; -1 for inserted bases. */
  quality: Int16Array
  /** Second-tallest peak over the called one, per display column (0 for inserts). */
  secondRatio: Float32Array
  /** The second peak's base, in display orientation. */
  secondBase: string
  /** The instrument's call where the user changed it (display orientation), else a space. */
  original: string
  /** Kept display columns, half-open. */
  trim: [number, number]
  /** Local peak height per forward column, for normalised drawing. */
  envelope: Float32Array
  /** A high but typical peak height across the read, for un-normalised drawing. */
  scale: number
}

export function buildTraceModel(
  data: TraceData,
  edits: readonly BaseEdit[],
  trimStart: number,
  trimEnd: number,
  reversed: boolean,
  layout: ReadLayout = buildLayout(data, edits),
): TraceModel {
  const n = layout.n
  const peaks = peakTable(data)
  const kind = new Uint8Array(n)
  const auto = new Uint8Array(n)
  const quality = new Int16Array(n)
  const secondRatio = new Float32Array(n)
  const shown: string[] = new Array(n)
  const second: string[] = new Array(n)
  const original: string[] = new Array(n)
  for (let d = 0; d < n; d++) {
    const c = reversed ? n - 1 - d : d
    const k = layout.kind[c]
    const o = layout.origin[c]
    kind[d] = k
    auto[d] = layout.auto[c]
    const b = layout.bases[c]
    shown[d] = reversed ? complementBase(b) : b
    if (k === KIND_INSERT) {
      quality[d] = -1
      second[d] = ' '
      original[d] = ' '
      continue
    }
    quality[d] = data.qualityScores[o] ?? 0
    const p = o < peaks.length ? peaks.primary[o] : 0
    secondRatio[d] = p > 0 ? peaks.secondary[o] / p : 0
    const sb = CHANNELS[peaks.secondaryBase[o] ?? 0]
    second[d] = reversed ? complementBase(sb) : sb
    original[d] = k === KIND_SUBSTITUTE ? (reversed ? complementBase(data.bases[o]) : data.bases[o]) : ' '
  }
  const { envelope, scale } = heightEnvelope(layout, peaks)
  return {
    data, layout, peaks, reversed, n,
    shown: shown.join(''),
    kind, auto, quality, secondRatio,
    secondBase: second.join(''),
    original: original.join(''),
    trim: trimColumns(layout, trimStart, trimEnd, reversed),
    envelope, scale,
  }
}

/**
 * Local peak height per forward column: the tallest called peak within 15
 * bases, then smoothed. Dividing by it evens out the fall-off along a read.
 */
function heightEnvelope(layout: ReadLayout, peaks: PeakTable): { envelope: Float32Array; scale: number } {
  const m = peaks.length
  const W = 15
  const local = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    let best = 0
    for (let j = Math.max(0, i - W); j <= Math.min(m - 1, i + W); j++) if (peaks.primary[j] > best) best = peaks.primary[j]
    local[i] = best
  }
  const smooth = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    let s = 0
    let k = 0
    for (let j = Math.max(0, i - W); j <= Math.min(m - 1, i + W); j++) { s += local[j]; k++ }
    smooth[i] = k ? s / k : 0
  }
  const sorted = Array.from(peaks.primary).sort((a, b) => a - b)
  const scale = Math.max(1, sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 1)
  const floor = scale * 0.04
  const envelope = new Float32Array(layout.n)
  for (let c = 0; c < layout.n; c++) {
    const o = Math.min(m - 1, layout.origin[c])
    envelope[c] = Math.max(floor, o >= 0 && m > 0 ? smooth[o] : scale)
  }
  return { envelope, scale }
}

/** Forward column of a display column. */
export function forwardColumn(m: TraceModel, d: number): number {
  return m.reversed ? m.n - 1 - d : d
}

export interface Codon {
  /** Display columns the codon spans, half-open (may skip deleted columns). */
  d0: number
  d1: number
  aa: string
}

/**
 * Translation of the shown bases in display order, from display column 0
 * in the given frame. Deleted columns are skipped, so a codon may span them.
 */
export function translateShown(m: TraceModel, frame: 0 | 1 | 2): Codon[] {
  const cols: number[] = []
  for (let d = 0; d < m.n; d++) if (m.kind[d] !== KIND_DELETE) cols.push(d)
  const out: Codon[] = []
  for (let i = frame; i + 3 <= cols.length; i += 3) {
    const codon = m.shown[cols[i]] + m.shown[cols[i + 1]] + m.shown[cols[i + 2]]
    out.push({ d0: cols[i], d1: cols[i + 2] + 1, aa: translateCodon(codon) })
  }
  return out
}

export type ProblemKind = 'ambiguous' | 'mixed' | 'low' | 'edited'

export interface Problem {
  d0: number
  d1: number
  kinds: ProblemKind[]
}

/**
 * Places in the kept read worth a look, in display order: ambiguous calls,
 * strong second peaks, low quality and the user's own edits. Neighbouring
 * columns merge into one stop so "next" does not crawl through a bad patch.
 */
export function findProblems(m: TraceModel, opts: { mixedRatio: number; qualityCutoff: number }): Problem[] {
  const out: Problem[] = []
  let cur: Problem | null = null
  for (let d = m.trim[0]; d < m.trim[1]; d++) {
    const kinds: ProblemKind[] = []
    const b = m.shown[d]
    if (m.kind[d] !== 0) kinds.push('edited')
    if (m.kind[d] !== KIND_DELETE && b !== 'A' && b !== 'C' && b !== 'G' && b !== 'T') kinds.push('ambiguous')
    if (m.kind[d] !== KIND_INSERT && m.secondRatio[d] >= opts.mixedRatio) kinds.push('mixed')
    if (m.quality[d] >= 0 && m.quality[d] < opts.qualityCutoff && !m.data.metadata.qualityMissing) kinds.push('low')
    if (kinds.length === 0) { cur = null; continue }
    if (cur && cur.d1 === d) {
      cur.d1 = d + 1
      for (const k of kinds) if (!cur.kinds.includes(k)) cur.kinds.push(k)
    } else {
      cur = { d0: d, d1: d + 1, kinds }
      out.push(cur)
    }
  }
  return out
}
