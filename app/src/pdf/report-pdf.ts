/**
 * A report as a PDF: a title, then blocks laid out down A4 pages (figure
 * tiles, tables, histograms, terms with their explanations, notes), with a
 * page footer. Drawn with the app's own PDF writer, so the text is text and
 * the charts are vectors.
 *
 * Layout is one pass: each block measures itself and starts a new page when
 * it does not fit what is left (tables and fact lists break between rows,
 * repeating a table's header). Footers are drawn at the end, once the page
 * count is known.
 *
 * Colours are the figures' print palette (FIGURE_THEME): a PDF is fixed
 * output on white paper and does not follow the app's theme.
 */

import { FIGURE_THEME } from '../components/alignment/theme'
import { niceTicks } from '../utils/ticks'
import { A4, PdfDocument } from './document'
import type { PdfCanvas } from './canvas'
import { pdfMeasure } from './fonts'
import { drawSvg, svgHeightAt } from './svg-pdf'

export interface ReportTile { label: string; value: string; detail?: string }
export interface ReportColumn { label: string; numeric?: boolean }

export type ReportBlock =
  | {
    kind: 'heading'; text: string
    /** A status after the heading, in its colour (a quality report module's mark). */
    status?: { text: string; tone: 'good' | 'warning' | 'danger' | 'muted' }
  }
  /** A figure as SVG (the subset pdf/svg-pdf.ts paints), drawn the width of the page. */
  | { kind: 'figure'; svg: string }
  /** A raster picture (a gel's photo), from canvas pixels, at most the width of the page. */
  | { kind: 'image'; width: number; height: number; rgba: Uint8ClampedArray }
  | { kind: 'tiles'; tiles: ReportTile[] }
  | { kind: 'table'; columns: ReportColumn[]; rows: string[][] }
  | {
    kind: 'histogram'; title: string; subtitle?: string
    edges: readonly number[]; counts: readonly number[]
    /** An axis tick's text, from a bin's low edge. */
    tickLabel?: (edge: number) => string
  }
  | { kind: 'facts'; items: { term: string; text: string }[] }
  | { kind: 'note'; text: string }

export interface Report {
  title: string
  /** Under the title: what the report is of, and when. */
  subtitle?: string
  blocks: ReportBlock[]
}

const MARGIN = 40
const FOOTER = 22
const SANS = 'Helvetica, Arial, sans-serif'
const T = FIGURE_THEME
const nf = new Intl.NumberFormat('en-US')
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const font = (size: number, bold = false) => `${bold ? 700 : 400} ${size}px ${SANS}`
const measure = (text: string, size: number, bold = false) => pdfMeasure(font(size, bold), text)

/** Text broken into lines no wider than `width`. */
function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word
      if (line && measure(next, size, bold) > width) { lines.push(line); line = word }
      else line = next
    }
    lines.push(line)
  }
  return lines
}

/** Text cut to a width, with an ellipsis. */
function fit(text: string, size: number, width: number, bold = false): string {
  // The tolerance absorbs rounding in widths computed from this same measure.
  if (measure(text, size, bold) <= width + 0.01) return text
  let s = text
  while (s.length > 1 && measure(`${s}…`, size, bold) > width) s = s.slice(0, -1)
  return `${s}…`
}

class Writer {
  readonly doc: PdfDocument
  readonly pages: PdfCanvas[] = []
  ctx!: PdfCanvas
  y = 0
  readonly left = MARGIN
  readonly width = A4.width - MARGIN * 2
  readonly bottom = A4.height - MARGIN - FOOTER

  constructor(title: string) {
    this.doc = new PdfDocument({ title, subject: 'Report' })
    this.newPage()
  }

  newPage() {
    this.ctx = this.doc.addPage()
    this.pages.push(this.ctx)
    this.y = MARGIN
  }

  /** Room for `h` more points on this page, or a new page. */
  need(h: number) {
    if (this.y + h > this.bottom && this.y > MARGIN) this.newPage()
  }

  text(s: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: string; align?: CanvasTextAlign } = {}) {
    const c = this.ctx
    c.font = font(size, opts.bold)
    c.fillStyle = opts.color ?? T.text
    c.globalAlpha = 1
    c.textAlign = opts.align ?? 'left'
    c.textBaseline = 'alphabetic'
    c.fillText(s, x, y)
  }

  rule(y: number, color = T.grid, x0 = this.left, x1 = this.left + this.width) {
    const c = this.ctx
    c.fillStyle = color
    c.globalAlpha = 1
    c.fillRect(x0, y, x1 - x0, 0.6)
  }
}

