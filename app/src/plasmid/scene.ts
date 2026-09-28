/**
 * Layout pass for the circular map.
 *
 * Produces a backend-neutral display list. No canvas calls happen here, which
 * is what lets the same layout drive the on-screen canvas and the SVG export
 * without a second renderer that can drift, and what makes the label placement
 * testable without a DOM.
 *
 * The only host capability this needs is text measurement, which comes in as a
 * callback. Both emitters are given the same measurer, so the two outputs agree
 * on every label position down to the pixel.
 */

import type { Annotation } from '../models/Annotation'
import { contrastText, visibleStroke } from '../utils/color'
import type { PlasmidStyle, PlasmidColors } from './styles'
import {
  TWO_PI, normalizeAngle, posToAngle, annArcSpan, planTicks,
} from './geometry'

// ---- Display list ----

export interface TextItem {
  kind: 'text'
  x: number
  y: number
  text: string
  font: string
  fill: string
  align: 'left' | 'center' | 'right'
  baseline: 'top' | 'middle' | 'bottom'
  /** Radians, about (x, y). */
  rotate?: number
  /** Paint a background-coloured outline behind the glyphs for legibility. */
  halo?: string
  alpha?: number
}

export type SceneItem =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; stroke?: string; alpha?: number }
  | { kind: 'ring'; cx: number; cy: number; radius: number; width: number; stroke: string; alpha?: number }
  | {
      kind: 'arcBand'
      cx: number; cy: number; radius: number
      startAngle: number; span: number; width: number
      /** 1 arrow at the end, -1 arrow at the start, 0 plain band. */
      strand: number
      fill: string
      stroke?: string
      strokeWidth?: number
      dash?: boolean
      alpha?: number
    }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; alpha?: number }
  | { kind: 'dot'; x: number; y: number; r: number; fill: string; alpha?: number }
  | TextItem
  | {
      kind: 'curvedText'
      cx: number; cy: number; radius: number
      midAngle: number
      text: string
      font: string
      fill: string
      /** Read right-to-left so bottom-of-circle text is not upside down. */
      flip: boolean
    }

export type HitRegion =
  | {
      kind: 'arc'
      id: string
      type: 'feature' | 'primer'
      radius: number
      halfWidth: number
      startAngle: number
      span: number
    }
  | { kind: 'point'; id: string; type: 'enzyme'; x: number; y: number; r: number }

export interface PlasmidScene {
  size: number
  background: string
  items: SceneItem[]
  hitRegions: HitRegion[]
  /** Backbone radius, so callers can convert a click angle without guessing. */
  baseRadius: number
}

// ---- Input ----

/** An enzyme group flattened to what the layout needs, so this module does
 *  not have to import the sequence view. */
export interface SceneEnzymeGroup {
  key: string
  label: string
  cutPos: number
  methEffect: 'blocked' | 'impaired' | null
}

export interface ScenePrimer {
  id: string
  name: string
  start: number
  end: number
  strand: 1 | -1
  selected: boolean
}

export interface SceneGcSeries {
  /** GC fraction per window, 0 to 1. */
  content: number[]
  /** GC skew per window, already scaled to -1 to 1. */
  skew: number[]
}

export interface PlasmidSceneInput {
  size: number
  seqLen: number
  name: string
  topology: 'linear' | 'circular'
  displayOrigin: number
  style: PlasmidStyle
  colors: PlasmidColors
  measureText: (text: string, font: string) => number

  /** Pre-stacked by `stackAnnotations`, so hover does not restack. */
  rings: Annotation[][]
  hoveredAnnotationId: string | null
  /** Ids drawn faint and dashed because they are only suggestions. */
  proposalIds: ReadonlySet<string>
  /** Suggestion ids the user has picked, drawn filled and accented. */
  pickedIds: ReadonlySet<string>

  enzymeGroups: SceneEnzymeGroup[]
  hoveredEnzymeKey: string | null

  primers: ScenePrimer[]

  selection: { anchor: number; caret: number }
  selectionSpansOrigin: boolean
  selectionLength: number

