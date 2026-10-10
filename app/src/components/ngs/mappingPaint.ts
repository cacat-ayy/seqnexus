/**
 * Drawing a mapping: a fixed header (ruler, coverage, reference, where
 * reads were downsampled) over rows of reads, at any zoom from a whole
 * genome to single bases.
 *
 * What is drawn depends on the scale (semantic zoom):
 * - wider than the reads can be loaded: coverage only, from the stored
 *   summaries, with candidate sites ticked along its top;
 * - reads as bars in their colour mode, mismatches as ticks in their base's
 *   colour faded by base quality (from 10 bases per pixel in), insertions as
 *   marks between bases, deletions as a line through the gap;
 * - from LETTER_PX pixels per base: the reads' bases as letters (every base or
 *   only the differing ones, see BaseMode), the
 *   reference's bases, insertion lengths, deletion lengths;
 * - soft clips, when shown, as faint extensions with their bases coloured.
 *
 * Positions are 0-based reference positions; x = gutter + (p - start) / bpPerPx.
 */

import type { AlnTheme } from '../alignment/theme'
import { baseColor, tracePalette, withAlpha, type TracePalette } from '../sanger/paint'
import { paintPositionRuler, truncate } from '../tracks/draw'
import type { CoverageLevel } from '../../ngs/alignments'
import type { PileupSite } from '../../ngs/pileup'
import { variantKey, type RefFeature, type Variant } from '../../assembly/variants'
import { CODING } from '../../assembly/effects'
import { complementBase } from '../../models/complement'
import { geneticCode, translateCodonWith } from '../../codon/genetic-codes'
import {
  firstInRow, pairClass, readDiff, summaryLevel,
  type PairClass, type ReadLayout, type ViewRead, type WindowPileup,
} from '../../ngs/view'

export const MAP_GUTTER = 92
/** Pixels per base from which bases are drawn as letters (an 8 px font, the smallest that stays legible). */
export const LETTER_PX = 10
/** Mismatches are ticked from this many bases per pixel in. */
const MISMATCH_BPP = 10
const RULER_H = 20
const COV_H = 54
const REF_H = 16
const SAMPLED_H = 6
const VARS_H = 14
/** Share of reads differing from the reference for a coverage bar to be split by base (IGV's default). */
export const ALLELE_FRACTION = 0.2

export type ColorBy = 'none' | 'strand' | 'pair' | 'mapq'
export type RowMode = 'expanded' | 'squished'
/**
 * How the reads' bases are drawn once they are wide enough for letters:
 * 'off' only the bases that differ (as IGV does), 'disagree' every base with
 * the agreeing ones muted (as Geneious highlights disagreements), 'dots'
 * agreeing bases as . (forward) or , (reverse) as samtools tview does,
 * 'all' every base in its base colour.
 */
export type BaseMode = 'off' | 'disagree' | 'dots' | 'all'
/** What a read's base disagrees with: the reference, or the consensus of the reads shown. */
export type CompareTo = 'reference' | 'consensus'

export interface MapGeometry {
  gutter: number
  ruler: [number, number]
  cov: [number, number]
  /** The variant track, when variants have been called. */
  vars: [number, number] | null
  ref: [number, number]
  /** The reference's features, in lanes, when it has any. */
  feats: [number, number] | null
  /** The consensus of the loaded reads, when shown. */
  cons: [number, number] | null
  sampled: [number, number]
  headerH: number
  rowH: number
  pitch: number
}

export function mapGeometry(rowMode: RowMode, pxPerBase: number, variants = false, consensus = false, featureLanes = 0): MapGeometry {
  let y = 0
  const band = (h: number): [number, number] => { const b: [number, number] = [y, y + h]; y += h; return b }
  const ruler = band(RULER_H)
  const cov = band(COV_H)
  const vars = variants ? band(VARS_H) : null
  const feats = featureLanes > 0 ? band(featureLanes * FEATURE_LANE_H + 2) : null
  const ref = band(REF_H)
  const cons = consensus ? band(REF_H) : null
  const sampled = band(SAMPLED_H)
  y += 3
  const rowH = rowMode === 'squished' ? 3 : pxPerBase >= LETTER_PX ? 14 : 9
  return { gutter: MAP_GUTTER, ruler, cov, vars, feats, ref, cons, sampled, headerH: y, rowH, pitch: rowH + (rowMode === 'squished' ? 1 : 2) }
}

const FEATURE_LANE_H = 14
/** Most feature lanes drawn; features that do not fit share the last. */
const MAX_FEATURE_LANES = 4

/** A stretch of a feature in one lane; a feature across the origin of a circular reference is two. */
export interface LaidFeature {
  f: RefFeature
  start: number
  end: number
  lane: number
}

/** Features packed into lanes so overlapping ones do not cover each other. */
export function layFeatures(features: readonly RefFeature[], L: number): { laid: LaidFeature[]; lanes: number } {
  const parts: Omit<LaidFeature, 'lane'>[] = []
  for (const f of features) {
    if (f.type === 'source') continue
    if (f.end > f.start && f.end <= L) parts.push({ f, start: f.start, end: f.end })
    else {
      // Across the origin: from start to the end of the reference, then from 0.
      parts.push({ f, start: f.start, end: L })
      const tail = f.end > L ? f.end - L : f.end
      if (tail > 0) parts.push({ f, start: 0, end: tail })
    }
  }
  parts.sort((a, b) => a.start - b.start || b.end - a.end)
  const ends: number[] = []
  const laid = parts.map(p => {
    let lane = ends.findIndex(e => e <= p.start)
    if (lane < 0) lane = ends.length < MAX_FEATURE_LANES ? ends.length : MAX_FEATURE_LANES - 1
    ends[lane] = Math.max(ends[lane] ?? 0, p.end)
    return { ...p, lane }
  })
  return { laid, lanes: ends.length }
}

export interface MapScale {
  /** Reference position at the left edge of the reads. */
  start: number
  bpPerPx: number
}

export interface MapOptions {
  colorBy: ColorBy
  softClips: boolean
  strands: boolean
  /** Shade where depth is below this; 0 for off. */
  lowCoverage: number
  /** Fragment lengths to show; pairs outside are faded. */
  brush: readonly [number, number] | null
  /** Fragment lengths expected (from the report), for colouring by pair. */
  expected: readonly [number, number] | null
  /** How bases are drawn at letter zoom; 'off' when left out. */
  bases?: BaseMode
  compareTo?: CompareTo
  /** Shade every drawn base by its quality, not only the differing ones. */
  baseQuality?: boolean
}

