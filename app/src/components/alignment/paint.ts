/**
 * Drawing the alignment: residue cells, translation strips, the header tracks
 * (ruler, logo, identity graph, consensus, pinned reference) and the overlay
 * (selection, caret, hover, search hits).
 *
 * Only what is in view is drawn. Cells and header repaint when the content,
 * view or scroll position changes; the overlay is a separate canvas that
 * repaints on pointer movement without touching the residues.
 */

import { aminoAcidColor, cellColorer } from '../../msa/colors'
import { logoColumn } from '../../msa/stats'
import type { RowTranslation } from '../../msa/translate'
import { rulerStep, type HeadTrack, type PaintModel } from './layout'
import type { AlnTheme } from './theme'

/** The visible window: scroll offsets and size, CSS pixels. */
export interface View {
  x: number
  y: number
  w: number
  h: number
}

export interface Selection {
  rowIds: readonly string[]
  c0: number
  c1: number
}

export interface Caret {
  rowId: string
  col: number
}

export interface OverlayState {
  selection: Selection | null
  caret: Caret | null
  editing: boolean
  insertMode: boolean
  hover: { row: number; col: number } | null
  hits: readonly { rowId: string; c0: number; c1: number }[]
  currentHit: number
}

function visibleCols(pm: PaintModel, v: View): [number, number] {
  const c0 = Math.max(0, Math.floor(v.x / pm.m.cellW))
  const c1 = Math.min(pm.width, Math.ceil((v.x + v.w) / pm.m.cellW) + 1)
  return [c0, c1]
}

