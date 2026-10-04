/**
 * Several reads stacked one under another: a name gutter on the left, one
 * shared ruler on top, and for each read its calls over its trace. The way
 * a plate is usually looked over, read against read.
 *
 * Reads are not aligned to each other here (that is what assembly is for);
 * they line up either at their first base or at the start of what trimming
 * kept, which for reads off the same primer is close to lined up anyway.
 */

import { KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE } from '../../sanger/layout'
import type { TraceModel } from '../../sanger/model'
import { LETTER_MIN_WIDTH, type TraceView } from '../../sanger/view'
import type { AlnTheme } from '../alignment/theme'
import { baseColor, paintRuler, paintTraces, tracePalette, withAlpha, type RowGeom } from './paint'

export const GUTTER_W = 200
export const RULER_H = 22
/** Space between the gutter and column 0 of the shared ruler. */
export const LEAD = 10
const CALLS_H = 16
const GAP = 3
const SEP = 9

export interface StackLayout {
  /** Shared column of each read's display column 0. */
  offsets: number[]
  /** Shared column numbered 1 on the ruler. */
  origin: number
  /** Shared columns in all. */
  columns: number
  traceH: number
  rowH: number
}

export function stackLayout(models: readonly TraceModel[], align: TraceView['stackAlign'], traceH: number): StackLayout {
  const starts = models.map(m => (align === 'trim' ? Math.min(m.trim[0], m.n) : 0))
  const origin = starts.length ? Math.max(...starts) : 0
  const offsets = starts.map(s => origin - s)
  const columns = models.reduce((w, m, i) => Math.max(w, offsets[i] + m.n), 0)
  return { offsets, origin, columns, traceH, rowH: CALLS_H + GAP + traceH + SEP }
}

/** The bands of a row, relative to its top. */
export function rowBands(L: StackLayout): { calls: [number, number]; traces: [number, number] } {
  return { calls: [0, CALLS_H], traces: [CALLS_H + GAP, CALLS_H + GAP + L.traceH] }
}

/**
 * One read's row. `g` is in the read's own display columns: x0 is where
 * column d0 starts on the canvas, and the clip keeps it right of the gutter.
 */