function heading(w: Writer, text: string, status?: Extract<ReportBlock, { kind: 'heading' }>['status'], keep = 60) {
  // A heading keeps a few lines of what follows with it (or the whole figure that follows).
  w.need(18 + keep)
  if (w.y > MARGIN) w.y += 8
  w.text(text, w.left, w.y + 10, 11, { bold: true })
  if (status) {
    const color = status.tone === 'good' ? T.good : status.tone === 'warning' ? T.warning : status.tone === 'danger' ? T.danger : T.muted
    w.text(status.text, w.left + measure(text, 11, true) + 8, w.y + 10, 9, { bold: true, color })
  }
  w.y += 18
}

function tiles(w: Writer, list: ReportTile[]) {
  const perRow = Math.min(4, Math.max(1, list.length))
  const gap = 8
  const tw = (w.width - gap * (perRow - 1)) / perRow
  const th = 50
  for (let i = 0; i < list.length; i += perRow) {
    w.need(th + gap)
    list.slice(i, i + perRow).forEach((t, k) => {
      const x = w.left + k * (tw + gap)
      const c = w.ctx
      c.strokeStyle = T.grid
      c.lineWidth = 0.8
      c.globalAlpha = 1
      c.beginPath()
      c.roundRect(x, w.y, tw, th, 4)
      c.stroke()
      w.text(fit(t.label, 7.5, tw - 16), x + 8, w.y + 13, 7.5, { color: T.muted })
      w.text(fit(t.value, 15, tw - 16, true), x + 8, w.y + 31, 15, { bold: true })
      if (t.detail) w.text(fit(t.detail, 7.5, tw - 16), x + 8, w.y + 43, 7.5, { color: T.muted })
    })
    w.y += th + gap
  }
}

function table(w: Writer, columns: ReportColumn[], rows: string[][]) {
  const size = 8
  const line = 14
  const pad = 6
  // Columns as wide as their widest cell; the first takes what is left, or gives it up.
  const natural = columns.map((col, j) => Math.max(measure(col.label, size, true), ...rows.map(r => measure(r[j] ?? '', size))) + pad * 2)
  const rest = natural.slice(1).reduce((a, b) => a + b, 0)
  const widths = [Math.max(60, w.width - rest), ...natural.slice(1)]
  const total = widths.reduce((a, b) => a + b, 0)
  if (total > w.width + 0.01) {
    const k = w.width / total
    for (let j = 0; j < widths.length; j++) widths[j] *= k
  }
  const xs = widths.map((_, j) => w.left + widths.slice(0, j).reduce((a, b) => a + b, 0))
  const cell = (s: string, j: number, y: number, bold: boolean, color?: string) => {
    const text = fit(s, size, widths[j] - pad * 2, bold)
    if (columns[j].numeric) w.text(text, xs[j] + widths[j] - pad, y, size, { bold, color, align: 'right' })
    else w.text(text, xs[j] + pad, y, size, { bold, color })
  }
  const header = () => {
    columns.forEach((col, j) => cell(col.label, j, w.y + 10, true, T.muted))
    w.rule(w.y + line, T.muted)
    w.y += line + 1
  }
  w.need(line * 3)
  header()
  for (const r of rows) {
    if (w.y + line > w.bottom) { w.newPage(); header() }
    r.forEach((s, j) => { if (j < columns.length) cell(s, j, w.y + 10, false) })
    w.rule(w.y + line)
    w.y += line
  }
  w.y += 8
}

function histogram(w: Writer, b: Extract<ReportBlock, { kind: 'histogram' }>) {
  const h = 120
  const padL = 34
  const padB = 16
  const head = b.subtitle ? 26 : 16
  w.need(head + h + 10)
  w.text(b.title, w.left, w.y + 9, 9.5, { bold: true })
  if (b.subtitle) w.text(b.subtitle, w.left, w.y + 21, 7.5, { color: T.muted })
  w.y += head
  const c = w.ctx
  const n = b.counts.length
  const x0 = w.left + padL
  const pw = w.width - padL
  const ph = h - padB
  const max = Math.max(1, ...b.counts)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const yOf = (v: number) => w.y + ph - (v / top) * ph
  for (const t of ticks) {
    w.rule(yOf(t), T.rowSep, x0, x0 + pw)
    w.text(compact.format(t), x0 - 5, yOf(t) + 2.5, 7, { color: T.muted, align: 'right' })
  }
  const band = n ? pw / n : pw
  const gap = band >= 6 ? 1.5 : band >= 3 ? 0.75 : 0
  const bw = Math.min(18, Math.max(0.4, band - gap))
  c.fillStyle = T.accent
  c.globalAlpha = 0.85
  b.counts.forEach((v, i) => {
    if (v <= 0) return
    const y = yOf(v)
    c.fillRect(x0 + i * band + (band - bw) / 2, y, bw, w.y + ph - y)
  })
  w.rule(w.y + ph, T.muted, x0, x0 + pw)
  const label = b.tickLabel ?? ((v: number) => nf.format(v))
  // Labels at most every 50 pt, so they never run into each other.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 50))))
  for (let i = 0; i < n; i += every) {
    w.text(label(b.edges[i]), x0 + i * band, w.y + h - 4, 7, { color: T.muted, align: i === 0 ? 'left' : 'center' })
  }
  w.y += h + 12
}