  /** Precomputed so the layout never walks the sequence. */
  methylation: { dam: number[]; dcm: number[] }
  gc: SceneGcSeries | null
  gcPercent: number | null
  legend: { label: string; color: string }[] | null
}

// ---- Inner label placement ----

interface InnerLabel {
  text: string
  angle: number
  width: number
  fill: string
  font: string
  /** Lower goes first, and so gets the outermost tier. */
  priority: number
  /** Draw a leader line back to the backbone when pushed inward. */
  leader: boolean
  leaderColor: string
  /** Set for enzyme labels, so the label area becomes a hit target too. */
  hitId?: string
}

interface PlacedInnerLabel extends InnerLabel {
  radius: number
}

interface Rect { x1: number; y1: number; x2: number; y2: number }

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
}

/**
 * Place every label that lives inside the circle: ruler numbers and cut-site
 * names together, in one tier map.
 *
 * Previously these were two independent passes 4px apart radially, each
 * unaware of the other, so ruler numbers and enzyme names were routinely drawn
 * on top of each other. Sharing one allocator is the fix. The centre block is
 * passed in as a reserved rectangle so that a construct with many cut sites can
 * no longer write enzyme names across its own title.
 */
function placeInnerLabels(
  labels: InnerLabel[],
  baseRadius: number,
  tierSpacing: number,
  minRadius: number,
  reserved: Rect,
  cx: number,
  cy: number,
  lineHeight: number,
): PlacedInnerLabel[] {
  const sorted = [...labels].sort((a, b) => a.priority - b.priority || a.angle - b.angle)
  const tierAngles: { angle: number; halfSpan: number }[][] = []
  const placed: PlacedInnerLabel[] = []

  const angularOverlap = (a1: number, hs1: number, a2: number, hs2: number) => {
    let d = Math.abs(a1 - a2)
    if (d > Math.PI) d = TWO_PI - d
    return d < hs1 + hs2
  }

  for (const label of sorted) {
    let done = false
    for (let t = 0; t <= tierAngles.length && !done; t++) {
      const radius = baseRadius - t * tierSpacing
      if (radius < minRadius) break

      // Rotated tangential text: approximate its footprint as a box at the
      // label's anchor, which is enough to keep it off the centre block.
      const x = cx + Math.cos(label.angle) * radius
      const y = cy + Math.sin(label.angle) * radius
      const box: Rect = {
        x1: x - label.width / 2, y1: y - lineHeight / 2,
        x2: x + label.width / 2, y2: y + lineHeight / 2,
      }
      if (rectsOverlap(box, reserved)) continue

      if (t === tierAngles.length) tierAngles.push([])
      const halfSpan = (label.width + 6) / (2 * radius)
      const clash = tierAngles[t].some(e => angularOverlap(label.angle, halfSpan, e.angle, e.halfSpan))
      if (clash) continue

      tierAngles[t].push({ angle: label.angle, halfSpan })
      placed.push({ ...label, radius })
      done = true
    }
    // Not placed: dropped rather than drawn over something else.
  }

  return placed
}

// ---- Outside label placement ----

interface OutsideLabel {
  text: string
  display: string
  midAngle: number
  arcRadius: number
  width: number
  hovered: boolean
}

// ---- Builder ----

