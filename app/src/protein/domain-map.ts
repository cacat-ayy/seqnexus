/**
 * Layout pass for the linear domain map of a protein.
 *
 * Produces the same backend-neutral display list the circular map produces,
 * so the one canvas renderer, the one SVG emitter and the one image export
 * draw it, and a figure exported is the figure on screen. The style and the
 * palette are the plasmid map's: Publication draws black on white.
 *
 * Layout: the chain as a bar with a residue ruler under it; features in
 * lanes above it, each a rounded bar in its colour with its name inside
 * when it fits and beside it otherwise; one-residue features (sites,
 * modifications) as a lollipop with the name above; disulfide bonds as
 * brackets under the chain joining their cysteines.
 */

import type { Annotation } from '../models/Annotation'
import type { PlasmidScene, SceneItem, HitRegion } from '../plasmid/scene'
import type { PlasmidStyle, PlasmidColors } from '../plasmid/styles'
import { contrastText } from '../utils/color'

export interface DomainMapInput {
  width: number
  seqLen: number
  name: string
  description?: string
  /** The displayed number of residue 0. */
  firstNumber: number
  features: readonly Annotation[]
  style: PlasmidStyle
  colors: PlasmidColors
  measureText: (text: string, font: string) => number
  hoveredAnnotationId: string | null
  /** The selected residues, [start, end), or null. */
  selection: [number, number] | null
}

const MARGIN = 24
const TITLE_H = 44
const LANE_H = 18
const LANE_GAP = 6
const CHAIN_H = 10
const RULER_H = 22
const SITE_STEM = 14
const BOND_DROP = 10
const BOND_GAP = 4
/** A feature narrower than this draws as a site rather than a bar. */
const SITE_MAX_PX = 6

/** Ticks 1, 2 or 5 times a power of ten, at least `minPx` apart. */
function tickStep(pxPerUnit: number, minPx = 60): number {
  let step = 1
  for (;;) {
    for (const m of [1, 2, 5]) if (m * step * pxPerUnit >= minPx) return m * step
    step *= 10
  }
}

/** Greedy lane assignment: each bar goes in the first lane with room. */
function assignLanes(bars: { x1: number; x2: number }[]): number[] {
  const laneEnds: number[] = []
  const out: number[] = []
  for (const b of bars) {
    let lane = laneEnds.findIndex(end => end + 4 <= b.x1)
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(b.x2) }
    else laneEnds[lane] = b.x2
    out.push(lane)
  }
  return out
}

function isBond(a: Annotation): boolean {
  return a.type === 'disulfide' && !!a.segments && a.segments.length === 2
}

