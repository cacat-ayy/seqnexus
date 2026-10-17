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
import type { PlasmidLayout, PlasmidStyle, PlasmidColors } from './styles'
import { displayPosition } from '../models/Document'
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
  | { kind: 'point'; id: string; type: 'enzyme' | 'guide'; x: number; y: number; r: number }
  /** A feature bar on a linear figure. */
  | { kind: 'box'; id: string; type: 'feature'; x: number; y: number; w: number; h: number }
  /** A cut-site name: the box its text fills, centred on x, y and turned by `rotate`. */
  | { kind: 'label'; id: string; type: 'enzyme'; x: number; y: number; w: number; h: number; rotate: number }

export interface PlasmidScene {
  /** Width, and the height unless `height` says otherwise: the map is square. */
  size: number
  /** A linear figure (the domain map) is wide and as tall as its lanes need. */
  height?: number
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
  /** The annealed span. */
  start: number
  end: number
  strand: 1 | -1
  selected: boolean
  /** Overrides the theme's primer colour. */
  color?: string
  /** A non-annealing tail hangs off this end, drawn as a short flag. */
  tail5?: boolean
  tail3?: boolean
}

/**
 * A guide's cut on the map. Only the cut and the direction are needed: the
 * protospacer itself rides the feature rings once it is a feature, and a
 * 20-base arc on a plasmid-sized map is a smudge, while the cut is the thing
 * a map is read for.
 */
export interface SceneGuide {
  key: string
  label: string
  cutPos: number
  strand: 1 | -1
  /** A staggered cutter: the second cut, drawn as a short companion tick. */
  secondCut?: number
  /**
   * A nickase: one strand only. The tick stands off the backbone rather
   * than touching it, so a nick is not read as a break.
   */
  nick?: true
}

export interface SceneGcSeries {
  /** GC fraction per window, 0 to 1. */
  content: number[]
  /** GC skew per window, already scaled to -1 to 1. */
  skew: number[]
}

export interface PlasmidSceneInput {
  /** Width, and the height unless `height` says otherwise. */
  size: number
  /**
   * A taller-than-wide or wider-than-tall map. The circle is drawn at the
   * centre of the rectangle at the size the shorter side allows, so the extra
   * room goes to the names around it rather than to the circle.
   */
  height?: number
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

  /** Guide cuts, when the guide overlay is on. */
  guides?: SceneGuide[]
  hoveredGuideKey?: string | null
  selectedGuideKey?: string | null

  primers: ScenePrimer[]

  selection: { anchor: number; caret: number }
  selectionSpansOrigin: boolean
  /** Ranges selected beside `selection`; one across the origin has anchor > caret. */
  extraSelections?: readonly { anchor: number; caret: number }[]
  /** Selected bases, every range counted. */
  selectionLength: number

  /** Find hits, sorted by start; `end` may run past the origin (> seqLen). */
  searchHits?: readonly { start: number; end: number }[]
  /** Index into searchHits of the current hit, or -1. */
  currentSearchHit?: number

  /** Precomputed so the layout never walks the sequence. */
  methylation: { dam: number[]; dcm: number[] }
  gc: SceneGcSeries | null
  gcPercent: number | null
  legend: { label: string; color: string }[] | null

  /** Draw feature names on and around the arcs. Default true. */
  showFeatureLabels?: boolean
  /** Draw the name, length and topology in the middle. Default true. The
   *  explorer's hover card turns both off: it prints the same facts itself. */
  showCentre?: boolean

