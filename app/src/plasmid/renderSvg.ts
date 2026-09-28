/**
 * SVG emitter for a PlasmidScene.
 *
 * Walks exactly the same display list as the canvas emitter, so the export
 * cannot drift from what is on screen. Text is emitted as real `<text>`, not
 * outlines, so a figure stays editable and searchable in Illustrator or
 * Inkscape, and curved feature names use `<textPath>` rather than one element
 * per character.
 */

import type { PlasmidScene, SceneItem, TextItem } from './scene'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const n = (v: number): string => (Math.round(v * 1000) / 1000).toString()

/** Split a canvas font shorthand into the SVG attributes it implies. */
function fontAttrs(font: string): string {
  const m = /^(?:(bold|[1-9]00)\s+)?([\d.]+)px\s+(.+)$/.exec(font.trim())
  if (!m) return `font-size="11" font-family="sans-serif"`
  const [, weight, size, family] = m
  const w = weight ? ` font-weight="${weight}"` : ''
  return `font-size="${size}" font-family="${esc(family)}"${w}`
}

const ANCHOR = { left: 'start', center: 'middle', right: 'end' } as const
const BASELINE = { top: 'hanging', middle: 'central', bottom: 'alphabetic' } as const

function polarPoint(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
}

/**
 * Arc commands from `from` to `to`, split into quarter-turn segments.
 *
 * Splitting avoids two SVG arc traps at once: the large-arc flag, and the fact
 * that an arc whose start and end points coincide draws nothing at all. The
 * second one matters here because a feature annotated across the whole plasmid
 * has a span of exactly 2π, and would otherwise vanish from the export while
 * still being drawn on the canvas.
 */
function arcTo(cx: number, cy: number, r: number, from: number, to: number): string {
  const total = to - from
  const steps = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)))
  const sweep = total >= 0 ? 1 : 0
  const out: string[] = []
  for (let i = 1; i <= steps; i++) {
    const a = from + (total * i) / steps
    const [x, y] = polarPoint(cx, cy, r, a)
    out.push(`A ${n(r)} ${n(r)} 0 0 ${sweep} ${n(x)} ${n(y)}`)
  }
  return out.join(' ')
}

function arcBandPath(item: Extract<SceneItem, { kind: 'arcBand' }>): string {
  const { cx, cy, radius, startAngle, span, width, strand } = item
  const inner = radius - width / 2
  const outer = radius + width / 2
  const arrow = Math.min(0.08, span * 0.2)
  const d: string[] = []

  if (strand === 1) {
    const bodyEnd = startAngle + span - arrow
    const tip = startAngle + span
    const [sx, sy] = polarPoint(cx, cy, outer, startAngle)
    const [tx, ty] = polarPoint(cx, cy, radius, tip)
    const [ix, iy] = polarPoint(cx, cy, inner, bodyEnd)
    d.push(`M ${n(sx)} ${n(sy)}`)
    d.push(arcTo(cx, cy, outer, startAngle, bodyEnd))
    d.push(`L ${n(tx)} ${n(ty)}`)
    d.push(`L ${n(ix)} ${n(iy)}`)
    d.push(arcTo(cx, cy, inner, bodyEnd, startAngle))
  } else if (strand === -1) {
    const bodyStart = startAngle + arrow
    const [sx, sy] = polarPoint(cx, cy, outer, bodyStart)
    const [tx, ty] = polarPoint(cx, cy, radius, startAngle)
    d.push(`M ${n(sx)} ${n(sy)}`)
    d.push(arcTo(cx, cy, outer, bodyStart, startAngle + span))
    d.push(arcTo(cx, cy, inner, startAngle + span, bodyStart))
    d.push(`L ${n(tx)} ${n(ty)}`)
  } else {
    const [sx, sy] = polarPoint(cx, cy, outer, startAngle)
    d.push(`M ${n(sx)} ${n(sy)}`)
    d.push(arcTo(cx, cy, outer, startAngle, startAngle + span))
    d.push(arcTo(cx, cy, inner, startAngle + span, startAngle))
  }
  d.push('Z')
  return d.join(' ')
}

