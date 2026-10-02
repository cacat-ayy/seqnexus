/**
 * Drawing a contig: a sticky header (ruler, reference, consensus, coverage,
 * translation), a name gutter, and one row per read with the read's trace
 * underneath, lined up so each peak sits under its base.
 *
 * Everything is in display pixels relative to the stage; scrolling moves the
 * columns and rows under the fixed header and gutter.
 */

import type { TraceBase, TraceData } from '../../io/trace'
import type { Consensus } from '../../assembly/consensus'
import { sameBase } from '../../assembly/consensus'
import type { ContigDoc, ContigRow } from '../../assembly/types'
import { CONTIG_LETTER_MIN, type ContigView } from '../../assembly/view'
import type { ColumnFeature } from '../../assembly/features'
import { complementBase } from '../../models/complement'
import { peakTable } from '../../sanger/peaks'
import type { AlnTheme } from '../alignment/theme'
import { baseColor, CHANNELS, rulerStep, tracePalette, withAlpha } from '../sanger/paint'

export const GUTTER = 200
const RULER_H = 18
const REF_H = 16
const FEAT_H = 14
const CONS_H = 16
const COV_H = 14
const TRANS_H = 15
export const ROW_H = 16

export interface Geometry {
  cellW: number
  headerH: number
  pitch: number
  /** Header bands. */
  ruler: [number, number]
  ref: [number, number] | null
  feat: [number, number] | null
  cons: [number, number]
  cov: [number, number]
  trans: [number, number] | null
  traceH: number
}

export function geometry(doc: ContigDoc, view: ContigView, cellW: number, hasFeatures = false): Geometry {
  let y = 0
  const band = (h: number): [number, number] => { const b: [number, number] = [y, y + h]; y += h; return b }
  const ruler = band(RULER_H)
  const ref = doc.reference ? band(REF_H) : null
  const feat = doc.reference && view.features && hasFeatures ? band(FEAT_H) : null
  const cons = band(CONS_H)
  const cov = band(COV_H)
  const trans = view.translate ? band(TRANS_H) : null
  y += 6
  const traceH = view.traces ? view.traceHeight : 0
  return { cellW, headerH: y, pitch: ROW_H + (traceH ? traceH + 6 : 3), ruler, ref, feat, cons, cov, trans, traceH }
}

// ---------------------------------------------------------------------------
// Traces under rows
// ---------------------------------------------------------------------------

export interface RowTrace {
  data: TraceData
  reversed: boolean
  /** Column centres of the row's called bases, ascending. */
  cols: Float64Array
  /** Their trace samples; negated for a reversed row so they ascend too. */
  samples: Float64Array
  /** Local peak height at each anchor, for even heights. */
  env: Float32Array
}

/** Anchor a row's trace to its columns. Null when the row has no trace (no read, or no calls). */
export function rowTrace(row: ContigRow, data: TraceData | undefined): RowTrace | null {
  if (!data) return null
  const peaks = data.peakLocations
  const cols: number[] = []
  const samples: number[] = []
  const heights: number[] = []
  const t = peakTable(data)
  for (let k = 0; k < row.src.length; k++) {
    const i = row.src[k]
    if (i < 0 || i >= peaks.length) continue
    cols.push(row.start + k + 0.5)
    samples.push(row.reversed ? -peaks[i] : peaks[i])
    heights.push(i < t.length ? t.primary[i] : 0)
  }
  if (cols.length < 2) return null
  // Keep samples strictly ascending (a handful of files repeat a peak position).
  for (let k = 1; k < samples.length; k++) if (samples[k] <= samples[k - 1]) samples[k] = samples[k - 1] + 0.01
  const env = new Float32Array(heights.length)
  const W = 12
  const sorted = [...heights].sort((a, b) => a - b)
  const floor = Math.max(1, (sorted[Math.floor(sorted.length * 0.9)] ?? 1) * 0.05)
  for (let k = 0; k < heights.length; k++) {
    let m = 0
    for (let j = Math.max(0, k - W); j <= Math.min(heights.length - 1, k + W); j++) if (heights[j] > m) m = heights[j]
    env[k] = Math.max(floor, m)
  }
  return { data, reversed: row.reversed, cols: Float64Array.from(cols), samples: Float64Array.from(samples), env }
}