  /** Cut sites drawn as chosen: accent ticks, bold accent labels placed
   *  before any other site's, so a crowded map never drops them. */
  pickedEnzymeKeys?: ReadonlySet<string>
  /** Stretches marked on the backbone, each in its own colour. An end below
   *  its start runs across the origin. */
  regions?: readonly { start: number; end: number; color: string }[]
  /** Mark the caret when nothing is selected. Default true. */
  showCaret?: boolean
  /** A line under the length in the middle, in place of the selection count. */
  centreNote?: string
  /** Break the backbone at the origin of a linear sequence, with an end bar
   *  each side, so a linear molecule does not read as a circle. */
  openEnds?: boolean
  /** Where features and cut sites go round the ring. Default features outside. */
  layout?: PlasmidLayout
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

// ---- Cut-site names ----

/** A cut site's name, before it is placed inside the circle or listed. */
interface SiteName {
  key: string
  text: string
  angle: number
  /** At the bold weight. */
  width: number
  fill: string
  font: string
  picked: boolean
  hovered: boolean
  /** Translucent for a site methylation blocks. */
  alpha: number
  /** Where it cuts, as the position the user reads (from the display origin, 1-based). */
  pos: number
}

/** Cut sites closer together than a row of text, this many or more in a
 *  run, are listed beside the circle instead of named inside it. */
const CLUSTER_MIN = 5

/** Below this size (the split view) a small feature is left unnamed. */
const SMALL_MAP = 500
/** A feature whose arc is shorter than this, in pixels, is small. */
const SMALL_FEATURE_PX = 24

// ---- Outside label placement ----

interface OutsideLabel {
  text: string
  display: string
  midAngle: number
  arcRadius: number
  width: number
  hovered: boolean
  /** The angle the feature covers, so a crowded spot can keep the larger ones' names. */
  span?: number
}

// ---- Builder ----

export function buildPlasmidScene(input: PlasmidSceneInput): PlasmidScene {
  const {
    size, seqLen, colors, measureText, rings, hoveredAnnotationId,
    proposalIds, pickedIds, enzymeGroups, hoveredEnzymeKey, primers,
    guides, hoveredGuideKey, selectedGuideKey,
    selection, selectionSpansOrigin, selectionLength, methylation, gc,
    gcPercent, legend, displayOrigin, name, topology,
    showFeatureLabels = true, showCentre = true,
    searchHits = [], currentSearchHit = -1,
    pickedEnzymeKeys, regions = [], showCaret = true, centreNote, openEnds = false,
    layout = 'features-outside',
  } = input
  // The ring layout: features on rings inside the backbone, the ruler's
  // numbers in a thin band just inside it, every cut site named outside.
  const ring = layout === 'sites-outside'

  const items: SceneItem[] = []
  const hitRegions: HitRegion[] = []
  // The map fills the box it is given, with the circle centred in it and sized
  // by the shorter side. `shortSide` is what "how big is this map" means: a
  // wide box is not a bigger map, it is the same map with more room for names.
  // (`span` is taken further down for the angle a feature covers.)
  const width = size
  const height = input.height ?? size
  const shortSide = Math.min(width, height)
  // Text grows with the map past the size the presets are written for, so a
  // map filling a large panel is not ringed with tiny names. `k` scales the
  // fixed gaps that hold text too (the centre block, the ruler's band).
  const k = textScale(shortSide)
  const style = scaleStyleText(input.style, k)
  const cx = width / 2
  const cy = height / 2
  const baseRadius = shortSide * style.radiusFactor
  const ringStep = style.arcWidth + style.arcGap
  // Inside the backbone in the ring layout, leaving a band for the ruler's
  // numbers; outside it otherwise, as the map has always been drawn.
  const featureRadius = (ringIdx: number) => ring
    ? baseRadius - style.backboneWidth / 2 - 22 * k - style.arcWidth / 2 - ringIdx * ringStep
    : baseRadius + 14 + ringIdx * ringStep
  // Primers in the ring layout go just outside the backbone, where the inside
  // is the features'; the cut sites' leaders start past them.
  const primerW = Math.max(4, style.arcWidth * 0.4)
  const primerR = ring
    ? baseRadius + style.backboneWidth / 2 + 4 + primerW / 2
    : baseRadius - style.arcWidth / 2 - 6

  const font = (px: number, bold = false) =>
    `${bold ? 'bold ' : ''}${px}px ${style.fontFamily}`

  items.push({ kind: 'rect', x: 0, y: 0, w: width, h: height, fill: colors.bg })

  if (seqLen === 0) {
    items.push({
      kind: 'text', x: cx, y: cy, text: 'No sequence loaded',
      font: font(style.centreNameSize, true), fill: colors.textMuted,
      align: 'center', baseline: 'middle',
    })
    return { size: width, height, background: colors.bg, items, hitRegions, baseRadius }
  }

  const hasSelection = selection.anchor !== selection.caret

  // --- Selection band, behind everything ---
  // A slim band sitting on the backbone. This used to be three arc widths
  // (48px) centred on the backbone, which swallowed the enzyme ticks and the
  // inner edge of the first feature ring whenever anything was selected.
  const selectionArcs: [number, number][] = []
  if (hasSelection) {
    selectionArcs.push(selectionSpansOrigin
      ? [selection.anchor, selection.caret]
      : [Math.min(selection.anchor, selection.caret), Math.max(selection.anchor, selection.caret)])
  }
  for (const r of input.extraSelections ?? []) {
    if (r.anchor !== r.caret) selectionArcs.push([r.anchor, r.caret])
  }
  for (const [arcStart, arcEnd] of selectionArcs) {
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

  // --- Marked stretches, on the backbone like the selection ---
  for (const r of regions) {
    if (r.start === r.end) continue
    items.push({
      kind: 'arcBand', cx, cy, radius: baseRadius,
      startAngle: posToAngle(r.start, seqLen), span: annArcSpan(r.start, r.end, seqLen),
      width: style.arcWidth / 2 + 4, strand: 0, fill: r.color, alpha: 0.85,
    })
  }

  // --- Backbone ---
  if (openEnds && topology === 'linear') {
    // The gap is a few pixels whatever the map's size, so it reads as a
    // break without hiding more than a base or two.
    const gap = Math.min(5 / baseRadius, 0.05)
    items.push({
      kind: 'arcBand', cx, cy, radius: baseRadius,
      startAngle: -Math.PI / 2 + gap, span: TWO_PI - 2 * gap,
      width: style.backboneWidth, strand: 0, fill: colors.backbone,
    })
    for (const a of [-Math.PI / 2 + gap, -Math.PI / 2 - gap]) {
      items.push({
        kind: 'line',
        x1: cx + Math.cos(a) * (baseRadius - 6), y1: cy + Math.sin(a) * (baseRadius - 6),
        x2: cx + Math.cos(a) * (baseRadius + 6), y2: cy + Math.sin(a) * (baseRadius + 6),
        stroke: colors.backbone, width: 1.5,
      })
    }
  } else {
    items.push({
      kind: 'ring', cx, cy, radius: baseRadius,
      width: style.backboneWidth, stroke: colors.backbone,
    })
  }

  // --- Find hits ---
  // A mark on the backbone per hit, at least a few pixels long so a 6 bp
  // site on a 10 kb map still shows. Hits closer than that are merged into
  // one mark, which also keeps a genome-scale hit list to a few hundred
  // items. The current hit is drawn last, wider and stronger.
  if (searchHits.length > 0) {
    const minSpan = 3 / baseRadius
    const minBp = (minSpan / TWO_PI) * seqLen
    const mark = (start: number, end: number, current: boolean) => {
      let startAngle = posToAngle(start, seqLen)
      let span = annArcSpan(start, end % seqLen, seqLen)
      if (end - start >= seqLen) span = TWO_PI
      if (span < minSpan) { startAngle -= (minSpan - span) / 2; span = minSpan }
      items.push({
        kind: 'arcBand', cx, cy, radius: baseRadius,
        startAngle, span, width: style.backboneWidth + (current ? 10 : 6), strand: 0,
        fill: current ? colors.searchCurrent : colors.search,
      })
    }
    let runStart = searchHits[0].start
    let runEnd = searchHits[0].end
    for (let i = 1; i < searchHits.length; i++) {
      const h = searchHits[i]
      if (h.start <= runEnd + minBp) { runEnd = Math.max(runEnd, h.end); continue }
      mark(runStart, runEnd, false)
      runStart = h.start
      runEnd = h.end
    }
    mark(runStart, runEnd, false)
    const cur = searchHits[currentSearchHit]
    if (cur) mark(cur.start, cur.end, true)
  }

  // --- Ruler ---
  // Ticks sit outside the backbone rather than straddling it, so the ring
  // itself stays an unbroken line.
  const innerLabels: InnerLabel[] = []
  if (style.showTicks) {
    const ticks = planTicks(seqLen, displayOrigin)
    for (const tick of ticks) {
      const angle = posToAngle(tick.pos, seqLen)
      // Pointing in in the ring layout, where the outside is the sites'.
      const from = ring ? baseRadius - style.backboneWidth / 2 : baseRadius + style.backboneWidth / 2
      const to = from + (ring ? -1 : 1) * (tick.major ? 7 : 3)
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
  // Just inside it here; in the ring layout the inside is the features', so
  // it is drawn later, inside them and their names.
  const drawGcRing = (gcOuter: number) => {
    if (!gc || gc.content.length === 0) return
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
  if (!ring) drawGcRing(baseRadius - style.arcWidth - 10)

  // --- Primers, their own thin ring beside the backbone (see primerR) ---
  if (primers.length > 0) {
    for (const p of primers) {
      const startAngle = posToAngle(p.start, seqLen)
      const span = annArcSpan(p.start, p.end, seqLen)
      const fill = p.color ?? colors.primer
      items.push({
        kind: 'arcBand', cx, cy, radius: primerR,
        startAngle, span, width: p.selected ? primerW + 2 : primerW,
        strand: p.strand, fill,
        stroke: p.selected ? colors.accent : undefined,
        strokeWidth: p.selected ? 1.5 : undefined,
        alpha: p.selected ? 1 : 0.75,
      })
      // A tail does not pair, so it is not an arc: it is a flag lifting off
      // the end it hangs from, pointing away from the backbone.
      const flagAt = (pos: number) => {
        const a = posToAngle(pos, seqLen)
        const tip = primerR + (ring ? 9 : -9)
        items.push({
          kind: 'line',
          x1: cx + Math.cos(a) * primerR, y1: cy + Math.sin(a) * primerR,
          x2: cx + Math.cos(a) * tip, y2: cy + Math.sin(a) * tip,
          stroke: fill, width: 1.5,
        })
      }
      if (p.tail5) flagAt(p.strand === 1 ? p.start : p.end)
      if (p.tail3) flagAt(p.strand === 1 ? p.end : p.start)
      hitRegions.push({
        kind: 'arc', id: p.id, type: 'primer',
        radius: primerR, halfWidth: primerW / 2 + 3, startAngle, span,
      })
    }
  }

  // --- Enzyme cut sites ---
  // Where the names' leaders start: past the outermost feature ring, or in the
  // ring layout just past the backbone (and past the primers, drawn there).
  const ringsOuter = ring
    ? baseRadius + style.backboneWidth / 2 + (primers.length > 0 ? primerW + 6 : 2)
    : baseRadius + 14 + Math.max(0, rings.length - 1) * ringStep + style.arcWidth / 2
  const siteNames: SiteName[] = []
  for (const group of enzymeGroups) {
    const angle = posToAngle(group.cutPos, seqLen)
    const hovered = group.key === hoveredEnzymeKey
    const picked = pickedEnzymeKeys?.has(group.key) ?? false
    const ink = picked ? colors.accent : colors.enzyme
    const alpha = group.methEffect === 'blocked' ? 0.25 : group.methEffect === 'impaired' ? 0.5 : 1
    // In the ring layout a thin tick from the backbone out to where the
    // site's leader starts, so tick and leader read as one line; otherwise a
    // tick across the backbone with a dot on it.
    const from = ring ? baseRadius - style.backboneWidth / 2 : baseRadius - (picked ? 14 : 10)
    const to = ring ? ringsOuter + 4 : baseRadius + (picked ? 14 : 10)
    items.push({
      kind: 'line',
      x1: cx + Math.cos(angle) * from, y1: cy + Math.sin(angle) * from,
      x2: cx + Math.cos(angle) * to, y2: cy + Math.sin(angle) * to,
      stroke: ink, width: hovered || picked ? (ring ? 2.5 : 3) : (ring ? 1 : 1.5), alpha,
    })
    const mx = cx + Math.cos(angle) * baseRadius
    const my = cy + Math.sin(angle) * baseRadius
    if (!ring) items.push({ kind: 'dot', x: mx, y: my, r: hovered || picked ? 4 : 2.5, fill: ink, alpha })
    hitRegions.push({ kind: 'point', id: group.key, type: 'enzyme', x: mx, y: my, r: 10 })

    if (style.showEnzymeLabels) {
      siteNames.push({
        key: group.key, text: group.label, angle,
        // Laid out at its bold width whether or not it is bold, so hovering a
        // name (which bolds it) cannot widen it, push it to another row and
        // put a different name under the pointer.
        width: measureText(group.label, font(style.enzymeSize, true)),
        fill: ink, font: font(style.enzymeSize, hovered || picked),
        picked, hovered, alpha,
        pos: displayPosition(Math.min(seqLen - 1, Math.max(0, Math.floor(group.cutPos))), displayOrigin, seqLen),
      })
    }
  }

  // A crowded stretch of sites (a multiple cloning site) is listed beside
  // the circle; every other name goes inside, on the ruler's tiers. In the
  // ring layout every site is named outside, round the circle (see
  // placePerimeterNames), so there is no run to bracket and nothing goes inside.
  const runs = ring ? [] : findCrowdedRuns(siteNames, baseRadius, listRowHeight(style))
  const listed = new Set(runs.flat().map(site => site.key))
  for (const site of siteNames) {
    if (ring || listed.has(site.key)) continue
    innerLabels.push({
      text: site.text, angle: site.angle, width: site.width,
      fill: site.fill, font: site.font,
      // Ruler numbers are 0, so a chosen site still yields to them; it
      // goes before every other site, which is what keeps it on the map.
      priority: site.picked ? 0.5 : 1,
      leader: true,
      leaderColor: site.fill,
      hitId: site.key,
    })
  }

  // --- Guide cuts ---
  // Drawn outside the backbone rather than across it, so a guide and an
  // enzyme at the same position stay told apart, and the selected one is
  // what the eye lands on.
  for (const guide of guides ?? []) {
    const angle = posToAngle(guide.cutPos, seqLen)
    const hovered = guide.key === hoveredGuideKey
    const chosen = guide.key === selectedGuideKey
    const ink = chosen ? colors.accent : colors.guide
    const from = baseRadius + (guide.nick ? 6 : 2)
    const to = baseRadius + (chosen || hovered ? 16 : 11)
    items.push({
      kind: 'line',
      x1: cx + Math.cos(angle) * from, y1: cy + Math.sin(angle) * from,
      x2: cx + Math.cos(angle) * to, y2: cy + Math.sin(angle) * to,
      stroke: ink, width: hovered || chosen ? 3 : 1.5,
    })
    // The companion tick of a staggered cutter, close enough to read as a pair.
    if (guide.secondCut !== undefined) {
      const a2 = posToAngle(guide.secondCut, seqLen)
      items.push({
        kind: 'line',
        x1: cx + Math.cos(a2) * from, y1: cy + Math.sin(a2) * from,
        x2: cx + Math.cos(a2) * (from + (to - from) * 0.6), y2: cy + Math.sin(a2) * (from + (to - from) * 0.6),
        stroke: ink, width: hovered || chosen ? 2 : 1,
      })
    }
    const mx = cx + Math.cos(angle) * to
    const my = cy + Math.sin(angle) * to
    items.push({ kind: 'dot', x: mx, y: my, r: hovered || chosen ? 3.5 : 2, fill: ink })
    hitRegions.push({ kind: 'point', id: guide.key, type: 'guide', x: mx, y: my, r: 10 })
  }

  // --- Place ruler and enzyme labels together ---
  if (innerLabels.length > 0) {
    const centreW = Math.max(
      measureText(name, font(style.centreNameSize, true)),
      160,
    )
    const reserved: Rect = {
      x1: cx - centreW / 2 - 8, y1: cy - 34 * k,
      x2: cx + centreW / 2 + 8, y2: cy + 40 * k,
    }
    const lineHeight = Math.max(style.tickSize, style.enzymeSize) + 3
    // In the ring layout only the ruler's numbers are inside, in the one band
    // between the backbone and the features, so a single tier there.
    const tickBand = baseRadius - style.backboneWidth / 2 - 13 * k
    const placed = placeInnerLabels(
      innerLabels,
      ring ? tickBand : baseRadius - 20 * k,
      15 * k,
      ring ? tickBand : 40,
      reserved,
      cx, cy,
      lineHeight,
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
        // The name is clickable over the whole of its text. In a multiple
        // cloning site the ticks on the backbone sit a pixel or two apart and
        // cannot be told apart by pointing, but the placement has already
        // spread the names out, so the name is the reliable target.
        hitRegions.push({
          kind: 'label', id: label.hitId, type: 'enzyme',
          x: cx + Math.cos(label.angle) * label.radius,
          y: cy + Math.sin(label.angle) * label.radius,
          w: label.width,
          h: lineHeight,
          rotate,
        })
      }
    }
  }

  // --- Feature arcs ---
  const outside: OutsideLabel[] = []
  // Names that do not fit their arrow, in the ring layout: written curved
  // inside the innermost ring rather than beside the circle.
  const innerNames: OutsideLabel[] = []
  for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
    const radius = featureRadius(ringIdx)
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

      // A spliced feature is drawn exon by exon with a thin arc across each
      // intron, the arrow on the exon the feature ends in (its last on the
      // forward strand, its first on the reverse).
      const parts: [number, number][] = ann.segments ?? [[ann.start, ann.end]]
      parts.forEach(([s0, e0], k) => {
        const terminal = ann.strand === 1 ? k === parts.length - 1 : ann.strand === -1 ? k === 0 : false
        items.push({
          kind: 'arcBand', cx, cy, radius,
          startAngle: posToAngle(s0, seqLen), span: annArcSpan(s0, e0, seqLen), width,
          strand: parts.length === 1 || terminal ? ann.strand : 0,
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
        if (k === parts.length - 1) return
        const gapFrom = e0 % seqLen
        const gapTo = parts[k + 1][0]
        // Parts that meet (a join split only at the origin) have no intron;
        // a zero span would read as the whole circle.
        if (gapTo === gapFrom) return
        items.push({
          kind: 'arcBand', cx, cy, radius,
          startAngle: posToAngle(gapFrom, seqLen), span: annArcSpan(gapFrom, gapTo, seqLen), width: 1.5,
          strand: 0, fill: style.outlineColor ?? visibleStroke(ann.color), alpha: 1,
        })
      })

      hitRegions.push({
        kind: 'arc', id: ann.id, type: 'feature',
        radius, halfWidth: width / 2 + 3, startAngle, span,
      })

      if (!showFeatureLabels) continue
      const labelFont = font(style.labelSize, hovered)
      const textWidth = measureText(ann.name, labelFont)
      const arcLength = Math.abs(span) * radius

      // In the ring layout a name that fits always goes in its arrow, as the
      // names that do not are written curved just inside it.
      if ((ring || style.labelPlacement === 'outside') && textWidth + 8 < arcLength) {
        items.push({
          kind: 'curvedText', cx, cy, radius,
          midAngle: startAngle + span / 2,
          text: ann.name, font: labelFont,
          fill: contrastText(ann.color),
          flip: isFlipped(startAngle + span / 2),
        })
      } else if (shortSide < SMALL_MAP && arcLength < SMALL_FEATURE_PX) {
        // A small map (the split view) leaves a small feature unnamed: its
        // name would be one more leader in the most crowded stretch, and
        // hovering the feature still names it.
        continue
      } else {
        ;(ring ? innerNames : outside).push({
          text: ann.name, display: ann.name,
          midAngle: startAngle + span / 2,
          arcRadius: radius, width: textWidth, hovered, span: Math.abs(span),
        })
      }
    }
  }

  // --- The construct's name in the middle, shortened to the room it has ---
  // In the ring layout the features are inside the backbone, so the name has
  // only the room inside the innermost ring, at the height it is written.
  const innermost = featureRadius(Math.max(0, rings.length - 1)) - style.arcWidth / 2
  const nameFont = font(style.centreNameSize, true)
  const maxNameW = ring
    ? Math.max(60, 2 * Math.sqrt(Math.max(0, (innermost - 6) ** 2 - (20 * k) ** 2)) - 8)
    : baseRadius * 1.5
  let centreName = name
  if (measureText(centreName, nameFont) > maxNameW) {
    while (centreName.length > 1 && measureText(centreName + '…', nameFont) > maxNameW) {
      centreName = centreName.slice(0, -1)
    }
    centreName += '…'
  }

  // --- Ring layout: names inside the rings, then the GC ring inside them ---
  // A name with no room inside (the rings stacked deep, a long name in the
  // middle) is named outside with the sites rather than left off.
  let unplacedInside: OutsideLabel[] = []
  if (ring) {
    const centreW = Math.max(measureText(centreName, nameFont), 160)
    const clearOfCentre = showCentre ? Math.hypot(centreW / 2 + 8, 40 * k) + style.labelSize : 30
    const { reach, unplaced } = placeInnerCurvedNames(items, innerNames, {
      cx, cy, startR: innermost - 6 - style.labelSize / 2, stepR: style.labelSize + 5,
      minR: clearOfCentre, style, colors, font,
    })
    unplacedInside = unplaced
    drawGcRing((reach ?? innermost) - 8)
  }

  // --- Lists of a crowded stretch's site names, and the feature names beside them ---
  const occupied: Rect[] = []
  // Feature names that go outside: those that did not fit their arc, or in
  // the ring layout those with no room left inside.
  const outsideNames = ring ? unplacedInside : outside
  let taken: Set<OutsideLabel>
  const perimeter = { cx, cy, width, height, occupied, style, colors, measureText, font }
  if (ring) {
    // Every site, and every feature name with no room inside, round the
    // circle, all of a side hung on one circle just past the sites' ticks.
    const stemR = ringsOuter + 4
    const ctx: PerimeterContext = {
      ...perimeter, showPositions: true, ticks: { r: stemR, angles: siteNames.map(s => s.angle) },
    }
    placePerimeterNames(items, hitRegions, [
      ...siteNames.map(s => sitePerimeterName(s, ctx, stemR, stemR + PERIMETER_GAP, 0)),
      ...outsideNames.map((l, i) => featurePerimeterName(l, `feature-${i}`, ctx, stemR + PERIMETER_GAP, 0)),
    ], ctx)
    taken = new Set(outsideNames)
  } else {
    taken = placeCrowdedSpots(items, hitRegions, runs, outsideNames, {
      ...perimeter, showPositions: false, outline: outlineOf(items), baseRadius, ringsOuter,
    })
  }

  // --- Labels that did not fit inside their arc ---
  const rest = taken.size > 0 ? outsideNames.filter(l => !taken.has(l)) : outsideNames
  if (rest.length > 0) {
    // Past whatever is drawn round the outside: the feature rings, or in the
    // ring layout the backbone and the primers beside it.
    const outermost = ring ? ringsOuter : baseRadius + 14 + Math.max(0, rings.length - 1) * ringStep
    layoutOutsideLabels(
      items, rest, cx, cy, width, height, occupied, outermost, style, colors, measureText, font,
    )
  }

  // --- Caret ---
  if (!hasSelection && showCaret) {
    const a = posToAngle(selection.caret, seqLen)
    items.push({
      kind: 'line',
      x1: cx + Math.cos(a) * (baseRadius - 10), y1: cy + Math.sin(a) * (baseRadius - 10),
      x2: cx + Math.cos(a) * (baseRadius + 10), y2: cy + Math.sin(a) * (baseRadius + 10),
      stroke: colors.accent, width: 2,
    })
  }

  // --- Centre block ---
  if (showCentre) {
    items.push({
      kind: 'text', x: cx, y: cy - 12 * k, text: centreName, font: nameFont,
      fill: colors.text, align: 'center', baseline: 'middle',
    })

    const meta = [
      formatBpShort(seqLen),
      gcPercent != null ? `${gcPercent.toFixed(0)}% GC` : null,
      topology === 'circular' ? 'circular' : 'linear',
    ].filter(Boolean).join('  ·  ')
    items.push({
      kind: 'text', x: cx, y: cy + 8 * k, text: meta,
      font: font(style.centreMetaSize), fill: colors.textMuted,
      align: 'center', baseline: 'middle',
    })

    // With several ranges, their total and how many.
    const rangeCount = selectionArcs.length
    if (centreNote) {
      items.push({
        kind: 'text', x: cx, y: cy + 26 * k, text: centreNote,
        font: font(style.centreMetaSize), fill: colors.accent,
        align: 'center', baseline: 'middle',
      })
    } else if (rangeCount > 0) {
      items.push({
        kind: 'text', x: cx, y: cy + 26 * k,
        text: rangeCount > 1
          ? `${selectionLength} bp selected in ${rangeCount} ranges`
          : `${selectionLength} bp selected`,
        font: font(style.centreMetaSize), fill: colors.accent,
        align: 'center', baseline: 'middle',
      })
    }
  }

  // --- Legend ---
  if (legend && legend.length > 0) {
    const swatch = 9 * k
    const rowH = 15 * k
    const pad = 10 * k
    const legendFont = font(style.labelSize)
    const legendWidth = Math.max(...legend.map(l => measureText(l.label, legendFont))) + swatch + pad * 2 + 8
    const legendHeight = legend.length * rowH + pad * 2
    const lx = pad
    const ly = height - legendHeight - pad
    items.push({
      kind: 'rect', x: lx, y: ly, w: legendWidth, h: legendHeight,
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

  return { size: width, height, background: colors.bg, items, hitRegions, baseRadius }
}

// ---- Helpers ----

/** The map size, across its shorter side, the presets' font sizes are written for. */
const TEXT_REFERENCE = 600
/** How much larger than that text grows on a big map, at most. */
const TEXT_SCALE_MAX = 1.5

/**
 * How much larger than the preset text is drawn on a map this size: 1 up to
 * TEXT_REFERENCE, growing with the map past it, up to TEXT_SCALE_MAX.
 *
 * Never below 1. The presets' cut-site names are already at the legibility
 * floor, and on a small map the crowding is met by placement and hover cards,
 * not smaller letters. The cap keeps a map exported very large from turning
 * into a poster of names.
 */
export function textScale(shortSide: number): number {
  return Math.min(TEXT_SCALE_MAX, Math.max(1, shortSide / TEXT_REFERENCE))
}

/** A style with its font sizes scaled by k, to the half pixel. */
function scaleStyleText(style: PlasmidStyle, k: number): PlasmidStyle {
  if (k === 1) return style
  const px = (n: number) => Math.round(n * k * 2) / 2
  return {
    ...style,
    labelSize: px(style.labelSize),
    tickSize: px(style.tickSize),
    enzymeSize: px(style.enzymeSize),
    centreNameSize: px(style.centreNameSize),
    centreMetaSize: px(style.centreMetaSize),
  }
}

/**
 * Whether a label along an arc must run counter-clockwise to stay upright.
 *
 * Screen angles grow clockwise from 3 o'clock (y points down). A label set
 * clockwise turns each glyph by angle + 90°, which is upright over the top
 * half (angles π..2π) and upside down over the bottom half (0..π), so the
 * bottom half is the one to flip. This used to test the left half instead,
 * which turned labels upside down in the top-left and bottom-right quarters.
 */
export function isFlipped(midAngle: number): boolean {
  const n = normalizeAngle(midAngle)
  return n > 0 && n < Math.PI
}

function formatBpShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)} kb`
  return `${n.toLocaleString('en-US')} bp`
}

/**
 * Horizontal labels outside the outermost ring, tiered by screen-space
 * rectangle rather than by angle: for horizontal text an angular test does not
 * describe the overlap that actually happens.
 */
function layoutOutsideLabels(
  items: SceneItem[],
  labels: OutsideLabel[],
  cx: number, cy: number, width: number, height: number,
  occupied: readonly Rect[],
  outermost: number,
  style: PlasmidStyle,
  colors: PlasmidColors,
  measureText: (t: string, f: string) => number,
  font: (px: number, bold?: boolean) => string,
): void {
  // A tier's step, from the text's own height (14 px at the usual 11).
  const TIER_GAP = style.labelSize + 3
  // What a name may take before it is shortened: a share of the width, but
  // never more than the room beside the circle, which is where it is written.
  const MAX_W = Math.max(width * 0.22, (width - 2 * outermost) / 2 - 12)
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

  type Placed = { lx: number; ly: number; align: 'left' | 'right' | 'center'; held?: boolean }

  /**
   * A label pulled back inside the canvas.
   *
   * Tiers stack outward from the circle, which at 12 and 6 o'clock walks a
   * crowded cluster straight off the top or bottom edge. Rather than let a
   * name be drawn where it cannot be read, it is held at the edge and the
   * tier spreads it sideways instead, away from the centre: that is the room
   * a map wider than it is tall has, and it is where a person would write it.
   */
  const fit = (p: Placed, l: Prepared, tier: number): Placed => {
    const minY = LABEL_H / 2 + PAD
    const maxY = height - LABEL_H / 2 - PAD
    const ly = Math.min(Math.max(p.ly, minY), maxY)
    let { lx, align } = p
    if (ly !== p.ly) {
      // A step of a whole name, since a shorter one would leave the names
      // held at the edge written over each other.
      const dir = p.lx >= cx ? 1 : -1
      lx = p.lx + dir * tier * (l.width + 10)
      align = dir > 0 ? 'left' : 'right'
    }
    // And inside the left and right edges, whichever way the text runs.
    const low = align === 'left' ? PAD : align === 'right' ? l.width + PAD : l.width / 2 + PAD
    const high = align === 'left' ? width - l.width - PAD : align === 'right' ? width - PAD : width - l.width / 2 - PAD
    return { lx: Math.min(Math.max(lx, low), Math.max(low, high)), ly, align, held: ly !== p.ly }
  }

  const pos = (l: Prepared, tier: number): Placed => {
    const r = baseLabelR + tier * TIER_GAP
    const rx = cx + Math.cos(l.midAngle) * r
    const ry = cy + Math.sin(l.midAngle) * r
    const na = normalizeAngle(l.midAngle)
    const nearTop = na > Math.PI * 1.47 || na < Math.PI * 0.03
    const nearBottom = na > Math.PI * 0.47 && na < Math.PI * 0.53
    if (nearTop || nearBottom) return fit({ lx: rx, ly: ry, align: 'center' }, l, tier)

    const onRight = na < Math.PI / 2 || na > Math.PI * 1.5
    // Clear the outermost arc at this y rather than along the radius, so long
    // labels near 3 and 9 o'clock do not cut across the rings.
    const arcOuter = Math.max(l.arcRadius, outermost) + style.arcWidth / 2 + 4
    const dy = ry - cy
    if (dy * dy < arcOuter * arcOuter) {
      const xExtent = Math.sqrt(arcOuter * arcOuter - dy * dy)
      const gap = 6 + tier * TIER_GAP
      return fit(onRight
        ? { lx: Math.max(cx + xExtent + gap, rx), ly: ry, align: 'left' }
        : { lx: Math.min(cx - xExtent - gap, rx), ly: ry, align: 'right' }, l, tier)
    }
    return fit({ lx: rx, ly: ry, align: onRight ? 'left' : 'right' }, l, tier)
  }

  const rect = (l: Prepared, tier: number): Rect => {
    const { lx, ly, align } = pos(l, tier)
    const x1 = align === 'center' ? lx - l.width / 2 - PAD : align === 'left' ? lx - PAD : lx - l.width - PAD
    const x2 = align === 'center' ? lx + l.width / 2 + PAD : align === 'left' ? lx + l.width + PAD : lx + PAD
    return { x1, y1: ly - LABEL_H / 2 - PAD, x2, y2: ly + LABEL_H / 2 + PAD }
  }

  const tiers: Rect[][] = []
  // Every name already placed, whatever tier it went in. A tier is a ring, so
  // two tiers were taken not to meet, but a long name at an outer tier reaches
  // back under a short one further in, and a name held at an edge leaves its
  // ring altogether. Both are only caught by looking at all of them.
  const placedRects: Rect[] = []
  const free = (r: Rect) =>
    !occupied.some(e => rectsOverlap(r, e)) && !placedRects.some(e => rectsOverlap(r, e))

  for (const l of prepared) {
    let placed = false
    for (let t = 0; t < tiers.length; t++) {
      const r = rect(l, t)
      if (free(r)) {
        l.tier = t
        tiers[t].push(r)
        placedRects.push(r)
        placed = true
        break
      }
    }
    if (!placed) {
      // A fresh tier, stepped on until it clears the lists and the names
      // already written at this edge.
      let t = tiers.length
      for (let tried = 0; tried < 10 && !free(rect(l, t)); tried++) t++
      l.tier = t
      while (tiers.length <= t) tiers.push([])
      tiers[t].push(rect(l, t))
      placedRects.push(rect(l, t))
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

// ---- Names round the circle ----

/**
 * A name written outside the circle, hung on a circle of its own spot: a cut
 * site's, or a feature's that did not fit where it belongs.
 */
type PerimeterName = {
  key: string
  /** Where it is round the circle, and so where its name would sit with nothing in the way. */
  angle: number
  /** How far out its leader starts: the end of the site's tick or bracket, or the feature's outer edge. */
  fromR: number
  /** The room it is laid out at: at the bold weight, a site's position included. */
  width: number
  /**
   * Which names go first when a side of the map cannot hold them all: 2 (a
   * site) before 1 (a feature), and 0 (a site the user chose, or the name
   * under the pointer) only when nothing else is left.
   */
  rank: number
  /** Names of one spot share the circle they hang on. */
  group: number
  /** The least radius that circle may have for this name. */
  hangR: number
  /**
   * For a feature name in a crowded spot of the default layout: where its
   * leader leaves its arc. It rises straight out from there to fromR, the
   * height its spot's site leaders start at, and goes on from there like
   * theirs, so every leader of the spot starts at one radius.
   */
  stubFrom?: number
} & ({ kind: 'site'; site: SiteName } | { kind: 'feature'; label: OutsideLabel })

interface PerimeterContext {
  cx: number
  cy: number
  width: number
  height: number
  /** Boxes the names fill, kept for anything laid out after them. */
  occupied: Rect[]
  style: PlasmidStyle
  colors: PlasmidColors
  measureText: (t: string, f: string) => number
  font: (px: number, bold?: boolean) => string
  /** Write a site's position beside its name, "BamHI (975)" (the ring layout). */
  showPositions: boolean
  /** The ring layout's site ticks, out to `r` at these angles, which no leader may cross. */
  ticks?: { r: number; angles: number[] }
  /**
   * What is drawn round the circle, in the default layout, where the feature
   * rings stack deeper in one place than another: each spot's names are hung
   * just clear of what is drawn where they are, not of the deepest stack on
   * the map.
   */
  outline?: OutlineArc[]
}

/** A name's place: how far down its side (0 at 12 o'clock, pi at 6) on a circle of radius R. */
type PerimeterPlace = {
  name: PerimeterName
  u: number
  R: number
  /** How far past what is drawn under it the name hangs (the default layout). */
  slack?: number
}

/**
 * Where every name goes on each side, and whether both sides settled: every
 * name clear of what is drawn and every leader passing leadersClear. A side
 * that has not settled after a few rounds is drawn as it stands.
 */
type PerimeterPlan = Record<'left' | 'right', PerimeterPlace[]> & { settled: boolean }

/** From the end of a site's tick out to the circle its names are hung on, at least. */
const PERIMETER_GAP = 6
/** From where a leader ends to where its text starts. */
const PERIMETER_PAD = 3
/** Between a name's position and its name, "BamHI (975)". */
const POS_GAP = 4
/** Between what is drawn round the circle and a name hung outside it, at least. */
const OUTLINE_CLEAR = 3
/**
 * How much closer to the centre than where it starts a site's leader may come:
 * a leader to a name moved far round the circle runs nearly along it, and
 * dipping further would take it onto what its tick or bracket stands clear of.
 */
const LEADER_DIP = 3
/**
 * Leaders from sites a pixel or two apart (a multiple cloning site) leave as a
 * bundle and may cross each other where they start, at an angle too shallow to
 * read as a crossing; a leader may likewise cross the ticks within this many
 * pixels of its own. Two leaders crossing anywhere else is a crossing.
 */
const LEADER_BUNDLE = 12
/** How close, in pixels, two leaders must start to leave as a bundle. */
const LEADER_TOGETHER = 4

const positionText = (s: SiteName) => `(${s.pos.toLocaleString('en-US')})`

/** How far down a side to the angle on the circle. */
const perimeterAngle = (side: 'left' | 'right', u: number) =>
  (side === 'right' ? u - Math.PI / 2 : Math.PI * 1.5 - u)

function sitePerimeterName(
  site: SiteName, ctx: PerimeterContext, fromR: number, hangR: number, group: number,
): PerimeterName {
  const posW = ctx.showPositions ? POS_GAP + ctx.measureText(positionText(site), ctx.font(ctx.style.enzymeSize)) : 0
  return {
    kind: 'site', site, key: site.key, angle: site.angle, fromR, hangR, group,
    width: site.width + posW,
    rank: site.picked || site.hovered ? 0 : 2,
  }
}

function featurePerimeterName(
  label: OutsideLabel, key: string, ctx: PerimeterContext, hangR: number, group: number, stemR?: number,
): PerimeterName {
  const edge = label.arcRadius + ctx.style.arcWidth / 2 + 4
  return {
    kind: 'feature', label, key, angle: label.midAngle,
    fromR: stemR ?? edge, hangR, group,
    stubFrom: stemR !== undefined && stemR > edge ? edge : undefined,
    // At the bold weight, so hovering a name cannot move it.
    width: ctx.measureText(label.text, ctx.font(ctx.style.labelSize, true)),
    rank: label.hovered ? 0 : 1,
  }
}

/** Whether two stretches of the circle overlap. */
function anglesOverlap(aStart: number, aSpan: number, bStart: number, bSpan: number): boolean {
  if (aSpan >= TWO_PI - 1e-9 || bSpan >= TWO_PI - 1e-9) return true
  return normalizeAngle(bStart - aStart) <= aSpan || normalizeAngle(aStart - bStart) <= bSpan
}

/**
 * Names written outside the circle, each hung on its spot's circle just
 * outside what is drawn there, as near its own site as the names round it
 * allow.
 *
 * Each name is a box of horizontal text touching that circle from outside:
 * on the right half it starts at the point it touches and runs right, on the
 * left half it ends there and runs left, and near 12 and 6 o'clock it sits on
 * the circle by its corner rather than its middle. So the one thing to choose
 * for a name is how far round the circle it goes. Its leader is a straight
 * line from its tick to that point, a chord inside the circle, and the text is
 * outside it, so no leader can run through a name; and with the names in the
 * order of their sites, no two site leaders cross.
 *
 * Down each side, names are spread as near their sites as boxes that do not
 * overlap allow: a least-squares fit, solved by pooling neighbours that are
 * pushed together into a block and centring the block on its sites. A block
 * is laid out tight, each name at the first place clear of the one before:
 * a row below it on the sides, or beside it near the top and the bottom,
 * whichever comes first round the circle.
 *
 * The rows these names were first written in could only be moved up and
 * down, so eleven names at a cloning site at half past one were jammed
 * against the top edge of the map, far above their sites, and pushed out
 * past each other's leaders into a stair of names 10 to 30 px from the circle.
 */
function placePerimeterNames(
  items: SceneItem[], hitRegions: HitRegion[], names: readonly PerimeterName[], ctx: PerimeterContext,
): void {
  drawPerimeter(items, hitRegions, planPerimeter(names, ctx), ctx)
}

/**
 * Where each name goes, side by side, without drawing anything. The circle of
 * each spot starts at the least its names allow and moves out while a name
 * would sit on something drawn (the default layout) or a leader would not
 * read as its own (see leadersClear).
 */
function planPerimeter(names: readonly PerimeterName[], ctx: PerimeterContext): PerimeterPlan {
  const { height, style, outline, ticks } = ctx
  const h = listRowHeight(style)
  // Between two names' boxes.
  const GAP = 1
  const margin = 2
  const plan: PerimeterPlan = { left: [], right: [], settled: true }

  for (const side of ['right', 'left'] as const) {
    const list = names
      .filter(n => (Math.cos(n.angle) >= 0) === (side === 'right'))
      .sort((a, b) => downSide(a.angle, side) - downSide(b.angle, side) || (a.key < b.key ? -1 : 1))
    if (list.length === 0) continue
    const angleOf = (u: number) => perimeterAngle(side, u)
    const sign = side === 'right' ? 1 : -1

    /** The box a name fills, with the centre at 0, 0. */
    const boxOf = ({ name: n, u, R }: PerimeterPlace): Rect => {
      const tx = Math.cos(angleOf(u)) * R + sign * PERIMETER_PAD
      const ty = -(R + h / 2) * Math.cos(u)
      return {
        x1: side === 'right' ? tx : tx - n.width, x2: side === 'right' ? tx + n.width : tx,
        y1: ty - h / 2, y2: ty + h / 2,
      }
    }

    /**
     * Raise the circle of any spot whose names would sit on something drawn,
     * to just past the highest thing drawn over the stretch of the circle
     * the name's box covers. Returns whether any was raised.
     */
    const groupR = new Map<number, number>()
    for (const n of list) groupR.set(n.group, Math.max(groupR.get(n.group) ?? 0, n.hangR))
    /** Just past the highest thing drawn over the stretch of the circle a name's box covers. */
    const needOf = (p: PerimeterPlace) => {
      const b = boxOf(p)
      const corners = [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]]
      const mid = Math.atan2((b.y1 + b.y2) / 2, (b.x1 + b.x2) / 2)
      const offs = corners.map(([x, y]) => {
        let d = Math.atan2(y, x) - mid
        while (d > Math.PI) d -= TWO_PI
        while (d <= -Math.PI) d += TWO_PI
        return d
      })
      const lo = mid + Math.min(...offs)
      const span = Math.max(...offs) - Math.min(...offs)
      let need = 0
      for (const a of outline ?? []) if (anglesOverlap(a.start, a.span, lo, span)) need = Math.max(need, a.radius + OUTLINE_CLEAR)
      return need
    }
    const raiseClear = (ps: PerimeterPlace[], extra: number): boolean => {
      if (!outline) return false
      let raised = false
      for (const p of ps) {
        const need = needOf(p)
        if (need > p.R + 1e-6) {
          groupR.set(p.name.group, Math.max(groupR.get(p.name.group)!, need - extra))
          raised = true
        }
      }
      return raised
    }

    /**
     * Whether the site leaders read as their own: none comes more than
     * LEADER_DIP closer to the centre than where it starts, none crosses
     * another site's tick, and no two cross, out of the bundle they leave in.
     *
     * A leader to a name moved far round the circle runs nearly along it,
     * dips towards the backbone on the way and passes over the ticks of the
     * sites beside its own, reading as theirs; two such leaders side by side
     * can swap over. Each is cured by hanging the names further out, which
     * is what a false here does. A feature leader that starts inside what is
     * drawn crosses it anyway and is not held to this, unless it rises to its
     * spot's stem first (stubFrom), when it is a leader like the sites'.
     */
    const leadersClear = (ps: PerimeterPlace[]): boolean => {
      const lines = ps.filter(p => p.name.kind === 'site' || p.name.stubFrom !== undefined).map(({ name: n, u, R }) => ({
        n,
        s: { x: Math.cos(n.angle) * n.fromR, y: Math.sin(n.angle) * n.fromR },
        e: { x: Math.cos(angleOf(u)) * R, y: Math.sin(angleOf(u)) * R },
      }))
      const apart = (a: number, b: number, r: number) => {
        const d = Math.abs(normalizeAngle(a) - normalizeAngle(b))
        return Math.min(d, TWO_PI - d) * r > LEADER_BUNDLE
      }
      for (const { n, s, e } of lines) {
        const dx = e.x - s.x
        const dy = e.y - s.y
        const len2 = dx * dx + dy * dy
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(s.x * dx + s.y * dy) / len2))
        if (Math.hypot(s.x + t * dx, s.y + t * dy) < n.fromR - LEADER_DIP) return false
        if (!ticks) continue
        for (const a of ticks.angles) {
          if (!apart(a, n.angle, ticks.r)) continue
          const inner = ticks.r - LEADER_DIP - 1
          if (crossingPoint(s, e,
            { x: Math.cos(a) * inner, y: Math.sin(a) * inner },
            { x: Math.cos(a) * ticks.r, y: Math.sin(a) * ticks.r })) return false
        }
      }
      for (let i = 0; i < lines.length; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const { s: a } = lines[i]
          const { s: b } = lines[j]
          const at = crossingPoint(a, lines[i].e, b, lines[j].e)
          if (!at) continue
          const bundled = Math.hypot(a.x - b.x, a.y - b.y) <= LEADER_TOGETHER
            && Math.hypot(at.x - a.x, at.y - a.y) <= LEADER_BUNDLE
            && Math.hypot(at.x - b.x, at.y - b.y) <= LEADER_BUNDLE
          if (!bundled) return false
        }
      }
      return true
    }

    let extra = 0
    let placed: PerimeterPlace[] = []
    let settled = false
    for (let tries = 0; tries < 16 && !settled; tries++) {
      const Rof = (n: PerimeterName) => groupR.get(n.group)! + extra
      placed = spreadDownSide(list, side, Rof, h, GAP, height / 2 - margin)
        .map(p => ({ ...p, R: Rof(p.name) }))
      if (raiseClear(placed, extra)) continue
      if (leadersClear(placed)) settled = true
      else extra += 4
    }
    plan[side] = outline ? placed.map(p => ({ ...p, slack: p.R - needOf(p) })) : placed
    if (!settled) plan.settled = false
  }
  return plan
}

/** The names where planPerimeter put them, with their leaders and hit boxes. */
function drawPerimeter(
  items: SceneItem[], hitRegions: HitRegion[], plan: PerimeterPlan, ctx: PerimeterContext,
): void {
  const { cx, cy, width, occupied, style, colors, measureText, font, showPositions } = ctx
  const h = listRowHeight(style)
  const margin = 2
  const posFont = font(style.enzymeSize)

  for (const side of ['right', 'left'] as const) {
    const sign = side === 'right' ? 1 : -1
    const align = side === 'right' ? 'left' : 'right'
    for (const { name: n, u, R } of plan[side]) {
      const a = perimeterAngle(side, u)
      const px = cx + Math.cos(a) * R
      const py = cy + Math.sin(a) * R
      // Touching the circle by its corner near the top and the bottom.
      const ty = cy - (R + h / 2) * Math.cos(u)
      const tx = px + sign * PERIMETER_PAD
      const avail = side === 'right' ? width - margin - tx : tx - margin
      const start = { x: cx + Math.cos(n.angle) * n.fromR, y: cy + Math.sin(n.angle) * n.fromR }
      const leader = (stroke: string, alpha?: number) => {
        if (n.stubFrom !== undefined) {
          items.push({
            kind: 'line',
            x1: cx + Math.cos(n.angle) * n.stubFrom, y1: cy + Math.sin(n.angle) * n.stubFrom,
            x2: start.x, y2: start.y, stroke, width: 0.75, alpha,
          })
        }
        if (Math.hypot(px - start.x, py - start.y) < 2) return
        items.push({ kind: 'line', x1: start.x, y1: start.y, x2: px, y2: py, stroke, width: 0.75, alpha })
      }
      const keepBox = (w: number) => occupied.push({
        x1: side === 'right' ? tx : tx - w, x2: side === 'right' ? tx + w : tx,
        y1: ty - h / 2, y2: ty + h / 2,
      })

      if (n.kind === 'site') {
        const site = n.site
        const pos = positionText(site)
        const posW = measureText(pos, posFont)
        // Short of room at the edge of the map, the position goes first: it is
        // on the hover card too. A site's name is no use shortened ("EcoR…"
        // could be several enzymes), so with no room for all of it the name is
        // left to the hover card, unless it is a site the user chose.
        const showPos = showPositions && avail >= site.width + POS_GAP + posW
        if (avail < site.width && !site.picked && !site.hovered) continue
        const shown = avail >= site.width ? site.text : fitText(site.text, site.font, Math.max(0, avail), measureText)
        leader(site.fill, (site.hovered || site.picked ? 1 : 0.5) * site.alpha)
        items.push({
          kind: 'text', x: tx, y: ty, text: shown,
          font: site.font, fill: site.fill, align, baseline: 'middle',
          halo: style.labelHalo ? colors.bg : undefined,
          alpha: site.alpha < 1 ? site.alpha : undefined,
        })
        const nameW = measureText(shown, site.font)
        // The name next to the circle, the position beyond it: "BamHI (975)"
        // on the right, "(975) BamHI" on the left.
        if (showPos) {
          items.push({
            kind: 'text', x: tx + sign * (nameW + POS_GAP), y: ty, text: pos,
            font: posFont, fill: colors.textMuted, align, baseline: 'middle',
            halo: style.labelHalo ? colors.bg : undefined,
            alpha: site.alpha < 1 ? site.alpha : undefined,
          })
        }
        const fullW = nameW + (showPos ? POS_GAP + posW : 0)
        // The name is the reliable target: the ticks are a pixel or two apart.
        hitRegions.push({
          kind: 'label', id: site.key, type: 'enzyme',
          x: tx + sign * fullW / 2, y: ty, w: fullW, h: h - 2, rotate: 0,
        })
        keepBox(fullW)
      } else {
        const l = n.label
        const f = font(style.labelSize, l.hovered)
        // With no room for even a few letters, a name would be one letter and
        // an ellipsis: it is left to the hover card.
        if (avail < measureText('MM…', f) && !l.hovered) continue
        const shown = fitText(l.text, f, Math.max(0, avail), measureText)
        leader(l.hovered ? colors.text : colors.tickMinor)
        items.push({
          kind: 'text', x: tx, y: ty, text: shown, font: f,
          fill: l.hovered ? colors.text : colors.textMuted, align, baseline: 'middle',
          halo: style.labelHalo ? colors.bg : undefined,
        })
        keepBox(measureText(shown, f))
      }
    }
  }
}

/**
 * Where each name on one side goes, as how far down that side (0 at 12
 * o'clock, pi at 6), each hung on a circle of radius R(name): as near its
 * own site as names that do not overlap allow, and inside the canvas, whose
 * top and bottom are `halfH` from the centre. Names that cannot all fit are
 * thinned first, where they are most crowded, lowest rank first.
 *
 * Only distances from the centre matter here, so both sides are worked out
 * alike: a name's text starts PERIMETER_PAD past its circle and runs away
 * from the centre, its middle at the height a box touching the circle there
 * has.
 */
function spreadDownSide(
  list: readonly PerimeterName[], side: 'left' | 'right',
  R: (n: PerimeterName) => number, h: number, GAP: number, halfH: number,
): { name: PerimeterName; u: number }[] {
  // Height of a name's middle above the centre, and where its text starts sideways.
  const yAt = (n: PerimeterName, u: number) => -(R(n) + h / 2) * Math.cos(u)
  const xAt = (n: PerimeterName, u: number) => R(n) * Math.sin(u) + PERIMETER_PAD
  const overlaps = (a: PerimeterName, ua: number, b: PerimeterName, ub: number) =>
    Math.abs(yAt(a, ua) - yAt(b, ub)) < h - 1e-6
    && xAt(a, ua) < xAt(b, ub) + b.width - 1e-6 && xAt(b, ub) < xAt(a, ua) + a.width - 1e-6
  // The first place, from ua on, where b is a row below a at ua.
  const below = (a: PerimeterName, ua: number, b: PerimeterName) => {
    const c = -(yAt(a, ua) + h + GAP) / (R(b) + h / 2)
    if (c >= 1) return ua
    return c >= -1 ? Math.max(ua, Math.acos(c)) : Number.POSITIVE_INFINITY
  }
  /**
   * The first place, from ua on, where b is clear of a at ua: a row below
   * it, or beside it, past its end on the way down the upper half or short
   * of its start on the way back in below.
   */
  const next = (a: PerimeterName, ua: number, b: PerimeterName) => {
    let u = below(a, ua, b)
    const out = (xAt(a, ua) + a.width + GAP - PERIMETER_PAD) / R(b)
    if (out <= 1) {
      const lo = Math.asin(Math.max(0, out))
      if (ua <= Math.PI - lo) u = Math.min(u, Math.max(ua, lo))
    }
    const back = (xAt(a, ua) - GAP - b.width - PERIMETER_PAD) / R(b)
    if (back >= 1) u = ua
    else if (back >= 0) {
      const lo = Math.asin(back)
      u = Math.min(u, ua <= lo ? ua : Math.max(ua, Math.PI - lo))
    }
    return u
  }
  // A block laid out tight from s.
  const lay = (arr: readonly PerimeterName[], from: number, to: number, s: number): number[] => {
    const us = [s]
    for (let i = from + 1; i < to; i++) {
      let u = next(arr[i - 1], us[us.length - 1], arr[i])
      // A name placed beside the last one can still meet one before it; a
      // row below that one clears it.
      for (let j = i - 2; j >= Math.max(from, i - 6); j--) {
        if (overlaps(arr[j], us[j - from], arr[i], u)) u = Math.max(u, below(arr[j], us[j - from], arr[i]))
      }
      us.push(u)
    }
    return us
  }

  // The canvas's top and bottom, as how far down a side a name may go: for
  // the name on the largest circle, which reaches furthest up and down.
  const rMax = Math.max(...list.map(R))
  const q = (halfH - h / 2) / (rMax + h / 2)
  if (q < 0) return []
  const uLo = q >= 1 ? 0 : Math.acos(q)
  const uHi = Math.PI - uLo
  const ideal = (n: PerimeterName) => Math.min(uHi, Math.max(uLo, downSide(n.angle, side)))

  // Thin a side that cannot hold every name even packed tight from the top:
  // the lowest rank first, the most crowded of it first.
  const arr = [...list]
  const fits = () => {
    const us = lay(arr, 0, arr.length, uLo)
    return us[us.length - 1] <= uHi
  }
  while (arr.length > 0 && !fits()) {
    const worst = Math.max(...arr.map(n => n.rank))
    let drop = -1
    let room = Number.POSITIVE_INFINITY
    arr.forEach((n, i) => {
      if (n.rank !== worst) return
      const r = (i + 1 < arr.length ? ideal(arr[i + 1]) : uHi) - (i > 0 ? ideal(arr[i - 1]) : uLo)
      if (r < room) { room = r; drop = i }
    })
    arr.splice(drop, 1)
  }
  if (arr.length === 0) return []
  const ideals = arr.map(ideal)

  // A block from..to, as near its names' sites as it can be: started where
  // they are, on average, as far past their sites as short of them, and
  // inside the canvas.
  const solve = (from: number, to: number): number[] => {
    const off = (us: number[]) => us.reduce((t, u, k) => t + u - ideals[from + k], 0)
    const last = (us: number[]) => us[us.length - 1]
    const low = lay(arr, from, to, uLo)
    if (last(low) > uHi || off(low) >= 0) return low
    // The furthest down it can start and still end on the canvas.
    let a = uLo
    let b = uHi
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2
      if (last(lay(arr, from, to, m)) <= uHi) a = m
      else b = m
    }
    const high = lay(arr, from, to, a)
    if (off(high) <= 0) return high
    let lo = uLo
    let hi = a
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2
      if (off(lay(arr, from, to, m)) < 0) lo = m
      else hi = m
    }
    return lay(arr, from, to, (lo + hi) / 2)
  }

  const blocks: { from: number; to: number; us: number[] }[] = []
  for (let i = 0; i < arr.length; i++) {
    let block = { from: i, to: i + 1, us: solve(i, i + 1) }
    for (;;) {
      const prev = blocks[blocks.length - 1]
      if (!prev) break
      const need = next(arr[prev.to - 1], prev.us[prev.us.length - 1], arr[block.from])
      if (block.us[0] >= need - 1e-9) break
      blocks.pop()
      block = { from: prev.from, to: block.to, us: solve(prev.from, block.to) }
    }
    blocks.push(block)
  }
  const us = blocks.flatMap(b => b.us)
  // Blocks are laid out apart, so a name beside the last of the block above
  // is checked against the ones before that too.
  for (let i = 1; i < us.length; i++) {
    for (let j = i - 2; j >= Math.max(0, i - 6); j--) {
      if (overlaps(arr[j], us[j], arr[i], us[i])) us[i] = Math.max(us[i], below(arr[j], us[j], arr[i]))
    }
    if (us[i] < us[i - 1]) us[i] = us[i - 1]
  }
  return arr.map((name, i) => ({ name, u: us[i] })).filter(p => Number.isFinite(p.u) && p.u <= uHi + 1e-9)
}

/** Row height of a list beside the circle, for site and feature names alike. */
function listRowHeight(style: PlasmidStyle): number {
  return Math.max(style.labelSize, style.enzymeSize) + 4
}

/**
 * Runs of CLUSTER_MIN or more cut sites closer together, on the backbone,
 * than a row of text: a multiple cloning site, where a dozen sites sit a
 * pixel or two apart and their names on the tiers inside the circle end up
 * turned every which way and partly dropped. Each run is listed beside the
 * circle instead (placeCrowdedSpots); fewer sites, or sites further apart, are
 * named inside as before.
 */
function findCrowdedRuns(sites: SiteName[], baseRadius: number, rowH: number): SiteName[][] {
  const n = sites.length
  if (n < CLUSTER_MIN) return []
  const sorted = [...sites].sort((a, b) => normalizeAngle(a.angle) - normalizeAngle(b.angle))
  const close = (i: number) =>
    normalizeAngle(sorted[(i + 1) % n].angle - sorted[i].angle) * baseRadius < rowH
  // Start from a site with a gap before it, so a run across the origin is
  // not cut in two. With no such gap there is no run to speak of.
  const first = sorted.findIndex((_, i) => !close((i - 1 + n) % n))
  if (first < 0) return []
  const runs: SiteName[][] = []
  let run = [sorted[first]]
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n
    if (k < n && close((i - 1 + n) % n)) { run.push(sorted[i]); continue }
    if (run.length >= CLUSTER_MIN) runs.push(run)
    run = [sorted[i]]
  }
  return runs
}

/** Feature names this close together round the circle, this many or more,
 *  are a crowded spot of their own, with or without cut sites among them. */
const FEATURE_CLUSTER_MIN = 3

/**
 * How many rows of text past what is drawn under it a crowded spot's name
 * may hang on the circle before the spot is listed in columns instead.
 */
const SPOT_SLACK_ROWS = 4

/**
 * How far down a side of the circle an angle is, from 12 o'clock to 6: the
 * order names beside the circle are read in, top first. Down the right is
 * clockwise, down the left anticlockwise, so both sides read downward.
 */
function downSide(a: number, side: 'left' | 'right'): number {
  return side === 'right' ? normalizeAngle(a - Math.PI * 1.5) : normalizeAngle(Math.PI * 1.5 - a)
}

/**
 * The names at each crowded spot of the default layout, round the circle
 * (see placePerimeterNames).
 *
 * A crowded spot is a run of cut sites closer together than a row of text (a
 * multiple cloning site), or a few feature names bunched round the circle,
 * together with the feature names close enough to it to compete for the same
 * room. Its names are split by side: those left of the vertical through the
 * centre go to the left, the rest to the right, so a spot at 12 o'clock opens
 * both ways and one at 3 o'clock goes right.
 *
 * A run gets a bracket just outside what is drawn over it, and its leaders
 * start there. Each spot's names hang on a circle of its own, just clear of
 * what is drawn where they land, rather than of the outermost ring on the
 * map: a stack four rings deep at a plasmid's junction is no reason to hang
 * the names of a cloning site on a bare stretch far out.
 *
 * Feature names that would land among a spot's names join them, and the
 * names are laid out again as they join, until no more do. Returns the
 * feature names it took, so they are not placed again.
 */
function placeCrowdedSpots(
  items: SceneItem[],
  hitRegions: HitRegion[],
  runs: SiteName[][],
  outside: OutsideLabel[],
  ctx: PerimeterContext & { outline: OutlineArc[]; baseRadius: number; ringsOuter: number },
): Set<OutsideLabel> {
  const { cx, cy, style, colors, outline, baseRadius, ringsOuter } = ctx
  const taken = new Set<OutsideLabel>()
  const rowH = listRowHeight(style)
  const sideOf = (a: number): 'left' | 'right' => (Math.cos(a) >= 0 ? 'right' : 'left')
  // How far either side of a spot a feature name still competes for its room:
  // the arc four rows of text take up just outside the rings.
  const reachAngle = (4 * rowH) / (ringsOuter + 10)

  // --- The spots: each run of sites, and each bunch of feature names ---
  interface Spot { start: number; span: number; sites: SiteName[] }
  const spots: Spot[] = runs.map(run => ({
    start: run[0].angle,
    span: normalizeAngle(run[run.length - 1].angle - run[0].angle),
    sites: run,
  }))
  const inSpot = (a: number, s: Spot) => normalizeAngle(a - (s.start - reachAngle)) <= s.span + 2 * reachAngle
  {
    const loose = outside.filter(l => !spots.some(s => inSpot(l.midAngle, s)))
      .sort((p, q) => normalizeAngle(p.midAngle) - normalizeAngle(q.midAngle))
    const n = loose.length
    const gapAfter = (i: number) => normalizeAngle(loose[(i + 1) % n].midAngle - loose[i].midAngle) > reachAngle
    // Start after a gap, so a bunch across the origin (12 o'clock, where a
    // plasmid's own junctions sit) is one bunch and not two halves.
    const first = n === 0 ? -1 : loose.findIndex((_, i) => gapAfter((i - 1 + n) % n))
    if (first >= 0) {
      let group: OutsideLabel[] = []
      for (let k = 0; k < n; k++) {
        const i = (first + k) % n
        group.push(loose[i])
        if (gapAfter(i) || k === n - 1) {
          if (group.length >= FEATURE_CLUSTER_MIN) {
            spots.push({
              start: group[0].midAngle,
              span: normalizeAngle(group[group.length - 1].midAngle - group[0].midAngle),
              sites: [],
            })
          }
          group = []
        }
      }
    }
  }
  if (spots.length === 0) return taken

  /** How far out anything drawn over a stretch of the circle reaches. */
  const drawnOver = (start: number, span: number) => {
    let r = 0
    for (const a of outline) if (anglesOverlap(a.start, a.span, start, span)) r = Math.max(r, a.radius)
    return r
  }
  const keyOf = (l: OutsideLabel) => `feature-${outside.indexOf(l)}`

  // Where each spot's leaders start: past the rings over it, and past the
  // sites' own ticks across the backbone where nothing is drawn over it.
  const pad = 2 / baseRadius
  const stems = spots.map(spot => Math.max(drawnOver(spot.start - pad, spot.span + 2 * pad) + 4, baseRadius + 16))
  const names: PerimeterName[] = []
  const feature = (l: OutsideLabel, g: number) =>
    featurePerimeterName(l, keyOf(l), ctx, stems[g] + PERIMETER_GAP, g, stems[g])
  spots.forEach((spot, g) => {
    for (const site of spot.sites) names.push(sitePerimeterName(site, ctx, stems[g], stems[g] + PERIMETER_GAP, g))
    for (const l of outside) {
      if (taken.has(l) || !inSpot(l.midAngle, spot)) continue
      taken.add(l)
      names.push(feature(l, g))
    }
  })

  let plan = planPerimeter(names, ctx)
  for (let pass = 0; pass < 5; pass++) {
    const joining: PerimeterName[] = []
    for (const side of ['right', 'left'] as const) {
      const ps = plan[side]
      if (ps.length === 0) continue
      const row = rowH / ps[0].R
      const lo = Math.min(...ps.map(p => p.u)) - row
      const hi = Math.max(...ps.map(p => p.u)) + row
      for (const l of outside) {
        if (taken.has(l) || sideOf(l.midAngle) !== side) continue
        const u = downSide(l.midAngle, side)
        if (u < lo || u > hi) continue
        // With the spot whose names it lands among.
        const nearest = ps.reduce((best, p) => (Math.abs(p.u - u) < Math.abs(best.u - u) ? p : best))
        taken.add(l)
        joining.push(feature(l, nearest.name.group))
      }
    }
    if (joining.length === 0) break
    names.push(...joining)
    plan = planPerimeter(names, ctx)
  }

  // The circle holds the spots when its names are clear of what is drawn,
  // with leaders that read as their own, none of them far out (below), and
  // it names as many of the sites as the columns would. Where the rings
  // stack so deep by a spot that the circle past them reaches the edge of
  // the map, it does not, and the spots are listed in columns beside the
  // circle instead, each name just past what is drawn at its own height.
  const h = rowH
  const room = (p: PerimeterPlace, side: 'left' | 'right') => {
    const x = cx + Math.cos(perimeterAngle(side, p.u)) * p.R + (side === 'right' ? PERIMETER_PAD : -PERIMETER_PAD)
    const avail = side === 'right' ? ctx.width - 2 - x : x - 2
    const needs = p.name.kind === 'site' ? p.name.site.width : ctx.measureText('MM…', ctx.font(style.labelSize))
    const y = cy - (p.R + h / 2) * Math.cos(p.u)
    return avail >= needs && y - h / 2 >= 0 && y + h / 2 <= ctx.height
  }
  // And when a name would hang far past what is drawn under it: one circle
  // past a stack four rings deep leaves the names down the sides beside it a
  // long way out, where the columns follow the stack and then the circle.
  const close = (p: PerimeterPlace) => (p.slack ?? 0) <= SPOT_SLACK_ROWS * rowH
  const columns = (into: SceneItem[], hits: HitRegion[], occupied: Rect[]) => drawRunLists(into, hits, runs, outside, {
    cx, cy, width: ctx.width, height: ctx.height, occupied, outline, ringsOuter, style, colors,
    measureText: ctx.measureText, font: ctx.font,
  })
  const placed = [...plan.left.map(p => ({ p, side: 'left' as const })), ...plan.right.map(p => ({ p, side: 'right' as const }))]
  let holds = plan.settled && placed.every(({ p }) => close(p))
  if (holds && (placed.length < names.length || !placed.every(({ p, side }) => room(p, side)))) {
    // Some names would be left to their hover cards: the columns are tried
    // on the side, and the circle kept if it names as many of the sites.
    const siteKeys = new Set(runs.flat().map(s => s.text))
    const trial: SceneItem[] = []
    columns(trial, [], [...ctx.occupied])
    const inColumns = trial.filter(i => i.kind === 'text' && siteKeys.has(i.text)).length
    const onCircle = placed.filter(({ p, side }) => p.name.kind === 'site' && room(p, side)).length
    holds = onCircle >= inColumns
  }
  if (!holds) {
    drawRunBrackets(items, runs, cx, cy, ringsOuter + 4, colors)
    return columns(items, hitRegions, ctx.occupied)
  }
  spots.forEach((spot, g) => {
    if (spot.sites.length === 0) return
    items.push({
      kind: 'arcBand', cx, cy, radius: stems[g], startAngle: spot.start, span: spot.span, width: 1.5,
      strand: 0, fill: colors.enzyme, alpha: 0.6,
    })
  })
  drawPerimeter(items, hitRegions, plan, ctx)
  return taken
}

/**
 * A bracket over each run, just outside the rings, marking the stretch its
 * names come from. It used to have a stem down to the backbone at each end,
 * from when the list's lines started at the bracket; now every site has a
 * leader of its own from just outside the rings at its own angle, and the
 * stems, which ran up through the whole stack of rings, were the only lines
 * the leaders still crossed.
 */
function drawRunBrackets(
  items: SceneItem[], runs: SiteName[][],
  cx: number, cy: number, stemR: number, colors: PlasmidColors,
): void {
  for (const run of runs) {
    const a0 = run[0].angle
    const span = normalizeAngle(run[run.length - 1].angle - a0)
    items.push({
      kind: 'arcBand', cx, cy, radius: stemR, startAngle: a0, span, width: 1.5,
      strand: 0, fill: colors.enzyme, alpha: 0.6,
    })
  }
}

interface ListContext {
  cx: number
  cy: number
  width: number
  height: number
  /**
   * Boxes the lists fill, for the names laid out afterwards to keep out of.
   * The two layouts are separate passes, so without this a name held at an
   * edge can land on a list row.
   */
  occupied: Rect[]
  /** What is drawn round the circle so far, for the names to sit just past. */
  outline: OutlineArc[]
  /** Outer edge of the outermost feature ring. */
  ringsOuter: number
  style: PlasmidStyle
  colors: PlasmidColors
  measureText: (t: string, f: string) => number
  font: (px: number, bold?: boolean) => string
}

type ListEntry =
  | { kind: 'site'; angle: number; site: SiteName }
  | { kind: 'feature'; angle: number; label: OutsideLabel }

/**
 * The names at each crowded spot beside the circle, one row each, every name
 * just past what is in the way at its own height, with leaders that do not
 * cross: the default layout's crowded spots when the rings stack so deep by
 * them that the circle the names would hang on leaves no room (see
 * placeCrowdedSpots).
 *
 * A crowded spot is a run of cut sites closer together than a row of text (a
 * multiple cloning site), or a few feature names bunched round the circle,
 * together with the feature names close enough to it to compete for the same
 * room. Its names are split by side: those left of the vertical through the
 * centre go to the left, the rest to the right. So a spot at 12
 * o'clock opens both ways, and one at 3 o'clock goes right.
 *
 * Each side is read top to bottom in the order its anchors come down that
 * side, which for a run of cut sites is the cloning site's own order, and
 * each leader runs straight from its anchor to a short flat tail into its
 * name. The order is kept unless it leaves two leaders crossing out in the
 * open, and then names are moved, feature names before sites (see below).
 *
 * Feature names that would land beside a spot's names join them in their
 * place round the circle, and the side is laid out again as names join,
 * until no more do. Returns the feature names it took, so they are not
 * placed again.
 */
function drawRunLists(
  items: SceneItem[],
  hitRegions: HitRegion[],
  runs: SiteName[][],
  outside: OutsideLabel[],
  ctx: ListContext,
): Set<OutsideLabel> {
  const { cx, cy, width, height, occupied, outline, ringsOuter, style, colors, measureText, font } = ctx
  const taken = new Set<OutsideLabel>()
  const rowH = listRowHeight(style)
  // Close to the edge, as the old outside names go: the room beside a
  // centred circle is narrow.
  const margin = 2
  const stemR = ringsOuter + 4
  const labelR = ringsOuter + 10
  const rows = Math.max(1, Math.floor((height - 2 * margin) / rowH) + 1)
  const at = (r: number, a: number) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  const idealY = (a: number) => cy + Math.sin(a) * labelR
  const sideOf = (a: number): 'left' | 'right' => (Math.cos(a) >= 0 ? 'right' : 'left')
  // Rows taken per side, so two columns on one side do not overlap.
  const used: Record<'left' | 'right', { top: number; bottom: number }[]> = { left: [], right: [] }
  // How far either side of a spot a feature name still competes for its room:
  // the arc four rows of text take up just outside the rings.
  const reachAngle = (4 * rowH) / labelR

  // --- The spots: each run of sites, and each bunch of feature names ---
  interface Spot { start: number; span: number; sites: SiteName[] }
  const spots: Spot[] = runs.map(run => ({
    start: run[0].angle,
    span: normalizeAngle(run[run.length - 1].angle - run[0].angle),
    sites: run,
  }))
  const inSpot = (a: number, s: Spot) => normalizeAngle(a - (s.start - reachAngle)) <= s.span + 2 * reachAngle
  {
    const loose = outside.filter(l => !spots.some(s => inSpot(l.midAngle, s)))
      .sort((p, q) => normalizeAngle(p.midAngle) - normalizeAngle(q.midAngle))
    const n = loose.length
    const gapAfter = (i: number) => normalizeAngle(loose[(i + 1) % n].midAngle - loose[i].midAngle) > reachAngle
    // Start after a gap, so a bunch across the origin (12 o'clock, where a
    // plasmid's own junctions sit) is one bunch and not two halves.
    const first = n === 0 ? -1 : loose.findIndex((_, i) => gapAfter((i - 1 + n) % n))
    if (first >= 0) {
      let group: OutsideLabel[] = []
      for (let k = 0; k < n; k++) {
        const i = (first + k) % n
        group.push(loose[i])
        if (gapAfter(i) || k === n - 1) {
          if (group.length >= FEATURE_CLUSTER_MIN) {
            spots.push({
              start: group[0].midAngle,
              span: normalizeAngle(group[group.length - 1].midAngle - group[0].midAngle),
              sites: [],
            })
          }
          group = []
        }
      }
    }
  }

  // --- One column per side of each spot ---
  for (const spot of spots) {
    const near = outside.filter(l => !taken.has(l) && inSpot(l.midAngle, spot))
    const all: ListEntry[] = [
      ...spot.sites.map(site => ({ kind: 'site' as const, angle: site.angle, site })),
      ...near.map(label => ({ kind: 'feature' as const, angle: label.midAngle, label })),
    ]
    for (const l of near) taken.add(l)

    for (const side of ['left', 'right'] as const) {
      let entries = all.filter(e => sideOf(e.angle) === side)
      if (entries.length === 0) continue

      const place = (list: ListEntry[]) => {
        const order = [...list].sort((p, q) => downSide(p.angle, side) - downSide(q.angle, side))
        const listHeight = (order.length - 1) * rowH
        const centre = order.reduce((s, e) => s + idealY(e.angle), 0) / order.length
        let y0 = Math.min(Math.max(centre - listHeight / 2, margin + rowH / 2), height - margin - rowH / 2 - listHeight)
        for (const u of used[side]) {
          if (y0 - rowH / 2 < u.bottom && y0 + listHeight + rowH / 2 > u.top) y0 = u.bottom + rowH / 2
        }
        return { order, y0, listHeight, rowsY: order.map((_, i) => y0 + i * rowH) }
      }

      let layout = place(entries)
      for (let pass = 0; pass < 5; pass++) {
        const top = layout.y0 - rowH
        const bottom = layout.y0 + layout.listHeight + rowH
        const join = outside.filter(l => !taken.has(l)
          && sideOf(l.midAngle) === side
          && idealY(l.midAngle) >= top && idealY(l.midAngle) <= bottom)
        if (join.length === 0) break
        for (const l of join) {
          taken.add(l)
          entries.push({ kind: 'feature', angle: l.midAngle, label: l })
        }
        layout = place(entries)
      }
      // A column longer than the canvas keeps chosen sites and feature names
      // first, then sites in their order.
      if (entries.length > rows) {
        const rank = (e: ListEntry) => (e.kind === 'site' ? (e.site.picked ? 0 : 2) : 1)
        entries = entries.map((e, i) => ({ e, i }))
          .sort((p, q) => rank(p.e) - rank(q.e) || p.i - q.i)
          .slice(0, rows).map(p => p.e)
        layout = place(entries)
      }
      const { order, y0, listHeight, rowsY } = layout
      used[side].push({ top: y0 - rowH / 2, bottom: y0 + listHeight + rowH / 2 })

      type Pt = { x: number; y: number }
      const anchorOf = (e: ListEntry) => (e.kind === 'site'
        ? { angle: e.site.angle, fromR: stemR }
        : { angle: e.label.midAngle, fromR: e.label.arcRadius + style.arcWidth / 2 + 4 })

      // Each name sits just past whatever is in the way at its own height, so
      // it stays beside the stack it belongs to instead of lining up with the
      // others at the width of the widest row. In the way means what is drawn
      // there (the feature arcs, the backbone, the bracket) and the leaders of
      // this spot climbing past that height to rows further out: above the
      // stack nothing is drawn, and a name placed by the arcs alone would sit
      // on the lines going up beside it.
      const GAP = 8
      const rowY = rowsY
      // First by what is drawn alone. Once the order is known, the leaders
      // themselves are in the way too (see relax, below).
      const toX = (reach: number) => (side === 'right' ? cx + reach : cx - reach)
      const drawnReach = rowY.map(y => outlineExtent(outline, cy, y - rowH / 2, y + rowH / 2, side) + GAP)
      let rowX = drawnReach.map(toX)
      let rowEx = rowX.map(x => (side === 'right' ? x - 2 : x + 2))
      const align = side === 'right' ? 'left' : 'right'
      const availAt = (i: number) => (side === 'right' ? width - margin - rowX[i] : rowX[i] - margin)

      /** Keep a row's box, so a later name is not written over it. */
      const occupy = (i: number, w: number) => {
        const x = rowX[i]
        occupied.push({
          x1: side === 'right' ? x - 2 : x - w - 2,
          x2: side === 'right' ? x + w + 2 : x + 2,
          y1: rowY[i] - rowH / 2, y2: rowY[i] + rowH / 2,
        })
      }

      /**
       * Straight from the anchor to a short flat tail into the name. The line
       * goes at whatever slant reaches the name, so a name can sit wherever
       * there is room near its spot: a leader made to run out along its radius
       * first could only meet a row far above a 2 o'clock site a long way out
       * to the side, past free room nearer in.
       */
      const TAIL = 6
      const path = (e: ListEntry, row: number): Pt[] => {
        const { angle, fromR } = anchorOf(e)
        const y = rowY[row]
        const ex = rowEx[row]
        const start = at(fromR, angle)
        const end = { x: ex, y }
        const tail = { x: side === 'right' ? ex - TAIL : ex + TAIL, y }
        return [start, tail, end]
      }

      // Which order round the circle keeps the leaders apart depends on the
      // room above the spot. With room, each leader climbs its radius to its
      // row, and the anchor nearest 12 o'clock, whose line is the most
      // upright, must have the top row. When the rings reach the edge there
      // is nowhere to climb: every leader starts above every row and fans
      // down to the column, and then the anchor furthest from 12 o'clock,
      // nearest the column, must have the top row instead. So both orders
      // round the circle are tried, each polished by swapping neighbouring
      // rows wherever that takes a crossing away, and the one with fewer
      // crossings wins, then the one with shorter leaders.
      // Only crossings out in the open count. Leaders leaving ticks a pixel or
      // two apart, as at a multiple cloning site, leave as a bundle and may
      // cross within its first couple of rows whatever order they are in, at
      // an angle too shallow to read as a crossing; reordering the names to
      // avoid that would scramble the cloning site's order, which is plain to
      // see, to remove something that is not.
      const NEAR = 24
      const crossings = (p: Pt[], q: Pt[]) => {
        let count = 0
        for (let i = 0; i + 1 < p.length; i++) {
          for (let j = 0; j + 1 < q.length; j++) {
            const at = crossingPoint(p[i], p[i + 1], q[j], q[j + 1])
            if (!at) continue
            if (Math.hypot(at.x - p[0].x, at.y - p[0].y) < NEAR || Math.hypot(at.x - q[0].x, at.y - q[0].y) < NEAR) continue
            count++
          }
        }
        return count
      }
      const score = (list: ListEntry[]) => {
        const paths = list.map((e, i) => path(e, i))
        let count = 0
        let length = 0
        // The rows whose leaders take part in a crossing, for the polish to
        // try moving and no others.
        const involved = new Set<number>()
        for (let i = 0; i < paths.length; i++) {
          for (let k = 0; k + 1 < paths[i].length; k++) {
            length += Math.hypot(paths[i][k + 1].x - paths[i][k].x, paths[i][k + 1].y - paths[i][k].y)
          }
          for (let j = i + 1; j < paths.length; j++) {
            const c = crossings(paths[i], paths[j])
            if (c > 0) { count += c; involved.add(i); involved.add(j) }
          }
        }
        return { count, length, involved }
      }
      const better = (a: { count: number; length: number }, b: { count: number; length: number }) =>
        a.count < b.count || (a.count === b.count && a.length < b.length - 0.5)
      // A row may need to move several places at once (a feature on an inner
      // ring whose leader climbs past every other line belongs at the far
      // end), and one step at a time may not take a crossing away until the
      // last, so a name is tried in every row, not only next door.
      const polish = (list: ListEntry[]) => {
        let best = score(list)
        for (let pass = 0; pass < list.length && best.count > 0; pass++) {
          let improved = false
          // Only names whose leaders cross are moved, feature names before
          // cut sites (a cloning site's order is worth keeping), each to the
          // nearest row that takes a crossing away.
          const movable = [...best.involved].sort((p, q) =>
            Number(list[p].kind === 'site') - Number(list[q].kind === 'site') || p - q)
          for (const i of movable) {
            if (best.count === 0 || improved) break
            const rows = list.map((_, j) => j).filter(j => j !== i).sort((p, q) => Math.abs(p - i) - Math.abs(q - i))
            for (const j of rows) {
              const [moved] = list.splice(i, 1)
              list.splice(j, 0, moved)
              const now = score(list)
              if (now.count < best.count) { best = now; improved = true; break }
              list.splice(j, 1)
              list.splice(i, 0, moved)
            }
          }
          if (!improved) break
        }
        return best
      }
      /**
       * Push each name out past every other leader that passes through its
       * row, measured on the leaders as they will be drawn. A name only ever
       * moves outward, so this settles; it stops after a few rounds in any
       * case. In an order without crossings a leader passing a row runs inside
       * that row's own bend, so the push costs nothing there.
       */
      const relax = (list: ListEntry[]) => {
        // From scratch each time: a push made for an earlier order of the
        // rows is no reason to keep a name out now.
        rowX = drawnReach.map(toX)
        rowEx = rowX.map(x => (side === 'right' ? x - 2 : x + 2))
        const sign = side === 'right' ? 1 : -1
        for (let round = 0; round < 6; round++) {
          const paths = list.map((e, i) => path(e, i))
          let moved = false
          rowY.forEach((y, i) => {
            const top = y - rowH / 2
            const bottom = y + rowH / 2
            let reach = drawnReach[i] - GAP
            // Its own leader must not run through its own text. The leader
            // comes to the tail, just short of the name, from wherever the
            // anchor is; from an anchor further out than the tail it passes
            // under or over the text on the way, and clears it as long as it
            // still climbs or falls the text's half height over the tail's
            // length. So a name can sit up and in from a site low down, the
            // free room nearer the circle, and only a name almost level with a
            // site further out has to move out past it.
            {
              const a = paths[i][0]
              const lead = TAIL + 2
              const halfText = rowH / 2 - 2
              const need = (a.x - cx) * sign - lead * Math.abs(a.y - y) / halfText + lead
              reach = Math.max(reach, need - GAP)
            }
            paths.forEach((p, j) => {
              if (j === i) return
              for (let k = 0; k + 1 < p.length; k++) {
                const a = p[k]
                const b = p[k + 1]
                // The part of this segment inside the row's height.
                const lo = Math.max(top, Math.min(a.y, b.y))
                const hi = Math.min(bottom, Math.max(a.y, b.y))
                if (lo > hi) continue
                for (const yy of a.y === b.y ? [a.y] : [lo, hi]) {
                  const x = a.y === b.y ? Math.max(a.x - cx, b.x - cx) * (side === 'right' ? 1 : -1)
                    : (a.x + (b.x - a.x) * (yy - a.y) / (b.y - a.y) - cx) * (side === 'right' ? 1 : -1)
                  reach = Math.max(reach, x)
                }
              }
            })
            const next = toX(reach + GAP)
            if (side === 'right' ? next > rowX[i] + 0.5 : next < rowX[i] - 0.5) {
              rowX[i] = next
              rowEx[i] = side === 'right' ? next - 2 : next + 2
              moved = true
            }
          })
          if (!moved) break
        }
      }
      // Pushing names out can bring a crossing back, and taking one away moves
      // the leaders the names were pushed past, so the two take turns until
      // the rows are clear or a few rounds have gone by.
      // Each order is judged with its names where they will really be: before
      // the push a name can sit inside its own leader's turn, and the crossings
      // that makes are not the order's fault. So the order round the circle is
      // kept whenever, placed properly, it has no crossings; only then is the
      // other way round, or a polish, tried.
      const placed = (list: ListEntry[]) => { relax(list); return score(list) }
      let rowsOrder = [...order]
      let best = placed(rowsOrder)
      if (best.count > 0) {
        const reversed = [...order].reverse()
        const other = placed(reversed)
        if (better(other, best)) { rowsOrder = reversed; best = other }
      }
      for (let round = 0; round < 4 && best.count > 0; round++) {
        relax(rowsOrder)
        polish(rowsOrder)
        best = placed(rowsOrder)
      }
      relax(rowsOrder)

      const leader = (e: ListEntry, row: number, stroke: string, alpha?: number) => {
        const pts = path(e, row)
        for (let i = 0; i + 1 < pts.length; i++) {
          items.push({ kind: 'line', x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y, stroke, width: 0.75, alpha })
        }
      }

      rowsOrder.forEach((e, i) => {
        const y = rowY[i]
        const x = rowX[i]
        const avail = availAt(i)
        // With no room for even a few letters beside the circle (a crowded
        // spot on a small square map), a name would be one letter and an
        // ellipsis hanging off the canvas. It is left to its hover card,
        // unless it is a site the user chose, which always stays named.
        // A site's name is no use cut short ("EcoR…" could be several
        // enzymes), so it needs room for all of it.
        const f = e.kind === 'site' ? e.site.font : font(style.labelSize, e.label.hovered)
        const keep = e.kind === 'site' ? e.site.picked || e.site.hovered : e.label.hovered
        const needs = e.kind === 'site' ? e.site.width : measureText('MM…', f)
        if (avail < needs && !keep) return
        if (e.kind === 'site') {
          const site = e.site
          const fullW = site.width
          leader(e, i, site.fill, (site.hovered || site.picked ? 1 : 0.5) * site.alpha)
          const shown = fitText(site.text, site.font, Math.max(0, avail), measureText)
          items.push({
            kind: 'text', x, y, text: shown,
            font: site.font, fill: site.fill, align, baseline: 'middle',
            halo: style.labelHalo ? colors.bg : undefined,
            alpha: site.alpha < 1 ? site.alpha : undefined,
          })
          // The name is the reliable target: the ticks are a pixel or two apart.
          hitRegions.push({
            kind: 'label', id: site.key, type: 'enzyme',
            x: side === 'right' ? x + fullW / 2 : x - fullW / 2, y,
            w: fullW, h: rowH - 2, rotate: 0,
          })
          occupy(i, fullW)
        } else {
          const l = e.label
          leader(e, i, l.hovered ? colors.text : colors.tickMinor)
          const shown = fitText(l.text, f, Math.max(0, avail), measureText)
          items.push({
            kind: 'text', x, y, text: shown, font: f,
            fill: l.hovered ? colors.text : colors.textMuted, align, baseline: 'middle',
            halo: style.labelHalo ? colors.bg : undefined,
          })
          occupy(i, measureText(shown, f))
        }
      })
    }
  }
  return taken
}

/** The outer edge of something drawn round the circle: a feature, the backbone, the bracket. */
interface OutlineArc { radius: number; start: number; span: number }

/** The outer edges of the arcs and rings drawn so far, for the names round the circle to keep clear of. */
function outlineOf(items: readonly SceneItem[]): OutlineArc[] {
  const out: OutlineArc[] = []
  for (const i of items) {
    if (i.kind === 'arcBand') out.push({ radius: i.radius + i.width / 2, start: i.startAngle, span: i.span })
    else if (i.kind === 'ring') out.push({ radius: i.radius + i.width / 2, start: 0, span: Math.PI * 2 })
  }
  return out
}

/**
 * How far from the centre, sideways, anything drawn reaches between two
 * heights on one side of the circle.
 *
 * On an arc the extremes within a band of heights are where it crosses the
 * band's top or bottom, at its widest point level with the centre, or at its
 * own ends, so those are the only points looked at.
 */
function outlineExtent(
  arcs: readonly OutlineArc[], cy: number,
  yTop: number, yBottom: number, side: 'left' | 'right',
): number {
  let reach = 0
  const inArc = (a: OutlineArc, angle: number) => a.span >= Math.PI * 2 - 1e-9 || normalizeAngle(angle - a.start) <= a.span
  const consider = (a: OutlineArc, angle: number) => {
    const x = Math.cos(angle) * a.radius
    const y = cy + Math.sin(angle) * a.radius
    if (y < yTop - 1e-9 || y > yBottom + 1e-9) return
    if ((side === 'right') !== (x >= 0)) return
    if (!inArc(a, angle)) return
    reach = Math.max(reach, Math.abs(x))
  }
  for (const a of arcs) {
    for (const y of [yTop, yBottom]) {
      const dy = y - cy
      if (Math.abs(dy) > a.radius) continue
      const dx = Math.sqrt(a.radius * a.radius - dy * dy)
      consider(a, Math.atan2(dy, side === 'right' ? dx : -dx))
    }
    consider(a, side === 'right' ? 0 : Math.PI)
    if (a.span < Math.PI * 2 - 1e-9) {
      consider(a, a.start)
      consider(a, a.start + a.span)
    }
  }
  return reach
}

/** In the ring layout, names stacked at one spot inside the rings, at most. */
const MAX_INNER_STACK = 2

interface CurvedNamesContext {
  cx: number
  cy: number
  /** Radius of the first tier, just inside the innermost feature ring. */
  startR: number
  stepR: number
  /** No tier inside this, where the name and length in the middle are. */
  minR: number
  style: PlasmidStyle
  colors: PlasmidColors
  font: (px: number, bold?: boolean) => string
}

/**
 * Feature names that do not fit their arrow, in the ring layout: written along
 * the circle just inside the innermost feature ring, centred on their feature,
 * on the first tier where they do not run into a name already there.
 *
 * Curved, like the names inside the arrows, so the inside of the ring reads as
 * one set of names. No leader lines: a name sits at its own feature's angle,
 * and a line from a feature out to a name further in would run through the
 * names on the tiers between.
 *
 * At most MAX_INNER_STACK names are stacked at any one spot. Larger features
 * claim their places first, so where several small ones crowd together (the
 * operator, promoter and CAP site past a cloning site) it is the smallest
 * whose names are left off, to their hover cards; a stack of five names going
 * in towards the middle read as one block that named nothing clearly. The
 * name under the pointer goes before all of them, so it is always shown.
 *
 * Returns how far in the names reach (the inner edge of the innermost one,
 * or null when none were placed) for the GC ring to sit inside them, and the
 * names there was no room for at all inside (the rings stacked deep, a long
 * name in the middle), to be named outside with the sites instead.
 */
function placeInnerCurvedNames(
  items: SceneItem[],
  labels: readonly OutsideLabel[],
  ctx: CurvedNamesContext,
): { reach: number | null; unplaced: OutsideLabel[] } {
  const { cx, cy, startR, stepR, minR, style, colors, font } = ctx
  const tiers: { angle: number; halfSpan: number }[][] = []
  let reach: number | null = null
  const unplaced: OutsideLabel[] = []
  const sorted = [...labels].sort((a, b) =>
    Number(b.hovered) - Number(a.hovered)
    || (b.span ?? 0) - (a.span ?? 0)
    || normalizeAngle(a.midAngle) - normalizeAngle(b.midAngle))
  for (const l of sorted) {
    // No room inside at all: named outside instead.
    if (startR < minR) { unplaced.push(l); continue }
    // Past the stack's limit, the spot is crowded and the name is left off.
    for (let t = 0; t < MAX_INNER_STACK; t++) {
      const r = startR - t * stepR
      if (r < minR) break
      tiers[t] ??= []
      const halfSpan = (l.width + 10) / (2 * r)
      const clash = tiers[t].some(e => {
        let d = Math.abs(normalizeAngle(l.midAngle) - normalizeAngle(e.angle))
        if (d > Math.PI) d = TWO_PI - d
        return d < halfSpan + e.halfSpan
      })
      if (clash) continue
      tiers[t].push({ angle: l.midAngle, halfSpan })
      items.push({
        kind: 'curvedText', cx, cy, radius: r, midAngle: l.midAngle,
        text: l.text, font: font(style.labelSize, l.hovered),
        fill: l.hovered ? colors.text : colors.textMuted,
        flip: isFlipped(l.midAngle),
      })
      reach = Math.min(reach ?? Number.POSITIVE_INFINITY, r - style.labelSize / 2 - 2)
      break
    }
  }
  return { reach, unplaced }
}

/** Where two segments cross each other, or null; a shared end is not a crossing. */
function crossingPoint(
  a: { x: number; y: number }, b: { x: number; y: number },
  c: { x: number; y: number }, d: { x: number; y: number },
): { x: number; y: number } | null {
  const side = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const s1 = side(a, b, c)
  const s2 = side(a, b, d)
  if (!(s1 * s2 < -1e-6 && side(c, d, a) * side(c, d, b) < -1e-6)) return null
  const t = s1 / (s1 - s2)
  return { x: c.x + (d.x - c.x) * t, y: c.y + (d.y - c.y) * t }
}

/** The text, cut short with an ellipsis if it is wider than the room. */
function fitText(text: string, f: string, room: number, measureText: (t: string, f: string) => number): string {
  if (measureText(text, f) <= room) return text
  let t = text
  while (t.length > 1 && measureText(t + '…', f) > room) t = t.slice(0, -1)
  return t + '…'
}
