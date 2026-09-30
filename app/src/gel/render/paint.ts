/**
 * Paint a gel scene onto a 2D canvas.
 *
 * The caller's context is expected to be scaled so one unit is one CSS pixel;
 * `opts.scale` says how many device pixels that is, so the raster is built at
 * full resolution. The same function serves the on-screen canvas and the
 * high-resolution exports.
 */

import { rampColour, type GelLook } from './looks'
import { renderRaster, type RasterOptions } from './raster'
import type { GelScene, Rect } from './scene'

export interface PaintOptions extends RasterOptions {
  showDyeFronts: boolean
}

const FONT = 'Inter, system-ui, sans-serif'
const SLAB_RADIUS = 4
const RAN_OFF_COLOUR = '#f59e0b'

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(r.x + radius, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, radius)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, radius)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, radius)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, radius)
  ctx.closePath()
}

/** The slab raster as a canvas of its own, for drawing or encoding. */
export function rasterCanvas(scene: GelScene, look: GelLook, opts: RasterOptions): HTMLCanvasElement | null {
  const raster = renderRaster(scene, look, opts)
  const off = document.createElement('canvas')
  off.width = raster.width
  off.height = raster.height
  const octx = off.getContext('2d')
  if (!octx) return null
  const img = octx.createImageData(raster.width, raster.height)
  if (img.data.length !== raster.data.length) return null
  img.data.set(raster.data)
  octx.putImageData(img, 0, 0)
  return off
}

export function paintGel(ctx: CanvasRenderingContext2D, scene: GelScene, look: GelLook, opts: PaintOptions): void {
  const { slab } = scene

  const { figure } = scene
  ctx.clearRect(0, 0, scene.width, scene.height)
  ctx.fillStyle = look.frame
  ctx.fillRect(figure.x, figure.y, figure.w, figure.h)

  // Slab
  ctx.save()
  roundRect(ctx, slab, SLAB_RADIUS)
  ctx.clip()
  if (look.vector) {
    ctx.fillStyle = rampColour(look, 0)
    ctx.fillRect(slab.x, slab.y, slab.w, slab.h)
  } else {
    const off = rasterCanvas(scene, look, opts)
    if (off) ctx.drawImage(off, slab.x, slab.y, slab.w, slab.h)
  }

  if (opts.showDyeFronts) {
    for (const dye of scene.dyeFronts) {
      ctx.fillStyle = look.dyeMode === 'shadow' ? 'rgba(0,0,0,0.35)' : dye.color
      ctx.globalAlpha = look.dyeMode === 'shadow' ? 1 : 0.4
      for (const lane of scene.lanes) {
        if (lane.loaded) ctx.fillRect(lane.x, dye.y - 2, lane.w, 4)
      }
      ctx.globalAlpha = 1
    }
  }

  if (look.vector) {
    for (const b of scene.bands) {
      if (b.peak < 0.02) continue
      ctx.fillStyle = rampColour(look, Math.max(0.15, b.peak))
      roundRect(ctx, { x: b.x + 1, y: b.y + b.h / 2 - Math.min(b.h, 8) / 2, w: b.w - 2, h: Math.min(b.h, 8) }, 1)
      ctx.fill()
    }
  }
  ctx.restore()

  ctx.strokeStyle = look.wellRim
  ctx.lineWidth = 1
  roundRect(ctx, { x: slab.x + 0.5, y: slab.y + 0.5, w: slab.w - 1, h: slab.h - 1 }, SLAB_RADIUS)
  ctx.stroke()

  // Wells
  for (const lane of scene.lanes) {
    ctx.fillStyle = look.wellFill
    ctx.fillRect(lane.x, scene.wellY, lane.w, scene.wellH)
    ctx.strokeStyle = look.wellRim
    ctx.strokeRect(lane.x + 0.5, scene.wellY + 0.5, lane.w - 1, scene.wellH - 1)
  }

  // Lane labels: numbers centred, or names rising at 45° from above each well
  ctx.textBaseline = 'alphabetic'
  ctx.font = `10px ${FONT}`
  ctx.fillStyle = look.text
  for (const lane of scene.lanes) {
    if (scene.labelMode === 'names') {
      ctx.save()
      ctx.translate(lane.cx - 2, slab.y - 6)
      ctx.rotate(-Math.PI / 4)
      ctx.textAlign = 'left'
      ctx.fillText(lane.label, 0, 0)
      ctx.restore()
    } else {
      ctx.textAlign = 'center'
      ctx.fillText(lane.label, lane.cx, slab.y - 8)
    }
  }

  // Ladder sizes, with a tick at each band
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const l of scene.sizeLabels) {
    ctx.font = `${l.major ? '600 ' : ''}9px ${FONT}`
    ctx.fillStyle = l.major ? look.text : look.textMuted
    ctx.fillText(l.text, slab.x - 8, l.y)
    ctx.fillRect(slab.x - 5, l.y - 0.5, 4, 1)
  }

  // Fragments that ran off the bottom
  ctx.fillStyle = RAN_OFF_COLOUR
  const arrowY = slab.y + slab.h + 3
  for (const ro of scene.ranOff) {
    const lane = scene.lanes[ro.laneIdx]
    ctx.beginPath()
    ctx.moveTo(lane.cx - 4, arrowY)
    ctx.lineTo(lane.cx + 4, arrowY)
    ctx.lineTo(lane.cx, arrowY + 5)
    ctx.closePath()
    ctx.fill()
  }

  // Caption
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `10px ${FONT}`
  ctx.fillStyle = look.textMuted
  ctx.fillText(scene.caption, figure.x + figure.w - 8, scene.height - 5)
}

/** A standalone canvas holding the whole gel at `opts.scale`, for export. */
export function renderGelCanvas(scene: GelScene, look: GelLook, opts: PaintOptions): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scene.width * opts.scale)
  canvas.height = Math.round(scene.height * opts.scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(opts.scale, opts.scale)
  paintGel(ctx, scene, look, opts)
  return canvas
}
