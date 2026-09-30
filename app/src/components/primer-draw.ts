/**
 * Drawing one primer binding site in a SequenceView feature lane.
 *
 * The annealed part is a bar with its arrowhead at the 3' end, like any
 * stranded feature. A tail is not a bar: it does not pair, so it is drawn as
 * a raised line lifting off the bar, and at letter zoom it spells out its
 * bases. Mismatches inside the annealed part are marked in red, with the
 * primer's own base at letter zoom so a mutagenesis primer reads at a glance.
 */

import { baseX, type ZoomLayout } from './zoom-layout'
import { templatePosOf, type PrimerItem } from '../primers/display'

export interface PrimerDrawStyle {
  hovered: boolean
  /** An unsaved workbench pick: dashed and fainter, like any suggestion. */
  preview?: boolean
  /** Outline colour for the bar, derived from the fill by the caller. */
  stroke: string
  mismatch: string
}

type Range = [number, number]

/** A [start, end) span as 1–2 non-wrapping ranges. */
function unwrap(start: number, end: number, seqLen: number): Range[] {
  return start < end ? [[start, end]] : [[start, seqLen], [0, end]]
}

function clip([s, e]: Range, rowStart: number, rowEnd: number): Range | null {
  const a = Math.max(s, rowStart)
  const b = Math.min(e, rowEnd)
  return a < b ? [a, b] : null
}

export function drawPrimerItem(
  ctx: CanvasRenderingContext2D,
  item: PrimerItem,
  ay: number,
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
  seqLen: number,
  style: PrimerDrawStyle,
): void {
  const { primer, site, annotation: foot } = item
  const color = foot.color
  const h = L.annotationRowH
  const midY = ay + h / 2
  const xOf = (pos: number) => baseX(pos, rowStart, L)
  const letters = L.mode === 'letters' && L.bpWidth >= 6.5

  // --- Tails: raised line, bases at letter zoom ---
  if (site.start < site.end) {
    const tails: { range: Range; baseAt: (p: number) => string; joinAt: number }[] = []
    if (foot.start < site.start) {
      tails.push({
        range: [foot.start, site.start],
        joinAt: site.start,
        baseAt: p => {
          const d = site.start - p
          return site.strand === 1 ? site.tail5[site.tail5.length - d] : site.tail3[d - 1]
        },
      })
    }
    if (site.end < foot.end) {
      tails.push({
        range: [site.end, foot.end],
        joinAt: site.end,
        baseAt: p => {
          const d = p - site.end + 1
          return site.strand === 1 ? site.tail3[d - 1] : site.tail5[site.tail5.length - d]
        },
      })
    }

    const lineY = ay + 1.5
    for (const tail of tails) {
      const vis = clip(tail.range, rowStart, rowEnd)
      if (!vis) continue
      const x1 = xOf(vis[0])
      const x2 = xOf(vis[1] - 1) + L.bpWidth
      ctx.strokeStyle = color
      ctx.globalAlpha = style.hovered ? 1 : 0.8
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x1, lineY)
      ctx.lineTo(x2, lineY)
      // Where the tail meets the annealed part it bends down into the bar,
      // which is what makes it read as lifting off the template.
      if (tail.joinAt >= rowStart && tail.joinAt <= rowEnd) {
        const jx = tail.joinAt === site.start ? x2 : x1
        ctx.moveTo(jx, lineY)
        ctx.lineTo(jx, midY)
      }
      ctx.stroke()

      if (letters) {
        ctx.globalAlpha = 1
        ctx.fillStyle = color
        ctx.font = '9px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let p = vis[0]; p < vis[1]; p++) {
          const b = tail.baseAt(p)
          if (b) ctx.fillText(b.toLowerCase(), xOf(p) + L.bpWidth / 2, midY + 2)
        }
      }
    }
    ctx.globalAlpha = 1
  }

  // --- Annealed part: bar with the arrowhead at the 3' end ---
  const threePrime = site.strand === 1 ? site.end : site.start
  for (const seg of unwrap(site.start, site.end, seqLen)) {
    const vis = clip(seg, rowStart, rowEnd)
    if (!vis) continue
    const x1 = xOf(vis[0])
    const x2 = xOf(vis[1] - 1) + L.bpWidth
    const w = x2 - x1
    const arrowW = Math.min(6, w / 3)
    const arrowRight = site.strand === 1 && vis[1] === threePrime
    const arrowLeft = site.strand === -1 && vis[0] === threePrime

    ctx.beginPath()
    if (w < 4) {
      ctx.rect(x1, ay, w, h)
    } else {
      ctx.moveTo(arrowLeft ? x1 + arrowW : x1, ay)
      ctx.lineTo(arrowRight ? x2 - arrowW : x2, ay)
      if (arrowRight) ctx.lineTo(x2, midY)
      ctx.lineTo(arrowRight ? x2 - arrowW : x2, ay + h)
      ctx.lineTo(arrowLeft ? x1 + arrowW : x1, ay + h)
      if (arrowLeft) ctx.lineTo(x1, midY)
      ctx.closePath()
    }
    ctx.fillStyle = color
    ctx.globalAlpha = style.hovered ? 0.55 : style.preview ? 0.14 : 0.3
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = style.hovered ? 2.5 : style.preview ? 1.5 : 1
    if (style.preview) ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    // Name, when the bar has room for it.
    const inner = w - arrowW * 2
    if (inner > 20) {
      ctx.font = '11px sans-serif'
      const label = primer.name
      if (ctx.measureText(label).width <= inner) {
        ctx.fillStyle = style.stroke
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, (x1 + x2) / 2, midY)
      }
    }
  }

  // --- Mismatches ---
  for (const m of site.mismatches) {
    const pos = templatePosOf(site, m, seqLen)
    if (pos < rowStart || pos >= rowEnd) continue
    const x = xOf(pos)
    ctx.fillStyle = style.mismatch
    if (letters) {
      ctx.font = 'bold 10px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(primer.sequence[m], x + L.bpWidth / 2, midY)
    } else {
      ctx.fillRect(x, ay, Math.max(1.5, L.bpWidth), h)
    }
  }
  ctx.textAlign = 'left'
}
