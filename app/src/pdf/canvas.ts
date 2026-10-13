/**
 * A CanvasRenderingContext2D look-alike that writes PDF page content.
 *
 * It implements the part of the 2D canvas API the app's painters use (paths,
 * arcs, rectangles, text, dashes, alpha, save/restore and transforms), so
 * the sequence view and the plasmid map draw into a PDF with the same code
 * that draws them on screen. The page is set up with its origin at the top
 * left and y pointing down, as on a canvas; text is flipped back upright.
 *
 * Two things differ from a canvas, both deliberate:
 * - Fonts are the PDF standard fonts (see fonts.ts), chosen from the CSS
 *   font string: monospaced families print in Courier, the rest in Helvetica,
 *   each in its bold from weight 600.
 * - Single letters set one cell apart, which is how the sequence is drawn,
 *   are merged into one text run with character spacing. The bases then
 *   select and copy from the PDF as a sequence rather than as letters.
 *
 * Transforms are emitted as they come, so a path must be painted under the
 * transform it was built in. The painters never transform mid-path.
 */

import { encodeWinAnsi, encodedWidth, pdfFontFor, type PdfFont, type PdfFontId } from './fonts'
import type { PdfDocument } from './document'
import { pdfString } from './document'

type RGBA = [number, number, number, number]

const NAMED: Record<string, RGBA> = {
  black: [0, 0, 0, 1], white: [1, 1, 1, 1], red: [1, 0, 0, 1], green: [0, 0.5, 0, 1],
  blue: [0, 0, 1, 1], gray: [0.5, 0.5, 0.5, 1], grey: [0.5, 0.5, 0.5, 1],
  transparent: [0, 0, 0, 0],
}

let _probe: CanvasRenderingContext2D | null | undefined
/** Any other CSS colour, normalised by the browser's own canvas. */
function normaliseWithCanvas(css: string): string | null {
  if (_probe === undefined) {
    try { _probe = document.createElement('canvas').getContext('2d') } catch { _probe = null }
  }
  if (!_probe) return null
  _probe.fillStyle = '#000000'
  _probe.fillStyle = css
  const out = String(_probe.fillStyle)
  return out === '#000000' && !/^(#000(000)?|black)$/i.test(css.trim()) ? null : out
}

const _colorCache = new Map<string, RGBA>()
/** A CSS colour as RGBA in 0..1; unparseable colours are black. */
export function parseColor(css: string): RGBA {
  const hit = _colorCache.get(css)
  if (hit) return hit
  const out = parseColorUncached(css.trim().toLowerCase(), true)
  _colorCache.set(css, out)
  return out
}

function parseColorUncached(c: string, tryCanvas: boolean): RGBA {
  if (c.startsWith('#')) {
    const h = c.slice(1)
    const expand = h.length <= 4 ? [...h].map(x => x + x).join('') : h
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(expand)) {
      const n = (i: number) => parseInt(expand.slice(i, i + 2), 16) / 255
      return [n(0), n(2), n(4), expand.length === 8 ? n(6) : 1]
    }
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(c)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    const ch = (s: string) => (s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255)
    const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    const rgba: RGBA = [ch(parts[0]), ch(parts[1]), ch(parts[2]), a]
    if (rgba.every(v => Number.isFinite(v))) return rgba.map(v => Math.max(0, Math.min(1, v))) as RGBA
  }
  if (NAMED[c]) return NAMED[c]
  if (tryCanvas) {
    const norm = normaliseWithCanvas(c)
    if (norm) return parseColorUncached(norm.toLowerCase(), false)
  }
  return [0, 0, 0, 1]
}

/** A number for the content stream: two decimals, no exponent, no -0. */
function f(n: number): string {
  const r = Math.round(n * 100) / 100
  return r === 0 ? '0' : String(r)
}

interface DrawState {
  fillStyle: string
  strokeStyle: string
  globalAlpha: number
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  dash: number[]
}

/** What the PDF graphics state was last set to, so unchanged values are not re-sent. */
interface Emitted {
  fill: string
  stroke: string
  fillAlpha: string
  strokeAlpha: string
  lineWidth: number
  lineCap: number
  lineJoin: number
  dash: string
}

/** Letters waiting to be written as one run. */
interface TextRun {
  font: PdfFont
  baselineY: number
  /** Left edge of the first glyph. */
  x0: number
  /** Centre-to-centre distance; 0 until the second letter fixes it. */
  step: number
  lastX: number
  alpha: string
  chars: { ch: string; fill: string }[]
}

