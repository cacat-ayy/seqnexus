/**
 * Drawing a read: ruler, calls, second peaks, quality, translation and the
 * four traces, one row at a time.
 *
 * A row is a run of display columns drawn from (x0, y0). The scrolling view
 * draws one row (or, wrapped, every row on screen); figure export draws the
 * same rows onto its own canvas. Two layers: `paintRow` for content, which
 * changes on scroll and edits, and `paintMarks` for selection, caret, hover
 * and find hits, which change on every pointer move.
 */

import type { TraceBase } from '../../io/trace'
import { complementBase } from '../../models/complement'
import { KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE, posOfSample, sampleOfPos } from '../../sanger/layout'
import type { Codon, TraceModel } from '../../sanger/model'
import { LETTER_MIN_WIDTH, type TraceView } from '../../sanger/view'
import type { AlnTheme } from '../alignment/theme'

export const CHANNELS: TraceBase[] = ['A', 'C', 'G', 'T']

export interface TracePalette {
  A: string
  C: string
  G: string
  T: string
  other: string
}

/** The usual trace colours (A green, C blue, G black, T red), adjusted for a dark background. */
export function tracePalette(theme: AlnTheme): TracePalette {
  return theme.dark
    ? { A: '#4ade80', C: '#60a5fa', G: '#e5e7eb', T: '#f87171', other: theme.muted }
    : { A: '#16a34a', C: '#2563eb', G: '#1f2937', T: '#dc2626', other: theme.muted }
}

export function baseColor(p: TracePalette, b: string): string {
  return b === 'A' || b === 'C' || b === 'G' || b === 'T' ? p[b] : p.other
}

// ---------------------------------------------------------------------------
// Track geometry
// ---------------------------------------------------------------------------

export interface TrackLayout {
  ruler: [number, number]
  original: [number, number] | null
  calls: [number, number]
  second: [number, number] | null
  quality: [number, number] | null
  translation: [number, number] | null
  traces: [number, number]
  /** Height of one row. */
  height: number
}

const RULER_H = 18
const ORIGINAL_H = 11
const CALLS_H = 18
const SECOND_H = 12
const QUALITY_H = 20
const TRANSLATION_H = 16
const MIN_TRACE_H = 60

/** Track bands, top to bottom, for a row of the given total height (or trace height when wrapped). */
export function trackLayout(m: TraceModel, view: TraceView, opts: { height?: number; traceHeight?: number }): TrackLayout {
  let y = 0
  const band = (h: number): [number, number] => { const b: [number, number] = [y, y + h]; y += h; return b }
  const ruler = band(RULER_H)
  const original = m.layout.edited > 0 && m.original.trim() ? band(ORIGINAL_H) : null
  const calls = band(CALLS_H)
  const second = view.mixed ? band(SECOND_H) : null
  const quality = view.quality && !m.data.metadata.qualityMissing ? band(QUALITY_H) : null
  const translation = view.translate ? band(TRANSLATION_H) : null
  y += 4
  const traceH = opts.traceHeight ?? Math.max(MIN_TRACE_H, (opts.height ?? 300) - y - 6)
  const traces = band(traceH)
  return { ruler, original, calls, second, quality, translation, traces, height: y + 6 }
}

export interface RowGeom {
  /** Left edge of display column d0, in canvas pixels (may be negative when scrolled). */
  x0: number
  y0: number
  d0: number
  d1: number
  cellW: number
  /** Visible width to clip to. */
  clipX: number
  clipW: number
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export function paintRow(
  ctx: CanvasRenderingContext2D,
  m: TraceModel,
  view: TraceView,
  theme: AlnTheme,
  tracks: TrackLayout,
  g: RowGeom,
  codons: readonly Codon[] | null,
): void {
  const pal = tracePalette(theme)
  const { cellW, d0, d1 } = g
  const xOf = (d: number) => g.x0 + (d - d0) * cellW
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.clipX, g.y0, g.clipW, tracks.height)
  ctx.clip()

  paintRuler(ctx, theme, tracks, g, xOf)