function textEl(item: TextItem): string {
  const transform = item.rotate
    ? ` transform="rotate(${n((item.rotate * 180) / Math.PI)} ${n(item.x)} ${n(item.y)})"`
    : ''
  const common =
    `x="${n(item.x)}" y="${n(item.y)}" ${fontAttrs(item.font)} `
    + `text-anchor="${ANCHOR[item.align]}" dominant-baseline="${BASELINE[item.baseline]}"${transform}`

  const out: string[] = []
  if (item.halo) {
    // Same trick as the canvas: a fat stroke in the background colour painted
    // under the glyphs. paint-order keeps it behind rather than over them.
    out.push(
      `<text ${common} fill="${esc(item.fill)}" stroke="${esc(item.halo)}" `
      + `stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(item.text)}</text>`,
    )
  } else {
    out.push(`<text ${common} fill="${esc(item.fill)}">${esc(item.text)}</text>`)
  }
  return out.join('')
}

export function renderSceneToSvg(scene: PlasmidScene): string {
  const body: string[] = []
  const defs: string[] = []
  let pathId = 0

  for (const item of scene.items) {
    const alpha = item.kind === 'curvedText' ? 1 : (item.alpha ?? 1)
    const op = alpha < 1 ? ` opacity="${n(alpha)}"` : ''

    switch (item.kind) {
      case 'rect':
        body.push(
          `<rect x="${n(item.x)}" y="${n(item.y)}" width="${n(item.w)}" height="${n(item.h)}" `
          + `fill="${esc(item.fill)}"${item.stroke ? ` stroke="${esc(item.stroke)}"` : ''}${op}/>`,
        )
        break

      case 'ring':
        body.push(
          `<circle cx="${n(item.cx)}" cy="${n(item.cy)}" r="${n(item.radius)}" fill="none" `
          + `stroke="${esc(item.stroke)}" stroke-width="${n(item.width)}"${op}/>`,
        )
        break

      case 'arcBand': {
        const stroke = item.stroke && (item.strokeWidth ?? 0) > 0
          ? ` stroke="${esc(item.stroke)}" stroke-width="${n(item.strokeWidth ?? 1)}" stroke-linejoin="round"`
            + (item.dash ? ` stroke-dasharray="4 3"` : '')
          : ''
        body.push(`<path d="${arcBandPath(item)}" fill="${esc(item.fill)}"${stroke}${op}/>`)
        break
      }

      case 'line':
        body.push(
          `<line x1="${n(item.x1)}" y1="${n(item.y1)}" x2="${n(item.x2)}" y2="${n(item.y2)}" `
          + `stroke="${esc(item.stroke)}" stroke-width="${n(item.width)}"${op}/>`,
        )
        break

      case 'dot':
        body.push(
          `<circle cx="${n(item.x)}" cy="${n(item.y)}" r="${n(item.r)}" fill="${esc(item.fill)}"${op}/>`,
        )
        break

      case 'text':
        body.push(textEl(item))
        break

      case 'curvedText': {
        // A path the text rides along, drawn in whichever direction keeps the
        // glyphs upright, and centred with startOffset.
        const id = `ct${pathId++}`
        const half = Math.PI / 2
        const from = item.flip ? item.midAngle + half : item.midAngle - half
        const to = item.flip ? item.midAngle - half : item.midAngle + half
        const [sx, sy] = polarPoint(item.cx, item.cy, item.radius, from)
        const d = `M ${n(sx)} ${n(sy)} ${arcTo(item.cx, item.cy, item.radius, from, to)}`
        defs.push(`<path id="${id}" d="${d}" fill="none"/>`)
        body.push(
          `<text ${fontAttrs(item.font)} fill="${esc(item.fill)}" dominant-baseline="central">`
          + `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(item.text)}</textPath>`
          + `</text>`,
        )
        break
      }
    }
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
      + `width="${n(scene.size)}" height="${n(scene.size)}" `
      + `viewBox="0 0 ${n(scene.size)} ${n(scene.size)}">`,
    defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '',
    body.join('\n'),
    `</svg>`,
  ].filter(Boolean).join('\n')
}
