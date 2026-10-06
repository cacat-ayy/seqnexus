/**
 * Publication figures of a mapping, as SVG: a stretch of one reference with
 * its ruler, coverage, variants, the reference's bases when they fit, and
 * the reads, drawn as on screen (the same colour mode, row order and
 * downsampling) but on white with print colours, whatever the app's theme.
 *
 * Colours are plain hex with fill-opacity rather than rgba(), which vector
 * editors such as Illustrator and Inkscape read reliably. Output stays
 * compact: the coverage is one path, and reads are drawn only where a
 * stretch is short enough for them to be told apart (MAX_READ_SPAN).
 */

import { FIGURE_THEME, type AlnTheme } from '../alignment/theme'
import { baseColor, tracePalette } from '../sanger/paint'
import { tickStep, positionLabel } from '../tracks/draw'
import type { Figure } from '../alignment/figure'
import { firstInRow, pairClass, readDiff, type ReadLayout } from '../../ngs/view'
import type { PairClass } from '../../ngs/view'
import { variantLabel, type Variant } from '../../assembly/variants'
import { depthOver, niceMax, type ColorBy, type MapPaintInput } from './mappingPaint'

/** Widest stretch drawn with its reads; wider, the figure shows coverage and variants only. */
export const MAX_READ_SPAN = 20_000

export interface MappingFigureOptions {
  /** Reference positions [from, to). */
  from: number
  to: number
  /** Drawing width of the data, in px (the gutter for labels comes on top). */
  width: number
  title?: string
  tracks: { ruler: boolean; coverage: boolean; variants: boolean; reference: boolean; reads: boolean }
  /** Most rows of reads drawn. */
  maxRows: number
  coverageHeight: number
  strands: boolean
  colorBy: ColorBy
  /** A note under the figure (what was downsampled, the sample), or none. */
  caption?: string
}

