/**
 * An SVG figure as a vector PDF, through the app's own PDF writer.
 *
 * The figure builders (alignment, trace, mapping) write SVG for SVG and PNG
 * export. Rather than draw every figure a second time for PDF, this reads
 * that SVG and paints it on a PdfCanvas. It handles the subset the builders
 * write, which is also what simple vector editors write:
 * - elements: svg, g, rect (rx), path, line, circle, polyline, polygon,
 *   text (an x per glyph, dy), clipPath, and a <style> sheet;
 * - path commands M L H V C Q Z, absolute and relative (arcs, never written
 *   by the builders, are drawn as straight lines to their end point);
 * - transform: translate, scale, rotate, matrix;
 * - CSS: type, class and descendant selectors, with the cascade a browser
 *   uses (a presentation attribute loses to any style rule, rules rank by
 *   specificity then order, a style attribute wins over both, and the
 *   inherited properties pass down);
 * - fill, stroke, their opacities, opacity, stroke width, line join and
 *   cap, dashes, font family, size and weight, text-anchor,
 *   text-transform and line-through.
 *
 * The page is the figure at its own size, a CSS pixel being 0.75 pt, so it
 * places in a layout program at the size it was made. Fonts are the PDF
 * standard fonts (fonts.ts): monospaced families print in Courier, the rest
 * in Helvetica.
 */

import { PdfDocument } from './document'
import type { PdfCanvas } from './canvas'

/** One CSS pixel in points. */
const PT_PER_PX = 0.75
/** The largest page side PDF readers accept (200 inches), in points. */
const MAX_PAGE = 14_400

type Props = Record<string, string>

const INHERITED = new Set([
  'fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linejoin', 'stroke-linecap',
  'stroke-dasharray', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'text-transform',
  'text-decoration',
])
const PROPERTIES = new Set([...INHERITED, 'opacity', 'clip-path'])
const INITIAL: Props = {
  fill: '#000000', stroke: 'none', 'stroke-width': '1', 'font-size': '16', 'font-family': 'sans-serif',
  'font-weight': '400', 'text-anchor': 'start', 'text-transform': 'none', 'text-decoration': 'none',
}

// ---- Style sheet ----

interface Compound { tag: string | null; classes: string[] }
interface Rule { chain: Compound[]; specificity: number; order: number; decls: Props }

/** Declarations as properties, the font shorthand spread out. */
function parseDecls(text: string): Props {
  const out: Props = {}
  for (const part of text.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const prop = part.slice(0, i).trim().toLowerCase()
    const value = part.slice(i + 1).replace(/!important/i, '').trim()
    if (!value) continue
    if (prop === 'font') Object.assign(out, parseFont(value))
    else out[prop] = value
  }
  return out
}

/** The font shorthand: [style] [weight] size[/line-height] family. */
function parseFont(value: string): Props {
  // The size is the first word with a unit, so a weight such as 600 is not taken for it.
  const m = /^((?:\S+\s+)*?)([\d.]+)(px|pt)(?:\/\S+)?\s+(.+)$/.exec(value)
  if (!m) return {}
  const out: Props = { 'font-size': m[3] === 'pt' ? String(parseFloat(m[2]) / PT_PER_PX) : m[2], 'font-family': m[4] }
  for (const word of m[1].trim().split(/\s+/)) {
    if (/^(\d{3}|bold|bolder|normal|lighter)$/.test(word)) out['font-weight'] = word
    else if (/^(italic|oblique)$/.test(word)) out['font-style'] = word
  }
  return out
}

function parseCompound(s: string): Compound | null {
  const m = /^([a-zA-Z][\w-]*|\*)?((?:\.[\w-]+)*)$/.exec(s)
  if (!m || (!m[1] && !m[2])) return null
  return { tag: m[1] && m[1] !== '*' ? m[1].toLowerCase() : null, classes: m[2] ? m[2].slice(1).split('.') : [] }
}

/** The rules of a sheet; selectors it cannot match (ids, attributes, pseudo-classes) are left out. */
export function parseStyleSheet(css: string): Rule[] {
  const rules: Rule[] = []
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const decls = parseDecls(m[2])
    for (const sel of m[1].split(',')) {
      const parts = sel.trim().split(/\s+/).filter(Boolean)
      const chain = parts.map(parseCompound)
      if (!chain.length || chain.some(c => !c)) continue
      const cs = chain as Compound[]
      const specificity = cs.reduce((n, c) => n + c.classes.length * 10 + (c.tag ? 1 : 0), 0)
      rules.push({ chain: cs, specificity, order: rules.length, decls })
    }
  }
  return rules
}

