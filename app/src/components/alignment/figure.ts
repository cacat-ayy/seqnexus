/**
 * Publication figures of an alignment, as SVG.
 *
 * The figure is built from the same paint model and cell rules as the screen
 * (cellLook, logoColorer), so colours, highlighting, dots and translations
 * match the view it was made from, drawn on white with print-friendly
 * colours. Long alignments wrap into blocks of a chosen width, each block
 * with its own ruler and residue numbers at the line ends.
 *
 * Output stays compact: runs of identical cell colour are one rect, and all
 * letters of one colour on a line are one <text> with a position per glyph.
 */

import { residuePrefix, type AlnRow } from '../../msa/model'
import { aminoAcidColor } from '../../msa/colors'
import { logoColumn } from '../../msa/stats'
import type { RowTranslation } from '../../msa/translate'
import type { PaintModel } from './layout'
import { cellLook, logoColorer } from './paint'
import { FIGURE_THEME, type AlnTheme } from './theme'

export interface FigureOptions {
  /** Rows to include (document order), or null for all. */
  rowIds: readonly string[] | null
  c0: number
  c1: number
  /** Columns per line; 0 puts everything on one line. */
  perLine: number
  tracks: { ruler: boolean; logo: boolean; identity: boolean; consensus: boolean }
  /** Residue numbers at the end of each line. */
  numbers: boolean
  fontSize: number
  title?: string
}

export interface Figure {
  svg: string
  width: number
  height: number
}

/** Past this many residue cells a figure gets too large to be useful (and to render). */
export const MAX_FIGURE_CELLS = 250_000