function setFont(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, size = pm.m.font, weight = 500) {
  ctx.font = `${weight} ${size}px ${theme.mono}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface CellLook {
  /** Scheme colour, or null for none. */
  color: string | null
  /** Left uncoloured by highlighting (matches in "differences" mode, and the reverse). */
  quiet: boolean
  /** Drawn as a dot: the same as the comparison. */
  dot: boolean
}

/**
 * How one residue is shown. Shared by the screen and figure export, so a
 * figure looks exactly like the view it was made from.
 */
export function cellLook(
  pm: PaintModel, ch: string, c: number, tr: RowTranslation | null, judged: boolean,
  byTranslation = pm.scheme === 'translation', highlight = pm.view.highlight, dots = pm.view.dots,
): CellLook {
  let color: string | null = byTranslation
    ? (tr && tr.aa[c] ? aminoAcidColor(String.fromCharCode(tr.aa[c])) : null)
    : pm.colorer(ch, c)
  let quiet = false
  let dot = false
  if (judged) {
    const same = ch === pm.compare[c]
    if ((highlight === 'differences' && same) || (highlight === 'matches' && !same)) quiet = true
    if (dots && same) dot = true
  }
  if (quiet || dot) color = null
  return { color, quiet, dot }
}

/**
 * One row's residues across columns [c0, c1) at `y`. `judged` turns on
 * highlighting and dots against `pm.compare`; the reference row is never
 * judged against itself.
 */
function drawCells(
  ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme,
  seq: string, tr: RowTranslation | null, y: number, c0: number, c1: number, vx: number, judged: boolean,
) {
  const { cellW, font, rowH } = pm.m
  const { highlight, dots, colorTarget } = pm.view
  const byTranslation = pm.scheme === 'translation'
  const bgMode = colorTarget === 'background' || font === 0
  const cy = y + rowH / 2 + 0.5
  const h = font ? rowH - 1 : rowH
  for (let c = c0; c < c1; c++) {
    const ch = seq[c]
    const x = c * cellW - vx
    if (ch === '-' || ch === undefined) {
      if (font) {
        ctx.fillStyle = theme.grid
        ctx.fillRect(x + cellW * 0.2, cy - 0.5, cellW * 0.6, 1)
      }
      continue
    }
    const { color, quiet, dot } = cellLook(pm, ch, c, tr, judged, byTranslation, highlight, dots)
    if (color && bgMode) {
      ctx.fillStyle = theme.cell(color)
      ctx.fillRect(x, y, cellW, h)
    } else if (!font && !quiet && !dot) {
      // Too small for letters: an uncoloured residue still shows as a block, so gaps stand out.
      ctx.fillStyle = theme.grid
      ctx.fillRect(x, y + 1, cellW, h - 2)
    }
    if (!font) continue
    ctx.fillStyle = quiet || dot ? theme.muted : color && !bgMode ? theme.letter(color) : theme.text
    ctx.fillText(dot ? '·' : ch, x + cellW / 2, cy)
  }
}

/** First codon whose last column is at or after `col`. */
function firstCodon(tr: RowTranslation, col: number): number {
  let lo = 0
  let hi = tr.codons.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (tr.codons[mid].cols[2] < col) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** The amino acid strip under a row, and the row's frame-shifting gaps. */
function drawTranslation(
  ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme,
  tr: RowTranslation, y: number, c0: number, c1: number, vx: number,
) {
  const { cellW, font, rowH, aaH } = pm.m
  const top = y + rowH
  const aaFont = Math.max(0, Math.min(font, aaH - 3))
  if (aaFont) setFont(ctx, pm, theme, aaFont, 600)
  for (let i = firstCodon(tr, c0); i < tr.codons.length; i++) {
    const { cols, aa } = tr.codons[i]
    if (cols[0] >= c1) break
    const together = cols[2] - cols[0] === 2
    const xa = (together ? cols[0] : cols[1]) * cellW - vx
    const xb = (together ? cols[2] + 1 : cols[1] + 1) * cellW - vx
    const stop = aa === '*'
    const color = stop ? theme.danger : aminoAcidColor(aa)
    ctx.fillStyle = color ? theme.cell(color) : theme.grid
    const inset = cellW >= 4 ? 1 : 0
    ctx.fillRect(xa + inset, top + 1, xb - xa - inset * 2, aaH - 2)
    if (aaFont && xb - xa >= aaFont * 0.7) {
      ctx.fillStyle = stop ? theme.danger : theme.text
      ctx.fillText(aa, (xa + xb) / 2, top + aaH / 2 + 0.5)
    }
  }
  // Gap runs that shift the frame: a red underline across the gap.
  ctx.fillStyle = theme.danger
  for (const [s, e] of tr.frameshifts) {
    if (e <= c0 || s >= c1) continue
    ctx.fillRect(s * cellW - vx, y + rowH - 2, (e - s) * cellW, 2)
  }
  if (aaFont) setFont(ctx, pm, theme)
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

export function paintBody(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, v: View) {
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, v.w, v.h)
  const { pitch, font } = pm.m
  const [c0, c1] = visibleCols(pm, v)
  const r0 = Math.max(0, Math.floor(v.y / pitch))
  const r1 = Math.min(pm.bodyRows.length, Math.ceil((v.y + v.h) / pitch))
  if (font) setFont(ctx, pm, theme)
  const judgeRef = pm.view.compareTo === 'reference'
  for (let r = r0; r < r1; r++) {
    const row = pm.bodyRows[r]
    const y = r * pitch - v.y
    const tr = pm.translation(row)
    drawCells(ctx, pm, theme, row.seq, tr, y, c0, c1, v.x, !(judgeRef && row === pm.reference))
    if (pm.translating && tr) drawTranslation(ctx, pm, theme, tr, y, c0, c1, v.x)
    if (font && pm.translating) {
      ctx.fillStyle = theme.rowSep
      ctx.fillRect(0, y + pitch - 1, v.w, 1)
    }
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

const glyphCache = new Map<string, { asc: number; desc: number; left: number; w: number }>()

/** A letter stretched to fill a w×h box (for logos). */
function drawStretchedGlyph(ctx: CanvasRenderingContext2D, theme: AlnTheme, ch: string, x: number, y: number, w: number, h: number) {
  const key = `${theme.mono}|${ch}`
  let g = glyphCache.get(key)
  if (!g) {
    ctx.font = `700 100px ${theme.mono}`
    const m = ctx.measureText(ch)
    g = {
      asc: m.actualBoundingBoxAscent || 72,
      desc: m.actualBoundingBoxDescent || 0,
      left: m.actualBoundingBoxLeft || 0,
      w: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) || m.width,
    }
    glyphCache.set(key, g)
  }
  ctx.save()
  ctx.font = `700 100px ${theme.mono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.translate(x, y)
  ctx.scale(w / g.w, h / (g.asc + g.desc))
  ctx.fillText(ch, g.left, g.asc)
  ctx.restore()
}

function paintRuler(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, t: HeadTrack, v: View, c0: number, c1: number) {
  const { cellW } = pm.m
  const step = rulerStep(cellW)
  const minor = step >= 10 && step / 10 * cellW >= 6 ? step / 10 : step >= 5 && step / 5 * cellW >= 6 ? step / 5 : 0
  ctx.font = `10px ${theme.sans}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, t.y + t.h - 1, v.w, 1)
  for (let c = c0; c < c1; c++) {
    const n = c + 1
    const x = c * cellW - v.x + cellW / 2
    if (n % step === 0 || n === 1) {
      ctx.fillStyle = theme.muted
      ctx.fillRect(Math.round(x), t.y + t.h - 6, 1, 5)
      ctx.fillText(n.toLocaleString(), x, t.y + t.h - 8)
    } else if (minor && n % minor === 0) {
      ctx.fillStyle = theme.grid
      ctx.fillRect(Math.round(x), t.y + t.h - 4, 1, 3)
    }
  }
}

/**
 * Letter colours for a logo. Schemes that colour by column agreement (or not
 * at all) say nothing about a letter on its own, so those fall back to the
 * plain residue palette.
 */
export function logoColorer(pm: PaintModel): (ch: string, col: number) => string | null {
  const plain = cellColorer(pm.doc.kind === 'dna' ? 'nucleotide' : 'zappo', pm.doc.kind, pm.profile, () => '-')
  const residueOnly = pm.scheme === 'translation' || pm.scheme === 'none' || pm.scheme === 'identity' || pm.scheme === 'blosum62'
  return (ch, col) => (residueOnly ? plain(ch, col) : pm.colorer(ch, col) ?? plain(ch, col))
}

function paintLogo(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, t: HeadTrack, v: View, c0: number, c1: number) {
  const { cellW } = pm.m
  const scale = (t.h - 3) / pm.logoBits
  const bottom = t.y + t.h - 1
  const colorOf = logoColorer(pm)
  const letters = cellW >= 6
  for (let c = c0; c < c1; c++) {
    const col = logoColumn(pm.profile, c, pm.doc.kind)
    let yb = bottom
    const x = c * cellW - v.x
    for (const { ch, height } of col.letters) {
      const hpx = height * scale
      if (hpx < 0.5) continue
      const color = colorOf(ch, c) ?? theme.muted
      ctx.fillStyle = theme.letter(color)
      if (letters && hpx >= 2) drawStretchedGlyph(ctx, theme, ch, x + 0.5, yb - hpx, cellW - 1, hpx)
      else ctx.fillRect(x, yb - hpx, Math.max(1, cellW - (cellW > 3 ? 1 : 0)), hpx)
      yb -= hpx
    }
  }
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, bottom, v.w, 1)
}

function paintGraph(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, t: HeadTrack, v: View, c0: number, c1: number) {
  const { cellW } = pm.m
  const bottom = t.y + t.h - 2
  const max = t.h - 5
  const bw = Math.max(1, cellW - (cellW > 3 ? 1 : 0))
  for (let c = c0; c < c1; c++) {
    const val = pm.graph[c]
    const h = Math.max(val > 0 ? 1 : 0, val * max)
    ctx.fillStyle = val >= 0.999 ? theme.good : val >= 0.3 ? theme.fair : theme.bad
    ctx.fillRect(c * cellW - v.x, bottom - h, bw, h)
  }
  ctx.fillStyle = theme.grid
  ctx.fillRect(0, bottom, v.w, 1)
}

export function paintHead(
  ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, v: View,
  marks: { hoverCol: number | null; selection: Selection | null },
) {
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, v.w, pm.headH)
  const [c0, c1] = visibleCols(pm, v)
  const { cellW } = pm.m
  // Selected and hovered columns, behind everything.
  if (marks.selection) {
    ctx.fillStyle = theme.accent
    ctx.globalAlpha = 0.12
    ctx.fillRect(marks.selection.c0 * cellW - v.x, 0, (marks.selection.c1 - marks.selection.c0) * cellW, pm.headH)
    ctx.globalAlpha = 1
  }
  for (const t of pm.head) {
    if (t.id === 'ruler') paintRuler(ctx, pm, theme, t, v, c0, c1)
    else if (t.id === 'logo') paintLogo(ctx, pm, theme, t, v, c0, c1)
    else if (t.id === 'identity') paintGraph(ctx, pm, theme, t, v, c0, c1)
    else if (t.id === 'consensus') {
      if (pm.m.font) setFont(ctx, pm, theme, pm.m.font, 700)
      drawCells(ctx, pm, theme, pm.consensus, null, t.y, c0, c1, v.x, false)
    } else if (t.id === 'reference' && pm.pinned) {
      if (pm.m.font) setFont(ctx, pm, theme)
      const tr = pm.translation(pm.pinned)
      drawCells(ctx, pm, theme, pm.pinned.seq, tr, t.y, c0, c1, v.x, false)
      if (pm.translating && tr) drawTranslation(ctx, pm, theme, tr, t.y, c0, c1, v.x)
      ctx.fillStyle = theme.accent
      ctx.globalAlpha = 0.6
      ctx.fillRect(0, t.y + t.h - 2, v.w, 2)
      ctx.globalAlpha = 1
    }
  }
  if (marks.hoverCol !== null) {
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1
    ctx.strokeRect(marks.hoverCol * cellW - v.x + 0.5, 0.5, cellW - 1, pm.headH - 1)
  }
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

/** Display row indices of the given ids, sorted, grouped into contiguous runs. */
export function rowRuns(pm: PaintModel, ids: readonly string[]): [number, number][] {
  const want = new Set(ids)
  const idx: number[] = []
  pm.bodyRows.forEach((r, i) => { if (want.has(r.id)) idx.push(i) })
  const runs: [number, number][] = []
  for (const i of idx) {
    const last = runs[runs.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else runs.push([i, i + 1])
  }
  return runs
}

export function paintOverlay(ctx: CanvasRenderingContext2D, pm: PaintModel, theme: AlnTheme, v: View, s: OverlayState) {
  ctx.clearRect(0, 0, v.w, v.h)
  const { cellW, pitch, rowH } = pm.m
  const rowIndex = new Map(pm.bodyRows.map((r, i) => [r.id, i]))

  if (s.hover) {
    ctx.fillStyle = theme.accent
    ctx.globalAlpha = 0.06
    ctx.fillRect(s.hover.col * cellW - v.x, 0, cellW, v.h)
    ctx.globalAlpha = 1
  }

  // Search hits, then the current one stronger.
  if (s.hits.length) {
    ctx.strokeStyle = theme.warning
    ctx.lineWidth = 1.5
    const top = Math.floor(v.y / pitch)
    const bottom = Math.ceil((v.y + v.h) / pitch)
    s.hits.forEach((hit, i) => {
      const r = rowIndex.get(hit.rowId)
      if (r === undefined || r < top || r > bottom) return
      const x = hit.c0 * cellW - v.x
      const w = (hit.c1 - hit.c0) * cellW
      if (x > v.w || x + w < 0) return
      const y = r * pitch - v.y
      if (i === s.currentHit) {
        ctx.fillStyle = theme.warning
        ctx.globalAlpha = 0.25
        ctx.fillRect(x, y, w, rowH)
        ctx.globalAlpha = 1
      }
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, rowH - 1.5)
    })
  }

  if (s.selection && s.selection.c1 > s.selection.c0) {
    const x = s.selection.c0 * cellW - v.x
    const w = (s.selection.c1 - s.selection.c0) * cellW
    for (const [a, b] of rowRuns(pm, s.selection.rowIds)) {
      const y = a * pitch - v.y
      const h = (b - a) * pitch
      if (y > v.h || y + h < 0) continue
      ctx.fillStyle = theme.accent
      ctx.globalAlpha = 0.2
      ctx.fillRect(x, y, w, h)
      ctx.globalAlpha = 1
      ctx.strokeStyle = theme.accent
      ctx.lineWidth = 1.5
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5)
    }
  }

  if (s.caret && s.editing) {
    const r = rowIndex.get(s.caret.rowId)
    if (r !== undefined) {
      const x = s.caret.col * cellW - v.x
      const y = r * pitch - v.y
      ctx.fillStyle = theme.text
      if (s.insertMode) ctx.fillRect(Math.round(x) - 1, y, 2, rowH)
      else {
        ctx.strokeStyle = theme.text
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, cellW - 2, rowH - 2)
      }
    }
  }

  if (s.hover) {
    const y = s.hover.row * pitch - v.y
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1
    ctx.strokeRect(s.hover.col * cellW - v.x + 0.5, y + 0.5, cellW - 1, rowH - 1)
  }
}