function matchesCompound(el: Element, c: Compound): boolean {
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false
  if (!c.classes.length) return true
  const own = (el.getAttribute('class') ?? '').split(/\s+/)
  return c.classes.every(k => own.includes(k))
}

function matches(el: Element, chain: Compound[]): boolean {
  if (!matchesCompound(el, chain[chain.length - 1])) return false
  let k = chain.length - 2
  for (let a = el.parentElement; a && k >= 0; a = a.parentElement) {
    if (matchesCompound(a, chain[k])) k--
  }
  return k < 0
}

// ---- Geometry ----

const num = (v: string | null | undefined, fallback = 0): number => {
  if (v == null) return fallback
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** A length that may be a percentage of a reference length. */
const len = (v: string | null, of: number, fallback = 0): number =>
  v != null && v.trim().endsWith('%') ? (parseFloat(v) / 100) * of : num(v, fallback)

const numbers = (s: string): number[] => (s.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number)

function applyTransform(ctx: PdfCanvas, t: string): void {
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const a = numbers(m[2])
    if (m[1] === 'translate') ctx.translate(a[0] ?? 0, a[1] ?? 0)
    else if (m[1] === 'scale') ctx.scale(a[0] ?? 1, a[1] ?? a[0] ?? 1)
    else if (m[1] === 'matrix' && a.length === 6) ctx.transform(a[0], a[1], a[2], a[3], a[4], a[5])
    else if (m[1] === 'rotate') {
      const [deg = 0, cx = 0, cy = 0] = a
      ctx.translate(cx, cy)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.translate(-cx, -cy)
    }
  }
}

/** Numbers each path command takes. */
const PATH_ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, S: 4, T: 2 }

/** An SVG path's data as canvas path calls. */
export function tracePath(ctx: Pick<PdfCanvas, 'moveTo' | 'lineTo' | 'bezierCurveTo' | 'quadraticCurveTo' | 'closePath'>, d: string): void {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
  let i = 0
  let cmd = ''
  let x = 0, y = 0, sx = 0, sy = 0
  const isCmd = (k: number) => /^[a-z]$/i.test(tokens[k])
  const n = () => Number(tokens[i++])
  while (i < tokens.length) {
    if (isCmd(i)) {
      cmd = tokens[i++]
      if (cmd === 'Z' || cmd === 'z') { ctx.closePath(); x = sx; y = sy }
      continue
    }
    const up = cmd.toUpperCase()
    const need = PATH_ARGS[up]
    // Numbers with no command to take them, or too few for it: skip one.
    let enough = need !== undefined
    for (let k = 0; enough && k < need; k++) if (i + k >= tokens.length || isCmd(i + k)) enough = false
    if (!enough) { i++; continue }
    const rel = cmd !== up
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    if (up === 'M') {
      x = ox + n(); y = oy + n(); sx = x; sy = y
      ctx.moveTo(x, y)
      // Pairs after a move are lines.
      cmd = rel ? 'l' : 'L'
    } else if (up === 'L') {
      x = ox + n(); y = oy + n(); ctx.lineTo(x, y)
    } else if (up === 'H') {
      x = ox + n(); ctx.lineTo(x, y)
    } else if (up === 'V') {
      y = oy + n(); ctx.lineTo(x, y)
    } else if (up === 'C') {
      const x1 = ox + n(), y1 = oy + n(), x2 = ox + n(), y2 = oy + n()
      x = ox + n(); y = oy + n()
      ctx.bezierCurveTo(x1, y1, x2, y2, x, y)
    } else if (up === 'Q') {
      const qx = ox + n(), qy = oy + n()
      x = ox + n(); y = oy + n()
      ctx.quadraticCurveTo(qx, qy, x, y)
    } else {
      // A, S and T, never written by the figures: a straight line to the end point.
      i += need - 2
      x = ox + n(); y = oy + n(); ctx.lineTo(x, y)
    }
  }
}

// ---- Painting ----

interface Ctx {
  ctx: PdfCanvas
  rules: Rule[]
  ids: Map<string, Element>
  width: number
  height: number
}