const CAPS: Record<CanvasLineCap, number> = { butt: 0, round: 1, square: 2 }
const JOINS: Record<CanvasLineJoin, number> = { miter: 0, round: 1, bevel: 2 }

export class PdfCanvas {
  private readonly ops: string[] = []
  private state: DrawState = {
    fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, lineWidth: 1,
    lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif',
    textAlign: 'start', textBaseline: 'alphabetic', dash: [],
  }
  private emitted: Emitted = {
    fill: '0 0 0 rg', stroke: '0 0 0 RG', fillAlpha: '', strokeAlpha: '',
    lineWidth: 1, lineCap: 0, lineJoin: 0, dash: '[] 0 d',
  }
  private readonly stack: { state: DrawState; emitted: Emitted }[] = []
  private path: string[] = []
  private hasPoint = false
  private cx = 0
  private cy = 0
  private sx = 0
  private sy = 0
  private run: TextRun | null = null

  constructor(private readonly doc: PdfDocument, pageHeight: number) {
    // Top-left origin, y down, as on a canvas.
    this.ops.push(`1 0 0 -1 0 ${f(pageHeight)} cm`)
  }

  /** The page's content stream. */
  content(): string {
    this.flushText()
    return this.ops.join('\n')
  }

  // --- State properties ---

  get fillStyle(): string { return this.state.fillStyle }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) { if (typeof v === 'string') this.state.fillStyle = v }
  get strokeStyle(): string { return this.state.strokeStyle }
  set strokeStyle(v: string | CanvasGradient | CanvasPattern) { if (typeof v === 'string') this.state.strokeStyle = v }
  get globalAlpha(): number { return this.state.globalAlpha }
  set globalAlpha(v: number) { if (Number.isFinite(v)) this.state.globalAlpha = Math.max(0, Math.min(1, v)) }
  get lineWidth(): number { return this.state.lineWidth }
  set lineWidth(v: number) { if (v > 0 && Number.isFinite(v)) this.state.lineWidth = v }
  get lineCap(): CanvasLineCap { return this.state.lineCap }
  set lineCap(v: CanvasLineCap) { this.state.lineCap = v }
  get lineJoin(): CanvasLineJoin { return this.state.lineJoin }
  set lineJoin(v: CanvasLineJoin) { this.state.lineJoin = v }
  get font(): string { return this.state.font }
  set font(v: string) { this.state.font = v }
  get textAlign(): CanvasTextAlign { return this.state.textAlign }
  set textAlign(v: CanvasTextAlign) { this.state.textAlign = v }
  get textBaseline(): CanvasTextBaseline { return this.state.textBaseline }
  set textBaseline(v: CanvasTextBaseline) { this.state.textBaseline = v }
  setLineDash(segments: number[]): void { this.state.dash = segments.filter(n => n >= 0) }
  getLineDash(): number[] { return [...this.state.dash] }

  // --- Save, restore, transforms ---

  save(): void {
    this.flushText()
    this.stack.push({ state: { ...this.state, dash: [...this.state.dash] }, emitted: { ...this.emitted } })
    this.ops.push('q')
  }

  restore(): void {
    const top = this.stack.pop()
    if (!top) return
    this.flushText()
    this.state = top.state
    this.emitted = top.emitted
    this.ops.push('Q')
  }

  transform(a: number, b: number, c: number, d: number, e: number, g: number): void {
    this.flushText()
    this.ops.push(`${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)} cm`)
  }

  translate(x: number, y: number): void {
    if (x !== 0 || y !== 0) this.transform(1, 0, 0, 1, x, y)
  }

  scale(x: number, y: number): void {
    if (x !== 1 || y !== 1) this.transform(x, 0, 0, y, 0, 0)
  }

  rotate(angle: number): void {
    if (angle === 0) return
    // Rounded to 4 places: a rotation is all about its small entries.
    const r = (n: number) => Math.round(n * 1e4) / 1e4
    const c = r(Math.cos(angle))
    const s = r(Math.sin(angle))
    this.flushText()
    this.ops.push(`${c} ${s} ${-s} ${c} 0 0 cm`)
  }

  // --- Paths ---

  beginPath(): void {
    this.path = []
    this.hasPoint = false
  }

  moveTo(x: number, y: number): void {
    this.path.push(`${f(x)} ${f(y)} m`)
    this.cx = this.sx = x
    this.cy = this.sy = y
    this.hasPoint = true
  }

  lineTo(x: number, y: number): void {
    if (!this.hasPoint) { this.moveTo(x, y); return }
    this.path.push(`${f(x)} ${f(y)} l`)
    this.cx = x
    this.cy = y
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.hasPoint) this.moveTo(x1, y1)
    this.path.push(`${f(x1)} ${f(y1)} ${f(x2)} ${f(y2)} ${f(x)} ${f(y)} c`)
    this.cx = x
    this.cy = y
  }

  quadraticCurveTo(qx: number, qy: number, x: number, y: number): void {
    if (!this.hasPoint) this.moveTo(qx, qy)
    const x0 = this.cx, y0 = this.cy
    this.bezierCurveTo(
      x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0),
      x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y),
      x, y,
    )
  }

  closePath(): void {
    if (!this.hasPoint) return
    this.path.push('h')
    this.cx = this.sx
    this.cy = this.sy
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re`)
    this.cx = this.sx = x
    this.cy = this.sy = y
    this.hasPoint = true
  }

  roundRect(x: number, y: number, w: number, h: number, radii?: number | DOMPointInit | (number | DOMPointInit)[]): void {
    const first = Array.isArray(radii) ? radii[0] : radii
    const r0 = typeof first === 'number' ? first : first?.x ?? 0
    const r = Math.max(0, Math.min(r0, Math.abs(w) / 2, Math.abs(h) / 2))
    if (r === 0) { this.rect(x, y, w, h); return }
    this.moveTo(x + r, y)
    this.lineTo(x + w - r, y)
    this.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
    this.lineTo(x + w, y + h - r)
    this.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
    this.lineTo(x + r, y + h)
    this.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
    this.lineTo(x, y + r)
    this.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
    this.closePath()
  }

  /** Canvas arc semantics, as cubic Béziers of at most a quarter turn each. */
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    const TAU = Math.PI * 2
    let sweep: number
    if (!ccw) {
      sweep = a1 - a0 >= TAU ? TAU : ((a1 - a0) % TAU + TAU) % TAU
    } else {
      sweep = a0 - a1 >= TAU ? -TAU : -(((a0 - a1) % TAU + TAU) % TAU)
    }
    const sx = x + r * Math.cos(a0)
    const sy = y + r * Math.sin(a0)
    if (this.hasPoint) this.lineTo(sx, sy)
    else this.moveTo(sx, sy)
    if (sweep === 0 || r <= 0) return
    const n = Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9)
    const step = sweep / n
    const k = (4 / 3) * Math.tan(step / 4)
    let a = a0
    for (let i = 0; i < n; i++) {
      const b = a + step
      const c0 = Math.cos(a), s0 = Math.sin(a), c1 = Math.cos(b), s1 = Math.sin(b)
      this.bezierCurveTo(
        x + r * (c0 - k * s0), y + r * (s0 + k * c0),
        x + r * (c1 + k * s1), y + r * (s1 - k * c1),
        x + r * c1, y + r * s1,
      )
      a = b
    }
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.hasPoint) { this.moveTo(x1, y1); return }
    const x0 = this.cx, y0 = this.cy
    const v1x = x0 - x1, v1y = y0 - y1
    const v2x = x2 - x1, v2y = y2 - y1
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y)
    const cross = v1x * v2y - v1y * v2x
    if (r <= 0 || l1 === 0 || l2 === 0 || Math.abs(cross) < 1e-9) { this.lineTo(x1, y1); return }
    const u1x = v1x / l1, u1y = v1y / l1, u2x = v2x / l2, u2y = v2y / l2
    const theta = Math.acos(Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y)))
    const d = r / Math.tan(theta / 2)
    const t1x = x1 + u1x * d, t1y = y1 + u1y * d
    const t2x = x1 + u2x * d, t2y = y1 + u2y * d
    const bx = u1x + u2x, by = u1y + u2y
    const bl = Math.hypot(bx, by)
    const h = r / Math.sin(theta / 2)
    const ccx = x1 + (bx / bl) * h, ccy = y1 + (by / bl) * h
    const a0 = Math.atan2(t1y - ccy, t1x - ccx)
    const a1 = Math.atan2(t2y - ccy, t2x - ccx)
    let diff = a1 - a0
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    this.lineTo(t1x, t1y)
    this.arc(ccx, ccy, r, a0, a0 + diff, diff < 0)
  }

  // --- Painting ---

  private setFill(): void {
    const [r, g, b, a] = parseColor(this.state.fillStyle)
    const fill = `${f(r)} ${f(g)} ${f(b)} rg`
    if (fill !== this.emitted.fill) { this.ops.push(fill); this.emitted.fill = fill }
    this.setAlpha('fill', a * this.state.globalAlpha)
  }

  private setStroke(): void {
    const [r, g, b, a] = parseColor(this.state.strokeStyle)
    const stroke = `${f(r)} ${f(g)} ${f(b)} RG`
    if (stroke !== this.emitted.stroke) { this.ops.push(stroke); this.emitted.stroke = stroke }
    this.setAlpha('stroke', a * this.state.globalAlpha)
    if (this.state.lineWidth !== this.emitted.lineWidth) {
      this.ops.push(`${f(this.state.lineWidth)} w`)
      this.emitted.lineWidth = this.state.lineWidth
    }
    const cap = CAPS[this.state.lineCap] ?? 0
    if (cap !== this.emitted.lineCap) { this.ops.push(`${cap} J`); this.emitted.lineCap = cap }
    const join = JOINS[this.state.lineJoin] ?? 0
    if (join !== this.emitted.lineJoin) { this.ops.push(`${join} j`); this.emitted.lineJoin = join }
    // Canvas repeats an odd-length dash list to make it even; PDF does not.
    const d = this.state.dash.length % 2 ? [...this.state.dash, ...this.state.dash] : this.state.dash
    const dash = `[${d.map(f).join(' ')}] 0 d`
    if (dash !== this.emitted.dash) { this.ops.push(dash); this.emitted.dash = dash }
  }

  private setAlpha(kind: 'fill' | 'stroke', alpha: number): void {
    const name = alpha >= 0.995 ? '' : this.doc.alphaState(kind, alpha)
    const current = kind === 'fill' ? this.emitted.fillAlpha : this.emitted.strokeAlpha
    if (name === current) return
    this.ops.push(`/${name || this.doc.alphaState(kind, 1)} gs`)
    if (kind === 'fill') this.emitted.fillAlpha = name
    else this.emitted.strokeAlpha = name
  }

  fill(rule: CanvasFillRule | Path2D = 'nonzero'): void {
    if (this.path.length === 0) return
    this.flushText()
    this.setFill()
    this.ops.push(this.path.join(' '), rule === 'evenodd' ? 'f*' : 'f')
  }

  stroke(): void {
    if (this.path.length === 0) return
    this.flushText()
    this.setStroke()
    this.ops.push(this.path.join(' '), 'S')
  }

  clip(rule: CanvasFillRule | Path2D = 'nonzero'): void {
    if (this.path.length === 0) return
    this.flushText()
    this.ops.push(this.path.join(' '), rule === 'evenodd' ? 'W* n' : 'W n')
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    if (w === 0 || h === 0) return
    this.flushText()
    this.setFill()
    this.ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re f`)
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.flushText()
    this.setStroke()
    this.ops.push(`${f(x)} ${f(y)} ${f(w)} ${f(h)} re S`)
  }

  /** A PDF page starts blank; there is nothing to clear. */
  clearRect(): void {}

  /**
   * An image the document holds (PdfDocument.addImage), filling the box at
   * x, y (its top left) of width w and height h.
   */
  drawPdfImage(name: string, x: number, y: number, w: number, h: number): void {
    this.flushText()
    // The page's y runs down, an image's up: flip it into the box.
    this.ops.push(`q ${f(w)} 0 0 ${f(-h)} ${f(x)} ${f(y + h)} cm /${name} Do Q`)
  }

  // --- Text ---

  measureText(text: string): TextMetrics {
    const font = pdfFontFor(this.state.font)
    return { width: encodedWidth(font.id, encodeWinAnsi(text), font.size) } as TextMetrics
  }

  /** Baseline for a y in the current textBaseline, from the font size. */
  private baselineY(y: number, size: number): number {
    switch (this.state.textBaseline) {
      case 'top': return y + size * 0.8
      case 'hanging': return y + size * 0.7
      case 'middle': return y + size * 0.33
      case 'bottom':
      case 'ideographic': return y - size * 0.2
      default: return y
    }
  }

  /** Left edge for an x in the current textAlign. */
  private leftX(x: number, width: number): number {
    switch (this.state.textAlign) {
      case 'center': return x - width / 2
      case 'right':
      case 'end': return x - width
      default: return x
    }
  }

  fillText(text: string, x: number, y: number): void {
    const font = pdfFontFor(this.state.font)
    const enc = encodeWinAnsi(text)
    if (enc.length === 0) return
    const width = encodedWidth(font.id, enc, font.size)
    const left = this.leftX(x, width)
    const base = this.baselineY(y, font.size)
    const [r, g, b, a] = parseColor(this.state.fillStyle)
    const fill = `${f(r)} ${f(g)} ${f(b)} rg`
    const alpha = a * this.state.globalAlpha
    const alphaName = alpha >= 0.995 ? '' : this.doc.alphaState('fill', alpha)

    // Monospaced single letters one cell apart: extend the current run.
    if ((font.id === 'F3' || font.id === 'F4') && enc.length === 1) {
      const run = this.run
      if (run && run.font.id === font.id && run.font.size === font.size
          && Math.abs(run.baselineY - base) < 0.01 && run.alpha === alphaName) {
        const step = x - run.lastX
        if (step > 0 && (run.step === 0 || Math.abs(step - run.step) < 0.01)) {
          run.step = run.step || step
          run.lastX = x
          run.chars.push({ ch: enc, fill })
          return
        }
      }
      this.flushText()
      this.run = { font, baselineY: base, x0: left, step: 0, lastX: x, alpha: alphaName, chars: [{ ch: enc, fill }] }
      return
    }

    this.flushText()
    this.setFill()
    this.ops.push(`BT /${font.id} ${f(font.size)} Tf 0 Tc 0 Tr 1 0 0 -1 ${f(left)} ${f(base)} Tm ${pdfString(enc)} Tj ET`)
  }

  /** Outlined text: the plasmid map's halo behind labels. */
  strokeText(text: string, x: number, y: number): void {
    const font = pdfFontFor(this.state.font)
    const enc = encodeWinAnsi(text)
    if (enc.length === 0) return
    this.flushText()
    this.setStroke()
    const left = this.leftX(x, encodedWidth(font.id, enc, font.size))
    const base = this.baselineY(y, font.size)
    this.ops.push(`BT /${font.id} ${f(font.size)} Tf 0 Tc 1 Tr 1 0 0 -1 ${f(left)} ${f(base)} Tm ${pdfString(enc)} Tj ET`)
  }

  private flushText(): void {
    const run = this.run
    if (!run) return
    this.run = null
    const glyph = encodedWidth(run.font.id as PdfFontId, 'M', run.font.size)
    const spacing = run.chars.length > 1 ? run.step - glyph : 0
    this.setAlphaFor(run.alpha)
    // The letters sit a cell apart, which text extraction reads as spaces
    // ("A C G T"). ActualText gives copy and search the run as written.
    const actual = run.chars.length > 1 ? `/Span << /ActualText ${pdfString(run.chars.map(c => c.ch).join(''))} >> BDC ` : ''
    const parts = [`${actual}BT /${run.font.id} ${f(run.font.size)} Tf ${f(spacing)} Tc 0 Tr 1 0 0 -1 ${f(run.x0)} ${f(run.baselineY)} Tm`]
    let text = ''
    for (const { ch, fill } of run.chars) {
      if (fill !== this.emitted.fill) {
        if (text) { parts.push(`${pdfString(text)} Tj`); text = '' }
        parts.push(fill)
        this.emitted.fill = fill
      }
      text += ch
    }
    if (text) parts.push(`${pdfString(text)} Tj`)
    parts.push(actual ? 'ET EMC' : 'ET')
    this.ops.push(parts.join(' '))
  }

  private setAlphaFor(name: string): void {
    if (name === this.emitted.fillAlpha) return
    this.ops.push(`/${name || this.doc.alphaState('fill', 1)} gs`)
    this.emitted.fillAlpha = name
  }
}

/** The PDF context typed as a canvas context, for painters written against one. */
export function asCanvasContext(ctx: PdfCanvas): CanvasRenderingContext2D {
  // Structural, not nominal: PdfCanvas implements every member the painters
  // touch. The cast is the one place that claim is made.
  return ctx as unknown as CanvasRenderingContext2D
}
