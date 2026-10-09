/**
 * The quality report's charts as static SVG, for the exported report (HTML
 * and PDF). The same shapes as on screen (qcCharts.tsx), drawn at a fixed
 * size in the light theme's colours on white: an exported report is fixed
 * output and does not follow the app's theme. Only the SVG subset that
 * pdf/svg-pdf.ts paints is used.
 */

import { niceTicks } from '../../../utils/ticks'
import type { PositionQuality } from '../../../ngs/types'
import { printTokens } from '../../../pdf/print-colors'

export interface FigurePalette {
  text: string
  muted: string
  grid: string
  accent: string
  accentDark: string
  series: string[]
  base: { a: string; c: string; g: string; t: string }
  good: string
  fair: string
  poor: string
  cool: string
  mid: string
  warm: string
}

const TOKENS = [
  'text', 'text-muted', 'border', 'accent', 'accent-dark', 'series-1', 'series-2', 'series-3', 'series-4', 'series-5', 'series-6',
  'base-a', 'base-c', 'base-g', 'base-t', 'success', 'warning', 'danger', 'diverge-cool', 'diverge-mid', 'diverge-warm',
] as const

/** Fallbacks: the light theme's values, for tests and when a token cannot be read. */
const FALLBACK: FigurePalette = {
  text: '#1f2937', muted: '#6b7280', grid: '#d1d5db', accent: '#4f46e5', accentDark: '#3730a3',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  base: { a: '#22a366', c: '#3b82f6', g: '#1e293b', t: '#ef4444' },
  good: '#16a34a', fair: '#d97706', poor: '#dc2626', cool: '#2a78d6', mid: '#f0efec', warm: '#e34948',
}

/** The figure colours: the light theme's tokens, read off the page. */
export function figurePalette(): FigurePalette {
  let t: Record<(typeof TOKENS)[number], string>
  try {
    t = printTokens(TOKENS)
  } catch {
    return FALLBACK
  }
  const v = (k: (typeof TOKENS)[number], f: string) => t[k] || f
  return {
    text: v('text', FALLBACK.text), muted: v('text-muted', FALLBACK.muted), grid: v('border', FALLBACK.grid),
    accent: v('accent', FALLBACK.accent), accentDark: v('accent-dark', FALLBACK.accentDark),
    series: FALLBACK.series.map((f, i) => t[`series-${i + 1}` as (typeof TOKENS)[number]] || f),
    base: { a: v('base-a', FALLBACK.base.a), c: v('base-c', FALLBACK.base.c), g: v('base-g', FALLBACK.base.g), t: v('base-t', FALLBACK.base.t) },
    good: v('success', FALLBACK.good), fair: v('warning', FALLBACK.fair), poor: v('danger', FALLBACK.poor),
    cool: v('diverge-cool', FALLBACK.cool), mid: v('diverge-mid', FALLBACK.mid), warm: v('diverge-warm', FALLBACK.warm),
  }
}

export const FIGURE_WIDTH = 760
const H = 250
const PAD = { left: 52, right: 14, top: 12, bottom: 40 }
const FONT = 'Helvetica, Arial, sans-serif'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r2 = (x: number) => Math.round(x * 100) / 100
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function tickStep(n: number, plotWidth: number): number {
  const want = Math.max(1, n / Math.max(2, Math.floor(plotWidth / 56)))
  return [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(s => s >= want) ?? Math.ceil(want)
}

function text(x: number, y: number, s: string, o: { size?: number; fill: string; anchor?: 'start' | 'middle' | 'end'; rotate?: boolean; weight?: number }): string {
  const attrs = `font-family="${FONT}" font-size="${o.size ?? 10}" fill="${o.fill}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}`
  return o.rotate
    ? `<text transform="translate(${r2(x)},${r2(y)}) rotate(-90)" ${attrs}>${esc(s)}</text>`
    : `<text x="${r2(x)}" y="${r2(y)}" ${attrs}>${esc(s)}</text>`
}

function svg(height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FIGURE_WIDTH}" height="${height}" viewBox="0 0 ${FIGURE_WIDTH} ${height}">${body}</svg>`
}