function facts(w: Writer, items: { term: string; text: string }[]) {
  const size = 8.5
  const line = 11.5
  const termW = 90
  for (const it of items) {
    const lines = wrap(it.text, size, w.width - termW)
    w.need(lines.length * line + 4)
    w.text(fit(it.term, size, termW - 8, true), w.left, w.y + 9, size, { bold: true })
    lines.forEach((l, k) => w.text(l, w.left + termW, w.y + 9 + k * line, size))
    w.y += lines.length * line + 4
  }
  w.y += 4
}

/**
 * How much of what follows a heading should start on its page: a figure
 * after it (past any short notes) whole, otherwise a few lines.
 */
function keepWith(blocks: ReportBlock[], at: number, width: number): number {
  let notes = 0
  for (let k = at + 1; k < blocks.length && k <= at + 3; k++) {
    const b = blocks[k]
    if (b.kind === 'note') { notes += 24; continue }
    if (b.kind === 'figure') return notes + svgHeightAt(b.svg, width) + 8
    if (b.kind === 'image') return notes + imageBox(b, width, A4.height - MARGIN * 2 - FOOTER).h + 8
    break
  }
  return 60
}

/** A figure the width of the page, kept whole on one page. */
function figure(w: Writer, svg: string) {
  const h = svgHeightAt(svg, w.width)
  w.need(h + 6)
  drawSvg(w.ctx, svg, w.left, w.y, w.width)
  w.y += h + 8
}

/** The size a picture prints at: the page's width at most, and no taller than a page. */
function imageBox(b: { width: number; height: number }, maxWidth: number, maxHeight: number): { w: number; h: number } {
  const s = Math.min(1, maxWidth / b.width, maxHeight / b.height)
  return { w: b.width * s, h: b.height * s }
}

/** A raster picture, centred, kept whole on one page. */
function image(w: Writer, b: Extract<ReportBlock, { kind: 'image' }>) {
  const box = imageBox(b, w.width, w.bottom - MARGIN)
  w.need(box.h + 6)
  const name = w.doc.addImage(b.width, b.height, b.rgba)
  w.ctx.drawPdfImage(name, w.left + (w.width - box.w) / 2, w.y, box.w, box.h)
  w.y += box.h + 8
}

function note(w: Writer, text: string) {
  const size = 8.5
  const line = 11.5
  for (const l of wrap(text, size, w.width)) {
    w.need(line)
    w.text(l, w.left, w.y + 9, size, { color: T.muted })
    w.y += line
  }
  w.y += 6
}

export function writeReportPdf(report: Report): Uint8Array {
  const w = new Writer(report.title)
  for (const l of wrap(report.title, 16, w.width, true)) {
    w.text(l, w.left, w.y + 15, 16, { bold: true })
    w.y += 20
  }
  if (report.subtitle) {
    w.text(fit(report.subtitle, 8.5, w.width), w.left, w.y + 8, 8.5, { color: T.muted })
    w.y += 14
  }
  w.rule(w.y + 2, T.muted)
  w.y += 14

  report.blocks.forEach((b, i) => {
    if (b.kind === 'heading') heading(w, b.text, b.status, keepWith(report.blocks, i, w.width))
    else if (b.kind === 'figure') figure(w, b.svg)
    else if (b.kind === 'image') image(w, b)
    else if (b.kind === 'tiles') tiles(w, b.tiles)
    else if (b.kind === 'table') table(w, b.columns, b.rows)
    else if (b.kind === 'histogram') histogram(w, b)
    else if (b.kind === 'facts') facts(w, b.items)
    else note(w, b.text)
  })

  const count = w.pages.length
  w.pages.forEach((page, i) => {
    w.ctx = page
    const y = A4.height - MARGIN + 4
    w.text(fit(report.title, 7.5, w.width - 80), w.left, y, 7.5, { color: T.muted })
    w.text(`Page ${i + 1} of ${count}`, w.left + w.width, y, 7.5, { color: T.muted, align: 'right' })
  })
  return w.doc.toBytes()
}