export function buildDomainMapScene(input: DomainMapInput): PlasmidScene {
  const { width, seqLen, style, colors, measureText } = input
  const items: SceneItem[] = []
  const hitRegions: HitRegion[] = []
  const font = `${style.labelSize}px ${style.fontFamily}`
  const smallFont = `${style.tickSize}px ${style.fontFamily}`
  const innerW = Math.max(100, width - MARGIN * 2)
  const pxPer = seqLen > 0 ? innerW / seqLen : 1
  const xOf = (pos: number) => MARGIN + pos * pxPer

  // Sort features: wide ones first in each lane pass, so a domain takes the
  // lowest lane and the sites it contains stack above it.
  const regular = input.features.filter(a => !isBond(a))
  const bonds = input.features.filter(isBond)
  const bars = regular.map(a => {
    const x1 = xOf(a.start)
    const x2 = Math.max(x1 + 1, xOf(a.end))
    const site = x2 - x1 < SITE_MAX_PX || a.end - a.start <= 1
    const label = a.name
    const labelW = measureText(label, font)
    // A site's label stands above its stem and needs its width as room.
    const reach = site ? Math.max(x2, (x1 + x2) / 2 + labelW / 2 + 4) : (labelW + 8 <= x2 - x1 ? x2 : x2 + labelW + 8)
    return { a, x1, x2, site, label, labelW, reach }
  }).sort((p, q) => (p.x2 - p.x1) - (q.x2 - q.x1) > 0 ? -1 : p.x1 - q.x1)
  const ordered = [...bars].sort((p, q) => p.x1 - q.x1 || (q.x2 - q.x1) - (p.x2 - p.x1))
  const lanes = assignLanes(ordered.map(b => ({ x1: b.x1, x2: b.reach })))
  const laneCount = lanes.length > 0 ? Math.max(...lanes) + 1 : 0

  const chainY = MARGIN + TITLE_H + laneCount * (LANE_H + LANE_GAP) + (laneCount > 0 ? LANE_GAP : 0)
  const bondDepth = bonds.length > 0 ? BOND_DROP + bonds.length * BOND_GAP + 6 : 0
  const height = chainY + CHAIN_H + RULER_H + bondDepth + MARGIN

  // Title, with the length and description under it, cut to the width
  // (the export button sits in the top right corner on screen).
  items.push({ kind: 'text', x: MARGIN, y: MARGIN, text: input.name, font: `600 ${style.centreNameSize}px ${style.fontFamily}`, fill: colors.text, align: 'left', baseline: 'top' })
  let meta = `${seqLen.toLocaleString('en-US')} aa${input.description ? ` · ${input.description}` : ''}`
  const metaMax = innerW - 40
  if (measureText(meta, smallFont) > metaMax) {
    let lo = 0
    let hi = meta.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (measureText(meta.slice(0, mid) + '…', smallFont) <= metaMax) lo = mid
      else hi = mid - 1
    }
    meta = meta.slice(0, lo) + '…'
  }
  items.push({ kind: 'text', x: MARGIN, y: MARGIN + style.centreNameSize + 4, text: meta, font: smallFont, fill: colors.textMuted, align: 'left', baseline: 'top' })

  // Selection band under everything.
  if (input.selection && input.selection[1] > input.selection[0]) {
    items.push({ kind: 'rect', x: xOf(input.selection[0]), y: MARGIN + TITLE_H - 2, w: xOf(input.selection[1]) - xOf(input.selection[0]), h: chainY + CHAIN_H - (MARGIN + TITLE_H) + 4, fill: colors.selection })
  }

  // The chain and its ruler.
  items.push({ kind: 'rect', x: MARGIN, y: chainY, w: innerW, h: CHAIN_H, fill: colors.backbone, alpha: style.forcePrintPalette ? 1 : 0.55 })
  // Ticks at round displayed numbers (10, 20, 30), plus the first and the
  // last residue, the last only when it has room beside the nearest tick.
  const step = tickStep(pxPer)
  const first = input.firstNumber
  const last = first + seqLen - 1
  const tick = (num: number) => {
    // A residue's tick sits at its centre.
    const x = xOf(num - first + 0.5)
    items.push({ kind: 'line', x1: x, y1: chainY + CHAIN_H, x2: x, y2: chainY + CHAIN_H + 4, stroke: colors.tickMinor, width: 1 })
    if (style.showTickLabels) items.push({ kind: 'text', x, y: chainY + CHAIN_H + 6, text: num.toLocaleString('en-US'), font: smallFont, fill: colors.textMuted, align: 'center', baseline: 'top' })
  }
  if (seqLen > 0) {
    tick(first)
    let prev = first
    for (let num = Math.ceil((first + 1) / step) * step; num < last; num += step) {
      if ((num - prev) * pxPer >= 28) { tick(num); prev = num }
    }
    if (last > first && (last - prev) * pxPer >= 28) tick(last)
  }

  // Feature bars and sites, lane 0 nearest the chain.
  ordered.forEach((b, i) => {
    const lane = lanes[i]
    const y = chainY - LANE_GAP - (lane + 1) * (LANE_H + LANE_GAP) + LANE_GAP
    const hovered = b.a.id === input.hoveredAnnotationId
    const alpha = hovered ? 1 : style.featureAlpha
    const stroke = style.outlineColor ?? (hovered ? colors.accent : undefined)
    if (b.site) {
      const cx = (b.x1 + b.x2) / 2
      items.push({ kind: 'line', x1: cx, y1: y + LANE_H, x2: cx, y2: chainY, stroke: b.a.color, width: hovered ? 2 : 1.25, alpha })
      items.push({ kind: 'dot', x: cx, y: y + LANE_H - SITE_STEM / 2, r: hovered ? 5 : 4, fill: b.a.color, alpha })
      items.push({ kind: 'text', x: cx, y: y + LANE_H - SITE_STEM - 2, text: b.label, font, fill: colors.text, align: 'center', baseline: 'bottom', halo: style.labelHalo ? colors.bg : undefined })
      hitRegions.push({ kind: 'box', id: b.a.id, type: 'feature', x: cx - Math.max(6, b.labelW / 2), y, w: Math.max(12, b.labelW), h: LANE_H + (chainY - y - LANE_H) })
    } else {
      items.push({ kind: 'rect', x: b.x1, y, w: b.x2 - b.x1, h: LANE_H, fill: b.a.color, stroke, alpha })
      if (b.labelW + 8 <= b.x2 - b.x1) {
        items.push({ kind: 'text', x: (b.x1 + b.x2) / 2, y: y + LANE_H / 2, text: b.label, font, fill: contrastText(b.a.color), align: 'center', baseline: 'middle' })
      } else {
        items.push({ kind: 'text', x: b.x2 + 4, y: y + LANE_H / 2, text: b.label, font, fill: colors.text, align: 'left', baseline: 'middle', halo: style.labelHalo ? colors.bg : undefined })
      }
      hitRegions.push({ kind: 'box', id: b.a.id, type: 'feature', x: b.x1, y, w: b.x2 - b.x1, h: LANE_H })
    }
  })

  // Disulfide brackets under the ruler, each on its own depth.
  bonds.forEach((a, i) => {
    const [s1, s2] = a.segments!
    const x1 = xOf(s1[0] + 0.5)
    const x2 = xOf(s2[0] + 0.5)
    const top = chainY + CHAIN_H + RULER_H
    const yb = top + BOND_DROP + i * BOND_GAP
    const hovered = a.id === input.hoveredAnnotationId
    const w = hovered ? 2 : 1.25
    items.push({ kind: 'line', x1, y1: chainY + CHAIN_H, x2: x1, y2: yb, stroke: a.color, width: w })
    items.push({ kind: 'line', x1, y1: yb, x2, y2: yb, stroke: a.color, width: w })
    items.push({ kind: 'line', x1: x2, y1: chainY + CHAIN_H, x2, y2: yb, stroke: a.color, width: w })
    if (i === bonds.length - 1 || hovered) {
      items.push({ kind: 'text', x: (x1 + x2) / 2, y: yb + 2, text: a.name, font: smallFont, fill: colors.textMuted, align: 'center', baseline: 'top', halo: style.labelHalo ? colors.bg : undefined })
    }
    hitRegions.push({ kind: 'box', id: a.id, type: 'feature', x: Math.min(x1, x2) - 3, y: yb - 3, w: Math.abs(x2 - x1) + 6, h: 8 })
  })

  return { size: width, height, background: colors.bg, items, hitRegions, baseRadius: 0 }
}