/** A legend row above a chart: a swatch and a name per entry. */
function legend(entries: { name: string; color: string; dashed?: boolean; box?: boolean }[], pal: FigurePalette): string {
  let x = PAD.left
  let out = ''
  for (const e of entries) {
    out += e.box
      ? `<rect x="${x}" y="4" width="12" height="8" rx="2" fill="${e.color}" fill-opacity="0.35" stroke="${e.color}"/>`
      : `<line x1="${x}" y1="8" x2="${x + 14}" y2="8" stroke="${e.color}" stroke-width="2.5"${e.dashed ? ' stroke-dasharray="4 3"' : ''}/>`
    out += text(x + 18, 11.5, e.name, { fill: pal.text, size: 9.5 })
    x += 18 + e.name.length * 5.4 + 16
  }
  return out
}

export interface FigureSeries { name: string; color: string; values: number[]; dashed?: boolean }

/** A line chart: one or more series over categories, as LineChart draws it. */
export function lineFigure(o: {
  labels: string[]; series: FigureSeries[]; xTitle: string; yTitle: string; yMax?: number; zeroBased?: boolean; everyLabel?: boolean
}, pal: FigurePalette): string {
  const top0 = o.series.length > 1 ? 18 : 0
  const height = H + top0
  const n = o.labels.length
  const pw = FIGURE_WIDTH - PAD.left - PAD.right
  const ph = H - PAD.top - PAD.bottom
  const ticks = niceTicks(o.yMax ?? Math.max(0, ...o.series.flatMap(s => s.values)))
  const top = o.yMax ?? (ticks[ticks.length - 1] || 1)
  const slot = n ? pw / n : pw
  const x = (i: number) => PAD.left + slot * (i + 0.5)
  const y = (v: number) => top0 + PAD.top + ph - (Math.min(v, top) / top) * ph
  const step = o.everyLabel ? 1 : tickStep(n, pw)
  let body = o.series.length > 1 ? legend(o.series.map(s => ({ name: s.name, color: s.color, dashed: s.dashed })), pal) : ''
  for (const t of ticks) {
    body += `<line x1="${PAD.left}" x2="${PAD.left + pw}" y1="${r2(y(t))}" y2="${r2(y(t))}" stroke="${pal.grid}" stroke-width="0.6"/>`
    body += text(PAD.left - 6, y(t) + 3.5, compact.format(t), { fill: pal.muted, anchor: 'end' })
  }
  body += text(14, top0 + PAD.top + ph / 2, o.yTitle, { fill: pal.muted, anchor: 'middle', rotate: true })
  for (const s of o.series) {
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${r2(x(i))},${r2(y(v))}`).join('')
    body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round"${s.dashed ? ' stroke-dasharray="5 4"' : ''}/>`
  }
  o.labels.forEach((l, i) => {
    if (o.everyLabel || i === 0 || (o.zeroBased ? i : i + 1) % step === 0) body += text(x(i), top0 + PAD.top + ph + 14, l, { fill: pal.muted, anchor: 'middle' })
  })
  body += text(PAD.left + pw / 2, height - 6, o.xTitle, { fill: pal.muted, anchor: 'middle' })
  return svg(height, body)
}

