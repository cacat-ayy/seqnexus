/**
 * Canvas emitter for a PlasmidScene.
 *
 * Knows nothing about plasmids: it walks a display list and issues draw calls.
 * All the geometry decisions were made in scene.ts.
 */

import type { PlasmidScene, SceneItem, TextItem } from './scene'

export interface Viewport {
  scale: number
  tx: number
  ty: number
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0 }

function arrowAngleFor(span: number): number {
  return Math.min(0.08, span * 0.2)
}

/** The band body plus its arrowhead, as one closed path. */
function arcBandPath(
  ctx: CanvasRenderingContext2D,
  item: Extract<SceneItem, { kind: 'arcBand' }>,
): void {
  const { cx, cy, radius, startAngle, span, width, strand } = item
  const inner = radius - width / 2
  const outer = radius + width / 2
  const arrow = arrowAngleFor(span)

  ctx.beginPath()
  if (strand === 1) {
    const bodyEnd = startAngle + span - arrow
    const tip = startAngle + span
    ctx.arc(cx, cy, outer, startAngle, bodyEnd)
    ctx.lineTo(cx + Math.cos(tip) * radius, cy + Math.sin(tip) * radius)
    ctx.lineTo(cx + Math.cos(bodyEnd) * inner, cy + Math.sin(bodyEnd) * inner)
    ctx.arc(cx, cy, inner, bodyEnd, startAngle, true)
  } else if (strand === -1) {
    const bodyStart = startAngle + arrow
    const tip = startAngle
    ctx.arc(cx, cy, outer, bodyStart, startAngle + span)
    ctx.arc(cx, cy, inner, startAngle + span, bodyStart, true)
    ctx.lineTo(cx + Math.cos(tip) * radius, cy + Math.sin(tip) * radius)
    ctx.lineTo(cx + Math.cos(bodyStart) * outer, cy + Math.sin(bodyStart) * outer)
  } else {
    ctx.arc(cx, cy, outer, startAngle, startAngle + span)
    ctx.arc(cx, cy, inner, startAngle + span, startAngle, true)
  }
  ctx.closePath()
}

function drawText(ctx: CanvasRenderingContext2D, item: TextItem): void {
  ctx.save()
  ctx.font = item.font
  ctx.textAlign = item.align
  ctx.textBaseline = item.baseline
  ctx.translate(item.x, item.y)
  if (item.rotate) ctx.rotate(item.rotate)
  if (item.halo) {
    // Outline in the background colour so labels stay legible over arcs and
    // leader lines without needing an opaque plate behind them.
    ctx.lineWidth = 3
    ctx.lineJoin = 'round'
    ctx.strokeStyle = item.halo
    ctx.strokeText(item.text, 0, 0)
  }
  ctx.fillStyle = item.fill
  ctx.fillText(item.text, 0, 0)
  ctx.restore()
}

function drawCurvedText(
  ctx: CanvasRenderingContext2D,
  item: Extract<SceneItem, { kind: 'curvedText' }>,
): void {
  const { cx, cy, radius, midAngle, text, font, fill, flip } = item
  ctx.save()
  ctx.font = font
  ctx.fillStyle = fill
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const chars = [...text]
  const widths = chars.map(ch => ctx.measureText(ch).width)
  const total = widths.reduce((a, b) => a + b, 0)
  const angularSpan = total / radius

  let angle = flip ? midAngle + angularSpan / 2 : midAngle - angularSpan / 2
  for (let i = 0; i < chars.length; i++) {
    const half = widths[i] / 2 / radius
    angle += flip ? -half : half
    ctx.save()
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius)
    ctx.rotate(flip ? angle - Math.PI / 2 : angle + Math.PI / 2)
    ctx.fillText(chars[i], 0, 0)
    ctx.restore()
    angle += flip ? -half : half
  }
  ctx.restore()
}

export function renderSceneToCanvas(
  ctx: CanvasRenderingContext2D,
  scene: PlasmidScene,
  viewport: Viewport = IDENTITY_VIEWPORT,
): void {
  // The background is painted unscaled so panning cannot expose bare canvas.
  ctx.save()
  ctx.fillStyle = scene.background
  ctx.fillRect(0, 0, scene.size, scene.size)
  ctx.restore()

  ctx.save()
  ctx.translate(viewport.tx, viewport.ty)
  ctx.translate(scene.size / 2, scene.size / 2)
  ctx.scale(viewport.scale, viewport.scale)
  ctx.translate(-scene.size / 2, -scene.size / 2)

  for (const item of scene.items) {
    ctx.globalAlpha = item.kind === 'curvedText' ? 1 : (item.alpha ?? 1)

    switch (item.kind) {
      case 'rect':
        // The scene's own background rect is already painted above.
        if (item.x === 0 && item.y === 0 && item.w === scene.size) break
        ctx.fillStyle = item.fill
        ctx.fillRect(item.x, item.y, item.w, item.h)
        if (item.stroke) {
          ctx.strokeStyle = item.stroke
          ctx.lineWidth = 1
          ctx.strokeRect(item.x + 0.5, item.y + 0.5, item.w - 1, item.h - 1)
        }
        break

      case 'ring':
        ctx.beginPath()
        ctx.arc(item.cx, item.cy, item.radius, 0, Math.PI * 2)
        ctx.strokeStyle = item.stroke
        ctx.lineWidth = item.width
        ctx.setLineDash([])
        ctx.stroke()
        break

      case 'arcBand':
        arcBandPath(ctx, item)
        ctx.fillStyle = item.fill
        ctx.fill()
        if (item.stroke && (item.strokeWidth ?? 0) > 0) {
          ctx.strokeStyle = item.stroke
          ctx.lineWidth = item.strokeWidth ?? 1
          ctx.lineJoin = 'round'
          ctx.setLineDash(item.dash ? [4, 3] : [])
          ctx.stroke()
          ctx.setLineDash([])
        }
        break

      case 'line':
        ctx.beginPath()
        ctx.moveTo(item.x1, item.y1)
        ctx.lineTo(item.x2, item.y2)
        ctx.strokeStyle = item.stroke
        ctx.lineWidth = item.width
        ctx.setLineDash([])
        ctx.stroke()
        break

      case 'dot':
        ctx.beginPath()
        ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2)
        ctx.fillStyle = item.fill
        ctx.fill()
        break

      case 'text':
        drawText(ctx, item)
        break

      case 'curvedText':
        drawCurvedText(ctx, item)
        break
    }
  }

  ctx.globalAlpha = 1
  ctx.restore()
}