function computed(el: Element, parent: Props, rules: Rule[]): Props {
  const own: Props = {}
  for (const name of PROPERTIES) {
    const v = el.getAttribute(name)
    if (v != null && v.trim()) own[name] = v.trim()
  }
  const hits = rules.filter(r => matches(el, r.chain)).sort((a, b) => a.specificity - b.specificity || a.order - b.order)
  for (const r of hits) Object.assign(own, r.decls)
  const inline = el.getAttribute('style')
  if (inline) Object.assign(own, parseDecls(inline))
  const out: Props = {}
  for (const name of INHERITED) {
    const v = own[name]
    out[name] = v === undefined || v === 'inherit' ? parent[name] : v
  }
  // Opacity is not inherited, but a group's applies to all it holds.
  out.opacity = String(num(parent.opacity, 1) * num(own.opacity, 1))
  if (own['clip-path']) out['clip-path'] = own['clip-path']
  return out
}

const isNone = (paint: string | undefined) => !paint || paint === 'none' || paint === 'transparent'

function paintShape(c: Ctx, p: Props, build: () => void, fillable = true): void {
  const { ctx } = c
  const alpha = num(p.opacity, 1)
  if (fillable && !isNone(p.fill)) {
    ctx.beginPath(); build()
    ctx.fillStyle = p.fill
    ctx.globalAlpha = alpha * num(p['fill-opacity'], 1)
    ctx.fill()
  }
  if (!isNone(p.stroke)) {
    const w = num(p['stroke-width'], 1)
    if (w <= 0) return
    ctx.beginPath(); build()
    ctx.strokeStyle = p.stroke
    ctx.lineWidth = w
    ctx.lineJoin = (p['stroke-linejoin'] as CanvasLineJoin) || 'miter'
    ctx.lineCap = (p['stroke-linecap'] as CanvasLineCap) || 'butt'
    const dash = p['stroke-dasharray'] && p['stroke-dasharray'] !== 'none' ? numbers(p['stroke-dasharray']) : []
    ctx.setLineDash(dash)
    ctx.globalAlpha = alpha * num(p['stroke-opacity'], 1)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

function fontOf(p: Props): string {
  const w = p['font-weight']
  const weight = w === 'bold' || w === 'bolder' ? 700 : w === 'normal' || w === 'lighter' ? 400 : num(w, 400)
  return `${weight} ${num(p['font-size'], 16)}px ${p['font-family']}`
}

function paintText(c: Ctx, el: Element, p: Props): void {
  const { ctx } = c
  let text = (el.textContent ?? '').replace(/\s+/g, ' ')
  if (!text.trim()) return
  if (p['text-transform'] === 'uppercase') text = text.toUpperCase()
  else if (p['text-transform'] === 'lowercase') text = text.toLowerCase()
  const size = num(p['font-size'], 16)
  const xs = numbers(el.getAttribute('x') ?? '0')
  const dy = el.getAttribute('dy')
  const y = (numbers(el.getAttribute('y') ?? '0')[0] ?? 0) + (dy ? (dy.trim().endsWith('em') ? parseFloat(dy) * size : num(dy)) : 0)
  ctx.font = fontOf(p)
  ctx.textBaseline = 'alphabetic'
  const anchor = p['text-anchor']
  ctx.textAlign = anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left'
  if (isNone(p.fill)) return
  ctx.fillStyle = p.fill
  ctx.globalAlpha = num(p.opacity, 1) * num(p['fill-opacity'], 1)
  const strike = /line-through/.test(p['text-decoration'] ?? '')
  // One position per glyph: each glyph is its own chunk, anchored on its x.
  const chunks: { s: string; x: number }[] = xs.length > 1
    ? [...text].map((ch, k) => ({ s: ch, x: xs[Math.min(k, xs.length - 1)] + (k >= xs.length ? ctx.measureText(text.slice(xs.length - 1, k)).width : 0) }))
    : [{ s: text, x: xs[0] ?? 0 }]
  for (const { s, x } of chunks) {
    ctx.fillText(s, x, y)
    if (strike) {
      const w = ctx.measureText(s).width
      const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x
      ctx.fillRect(left, y - size * 0.32, w, Math.max(0.5, size * 0.07))
    }
  }
}

function clipTo(c: Ctx, ref: string): void {
  const id = /url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(ref)?.[1]
  const target = id ? c.ids.get(id) : undefined
  if (!target) return
  const { ctx } = c
  ctx.beginPath()
  for (const child of target.children) {
    const t = child.getAttribute('transform')
    if (t) continue // A transformed clip shape is not written by the figures.
    shapePath(c, child)
  }
  ctx.clip()
}

/** The outline of a basic shape, added to the current path. */
function shapePath(c: Ctx, el: Element): boolean {
  const { ctx } = c
  const a = (n: string, of = 0) => len(el.getAttribute(n), of)
  switch (el.localName) {
    case 'rect': {
      const w = a('width', c.width), h = a('height', c.height)
      if (w <= 0 || h <= 0) return false
      const rx = Math.min(num(el.getAttribute('rx') ?? el.getAttribute('ry')), w / 2, h / 2)
      if (rx > 0) ctx.roundRect(a('x', c.width), a('y', c.height), w, h, rx)
      else ctx.rect(a('x', c.width), a('y', c.height), w, h)
      return true
    }
    case 'path':
      tracePath(ctx, el.getAttribute('d') ?? '')
      return true
    case 'line':
      ctx.moveTo(a('x1'), a('y1'))
      ctx.lineTo(a('x2'), a('y2'))
      return true
    case 'circle': {
      const r = a('r')
      if (r <= 0) return false
      ctx.moveTo(a('cx') + r, a('cy'))
      ctx.arc(a('cx'), a('cy'), r, 0, Math.PI * 2)
      return true
    }
    case 'polyline':
    case 'polygon': {
      const pts = numbers(el.getAttribute('points') ?? '')
      if (pts.length < 4) return false
      ctx.moveTo(pts[0], pts[1])
      for (let k = 2; k + 1 < pts.length; k += 2) ctx.lineTo(pts[k], pts[k + 1])
      if (el.localName === 'polygon') ctx.closePath()
      return true
    }
  }
  return false
}

const SKIP = new Set(['style', 'defs', 'clippath', 'title', 'desc', 'metadata', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'symbol', 'script'])

function paint(c: Ctx, el: Element, parent: Props): void {
  const tag = el.localName.toLowerCase()
  if (SKIP.has(tag)) return
  const p = computed(el, parent, c.rules)
  const t = el.getAttribute('transform')
  const clip = p['clip-path']
  const scoped = !!t || !!clip
  if (scoped) {
    c.ctx.save()
    if (t) applyTransform(c.ctx, t)
    if (clip) clipTo(c, clip)
  }
  if (tag === 'g' || tag === 'svg' || tag === 'a') {
    for (const child of el.children) paint(c, child, p)
  } else if (tag === 'text') {
    paintText(c, el, p)
  } else {
    paintShape(c, p, () => { shapePath(c, el) }, tag !== 'line' && tag !== 'polyline')
  }
  if (scoped) c.ctx.restore()
}

/** The figure's SVG as a one-page PDF at the figure's size. */
export function svgToPdf(svg: string, info: { title?: string; subject?: string } = {}): Uint8Array {
  const dom = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = dom.documentElement
  if (!root || root.localName !== 'svg' || dom.getElementsByTagName('parsererror').length) throw new Error('The figure is not valid SVG')
  const vb = numbers(root.getAttribute('viewBox') ?? '')
  const width = vb.length === 4 ? vb[2] : num(root.getAttribute('width'), 0)
  const height = vb.length === 4 ? vb[3] : num(root.getAttribute('height'), 0)
  if (!(width > 0 && height > 0)) throw new Error('The figure has no size')
  const outW = num(root.getAttribute('width'), width)
  const outH = num(root.getAttribute('height'), height)
  const s = PT_PER_PX * Math.min(1, MAX_PAGE / (outW * PT_PER_PX), MAX_PAGE / (outH * PT_PER_PX))

  const doc = new PdfDocument(info)
  const ctx = doc.addPage(outW * s, outH * s)
  const sheet = [...root.getElementsByTagName('style')].map(x => x.textContent ?? '').join('\n')
  const ids = new Map<string, Element>()
  for (const el of root.querySelectorAll('[id]')) ids.set(el.getAttribute('id')!, el)
  ctx.scale((outW * s) / width, (outH * s) / height)
  if (vb.length === 4 && (vb[0] || vb[1])) ctx.translate(-vb[0], -vb[1])
  const c: Ctx = { ctx, rules: parseStyleSheet(sheet), ids, width, height }
  paint(c, root, { ...INITIAL, opacity: '1' })
  return doc.toBytes()
}
