/**
 * The gel as positioned shapes, in CSS pixels.
 *
 * A scene is everything a painter needs and nothing it has to work out: the
 * slab, the wells, every species as a Gaussian to rasterise, every merged band
 * as a rectangle to hit-test, the size labels and the caption. The canvas, the
 * high-resolution PNG, the SVG and the PDF all paint the same scene, so they
 * cannot drift apart.
 */

import { bandLabelBp, type GelBand, type GelLayout } from '../bands'
import { GEL_FORMATS } from '../migration'
import { toneMap, bandPeakDensity } from './raster'

export interface Rect { x: number; y: number; w: number; h: number }

export interface SceneLaneInput {
  /** Short label above the well. */
  label: string
  isLadder: boolean
}

export interface SceneLane extends Rect {
  cx: number
  label: string
  isLadder: boolean
  /** Something was loaded, so the lane carries loading dye. */
  loaded: boolean
}

/** One population of molecules, drawn as a Gaussian. */
export interface SceneSpecies {
  laneIdx: number
  /** Centre, in px. */
  y: number
  sigmaPx: number
  sigmaMm: number
  ng: number
}

/** A merged band as the eye sees it: for hit-testing and the schematic look. */
export interface SceneBand extends Rect {
  laneIdx: number
  /** Index of the band within its lane, top first. */
  bandIdx: number
  band: GelBand
  isLadder: boolean
  /** Brightness at the band's centre, 0..1, after the tone map. */
  peak: number
}

export interface SceneSizeLabel { y: number; text: string; major: boolean }

export interface GelScene {
  width: number
  height: number
  slab: Rect
  /**
   * The gel as a photo: the slab plus its label margins. Painted in the
   * look's frame colour; anything outside it is left transparent.
   */
  figure: Rect
  /** Numbers centred over the wells, or names written at 45°. */
  labelMode: 'numbers' | 'names'
  /** Where one more lane would go, for an add-lane target. Never painted. */
  ghost: Rect | null
  /** Top of the well slots. */
  wellY: number
  wellH: number
  /** Where migration starts: the bottom of the wells. */
  originY: number
  pxPerMm: number
  lanes: SceneLane[]
  species: SceneSpecies[]
  bands: SceneBand[]
  /** Ladder sizes, drawn in the left margin at the first ladder's bands. */
  sizeLabels: SceneSizeLabel[]
  /** Lanes that lost fragments off the bottom. */
  ranOff: { laneIdx: number; count: number }[]
  dyeFronts: { name: string; y: number; color: string }[]
  caption: string
}

const HEADER = 26
/** Rough width of one label character at 10 px, for sizing the header. */
const LABEL_CHAR_W = 5.6
const MAX_HEADER = 120
const FOOTER = 20
const SIZE_LABEL_MARGIN = 50
const SIDE_MARGIN = 12
const SLAB_PAD = 14
/** Narrowest figure, so the caption always fits inside it. */
const MIN_FIGURE_W = 210
const WELL_OFFSET = 10
const WELL_H = 6
const BOTTOM_PAD = 8
const MIN_LANE_W = 22
const MAX_LANE_W = 60
/** Gap between lanes as a share of lane width: real combs leave narrow teeth. */
const LANE_GAP_RATIO = 0.3