/** Column position of a (signed) sample by interpolating between anchors. */
function colOfSample(rt: RowTrace, s: number, hint: { k: number }): { col: number; env: number } {
  const { cols, samples, env } = rt
  const n = samples.length
  let k = hint.k
  while (k < n - 2 && samples[k + 1] < s) k++
  while (k > 0 && samples[k] > s) k--
  hint.k = k
  const a = samples[k]
  const b = samples[k + 1]
  const t = (s - a) / (b - a)
  const tc = Math.max(0, Math.min(1, t))
  return { col: cols[k] + t * (cols[k + 1] - cols[k]), env: env[k] * (1 - tc) + env[k + 1] * tc }
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export interface PaintState {
  scrollX: number
  scrollY: number
  w: number
  h: number
}

export interface PaintInput {
  doc: ContigDoc
  cons: Consensus
  view: ContigView
  geo: Geometry
  /** 1-based reference position per column, 0 for gap columns. */
  refPos: Int32Array
  traces: (row: ContigRow) => RowTrace | null
  codons: readonly { c0: number; c1: number; aa: string }[] | null
  readNames: (row: ContigRow) => { name: string; verdict?: 'good' | 'check' | 'fail' }
  /** The reference's features, in columns. */
  features: readonly ColumnFeature[]
  /** Variant column ranges, half-open. */
  variants: readonly [number, number][]
}


const colX = (c: number, g: Geometry, st: PaintState) => GUTTER + c * g.cellW - st.scrollX

export function visibleColumns(g: Geometry, st: PaintState, width: number): [number, number] {
  const c0 = Math.max(0, Math.floor(st.scrollX / g.cellW))
  const c1 = Math.min(width, Math.ceil((st.scrollX + st.w - GUTTER) / g.cellW) + 1)
  return [c0, c1]
}

export function visibleRows(g: Geometry, st: PaintState, count: number): [number, number] {
  const r0 = Math.max(0, Math.floor(st.scrollY / g.pitch))
  const r1 = Math.min(count, Math.ceil((st.scrollY + st.h - g.headerH) / g.pitch) + 1)
  return [r0, r1]
}

export function rowTop(i: number, g: Geometry, st: PaintState): number {
  return g.headerH + i * g.pitch - st.scrollY
}

export function paintContig(ctx: CanvasRenderingContext2D, p: PaintInput, theme: AlnTheme, st: PaintState): void {
  const { doc, cons, view, geo: g } = p
  const pal = tracePalette(theme)
  const [c0, c1] = visibleColumns(g, st, doc.width)
  const [r0, r1] = visibleRows(g, st, doc.rows.length)
  const letters = g.cellW >= CONTIG_LETTER_MIN
  const font = Math.max(8, Math.min(13, Math.floor(g.cellW * 0.85)))
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, st.w, st.h)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // ---- Rows (under the header, right of the gutter) ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(GUTTER, g.headerH, st.w - GUTTER, st.h - g.headerH)
  ctx.clip()
  for (let i = r0; i < r1; i++) {
    const row = doc.rows[i]
    const y = rowTop(i, g, st)
    if (i % 2 === 1) {
      ctx.fillStyle = withAlpha(theme.text, theme.dark ? 0.025 : 0.018)
      ctx.fillRect(GUTTER, y, st.w - GUTTER, g.pitch)
    }
    const a = Math.max(c0, row.start)
    const b = Math.min(c1, row.start + row.seq.length)
    // The read's span.
    if (b > a) {
      ctx.fillStyle = withAlpha(theme.muted, 0.12)
      ctx.fillRect(colX(row.start, g, st), y + ROW_H - 1, row.seq.length * g.cellW, 1)
    }
    ctx.font = `600 ${font}px ${theme.mono}`
    for (let c = a; c < b; c++) {
      const k = c - row.start
      const ch = row.seq[k]
      const x = colX(c, g, st)
      const against = view.highlight === 'reference' && doc.reference ? doc.reference.seq[c] : view.highlight === 'consensus' ? cons.bases[c] : null
      const differs = against !== null && against !== ' ' && !(against === '-' && ch === '-') && !sameBase(ch, against)
      const edited = ch !== row.orig[k]
      if (differs) {
        ctx.fillStyle = withAlpha(theme.danger, theme.dark ? 0.32 : 0.22)
        ctx.fillRect(x, y + 1, g.cellW, ROW_H - 2)
      }
      if (ch === '-') {
        ctx.fillStyle = theme.muted
        ctx.fillRect(x + g.cellW * 0.25, y + ROW_H / 2, Math.max(1, g.cellW * 0.5), 1)
        continue
      }
      const low = view.quality && !edited && row.qual[k] < 20
      if (letters) {
        ctx.globalAlpha = low ? 0.4 : 1
        ctx.fillStyle = edited ? theme.accent : baseColor(pal, ch)
        ctx.fillText(ch, x + g.cellW / 2, y + ROW_H / 2 + 0.5)
        ctx.globalAlpha = 1
        if (edited) {
          ctx.fillStyle = theme.accent
          ctx.fillRect(x + g.cellW * 0.2, y + ROW_H - 3, g.cellW * 0.6, 1.5)
        }
      } else {
        ctx.globalAlpha = low ? 0.35 : differs ? 1 : 0.55
        ctx.fillStyle = differs ? theme.danger : edited ? theme.accent : baseColor(pal, ch)
        ctx.fillRect(x, y + 4, Math.max(1, g.cellW - (g.cellW > 3 ? 1 : 0)), ROW_H - 8)
        ctx.globalAlpha = 1
      }
    }
    if (g.traceH) paintRowTrace(ctx, p.traces(row), view, g, st, y + ROW_H + 2, [Math.max(c0, row.start), Math.min(c1, row.start + row.seq.length)], pal, theme)
  }
  ctx.restore()

  // ---- Header ----
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, st.w, g.headerH)
  ctx.save()
  ctx.beginPath()
  ctx.rect(GUTTER, 0, st.w - GUTTER, g.headerH)
  ctx.clip()
  paintRuler(ctx, p, theme, st, c0, c1)
  if (g.ref && doc.reference) {
    const [y0, y1] = g.ref
    ctx.font = `600 ${font}px ${theme.mono}`
    for (let c = c0; c < c1; c++) {
      const ch = doc.reference.seq[c]
      const x = colX(c, g, st)
      if (ch === '-') {
        ctx.fillStyle = withAlpha(theme.muted, 0.6)
        ctx.fillRect(x + g.cellW * 0.25, (y0 + y1) / 2, Math.max(1, g.cellW * 0.5), 1)
      } else if (letters) {
        ctx.fillStyle = theme.text
        ctx.fillText(ch, x + g.cellW / 2, (y0 + y1) / 2 + 0.5)
      } else {
        ctx.fillStyle = withAlpha(theme.text, 0.35)
        ctx.fillRect(x, y0 + 4, Math.max(1, g.cellW - (g.cellW > 3 ? 1 : 0)), y1 - y0 - 8)
      }
    }
    // Where the contig runs past the end of a circular reference.
    if (doc.reference.circular) {
      let wrapCol = -1
      let n = 0
      for (let c = 0; c < doc.width; c++) if (doc.reference.seq[c] !== '-' && ++n === doc.reference.length + 1) { wrapCol = c; break }
      if (wrapCol >= c0 && wrapCol < c1) {
        ctx.fillStyle = theme.accent
        ctx.fillRect(Math.round(colX(wrapCol, g, st)) - 1, y0, 2, y1 - y0)
      }
    }
  }
  {
    const [y0, y1] = g.cons
    ctx.font = `700 ${font}px ${theme.mono}`
    for (let c = c0; c < c1; c++) {
      const ch = cons.bases[c]
      if (ch === ' ') continue
      const x = colX(c, g, st)
      const refDiff = doc.reference && doc.reference.seq[c] !== ch && !(doc.reference.seq[c] === '-' && ch === '-')
      if (refDiff) {
        ctx.fillStyle = withAlpha(theme.warning, theme.dark ? 0.35 : 0.25)
        ctx.fillRect(x, y0 + 1, g.cellW, y1 - y0 - 2)
      }
      if (ch === '-') {
        ctx.fillStyle = theme.muted
        ctx.fillRect(x + g.cellW * 0.25, (y0 + y1) / 2, Math.max(1, g.cellW * 0.5), 1)
      } else if (letters) {
        ctx.fillStyle = baseColor(pal, ch)
        ctx.fillText(ch, x + g.cellW / 2, (y0 + y1) / 2 + 0.5)
      } else {
        ctx.fillStyle = baseColor(pal, ch)
        ctx.fillRect(x, y0 + 4, Math.max(1, g.cellW - (g.cellW > 3 ? 1 : 0)), y1 - y0 - 8)
      }
    }
  }
  {
    // Coverage, coloured by consensus quality.
    const [y0, y1] = g.cov
    let max = 1
    for (let c = 0; c < doc.width; c++) if (cons.coverage[c] > max) max = cons.coverage[c]
    for (let c = c0; c < c1; c++) {
      const cv = cons.coverage[c]
      if (!cv) continue
      const h = Math.max(1.5, (cv / max) * (y1 - y0 - 3))
      const q = cons.quality[c]
      ctx.fillStyle = q >= 40 ? theme.good : q >= 20 ? theme.fair : theme.bad
      ctx.globalAlpha = 0.7
      ctx.fillRect(colX(c, g, st), y1 - 1 - h, Math.max(1, g.cellW - (g.cellW > 3 ? 0.5 : 0)), h)
    }
    ctx.globalAlpha = 1
  }
  if (g.feat) {
    const [y0, y1] = g.feat
    ctx.font = `600 10px ${theme.sans}`
    for (const f of p.features) {
      if (f.c1 <= c0 || f.c0 >= c1) continue
      const x = colX(f.c0, g, st)
      const w = Math.max(2, (f.c1 - f.c0) * g.cellW)
      const top = y0 + 2
      const h = y1 - y0 - 4
      ctx.fillStyle = withAlpha(f.color, theme.dark ? 0.55 : 0.4)
      ctx.beginPath()
      // An arrowhead at the feature's 3' end.
      const tip = Math.min(6, w / 3)
      if (f.strand === 1) { ctx.moveTo(x, top); ctx.lineTo(x + w - tip, top); ctx.lineTo(x + w, top + h / 2); ctx.lineTo(x + w - tip, top + h); ctx.lineTo(x, top + h) }
      else if (f.strand === -1) { ctx.moveTo(x + tip, top); ctx.lineTo(x + w, top); ctx.lineTo(x + w, top + h); ctx.lineTo(x + tip, top + h); ctx.lineTo(x, top + h / 2) }
      else ctx.rect(x, top, w, h)
      ctx.closePath()
      ctx.fill()
      // The label where the feature is on screen.
      const vx0 = Math.max(x, GUTTER) + 4
      const vx1 = Math.min(x + w, st.w) - 6
      if (vx1 - vx0 > 24) {
        ctx.fillStyle = theme.text
        ctx.textAlign = 'left'
        ctx.fillText(truncate(ctx, f.name, vx1 - vx0), vx0, (y0 + y1) / 2 + 0.5)
        ctx.textAlign = 'center'
      }
    }
  }
  if (p.variants.length) {
    const [y0] = g.cov
    ctx.fillStyle = theme.warning
    for (const [a, b] of p.variants) {
      if (b <= c0 || a >= c1) continue
      const x = colX(a, g, st)
      const w = Math.max(3, (b - a) * g.cellW)
      ctx.beginPath()
      ctx.moveTo(x + w / 2 - 4, y0)
      ctx.lineTo(x + w / 2 + 4, y0)
      ctx.lineTo(x + w / 2, y0 + 5)
      ctx.closePath()
      ctx.fill()
    }
  }
  if (g.trans && p.codons) {
    const [y0, y1] = g.trans
    ctx.font = `600 ${Math.max(8, Math.min(12, g.cellW * 0.9))}px ${theme.mono}`
    for (const cd of p.codons) {
      if (cd.c1 <= c0 || cd.c0 >= c1) continue
      const x = colX(cd.c0, g, st)
      const w = (cd.c1 - cd.c0) * g.cellW
      const stop = cd.aa === '*'
      ctx.fillStyle = stop ? withAlpha(theme.danger, 0.22) : cd.aa === 'M' ? withAlpha(theme.good, 0.22) : withAlpha(theme.muted, 0.12)
      ctx.fillRect(x + 1, y0 + 2, w - 2, y1 - y0 - 4)
      if (w >= 9) {
        ctx.fillStyle = stop ? theme.danger : theme.text
        ctx.fillText(cd.aa, x + w / 2, (y0 + y1) / 2 + 0.5)
      }
    }
  }
  ctx.restore()
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, g.headerH - 1, st.w, 1)

  // ---- Gutter ----
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, GUTTER, st.h)
  ctx.fillStyle = theme.grid
  ctx.fillRect(GUTTER - 1, 0, 1, st.h)
  ctx.textAlign = 'left'
  ctx.font = `600 11px ${theme.sans}`
  ctx.fillStyle = theme.muted
  if (g.ref && doc.reference) ctx.fillText(truncate(ctx, doc.reference.name, GUTTER - 16), 8, (g.ref[0] + g.ref[1]) / 2 + 0.5)
  if (g.feat) {
    ctx.font = `500 10px ${theme.sans}`
    ctx.fillText('Features', 8, (g.feat[0] + g.feat[1]) / 2 + 0.5)
    ctx.font = `600 11px ${theme.sans}`
  }
  ctx.fillText('Consensus', 8, (g.cons[0] + g.cons[1]) / 2 + 0.5)
  ctx.font = `500 10px ${theme.sans}`
  ctx.fillText('Coverage', 8, (g.cov[0] + g.cov[1]) / 2 + 0.5)
  if (g.trans) ctx.fillText(`Translation (frame ${view.frame + 1})`, 8, (g.trans[0] + g.trans[1]) / 2 + 0.5)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, g.headerH, GUTTER, st.h - g.headerH)
  ctx.clip()
  for (let i = r0; i < r1; i++) {
    const row = doc.rows[i]
    const y = rowTop(i, g, st)
    const info = p.readNames(row)
    // Direction arrow, then the name.
    ctx.fillStyle = row.reversed ? theme.warning : theme.good
    ctx.font = `700 11px ${theme.sans}`
    ctx.fillText(row.reversed ? '◀' : '▶', 8, y + ROW_H / 2 + 0.5)
    ctx.fillStyle = theme.text
    ctx.font = `500 11px ${theme.sans}`
    ctx.fillText(truncate(ctx, info.name, GUTTER - 44), 24, y + ROW_H / 2 + 0.5)
    if (info.verdict && info.verdict !== 'good') {
      ctx.fillStyle = info.verdict === 'fail' ? theme.danger : theme.warning
      ctx.beginPath()
      ctx.arc(GUTTER - 12, y + ROW_H / 2, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    if (g.traceH && !p.traces(row)) {
      ctx.fillStyle = theme.muted
      ctx.font = `400 10px ${theme.sans}`
      ctx.fillText(row.readId ? 'trace unavailable' : 'no trace', 24, y + ROW_H + 2 + g.traceH / 2)
    }
  }
  ctx.restore()
  ctx.textAlign = 'center'
}

function paintRuler(ctx: CanvasRenderingContext2D, p: PaintInput, theme: AlnTheme, st: PaintState, c0: number, c1: number) {
  const g = p.geo
  const [, y1] = g.ruler
  ctx.fillStyle = theme.grid
  ctx.fillRect(GUTTER, y1 - 1, st.w - GUTTER, 1)
  ctx.font = `500 10px ${theme.sans}`
  ctx.textBaseline = 'alphabetic'
  const step = rulerStep(g.cellW)
  for (let c = c0; c < c1; c++) {
    // Numbered by reference position when there is a reference, by column otherwise.
    const num = p.doc.reference ? p.refPos[c] : c + 1
    if (!num || num % step !== 0) continue
    const x = colX(c, g, st) + g.cellW / 2
    ctx.fillStyle = theme.grid
    ctx.fillRect(Math.round(x), y1 - 5, 1, 4)
    ctx.fillStyle = theme.muted
    ctx.fillText(num.toLocaleString(), x, 11)
  }
  ctx.textBaseline = 'middle'
}

function paintRowTrace(
  ctx: CanvasRenderingContext2D,
  rt: RowTrace | null,
  view: ContigView,
  g: Geometry,
  st: PaintState,
  top: number,
  [a, b]: [number, number],
  pal: ReturnType<typeof tracePalette>,
  theme: AlnTheme,
) {
  if (!rt || b <= a) return
  const base = top + g.traceH
  ctx.fillStyle = withAlpha(theme.grid, 0.8)
  ctx.fillRect(colX(a, g, st), base, (b - a) * g.cellW, 1)
  // Anchors covering the visible columns, with one either side.
  let k0 = 0
  while (k0 < rt.cols.length - 1 && rt.cols[k0 + 1] < a) k0++
  let k1 = rt.cols.length - 1
  while (k1 > 0 && rt.cols[k1 - 1] > b) k1--
  if (k1 <= k0) return
  const sLo = Math.ceil(Math.min(rt.samples[k0], rt.samples[k1]))
  const sHi = Math.floor(Math.max(rt.samples[k0], rt.samples[k1]))
  const target = (g.traceH - 3) * 0.85
  ctx.save()
  ctx.beginPath()
  ctx.rect(colX(a, g, st), top - 1, (b - a) * g.cellW, g.traceH + 2)
  ctx.clip()
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'
  for (const ch of CHANNELS) {
    const data = rt.data.traces[rt.reversed ? (complementBase(ch) as TraceBase) : ch]
    if (!data?.length) continue
    ctx.strokeStyle = pal[ch]
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    const hint = { k: k0 }
    let first = true
    for (let s = sLo; s <= sHi; s++) {
      const raw = rt.reversed ? -s : s
      const v = data[raw]
      if (v === undefined) continue
      const { col, env } = colOfSample(rt, s, hint)
      const x = colX(0, g, st) + col * g.cellW
      const y = Math.max(top, base - Math.max(0, v) * (target / env))
      if (first) { ctx.moveTo(x, y); first = false } else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
  void view
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ctx.measureText(text.slice(0, mid) + '…').width <= max) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, lo) + '…'
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export interface ContigSelection {
  /** Row indices [r0, r1); r0 = r1 = -1 selects columns only (from the header). */
  r0: number
  r1: number
  c0: number
  c1: number
}

export interface MarkState {
  selection: ContigSelection | null
  caret: { row: number; col: number } | null
  hover: { row: number; col: number } | null
  editing: boolean
  focused: boolean
  hits: readonly [number, number][]
  currentHit: number
}

export function paintMarks(ctx: CanvasRenderingContext2D, doc: ContigDoc, g: Geometry, theme: AlnTheme, st: PaintState, m: MarkState): void {
  ctx.clearRect(0, 0, st.w, st.h)
  const bodyTop = g.headerH
  const allH = Math.max(0, Math.min(st.h, rowTop(doc.rows.length, g, st)) - bodyTop)
  const rowsY = (r0: number, r1: number) => {
    const y0 = Math.max(bodyTop, rowTop(r0, g, st))
    const y1 = Math.min(st.h, rowTop(r1, g, st))
    return [y0, y1] as const
  }
  ctx.save()
  ctx.beginPath()
  ctx.rect(GUTTER, 0, st.w - GUTTER, st.h)
  ctx.clip()

  if (m.hover && m.hover.col >= 0) {
    const x = colX(m.hover.col, g, st)
    ctx.fillStyle = withAlpha(theme.text, theme.dark ? 0.06 : 0.045)
    ctx.fillRect(x, 0, g.cellW, bodyTop + allH)
  }

  m.hits.forEach(([h0, h1], i) => {
    ctx.fillStyle = withAlpha(theme.warning, i === m.currentHit ? 0.4 : 0.2)
    ctx.fillRect(colX(h0, g, st), g.cons[0], (h1 - h0) * g.cellW, g.cons[1] - g.cons[0])
  })

  if (m.selection) {
    const s = m.selection
    const x = colX(s.c0, g, st)
    const w = (s.c1 - s.c0) * g.cellW
    ctx.fillStyle = withAlpha(theme.accent, theme.dark ? 0.22 : 0.15)
    if (s.r0 < 0) {
      ctx.fillRect(x, g.ruler[1], w, bodyTop - g.ruler[1] + allH)
    } else {
      const [y0, y1] = rowsY(s.r0, s.r1)
      if (y1 > y0) ctx.fillRect(x, y0, w, y1 - y0)
      ctx.fillStyle = withAlpha(theme.accent, 0.1)
      ctx.fillRect(x, g.cons[0], w, g.cons[1] - g.cons[0])
    }
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1
    if (s.r0 >= 0) {
      const [y0, y1] = rowsY(s.r0, s.r1)
      if (y1 > y0) ctx.strokeRect(Math.round(x) + 0.5, y0 + 0.5, Math.round(w) - 1, y1 - y0 - 1)
    }
  }

  if (m.caret && m.caret.col >= 0) {
    const x = colX(m.caret.col, g, st)
    ctx.strokeStyle = m.focused ? theme.accent : withAlpha(theme.accent, 0.5)
    ctx.lineWidth = 1.5
    if (m.caret.row >= 0) {
      const y = rowTop(m.caret.row, g, st)
      if (y + ROW_H > bodyTop) ctx.strokeRect(x + 0.75, Math.max(bodyTop, y) + 0.75, g.cellW - 1.5, ROW_H - 1.5)
    } else {
      ctx.strokeRect(x + 0.75, g.cons[0] + 0.75, g.cellW - 1.5, g.cons[1] - g.cons[0] - 1.5)
    }
  }
  ctx.restore()

  // Row highlight in the gutter.
  if (m.selection && m.selection.r0 >= 0) {
    const [y0, y1] = rowsY(m.selection.r0, m.selection.r1)
    if (y1 > y0) {
      ctx.fillStyle = withAlpha(theme.accent, 0.12)
      ctx.fillRect(0, y0, GUTTER - 1, y1 - y0)
    }
  }
}