export function figureCells(pm: PaintModel, o: FigureOptions): number {
  const rows = o.rowIds ? o.rowIds.length : pm.doc.rows.length
  return rows * Math.max(0, o.c1 - o.c0)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const r1 = (n: number) => Math.round(n * 10) / 10

/** Collects letters by colour for one line, then writes one <text> per colour. */
class Letters {
  private byColor = new Map<string, { xs: number[]; text: string }>()
  add(color: string, x: number, ch: string) {
    let g = this.byColor.get(color)
    if (!g) { g = { xs: [], text: '' }; this.byColor.set(color, g) }
    g.xs.push(r1(x))
    g.text += ch
  }
  write(out: string[], y: number) {
    for (const [color, g] of this.byColor) {
      out.push(`<text x="${g.xs.join(' ')}" y="${r1(y)}" fill="${color}">${esc(g.text)}</text>`)
    }
    this.byColor.clear()
  }
}

/** Collects same-coloured cell backgrounds, merging horizontal runs. */
class Fills {
  private runs: { x: number; w: number; color: string }[] = []
  add(x: number, w: number, color: string) {
    const last = this.runs[this.runs.length - 1]
    if (last && last.color === color && Math.abs(last.x + last.w - x) < 0.01) last.w += w
    else this.runs.push({ x, w, color })
  }
  write(out: string[], y: number, h: number) {
    for (const r of this.runs) out.push(`<rect x="${r1(r.x)}" y="${r1(y)}" width="${r1(r.w)}" height="${r1(h)}" fill="${r.color}"/>`)
    this.runs = []
  }
}

export function buildFigure(pm: PaintModel, o: FigureOptions, theme: AlnTheme = FIGURE_THEME): Figure {
  const fs = o.fontSize
  const cw = r1(fs * 0.72)
  const rh = r1(fs * 1.5)
  const aah = pm.translating ? r1(rh * 0.8) : 0
  const pitch = rh + aah
  const pad = Math.round(fs * 1.6)
  const ids = o.rowIds ? new Set(o.rowIds) : null
  let rows: AlnRow[] = pm.doc.rows.filter(r => !ids || ids.has(r.id))
  if (pm.pinned && rows.includes(pm.pinned)) rows = [pm.pinned, ...rows.filter(r => r !== pm.pinned)]
  const c0 = Math.max(0, o.c0)
  const c1 = Math.min(pm.width, o.c1)
  const span = Math.max(0, c1 - c0)
  const perLine = o.perLine > 0 ? o.perLine : span
  const charW = fs * 0.62
  const names = rows.map(r => (r.name.length > 30 ? `${r.name.slice(0, 29)}…` : r.name))
  const trackLabels = [o.tracks.logo && 'Logo', o.tracks.identity && (pm.doc.kind === 'protein' ? 'Similarity' : 'Identity'), o.tracks.consensus && 'Consensus']
    .filter(Boolean) as string[]
  const nameW = Math.ceil(Math.max(...names.map(n => n.length), ...trackLabels.map(l => l.length), 4) * charW + fs)
  const maxNum = Math.max(1, ...rows.map(r => residuePrefix(r)[r.seq.length] + (r.start ?? 1)))
  const numW = o.numbers ? Math.ceil(String(maxNum).length * charW + fs) : 0
  const lineW = Math.min(perLine, span) * cw
  const width = Math.ceil(pad * 2 + nameW + lineW + numW)
  const bgMode = pm.view.colorTarget === 'background'
  const judgeRef = pm.view.compareTo === 'reference'
  const logoColor = logoColorer(pm)
  const out: string[] = []
  let y = pad

  if (o.title) {
    out.push(`<text class="t" x="${pad}" y="${r1(y + fs * 1.1)}">${esc(o.title)}</text>`)
    y += fs * 2
  }

  const xOf = (col: number, start: number) => pad + nameW + (col - start) * cw

  const cellRow = (seq: string, tr: RowTranslation | null, top: number, start: number, end: number, judged: boolean, bold = false) => {
    const fills = new Fills()
    const letters = new Letters()
    const dashes: string[] = []
    for (let c = start; c < end; c++) {
      const ch = seq[c]
      const x = xOf(c, start)
      if (ch === '-' || ch === undefined) {
        dashes.push(`M${r1(x + cw * 0.2)} ${r1(top + rh / 2)}h${r1(cw * 0.6)}`)
        continue
      }
      const look = cellLook(pm, ch, c, tr, judged)
      if (look.color && bgMode) fills.add(x, cw, theme.cell(look.color))
      const fill = look.quiet || look.dot ? theme.muted : look.color && !bgMode ? theme.letter(look.color) : theme.text
      letters.add(fill, x + cw / 2, look.dot ? '.' : ch)
    }
    fills.write(out, top, rh)
    if (dashes.length) out.push(`<path d="${dashes.join('')}" stroke="${theme.grid}" stroke-width="1"/>`)
    out.push(bold ? '<g class="b">' : '<g>')
    letters.write(out, top + rh * 0.7)
    out.push('</g>')
  }

  const translation = (tr: RowTranslation, top: number, start: number, end: number) => {
    const letters = new Letters()
    const t = top + rh
    for (const { cols, aa } of tr.codons) {
      if (cols[2] < start || cols[0] >= end) continue
      const together = cols[2] - cols[0] === 2 && cols[0] >= start && cols[2] < end
      const a = together ? cols[0] : cols[1]
      if (a < start || a >= end) continue
      const xa = xOf(a, start)
      const w = (together ? 3 : 1) * cw
      const color = aa === '*' ? theme.danger : aminoAcidColor(aa)
      out.push(`<rect x="${r1(xa + 0.5)}" y="${r1(t + 0.5)}" width="${r1(w - 1)}" height="${r1(aah - 1)}" rx="1.5" fill="${color ? theme.cell(color) : theme.grid}"/>`)
      letters.add(aa === '*' ? theme.danger : theme.text, xa + w / 2, aa)
    }
    out.push('<g class="aa">')
    letters.write(out, t + aah * 0.72)
    out.push('</g>')
    for (const [s, e] of tr.frameshifts) {
      if (e <= start || s >= end) continue
      const xs = xOf(Math.max(s, start), start)
      out.push(`<rect x="${r1(xs)}" y="${r1(top + rh - 1.5)}" width="${r1((Math.min(e, end) - Math.max(s, start)) * cw)}" height="1.5" fill="${theme.danger}"/>`)
    }
  }

  for (let start = c0; start < c1; start += perLine) {
    const end = Math.min(c1, start + perLine)
    const blockTop = y

    if (o.tracks.ruler) {
      const step = cw * 10 >= fs * 4 ? 10 : cw * 20 >= fs * 4 ? 20 : 50
      const labels: string[] = []
      for (let c = start; c < end; c++) {
        const n = c + 1
        if (n % step !== 0 && c !== start) continue
        const x = xOf(c, start) + cw / 2
        labels.push(`<text x="${r1(x)}" y="${r1(y + fs * 0.9)}">${n}</text>`)
        out.push(`<rect x="${r1(x - 0.25)}" y="${r1(y + fs * 1.05)}" width="0.5" height="${r1(fs * 0.35)}" fill="${theme.muted}"/>`)
      }
      out.push(`<g class="r">${labels.join('')}</g>`)
      y += fs * 1.6
    }

    if (o.tracks.logo) {
      const h = rh * 2.6
      const scale = (h - 2) / pm.logoBits
      for (let c = start; c < end; c++) {
        const col = logoColumn(pm.profile, c, pm.doc.kind)
        let yb = y + h
        const x = xOf(c, start)
        for (const { ch, height } of col.letters) {
          const hp = height * scale
          if (hp < 0.4) continue
          const color = theme.letter(logoColor(ch, c) ?? theme.muted)
          // Glyphs at font-size 10: cap height about 7.2, advance 6 in a bold monospace.
          out.push(`<text class="l" transform="translate(${r1(x + cw / 2)} ${r1(yb)}) scale(${r1(cw / 6.2 * 100) / 100} ${Math.round(hp / 7.2 * 100) / 100})" fill="${color}">${ch}</text>`)
          yb -= hp
        }
      }
      out.push(`<text class="k" x="${pad}" y="${r1(y + h * 0.6)}">Logo</text>`)
      y += h + fs * 0.3
    }

    if (o.tracks.identity) {
      const h = rh * 1.4
      for (let c = start; c < end; c++) {
        const v = pm.graph[c]
        const bh = Math.max(v > 0 ? 0.5 : 0, v * (h - 2))
        const color = v >= 0.999 ? theme.good : v >= 0.3 ? theme.fair : theme.bad
        out.push(`<rect x="${r1(xOf(c, start))}" y="${r1(y + h - bh)}" width="${r1(Math.max(0.5, cw - 0.6))}" height="${r1(bh)}" fill="${color}"/>`)
      }
      out.push(`<text class="k" x="${pad}" y="${r1(y + h * 0.75)}">${pm.doc.kind === 'protein' ? 'Similarity' : 'Identity'}</text>`)
      y += h + fs * 0.3
    }

    if (o.tracks.consensus) {
      cellRow(pm.consensus, null, y, start, end, false, true)
      out.push(`<text class="k" x="${pad}" y="${r1(y + rh * 0.7)}">Consensus</text>`)
      y += rh + fs * 0.2
    }

    rows.forEach((row, i) => {
      const tr = pm.translation(row)
      out.push(`<text class="n${row === pm.reference ? ' b' : ''}" x="${pad}" y="${r1(y + rh * 0.7)}">${esc(names[i])}</text>`)
      cellRow(row.seq, tr, y, start, end, !(judgeRef && row === pm.reference))
      if (pm.translating && tr) translation(tr, y, start, end)
      if (o.numbers) {
        const p = residuePrefix(row)
        const shown = p[end] - p[start]
        if (shown > 0) {
          out.push(`<text class="num" x="${r1(pad + nameW + (end - start) * cw + fs * 0.6)}" y="${r1(y + rh * 0.7)}">${p[end] - 1 + (row.start ?? 1)}</text>`)
        }
      }
      y += pitch
    })

    if (blockTop === y) break
    y += rh * 1.2
  }

  const height = Math.ceil(y - rh * 1.2 + pad)
  const style = [
    `text{font-family:${theme.mono};font-size:${fs}px;text-anchor:middle}`,
    `.t{font-family:${theme.sans};font-size:${r1(fs * 1.2)}px;font-weight:600;text-anchor:start;fill:${theme.text}}`,
    `.n,.k{font-family:${theme.sans};text-anchor:start;fill:${theme.text}}`,
    `.k{font-size:${r1(fs * 0.8)}px;fill:${theme.muted};text-transform:uppercase;letter-spacing:0.04em}`,
    `.r text{font-family:${theme.sans};font-size:${r1(fs * 0.75)}px;fill:${theme.muted}}`,
    `.num{font-family:${theme.sans};text-anchor:start;font-size:${r1(fs * 0.85)}px;fill:${theme.muted}}`,
    `.b,.b text{font-weight:700}`,
    `.aa text{font-size:${r1(Math.min(fs, aah * 0.9))}px;font-weight:600}`,
    `.l{font-size:10px;font-weight:700;text-anchor:middle}`,
  ].join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<style>${style}</style><rect width="100%" height="100%" fill="${theme.bg}"/>`
    + out.join('') + '</svg>'
  return { svg, width, height }
}

/** Rasterise a figure to PNG at `scale`, capped to what canvases allow. */
export async function figureToPng(fig: Figure, scale: number): Promise<Blob> {
  const maxSide = 16000
  const s = Math.max(0.5, Math.min(scale, maxSide / fig.width, maxSide / fig.height, Math.sqrt(2.4e8 / (fig.width * fig.height))))
  const img = new Image()
  const url = URL.createObjectURL(new Blob([fig.svg], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The figure could not be drawn'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(fig.width * s)
    canvas.height = Math.round(fig.height * s)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas available')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Print a figure through the browser's print dialog, where "Save as PDF"
 * keeps it vector. Returns false when the pop-up was blocked.
 */
export function printFigure(fig: Figure, title: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
    @page { margin: 12mm; }
    body { margin: 0; }
    svg { display: block; width: 100%; height: auto; }
  </style></head><body>${fig.svg}<script>
    window.onload = function () { setTimeout(function () { window.print(); window.close(); }, 300); };
  </script></body></html>`)
  w.document.close()
  return true
}