/** FastQC's per base quality plot: boxes, whiskers, medians and the mean line over the quality zones. */
export function qualityFigure(positions: PositionQuality[], pal: FigurePalette): string {
  const top0 = 18
  const height = H + top0
  const n = positions.length
  const qMax = Math.max(40, ...positions.map(p => p.p90))
  const pw = FIGURE_WIDTH - PAD.left - PAD.right
  const ph = H - PAD.top - PAD.bottom
  const slot = n ? pw / n : pw
  const x = (i: number) => PAD.left + slot * (i + 0.5)
  const y = (q: number) => top0 + PAD.top + ph - (Math.min(q, qMax) / qMax) * ph
  const bw = Math.max(1, Math.min(12, slot - 1.5))
  let body = legend([
    { name: 'Middle 50%', color: pal.accent, box: true }, { name: 'Median', color: pal.accentDark }, { name: 'Mean', color: pal.series[1] },
  ], pal)
  const zones = [{ from: 28, to: qMax, c: pal.good }, { from: 20, to: 28, c: pal.fair }, { from: 0, to: 20, c: pal.poor }]
  for (const z of zones) body += `<rect x="${PAD.left}" y="${r2(y(z.to))}" width="${pw}" height="${r2(y(z.from) - y(z.to))}" fill="${z.c}" fill-opacity="0.12"/>`
  for (const t of [0, 10, 20, 30, 40].filter(v => v <= qMax)) body += text(PAD.left - 6, y(t) + 3.5, String(t), { fill: pal.muted, anchor: 'end' })
  body += text(14, top0 + PAD.top + ph / 2, 'Phred score', { fill: pal.muted, anchor: 'middle', rotate: true })
  positions.forEach((q, i) => {
    body += `<line x1="${r2(x(i))}" x2="${r2(x(i))}" y1="${r2(y(q.p90))}" y2="${r2(y(q.p10))}" stroke="${pal.accent}" stroke-width="0.8"/>`
    body += `<rect x="${r2(x(i) - bw / 2)}" y="${r2(y(q.p75))}" width="${r2(bw)}" height="${r2(Math.max(0.8, y(q.p25) - y(q.p75)))}" fill="${pal.accent}" fill-opacity="0.35" stroke="${pal.accent}" stroke-width="0.6"/>`
    body += `<line x1="${r2(x(i) - bw / 2)}" x2="${r2(x(i) + bw / 2)}" y1="${r2(y(q.p50))}" y2="${r2(y(q.p50))}" stroke="${pal.accentDark}" stroke-width="1.5"/>`
  })
  if (n) body += `<path d="${positions.map((q, i) => `${i ? 'L' : 'M'}${r2(x(i))},${r2(y(q.mean))}`).join('')}" fill="none" stroke="${pal.series[1]}" stroke-width="1.5"/>`
  const step = tickStep(n, pw)
  for (let i = 0; i < n; i++) if (i === 0 || (i + 1) % step === 0) body += text(x(i), top0 + PAD.top + ph + 14, String(i + 1), { fill: pal.muted, anchor: 'middle' })
  body += text(PAD.left + pw / 2, height - 6, 'Position in read (bp)', { fill: pal.muted, anchor: 'middle' })
  return svg(height, body)
}

/** Mix two hex colours. */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => {
    const s = h.replace('#', '')
    const f = s.length === 3 ? [...s].map(c => c + c).join('') : s
    return [0, 2, 4].map(k => parseInt(f.slice(k, k + 2), 16))
  }
  const [x, y] = [p(a), p(b)]
  return `#${x.map((v, k) => Math.round(v + (y[k] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** FastQC's per tile heatmap: cells of a row with the same colour step drawn as one rectangle. */
export function tileFigure(ids: number[], deviation: number[][], pal: FigurePalette): string {
  const top0 = 18
  const rowH = Math.max(3, Math.min(16, Math.floor(300 / Math.max(1, ids.length))))
  const positions = deviation[0]?.length ?? 0
  const pw = FIGURE_WIDTH - PAD.left - PAD.right
  const height = top0 + ids.length * rowH + 40
  const cell = positions ? pw / positions : pw
  const STEPS = 10
  const colorAt = (d: number) => {
    const s = Math.min(STEPS, Math.round((Math.abs(d) / 10) * STEPS))
    return s === 0 ? pal.mid : mixHex(pal.mid, d < 0 ? pal.warm : pal.cool, s / STEPS)
  }
  let body = legend([
    { name: 'Below the average of all tiles', color: pal.warm, box: true }, { name: 'Above it', color: pal.cool, box: true },
  ], pal)
  const labelEvery = Math.max(1, Math.ceil(11 / rowH))
  ids.forEach((id, t) => {
    const yy = top0 + t * rowH
    let start = 0
    for (let p = 1; p <= positions; p++) {
      if (p < positions && colorAt(deviation[t][p]) === colorAt(deviation[t][start])) continue
      body += `<rect x="${r2(PAD.left + start * cell)}" y="${yy}" width="${r2((p - start) * cell + 0.3)}" height="${rowH}" fill="${colorAt(deviation[t][start])}"/>`
      start = p
    }
    if (t % labelEvery === 0) body += text(PAD.left - 6, yy + rowH / 2 + 3.5, String(id), { fill: pal.muted, anchor: 'end', size: 9 })
  })
  const base = top0 + ids.length * rowH
  const step = tickStep(positions, pw)
  for (let i = 0; i < positions; i++) if (i === 0 || (i + 1) % step === 0) body += text(PAD.left + (i + 0.5) * cell, base + 13, String(i + 1), { fill: pal.muted, anchor: 'middle' })
  body += text(PAD.left + pw / 2, height - 6, 'Position in read (bp)', { fill: pal.muted, anchor: 'middle' })
  return svg(height, body)
}