export interface MapPaintInput {
  geo: MapGeometry
  refIndex: number
  refName: string
  length: number
  circular: boolean
  bases: string | null
  coverage: Uint32Array | null
  levels: readonly CoverageLevel[] | null
  sites: readonly PileupSite[] | null
  pileup: WindowPileup | null
  layout: ReadLayout | null
  opts: MapOptions
  /** Variants that pass the filters, in order of position; null when none have been called. */
  variants: readonly Variant[] | null
  /** Key of the variant picked in the table (variantKey). */
  selectedVariant: string | null
  /** The reference's features in lanes (layFeatures), when its sequence is open. */
  features?: readonly LaidFeature[]
}

export interface MapState {
  scale: MapScale
  scrollY: number
  w: number
  h: number
}

/** Most pixels a base is drawn at. */
export const MAX_PX_PER_BASE = 24

/** Keep the scale within the reference: no further out than the whole of it, no further in than MAX_PX_PER_BASE. */
export function clampScale(s: MapScale, length: number, plotW: number): MapScale {
  const w = Math.max(1, plotW)
  const minBpp = 1 / MAX_PX_PER_BASE
  const maxBpp = Math.max(minBpp, length / w)
  const bpPerPx = Math.max(minBpp, Math.min(maxBpp, s.bpPerPx))
  const span = w * bpPerPx
  const start = Math.max(0, Math.min(Math.max(0, length - span), s.start))
  return { start, bpPerPx }
}

export const xOf = (p: number, g: MapGeometry, s: MapScale) => g.gutter + (p - s.start) / s.bpPerPx

/** Visible reference positions [v0, v1). */
export function visibleRange(st: MapState, g: MapGeometry, length: number): [number, number] {
  const v0 = Math.max(0, st.scale.start)
  const v1 = Math.min(length, st.scale.start + Math.max(0, st.w - g.gutter) * st.scale.bpPerPx)
  return [v0, v1]
}

export function visibleRows(g: MapGeometry, st: MapState, count: number): [number, number] {
  const r0 = Math.max(0, Math.floor(st.scrollY / g.pitch))
  const r1 = Math.min(count, Math.ceil((st.scrollY + st.h - g.headerH) / g.pitch) + 1)
  return [r0, r1]
}

export const rowTop = (i: number, g: MapGeometry, st: MapState) => g.headerH + i * g.pitch - st.scrollY

// ---------------------------------------------------------------------------
// Coverage per pixel column
// ---------------------------------------------------------------------------

export interface DepthOver {
  mean: number
  max: number
  /** Share of the depth on the forward strand, or -1 when not known. */
  forward: number
}

/** Depth over [b0, b1) from the best source at hand: the loaded reads, per-base coverage, or a summary level. */
export function depthOver(p: Pick<MapPaintInput, 'coverage' | 'levels' | 'pileup'>, b0: number, b1: number, bpPerPx: number): DepthOver {
  const lo = Math.floor(b0)
  const hi = Math.max(lo + 1, Math.ceil(b1))
  const pu = p.pileup
  if (pu && lo >= pu.from && hi <= pu.to) {
    let t = 0
    let f = 0
    let m = 0
    for (let q = lo; q < hi; q++) { const d = pu.depth[q - pu.from]; t += d; f += pu.forward[q - pu.from]; if (d > m) m = d }
    return { mean: t / (hi - lo), max: m, forward: t ? f / t : -1 }
  }
  const lv = p.levels && bpPerPx > 256 ? summaryLevel(p.levels, bpPerPx) : null
  const fine = p.levels?.[0]
  const fwdShare = (a: number, b: number) => {
    if (!fine) return -1
    let t = 0
    let f = 0
    for (let k = Math.floor(a / fine.binSize); k < Math.min(fine.mean.length, Math.ceil(b / fine.binSize)); k++) { t += fine.mean[k]; f += fine.forward[k] }
    return t ? f / t : -1
  }
  if (!lv && p.coverage) {
    const c = p.coverage
    let t = 0
    let m = 0
    const e = Math.min(hi, c.length)
    for (let q = lo; q < e; q++) { const d = c[q]; t += d; if (d > m) m = d }
    return { mean: e > lo ? t / (e - lo) : 0, max: m, forward: fwdShare(lo, hi) }
  }
  const l = lv ?? fine
  if (!l) return { mean: 0, max: 0, forward: -1 }
  const k0 = Math.floor(lo / l.binSize)
  const k1 = Math.min(l.mean.length, Math.max(k0 + 1, Math.ceil(hi / l.binSize)))
  let t = 0
  let f = 0
  let m = 0
  for (let k = k0; k < k1; k++) { t += l.mean[k]; f += l.forward[k]; if (l.max[k] > m) m = l.max[k] }
  const n = Math.max(1, k1 - k0)
  return { mean: t / n, max: m, forward: t ? f / t : -1 }
}

/** A round number at or above `v`, for the coverage scale. */
export function niceMax(v: number): number {
  if (v <= 1) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow
  return 10 * pow
}

interface Column { x: number; w: number; d: DepthOver; p0: number; p1: number }

/** One column per base when bases are at least a pixel wide, else one per pixel. */
export function coverageColumns(p: MapPaintInput, st: MapState): Column[] {
  const g = p.geo
  const s = st.scale
  const [v0, v1] = visibleRange(st, g, p.length)
  const out: Column[] = []
  if (v1 <= v0) return out
  if (s.bpPerPx <= 1) {
    for (let q = Math.floor(v0); q < Math.ceil(v1); q++) {
      out.push({ x: xOf(q, g, s), w: 1 / s.bpPerPx, d: depthOver(p, q, q + 1, s.bpPerPx), p0: q, p1: q + 1 })
    }
  } else {
    const x0 = Math.floor(xOf(v0, g, s))
    const x1 = Math.ceil(xOf(v1, g, s))
    for (let x = x0; x < x1; x++) {
      const b0 = Math.max(v0, s.start + (x - g.gutter) * s.bpPerPx)
      const b1 = Math.min(v1, b0 + s.bpPerPx)
      if (b1 <= b0) continue
      out.push({ x, w: 1, d: depthOver(p, b0, b1, s.bpPerPx), p0: b0, p1: b1 })
    }
  }
  return out
}