export function formatBp(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(bp >= 10000 ? 0 : 1)} kb`
  return `${bp} bp`
}

export interface SceneInput {
  width: number
  height: number
  layout: GelLayout
  lanes: SceneLaneInput[]
  /** Exposure in stops, for the brightness of flat schematic bands. */
  exposure: number
  labelMode?: 'numbers' | 'names'
  /** Reserve a slot after the last lane for an add-lane target. */
  ghostLane?: boolean
}

export function buildScene({ width, height, layout, lanes, exposure, labelMode = 'numbers', ghostLane = false }: SceneInput): GelScene {
  // Names at 45° need headroom in proportion to the longest one.
  const longest = Math.max(0, ...lanes.map(l => l.label.length))
  const header = labelMode === 'names'
    ? Math.min(MAX_HEADER, Math.max(HEADER, longest * LABEL_CHAR_W * Math.SQRT1_2 + 16))
    : HEADER
  const hasLadder = lanes.some(l => l.isLadder)
  const leftMargin = hasLadder ? SIZE_LABEL_MARGIN : SIDE_MARGIN
  const slabMaxW = Math.max(0, width - leftMargin - SIDE_MARGIN)

  const count = lanes.length
  const slots = count + (ghostLane ? 1 : 0)
  const laneW = count === 0 ? MAX_LANE_W : Math.min(MAX_LANE_W, Math.max(MIN_LANE_W,
    (slabMaxW - SLAB_PAD * 2) / (slots + (slots - 1) * LANE_GAP_RATIO)))
  const gap = laneW * LANE_GAP_RATIO
  const slotsW = slots * laneW + Math.max(0, slots - 1) * gap
  const slabW = Math.min(slabMaxW, slotsW + SLAB_PAD * 2)
  const slab: Rect = {
    x: leftMargin + (slabMaxW - slabW) / 2,
    y: header,
    w: slabW,
    h: Math.max(0, height - header - FOOTER),
  }

  let figX = slab.x - leftMargin
  let figW = slab.w + leftMargin + SIDE_MARGIN
  if (figW < MIN_FIGURE_W) { figX -= (MIN_FIGURE_W - figW) / 2; figW = MIN_FIGURE_W }
  figX = Math.max(0, Math.min(figX, width - figW))
  const figure: Rect = { x: figX, y: 0, w: Math.min(figW, width), h: height }

  const wellY = slab.y + WELL_OFFSET
  const originY = wellY + WELL_H
  const pxPerMm = Math.max(0, slab.y + slab.h - BOTTOM_PAD - originY) / layout.runLengthMm
  const startX = slab.x + (slab.w - slotsW) / 2
  const ghost: Rect | null = ghostLane
    ? { x: startX + count * (laneW + gap), y: wellY, w: laneW, h: WELL_H }
    : null

  const sceneLanes: SceneLane[] = []
  const species: SceneSpecies[] = []
  const bands: SceneBand[] = []
  const ranOff: GelScene['ranOff'] = []
  const firstLadder = lanes.findIndex(l => l.isLadder)
  const sizeLabels: SceneSizeLabel[] = []

  for (let i = 0; i < count; i++) {
    const x = startX + i * (laneW + gap)
    const lane = layout.lanes[i]
    const loaded = !!lane && (lane.bands.length > 0 || lane.ranOff.length > 0)
    sceneLanes.push({ x, y: wellY, w: laneW, h: WELL_H, cx: x + laneW / 2, label: lanes[i].label, isLadder: lanes[i].isLadder, loaded })
    if (!lane) continue
    if (lane.ranOff.length > 0) ranOff.push({ laneIdx: i, count: lane.ranOff.length })

    lane.bands.forEach((band, bandIdx) => {
      for (const m of band.members) {
        species.push({ laneIdx: i, y: originY + m.mm * pxPerMm, sigmaPx: m.sigmaMm * pxPerMm, sigmaMm: m.sigmaMm, ng: m.ng })
      }
      const y = originY + band.mm * pxPerMm
      // A Gaussian reads as about ±1.2 sigma wide; keep it big enough to hover.
      const h = Math.max(4, band.sigmaMm * 2.4 * pxPerMm)
      bands.push({
        laneIdx: i, bandIdx, x, y: y - h / 2, w: laneW, h, band,
        isLadder: lanes[i].isLadder,
        peak: toneMap(bandPeakDensity(band), exposure),
      })
      if (i === firstLadder) {
        const bp = bandLabelBp(band)
        sizeLabels.push({ y, text: formatBp(bp), major: band.members.some(m => m.reference) || bp % 1000 === 0 })
      }
    })
  }

  const dyeFronts = layout.dyeFronts
    .map(d => ({ name: d.name, y: originY + d.mm * pxPerMm, color: d.color }))
    .filter(d => d.y < slab.y + slab.h)

  const c = layout.conditions
  const caption = `${c.agarosePct}% agarose · ${c.buffer} · ${GEL_FORMATS[c.format]?.label ?? c.format}`

  return {
    width, height, slab, figure, labelMode, ghost, wellY, wellH: WELL_H, originY, pxPerMm,
    lanes: sceneLanes, species, bands, sizeLabels: thinLabels(sizeLabels), ranOff, dyeFronts, caption,
  }
}

/** Minimum vertical gap between size labels, in px. */
const LABEL_GAP = 9

/**
 * Drop labels that would overprint each other in the compression zone,
 * keeping reference and round-number sizes first.
 */
function thinLabels(labels: SceneSizeLabel[]): SceneSizeLabel[] {
  const byPriority = [...labels].sort((a, b) => Number(b.major) - Number(a.major))
  const kept: SceneSizeLabel[] = []
  for (const l of byPriority) {
    if (kept.every(k => Math.abs(k.y - l.y) >= LABEL_GAP)) kept.push(l)
  }
  return kept.sort((a, b) => a.y - b.y)
}