export function buildPlasmidScene(input: PlasmidSceneInput): PlasmidScene {
  const {
    size, seqLen, style, colors, measureText, rings, hoveredAnnotationId,
    proposalIds, pickedIds, enzymeGroups, hoveredEnzymeKey, primers,
    selection, selectionSpansOrigin, selectionLength, methylation, gc,
    gcPercent, legend, displayOrigin, name, topology,
  } = input

  const items: SceneItem[] = []
  const hitRegions: HitRegion[] = []
  const cx = size / 2
  const cy = size / 2
  const baseRadius = size * style.radiusFactor

  const font = (px: number, bold = false) =>
    `${bold ? 'bold ' : ''}${px}px ${style.fontFamily}`

  items.push({ kind: 'rect', x: 0, y: 0, w: size, h: size, fill: colors.bg })

  if (seqLen === 0) {
    items.push({
      kind: 'text', x: cx, y: cy, text: 'No sequence loaded',
      font: font(style.centreNameSize, true), fill: colors.textMuted,
      align: 'center', baseline: 'middle',
    })
    return { size, background: colors.bg, items, hitRegions, baseRadius }
  }

  const hasSelection = selection.anchor !== selection.caret

  // --- Selection band, behind everything ---
  // A slim band sitting on the backbone. This used to be three arc widths
  // (48px) centred on the backbone, which swallowed the enzyme ticks and the
  // inner edge of the first feature ring whenever anything was selected.
  if (hasSelection) {
    const arcStart = selectionSpansOrigin ? selection.anchor : Math.min(selection.anchor, selection.caret)
    const arcEnd = selectionSpansOrigin ? selection.caret : Math.max(selection.anchor, selection.caret)
    const startAngle = posToAngle(arcStart, seqLen)
    const span = annArcSpan(arcStart, arcEnd, seqLen)
    items.push({
      kind: 'arcBand', cx, cy, radius: baseRadius,
      startAngle, span, width: style.arcWidth + 6, strand: 0,
      fill: colors.selection,
    })
    for (const pos of [arcStart, arcEnd]) {
      const a = posToAngle(pos, seqLen)
      items.push({
        kind: 'line',
        x1: cx + Math.cos(a) * (baseRadius - style.arcWidth / 2 - 5),
        y1: cy + Math.sin(a) * (baseRadius - style.arcWidth / 2 - 5),
        x2: cx + Math.cos(a) * (baseRadius + style.arcWidth / 2 + 5),
        y2: cy + Math.sin(a) * (baseRadius + style.arcWidth / 2 + 5),
        stroke: colors.accent, width: 1.5,
      })
    }
  }

  // --- Backbone ---
  items.push({
    kind: 'ring', cx, cy, radius: baseRadius,
    width: style.backboneWidth, stroke: colors.backbone,
  })

  // --- Ruler ---
  // Ticks sit outside the backbone rather than straddling it, so the ring
  // itself stays an unbroken line.
  const innerLabels: InnerLabel[] = []
  if (style.showTicks) {
    const ticks = planTicks(seqLen, displayOrigin)
    for (const tick of ticks) {
      const angle = posToAngle(tick.pos, seqLen)
      const from = baseRadius + style.backboneWidth / 2
      const to = from + (tick.major ? 7 : 3)
      items.push({
        kind: 'line',
        x1: cx + Math.cos(angle) * from, y1: cy + Math.sin(angle) * from,
        x2: cx + Math.cos(angle) * to, y2: cy + Math.sin(angle) * to,
        stroke: tick.major ? colors.textMuted : colors.tickMinor,
        width: tick.major ? 1.25 : 0.5,
      })
      if (style.showTickLabels && tick.major) {
        const text = String(tick.label)
        innerLabels.push({
          text, angle,
          width: measureText(text, font(style.tickSize)),
          fill: colors.textMuted,
          font: font(style.tickSize),
          priority: 0,
          leader: false,
          leaderColor: colors.tickMinor,
        })
      }
    }
  }

  // --- Methylation markers ---
  if (methylation.dam.length > 0 || methylation.dcm.length > 0) {
    const dotR = Math.max(1, baseRadius * 0.008)
    for (const [positions, fill] of [
      [methylation.dam, colors.dam] as const,
      [methylation.dcm, colors.dcm] as const,
    ]) {
      for (const pos of positions) {
        const angle = posToAngle(pos, seqLen)
        items.push({
          kind: 'dot',
          x: cx + Math.cos(angle) * baseRadius,
          y: cy + Math.sin(angle) * baseRadius,
          r: dotR, fill, alpha: 0.35,
        })
      }
    }
  }

  // --- GC ring, inside the backbone ---
  if (gc && gc.content.length > 0) {
    const gcOuter = baseRadius - style.arcWidth - 10
    const gcBand = 26
    const gcMid = gcOuter - gcBand / 2
    const n = gc.content.length
    const step = TWO_PI / n

    items.push({
      kind: 'ring', cx, cy, radius: gcMid, width: 0.5,
      stroke: colors.tickMinor, alpha: 0.6,
    })
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + i * step
      // GC content deviation from 0.5, drawn outward from the midline.
      const dev = (gc.content[i] - 0.5) * gcBand
      items.push({
        kind: 'arcBand', cx, cy, radius: gcMid + dev / 2,
        startAngle: angle, span: step * 1.02, width: Math.max(0.6, Math.abs(dev)),
        strand: 0, fill: colors.gc, alpha: 0.75,
      })
      // Skew on a second, thinner track below.
      const skewMid = gcMid - gcBand / 2 - 7
      const sdev = gc.skew[i] * 6
      items.push({
        kind: 'arcBand', cx, cy, radius: skewMid + sdev / 2,
        startAngle: angle, span: step * 1.02, width: Math.max(0.6, Math.abs(sdev)),
        strand: 0, fill: sdev >= 0 ? colors.gcSkewPos : colors.gcSkewNeg, alpha: 0.7,
      })
    }
  }

  // --- Primers, their own thin ring just inside the backbone ---
  if (primers.length > 0) {
    const primerR = baseRadius - style.arcWidth / 2 - 6
    const primerW = Math.max(4, style.arcWidth * 0.4)
    for (const p of primers) {
      const startAngle = posToAngle(p.start, seqLen)
      const span = annArcSpan(p.start, p.end, seqLen)
      items.push({
        kind: 'arcBand', cx, cy, radius: primerR,
        startAngle, span, width: p.selected ? primerW + 2 : primerW,
        strand: p.strand, fill: colors.primer,
        stroke: p.selected ? colors.accent : undefined,
        strokeWidth: p.selected ? 1.5 : undefined,
        alpha: p.selected ? 1 : 0.75,
      })
      hitRegions.push({
        kind: 'arc', id: p.id, type: 'primer',
        radius: primerR, halfWidth: primerW / 2 + 3, startAngle, span,
      })
    }
  }

  // --- Enzyme cut sites ---
  for (const group of enzymeGroups) {
    const angle = posToAngle(group.cutPos, seqLen)
    const hovered = group.key === hoveredEnzymeKey
    const alpha = group.methEffect === 'blocked' ? 0.25 : group.methEffect === 'impaired' ? 0.5 : 1
    const from = baseRadius - 10
    const to = baseRadius + 10
    items.push({
      kind: 'line',
      x1: cx + Math.cos(angle) * from, y1: cy + Math.sin(angle) * from,
      x2: cx + Math.cos(angle) * to, y2: cy + Math.sin(angle) * to,
      stroke: colors.enzyme, width: hovered ? 3 : 1.5, alpha,
    })
    const mx = cx + Math.cos(angle) * baseRadius
    const my = cy + Math.sin(angle) * baseRadius
    items.push({ kind: 'dot', x: mx, y: my, r: hovered ? 4 : 2.5, fill: colors.enzyme, alpha })
    hitRegions.push({ kind: 'point', id: group.key, type: 'enzyme', x: mx, y: my, r: 14 })

    if (style.showEnzymeLabels) {
      const f = font(style.enzymeSize, hovered)
      innerLabels.push({
        text: group.label, angle,
        width: measureText(group.label, f),
        fill: colors.enzyme, font: f,
        priority: 1,
        leader: true,
        leaderColor: colors.enzyme,
        hitId: group.key,
      })
    }
  }

  // --- Place ruler and enzyme labels together ---
  if (innerLabels.length > 0) {
    const centreW = Math.max(
      measureText(name, font(style.centreNameSize, true)),
      160,
    )
    const reserved: Rect = {
      x1: cx - centreW / 2 - 8, y1: cy - 34,
      x2: cx + centreW / 2 + 8, y2: cy + 40,
    }
    const placed = placeInnerLabels(
      innerLabels,
      baseRadius - 20,
      15,
      40,
      reserved,
      cx, cy,
      Math.max(style.tickSize, style.enzymeSize) + 3,
    )
    for (const label of placed) {
      if (label.leader && label.radius < baseRadius - 24) {
        items.push({
          kind: 'line',
          x1: cx + Math.cos(label.angle) * (baseRadius - 10),
          y1: cy + Math.sin(label.angle) * (baseRadius - 10),
          x2: cx + Math.cos(label.angle) * (label.radius + 6),
          y2: cy + Math.sin(label.angle) * (label.radius + 6),
          stroke: label.leaderColor, width: 0.75, alpha: 0.35,
        })
      }
      // Keep tangential text upright through the bottom half.
      let rotate = label.angle + Math.PI / 2
      if (rotate > Math.PI / 2 && rotate < Math.PI * 1.5) rotate += Math.PI
      items.push({
        kind: 'text',
        x: cx + Math.cos(label.angle) * label.radius,
        y: cy + Math.sin(label.angle) * label.radius,
        text: label.text, font: label.font, fill: label.fill,
        align: 'center', baseline: 'middle', rotate,
        halo: style.labelHalo ? colors.bg : undefined,
      })
      if (label.hitId) {
        // The name is as clickable as the tick on the backbone, which matters
        // once a leader line has pulled it well away from its own cut site.
        hitRegions.push({
          kind: 'point', id: label.hitId, type: 'enzyme',
          x: cx + Math.cos(label.angle) * label.radius,
          y: cy + Math.sin(label.angle) * label.radius,
          r: 12,
        })
      }
    }
  }

  // --- Feature arcs ---
  const outside: OutsideLabel[] = []
  for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
    const radius = baseRadius + 14 + ringIdx * (style.arcWidth + style.arcGap)
    for (const ann of rings[ringIdx]) {
      const startAngle = posToAngle(ann.start, seqLen)
      const span = annArcSpan(ann.start, ann.end, seqLen)
      const hovered = ann.id === hoveredAnnotationId
      const isProposal = proposalIds.has(ann.id)
      const isPicked = pickedIds.has(ann.id)
      const width = hovered ? style.arcWidth + 4 : style.arcWidth

      const alpha = isProposal
        ? (isPicked ? 0.6 : 0.28)
        : style.featureAlpha

      items.push({
        kind: 'arcBand', cx, cy, radius, startAngle, span, width,
        strand: ann.strand,
        fill: ann.color,
        // A picked suggestion is outlined in the accent so the pick reads;
        // a print style forces one ink; otherwise darken the fill just enough
        // to stay visible against a light background.
        stroke: style.outlineWidth > 0
          ? (isPicked ? colors.accent : style.outlineColor ?? visibleStroke(ann.color))
          : undefined,
        strokeWidth: style.outlineWidth > 0 ? (isPicked ? 2 : style.outlineWidth) : 0,
        dash: isProposal && !isPicked,
        alpha,
      })

      hitRegions.push({
        kind: 'arc', id: ann.id, type: 'feature',
        radius, halfWidth: width / 2 + 3, startAngle, span,
      })

      const labelFont = font(style.labelSize, hovered)
      const textWidth = measureText(ann.name, labelFont)
      const arcLength = Math.abs(span) * radius

      if (style.labelPlacement === 'outside' && textWidth + 8 < arcLength) {
        items.push({
          kind: 'curvedText', cx, cy, radius,
          midAngle: startAngle + span / 2,
          text: ann.name, font: labelFont,
          fill: contrastText(ann.color),
          flip: isFlipped(startAngle + span / 2),
        })
      } else {
        outside.push({
          text: ann.name, display: ann.name,
          midAngle: startAngle + span / 2,
          arcRadius: radius, width: textWidth, hovered,
        })
      }
    }
  }

  // --- Labels that did not fit inside their arc ---
  if (outside.length > 0) {
    const outermost = baseRadius + 14 + Math.max(0, rings.length - 1) * (style.arcWidth + style.arcGap)
    layoutOutsideLabels(
      items, outside, cx, cy, size, outermost, style, colors, measureText, font,
    )
  }

  // --- Caret ---
  if (!hasSelection) {
    const a = posToAngle(selection.caret, seqLen)
    items.push({
      kind: 'line',
      x1: cx + Math.cos(a) * (baseRadius - 10), y1: cy + Math.sin(a) * (baseRadius - 10),
      x2: cx + Math.cos(a) * (baseRadius + 10), y2: cy + Math.sin(a) * (baseRadius + 10),
      stroke: colors.accent, width: 2,
    })
  }

  // --- Centre block ---
  const nameFont = font(style.centreNameSize, true)
  const maxNameW = baseRadius * 1.5
  let centreName = name
  if (measureText(centreName, nameFont) > maxNameW) {
    while (centreName.length > 1 && measureText(centreName + '…', nameFont) > maxNameW) {
      centreName = centreName.slice(0, -1)
    }
    centreName += '…'
  }
  items.push({
    kind: 'text', x: cx, y: cy - 12, text: centreName, font: nameFont,
    fill: colors.text, align: 'center', baseline: 'middle',
  })

  const meta = [
    formatBpShort(seqLen),
    gcPercent != null ? `${gcPercent.toFixed(0)}% GC` : null,
    topology === 'circular' ? 'circular' : 'linear',
  ].filter(Boolean).join('  ·  ')
  items.push({
    kind: 'text', x: cx, y: cy + 8, text: meta,
    font: font(style.centreMetaSize), fill: colors.textMuted,
    align: 'center', baseline: 'middle',
  })

  if (hasSelection) {
    items.push({
      kind: 'text', x: cx, y: cy + 26,
      text: `${selectionLength} bp selected`,
      font: font(style.centreMetaSize), fill: colors.accent,
      align: 'center', baseline: 'middle',
    })
  }

  // --- Legend ---
  if (legend && legend.length > 0) {
    const swatch = 9
    const rowH = 15
    const pad = 10
    const legendFont = font(style.labelSize)
    const width = Math.max(...legend.map(l => measureText(l.label, legendFont))) + swatch + pad * 2 + 8
    const height = legend.length * rowH + pad * 2
    const lx = pad
    const ly = size - height - pad
    items.push({
      kind: 'rect', x: lx, y: ly, w: width, h: height,
      fill: colors.bg, stroke: colors.tickMinor, alpha: 0.95,
    })
    legend.forEach((entry, i) => {
      const ry = ly + pad + i * rowH + rowH / 2
      items.push({
        kind: 'rect', x: lx + pad, y: ry - swatch / 2, w: swatch, h: swatch,
        fill: entry.color, stroke: colors.tickMinor,
      })
      items.push({
        kind: 'text', x: lx + pad + swatch + 6, y: ry, text: entry.label,
        font: legendFont, fill: colors.text, align: 'left', baseline: 'middle',
      })
    })
  }

  return { size, background: colors.bg, items, hitRegions, baseRadius }
}

