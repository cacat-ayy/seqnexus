/**
 * Drawing one guide site in a SequenceView feature lane.
 *
 * Three things have to be legible at a glance, and they are drawn in that
 * order of prominence:
 *
 * - The protospacer, as a bar with its arrowhead at the 3' end, so the
 *   direction the guide reads is the direction the arrow points.
 * - The PAM, as a solid block in its own shade butted against the bar. It is
 *   part of the target, not of the guide, so it is never inside the arrow.
 * - The cut, as a tick through the bar. A staggered cutter gets two ticks
 *   joined across the middle, which is what makes an overhang visible without
 *   reading any numbers.
 *
 * Colours come from the scene, which reads them from the theme tokens, so a
 * guide looks like a guide in all ten themes and in the print palette.
 */

import { baseX, type ZoomLayout } from './zoom-layout'
import { clipSpan, unwrapSpan } from './primer-draw'
import type { GuideItem } from '../crispr/display'

export interface GuideDrawStyle {
  hovered: boolean
  /** A pick that has not been kept yet: dashed and fainter. */
  preview?: boolean
  /** Picked for conversion into a feature: outlined in the accent colour. */
  picked?: boolean
  accent: string
  /** The protospacer bar. */
  guide: string
  /** The PAM block. */
  pam: string
  /** The cut ticks. */
  cut: string
  /** Label colour, which is the bar's own outline. */
  stroke: string
}

export function drawGuideItem(
  ctx: CanvasRenderingContext2D,
  item: GuideItem,
  ay: number,
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
  seqLen: number,
  style: GuideDrawStyle,
): void {
  const { site } = item.candidate
  const h = L.annotationRowH
  const midY = ay + h / 2
  const xOf = (pos: number) => baseX(pos, rowStart, L)
  const cuts = item.nuclease.cleaves === 'none' || site.offEnd
    ? []
    : site.cutTop === site.cutBottom
      ? [site.cutTop]
      : [site.cutTop, site.cutBottom]

  // --- The PAM: a solid block, inset a little so the bar reads as the guide ---
  for (const seg of unwrapSpan(site.pamStart, site.pamEnd, seqLen)) {
    const vis = clipSpan(seg, rowStart, rowEnd)
    if (!vis) continue
    const x1 = xOf(vis[0])
    const x2 = xOf(vis[1] - 1) + L.bpWidth
    ctx.fillStyle = style.pam
    ctx.globalAlpha = style.hovered ? 0.95 : style.preview ? 0.4 : 0.75
    ctx.fillRect(x1, ay + 1, Math.max(1, x2 - x1), h - 2)
    ctx.globalAlpha = 1
  }

  // --- The protospacer: a bar with the arrowhead at its 3' end ---
  const threePrime = site.strand === 1 ? site.end : site.start
  for (const seg of unwrapSpan(site.start, site.end, seqLen)) {
    const vis = clipSpan(seg, rowStart, rowEnd)
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
    ctx.fillStyle = style.guide
    ctx.globalAlpha = style.hovered ? 0.5 : style.preview ? 0.12 : 0.26
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = style.picked ? style.accent : style.stroke
    ctx.lineWidth = style.picked || style.hovered ? 2.5 : style.preview ? 1.5 : 1
    if (style.preview) ctx.setLineDash([4, 3])
    ctx.stroke()
    ctx.setLineDash([])

    const inner = w - arrowW * 2
    if (inner > 20) {
      ctx.font = '11px sans-serif'
      const label = item.annotation.name
      if (ctx.measureText(label).width <= inner) {
        ctx.fillStyle = style.stroke
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(label, (x1 + x2) / 2, midY)
      }
    }
  }

  // --- The cut, or the pair of them ---
  if (cuts.length > 0) {
    const visible = cuts.filter(c => c >= rowStart && c <= rowEnd)
    ctx.strokeStyle = style.cut
    ctx.lineWidth = style.hovered ? 2 : 1.5
    for (const c of visible) {
      const x = xOf(c)
      ctx.beginPath()
      ctx.moveTo(x, ay - 1)
      ctx.lineTo(x, ay + h + 1)
      ctx.stroke()
    }
    // The stagger: a line across the middle between the two cuts, which only
    // reads as an overhang when both are on this row.
    if (visible.length === 2) {
      const [a, b] = visible
      ctx.beginPath()
      ctx.moveTo(xOf(a), midY)
      ctx.lineTo(xOf(b), midY)
      ctx.stroke()
    }
  }
  ctx.textAlign = 'left'
}
