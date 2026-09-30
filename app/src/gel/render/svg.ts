/**
 * Write a gel scene as SVG.
 *
 * Labels, wells and (for the schematic look) bands are real vector shapes, so
 * they stay sharp and editable in Illustrator or Inkscape. A raster look's
 * slab is a photo by nature; it is embedded as a PNG the caller renders at
 * whatever resolution it wants.
 */

import { rampColour, type GelLook } from './looks'
import type { GelScene } from './scene'

const FONT = 'Inter, system-ui, sans-serif'
const SLAB_RADIUS = 4
const RAN_OFF_COLOUR = '#f59e0b'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const n = (v: number) => (Math.round(v * 100) / 100).toString()

export interface SvgOptions {
  showDyeFronts: boolean
  /** PNG data URL of the slab raster. Required for raster looks. */
  slabPng: string | null
}

export function sceneToSvg(scene: GelScene, look: GelLook, opts: SvgOptions): string {
  const { slab } = scene
  const els: string[] = []
  els.push(`<defs><clipPath id="slab"><rect x="${n(slab.x)}" y="${n(slab.y)}" width="${n(slab.w)}" height="${n(slab.h)}" rx="${SLAB_RADIUS}"/></clipPath></defs>`)
  const { figure } = scene
  els.push(`<rect x="${n(figure.x)}" y="${n(figure.y)}" width="${n(figure.w)}" height="${n(figure.h)}" fill="${look.frame}"/>`)

  const slabEls: string[] = []
  if (look.vector || !opts.slabPng) {
    slabEls.push(`<rect x="${n(slab.x)}" y="${n(slab.y)}" width="${n(slab.w)}" height="${n(slab.h)}" fill="${rampColour(look, 0)}"/>`)
  } else {
    slabEls.push(`<image x="${n(slab.x)}" y="${n(slab.y)}" width="${n(slab.w)}" height="${n(slab.h)}" preserveAspectRatio="none" href="${opts.slabPng}"/>`)
  }
  if (opts.showDyeFronts) {
    for (const dye of scene.dyeFronts) {
      const fill = look.dyeMode === 'shadow' ? 'rgba(0,0,0,0.35)' : dye.color
      const opacity = look.dyeMode === 'shadow' ? '' : ' fill-opacity="0.4"'
      for (const lane of scene.lanes) {
        if (lane.loaded) slabEls.push(`<rect x="${n(lane.x)}" y="${n(dye.y - 2)}" width="${n(lane.w)}" height="4" fill="${fill}"${opacity}/>`)
      }
    }
  }
  if (look.vector) {
    for (const b of scene.bands) {
      if (b.peak < 0.02) continue
      const h = Math.min(b.h, 8)
      slabEls.push(`<rect x="${n(b.x + 1)}" y="${n(b.y + b.h / 2 - h / 2)}" width="${n(b.w - 2)}" height="${n(h)}" rx="1" fill="${rampColour(look, Math.max(0.15, b.peak))}"/>`)
    }
  }
  els.push(`<g clip-path="url(#slab)">${slabEls.join('')}</g>`)
  els.push(`<rect x="${n(slab.x + 0.5)}" y="${n(slab.y + 0.5)}" width="${n(slab.w - 1)}" height="${n(slab.h - 1)}" rx="${SLAB_RADIUS}" fill="none" stroke="${look.wellRim}"/>`)

  for (const lane of scene.lanes) {
    els.push(`<rect x="${n(lane.x + 0.5)}" y="${n(scene.wellY + 0.5)}" width="${n(lane.w - 1)}" height="${n(scene.wellH - 1)}" fill="${look.wellFill}" stroke="${look.wellRim}"/>`)
    els.push(scene.labelMode === 'names'
      ? `<text transform="translate(${n(lane.cx - 2)} ${n(slab.y - 6)}) rotate(-45)" font-size="10" font-family="${FONT}" fill="${look.text}">${esc(lane.label)}</text>`
      : `<text x="${n(lane.cx)}" y="${n(slab.y - 8)}" text-anchor="middle" font-size="10" font-family="${FONT}" fill="${look.text}">${esc(lane.label)}</text>`)
  }

  for (const l of scene.sizeLabels) {
    const fill = l.major ? look.text : look.textMuted
    const weight = l.major ? ' font-weight="600"' : ''
    els.push(`<text x="${n(slab.x - 8)}" y="${n(l.y)}" text-anchor="end" dominant-baseline="middle" font-size="9"${weight} font-family="${FONT}" fill="${fill}">${esc(l.text)}</text>`)
    els.push(`<rect x="${n(slab.x - 5)}" y="${n(l.y - 0.5)}" width="4" height="1" fill="${fill}"/>`)
  }

  const arrowY = slab.y + slab.h + 3
  for (const ro of scene.ranOff) {
    const cx = scene.lanes[ro.laneIdx].cx
    els.push(`<path d="M${n(cx - 4)} ${n(arrowY)}H${n(cx + 4)}L${n(cx)} ${n(arrowY + 5)}Z" fill="${RAN_OFF_COLOUR}"/>`)
  }

  els.push(`<text x="${n(figure.x + figure.w - 8)}" y="${n(scene.height - 5)}" text-anchor="end" font-size="10" font-family="${FONT}" fill="${look.textMuted}">${esc(scene.caption)}</text>`)

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.width)}" height="${n(scene.height)}" viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">\n${els.join('\n')}\n</svg>`
}