// ---- Helpers ----

function isFlipped(midAngle: number): boolean {
  const n = normalizeAngle(midAngle)
  return n > Math.PI / 2 && n < Math.PI * 1.5
}

function formatBpShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)} kb`
  return `${n.toLocaleString()} bp`
}

/**
 * Horizontal labels outside the outermost ring, tiered by screen-space
 * rectangle rather than by angle: for horizontal text an angular test does not
 * describe the overlap that actually happens.
 */
function layoutOutsideLabels(
  items: SceneItem[],
  labels: OutsideLabel[],
  cx: number, cy: number, size: number,
  outermost: number,
  style: PlasmidStyle,
  colors: PlasmidColors,
  measureText: (t: string, f: string) => number,
  font: (px: number, bold?: boolean) => string,
): void {
  const TIER_GAP = 14
  const MAX_W = size * 0.22
  const LABEL_H = style.labelSize + 2
  const PAD = 3
  const baseLabelR = outermost + style.arcWidth / 2 + 18

  interface Prepared extends OutsideLabel { tier: number }
  const prepared: Prepared[] = labels.map(l => {
    const f = font(style.labelSize, l.hovered)
    let display = l.text
    let w = measureText(display, f)
    if (w > MAX_W) {
      while (display.length > 1 && measureText(display + '…', f) > MAX_W) {
        display = display.slice(0, -1)
      }
      display += '…'
      w = measureText(display, f)
    }
    return { ...l, display, width: w, tier: 0 }
  })
  prepared.sort((a, b) => normalizeAngle(a.midAngle) - normalizeAngle(b.midAngle))

  const pos = (l: Prepared, tier: number) => {
    const r = baseLabelR + tier * TIER_GAP
    const rx = cx + Math.cos(l.midAngle) * r
    const ry = cy + Math.sin(l.midAngle) * r
    const na = normalizeAngle(l.midAngle)
    const nearTop = na > Math.PI * 1.47 || na < Math.PI * 0.03
    const nearBottom = na > Math.PI * 0.47 && na < Math.PI * 0.53
    if (nearTop || nearBottom) return { lx: rx, ly: ry, align: 'center' as const }

    const onRight = na < Math.PI / 2 || na > Math.PI * 1.5
    // Clear the outermost arc at this y rather than along the radius, so long
    // labels near 3 and 9 o'clock do not cut across the rings.
    const arcOuter = Math.max(l.arcRadius, outermost) + style.arcWidth / 2 + 4
    const dy = ry - cy
    if (dy * dy < arcOuter * arcOuter) {
      const xExtent = Math.sqrt(arcOuter * arcOuter - dy * dy)
      const gap = 6 + tier * TIER_GAP
      return onRight
        ? { lx: Math.max(cx + xExtent + gap, rx), ly: ry, align: 'left' as const }
        : { lx: Math.min(cx - xExtent - gap, rx), ly: ry, align: 'right' as const }
    }
    return { lx: rx, ly: ry, align: onRight ? ('left' as const) : ('right' as const) }
  }

  const rect = (l: Prepared, tier: number): Rect => {
    const { lx, ly, align } = pos(l, tier)
    const x1 = align === 'center' ? lx - l.width / 2 - PAD : align === 'left' ? lx - PAD : lx - l.width - PAD
    const x2 = align === 'center' ? lx + l.width / 2 + PAD : align === 'left' ? lx + l.width + PAD : lx + PAD
    return { x1, y1: ly - LABEL_H / 2 - PAD, x2, y2: ly + LABEL_H / 2 + PAD }
  }

  const tiers: Rect[][] = []
  for (const l of prepared) {
    let placed = false
    for (let t = 0; t < tiers.length; t++) {
      const r = rect(l, t)
      if (!tiers[t].some(e => rectsOverlap(r, e))) {
        l.tier = t
        tiers[t].push(r)
        placed = true
        break
      }
    }
    if (!placed) {
      l.tier = tiers.length
      tiers.push([rect(l, l.tier)])
    }
  }

  for (const l of prepared) {
    const { lx, ly, align } = pos(l, l.tier)
    const leaderStartR = l.arcRadius + style.arcWidth / 2 + 4
    const sx = cx + Math.cos(l.midAngle) * leaderStartR
    const sy = cy + Math.sin(l.midAngle) * leaderStartR
    const ex = lx + (align === 'left' ? -3 : align === 'right' ? 3 : 0)
    if (Math.hypot(ex - sx, ly - sy) > 8) {
      items.push({
        kind: 'line', x1: sx, y1: sy, x2: ex, y2: ly,
        stroke: l.hovered ? colors.text : colors.tickMinor, width: 0.75,
      })
    }
    items.push({
      kind: 'text', x: lx, y: ly, text: l.display,
      font: font(style.labelSize, l.hovered),
      fill: l.hovered ? colors.text : colors.textMuted,
      align, baseline: 'middle',
      halo: style.labelHalo ? colors.bg : undefined,
    })
  }
}