/** Stretches [x, x + w) where the depth is below `min`, merged. */
function lowSpans(cols: readonly Column[], min: number): [number, number][] {
  const out: [number, number][] = []
  for (const c of cols) {
    if (c.d.mean >= min) continue
    const last = out[out.length - 1]
    if (last && c.x <= last[1] + 0.5) last[1] = c.x + c.w
    else out.push([c.x, c.x + c.w])
  }
  return out
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export interface ReadColors {
  neutral: string
  forward: string
  reverse: string
  pair: Record<PairClass, string>
  mapq: Record<MapqClass, string>
  deletion: string
  insertion: string
  clip: string
}

export function readColors(theme: AlnTheme): ReadColors {
  const a = theme.dark ? 0.5 : 0.42
  const neutral = withAlpha(theme.muted, theme.dark ? 0.5 : 0.38)
  return {
    neutral,
    forward: withAlpha(theme.good, a),
    reverse: withAlpha(theme.warning, a),
    pair: {
      single: neutral,
      proper: neutral,
      larger: withAlpha(theme.danger, 0.6),
      smaller: withAlpha(theme.accent, 0.6),
      orientation: withAlpha(theme.good, 0.65),
      otherRef: withAlpha(theme.warning, 0.65),
      mateUnmapped: neutral,
    },
    mapq: {
      zero: withAlpha(theme.danger, 0.6),
      low: withAlpha(theme.warning, 0.6),
      high: withAlpha(theme.good, a),
      none: neutral,
    },
    deletion: withAlpha(theme.text, 0.75),
    insertion: theme.accent,
    clip: withAlpha(theme.muted, 0.16),
  }
}

/**
 * Mapping quality in bands. MAPQ is -10 log10 of the chance the read
 * belongs elsewhere: 0 means another place fits as well (a repeat), below
 * 20 a 1% chance or more of the wrong place, 255 that the aligner gave none.
 */
export type MapqClass = 'zero' | 'low' | 'high' | 'none'

export function mapqClass(mapq: number): MapqClass {
  return mapq === 255 ? 'none' : mapq === 0 ? 'zero' : mapq < 20 ? 'low' : 'high'
}

export const MAPQ_LABEL: Record<MapqClass, string> = {
  high: 'Mapping quality 20 and up',
  low: 'Mapping quality 1 to 19',
  zero: 'Mapping quality 0: fits elsewhere as well',
  none: 'No mapping quality given',
}

export const PAIR_LABEL: Record<PairClass, string> = {
  single: 'Not paired',
  proper: 'Pair as expected',
  larger: 'Mates further apart than expected',
  smaller: 'Mates closer than expected',
  orientation: 'Mates in an unexpected orientation',
  otherRef: 'Mate on another reference',
  mateUnmapped: 'Mate not mapped',
}

/** Base-quality shading of mismatches, as IGV does: faint at Q5 and below, full from Q20. */
export function qualityAlpha(q: number): number {
  if (q < 0) return 1
  return Math.max(0.15, Math.min(1, (q - 5) / 15))
}

/** Consensus codes per position from `from`: a base's char code, 45 (-) for a deletion, 0 where no read is loaded. */
export interface WindowConsensus {
  from: number
  codes: Uint8Array
  /** 1 after a base where most of the reads covering it carry an insertion. */
  insertAfter: Uint8Array
}

const CONS_CODES = [65, 67, 71, 84, 45]

/**
 * The majority of the loaded reads at each position of [from, to): A, C, G,
 * T or a deletion, the reference's base winning a tie, and where most of the
 * reads covering a base insert bases after it. Every loaded read
 * counts, as in the coverage track, so it is the consensus of what is drawn
 * (before downsampling), not the called consensus, which applies the
 * quality and depth thresholds of the variant settings.
 */
export function windowConsensus(pu: WindowPileup, bases: string | null, from: number, to: number): WindowConsensus | null {
  const lo = Math.max(from, pu.from)
  const hi = Math.min(to, pu.to)
  if (hi <= lo) return null
  const codes = new Uint8Array(hi - lo)
  const insertAfter = new Uint8Array(hi - lo)
  const L = bases?.length ?? 0
  for (let q = lo; q < hi; q++) {
    const k = (q - pu.from) * 6
    const refCode = L ? bases!.charCodeAt(q % L) & 0xdf : 0
    let best = -1
    let n = 0
    for (let a = 0; a < 5; a++) {
      const c = pu.counts[k + a]
      if (c > n || (c === n && c > 0 && CONS_CODES[a] === refCode)) { n = c; best = a }
    }
    codes[q - lo] = best < 0 ? 0 : CONS_CODES[best]
    const covering = pu.counts[k] + pu.counts[k + 1] + pu.counts[k + 2] + pu.counts[k + 3] + pu.counts[k + 4]
    if (covering > 0 && pu.counts[k + 5] * 2 > covering) insertAfter[q - lo] = 1
  }
  return { from: lo, codes, insertAfter }
}

function consAt(c: WindowConsensus | null, pos: number): number {
  if (!c) return 0
  const k = pos - c.from
  return k >= 0 && k < c.codes.length ? c.codes[k] : 0
}

export function inBrush(r: ViewRead, p: Pick<MapPaintInput, 'refIndex' | 'length' | 'circular' | 'opts'>): boolean {
  const b = p.opts.brush
  if (!b) return true
  const a = r.a
  if (!(a.flag & 0x1) || a.flag & 0x8 || a.mateRef !== p.refIndex) return false
  let t = Math.abs(a.tlen)
  if (p.circular && t > p.length / 2) t = p.length - (t % p.length)
  return t >= b[0] && t <= b[1]
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export function paintMapping(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState): void {
  const g = p.geo
  const s = st.scale
  const pal = tracePalette(theme)
  const colors = readColors(theme)
  const pxPerBase = 1 / s.bpPerPx
  const [v0, v1] = visibleRange(st, g, p.length)
  const plotR = Math.min(st.w, xOf(p.length, g, s))
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, st.w, st.h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const cols = coverageColumns(p, st)
  let top = 0
  for (const c of cols) if (c.d.max > top) top = c.d.max
  top = niceMax(top)
  const low = p.opts.lowCoverage > 0 ? lowSpans(cols, p.opts.lowCoverage) : []
  const wantCons = g.cons !== null || (p.opts.compareTo === 'consensus' && (p.opts.bases ?? 'off') !== 'off')
  const cons = wantCons && p.pileup && s.bpPerPx <= MISMATCH_BPP
    ? windowConsensus(p.pileup, p.bases, Math.floor(v0), Math.ceil(v1)) : null

  // ---- Reads ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.gutter, g.headerH, st.w - g.gutter, st.h - g.headerH)
  ctx.clip()
  if (low.length) {
    ctx.fillStyle = withAlpha(theme.warning, theme.dark ? 0.12 : 0.08)
    for (const [a, b] of low) ctx.fillRect(a, g.headerH, b - a, st.h - g.headerH)
  }
  // Past the end of the reference.
  if (plotR < st.w) {
    ctx.fillStyle = withAlpha(theme.muted, 0.08)
    ctx.fillRect(plotR, 0, st.w - plotR, st.h)
  }
  if (p.layout) {
    const [r0, r1] = visibleRows(g, st, p.layout.rows.length)
    for (let i = r0; i < r1; i++) {
      const row = p.layout.rows[i]
      const y = rowTop(i, g, st)
      for (let k = firstInRow(row, v0); k < row.length && row[k].x0 < v1; k++) paintRead(ctx, row[k], y, p, st, theme, pal, colors, cons, v0, v1)
    }
  }
  ctx.restore()

  // ---- Header ----
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, st.w, g.headerH)
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.gutter, 0, st.w - g.gutter, g.headerH)
  ctx.clip()
  paintPositionRuler(ctx, theme, {
    y0: g.ruler[0], y1: g.ruler[1], x0: g.gutter, x1: st.w, pxPerBase,
    xOf: q => xOf(q, g, s), first: Math.floor(v0), last: Math.ceil(v1),
  })
  if (p.circular && v1 >= p.length - 1) {
    // The origin of a circular reference.
    ctx.fillStyle = theme.accent
    ctx.fillRect(Math.round(xOf(p.length, g, s)) - 1, g.ruler[0], 2, g.ref[1] - g.ruler[0])
  }
  paintCoverage(ctx, p, theme, st, cols, top, low, pal)
  paintReference(ctx, p, theme, st, pal)
  paintConsensus(ctx, p, theme, st, pal, cons)
  paintFeatures(ctx, p, theme, st)
  paintVariants(ctx, p, theme, st, pal)
  if (p.layout?.sampled.length) {
    ctx.fillStyle = theme.text
    ctx.globalAlpha = 0.65
    const [y0, y1] = g.sampled
    for (const [a, b] of p.layout.sampled) {
      if (b <= v0 || a >= v1) continue
      const x = xOf(a, g, s)
      ctx.fillRect(x, y0 + 1, Math.max(1, xOf(b, g, s) - x - (pxPerBase * (b - a) > 4 ? 1 : 0)), y1 - y0 - 2)
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, g.headerH - 1, st.w, 1)

  // ---- Gutter ----
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, g.gutter, st.h)
  ctx.fillStyle = theme.grid
  ctx.fillRect(g.gutter - 1, 0, 1, st.h)
  ctx.textAlign = 'left'
  ctx.fillStyle = theme.muted
  ctx.font = `600 11px ${theme.sans}`
  ctx.fillText('Coverage', 8, g.cov[0] + 10)
  ctx.font = `500 10px ${theme.sans}`
  ctx.fillText(`0 to ${top.toLocaleString()}×`, 8, g.cov[0] + 24)
  if (p.opts.lowCoverage > 0) {
    ctx.fillStyle = theme.warning
    ctx.fillText(truncate(ctx, `below ${p.opts.lowCoverage.toLocaleString()}×`, g.gutter - 14), 8, g.cov[0] + 37)
  }
  ctx.fillStyle = theme.muted
  ctx.font = `600 11px ${theme.sans}`
  ctx.fillText(truncate(ctx, p.refName, g.gutter - 14), 8, (g.ref[0] + g.ref[1]) / 2 + 0.5)
  ctx.font = `500 10px ${theme.sans}`
  if (g.cons) ctx.fillText('Consensus', 8, (g.cons[0] + g.cons[1]) / 2 + 0.5)
  if (g.feats) ctx.fillText('Features', 8, g.feats[0] + FEATURE_LANE_H / 2 + 1)
  if (g.vars) {
    ctx.font = `500 10px ${theme.sans}`
    ctx.fillText(`Variants (${(p.variants?.length ?? 0).toLocaleString()})`, 8, (g.vars[0] + g.vars[1]) / 2 + 0.5)
  }
  if (p.layout?.sampled.length) {
    ctx.font = `500 10px ${theme.sans}`
    ctx.fillText('Downsampled', 8, (g.sampled[0] + g.sampled[1]) / 2 + 0.5)
  }
  ctx.textAlign = 'center'
}