export function paintStackRow(
  ctx: CanvasRenderingContext2D,
  m: TraceModel,
  view: TraceView,
  theme: AlnTheme,
  L: StackLayout,
  g: RowGeom,
): void {
  const pal = tracePalette(theme)
  const { cellW, d0, d1 } = g
  const bands = rowBands(L)
  const xOf = (d: number) => g.x0 + (d - d0) * cellW
  const from = Math.max(0, d0)
  const to = Math.min(m.n, d1)
  const callTop = g.y0 + bands.calls[0]
  const callH = bands.calls[1] - bands.calls[0]
  const traceBase = g.y0 + bands.traces[1] - 1
  const showQ = view.quality && !m.data.metadata.qualityMissing
  const w = Math.max(1, cellW - (cellW > 3 ? 1 : 0))

  ctx.save()
  ctx.beginPath()
  ctx.rect(g.clipX, g.y0, g.clipW, L.rowH)
  ctx.clip()

  // Quality as pale boxes behind the trace, so a peak can be read against
  // how much the basecaller trusted it without a track of its own.
  if (showQ && to > from) {
    const avail = bands.traces[1] - bands.traces[0] - 2
    ctx.fillStyle = withAlpha(theme.accent, theme.dark ? 0.11 : 0.1)
    const tops: number[] = []
    for (let d = from; d < to; d++) {
      const q = m.quality[d]
      if (q < 0) { tops.push(NaN); continue }
      const h = (Math.min(60, q) / 60) * avail
      tops.push(traceBase - h)
      ctx.fillRect(xOf(d), traceBase - h, cellW, h)
    }
    ctx.strokeStyle = withAlpha(theme.accent, theme.dark ? 0.32 : 0.35)
    ctx.lineWidth = 1
    ctx.beginPath()
    tops.forEach((y, i) => {
      if (Number.isNaN(y)) return
      const x = xOf(from + i)
      ctx.moveTo(x, Math.round(y) + 0.5)
      ctx.lineTo(x + cellW, Math.round(y) + 0.5)
    })
    ctx.stroke()
  }

  // Calls on a plain background: quality is behind the trace already, and a
  // tinted band of letters reads as a selection.
  const letters = cellW >= LETTER_MIN_WIDTH
  const font = Math.max(8, Math.min(13, Math.floor(cellW * 0.82)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const cy = callTop + callH / 2
  for (let d = from; d < to; d++) {
    const x = xOf(d)
    const b = m.shown[d]
    const k = m.kind[d]
    const plain = b === 'A' || b === 'C' || b === 'G' || b === 'T'
    if (k === KIND_INSERT) {
      ctx.fillStyle = withAlpha(theme.accent, 0.2)
      ctx.fillRect(x, callTop, w, callH)
    } else if (!plain && k !== KIND_DELETE) {
      ctx.fillStyle = withAlpha(theme.danger, 0.2)
      ctx.fillRect(x, callTop, w, callH)
    }
    const edited = k === KIND_SUBSTITUTE || k === KIND_INSERT
    const color = k === KIND_DELETE ? theme.muted : m.auto[d] ? theme.warning : edited ? theme.accent : baseColor(pal, b)
    if (letters) {
      ctx.font = `${edited ? 700 : 600} ${font}px ${theme.mono}`
      ctx.fillStyle = color
      ctx.fillText(b, x + cellW / 2, cy + 0.5)
      if (k === KIND_DELETE) {
        ctx.fillStyle = theme.danger
        ctx.fillRect(x + cellW * 0.15, cy, cellW * 0.7, 1.5)
      }
    } else {
      ctx.fillStyle = color
      ctx.fillRect(x, cy - 3, w, 6)
    }
    // A strong second peak: a mark under the call, as in the single-read view.
    if (view.mixed && k !== KIND_INSERT && m.secondRatio[d] >= view.mixedRatio) {
      ctx.fillStyle = theme.warning
      ctx.fillRect(x, callTop + callH - 2, w, 2)
    }
  }

  if (to > from) paintTraces(ctx, m, view, theme, pal, bands, g)

  // Trimmed ends washed out, as in the single-read view.
  const [t0, t1] = m.trim
  const veilH = bands.traces[1] - bands.calls[0]
  ctx.fillStyle = withAlpha(theme.bg, theme.dark ? 0.62 : 0.66)
  if (t0 > from) ctx.fillRect(xOf(from), callTop, (Math.min(t0, to) - from) * cellW, veilH)
  if (t1 < to) {
    const a = Math.max(t1, from)
    ctx.fillRect(xOf(a), callTop, (to - a) * cellW, veilH)
  }

  ctx.fillStyle = theme.grid
  ctx.fillRect(g.clipX, g.y0 + L.rowH - Math.ceil(SEP / 2), g.clipW, 1)
  ctx.restore()
}

/**
 * The shared ruler, numbered from the layout's origin. `c0`/`c1` are the
 * shared columns on screen and `x0` is where shared column 0 starts.
 */
export function paintStackRuler(
  ctx: CanvasRenderingContext2D,
  theme: AlnTheme,
  L: StackLayout,
  x0: number,
  cellW: number,
  c0: number,
  c1: number,
  clipX: number,
  clipW: number,
): void {
  ctx.fillStyle = theme.bg
  ctx.fillRect(clipX, 0, clipW, RULER_H)
  // Numbered columns start at the origin; nothing is numbered left of it.
  const d0 = Math.max(0, c0 - L.origin)
  const d1 = Math.max(d0, c1 - L.origin)
  const g: RowGeom = { x0: x0 + (d0 + L.origin) * cellW, y0: 0, d0, d1, cellW, clipX, clipW }
  ctx.save()
  ctx.beginPath()
  ctx.rect(clipX, 0, clipW, RULER_H)
  ctx.clip()
  paintRuler(ctx, theme, { ruler: [2, RULER_H] }, g, d => g.x0 + (d - d0) * cellW)
  ctx.restore()
}

export interface GutterRow {
  name: string
  /** A second, quieter line: kept length, well. */
  detail: string
  reversed: boolean
  verdict: 'good' | 'check' | 'fail'
}

/** The names down the left, over whatever scrolled under them. */
export function paintGutter(
  ctx: CanvasRenderingContext2D,
  theme: AlnTheme,
  L: StackLayout,
  rows: readonly GutterRow[],
  r0: number,
  r1: number,
  scrollY: number,
  height: number,
  selected: number | null,
  hovered: number | null,
): void {
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, GUTTER_W, height)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const verdictColor = { good: theme.good, check: theme.fair, fail: theme.bad }
  const bandH = L.rowH - Math.ceil(SEP / 2)
  for (let r = r0; r < r1; r++) {
    const row = rows[r]
    const y = RULER_H + r * L.rowH - scrollY
    if (r === selected) {
      ctx.fillStyle = withAlpha(theme.accent, theme.dark ? 0.2 : 0.12)
      ctx.fillRect(0, y, GUTTER_W, bandH)
      ctx.fillStyle = theme.accent
      ctx.fillRect(0, y, 3, bandH)
    } else if (r === hovered) {
      ctx.fillStyle = withAlpha(theme.text, theme.dark ? 0.06 : 0.04)
      ctx.fillRect(0, y, GUTTER_W, bandH)
    }
    const cy = y + CALLS_H / 2 + 1
    ctx.fillStyle = verdictColor[row.verdict]
    ctx.beginPath()
    ctx.arc(12, cy, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `500 11px ${theme.sans}`
    ctx.fillStyle = theme.muted
    const num = `${r + 1}`
    ctx.fillText(num, 22, cy)
    const x = 22 + Math.max(14, ctx.measureText(num).width + 6)
    ctx.font = `600 12px ${theme.sans}`
    ctx.fillStyle = theme.text
    // Cut in the middle: read names differ at the end (_F, _R, the well).
    ctx.fillText(fitText(ctx, row.name, GUTTER_W - x - 8), x, cy)
    if (bandH >= CALLS_H + 20) {
      ctx.font = `400 11px ${theme.sans}`
      ctx.fillStyle = theme.muted
      ctx.fillText(fitText(ctx, `${row.reversed ? '← reverse complement · ' : ''}${row.detail}`, GUTTER_W - x - 8), x, cy + 16)
    }
    ctx.fillStyle = theme.grid
    ctx.fillRect(0, y + bandH, GUTTER_W, 1)
  }
  // Corner over the gutter's end of the ruler.
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, GUTTER_W, RULER_H)
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, RULER_H - 1, GUTTER_W, 1)
  ctx.fillRect(GUTTER_W - 1, 0, 1, height)
  ctx.font = `600 10px ${theme.sans}`
  ctx.fillStyle = theme.muted
  ctx.fillText(`${rows.length} READS`, 12, RULER_H / 2 + 1)
}

const fitCache = new Map<string, string>()

/** Text cut in the middle with an ellipsis to fit a width, keeping both ends. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  const key = `${ctx.font}|${max}|${text}`
  const hit = fitCache.get(key)
  if (hit !== undefined) return hit
  let out = text
  if (ctx.measureText(text).width > max) {
    // Characters kept, split a little in favour of the end.
    const cut = (k: number) => {
      const tail = Math.ceil(k * 0.55)
      return text.slice(0, k - tail) + '…' + text.slice(text.length - tail)
    }
    let lo = 0
    let hi = text.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (ctx.measureText(cut(mid)).width <= max) lo = mid
      else hi = mid - 1
    }
    out = cut(lo)
  }
  if (fitCache.size > 2000) fitCache.clear()
  fitCache.set(key, out)
  return out
}
