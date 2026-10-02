/**
 * A read as a vector figure: rows of calls over their traces, with an
 * optional ruler and quality bars, on white paper whatever the app theme.
 * The traces are the same points the view draws, so the figure matches the
 * screen (orientation, peak height and even heights included).
 */

import { KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE } from '../../sanger/layout'
import type { TraceModel } from '../../sanger/model'
import type { TraceView } from '../../sanger/view'
import { FIGURE_THEME, type AlnTheme } from '../alignment/theme'
import type { Figure } from '../alignment/figure'
import { baseColor, CHANNELS, channelData, rulerStep, tracePalette, tracePoints } from './paint'

export interface TraceFigureOptions {
  d0: number
  d1: number
  /** Bases per row; 0 puts everything on one row. */
  perLine: number
  /** Letter size in px; columns are a little wider. */
  fontSize: number
  traceHeight: number
  ruler: boolean
  quality: boolean
  /** Fade the trimmed-away ends, as on screen. */
  showTrim: boolean
  title?: string
}

/** Past this many bases a figure stops being useful (and gets slow to render). */
export const MAX_FIGURE_BASES = 5000

const MARGIN = 16
const LABEL_W = 44

export function buildTraceFigure(m: TraceModel, view: TraceView, o: TraceFigureOptions, theme: AlnTheme = FIGURE_THEME): Figure {
  const pal = tracePalette(theme)
  const cellW = Math.round(o.fontSize * 1.15 * 10) / 10
  const span = Math.max(0, o.d1 - o.d0)
  const perLine = o.perLine > 0 ? o.perLine : Math.max(1, span)
  const rows = Math.max(1, Math.ceil(span / perLine))
  const rulerH = o.ruler ? 16 : 0
  const callsH = o.fontSize + 6
  const qualH = o.quality && !m.data.metadata.qualityMissing ? 16 : 0
  const rowH = rulerH + callsH + qualH + o.traceHeight + 14
  const titleH = o.title ? 26 : 0
  const width = Math.ceil(MARGIN * 2 + LABEL_W * 2 + perLine * cellW)
  const height = Math.ceil(MARGIN * 2 + titleH + rows * rowH)
  const out: string[] = []
  const r1 = (v: number) => Math.round(v * 10) / 10

  if (o.title) out.push(`<text x="${MARGIN}" y="${MARGIN + 14}" class="t">${esc(o.title)}</text>`)

  for (let r = 0; r < rows; r++) {
    const d0 = o.d0 + r * perLine
    const d1 = Math.min(o.d1, d0 + perLine)
    const x0 = MARGIN + LABEL_W
    let y = MARGIN + titleH + r * rowH
    const xOf = (d: number) => x0 + (d - d0) * cellW
    const faded = (d: number) => o.showTrim && (d < m.trim[0] || d >= m.trim[1])

    // Row numbers either side.
    const callsMid = y + rulerH + callsH / 2
    out.push(`<text x="${x0 - 8}" y="${r1(callsMid + 4)}" class="n" text-anchor="end">${d0 + 1}</text>`)
    out.push(`<text x="${r1(xOf(d1) + 8)}" y="${r1(callsMid + 4)}" class="n">${d1}</text>`)

    if (o.ruler) {
      const step = rulerStep(cellW)
      out.push(`<line x1="${x0}" x2="${r1(xOf(d1))}" y1="${y + rulerH - 0.5}" y2="${y + rulerH - 0.5}" class="g"/>`)
      for (let num = Math.ceil((d0 + 1) / step) * step; num <= d1; num += step) {
        const x = r1(xOf(num - 1) + cellW / 2)
        out.push(`<line x1="${x}" x2="${x}" y1="${y + rulerH - 4}" y2="${y + rulerH}" class="g"/><text x="${x}" y="${y + 10}" class="r" text-anchor="middle">${num}</text>`)
      }
      y += rulerH
    }

    // Calls.
    for (let d = d0; d < d1; d++) {
      const k = m.kind[d]
      const b = m.shown[d]
      const x = r1(xOf(d) + cellW / 2)
      const fill = k === KIND_DELETE ? theme.muted : m.auto[d] ? theme.warning : k === KIND_SUBSTITUTE || k === KIND_INSERT ? theme.accent : baseColor(pal, b)
      const weight = k === KIND_SUBSTITUTE || k === KIND_INSERT ? ' font-weight="700"' : ''
      const op = faded(d) ? ' opacity="0.35"' : ''
      const deco = k === KIND_DELETE ? ' text-decoration="line-through"' : ''
      out.push(`<text x="${x}" y="${r1(y + callsH / 2 + o.fontSize * 0.36)}" class="c" fill="${fill}"${weight}${op}${deco}>${b}</text>`)
    }
    y += callsH

    if (qualH) {
      const base = y + qualH - 2
      for (let d = d0; d < d1; d++) {
        const q = m.quality[d]
        if (q < 0) continue
        const h = Math.max(0.5, (Math.min(60, q) / 60) * (qualH - 3))
        const fill = q < view.qualityCutoff ? theme.bad : q < 30 ? theme.fair : theme.good
        out.push(`<rect x="${r1(xOf(d) + 0.6)}" y="${r1(base - h)}" width="${r1(cellW - 1.2)}" height="${r1(h)}" fill="${fill}" opacity="${faded(d) ? 0.25 : 0.7}"/>`)
      }
      y += qualH
    }

    // Traces, clipped to the row's columns.
    const top = y + 2
    const base = y + o.traceHeight
    const clip = `c${r}`
    out.push(`<clipPath id="${clip}"><rect x="${x0}" y="${top - 2}" width="${r1((d1 - d0) * cellW)}" height="${o.traceHeight + 2}"/></clipPath>`)
    out.push(`<line x1="${x0}" x2="${r1(xOf(d1))}" y1="${base + 0.5}" y2="${base + 0.5}" class="g"/>`)
    const pts = tracePoints(m, view, { x0, d0, d1, cellW }, o.traceHeight - 2)
    if (pts) {
      out.push(`<g clip-path="url(#${clip})" fill="none" stroke-width="0.9" stroke-linejoin="round">`)
      for (const ch of CHANNELS) {
        if (!view.channels[ch]) continue
        const data = channelData(m, ch)
        if (!data.length) continue
        let path = ''
        for (let i = 0; i < pts.count; i++) {
          const v = Math.max(0, data[pts.s0 + i] ?? 0)
          path += `${i === 0 ? 'M' : 'L'}${r1(pts.xs[i])} ${r1(Math.max(top - 2, base - v * pts.norm[i]))}`
        }
        out.push(`<path d="${path}" stroke="${pal[ch]}"/>`)
      }
      out.push('</g>')
    }
    // Trimmed ends under a veil.
    if (o.showTrim) {
      const a = Math.max(d0, Math.min(d1, m.trim[0]))
      const b = Math.max(d0, Math.min(d1, m.trim[1]))
      if (a > d0) out.push(`<rect x="${x0}" y="${top}" width="${r1((a - d0) * cellW)}" height="${o.traceHeight - 2}" fill="${theme.bg}" opacity="0.65"/>`)
      if (b < d1) out.push(`<rect x="${r1(xOf(b))}" y="${top}" width="${r1((d1 - b) * cellW)}" height="${o.traceHeight - 2}" fill="${theme.bg}" opacity="0.65"/>`)
    }
  }

  const style = [
    `.t{font:600 14px ${theme.sans};fill:${theme.text}}`,
    `.n{font:500 10px ${theme.sans};fill:${theme.muted}}`,
    `.r{font:500 9px ${theme.sans};fill:${theme.muted}}`,
    `.c{font:600 ${o.fontSize}px ${theme.mono};text-anchor:middle}`,
    `.g{stroke:${theme.grid};stroke-width:1}`,
  ].join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<style>${style}</style><rect width="100%" height="100%" fill="${theme.bg}"/>`
    + out.join('') + '</svg>'
  return { svg, width, height }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