function paintCoverage(
  ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState,
  cols: readonly Column[], top: number, low: readonly [number, number][], pal: TracePalette,
) {
  const g = p.geo
  const [y0, y1] = g.cov
  const h = y1 - y0 - 6
  const base = y1 - 2
  const yOf = (v: number) => base - (v / top) * h
  if (low.length) {
    ctx.fillStyle = withAlpha(theme.warning, theme.dark ? 0.14 : 0.1)
    for (const [a, b] of low) ctx.fillRect(a, y0, b - a, y1 - y0)
  }
  const gap = cols.length && cols[0].w > 3 ? 1 : 0
  const neutral = withAlpha(theme.muted, theme.dark ? 0.6 : 0.5)
  const peak = withAlpha(theme.muted, 0.18)
  const fwd = withAlpha(theme.good, 0.6)
  const rev = withAlpha(theme.warning, 0.6)
  const pu = p.pileup
  for (const c of cols) {
    const d = c.d
    if (d.max <= 0) continue
    const w = Math.max(1, c.w - gap)
    // The highest depth in the column, faintly, behind the mean.
    if (c.w <= 1 && d.max > d.mean) {
      ctx.fillStyle = peak
      ctx.fillRect(c.x, yOf(d.max), w, base - yOf(d.max))
    }
    const yt = yOf(d.mean)
    // Split by base where enough reads differ from the reference (one column per base only).
    if (pu && c.p1 - c.p0 === 1 && c.p0 >= pu.from && c.p0 < pu.to && p.bases) {
      const k = (c.p0 - pu.from) * 6
      const refB = p.bases.charCodeAt(c.p0)
      const tot = pu.counts[k] + pu.counts[k + 1] + pu.counts[k + 2] + pu.counts[k + 3] + pu.counts[k + 4]
      let alt = pu.counts[k + 4]
      for (let al = 0; al < 4; al++) if ('ACGT'.charCodeAt(al) !== refB) alt += pu.counts[k + al]
      if (tot > 0 && alt / tot >= ALLELE_FRACTION) {
        let y = base
        for (let al = 0; al < 5; al++) {
          const n = pu.counts[k + al]
          if (!n) continue
          const hh = (n / top) * h
          ctx.fillStyle = al < 4 ? baseColor(pal, 'ACGT'[al]) : theme.muted
          ctx.fillRect(c.x, y - hh, w, hh)
          y -= hh
        }
        continue
      }
    }
    if (p.opts.strands && d.forward >= 0) {
      const hf = (base - yt) * d.forward
      ctx.fillStyle = fwd
      ctx.fillRect(c.x, base - hf, w, hf)
      ctx.fillStyle = rev
      ctx.fillRect(c.x, yt, w, base - hf - yt)
    } else {
      ctx.fillStyle = neutral
      ctx.fillRect(c.x, yt, w, base - yt)
    }
  }
  if (p.opts.lowCoverage > 0 && p.opts.lowCoverage <= top) {
    const y = Math.round(yOf(p.opts.lowCoverage)) + 0.5
    ctx.strokeStyle = theme.warning
    ctx.setLineDash([3, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(g.gutter, y)
    ctx.lineTo(st.w, y)
    ctx.stroke()
    ctx.setLineDash([])
  }
  // Candidate sites along the top when the reads are not loaded (or bases are narrower than a pixel).
  if (p.sites && (!pu || st.scale.bpPerPx > 1)) {
    const [v0, v1] = visibleRange(st, g, p.length)
    ctx.fillStyle = theme.warning
    let lastX = -2
    for (const site of p.sites) {
      if (site.pos < v0) continue
      if (site.pos >= v1) break
      const c = site.counts
      let refN = 0
      const refB = p.bases ? 'ACGT'.indexOf(p.bases[site.pos]) : -1
      if (refB >= 0) refN = c[refB * 2] + c[refB * 2 + 1]
      const all = site.depth
      if (!all || (all - refN) / all < ALLELE_FRACTION) continue
      const x = Math.floor(xOf(site.pos, g, st.scale))
      if (x === lastX) continue
      lastX = x
      ctx.fillRect(x, y0 + 1, Math.max(1.5, 1 / st.scale.bpPerPx), 4)
    }
  }
}

/** Index of the first variant ending after `pos` (variants are in order of position). */
export function firstVariant(vs: readonly Variant[], pos: number): number {
  let lo = 0
  let hi = vs.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (vs[m].c1 <= pos) lo = m + 1
    else hi = m
  }
  return lo
}

/** The variant drawn under x (within a few pixels), for hovering the variant track. */
export function variantAt(vs: readonly Variant[], pos: number, bpPerPx: number): Variant | null {
  const slop = Math.max(0.5, 3 * bpPerPx)
  let best: Variant | null = null
  let bestD = Infinity
  for (let k = firstVariant(vs, pos - slop); k < vs.length && vs[k].c0 <= pos + slop; k++) {
    const v = vs[k]
    const d = pos < v.c0 ? v.c0 - pos : pos >= v.c1 ? pos - v.c1 + 1 : 0
    if (d < bestD) { best = v; bestD = d }
  }
  return best && bestD <= slop ? best : null
}

/** Variants as marks: a SNP in its new base's colour, an insertion in the insertion colour, a deletion as a bar over what it removes. */
function paintVariants(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState, pal: TracePalette) {
  const g = p.geo
  if (!g.vars || !p.variants) return
  const s = st.scale
  const [y0, y1] = g.vars
  const [v0, v1] = visibleRange(st, g, p.length)
  ctx.fillStyle = withAlpha(theme.muted, 0.08)
  ctx.fillRect(g.gutter, y0 + 1, st.w - g.gutter, y1 - y0 - 2)
  const vs = p.variants
  let lastX = -10
  let selected: Variant | null = null
  for (let k = firstVariant(vs, v0); k < vs.length && vs[k].c0 < v1; k++) {
    const v = vs[k]
    let x = xOf(v.type === 'Insertion' ? v.c1 : v.c0, g, s)
    let w = Math.max(3, (v.type === 'Insertion' ? 0 : v.c1 - v.c0) / s.bpPerPx)
    if (v.type === 'Insertion') x -= 1.5
    // Many variants in one pixel column: drawn once.
    if (w <= 3 && Math.round(x) === lastX) continue
    lastX = Math.round(x)
    if (w < 3) { x -= (3 - w) / 2; w = 3 }
    ctx.fillStyle = v.type === 'SNP' ? baseColor(pal, v.alt) : v.type === 'Insertion' ? theme.accent : theme.text
    ctx.globalAlpha = 0.35 + 0.65 * Math.min(1, v.frequency * 1.5)
    ctx.fillRect(x, y0 + 2, w, y1 - y0 - 4)
    ctx.globalAlpha = 1
    if (p.selectedVariant && variantKey(v) === p.selectedVariant) selected = v
  }
  if (selected) {
    const x0 = xOf(selected.c0, g, s)
    const x1 = Math.max(x0 + 3, xOf(selected.c1, g, s))
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1.5
    ctx.strokeRect(x0 - 2, y0 + 0.75, x1 - x0 + 4, y1 - y0 - 1.5)
    // And through the reads below it.
    ctx.fillStyle = withAlpha(theme.accent, 0.1)
    ctx.fillRect(x0, g.ref[0], x1 - x0, st.h - g.ref[0])
  }
}

function paintReference(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState, pal: TracePalette) {
  const g = p.geo
  const s = st.scale
  const [y0, y1] = g.ref
  const pxPerBase = 1 / s.bpPerPx
  const [v0, v1] = visibleRange(st, g, p.length)
  if (!p.bases || pxPerBase < 1.5) {
    ctx.fillStyle = withAlpha(theme.text, 0.25)
    const x0 = xOf(v0, g, s)
    ctx.fillRect(x0, (y0 + y1) / 2 - 1, xOf(v1, g, s) - x0, 2)
    return
  }
  const letters = pxPerBase >= LETTER_PX
  ctx.font = `600 ${Math.min(13, Math.floor(pxPerBase * 0.85))}px ${theme.mono}`
  for (let q = Math.floor(v0); q < Math.ceil(v1); q++) {
    const ch = p.bases[q]
    const x = xOf(q, g, s)
    if (letters) {
      ctx.fillStyle = baseColor(pal, ch)
      ctx.fillText(ch, x + pxPerBase / 2, (y0 + y1) / 2 + 0.5)
    } else {
      ctx.fillStyle = baseColor(pal, ch)
      ctx.globalAlpha = 0.8
      ctx.fillRect(x, y0 + 4, Math.max(1, pxPerBase - (pxPerBase > 3 ? 1 : 0)), y1 - y0 - 8)
      ctx.globalAlpha = 1
    }
  }
}

/**
 * The reference's features as bars in their own colour (data colours, kept
 * as the user chose them), with their names where they fit. Close in, a
 * coding feature shows its translation instead: each amino acid centred on
 * its codon, in the reading frame of the feature's start (or end, on the
 * reverse strand) and its /codon_start, with the genetic code its
 * /transl_table names (the standard code when it names none).
 */
function paintFeatures(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState) {
  const g = p.geo
  if (!g.feats || !p.features?.length) return
  const s = st.scale
  const [v0, v1] = visibleRange(st, g, p.length)
  const pxPerBase = 1 / s.bpPerPx
  const L = p.bases?.length ?? 0
  const at = (i: number) => p.bases![((i % L) + L) % L]
  for (const lf of p.features) {
    if (lf.end <= v0 || lf.start >= v1) continue
    const f = lf.f
    const y = g.feats[0] + 1 + lf.lane * FEATURE_LANE_H
    const h = FEATURE_LANE_H - 3
    const x0 = Math.max(g.gutter, xOf(lf.start, g, s))
    const x1 = Math.min(st.w, xOf(lf.end, g, s))
    const color = f.color ?? theme.accent
    ctx.globalAlpha = 0.35
    ctx.fillStyle = color
    ctx.fillRect(x0, y, Math.max(1, x1 - x0), h)
    ctx.globalAlpha = 1
    ctx.fillRect(x0, y + h - 2, Math.max(1, x1 - x0), 2)
    const codons = CODING.has(f.type) && f.strand !== 0 && L > 0 && pxPerBase * 3 >= 9
    if (codons) {
      ctx.font = `600 ${Math.min(12, Math.floor(pxPerBase * 3 * 0.6))}px ${theme.mono}`
      ctx.fillStyle = theme.text
      // Codon k covers [c, c + 3), c counted in the feature's unwrapped coordinates
      // (f.start to fEnd); the stretch after the origin of a wrapped feature is drawn L to the left.
      const fEnd = f.end > f.start ? f.end : f.end + L
      // Codons start /codon_start - 1 bases into the feature on its own strand.
      const first = f.strand === 1 ? f.start + (f.frame ?? 0) : fEnd - (f.frame ?? 0) - 3
      const code = geneticCode(f.code ?? 1)
      const n = Math.floor((fEnd - f.start - (f.frame ?? 0)) / 3)
      const o = lf.start < f.start ? L : 0
      const lo = Math.max(v0, lf.start) + o - 3
      const hi = Math.min(v1, lf.end) + o
      const k0 = Math.max(0, f.strand === 1 ? Math.ceil((lo - first) / 3) : Math.ceil((first - hi) / 3))
      const k1 = Math.min(n - 1, f.strand === 1 ? Math.floor((hi - first) / 3) : Math.floor((first - lo) / 3))
      for (let k = k0; k <= k1; k++) {
        const c = f.strand === 1 ? first + k * 3 : first - k * 3
        const codon = f.strand === 1 ? at(c) + at(c + 1) + at(c + 2) : complementBase(at(c + 2)) + complementBase(at(c + 1)) + complementBase(at(c))
        ctx.fillText(translateCodonWith(code, codon), xOf(c - o + 1.5, g, s), y + h / 2)
      }
    } else if (x1 - x0 > 30) {
      ctx.font = `600 10px ${theme.sans}`
      ctx.fillStyle = theme.text
      ctx.textAlign = 'left'
      ctx.fillText(truncate(ctx, f.name || f.type, x1 - x0 - 8), x0 + 4, y + h / 2)
      ctx.textAlign = 'center'
    }
  }
}

/** The consensus row: letters close in, each base that differs from the reference on a warning tint; further out only those, as ticks. */
function paintConsensus(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState, pal: TracePalette, cons: WindowConsensus | null) {
  const g = p.geo
  if (!g.cons || !cons) return
  const s = st.scale
  const [y0, y1] = g.cons
  const pxPerBase = 1 / s.bpPerPx
  const letters = pxPerBase >= LETTER_PX
  const L = p.bases?.length ?? 0
  ctx.font = `600 ${Math.min(13, Math.floor(pxPerBase * 0.85))}px ${theme.mono}`
  const w = Math.max(1, pxPerBase - (pxPerBase > 3 ? 1 : 0))
  for (let k = 0; k < cons.codes.length; k++) {
    const c = cons.codes[k]
    if (!c) continue
    const q = cons.from + k
    const differs = L > 0 && c !== (p.bases!.charCodeAt(q % L) & 0xdf)
    const x = xOf(q, g, s)
    const ch = String.fromCharCode(c)
    if (differs) {
      ctx.fillStyle = withAlpha(theme.warning, letters ? 0.3 : 0.9)
      ctx.fillRect(x, y0 + 2, w, y1 - y0 - 4)
    }
    if (letters) {
      ctx.fillStyle = c === 45 ? theme.muted : baseColor(pal, ch)
      ctx.fillText(ch, x + pxPerBase / 2, (y0 + y1) / 2 + 0.5)
    }
  }
  // Insertions most reads carry, as the reads mark theirs: a bar between the bases.
  ctx.fillStyle = theme.accent
  for (let k = 0; k < cons.insertAfter.length; k++) {
    if (!cons.insertAfter[k]) continue
    const x = Math.round(xOf(cons.from + k + 1, g, s))
    ctx.fillRect(x - 1, y0 + 1, 2, y1 - y0 - 2)
    if (pxPerBase >= 4) {
      ctx.fillRect(x - 3, y0 + 1, 6, 1.5)
      ctx.fillRect(x - 3, y1 - 2.5, 6, 1.5)
    }
  }
}

export function readFill(r: ViewRead, p: Pick<MapPaintInput, 'refIndex' | 'length' | 'circular' | 'opts'>, colors: ReadColors): string {
  const a = r.a
  switch (p.opts.colorBy) {
    case 'strand': return a.flag & 0x10 ? colors.reverse : colors.forward
    case 'pair': return colors.pair[pairClass(a, p.refIndex, p.length, p.circular, p.opts.expected)]
    case 'mapq': return colors.mapq[mapqClass(a.mapq)]
    default: return colors.neutral
  }
}

function paintRead(
  ctx: CanvasRenderingContext2D, r: ViewRead, y: number, p: MapPaintInput, st: MapState,
  theme: AlnTheme, pal: TracePalette, colors: ReadColors, cons: WindowConsensus | null, v0: number, v1: number,
) {
  const g = p.geo
  const s = st.scale
  const a = r.a
  const pxPerBase = 1 / s.bpPerPx
  const rowH = g.rowH
  const letters = pxPerBase >= LETTER_PX && rowH >= 12
  const xs = xOf(r.start, g, s)
  const xe = xOf(r.end, g, s)
  // Reads of mapping quality 0 are drawn faint, unless colour already says so.
  let alpha = a.mapq === 0 && p.opts.colorBy !== 'mapq' ? 0.4 : 1
  if (!inBrush(r, p)) alpha *= 0.15
  ctx.globalAlpha = alpha

  // Soft clips: a faint extension, bases coloured when they can be told apart.
  if (p.opts.softClips && (a.clipL || a.clipR)) {
    ctx.fillStyle = colors.clip
    if (a.clipL) ctx.fillRect(xOf(r.x0, g, s), y, xs - xOf(r.x0, g, s), rowH)
    if (a.clipR) ctx.fillRect(xe, y, xOf(r.x1, g, s) - xe, rowH)
    if (s.bpPerPx <= MISMATCH_BPP) {
      const w = Math.max(1, pxPerBase - (pxPerBase > 3 ? 1 : 0))
      ctx.globalAlpha = alpha * 0.55
      for (let k = 0; k < a.clipL.length; k++) {
        ctx.fillStyle = baseColor(pal, a.clipL[k])
        ctx.fillRect(xOf(r.start - a.clipL.length + k, g, s), y + 1, w, rowH - 2)
      }
      for (let k = 0; k < a.clipR.length; k++) {
        ctx.fillStyle = baseColor(pal, a.clipR[k])
        ctx.fillRect(xOf(r.end + k, g, s), y + 1, w, rowH - 2)
      }
      ctx.globalAlpha = alpha
    }
  }

  ctx.fillStyle = readFill(r, p, colors)
  ctx.fillRect(xs, y, Math.max(1, xe - xs), rowH)
  if (p.opts.colorBy === 'pair' && a.flag & 0x1 && a.flag & 0x8 && rowH >= 6) {
    // Mate not mapped: outlined.
    ctx.strokeStyle = theme.muted
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(xs) + 0.5, y + 0.5, Math.max(1, xe - xs - 1), rowH - 1)
  }
  // Strand: a point at the read's 3' end.
  if (rowH >= 6 && xe - xs > 6) {
    const tip = Math.min(4, rowH / 2)
    ctx.beginPath()
    if (a.flag & 0x10) { ctx.moveTo(xs, y); ctx.lineTo(xs - tip, y + rowH / 2); ctx.lineTo(xs, y + rowH) } else { ctx.moveTo(xe, y); ctx.lineTo(xe + tip, y + rowH / 2); ctx.lineTo(xe, y + rowH) }
    ctx.closePath()
    ctx.fill()
  }
  if (a.diff === '*') { ctx.globalAlpha = 1; return }
  const d = r.diff ?? (r.diff = readDiff(a))
  const sh = r.shift

  for (const k of d.skips) {
    const x = xOf(k.pos + sh, g, s)
    const w = k.len * pxPerBase
    ctx.fillStyle = theme.bg
    ctx.fillRect(x, y, w, rowH)
    ctx.fillStyle = theme.muted
    ctx.fillRect(x, y + rowH / 2 - 0.5, w, 1)
  }
  for (const k of d.deletions) {
    const x = xOf(k.pos + sh, g, s)
    const w = k.len * pxPerBase
    if (w < 0.5) continue
    ctx.fillStyle = theme.bg
    ctx.globalAlpha = 1
    ctx.fillRect(x, y, w, rowH)
    ctx.globalAlpha = alpha
    ctx.fillStyle = colors.deletion
    ctx.fillRect(x, y + Math.floor(rowH / 2), w, 1)
    if (letters && w >= 22 && k.len > 1) {
      const label = String(k.len)
      ctx.font = `600 10px ${theme.sans}`
      const tw = ctx.measureText(label).width + 6
      if (tw < w - 4) {
        ctx.fillStyle = theme.bg
        ctx.fillRect(x + w / 2 - tw / 2, y + 1, tw, rowH - 2)
        ctx.fillStyle = theme.text
        ctx.fillText(label, x + w / 2, y + rowH / 2 + 0.5)
      }
    }
  }
  const mode = p.opts.bases ?? 'off'
  const full = letters && mode !== 'off'
  const cells = mode === 'all' && pxPerBase >= 2
  if ((full || cells) && s.bpPerPx <= MISMATCH_BPP) {
    // Every base: those matching the reference come from it, the rest from the differences.
    const w = Math.max(1, pxPerBase - (pxPerBase > 3 ? 1 : 0))
    const byCons = p.opts.compareTo === 'consensus' && cons !== null
    const allQ = p.opts.baseQuality ?? false
    const fwd = (a.flag & 0x10) === 0
    const q = a.qual
    const muted = withAlpha(theme.text, 0.5)
    // Dots are small glyphs: drawn stronger than muted letters to be seen at all.
    const dot = withAlpha(theme.text, 0.85)
    if (letters) ctx.font = `700 ${Math.min(13, Math.floor(pxPerBase * 0.85))}px ${theme.mono}`
    const drawBase = (pos: number, ch: string, qual: number, differs: boolean) => {
      const x = xOf(pos, g, s)
      const qa = alpha * (allQ || differs ? qualityAlpha(qual) : 1)
      if (mode === 'all') {
        ctx.globalAlpha = qa * (differs ? 0.9 : 0.35)
        ctx.fillStyle = baseColor(pal, ch)
        ctx.fillRect(x, y, w, rowH)
        if (!letters) return
        ctx.globalAlpha = qa
        ctx.fillStyle = differs ? theme.text : withAlpha(theme.text, 0.75)
        ctx.fillText(ch, x + pxPerBase / 2, y + rowH / 2 + 0.5)
        return
      }
      if (differs) {
        ctx.globalAlpha = qa * 0.3
        ctx.fillStyle = baseColor(pal, ch)
        ctx.fillRect(x, y, w, rowH)
        ctx.globalAlpha = qa
        ctx.fillText(ch, x + pxPerBase / 2, y + rowH / 2 + 0.5)
      } else {
        ctx.globalAlpha = qa
        ctx.fillStyle = mode === 'dots' ? dot : muted
        ctx.fillText(mode === 'dots' ? (fwd ? '.' : ',') : ch, x + pxPerBase / 2, y + rowH / 2 + 0.5)
      }
    }
    if (p.bases) {
      const L = p.bases.length
      for (const m of d.matches) {
        const q0 = Math.max(m.pos, Math.floor(v0) - sh)
        const q1 = Math.min(m.pos + m.len, Math.ceil(v1) - sh)
        for (let k = q0; k < q1; k++) {
          const code = p.bases.charCodeAt(k % L) & 0xdf
          const c = byCons ? consAt(cons, k + sh) : 0
          const qi = m.qp + k - m.pos
          drawBase(k + sh, String.fromCharCode(code), qi < q.length ? q.charCodeAt(qi) - 33 : -1, c !== 0 && c !== code)
        }
      }
    }
    for (const m of d.mismatches) {
      if (m.pos + sh < v0 - 1 || m.pos + sh > v1) continue
      const c = byCons ? consAt(cons, m.pos + sh) : 0
      drawBase(m.pos + sh, m.base, m.qual, c === 0 || c !== m.base.charCodeAt(0))
    }
    ctx.globalAlpha = alpha
  } else if (s.bpPerPx <= MISMATCH_BPP) {
    const w = Math.max(1, pxPerBase - (pxPerBase > 3 ? 1 : 0))
    if (letters) ctx.font = `700 ${Math.min(13, Math.floor(pxPerBase * 0.85))}px ${theme.mono}`
    for (const m of d.mismatches) {
      const x = xOf(m.pos + sh, g, s)
      ctx.globalAlpha = alpha * qualityAlpha(m.qual)
      ctx.fillStyle = baseColor(pal, m.base)
      if (letters) ctx.fillText(m.base, x + pxPerBase / 2, y + rowH / 2 + 0.5)
      else ctx.fillRect(x, y, w, rowH)
    }
    ctx.globalAlpha = alpha
  }
  for (const ins of d.insertions) {
    // Short insertions only close in; long ones always.
    if (s.bpPerPx > 2 && ins.bases.length < 10 * s.bpPerPx) continue
    const x = Math.round(xOf(ins.pos + sh, g, s))
    ctx.fillStyle = colors.insertion
    ctx.globalAlpha = alpha * qualityAlpha(ins.qual)
    if (letters && ins.bases.length > 1 && rowH >= 12) {
      const label = String(ins.bases.length)
      ctx.font = `700 10px ${theme.sans}`
      const tw = ctx.measureText(label).width + 6
      ctx.fillRect(x - tw / 2, y, tw, rowH)
      ctx.fillStyle = theme.bg
      ctx.fillText(label, x, y + rowH / 2 + 0.5)
    } else {
      ctx.fillRect(x - 1, y, 2, rowH)
      if (pxPerBase >= 4 && rowH >= 6) {
        ctx.fillRect(x - 3, y, 6, 1.5)
        ctx.fillRect(x - 3, y + rowH - 1.5, 6, 1.5)
      }
    }
  }
  ctx.globalAlpha = 1
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export interface MapMarks {
  hoverPos: number | null
  hoverRead: ViewRead | null
  selected: ViewRead | null
  /** Other alignments of the selected read's name: its mate, and the other parts of a split read. */
  partners: readonly ViewRead[]
  sortPos: number | null
}

export function paintMapMarks(ctx: CanvasRenderingContext2D, p: MapPaintInput, theme: AlnTheme, st: MapState, m: MapMarks): void {
  const g = p.geo
  const s = st.scale
  ctx.clearRect(0, 0, st.w, st.h)
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.gutter, 0, st.w - g.gutter, st.h)
  ctx.clip()
  const pxPerBase = 1 / s.bpPerPx
  if (m.hoverPos !== null) {
    const x = xOf(m.hoverPos, g, s)
    ctx.fillStyle = withAlpha(theme.text, theme.dark ? 0.08 : 0.06)
    ctx.fillRect(pxPerBase >= 2 ? x : Math.round(x), g.ruler[1], Math.max(1, pxPerBase), st.h - g.ruler[1])
  }
  if (m.sortPos !== null) {
    const x = Math.round(xOf(m.sortPos + 0.5, g, s)) + 0.5
    ctx.strokeStyle = theme.accent
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, g.ruler[1])
    ctx.lineTo(x, st.h)
    ctx.stroke()
    ctx.setLineDash([])
  }
  const outline = (r: ViewRead, color: string, dashed: boolean, width: number) => {
    if (r.row < 0) return
    const y = rowTop(r.row, g, st)
    if (y + g.rowH < g.headerH || y > st.h) return
    const x0 = xOf(r.x0, g, s)
    const x1 = xOf(r.x1, g, s)
    ctx.save()
    ctx.beginPath()
    ctx.rect(g.gutter, g.headerH, st.w - g.gutter, st.h - g.headerH)
    ctx.clip()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    if (dashed) ctx.setLineDash([3, 2])
    ctx.strokeRect(Math.round(x0) - 0.5, y - 1.5, Math.max(2, x1 - x0) + 1, g.rowH + 3)
    ctx.restore()
  }
  if (m.hoverRead && m.hoverRead !== m.selected) outline(m.hoverRead, withAlpha(theme.text, 0.55), false, 1)
  for (const r of m.partners) outline(r, theme.accent, true, 1.5)
  if (m.selected) outline(m.selected, theme.accent, false, 2)
  ctx.restore()
}
