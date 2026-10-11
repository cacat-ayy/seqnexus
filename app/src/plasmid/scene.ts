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
}

// ---- Builder ----

export function buildPlasmidScene(input: PlasmidSceneInput): PlasmidScene {
  const {
    size, seqLen, style, colors, measureText, rings, hoveredAnnotationId,
    proposalIds, pickedIds, enzymeGroups, hoveredEnzymeKey, primers,
    guides, hoveredGuideKey, selectedGuideKey,
    selection, selectionSpansOrigin, selectionLength, methylation, gc,
    gcPercent, legend, displayOrigin, name, topology,
    showFeatureLabels = true, showCentre = true,
    searchHits = [], currentSearchHit = -1,
    pickedEnzymeKeys, regions = [], showCaret = true, centreNote, openEnds = false,
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
      // the end it hangs from, pointing into the map.
      const flagAt = (pos: number) => {
        const a = posToAngle(pos, seqLen)
        items.push({
          kind: 'line',
          x1: cx + Math.cos(a) * primerR, y1: cy + Math.sin(a) * primerR,
          x2: cx + Math.cos(a) * (primerR - 9), y2: cy + Math.sin(a) * (primerR - 9),
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
  const siteNames: SiteName[] = []
  for (const group of enzymeGroups) {
    const angle = posToAngle(group.cutPos, seqLen)
    const hovered = group.key === hoveredEnzymeKey
    const picked = pickedEnzymeKeys?.has(group.key) ?? false
    const ink = picked ? colors.accent : colors.enzyme
    const alpha = group.methEffect === 'blocked' ? 0.25 : group.methEffect === 'impaired' ? 0.5 : 1
    const from = baseRadius - (picked ? 14 : 10)
    const to = baseRadius + (picked ? 14 : 10)
    items.push({
      kind: 'line',
      x1: cx + Math.cos(angle) * from, y1: cy + Math.sin(angle) * from,
      x2: cx + Math.cos(angle) * to, y2: cy + Math.sin(angle) * to,
      stroke: ink, width: hovered || picked ? 3 : 1.5, alpha,
    })
    const mx = cx + Math.cos(angle) * baseRadius
    const my = cy + Math.sin(angle) * baseRadius
    items.push({ kind: 'dot', x: mx, y: my, r: hovered || picked ? 4 : 2.5, fill: ink, alpha })
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
      })
    }
  }

  // A crowded stretch of sites (a multiple cloning site) is listed beside
  // the circle; every other name goes inside, on the ruler's tiers.
  const ringsOuter = baseRadius + 14 + Math.max(0, rings.length - 1) * (style.arcWidth + style.arcGap)
    + style.arcWidth / 2
  const runs = findCrowdedRuns(siteNames, baseRadius, listRowHeight(style))
  drawRunBrackets(items, runs, cx, cy, baseRadius, ringsOuter + 4, colors)
  const listed = new Set(runs.flat().map(site => site.key))
  for (const site of siteNames) {
    if (listed.has(site.key)) continue
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
    const from = baseRadius + 2
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
      x1: cx - centreW / 2 - 8, y1: cy - 34,
      x2: cx + centreW / 2 + 8, y2: cy + 40,
    }
    const lineHeight = Math.max(style.tickSize, style.enzymeSize) + 3
    const placed = placeInnerLabels(
      innerLabels,
      baseRadius - 20,
      15,
      40,
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

      if (style.labelPlacement === 'outside' && textWidth + 8 < arcLength) {
        items.push({
          kind: 'curvedText', cx, cy, radius,
          midAngle: startAngle + span / 2,
          text: ann.name, font: labelFont,
          fill: contrastText(ann.color),
          flip: isFlipped(startAngle + span / 2),
        })
      } else if (size < SMALL_MAP && arcLength < SMALL_FEATURE_PX) {
        // A small map (the split view) leaves a small feature unnamed: its
        // name would be one more leader in the most crowded stretch, and
        // hovering the feature still names it.
        continue
      } else {
        outside.push({
          text: ann.name, display: ann.name,
          midAngle: startAngle + span / 2,
          arcRadius: radius, width: textWidth, hovered,
        })
      }
    }
  }

  // --- Lists of a crowded stretch's site names, and the feature names beside them ---
  const taken = drawRunLists(items, hitRegions, runs, outside, {
    cx, cy, size, ringsOuter, style, colors, measureText, font,
  })

  // --- Labels that did not fit inside their arc ---
  const rest = taken.size > 0 ? outside.filter(l => !taken.has(l)) : outside
  if (rest.length > 0) {
    const outermost = baseRadius + 14 + Math.max(0, rings.length - 1) * (style.arcWidth + style.arcGap)
    layoutOutsideLabels(
      items, rest, cx, cy, size, outermost, style, colors, measureText, font,
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

    // With several ranges, their total and how many.
    const rangeCount = selectionArcs.length
    if (centreNote) {
      items.push({
        kind: 'text', x: cx, y: cy + 26, text: centreNote,
        font: font(style.centreMetaSize), fill: colors.accent,
        align: 'center', baseline: 'middle',
      })
    } else if (rangeCount > 0) {
      items.push({
        kind: 'text', x: cx, y: cy + 26,
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

/** Row height of a list beside the circle, for site and feature names alike. */
function listRowHeight(style: PlasmidStyle): number {
  return Math.max(style.labelSize, style.enzymeSize) + 4
}

/**
 * Runs of CLUSTER_MIN or more cut sites closer together, on the backbone,
 * than a row of text: a multiple cloning site, where a dozen sites sit a
 * pixel or two apart and their names on the tiers inside the circle end up
 * turned every which way and partly dropped. Each run is listed beside the
 * circle instead (drawRunLists); fewer sites, or sites further apart, are
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

/**
 * A bracket over each run, just outside the rings, with a stem down to the
 * backbone at each end. Drawn before the features, so the stems pass under
 * them.
 */
function drawRunBrackets(
  items: SceneItem[], runs: SiteName[][],
  cx: number, cy: number, baseRadius: number, stemR: number, colors: PlasmidColors,
): void {
  const at = (r: number, a: number) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  for (const run of runs) {
    const a0 = run[0].angle
    const span = normalizeAngle(run[run.length - 1].angle - a0)
    for (const a of [a0, a0 + span]) {
      const p = at(baseRadius + 10, a)
      const q = at(stemR, a)
      items.push({ kind: 'line', x1: p.x, y1: p.y, x2: q.x, y2: q.y, stroke: colors.enzyme, width: 0.75, alpha: 0.6 })
    }
    items.push({
      kind: 'arcBand', cx, cy, radius: stemR, startAngle: a0, span, width: 1.5,
      strand: 0, fill: colors.enzyme, alpha: 0.6,
    })
  }
}

interface ListContext {
  cx: number
  cy: number
  size: number
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
 * The names of each crowded run in one straight list beside the circle, in
 * their order round it, each with a thin line from the bracket at its own
 * site. The list sits level with the run, on the side of the circle the run
 * is on, and starts where the outermost of its rows clears the rings.
 *
 * Feature names that would land beside the list (in a pUC19, the lac
 * operator, promoter and CAP site just past its cloning site) join it in
 * their place round the circle, with their leaders from their own arcs: on
 * their own they would be stacked outward over the list and off the canvas.
 * The list is laid out again as names join, until no more do.
 *
 * Returns the feature names it took, so they are not placed again.
 */
function drawRunLists(
  items: SceneItem[],
  hitRegions: HitRegion[],
  runs: SiteName[][],
  outside: OutsideLabel[],
  ctx: ListContext,
): Set<OutsideLabel> {
  const { cx, cy, size, ringsOuter, style, colors, measureText, font } = ctx
  const taken = new Set<OutsideLabel>()
  const rowH = listRowHeight(style)
  // Close to the edge, as the old outside names go: the room beside a
  // centred circle is narrow.
  const margin = 2
  const stemR = ringsOuter + 4
  const labelR = ringsOuter + 10
  const rows = Math.max(1, Math.floor((size - 2 * margin) / rowH) + 1)
  const at = (r: number, a: number) => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  const idealY = (a: number) => cy + Math.sin(a) * labelR
  // Rows taken per side, so two lists on one side do not overlap.
  const used: Record<'left' | 'right', { top: number; bottom: number }[]> = { left: [], right: [] }

  for (const run of runs) {
    const a0 = run[0].angle
    const mid = a0 + normalizeAngle(run[run.length - 1].angle - a0) / 2
    const side: 'left' | 'right' = Math.cos(mid) >= 0 ? 'right' : 'left'
    // Angle from the middle of the run, clockwise positive, so the order
    // holds across the origin. Down the right is clockwise, down the left
    // anticlockwise.
    const rel = (a: number) => normalizeAngle(a - mid + Math.PI) - Math.PI
    const place = (entries: ListEntry[]) => {
      const order = [...entries].sort((p, q) => (side === 'right' ? 1 : -1) * (rel(p.angle) - rel(q.angle)))
      const height = (order.length - 1) * rowH
      const centre = order.reduce((s, e) => s + idealY(e.angle), 0) / order.length
      let y0 = Math.min(Math.max(centre - height / 2, margin + rowH / 2), size - margin - rowH / 2 - height)
      for (const u of used[side]) {
        if (y0 - rowH / 2 < u.bottom && y0 + height + rowH / 2 > u.top) y0 = u.bottom + rowH / 2
      }
      return { order, y0, height }
    }

    let entries: ListEntry[] = run.map(site => ({ kind: 'site', angle: site.angle, site }))
    let layout = place(entries)
    for (let pass = 0; pass < 5; pass++) {
      const top = layout.y0 - rowH
      const bottom = layout.y0 + layout.height + rowH
      const join = outside.filter(l => !taken.has(l)
        && (Math.cos(l.midAngle) >= 0) === (side === 'right')
        && idealY(l.midAngle) >= top && idealY(l.midAngle) <= bottom)
      if (join.length === 0) break
      for (const l of join) {
        taken.add(l)
        entries.push({ kind: 'feature', angle: l.midAngle, label: l })
      }
      layout = place(entries)
    }
    // A list longer than the canvas keeps chosen sites and feature names
    // first, then sites in their order.
    if (entries.length > rows) {
      const rank = (e: ListEntry) => (e.kind === 'site' ? (e.site.picked ? 0 : 2) : 1)
      entries = entries.map((e, i) => ({ e, i }))
        .sort((p, q) => rank(p.e) - rank(q.e) || p.i - q.i)
        .slice(0, rows).map(p => p.e)
      layout = place(entries)
    }
    const { order, y0, height } = layout
    used[side].push({ top: y0 - rowH / 2, bottom: y0 + height + rowH / 2 })

    // Start where the outermost row clears the rings.
    let reach = 0
    order.forEach((_, i) => {
      const dy = Math.max(0, Math.abs(y0 + i * rowH - cy) - rowH / 2)
      if (dy < labelR) reach = Math.max(reach, Math.sqrt(labelR * labelR - dy * dy))
    })
    const x = side === 'right' ? cx + reach + 3 : cx - reach - 3
    const ex = side === 'right' ? x - 2 : x + 2
    const align = side === 'right' ? 'left' : 'right'
    const avail = Math.min(size * 0.22, side === 'right' ? size - margin - x : x - margin)

    order.forEach((e, i) => {
      const y = y0 + i * rowH
      if (e.kind === 'site') {
        const site = e.site
        const from = at(stemR, site.angle)
        items.push({
          kind: 'line', x1: from.x, y1: from.y, x2: ex, y2: y,
          stroke: site.fill, width: 0.75, alpha: (site.hovered || site.picked ? 1 : 0.5) * site.alpha,
        })
        items.push({
          kind: 'text', x, y, text: site.text, font: site.font, fill: site.fill, align, baseline: 'middle',
          halo: style.labelHalo ? colors.bg : undefined,
          alpha: site.alpha < 1 ? site.alpha : undefined,
        })
        // The name is the reliable target: the ticks are a pixel or two apart.
        hitRegions.push({
          kind: 'label', id: site.key, type: 'enzyme',
          x: side === 'right' ? x + site.width / 2 : x - site.width / 2, y,
          w: site.width, h: rowH - 2, rotate: 0,
        })
      } else {
        const l = e.label
        const f = font(style.labelSize, l.hovered)
        const from = at(l.arcRadius + style.arcWidth / 2 + 4, l.midAngle)
        items.push({
          kind: 'line', x1: from.x, y1: from.y, x2: ex, y2: y,
          stroke: l.hovered ? colors.text : colors.tickMinor, width: 0.75,
        })
        items.push({
          kind: 'text', x, y, text: fitText(l.text, f, avail, measureText), font: f,
          fill: l.hovered ? colors.text : colors.textMuted, align, baseline: 'middle',
          halo: style.labelHalo ? colors.bg : undefined,
        })
      }
    })
  }
  return taken
}

/** The text, cut short with an ellipsis if it is wider than the room. */
function fitText(text: string, f: string, room: number, measureText: (t: string, f: string) => number): string {
  if (measureText(text, f) <= room) return text
  let t = text
  while (t.length > 1 && measureText(t + '…', f) > room) t = t.slice(0, -1)
  return t + '…'
}