  // Calls.
  const letters = cellW >= LETTER_MIN_WIDTH
  const font = Math.max(8, Math.min(14, Math.floor(cellW * 0.85)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const [cy0, cy1] = tracks.calls
  const cy = g.y0 + (cy0 + cy1) / 2
  for (let d = Math.max(0, d0); d < Math.min(m.n, d1); d++) {
    const x = xOf(d)
    const b = m.shown[d]
    const k = m.kind[d]
    const plain = b === 'A' || b === 'C' || b === 'G' || b === 'T'
    // Backgrounds: inserted bases and ambiguous calls stand out.
    if (k === KIND_INSERT) {
      ctx.fillStyle = withAlpha(theme.accent, 0.18)
      ctx.fillRect(x, g.y0 + cy0 + 1, cellW, cy1 - cy0 - 2)
    } else if (!plain && k !== KIND_DELETE) {
      ctx.fillStyle = withAlpha(theme.danger, 0.16)
      ctx.fillRect(x, g.y0 + cy0 + 1, cellW, cy1 - cy0 - 2)
    }
    const color = k === KIND_DELETE ? theme.muted : m.auto[d] ? theme.warning : (k === KIND_SUBSTITUTE || k === KIND_INSERT) ? theme.accent : baseColor(pal, b)
    if (letters) {
      ctx.font = `${k === KIND_SUBSTITUTE || k === KIND_INSERT ? 700 : 600} ${font}px ${theme.mono}`
      ctx.fillStyle = color
      ctx.fillText(b, x + cellW / 2, cy + 0.5)
      if (k === KIND_DELETE) {
        ctx.fillStyle = theme.danger
        ctx.fillRect(x + cellW * 0.15, cy, cellW * 0.7, 1.5)
      } else if (k === KIND_SUBSTITUTE) {
        ctx.fillStyle = m.auto[d] ? theme.warning : theme.accent
        ctx.fillRect(x + cellW * 0.2, g.y0 + cy1 - 3, cellW * 0.6, 1.5)
      }
    } else {
      ctx.fillStyle = color
      ctx.fillRect(x, cy - 3, Math.max(1, cellW - (cellW > 3 ? 1 : 0)), 6)
    }
  }

  // The instrument's call above an edited one.
  if (tracks.original && letters) {
    const [y0, y1] = tracks.original
    ctx.font = `500 ${Math.max(7, font - 3)}px ${theme.mono}`
    ctx.fillStyle = theme.muted
    for (let d = Math.max(0, d0); d < Math.min(m.n, d1); d++) {
      const o = m.original[d]
      if (o !== ' ') ctx.fillText(o, xOf(d) + cellW / 2, g.y0 + (y0 + y1) / 2 + 1)
      else if (m.kind[d] === KIND_INSERT) ctx.fillText('+', xOf(d) + cellW / 2, g.y0 + (y0 + y1) / 2 + 1)
    }
  }

  // Second peaks.
  if (tracks.second) {
    const [y0, y1] = tracks.second
    const sy = g.y0 + (y0 + y1) / 2
    ctx.font = `600 ${Math.max(7, font - 3)}px ${theme.mono}`
    for (let d = Math.max(0, d0); d < Math.min(m.n, d1); d++) {
      if (m.kind[d] === KIND_INSERT) continue
      const r = m.secondRatio[d]
      if (r < view.mixedRatio) continue
      const x = xOf(d)
      const sb = m.secondBase[d]
      // Stronger second peaks get a stronger mark.
      ctx.fillStyle = withAlpha(theme.warning, Math.min(0.45, 0.12 + r * 0.35))
      ctx.fillRect(x, g.y0 + y0, cellW, y1 - y0)
      ctx.fillStyle = baseColor(pal, sb)
      if (letters) ctx.fillText(sb, x + cellW / 2, sy + 0.5)
      else ctx.fillRect(x, sy - 2, Math.max(1, cellW - 1), 4)
    }
  }

  // Quality bars.
  if (tracks.quality) {
    const [y0, y1] = tracks.quality
    const h = y1 - y0 - 2
    const base = g.y0 + y1 - 1
    for (let d = Math.max(0, d0); d < Math.min(m.n, d1); d++) {
      const q = m.quality[d]
      if (q < 0) continue
      const bh = Math.max(1, (Math.min(60, q) / 60) * h)
      ctx.fillStyle = q < view.qualityCutoff ? theme.bad : q < 30 ? theme.fair : theme.good
      ctx.globalAlpha = m.kind[d] === KIND_DELETE ? 0.35 : 0.75
      ctx.fillRect(xOf(d) + (cellW > 3 ? 0.5 : 0), base - bh, Math.max(1, cellW - (cellW > 3 ? 1 : 0)), bh)
    }
    ctx.globalAlpha = 1
    const cut = base - (Math.min(60, view.qualityCutoff) / 60) * h
    ctx.strokeStyle = withAlpha(theme.bad, 0.7)
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(g.clipX, Math.round(cut) + 0.5)
    ctx.lineTo(g.clipX + g.clipW, Math.round(cut) + 0.5)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Translation.
  if (tracks.translation && codons) {
    const [y0, y1] = tracks.translation
    const ty = g.y0 + (y0 + y1) / 2
    ctx.font = `600 ${Math.max(8, Math.min(12, cellW * 0.9))}px ${theme.mono}`
    for (const cd of codons) {
      if (cd.d1 <= d0 || cd.d0 >= d1) continue
      const x = xOf(cd.d0)
      const w = (cd.d1 - cd.d0) * cellW
      const stop = cd.aa === '*'
      const met = cd.aa === 'M'
      ctx.fillStyle = stop ? withAlpha(theme.danger, 0.22) : met ? withAlpha(theme.good, 0.22) : withAlpha(theme.muted, 0.12)
      ctx.fillRect(x + 1, g.y0 + y0 + 2, w - 2, y1 - y0 - 4)
      if (w >= 9) {
        ctx.fillStyle = stop ? theme.danger : theme.text
        ctx.fillText(cd.aa, x + w / 2, ty + 0.5)
      }
    }
  }

  paintTraces(ctx, m, view, theme, pal, tracks, g)

  // Trimmed ends: washed out under a veil.
  const [t0, t1] = m.trim
  ctx.fillStyle = withAlpha(theme.bg, theme.dark ? 0.62 : 0.66)
  if (t0 > d0) ctx.fillRect(xOf(d0), g.y0 + tracks.calls[0], (Math.min(t0, d1) - d0) * cellW, tracks.height - tracks.calls[0])
  if (t1 < d1) {
    const from = Math.max(t1, d0)
    ctx.fillRect(xOf(from), g.y0 + tracks.calls[0], (d1 - from) * cellW, tracks.height - tracks.calls[0])
  }
  ctx.restore()
}

function paintRuler(ctx: CanvasRenderingContext2D, theme: AlnTheme, tracks: TrackLayout, g: RowGeom, xOf: (d: number) => number) {
  const [y0, y1] = tracks.ruler
  const step = rulerStep(g.cellW)
  ctx.fillStyle = theme.grid
  ctx.fillRect(g.clipX, g.y0 + y1 - 1, g.clipW, 1)
  ctx.font = `500 10px ${theme.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const first = Math.ceil((g.d0 + 1) / step) * step
  for (let num = first; num <= g.d1; num += step) {
    const x = xOf(num - 1) + g.cellW / 2
    ctx.fillStyle = theme.grid
    ctx.fillRect(Math.round(x), g.y0 + y1 - 5, 1, 4)
    ctx.fillStyle = theme.muted
    ctx.fillText(num.toLocaleString(), x, g.y0 + y0 + 11)
  }
  // Minor ticks when there is room.
  const minor = step / 5
  if (minor >= 1 && minor * g.cellW >= 6) {
    ctx.fillStyle = theme.grid
    const firstMinor = Math.ceil((g.d0 + 1) / minor) * minor
    for (let num = firstMinor; num <= g.d1; num += minor) {
      if (num % step === 0) continue
      ctx.fillRect(Math.round(xOf(num - 1) + g.cellW / 2), g.y0 + y1 - 3, 1, 2)
    }
  }
}

export function rulerStep(cellW: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (s * cellW >= 54) return s
  return 10000
}

function paintTraces(
  ctx: CanvasRenderingContext2D,
  m: TraceModel,
  view: TraceView,
  theme: AlnTheme,
  pal: TracePalette,
  tracks: TrackLayout,
  g: RowGeom,
) {
  const [ty0, ty1] = tracks.traces
  const top = g.y0 + ty0
  const base = g.y0 + ty1 - 1
  const avail = ty1 - ty0 - 2
  ctx.fillStyle = theme.grid
  ctx.fillRect(g.clipX, base, g.clipW, 1)
  const pts = tracePoints(m, view, g, avail)
  if (!pts) return
  const { s0, count, xs, norm } = pts

  ctx.save()
  ctx.beginPath()
  ctx.rect(g.clipX, top - 2, g.clipW, ty1 - ty0 + 2)
  ctx.clip()
  ctx.lineWidth = g.cellW >= 6 ? 1.25 : 1
  ctx.lineJoin = 'round'
  for (const ch of CHANNELS) {
    if (!view.channels[ch]) continue
    const data = channelData(m, ch)
    if (!data || data.length === 0) continue
    ctx.strokeStyle = pal[ch]
    ctx.globalAlpha = theme.dark ? 0.95 : 0.9
    ctx.beginPath()
    for (let i = 0; i < count; i++) {
      const v = data[s0 + i] ?? 0
      const y = Math.max(top - 2, base - Math.max(0, v) * norm[i])
      if (i === 0) ctx.moveTo(xs[i], y)
      else ctx.lineTo(xs[i], y)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

/**
 * Where each trace sample under a row lands: its x, and the factor that
 * turns its raw height into pixels (peak height setting and normalisation
 * included). Null when the row has no trace under it.
 */
export function tracePoints(
  m: TraceModel,
  view: TraceView,
  g: Pick<RowGeom, 'x0' | 'd0' | 'd1' | 'cellW'>,
  avail: number,
): { s0: number; count: number; xs: Float32Array; norm: Float32Array } | null {
  const L = m.layout
  if (L.traceLength === 0 || m.n === 0) return null
  // Forward positions this row covers, with a column of margin either side.
  const lo = m.reversed ? m.n - g.d1 - 1 : g.d0 - 1
  const hi = m.reversed ? m.n - g.d0 + 1 : g.d1 + 1
  const s0 = Math.max(0, Math.floor(sampleOfPos(L, lo)))
  const s1 = Math.min(L.traceLength - 1, Math.ceil(sampleOfPos(L, hi)))
  if (s1 <= s0) return null
  const count = s1 - s0 + 1
  const xs = new Float32Array(count)
  const norm = new Float32Array(count)
  const target = avail * 0.82 * view.height
  for (let i = 0; i < count; i++) {
    const fp = posOfSample(L, s0 + i)
    const dp = m.reversed ? m.n - fp : fp
    xs[i] = g.x0 + (dp - g.d0) * g.cellW
    norm[i] = target / (view.normalize ? envelopeAt(m, fp) : m.scale)
  }
  return { s0, count, xs, norm }
}

/** The forward channel drawn as display channel `ch`. */
export function channelData(m: TraceModel, ch: TraceBase): number[] {
  return m.data.traces[m.reversed ? (complementBase(ch) as TraceBase) : ch]
}

function envelopeAt(m: TraceModel, fp: number): number {
  const f = fp - 0.5
  const i = Math.max(0, Math.min(m.n - 1, Math.floor(f)))
  const j = Math.min(m.n - 1, i + 1)
  const t = Math.max(0, Math.min(1, f - i))
  return m.envelope[i] * (1 - t) + m.envelope[j] * t
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export interface MarkState {
  selection: { d0: number; d1: number } | null
  caret: number | null
  hover: number | null
  editing: boolean
  insertMode: boolean
  hits: readonly [number, number][]
  currentHit: number
  focused: boolean
}

export function paintMarks(
  ctx: CanvasRenderingContext2D,
  m: TraceModel,
  theme: AlnTheme,
  tracks: TrackLayout,
  g: RowGeom,
  s: MarkState,
): void {
  const { cellW, d0, d1 } = g
  const xOf = (d: number) => g.x0 + (d - d0) * cellW
  const top = g.y0 + tracks.calls[0]
  const bottom = g.y0 + tracks.height - 4
  ctx.save()
  ctx.beginPath()
  ctx.rect(g.clipX, g.y0, g.clipW, tracks.height)
  ctx.clip()

  if (s.hover !== null && s.hover >= d0 && s.hover < d1) {
    ctx.fillStyle = withAlpha(theme.text, theme.dark ? 0.07 : 0.05)
    ctx.fillRect(xOf(s.hover), top, cellW, bottom - top)
  }

  s.hits.forEach(([h0, h1], i) => {
    if (h1 <= d0 || h0 >= d1) return
    const cur = i === s.currentHit
    ctx.fillStyle = withAlpha(theme.warning, cur ? 0.35 : 0.18)
    ctx.fillRect(xOf(h0), g.y0 + tracks.calls[0], (h1 - h0) * cellW, tracks.calls[1] - tracks.calls[0])
    ctx.fillStyle = theme.warning
    ctx.fillRect(xOf(h0), g.y0 + tracks.calls[1] - 2, (h1 - h0) * cellW, cur ? 2 : 1)
  })

  if (s.selection && s.selection.d1 > d0 && s.selection.d0 < d1) {
    const a = Math.max(s.selection.d0, d0)
    const b = Math.min(s.selection.d1, d1)
    ctx.fillStyle = withAlpha(theme.accent, theme.dark ? 0.22 : 0.16)
    ctx.fillRect(xOf(a), top, (b - a) * cellW, bottom - top)
    ctx.fillStyle = theme.accent
    if (s.selection.d0 >= d0) ctx.fillRect(Math.round(xOf(s.selection.d0)), top, 1, bottom - top)
    if (s.selection.d1 <= d1) ctx.fillRect(Math.round(xOf(s.selection.d1)) - 1, top, 1, bottom - top)
  }

  if (s.caret !== null && s.caret >= d0 && s.caret <= d1) {
    const x = xOf(s.caret)
    ctx.fillStyle = s.focused ? theme.accent : withAlpha(theme.accent, 0.5)
    if (s.editing && !s.insertMode && s.caret < m.n) {
      // Overwrite: a box round the base that typing replaces.
      ctx.strokeStyle = ctx.fillStyle
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 0.75, g.y0 + tracks.calls[0] + 0.75, cellW - 1.5, tracks.calls[1] - tracks.calls[0] - 1.5)
      ctx.fillRect(Math.round(x + cellW / 2), g.y0 + tracks.traces[0], 1, tracks.traces[1] - tracks.traces[0])
    } else {
      ctx.fillRect(Math.round(x) - 1, top, 2, bottom - top)
    }
  }

  // Trim edges, with a grip in the ruler to drag.
  const [t0, t1] = m.trim
  for (const [edge, side] of [[t0, 'start'], [t1, 'end']] as const) {
    if (edge < d0 || edge > d1) continue
    const x = Math.round(xOf(edge))
    ctx.fillStyle = theme.accent
    ctx.globalAlpha = 0.8
    ctx.fillRect(x - 1, g.y0 + tracks.ruler[0] + 2, 2, tracks.height - tracks.ruler[0] - 6)
    ctx.globalAlpha = 1
    const gy = g.y0 + tracks.ruler[0] + 2
    ctx.beginPath()
    if (side === 'start') { ctx.moveTo(x, gy); ctx.lineTo(x + 8, gy); ctx.lineTo(x, gy + 10) }
    else { ctx.moveTo(x, gy); ctx.lineTo(x - 8, gy); ctx.lineTo(x, gy + 10) }
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------

const alphaCache = new Map<string, string>()

/** A CSS colour at an opacity, for hex and rgb() inputs (anything else is returned as is). */
export function withAlpha(color: string, a: number): string {
  const key = `${color}|${a}`
  const hit = alphaCache.get(key)
  if (hit) return hit
  let out = color
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7)
    const n = parseInt(hex, 16)
    if (Number.isFinite(n)) out = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(c)
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3)
      out = `rgba(${parts.join(', ')}, ${a})`
    }
  }
  alphaCache.set(key, out)
  return out
}