export type MappingFigureInput = Pick<MapPaintInput, 'refIndex' | 'refName' | 'length' | 'circular' | 'bases' | 'coverage' | 'levels' | 'pileup' | 'opts'> & {
  layout: ReadLayout | null
  variants: readonly Variant[] | null
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = (n: number) => Math.round(n * 10) / 10
const GUTTER = 96
const PAD = 12
const ROW = 7
const ROW_GAP = 2

export function buildMappingFigure(p: MappingFigureInput, o: MappingFigureOptions, theme: AlnTheme = FIGURE_THEME): Figure {
  const pal = tracePalette(theme)
  const span = Math.max(1, o.to - o.from)
  const pxPerBase = o.width / span
  const xOf = (pos: number) => GUTTER + (pos - o.from) * pxPerBase
  const out: string[] = []
  const label = (x: number, y: number, text: string, extra = '') => out.push(`<text x="${r1(x)}" y="${r1(y)}"${extra}>${esc(text)}</text>`)
  let y = PAD

  if (o.title) {
    out.push(`<text x="${GUTTER}" y="${r1(y + 12)}" class="t">${esc(o.title)}</text>`)
    y += 24
  }

  // ---- Ruler ----
  if (o.tracks.ruler) {
    const step = tickStep(pxPerBase, 80)
    out.push(`<path d="M${GUTTER} ${r1(y + 18)}H${r1(GUTTER + o.width)}" class="g"/>`)
    for (let n = Math.ceil((o.from + 1) / step) * step; n <= o.to; n += step) {
      const x = xOf(n - 1) + pxPerBase / 2
      out.push(`<path d="M${r1(x)} ${r1(y + 14)}V${r1(y + 18)}" class="g"/>`)
      label(x, y + 10, positionLabel(n, step), ' text-anchor="middle" class="m"')
    }
    label(PAD, y + 13, p.refName, ' class="l"')
    y += 24
  }

  // ---- Coverage ----
  if (o.tracks.coverage) {
    const h = o.coverageHeight
    const cols = Math.max(1, Math.min(Math.round(o.width), span))
    const bpp = span / cols
    const depth: { mean: number; forward: number }[] = []
    let top = 1
    for (let c = 0; c < cols; c++) {
      const b0 = o.from + c * bpp
      const d = depthOver(p, b0, b0 + bpp, bpp)
      depth.push(d)
      if (d.mean > top) top = d.mean
    }
    top = niceMax(top)
    const colW = o.width / cols
    const yOf = (v: number) => y + h - (v / top) * h
    // The total, as one area; the forward strand's share over it when asked for.
    const area = (val: (c: number) => number) => {
      let d = `M${GUTTER} ${r1(y + h)}`
      for (let c = 0; c < cols; c++) d += `H${r1(GUTTER + c * colW)}V${r1(yOf(val(c)))}H${r1(GUTTER + (c + 1) * colW)}`
      return d + `V${r1(y + h)}Z`
    }
    out.push(`<path d="${area(c => depth[c].mean)}" fill="${o.strands ? theme.warning : theme.muted}" fill-opacity="${o.strands ? 0.55 : 0.6}"/>`)
    if (o.strands) out.push(`<path d="${area(c => depth[c].mean * Math.max(0, depth[c].forward))}" fill="${theme.good}" fill-opacity="0.6"/>`)
    out.push(`<path d="M${GUTTER} ${r1(y + h)}H${r1(GUTTER + o.width)}" class="g"/>`)
    label(PAD, y + 10, 'Coverage', ' class="l"')
    label(PAD, y + 22, `0 to ${top.toLocaleString()}×`, ' class="m"')
    if (o.strands) {
      out.push(`<rect x="${PAD}" y="${r1(y + 28)}" width="8" height="6" fill="${theme.good}" fill-opacity="0.6"/>`)
      label(PAD + 11, y + 34, 'forward', ' class="m"')
      out.push(`<rect x="${PAD}" y="${r1(y + 38)}" width="8" height="6" fill="${theme.warning}" fill-opacity="0.55"/>`)
      label(PAD + 11, y + 44, 'reverse', ' class="m"')
    }
    y += h + 8
  }

  // ---- Variants ----
  if (o.tracks.variants && p.variants && p.variants.length) {
    const vs = p.variants.filter(v => v.c1 > o.from && v.c0 < o.to)
    for (const v of vs) {
      const x = xOf(v.type === 'Insertion' ? v.c1 : v.c0)
      const w = Math.max(3, (v.type === 'Insertion' ? 0 : v.c1 - v.c0) * pxPerBase)
      const color = v.type === 'SNP' ? baseColor(pal, v.alt) : v.type === 'Insertion' ? theme.accent : theme.text
      out.push(`<rect x="${r1(v.type === 'Insertion' ? x - 1.5 : x)}" y="${r1(y)}" width="${r1(w)}" height="10" fill="${color}" fill-opacity="${r1(0.35 + 0.65 * Math.min(1, v.frequency * 1.5))}"/>`)
    }
    label(PAD, y + 9, `Variants (${vs.length})`, ' class="l"')
    // Labels where there is room: the coding change, else the change itself.
    if (vs.length <= 40) {
      let lastEnd = -Infinity
      for (const v of vs) {
        const x = xOf(v.c0)
        const text = v.coding?.protein ?? variantLabel(v)
        const tw = text.length * 5.6
        if (x - tw / 2 < lastEnd + 4) continue
        label(x, y + 22, text, ' text-anchor="middle" class="m"')
        lastEnd = x + tw / 2
      }
      y += 26
    } else y += 14
  }

  // ---- Reference ----
  if (o.tracks.reference && p.bases && pxPerBase >= 1.5) {
    const letters = pxPerBase >= 7
    for (let q = Math.max(0, o.from); q < Math.min(p.length, o.to); q++) {
      const ch = p.bases[q]
      const x = xOf(q)
      if (letters) label(x + pxPerBase / 2, y + 9, ch, ` text-anchor="middle" class="b" fill="${baseColor(pal, ch)}"`)
      else out.push(`<rect x="${r1(x)}" y="${r1(y + 2)}" width="${r1(Math.max(0.6, pxPerBase - 0.3))}" height="8" fill="${baseColor(pal, ch)}"/>`)
    }
    label(PAD, y + 9, 'Reference', ' class="l"')
    y += 16
  }

  // ---- Reads ----
  if (o.tracks.reads && p.layout && span <= MAX_READ_SPAN) {
    const rows = p.layout.rows.slice(0, o.maxRows)
    const pairColor = (c: PairClass) => ({
      single: theme.muted, proper: theme.muted, mateUnmapped: theme.muted,
      larger: theme.danger, smaller: theme.accent, orientation: theme.good, otherRef: theme.warning,
    })[c]
    const top0 = y
    rows.forEach((row, i) => {
      const ry = top0 + i * (ROW + ROW_GAP)
      for (let k = firstInRow(row, o.from); k < row.length && row[k].x0 < o.to; k++) {
        const r = row[k]
        const a = r.a
        const color = o.colorBy === 'strand' ? (a.flag & 0x10 ? theme.warning : theme.good)
          : o.colorBy === 'pair' ? pairColor(pairClass(a, p.refIndex, p.length, p.circular, p.opts.expected))
            : theme.muted
        const x0 = xOf(Math.max(o.from, r.start))
        const x1 = xOf(Math.min(o.to, r.end))
        if (x1 <= x0) continue
        out.push(`<rect x="${r1(x0)}" y="${r1(ry)}" width="${r1(x1 - x0)}" height="${ROW}" fill="${color}" fill-opacity="${a.mapq === 0 ? 0.2 : 0.45}"/>`)
        if (a.diff === '*') continue
        const d = r.diff ?? (r.diff = readDiff(a))
        for (const del of d.deletions) {
          const dx = xOf(del.pos + r.shift)
          if (dx > GUTTER + o.width || dx + del.len * pxPerBase < GUTTER) continue
          out.push(`<rect x="${r1(dx)}" y="${r1(ry)}" width="${r1(del.len * pxPerBase)}" height="${ROW}" fill="${theme.bg}"/>`)
          out.push(`<path d="M${r1(dx)} ${r1(ry + ROW / 2)}h${r1(del.len * pxPerBase)}" stroke="${theme.text}" stroke-width="0.8"/>`)
        }
        if (span / o.width <= 10) {
          for (const m of d.mismatches) {
            const pos = m.pos + r.shift
            if (pos < o.from || pos >= o.to) continue
            const op = m.qual < 0 ? 1 : Math.max(0.15, Math.min(1, (m.qual - 5) / 15))
            out.push(`<rect x="${r1(xOf(pos))}" y="${r1(ry)}" width="${r1(Math.max(0.8, pxPerBase))}" height="${ROW}" fill="${baseColor(pal, m.base)}" fill-opacity="${r1(op)}"/>`)
          }
        }
        for (const ins of d.insertions) {
          const pos = ins.pos + r.shift
          if (pos <= o.from || pos >= o.to) continue
          if (span / o.width > 2 && ins.bases.length < 10 * span / o.width) continue
          out.push(`<rect x="${r1(xOf(pos) - 0.8)}" y="${r1(ry)}" width="1.6" height="${ROW}" fill="${theme.accent}"/>`)
        }
      }
    })
    label(PAD, top0 + 9, 'Reads', ' class="l"')
    const shown = rows.length
    if (p.layout.rows.length > shown) label(PAD, top0 + 21, `${shown} of ${p.layout.rows.length} rows`, ' class="m"')
    y = top0 + shown * (ROW + ROW_GAP) + 6
  } else if (o.tracks.reads && span > MAX_READ_SPAN) {
    label(GUTTER, y + 10, `Reads are drawn for stretches of ${MAX_READ_SPAN.toLocaleString()} bases or less.`, ' class="m"')
    y += 18
  }

  if (o.caption) {
    label(GUTTER, y + 12, o.caption, ' class="m"')
    y += 18
  }

  const width = Math.ceil(GUTTER + o.width + PAD)
  const height = Math.ceil(y + PAD)
  const style = `text{font-family:${theme.sans};font-size:10px;fill:${theme.text}}`
    + `.t{font-size:14px;font-weight:600}.l{font-weight:600}.m{fill:${theme.muted}}`
    + `.b{font-family:${theme.mono};font-weight:600}.g{stroke:${theme.grid};stroke-width:1;fill:none}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<style>${style}</style><rect width="100%" height="100%" fill="${theme.bg}"/>`
    + out.join('') + '</svg>'
  return { svg, width, height }
}
