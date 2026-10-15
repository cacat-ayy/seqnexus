/**
 * Painting the sequence view's rows.
 *
 * One painter for every output: the screen calls it for the rows in view,
 * the PDF export calls it once per printed line with a context that writes
 * PDF instead of pixels. What the export shows is therefore exactly what the
 * view draws, down to the label fitting and the codon chips, rather than a
 * second renderer that drifts from the first.
 *
 * Everything the painter needs arrives in a SequencePaintScene. It reads no
 * store, no refs and no DOM, so the caller decides what is live (hover,
 * selection, the drag preview) and what is left out (all of it, in print).
 */

import { selectionSegments, type Selection, type SearchState, type SearchMatch } from '../store'
import { Annotation } from '../models/Annotation'
import { displayPosition, type DocumentState } from '../models/Document'
import { baseX, type ZoomLayout } from './zoom-layout'
import type { GroupedCutSite } from '../enzymes/grouping'
import { visibleStroke, contrastText } from '../utils/color'
import { translateCodonWith, type GeneticCode } from '../codon/genetic-codes'
import {
  aminoAcidFill, aminoAcidLabel, selectionCodonsInRow, trimReadingStart, type AminoAcidStyleId, type SelectionCodon,
} from '../codon/translation-display'
import type { ReadingFrame } from '../codon/translation-display'
import { isAutoAnnotationId, keyFromAutoId } from '../utils/auto-annotations'
import { keyFromMotifId } from '../utils/motif-features'
import { annotationCode, codonStartOffset, isInitiatorCodon } from '../utils/annotation-sequence'
import { keyFromOrfId } from '../utils/orf-features'
import { isPrimerItemId, type PrimerItem } from '../primers/display'
import { drawPrimerItem } from './primer-draw'
import { isGuideId } from '../utils/guide-features'
import { drawGuideItem } from './guide-draw'
import { truncate } from './tracks/draw'
import type { GuideItem } from '../crispr/display'
import { COMPLEMENT, reverseComplement as reverseComplementStr } from '../models/complement'
import { translateCodon } from '../utils/codon'

/** Colours the painter draws with, read from the theme or set for print. */
export interface SequenceColors {
  bg: string
  text: string
  complement: string
  ruler: string
  rulerTick: string
  rowSeparator: string
  backbone: string
  selectionBg: string
  caret: string
  border: string
  enzyme: string
  enzymeBg: string
  enzymeBgHover: string
  guide: string
  guidePam: string
  guideCut: string
  search: string
  searchCurrent: string
  searchEdge: string
  dam: string
  dcm: string
  codon: string
}

/**
 * Read the painter's colours from the CSS custom properties on an element
 * inside `.app-root`. Canvas code cannot use var(), so the literal second
 * arguments are fallbacks for tests and unmounted renders, not a palette.
 */
export function readSequenceColors(el: HTMLElement): SequenceColors {
  const s = getComputedStyle(el)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  const ruler = v('--canvas-ruler', '#999999')
  return {
    bg: v('--canvas-bg', '#ffffff'),
    text: v('--canvas-text', '#213547'),
    complement: v('--canvas-complement', '#888888'),
    ruler,
    rulerTick: v('--canvas-ruler-tick', '#cccccc'),
    rowSeparator: v('--canvas-row-sep', '#f0f0f0'),
    backbone: v('--canvas-backbone', ruler),
    selectionBg: v('--selection-bg', 'rgba(59, 130, 246, 0.25)'),
    caret: v('--accent', '#3b82f6'),
    border: v('--border', '#e0e0e0'),
    enzyme: v('--canvas-enzyme', '#e53e3e'),
    enzymeBg: v('--canvas-enzyme-bg', 'rgba(229,62,62,.08)'),
    enzymeBgHover: v('--canvas-enzyme-bg-hover', 'rgba(229,62,62,.22)'),
    guide: v('--canvas-guide', '#7c3aed'),
    guidePam: v('--canvas-guide-pam', '#c4b5fd'),
    guideCut: v('--canvas-guide-cut', '#6d28d9'),
    search: v('--canvas-search', 'rgba(250,204,21,.32)'),
    searchCurrent: v('--canvas-search-current', 'rgba(249,115,22,.42)'),
    searchEdge: v('--canvas-search-edge', '#ea580c'),
    dam: v('--canvas-dam', '#3b82f6'),
    dcm: v('--canvas-dcm', '#f59e0b'),
    codon: v('--canvas-codon', 'rgba(100,116,139,.14)'),
  }
}

/**
 * Compute the visible portion of an annotation on a given row [rowStart, rowEnd).
 * For origin-spanning annotations (start > end), returns the segment that
 * overlaps this row, or null if no overlap.
 */
export function annVisibleRange(
  ann: Annotation,
  rowStart: number,
  rowEnd: number,
): [number, number] | null {
  if (ann.spansOrigin()) {
    // Tail segment: [ann.start, seqLen) - check if it overlaps this row
    if (ann.start < rowEnd && rowStart < rowEnd) {
      const tailStart = Math.max(ann.start, rowStart)
      if (tailStart < rowEnd) {
        return [tailStart, rowEnd]
      }
    }
    // Head segment: [0, ann.end) - check if it overlaps this row
    if (ann.end > rowStart && rowStart < ann.end) {
      const headEnd = Math.min(ann.end, rowEnd)
      if (rowStart < headEnd) {
        return [rowStart, headEnd]
      }
    }
    return null
  }
  // Normal annotation
  const aStart = Math.max(ann.start, rowStart)
  const aEnd = Math.min(ann.end, rowEnd)
  if (aStart >= aEnd) return null
  return [aStart, aEnd]
}

export function stackAnnotations(
  annotations: Annotation[],
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
): { rows: Annotation[][]; overflow: number } {
  const rows: Annotation[][] = []
  let overflow = 0
  for (const ann of annotations) {
    const aRange = annVisibleRange(ann, rowStart, rowEnd)
    if (!aRange) continue
    let placed = false
    for (const row of rows) {
      const overlaps = row.some(existing => {
        const bRange = annVisibleRange(existing, rowStart, rowEnd)
        if (!bRange) return false
        return aRange[0] < bRange[1] && bRange[0] < aRange[1]
      })
      if (!overlaps) {
        row.push(ann)
        placed = true
        break
      }
    }
    if (!placed) {
      if (rows.length < L.maxAnnotationRows) {
        rows.push([ann])
      } else {
        overflow++
      }
    }
  }
  return { rows, overflow }
}

export type RowStack = { rows: Annotation[][]; overflow: number }
/** A row's annotation stack, from the draw cache when it has one. */
export type RowStacks = (rowIndex: number, rowStart: number, rowEnd: number) => RowStack

/**
 * Paint one codon's backing block: inset so neighbouring codons read apart.
 *
 * `point` gives the block a small arrow tip on that side (1 right, -1 left),
 * the way annotation bars show their strand. The selection's translation
 * uses it to show which way it reads; a few pixels on every chip is enough to
 * read the direction on any line without competing with the letters.
 */
function paintCodonBlock(
  ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, h: number,
  color: string, strong: boolean, point: 0 | 1 | -1 = 0,
) {
  const w = x2 - x1 - 2
  if (w <= 0) return
  ctx.fillStyle = color
  ctx.globalAlpha = strong ? 1 : 0.5
  ctx.beginPath()
  const tip = Math.min(3, w / 3)
  if (point !== 0 && typeof ctx.arcTo === 'function') {
    // One path, so a half-strength block is not darker where parts overlap.
    // Rounded corners at the back, the tip at the front.
    const back = point === 1 ? x1 + 1 : x1 + 1 + w
    const front = point === 1 ? x1 + 1 + w : x1 + 1
    const shoulder = front - point * tip
    ctx.moveTo(shoulder, y)
    ctx.lineTo(front, y + h / 2)
    ctx.lineTo(shoulder, y + h)
    ctx.arcTo(back, y + h, back, y, 3)
    ctx.arcTo(back, y, shoulder, y, 3)
    ctx.closePath()
  } else if (typeof ctx.roundRect === 'function') ctx.roundRect(x1 + 1, y, w, h, 3)
  else ctx.rect(x1 + 1, y, w, h)
  ctx.fill()
  ctx.globalAlpha = 1
}

// Grouped enzyme sites (isoschizomer merging) live in ../enzymes/grouping.

/** Compare two grouped sites by position (reference-independent). */
function sameGroup(a: GroupedCutSite | null, b: GroupedCutSite | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.recognitionStart === b.recognitionStart && a.label === b.label
}

export function lowerBoundGroups(groups: GroupedCutSite[], minPos: number): number {
  let lo = 0, hi = groups.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (groups[mid].recognitionStart < minPos) lo = mid + 1
    else hi = mid
  }
  return lo
}

// --- Cut-site layout for one line: names in rows, bars in lanes ---

export interface TieredLabel {
  group: GroupedCutSite
  /** X position of the label (left edge) */
  x: number
  /** Pixel width of the label text */
  width: number
  /** Tier index (0 = closest to ruler, higher = further above) */
  tier: number
}

/** Names that did not fit in any row, gathered into one "+N" chip. */
export interface SiteChip {
  groups: GroupedCutSite[]
  x: number
  width: number
  /** Always the row above the last row of names. */
  tier: number
  text: string
}

export interface SiteRowLayout {
  labels: TieredLabel[]
  chips: SiteChip[]
  /** Rows of names the line needs, the chip row included. */
  tiers: number
}

/** Enzyme label font size and weight; the family is the caller's sans. */
export const ENZYME_LABEL_SPEC = '10px'
const ENZYME_LABEL_PAD = 6 // horizontal padding between labels
/** Space inside a chip either side of its text. */
const CHIP_PAD = 4
/**
 * How far a site's cut can be from the start of its recognition sequence,
 * so a search by recognition start still finds every site cutting in a line.
 * Type IIS enzymes cut up to about 20 bases away; this leaves room.
 */
const CUT_REACH = 40

/** The sites whose names belong on a line: those that cut in it, in cut order. */
function sitesCuttingIn(groups: GroupedCutSite[], rowStart: number, rowEnd: number): GroupedCutSite[] {
  const out: GroupedCutSite[] = []
  for (let i = lowerBoundGroups(groups, rowStart - CUT_REACH); i < groups.length; i++) {
    const group = groups[i]
    if (group.recognitionStart >= rowEnd + CUT_REACH) break
    if (group.fwdCut >= rowStart && group.fwdCut < rowEnd) out.push(group)
  }
  // A Type IIS site can cut before a site that starts earlier.
  return out.sort((a, b) => a.fwdCut - b.fwdCut)
}

/**
 * Lay out the cut-site names of one line.
 *
 * Each name sits at its cut, in the lowest row where it clears the name
 * before it. A line gets only the rows its names need, up to
 * `L.maxEnzymeTiers`. Names that fit in none of those used to be pushed into
 * the top row anyway, printing over each other; they now become a "+N" chip
 * in one more row above, listing them on hover. Neighbouring chips merge, so
 * the chip row cannot overprint either.
 */
export function layoutSiteRow(
  groups: GroupedCutSite[],
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
  measureLabelWidth: (text: string) => number,
): SiteRowLayout {
  const labels: TieredLabel[] = []
  const chips: SiteChip[] = []
  if (L.maxEnzymeTiers === 0 || groups.length === 0) return { labels, chips, tiers: 0 }

  // The right edge of the last name placed in each row.
  const tierRightEdge: number[] = new Array(L.maxEnzymeTiers).fill(-Infinity)
  const overflow: { group: GroupedCutSite; x: number }[] = []
  let used = 0

  for (const group of sitesCuttingIn(groups, rowStart, rowEnd)) {
    const labelX = baseX(group.fwdCut, rowStart, L)
    const labelW = measureLabelWidth(group.label)
    const tier = tierRightEdge.findIndex(edge => labelX >= edge)
    if (tier < 0) {
      overflow.push({ group, x: labelX })
      continue
    }
    tierRightEdge[tier] = labelX + labelW + ENZYME_LABEL_PAD
    labels.push({ group, x: labelX, width: labelW, tier })
    used = Math.max(used, tier + 1)
  }

  for (const { group, x } of overflow) {
    const last = chips[chips.length - 1]
    if (last && x < last.x + last.width + ENZYME_LABEL_PAD) {
      last.groups.push(group)
      last.text = `+${last.groups.length}`
      last.width = measureLabelWidth(last.text) + CHIP_PAD * 2
      continue
    }
    chips.push({ groups: [group], x, width: measureLabelWidth('+1') + CHIP_PAD * 2, tier: L.maxEnzymeTiers, text: '+1' })
  }

  return { labels, chips, tiers: chips.length > 0 ? L.maxEnzymeTiers + 1 : used }
}

/**
 * Lanes for the recognition-site bars of one line: each site in the lowest
 * lane where it does not overlap the site before it, so sites that abut or
 * share bases (the usual case in a multiple cloning site) stay apart. More
 * overlapping sites than lanes share the last lane.
 */
export function assignSiteLanes(
  groups: GroupedCutSite[],
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
): { lanes: Map<GroupedCutSite, number>; count: number } {
  const lanes = new Map<GroupedCutSite, number>()
  if (L.maxSiteLanes === 0 || groups.length === 0) return { lanes, count: 0 }
  const laneEnd: number[] = new Array(L.maxSiteLanes).fill(-Infinity)
  let count = 0
  for (let i = lowerBoundGroups(groups, rowStart - CUT_REACH); i < groups.length; i++) {
    const group = groups[i]
    if (group.recognitionStart >= rowEnd) break
    if (group.recognitionEnd <= rowStart) continue
    const start = Math.max(group.recognitionStart, rowStart)
    // Strictly after: sites that merely abut alternate lanes, so their edge shows.
    let lane = laneEnd.findIndex(end => start > end)
    if (lane < 0) lane = L.maxSiteLanes - 1
    laneEnd[lane] = Math.max(laneEnd[lane], group.recognitionEnd)
    lanes.set(group, lane)
    count = Math.max(count, lane + 1)
  }
  return { lanes, count }
}

/**
 * Fill a row layout's per-line name rows and bar lanes, before `build`.
 * The view and the PDF export both call this, so they size lines alike.
 */
export function measureSiteRows(
  rl: { tiers: Uint8Array; siteLanes: Uint8Array; totalRows: number },
  groups: GroupedCutSite[],
  rowSpan: (rowIndex: number) => [number, number],
  L: ZoomLayout,
  measureLabelWidth: (text: string) => number,
): void {
  rl.tiers.fill(0)
  rl.siteLanes.fill(0)
  if (groups.length === 0 || L.maxEnzymeTiers === 0) return
  for (let i = 0; i < rl.totalRows; i++) {
    const [rowStart, rowEnd] = rowSpan(i)
    // Most lines of a long sequence have no site: skip them without laying out.
    const first = lowerBoundGroups(groups, rowStart - CUT_REACH)
    if (first >= groups.length || groups[first].recognitionStart >= rowEnd + CUT_REACH) continue
    rl.tiers[i] = layoutSiteRow(groups, rowStart, rowEnd, L, measureLabelWidth).tiers
    rl.siteLanes[i] = assignSiteLanes(groups, rowStart, rowEnd, L).count
  }
}

/**
 * The selection's translation: the selected spans in reading order, read as
 * one sequence (see joinedSegments), and which way it reads.
 */
export interface SelectionTranslation {
  segments: [number, number][]
  reverse: boolean
}

/** Row geometry the painter reads; RowLayoutMap provides it. */
export interface RowGeometry {
  rowY(rowIndex: number): number
  rowH(rowIndex: number): number
  translationRowsAt(rowIndex: number, L: ZoomLayout): number
  /** Height of the line's cut-site names (see measureSiteRows). */
  labelAreaH(rowIndex: number, L: ZoomLayout): number
  /** Height of the line's band of site bars. */
  siteBandH(rowIndex: number, L: ZoomLayout): number
}

/** Pixels a row reserves for the graph track when one is shown. */
export const GRAPH_TRACK_H = 30

/** A windowed residue scale to draw under each row of a protein. */
export interface GraphTrack {
  /** One value per residue; NaN where the scale has none. */
  values: Float32Array
  /** The plot's extent and its guide line. */
  min: number
  max: number
  mid: number
  /** Caption in the row's margin. */
  label: string
}

/** A feature edge being dragged, drawn as a dashed preview of the new extent. */
export interface AnnotationEdgeDrag {
  annId: string
  edge: 'start' | 'end'
  originalStart: number
  originalEnd: number
  currentPos: number
}

export interface SequencePaintScene {
  doc: DocumentState
  L: ZoomLayout
  rl: RowGeometry
  /** The bases a row shows, [start, end). */
  rowSpan(rowIndex: number): [number, number]
  stacksAt: RowStacks
  groupedSites: GroupedCutSite[]
  colors: SequenceColors
  basePalette: Record<string, string>
  /** Base colours fill the cell (true) or tint the letter (false). */
  paintBackground: boolean
  fonts: { mono: string; sans: string }
  measure(font: string, text: string): number
  /** Null draws no selection band. */
  selection: Selection | null
  /** Ranges selected beside `selection`, drawn the same way. */
  extraSelections?: readonly Selection[]
  /** Drag handles on the selection's ends; a screen affordance only. */
  selectionHandles: boolean
  /** Null draws no search bands. */
  search: SearchState | null
  /** Hinted stretches (a BLAST hit pointed at); start > end runs across the origin. Absent draws none. */
  highlightRanges?: readonly { start: number; end: number }[]
  selTranslation: SelectionTranslation | null
  hoveredAnnotationId: string | null
  hoveredEnzymeGroup: GroupedCutSite | null
  annEdgeDrag: AnnotationEdgeDrag | null
  autoPicks: ReadonlySet<string>
  orfPicks: ReadonlySet<string>
  motifPicks: ReadonlySet<string>
  /** A protein's graph track: one value per residue, drawn in the row's graphH. Null draws none. */
  graph: GraphTrack | null
  primerItemById: ReadonlyMap<string, PrimerItem>
  /** Guide sites the scan found, by their stand-in annotation id. */
  guideItemById: ReadonlyMap<string, GuideItem>
  /** Guide keys picked for conversion, outlined in the accent colour. */
  guidePicks: ReadonlySet<string>
  /** Frames to translate; empty means the feature (annotation) modes. */
  translationFrames: readonly ReadingFrame[]
  translationCode: GeneticCode
  aminoAcidStyle: AminoAcidStyleId
  threeLetter: boolean
  /** Width of the row separators. */
  width: number
}

/**
 * Paint rows firstRow..lastRow (inclusive) at their rl.rowY positions.
 * The rows must be contiguous in the sequence: their bases are read once.
 */
export function paintSequenceRows(
  ctx: CanvasRenderingContext2D,
  s: SequencePaintScene,
  firstRow: number,
  lastRow: number,
): void {
  const { L, rl, doc, groupedSites, hoveredEnzymeGroup, selection, search } = s
  const { paintBackground, basePalette, hoveredAnnotationId, selTranslation, width } = s
  const COLORS = s.colors
  const seq = doc.sequence
  const seqLen = seq.length
  const topology = seq.topology
  const damMeth = doc.metadata?.damMethylated || false
  const dcmMeth = doc.metadata?.dcmMethylated || false
  const monoFont = (spec: string) => `${spec} ${s.fonts.mono}`
  const sansFont = (spec: string) => `${spec} ${s.fonts.sans}`
  const enzymeLabelFont = (hovered = false) => sansFont(hovered ? `600 ${ENZYME_LABEL_SPEC}` : ENZYME_LABEL_SPEC)

  // Search hits: the longest one (to find hits reaching into a row) and the
  // ones that run across the origin, worked out once for all rows.
  let searchSpan: { matches: SearchMatch[]; maxLen: number; wrapping: number[] } | null = null
  if (search && search.matches.length > 0) {
    const ms = search.matches
    let maxLen = 0
    for (const m of ms) if (m.end - m.start > maxLen) maxLen = m.end - m.start
    const wrapping: number[] = []
    for (let i = ms.length - 1; i >= 0 && ms[i].start + maxLen > seqLen; i--) {
      if (ms[i].end > seqLen) wrapping.push(i)
    }
    searchSpan = { matches: ms, maxLen, wrapping }
  }
  // Height of one strand when both are drawn as letters; 0 when they are not.
  const strandH = L.mode === 'letters' && L.showComplement ? (L.seqLineHeight - L.strandGap) / 2 : 0

  const visibleStart = s.rowSpan(firstRow)[0]
  const visibleEnd = s.rowSpan(lastRow)[1]
  const visibleBases = seq.basesIn(visibleStart, visibleEnd)

  const rowSepYs: number[] = []
  for (let rowIdx = firstRow; rowIdx <= lastRow; rowIdx++) {
    const [rowStart, rowEnd] = s.rowSpan(rowIdx)
    const rowY = rl.rowY(rowIdx)
    let cy = rowY

    // --- Cut-site names above the ruler, in as many rows as this line needs ---
    // With a site hovered, the others fade, so its name, line, bar and cut
    // read as one thing even in a crowded stretch.
    const labelAreaH = rl.labelAreaH(rowIdx, L)
    const fadeOthers = hoveredEnzymeGroup ? 0.35 : 1
    if (groupedSites.length > 0 && labelAreaH > 0) {
      const siteRow = layoutSiteRow(groupedSites, rowStart, rowEnd, L, t => s.measure(enzymeLabelFont(), t))
      const labelAreaBottom = rowY + labelAreaH
      const rulerLineYAbs = labelAreaBottom + 14

      for (const lbl of siteRow.labels) {
        const isHovered = sameGroup(hoveredEnzymeGroup, lbl.group)
        const methDim = lbl.group.methEffect === 'blocked' ? 0.25 : lbl.group.methEffect === 'impaired' ? 0.5 : 1
        ctx.globalAlpha = methDim * (isHovered ? 1 : fadeOthers)
        // Tier 0 is closest to ruler (bottom of label area)
        const tierY = labelAreaBottom - (lbl.tier + 1) * L.enzymeLabelTierH

        ctx.font = enzymeLabelFont(isHovered)
        ctx.fillStyle = COLORS.enzyme
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillText(lbl.group.label, lbl.x, tierY + 1)

        // Leader line from label down to ruler line
        const cutX = baseX(lbl.group.fwdCut, rowStart, L)
        ctx.strokeStyle = isHovered ? COLORS.enzyme : COLORS.enzymeBg
        ctx.lineWidth = isHovered ? 1.5 : 1
        ctx.beginPath()
        ctx.moveTo(cutX, tierY + L.enzymeLabelTierH)
        ctx.lineTo(cutX, rulerLineYAbs)
        ctx.stroke()

        // Small triangle at ruler line
        ctx.fillStyle = COLORS.enzyme
        ctx.beginPath()
        ctx.moveTo(cutX - 3, rulerLineYAbs)
        ctx.lineTo(cutX + 3, rulerLineYAbs)
        ctx.lineTo(cutX, rulerLineYAbs + 4)
        ctx.closePath()
        ctx.fill()
      }

      // "+N" chips for names no row had room for.
      ctx.font = enzymeLabelFont()
      for (const chip of siteRow.chips) {
        const chipY = labelAreaBottom - (chip.tier + 1) * L.enzymeLabelTierH + 1
        const holdsHovered = chip.groups.some(g => sameGroup(hoveredEnzymeGroup, g))
        ctx.globalAlpha = holdsHovered ? 1 : fadeOthers
        ctx.strokeStyle = COLORS.enzyme
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(chip.x + 0.5, chipY + 0.5, chip.width - 1, L.enzymeLabelTierH - 3, 3)
        ctx.stroke()
        ctx.fillStyle = COLORS.enzyme
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillText(chip.text, chip.x + 4, chipY + 1)
      }
      ctx.globalAlpha = 1
    }

    cy += labelAreaH

    // --- Ruler ---
    ctx.fillStyle = COLORS.ruler
    ctx.font = monoFont('10.5px')
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    // Adaptive tick interval based on zoom
    const tickInterval = L.mode === 'letters' ? L.basesPerGroup
      : L.basesPerRow <= 500 ? 50
      : L.basesPerRow <= 2000 ? 100
      : L.basesPerRow <= 5000 ? 500
      : 1000
    const dispOrigin = (topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
    // The row's first position is already in the margin beside the bases,
    // so the ruler starts labelling at the next tick.
    if (L.bpWidth * tickInterval > 30) {
      for (let i = rowStart + tickInterval; i < rowEnd; i += tickInterval) {
        ctx.fillText(displayPosition(i, dispOrigin, seqLen).toLocaleString('en-US'), baseX(i, rowStart, L), cy)
      }
    }
    ctx.strokeStyle = COLORS.rulerTick
    ctx.lineWidth = 1
    const rulerLineY = cy + 14
    ctx.beginPath()
    ctx.moveTo(L.leftMargin, rulerLineY)
    ctx.lineTo(baseX(rowEnd - 1, rowStart, L) + L.bpWidth, rulerLineY)
    ctx.stroke()
    ctx.beginPath()
    for (let i = rowStart; i < rowEnd; i += tickInterval) {
      const x = baseX(i, rowStart, L)
      ctx.moveTo(x, rulerLineY - 3)
      ctx.lineTo(x, rulerLineY)
    }
    ctx.stroke()

    // --- Methylation site markers (subtle ticks on ruler line) ---
    if (damMeth || dcmMeth) {
      // Scan visible bases for methylation motifs
      // Extend read window by motif length to catch sites starting before rowStart
      const methReadStart = Math.max(0, rowStart - 5)
      const methReadEnd = Math.min(seqLen, rowEnd + 5)
      const methBases = seq.basesIn(methReadStart, methReadEnd).toUpperCase()
      const methOffset = methReadStart

      ctx.globalAlpha = 0.4
      if (damMeth) {
        // Dam: GATC - methylates adenine at position 1
        ctx.fillStyle = COLORS.dam
        for (let mi = 0; mi <= methBases.length - 4; mi++) {
          if (methBases[mi] === 'G' && methBases[mi+1] === 'A' && methBases[mi+2] === 'T' && methBases[mi+3] === 'C') {
            const siteStart = mi + methOffset
            const siteEnd = siteStart + 4
            // Draw tick for each base in the motif that falls in this row
            for (let bp = Math.max(siteStart, rowStart); bp < Math.min(siteEnd, rowEnd); bp++) {
              const x = baseX(bp, rowStart, L) + L.bpWidth / 2
              ctx.beginPath()
              ctx.arc(x, rulerLineY + 1, 1.5, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
      }
      if (dcmMeth) {
        // Dcm: CCWGG (W = A or T) - methylates second cytosine
        ctx.fillStyle = COLORS.dcm
        for (let mi = 0; mi <= methBases.length - 5; mi++) {
          if (methBases[mi] === 'C' && methBases[mi+1] === 'C' &&
              (methBases[mi+2] === 'A' || methBases[mi+2] === 'T') &&
              methBases[mi+3] === 'G' && methBases[mi+4] === 'G') {
            const siteStart = mi + methOffset
            const siteEnd = siteStart + 5
            for (let bp = Math.max(siteStart, rowStart); bp < Math.min(siteEnd, rowEnd); bp++) {
              const x = baseX(bp, rowStart, L) + L.bpWidth / 2
              ctx.beginPath()
              ctx.arc(x, rulerLineY + 1, 1.5, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
      }
      ctx.globalAlpha = 1
    }

    cy += L.rulerHeight

    // --- A bar per recognition site, between the ruler and the bases ---
    // These replace a tint on the bases themselves, which turned sites that
    // abut or overlap (as they do in a multiple cloning site) into one block
    // with no visible edges. Overlapping sites go in separate lanes.
    const siteBandH = rl.siteBandH(rowIdx, L)
    if (groupedSites.length > 0 && siteBandH > 0) {
      const { lanes } = assignSiteLanes(groupedSites, rowStart, rowEnd, L)
      const barH = L.siteLaneH - 1
      for (const [group, lane] of lanes) {
        const isHovered = sameGroup(hoveredEnzymeGroup, group)
        const methDim = group.methEffect === 'blocked' ? 0.25 : group.methEffect === 'impaired' ? 0.5 : 1
        const x1 = baseX(Math.max(group.recognitionStart, rowStart), rowStart, L)
        const x2 = baseX(Math.min(group.recognitionEnd, rowEnd) - 1, rowStart, L) + L.bpWidth
        // Lane 0 sits right on the bases; more lanes stack up towards the ruler.
        const y = cy + siteBandH - L.siteBandPad - (lane + 1) * L.siteLaneH
        ctx.globalAlpha = methDim * (isHovered ? 1 : 0.7 * fadeOthers)
        ctx.fillStyle = COLORS.enzyme
        ctx.fillRect(x1 + 0.5, y, Math.max(1, x2 - x1 - 1), barH)
      }
      ctx.globalAlpha = 1
    }
    cy += siteBandH

    const forwardY = cy

    // --- A faint tint over every recognition site, on both strands ---
    // Painted as the union of the sites, so a cloning site's overlapping
    // sites make one even band rather than darker patches where they
    // overlap; the bars above are what tell the sites apart. It fades with
    // the rest while a site is hovered, and the hovered one is tinted harder
    // below.
    if (groupedSites.length > 0) {
      const spans = groupedSites
        .filter(g => g.recognitionStart < rowEnd && g.recognitionEnd > rowStart)
        .map(g => [Math.max(g.recognitionStart, rowStart), Math.min(g.recognitionEnd, rowEnd)])
        .sort((a, b) => a[0] - b[0])
      ctx.fillStyle = COLORS.enzymeBg
      ctx.globalAlpha = fadeOthers
      const tint = (from: number, to: number) => {
        const x1 = baseX(from, rowStart, L)
        ctx.fillRect(x1, cy, baseX(to - 1, rowStart, L) + L.bpWidth - x1, L.seqLineHeight)
      }
      let run: number[] | null = null
      for (const [from, to] of spans) {
        if (run && from <= run[1]) { run[1] = Math.max(run[1], to); continue }
        if (run) tint(run[0], run[1])
        run = [from, to]
      }
      if (run) tint(run[0], run[1])
      ctx.globalAlpha = 1
    }

    // --- The hovered site, tinted on both strands ---
    if (hoveredEnzymeGroup && groupedSites.length > 0) {
      const group = hoveredEnzymeGroup
      if (group.recognitionStart < rowEnd && group.recognitionEnd > rowStart) {
        const x1 = baseX(Math.max(group.recognitionStart, rowStart), rowStart, L)
        const x2 = baseX(Math.min(group.recognitionEnd, rowEnd) - 1, rowStart, L) + L.bpWidth
        ctx.fillStyle = COLORS.enzymeBgHover
        ctx.fillRect(x1, cy, x2 - x1, L.seqLineHeight)
      }
    }

    /**
     * Selection band for this row.
     *
     * Supports origin-spanning selections on circular sequences via
     * selectionSegments. `onTop` is for background colouring mode, where the
     * band is drawn after the base blocks instead of under them: a 25% tint
     * under an opaque fill is simply gone, and over one it only shifts the
     * hue, so the band also gets a hard accent edge that reads as a boundary
     * no matter what colour the bases underneath are.
     */
    const paintSelectionBand = (onTop: boolean) => {
      if (!selection) return
      const ranges = s.extraSelections?.length ? [selection, ...s.extraSelections] : [selection]
      const segs = ranges.flatMap(r => selectionSegments(r, topology, seqLen))
      for (const [selStart, selEnd] of segs) {
        const hlStart = Math.max(selStart, rowStart)
        const hlEnd = Math.min(selEnd, rowEnd)
        if (hlStart < hlEnd) {
          const x1 = baseX(hlStart, rowStart, L)
          const x2 = baseX(hlEnd - 1, rowStart, L) + L.bpWidth
          ctx.fillStyle = COLORS.selectionBg
          ctx.fillRect(x1, forwardY, x2 - x1, L.seqLineHeight)

          // A hairline edge in the accent colour: the tint alone all but
          // disappears on dark canvases, and under opaque base blocks
          // (onTop) the edge is the only thing that reads as a boundary.
          ctx.strokeStyle = COLORS.caret
          ctx.lineWidth = onTop ? 1.5 : 1
          ctx.globalAlpha = onTop ? 1 : 0.55
          ctx.beginPath()
          const inset = ctx.lineWidth / 2
          ctx.moveTo(x1, forwardY + inset)
          ctx.lineTo(x2, forwardY + inset)
          ctx.moveTo(x1, forwardY + L.seqLineHeight - inset)
          ctx.lineTo(x2, forwardY + L.seqLineHeight - inset)
          ctx.stroke()
          ctx.globalAlpha = 1
          if (!s.selectionHandles) continue

          // Drag handles: a bar along the edge with a knob on the outside
          // end, start knob on top and end knob below, as text editors do.
          const knobR = L.mode === 'letters' ? 3.5 : 2.5
          ctx.fillStyle = COLORS.caret
          const handle = (hx: number, knobY: number) => {
            ctx.fillRect(hx - 1, forwardY, 2, L.seqLineHeight)
            ctx.beginPath()
            ctx.arc(hx, knobY, knobR, 0, Math.PI * 2)
            ctx.fill()
          }
          if (selStart >= rowStart && selStart < rowEnd) {
            handle(baseX(selStart, rowStart, L), forwardY - knobR + 1)
          }
          if (selEnd > rowStart && selEnd <= rowEnd) {
            handle(baseX(selEnd - 1, rowStart, L) + L.bpWidth, forwardY + L.seqLineHeight + knobR - 1)
          }
        }
      }
    }

    /** Search match bands for this row. Buried by opaque base blocks the
     * same way the selection is, so it moves on top under the same rule. */
    const paintSearchBands = (onTop: boolean) => {
      if (!searchSpan) return
      const ms = searchSpan.matches
      const band = (from: number, to: number, mi: number) => {
        const hlStart = Math.max(from, rowStart)
        const hlEnd = Math.min(to, rowEnd)
        if (hlStart >= hlEnd) return
        const x1 = baseX(hlStart, rowStart, L)
        const x2 = baseX(hlEnd - 1, rowStart, L) + L.bpWidth
        // With both strands drawn as letters, a hit sits on the strand it
        // reads on; a hit on both strands, or any hit at a zoom with no
        // strands to tell apart, covers the whole line.
        const strand = ms[mi].strand
        const split = strandH > 0 && strand !== 0
        const y = split && strand === -1 ? forwardY + strandH + L.strandGap : forwardY
        const h = split ? strandH : L.seqLineHeight
        const isCurrent = mi === search!.currentMatch
        ctx.fillStyle = isCurrent ? COLORS.searchCurrent : COLORS.search
        ctx.fillRect(x1, y, x2 - x1, h)
        if (onTop && isCurrent) {
          ctx.strokeStyle = COLORS.searchEdge
          ctx.lineWidth = 1.5
          ctx.strokeRect(x1 + 0.75, y + 0.75, x2 - x1 - 1.5, h - 1.5)
        }
      }
      // Hits are sorted by start; backing off by the longest finds every hit
      // that reaches into this row.
      let lo = 0, hi = ms.length
      const from = rowStart - searchSpan.maxLen
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (ms[mid].start < from) lo = mid + 1
        else hi = mid
      }
      for (let mi = lo; mi < ms.length && ms[mi].start < rowEnd; mi++) band(ms[mi].start, ms[mi].end, mi)
      // The part of an origin-spanning hit past the origin, at the start.
      for (const mi of searchSpan.wrapping) band(0, ms[mi].end - seqLen, mi)
    }

    /**
     * Hinted stretches: an accent wash with an accent line along its top and
     * bottom, so it reads apart from the selection's band (a softer wash,
     * edges at half strength) and from search hits (yellow).
     */
    const paintHighlightBands = () => {
      const ranges = s.highlightRanges
      if (!ranges?.length) return
      const band = (from: number, to: number) => {
        const hlStart = Math.max(from, rowStart)
        const hlEnd = Math.min(to, rowEnd)
        if (hlStart >= hlEnd) return
        const x1 = baseX(hlStart, rowStart, L)
        const x2 = baseX(hlEnd - 1, rowStart, L) + L.bpWidth
        ctx.fillStyle = COLORS.caret
        ctx.globalAlpha = 0.14
        ctx.fillRect(x1, forwardY, x2 - x1, L.seqLineHeight)
        ctx.globalAlpha = 1
        ctx.fillRect(x1, forwardY - 1, x2 - x1, 1.5)
        ctx.fillRect(x1, forwardY + L.seqLineHeight - 0.5, x2 - x1, 1.5)
      }
      for (const r of ranges) {
        if (r.start <= r.end) band(r.start, r.end)
        else { band(r.start, seqLen); band(0, r.end) }
      }
    }

    // Opaque per-base colour blocks are only painted in letters mode; in the
    // other modes the bases sit on the canvas background and the bands below
    // stay visible, so keep them under the sequence as before.
    const bandsOnTop = paintBackground && L.mode === 'letters'
    if (!bandsOnTop) {
      paintSelectionBand(false)
      paintSearchBands(false)
      paintHighlightBands()
    }

    // --- Row position label ---
    // Centred on the forward strand, and in display coordinates like the
    // ruler: on a circular sequence with a moved origin, row 1 is not base 1.
    ctx.fillStyle = COLORS.ruler
    ctx.font = monoFont('11px')
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      displayPosition(rowStart, dispOrigin, seqLen).toLocaleString('en-US'),
      L.leftMargin - 8,
      cy + (L.mode === 'letters' ? L.letterH / 2 : L.seqLineHeight / 2),
    )
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'

    // --- Sequence rendering (mode-dependent) ---
    if (L.mode === 'letters') {
      const letterH = L.letterH
      ctx.font = monoFont(`${L.letterFont}px`)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      const bpW = L.bpWidth
      const halfBp = bpW / 2
      const midY = cy + letterH / 2
      /**
       * Draw one strand of letters.
       *
       * In background mode the cell is filled with the base's colour and the
       * glyph is drawn in whatever contrasts with that fill, so the letter
       * stays readable on both a dark G and a pale C. Fills are batched by
       * colour: a row is hundreds of cells and only ever four or five
       * distinct colours, so setting fillStyle per cell would be the most
       * expensive thing in the frame.
       */
      const drawStrand = (midOfRow: number, charAt: (i: number) => string | undefined) => {
        if (paintBackground) {
          const runsByColor = new Map<string, number[]>()
          let px = L.leftMargin
          for (let i = rowStart; i < rowEnd; i++) {
            const ch = charAt(i)
            if (ch) {
              const fill = basePalette[ch]
              // Unpalettised characters (N, gaps) get no block: a filled
              // cell would imply a call the data does not support.
              if (fill && fill !== COLORS.text) {
                let xs = runsByColor.get(fill)
                if (!xs) { xs = []; runsByColor.set(fill, xs) }
                xs.push(px)
              }
            }
            px += bpW
          }
          for (const [fill, xs] of runsByColor) {
            ctx.fillStyle = fill
            for (const x of xs) ctx.fillRect(x, midOfRow - letterH / 2, bpW, letterH)
          }
        }

        let bx = L.leftMargin
        for (let i = rowStart; i < rowEnd; i++) {
          const ch = charAt(i)
          if (ch) {
            const color = basePalette[ch] ?? COLORS.text
            ctx.fillStyle = paintBackground
              ? (color === COLORS.text ? COLORS.text : contrastText(color))
              : color
            ctx.fillText(ch, bx + halfBp, midOfRow)
          }
          bx += bpW
        }
      }

      // Forward strand
      drawStrand(midY, i => visibleBases[i - visibleStart])

      if (L.showComplement) {
        cy += letterH + L.strandGap
        const compMidY = cy + letterH / 2
        if (paintBackground) {
          // Complement gets the same treatment as the forward strand:
          // colouring one and not the other reads as an error.
          drawStrand(compMidY, i => {
            const ch = visibleBases[i - visibleStart]
            if (!ch) return undefined
            const comp = COMPLEMENT[ch.toUpperCase()] ?? ch
            return ch === ch.toLowerCase() ? comp.toLowerCase() : comp
          })
        } else {
          ctx.fillStyle = COLORS.complement
          let bx = L.leftMargin
          for (let i = rowStart; i < rowEnd; i++) {
            const ch = visibleBases[i - visibleStart]
            if (ch) {
              const comp = COMPLEMENT[ch.toUpperCase()] ?? ch
              ctx.fillText(ch === ch.toLowerCase() ? comp.toLowerCase() : comp, bx + halfBp, compMidY)
            }
            bx += bpW
          }
        }
      }
      cy += letterH
    } else {
      // Zoomed out: a backbone, with a dot per base in dots mode, which the
      // layout picks only where a base is wide enough to be a mark of its
      // own (DOT_MIN_CELL). Narrower than that the dots would merge into a
      // speckled stripe that says nothing about the sequence; features and
      // cut sites carry the meaning at this scale.
      const lineY = cy + L.seqLineHeight / 2
      const lineEnd = baseX(rowEnd - 1, rowStart, L) + L.bpWidth
      const showDots = L.mode === 'dots'
      ctx.strokeStyle = COLORS.backbone
      ctx.lineWidth = showDots ? 1 : 2
      ctx.lineCap = 'round'
      ctx.globalAlpha = showDots ? 0.6 : 0.85
      ctx.beginPath()
      ctx.moveTo(L.leftMargin, lineY)
      ctx.lineTo(lineEnd, lineY)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.lineCap = 'butt'
      if (showDots) {
        // Batch dots by color: collect x positions per color, then draw
        const dotR = Math.max(1, Math.min(3, L.bpWidth * 0.3))
        const dotsByColor = new Map<string, number[]>()
        for (let i = rowStart; i < rowEnd; i++) {
          const base = visibleBases[i - visibleStart]
          const color = basePalette[base] ?? COLORS.text
          let arr = dotsByColor.get(color)
          if (!arr) { arr = []; dotsByColor.set(color, arr) }
          arr.push(baseX(i, rowStart, L) + L.bpWidth / 2)
        }
        for (const [color, xs] of dotsByColor) {
          ctx.fillStyle = color
          ctx.beginPath()
          for (const x of xs) {
            ctx.moveTo(x + dotR, lineY)
            ctx.arc(x, lineY, dotR, 0, Math.PI * 2)
          }
          ctx.fill()
        }
      }
      cy += L.seqLineHeight
    }

    // --- Selection / search bands over opaque base colour blocks ---
    if (bandsOnTop) {
      paintSelectionBand(true)
      paintSearchBands(true)
      paintHighlightBands()
    }

    // The caret is a DOM element over the canvas (see placeCaret), so its
    // blink costs nothing here.

    // --- Annotation bars (lazy stacking: compute on first visit, cache for reuse) ---
    const cached = s.stacksAt(rowIdx, rowStart, rowEnd)
    const annRows = cached.rows
    // With the tracks hidden there are zero lanes, so everything lands in
    // overflow. Reporting "+N more" for a band the user deliberately closed
    // would be noise, and rowHeightForLanes reserves no gap in that case
    // either, so neither the label nor the leading gap applies.
    const tracksVisible = L.maxAnnotationRows > 0
    const annOverflow = tracksVisible ? cached.overflow : 0
    if (tracksVisible) cy += L.annotationGap

    // Batch annotation rendering: group by color to minimize state changes.
    // First pass: collect geometry. Second pass: fill then stroke by color.
    // `cutStart`/`cutEnd`: the edge is an exon's, at an intron, and drawn
    // square. `label`: false for all but the widest exon of a spliced
    // feature in the row, so its name is written once.
    const annBatch: {
      ann: Annotation; x1: number; x2: number; cy: number; isStart: boolean; isEnd: boolean
      cutStart?: boolean; cutEnd?: boolean; label?: boolean
    }[] = []
    // Thin lines across a spliced feature's introns, drawn under the bars;
    // a disulfide's two cysteines are joined by an arc over the lane instead.
    const intronLines: { x1: number; x2: number; y: number; color: string; arc?: boolean }[] = []
    let annCy = cy
    for (const annRow of annRows) {
      for (const ann of annRow) {
        const visRange = annVisibleRange(ann, rowStart, rowEnd)
        if (!visRange) continue
        if (ann.segments) {
          const segs = ann.segments
          const pieces: typeof annBatch = []
          for (let k = 0; k < segs.length; k++) {
            const [s0, e0] = segs[k]
            const from = Math.max(s0, rowStart)
            const to = Math.min(e0, rowEnd)
            if (from < to) {
              const last = k === segs.length - 1
              pieces.push({
                ann, cy: annCy,
                x1: baseX(from, rowStart, L), x2: baseX(to - 1, rowStart, L) + L.bpWidth,
                isStart: k === 0 && s0 >= rowStart, isEnd: last && e0 <= rowEnd,
                cutStart: k > 0 && s0 >= rowStart, cutEnd: !last && e0 <= rowEnd, label: false,
              })
            }
            if (k === segs.length - 1) continue
            // The intron to the next exon; one across the origin is two pieces.
            const gapFrom = e0
            const gapTo = segs[k + 1][0]
            const gaps: [number, number][] = gapTo >= gapFrom ? [[gapFrom, gapTo]] : [[gapFrom, seqLen], [0, gapTo]]
            for (const [g0, g1] of gaps) {
              const a = Math.max(g0, rowStart)
              const b = Math.min(g1, rowEnd)
              if (a < b) {
                intronLines.push({
                  x1: baseX(a, rowStart, L), x2: baseX(b - 1, rowStart, L) + L.bpWidth,
                  y: annCy + L.annotationRowH / 2, color: ann.color,
                  arc: ann.type === 'disulfide',
                })
              }
            }
          }
          const widest = pieces.reduce<typeof pieces[0] | null>((w, p) => !w || p.x2 - p.x1 > w.x2 - w.x1 ? p : w, null)
          if (widest) widest.label = true
          annBatch.push(...pieces.filter(p => p.x2 - p.x1 >= 0.5))
          continue
        }
        const [aStart, aEnd] = visRange
        const x1 = baseX(aStart, rowStart, L)
        const x2 = baseX(aEnd - 1, rowStart, L) + L.bpWidth
        if (x2 - x1 < 0.5) continue // skip sub-pixel annotations
        const isEnd = ann.spansOrigin()
          ? (ann.end <= rowEnd && ann.end > rowStart)
          : ann.end <= rowEnd
        const isStart = ann.spansOrigin()
          ? (ann.start >= rowStart && ann.start < rowEnd)
          : ann.start >= rowStart
        annBatch.push({ ann, x1, x2, cy: annCy, isStart, isEnd })
      }
      annCy += L.annotationRowH + L.annotationGap
    }
    cy = annCy

    // Helper to build annotation path
    const buildAnnPath = (a: typeof annBatch[0]) => {
      const { ann, x1, x2, cy: ay, isStart, isEnd, cutStart, cutEnd } = a
      const barW = x2 - x1
      const h = L.annotationRowH
      const midY = ay + h / 2
      const arrowW = Math.min(6, barW / 3)
      const cw = Math.min(5, barW / 4)

      // At very small sizes, use simple rectangles
      if (barW < 4) {
        ctx.rect(x1, ay, barW, h)
        return
      }

      ctx.moveTo(x1, ay)
      if (ann.strand === 1) {
        if (!isStart && !cutStart && barW > cw * 2) {
          ctx.moveTo(x1, ay); ctx.lineTo(x1 + cw, midY); ctx.lineTo(x1, ay + h)
        } else {
          ctx.moveTo(x1, ay); ctx.lineTo(x1, ay + h)
        }
        if (cutEnd) {
          ctx.lineTo(x2, ay + h); ctx.lineTo(x2, ay)
        } else if (isEnd && barW > arrowW * 2) {
          ctx.lineTo(x2 - arrowW, ay + h); ctx.lineTo(x2, midY); ctx.lineTo(x2 - arrowW, ay)
        } else if (!isEnd && barW > cw * 2) {
          ctx.lineTo(x2 - cw, ay + h); ctx.lineTo(x2, midY); ctx.lineTo(x2 - cw, ay)
        } else {
          ctx.lineTo(x2, ay + h); ctx.lineTo(x2, ay)
        }
      } else if (ann.strand === -1) {
        if (cutStart) {
          ctx.moveTo(x1, ay); ctx.lineTo(x1, ay + h)
        } else if (isStart && barW > arrowW * 2) {
          ctx.moveTo(x1 + arrowW, ay); ctx.lineTo(x1, midY); ctx.lineTo(x1 + arrowW, ay + h)
        } else if (!isStart && barW > cw * 2) {
          ctx.moveTo(x1 + cw, ay); ctx.lineTo(x1, midY); ctx.lineTo(x1 + cw, ay + h)
        } else {
          ctx.moveTo(x1, ay); ctx.lineTo(x1, ay + h)
        }
        if (!isEnd && !cutEnd && barW > cw * 2) {
          ctx.lineTo(x2, ay + h); ctx.lineTo(x2 - cw, midY); ctx.lineTo(x2, ay)
        } else {
          ctx.lineTo(x2, ay + h); ctx.lineTo(x2, ay)
        }
      } else {
        ctx.rect(x1, ay, barW, h)
        return
      }
      ctx.closePath()
    }

    // Render: batch fills by color, then strokes, then labels
    // Group by color for fewer state changes. Suggestions and picked ORFs
    // are held back: their dashed or accent outline cannot be batched with
    // the solid ones.
    const autoPicks = s.autoPicks
    const orfPicksNow = s.orfPicks
    const motifPicksNow = s.motifPicks
    const colorGroups = new Map<string, typeof annBatch>()
    const proposalBatch: typeof annBatch = []
    const primerBatch: typeof annBatch = []
    const guideBatch: typeof annBatch = []
    for (const a of annBatch) {
      if (isPrimerItemId(a.ann.id)) {
        primerBatch.push(a)
        continue
      }
      if (isGuideId(a.ann.id)) {
        guideBatch.push(a)
        continue
      }
      const orfK = keyFromOrfId(a.ann.id)
      const motifK = keyFromMotifId(a.ann.id)
      if (isAutoAnnotationId(a.ann.id) || (orfK !== null && orfPicksNow.has(orfK))
        || (motifK !== null && motifPicksNow.has(motifK))) {
        proposalBatch.push(a)
        continue
      }
      const c = a.ann.color
      if (!colorGroups.has(c)) colorGroups.set(c, [])
      colorGroups.get(c)!.push(a)
    }

    for (const line of intronLines) {
      ctx.strokeStyle = visibleStroke(line.color)
      ctx.lineWidth = line.arc ? 1.5 : 1
      ctx.beginPath()
      if (line.arc) {
        // The bond as an arc from the top of one cysteine's block to the
        // other's, rising above the lane; a bond that runs off the row is
        // an arc to the edge, so it still reads as leaving.
        const top = line.y - L.annotationRowH / 2
        // Shallow: it rises into the gap under the residues, not over them.
        const lift = Math.min(L.annotationGap + 4, Math.max(3, (line.x2 - line.x1) / 20))
        ctx.moveTo(line.x1, top)
        ctx.quadraticCurveTo((line.x1 + line.x2) / 2, top - lift, line.x2, top)
      } else {
        ctx.moveTo(line.x1, line.y)
        ctx.lineTo(line.x2, line.y)
      }
      ctx.stroke()
    }

    for (const [color, group] of colorGroups) {
      // Fill pass
      ctx.fillStyle = color
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      for (const a of group) {
        if (a.ann.id === hoveredAnnotationId) continue // draw hovered separately
        buildAnnPath(a)
      }
      ctx.fill()

      // Stroke pass
      ctx.globalAlpha = 1
      ctx.strokeStyle = visibleStroke(color)
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const a of group) {
        if (a.ann.id === hoveredAnnotationId) continue
        buildAnnPath(a)
      }
      ctx.stroke()
    }

    /**
     * Suggestions: dashed and faint, because they are not in the document
     * yet. Anything picked (a suggestion or an ORF) is filled more
     * strongly and outlined solid in the accent colour, so "picked" survives
     * without depending on hue; the bars are already every colour a feature
     * type can be.
     */
    for (const a of proposalBatch) {
      if (a.ann.id === hoveredAnnotationId) continue
      const autoKey = keyFromAutoId(a.ann.id)
      const orfK = keyFromOrfId(a.ann.id)
      const motifK = keyFromMotifId(a.ann.id)
      const picked = (autoKey !== null && autoPicks.has(autoKey))
        || (orfK !== null && orfPicksNow.has(orfK))
        || (motifK !== null && motifPicksNow.has(motifK))
      ctx.fillStyle = a.ann.color
      ctx.globalAlpha = picked ? 0.35 : 0.14
      ctx.beginPath()
      buildAnnPath(a)
      ctx.fill()
      ctx.globalAlpha = picked ? 1 : 0.85
      ctx.strokeStyle = picked ? COLORS.caret : visibleStroke(a.ann.color)
      ctx.lineWidth = picked ? 2 : 1
      ctx.setLineDash(picked ? [] : [4, 3])
      ctx.beginPath()
      buildAnnPath(a)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Primers: annealed bar, raised tail, mismatch marks. Drawn one by one,
    // since each is several shapes and there are few of them.
    const primerItemsNow = s.primerItemById
    for (const a of primerBatch) {
      const item = primerItemsNow.get(a.ann.id)
      if (!item) continue
      drawPrimerItem(ctx, item, a.cy, rowStart, rowEnd, L, doc.sequence.length, {
        hovered: a.ann.id === hoveredAnnotationId,
        preview: item.preview,
        stroke: visibleStroke(a.ann.color),
        mismatch: COLORS.enzyme,
      })
    }
    ctx.globalAlpha = 1

    // Guides: protospacer bar, PAM block, cut ticks. Also one by one, and
    // also few, since a scan draws only what the panel is showing.
    const guideItemsNow = s.guideItemById
    const guidePicksNow = s.guidePicks
    for (const a of guideBatch) {
      const item = guideItemsNow.get(a.ann.id)
      if (!item) continue
      drawGuideItem(ctx, item, a.cy, rowStart, rowEnd, L, doc.sequence.length, {
        hovered: a.ann.id === hoveredAnnotationId,
        preview: item.preview,
        picked: guidePicksNow.has(item.key),
        guide: COLORS.guide,
        pam: COLORS.guidePam,
        cut: COLORS.guideCut,
        accent: COLORS.caret,
        stroke: visibleStroke(COLORS.guide),
      })
    }
    ctx.globalAlpha = 1

    // Draw hovered annotation on top
    for (const a of annBatch) {
      if (a.ann.id !== hoveredAnnotationId || isPrimerItemId(a.ann.id) || isGuideId(a.ann.id)) continue
      ctx.fillStyle = a.ann.color
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      buildAnnPath(a)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = visibleStroke(a.ann.color)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      buildAnnPath(a)
      ctx.stroke()
    }

    ctx.globalAlpha = 1

    // Labels, only for bars wide enough
    ctx.fillStyle = COLORS.text
    const featureLabelFont = sansFont('500 11px')
    ctx.font = featureLabelFont
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    for (const a of annBatch) {
      const barW = a.x2 - a.x1
      if (barW <= 20 || isPrimerItemId(a.ann.id) || isGuideId(a.ann.id) || a.label === false) continue
      const h = L.annotationRowH
      const arrowW = Math.min(6, barW / 3)
      const cw = Math.min(5, barW / 4)
      let clipLeft = a.x1
      let clipRight = a.x2
      if (a.ann.strand === 1) {
        if (!a.isStart && !a.cutStart) clipLeft += cw
        if (a.cutEnd) { /* square edge */ }
        else if (a.isEnd) clipRight -= arrowW
        else clipRight -= cw
      } else if (a.ann.strand === -1) {
        if (a.cutStart) { /* square edge */ }
        else if (a.isStart) clipLeft += arrowW
        else clipLeft += cw
        if (!a.isEnd && !a.cutEnd) clipRight -= cw
      }
      const availW = clipRight - clipLeft
      const textW = s.measure(featureLabelFont, a.ann.name)
      if (textW <= availW) {
        // Text fits: no clipping needed (fast path)
        ctx.fillText(a.ann.name, (clipLeft + clipRight) / 2, a.cy + h / 2)
      } else if (availW > 12) {
        // Too long for the bar (slow path, only when necessary): shortened
        // with an ellipsis, so a short piece of a feature at a line end reads
        // "lacZ…" rather than a name cut through on both sides. A bar with
        // room for no letter before the ellipsis goes unlabelled.
        const text = truncate(ctx, a.ann.name, availW)
        if (text.length > 1) ctx.fillText(text, (clipLeft + clipRight) / 2, a.cy + h / 2)
      }
    }
    ctx.textAlign = 'left'

    // Annotation edge drag preview - dashed outline at new boundary
    if (s.annEdgeDrag) {
      for (const a of annBatch) {
        if (s.annEdgeDrag.annId !== a.ann.id) continue
        const drag = s.annEdgeDrag
        const previewStart = drag.edge === 'start' ? drag.currentPos : drag.originalStart
        const previewEnd = drag.edge === 'end' ? drag.currentPos : drag.originalEnd
        const pVisRange = annVisibleRange(
          a.ann.with({ start: previewStart, end: previewEnd }),
          rowStart, rowEnd,
        )
        if (pVisRange) {
          const [pStart, pEnd] = pVisRange
          const px1 = baseX(pStart, rowStart, L)
          const px2 = baseX(pEnd - 1, rowStart, L) + L.bpWidth
          const h = L.annotationRowH
          ctx.save()
          ctx.setLineDash([4, 3])
          ctx.strokeStyle = visibleStroke(a.ann.color)
          ctx.lineWidth = 2
          ctx.strokeRect(px1, a.cy, px2 - px1, h)
          ctx.fillStyle = a.ann.color
          ctx.globalAlpha = 0.15
          ctx.fillRect(px1, a.cy, px2 - px1, h)
          ctx.restore()
        }
      }
    }

    // --- Overflow indicator for clipped annotations ---
    if (annOverflow > 0) {
      const label = `+${annOverflow} more`
      ctx.font = sansFont('500 9px')
      const px = L.leftMargin + 4
      const py = cy - L.annotationGap - 2
      ctx.globalAlpha = 0.6
      ctx.fillStyle = COLORS.text
      ctx.fillText(label, px, py)
      ctx.globalAlpha = 1
    }

    // --- Graph track (a protein's windowed scale), under the feature lanes ---
    //
    // A filled curve from the guide line, one point per residue, so a
    // hydrophobic stretch reads as a hill over the residues that make it.
    // The caption sits in the row's margin, where the position labels are.
    if (L.graphH > 0 && s.graph) {
      const g = s.graph
      const top = cy + 2
      const h = L.graphH - 4
      const span = g.max - g.min || 1
      const yOf = (v: number) => top + h * (1 - Math.max(0, Math.min(1, (v - g.min) / span)))
      const midY = Math.round(yOf(g.mid)) + 0.5
      const x0 = baseX(rowStart, rowStart, L)
      const x1 = baseX(rowEnd - 1, rowStart, L) + L.bpWidth
      ctx.strokeStyle = COLORS.rulerTick
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, midY)
      ctx.lineTo(x1, midY)
      ctx.stroke()

      const xAt = (i: number) => baseX(i, rowStart, L) + L.bpWidth / 2
      ctx.beginPath()
      ctx.moveTo(x0, midY)
      for (let i = rowStart; i < rowEnd; i++) {
        const v = g.values[i]
        ctx.lineTo(xAt(i), Number.isNaN(v) ? midY : yOf(v))
      }
      ctx.lineTo(x1, midY)
      ctx.closePath()
      ctx.fillStyle = COLORS.caret
      ctx.globalAlpha = 0.14
      ctx.fill()
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      let pen = false
      for (let i = rowStart; i < rowEnd; i++) {
        const v = g.values[i]
        if (Number.isNaN(v)) { pen = false; continue }
        if (!pen) { ctx.moveTo(xAt(i), yOf(v)); pen = true }
        else ctx.lineTo(xAt(i), yOf(v))
      }
      ctx.strokeStyle = COLORS.caret
      ctx.lineWidth = 1.25
      ctx.stroke()
      ctx.globalAlpha = 1

      // The caption sits inside the band, haloed in the background colour
      // so it reads over the curve: the margin is sized for position
      // labels and a scale's name does not fit there.
      ctx.font = sansFont('10px')
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.lineWidth = 3
      ctx.strokeStyle = COLORS.bg
      ctx.strokeText(g.label, x0 + 2, top)
      ctx.fillStyle = COLORS.complement
      ctx.fillText(g.label, x0 + 2, top)
      cy += L.graphH
    }

    // --- Amino acid translation (letters mode only) ---
    //
    // Two shapes, chosen in the display popover. Frame mode translates the
    // sequence itself in fixed reading frames, which is a simple walk; the
    // annotation modes translate each feature, which has to respect its
    // strand and /codon_start and so keeps the older, fiddlier path below.
    const frames = s.translationFrames
    if (L.mode === 'letters' && L.maxTranslationRows > 0 && frames.length > 0) {
      const code = s.translationCode
      const aaStyle = s.aminoAcidStyle
      const threeLetter = s.threeLetter
      const seqLen = doc.sequence.length

      ctx.font = monoFont(threeLetter ? '9px' : '10px')
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'

      for (const frame of frames.slice(0, L.maxTranslationRows)) {
        // Codon boundaries in genomic coordinates. A reverse frame counts
        // its offset from the 3' end, which is where its ribosome starts.
        const anchor = frame.strand === 1 ? frame.offset : (seqLen - frame.offset) % 3
        let first = rowStart + ((anchor - rowStart) % 3 + 3) % 3
        // Start from a codon begun on the line above, so its last one or two
        // bases still get their chip here. The letter sits on the middle base,
        // so it lands on whichever side of the break holds two of the three.
        if (first > rowStart && first - 3 >= 0) first -= 3

        for (let pos = first; pos + 2 < Math.min(rowEnd + 2, seqLen); pos += 3) {
          const bases = doc.sequence.basesIn(pos, Math.min(pos + 3, seqLen)).toUpperCase()
          if (bases.length < 3) break
          const codon = frame.strand === 1 ? bases : reverseComplementStr(bases)
          const aa = translateCodonWith(code, codon)
          const codonIdx = Math.floor((pos - anchor) / 3)

          // A block behind each codon, alternating in strength, the same cue
          // the feature translations use to show where codons begin and end.
          // Its own tone, not the selection's: a translated row is not a
          // selected one. A residue with a colour of its own fills the block
          // with it instead: a solid chip reads at a glance where a coloured
          // 10px letter does not, and the gap between chips still marks the
          // codon boundaries.
          const fill = aminoAcidFill(aaStyle, aa)
          const bgFirst = Math.max(pos, rowStart)
          const bgLast = Math.min(pos + 2, rowEnd - 1)
          if (bgFirst <= bgLast) {
            paintCodonBlock(
              ctx, baseX(bgFirst, rowStart, L), baseX(bgLast, rowStart, L) + L.bpWidth,
              cy, L.translationRowH, fill ?? COLORS.codon, fill !== null || codonIdx % 2 === 0,
            )
          }

          const middle = pos + 1
          if (middle < rowStart || middle >= rowEnd) continue
          ctx.fillStyle = fill ? contrastText(fill) : COLORS.text
          ctx.fillText(
            aminoAcidLabel(aa, threeLetter),
            baseX(middle, rowStart, L) + L.bpWidth / 2,
            cy + L.translationRowH / 2,
          )
        }
        cy += L.translationRowH + L.translationGap
      }
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
    }

    if (L.mode === 'letters' && L.maxTranslationRows > 0 && frames.length === 0) {
      // The selection's translation first, nearest the sequence it was read
      // from, then the features'. The layout reserved its row wherever the
      // selection has a whole codon, which is where this finds codons.
      /**
       * One translation row of codons read through joined spans: the
       * selection's, or a spliced feature's exons. A codon's bases in this
       * row are drawn in runs of neighbours, one run usually, two where the
       * codon spans the gap between two spans. `partial` codons (fewer than
       * three bases) get a smaller blank chip when `showPartial` is set and
       * are left out otherwise.
       */
      const paintJoinedCodons = (
        codons: SelectionCodon[], reverse: boolean,
        fillFor: (aa: string) => string | null, showPartial: boolean, code: GeneticCode = s.translationCode,
      ) => {
        const threeLetter = s.threeLetter
        ctx.font = monoFont(threeLetter ? '9px' : '10px')
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        for (const { index, bases, partial } of codons) {
          if (partial && !showPartial) continue
          const inRow = bases.filter(p => p >= rowStart && p < rowEnd).sort((a, b) => a - b)
          const runs: [number, number][] = []
          for (const p of inRow) {
            const last = runs[runs.length - 1]
            if (last && p === last[1] + 1) last[1] = p
            else runs.push([p, p])
          }
          // The tip goes on the codon's last base in reading order, so a
          // codon split across lines or spans points only where it ends.
          const end = bases[bases.length - 1]
          const pointOf = ([a, b]: [number, number]) => end >= a && end <= b ? (reverse ? -1 : 1) : 0
          const blocks = (y: number, h: number, color: string, strong: boolean) => {
            for (const run of runs) {
              paintCodonBlock(
                ctx, baseX(run[0], rowStart, L), baseX(run[1], rowStart, L) + L.bpWidth,
                y, h, color, strong, pointOf(run),
              )
            }
          }
          if (partial) {
            // The codon still being selected: a smaller blank chip over the
            // bases it has so far, the next residue taking shape. It
            // becomes a full chip with its letter on the third base. Always
            // full strength: at half, the plain tone all but disappears.
            blocks(cy + 2, L.translationRowH - 4, COLORS.codon, true)
            continue
          }
          // Top-strand bases in reading order. Read leftwards, that order
          // runs 5' to 3' along the bottom strand, so the codon is their
          // complement: the reverse complement of the reversed string.
          const top = bases.map(p => doc.sequence.basesIn(p, p + 1)).join('').toUpperCase()
          const codon = reverse ? reverseComplementStr([...top].reverse().join('')) : top
          const aa = translateCodonWith(code, codon)
          const fill = fillFor(aa)
          blocks(cy, L.translationRowH, fill ?? COLORS.codon, fill !== null || index % 2 === 0)
          const middle = bases[1]
          if (middle < rowStart || middle >= rowEnd) continue
          ctx.fillStyle = fill ? contrastText(fill) : COLORS.text
          ctx.fillText(
            aminoAcidLabel(aa, threeLetter),
            baseX(middle, rowStart, L) + L.bpWidth / 2,
            cy + L.translationRowH / 2,
          )
        }
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        cy += L.translationRowH + L.translationGap
      }

      let selRowUsed = 0
      if (selTranslation) {
        const codons = selectionCodonsInRow(selTranslation.segments, selTranslation.reverse, rowStart, rowEnd)
        if (codons.length > 0) {
          // A selection has no feature colour, so "By annotation" leaves it
          // plain apart from stops.
          paintJoinedCodons(codons, selTranslation.reverse, aa => aminoAcidFill(s.aminoAcidStyle, aa), true)
          selRowUsed = 1
        }
      }

      const cdsAnnotations = annBatch.filter(a => a.ann.type === 'CDS' && a.ann.strand !== 0).map(a => a.ann)

      // Read only the visible portion of each CDS (plus codon-alignment buffer)
      // instead of the entire CDS span. Cache between dedup and render passes.
      const cdsVisData = new Map<Annotation, { aStart: number; aEnd: number; seqForTranslation: string; readStart: number }>()
      for (const ann of cdsAnnotations) {
        const visRange = annVisibleRange(ann, rowStart, rowEnd)
        if (!visRange) continue
        const [aStart, aEnd] = visRange
        // Expand read window by 3bp on each side to cover partial codons at edges
        const readStart = Math.max(ann.start, aStart - 3)
        const readEnd = Math.min(ann.end, aEnd + 3)
        const bases = doc.sequence.basesIn(readStart, readEnd)
        const seqForTranslation = ann.strand === -1 ? reverseComplementStr(bases) : bases
        cdsVisData.set(ann, { aStart, aEnd, seqForTranslation, readStart })
      }

      // Helper: get the offset into seqForTranslation for a genome position
      const localOffset = (ann: Annotation, pos: number, data: { readStart: number; seqForTranslation: string }) => {
        if (ann.strand === 1) {
          return pos - data.readStart
        } else {
          // For reverse strand, the sequence is reverse-complemented from [readStart, readEnd)
          // readEnd = readStart + seqForTranslation.length
          return (data.readStart + data.seqForTranslation.length - 1) - pos
        }
      }

      // annOffset within the full CDS (for codon frame calculation)
      const fullAnnOffset = (ann: Annotation, pos: number) => {
        return ann.strand === 1 ? pos - ann.start : (ann.end - 1 - pos)
      }

      // Collapse CDS annotations that produce identical translations in this row
      const seenTranslationKeys = new Set<string>()
      const uniqueCds: typeof cdsAnnotations = []
      for (const ann of cdsAnnotations) {
        const data = cdsVisData.get(ann)
        if (!data) continue
        const { aStart, aEnd, seqForTranslation } = data
        // A spliced feature's codons are not where the span's frame puts
        // them, so it is never taken for a duplicate.
        if (ann.segments) { uniqueCds.push(ann); continue }
        let key = `${ann.strand}:${annotationCode(ann)?.id ?? 0}:`
        for (let pos = aStart; pos < aEnd; pos++) {
          const fOffset = fullAnnOffset(ann, pos)
          if (fOffset % 3 !== 0) continue
          const lOffset = localOffset(ann, pos, data)
          if (lOffset < 0 || lOffset + 3 > seqForTranslation.length) continue
          const codon = seqForTranslation.slice(lOffset, lOffset + 3)
          key += `${pos}:${translateCodon(codon)},`
        }
        if (seenTranslationKeys.has(key)) continue
        seenTranslationKeys.add(key)
        uniqueCds.push(ann)
      }

      let translationCount = 0
      for (const ann of uniqueCds) {
        if (translationCount >= rl.translationRowsAt(rowIdx, L) - selRowUsed) break
        const data = cdsVisData.get(ann)!
        const { aStart, aEnd, seqForTranslation } = data

        const threeLetter = s.threeLetter
        const aaStyle = s.aminoAcidStyle
        // A feature that declares its code (/transl_table) is read with it,
        // whatever code the display is set to.
        const code = annotationCode(ann) ?? s.translationCode
        // The first codon of a complete CDS is its initiator: methionine, whichever start codon it is.
        const residueAt = (fOffset: number, codon: string) =>
          fOffset === 0 && isInitiatorCodon(ann, doc.sequence, codon) ? 'M' : translateCodonWith(code, codon)
        // "By annotation" colouring means the feature's own colour, which is
        // the one thing the residue palettes cannot supply. Stops keep their
        // red so they still stand out in a feature-coloured row.
        const fillFor = (aa: string) => aaStyle === 'annotation' && aa !== '*'
          ? ann.color
          : aminoAcidFill(aaStyle, aa)

        // A spliced feature is read through its exons only, joined as the
        // selection's ranges are, from /codon_start on. Rows inside an
        // intron have no codons and leave the row to the next feature.
        if (ann.segments) {
          const reverse = ann.strand === -1
          const codons = selectionCodonsInRow(
            trimReadingStart(ann.segments, codonStartOffset(ann), reverse), reverse, rowStart, rowEnd)
          if (codons.length === 0) continue
          paintJoinedCodons(codons, reverse, fillFor, false, code)
          translationCount++
          continue
        }

        // A codon is found by its first base in reading order, which for one
        // split by the line break can sit up to two bases outside this row:
        // before it on the forward strand, after it on the reverse. Look that
        // far out so the piece in this row still gets its chip, and its letter
        // when the middle base is here. Kept inside the feature, and not for
        // one across the origin, whose offsets do not run past the row.
        const reach = ann.spansOrigin() ? 0 : 2
        const scanFrom = Math.max(aStart - reach, ann.start)
        const scanTo = Math.min(aEnd + reach, ann.end)

        // Draw codon backgrounds spanning the 3 nucleotide columns:
        // alternating plain blocks, or chips filled with the residue's
        // colour, as in the frame translations above.
        for (let pos = scanFrom; pos < scanTo; pos++) {
          const fOffset = fullAnnOffset(ann, pos)
          if (fOffset % 3 !== 0) continue
          const lOffset = localOffset(ann, pos, data)
          if (lOffset < 0 || lOffset + 3 > seqForTranslation.length) continue
          const codonIdx = Math.floor(fOffset / 3)
          const codon = seqForTranslation.slice(lOffset, lOffset + 3)
          const fill = fillFor(residueAt(fOffset, codon))
          const firstBase = ann.strand === 1 ? pos : pos - 2
          const lastBase = ann.strand === 1 ? pos + 2 : pos
          const clampedFirst = Math.max(firstBase, rowStart)
          const clampedLast = Math.min(lastBase, rowEnd - 1)
          if (clampedFirst > clampedLast) continue
          paintCodonBlock(
            ctx, baseX(clampedFirst, rowStart, L), baseX(clampedLast, rowStart, L) + L.bpWidth,
            cy, L.translationRowH, fill ?? COLORS.codon, fill !== null || codonIdx % 2 === 0,
          )
        }

        // Draw AA letters
        ctx.font = monoFont(threeLetter ? '9px' : '10px')
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        const aaHalfBp = L.bpWidth / 2
        for (let pos = scanFrom; pos < scanTo; pos++) {
          const fOffset = fullAnnOffset(ann, pos)
          if (fOffset % 3 !== 0) continue
          const lOffset = localOffset(ann, pos, data)
          if (lOffset < 0 || lOffset + 3 > seqForTranslation.length) continue
          const codon = seqForTranslation.slice(lOffset, lOffset + 3)
          const aa = residueAt(fOffset, codon)
          let middleBase: number
          if (ann.strand === 1) {
            middleBase = pos + 1
            if (middleBase >= aEnd) continue
          } else {
            middleBase = pos - 1
            if (middleBase < aStart) continue
          }
          if (middleBase < rowStart || middleBase >= rowEnd) continue
          const x = baseX(middleBase, rowStart, L) + aaHalfBp
          const fill = fillFor(aa)
          ctx.fillStyle = fill ? contrastText(fill) : COLORS.text
          ctx.fillText(aminoAcidLabel(aa, threeLetter), x, cy + L.translationRowH / 2)
        }
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        cy += L.translationRowH + L.translationGap
        translationCount++
      }
    }

    // --- Where each site cuts, drawn over the bases (after all row content) ---
    // With both strands as letters, a step: down through the top strand at
    // its cut, across between the strands, down through the bottom strand at
    // its cut. The step's width is the overhang, so a sticky end, a blunt end
    // and which strand protrudes all read at a glance. Without a second
    // strand there is only the top-strand cut to show.
    if (groupedSites.length > 0 && L.maxEnzymeTiers > 0) {
      const xAt = (pos: number) => (pos >= rowEnd ? baseX(rowEnd - 1, rowStart, L) + L.bpWidth : baseX(pos, rowStart, L))
      const inRow = (pos: number) => pos >= rowStart && pos <= rowEnd
      const clamp = (pos: number) => Math.min(Math.max(pos, rowStart), rowEnd)
      const topY = forwardY
      const midY = forwardY + strandH + L.strandGap / 2
      const botY = forwardY + L.seqLineHeight
      for (let gi = lowerBoundGroups(groupedSites, rowStart - CUT_REACH); gi < groupedSites.length; gi++) {
        const group = groupedSites[gi]
        if (group.recognitionStart >= rowEnd + CUT_REACH) break
        const fwd = group.fwdCut
        let rev = group.sites[0]?.revCut ?? fwd
        // A cut pair straddling the origin of a circle: read it the short way.
        if (topology === 'circular' && Math.abs(rev - fwd) > seqLen / 2) rev += rev < fwd ? seqLen : -seqLen
        if (!inRow(fwd) && !inRow(rev) && !(Math.min(fwd, rev) < rowStart && Math.max(fwd, rev) > rowEnd)) continue

        const isHovered = sameGroup(hoveredEnzymeGroup, group)
        const methDim = group.methEffect === 'blocked' ? 0.25 : group.methEffect === 'impaired' ? 0.5 : 1
        ctx.globalAlpha = methDim * (isHovered ? 1 : 0.8 * fadeOthers)
        ctx.strokeStyle = COLORS.enzyme
        ctx.lineWidth = isHovered ? 2 : 1.25
        ctx.beginPath()
        if (strandH > 0) {
          if (inRow(fwd)) { ctx.moveTo(xAt(fwd), topY); ctx.lineTo(xAt(fwd), midY) }
          if (fwd !== rev) { ctx.moveTo(xAt(clamp(fwd)), midY); ctx.lineTo(xAt(clamp(rev)), midY) }
          if (inRow(rev)) { ctx.moveTo(xAt(rev), midY); ctx.lineTo(xAt(rev), botY) }
        } else if (inRow(fwd)) {
          ctx.moveTo(xAt(fwd), topY)
          ctx.lineTo(xAt(fwd), botY)
        }
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    rowSepYs.push(rowY + rl.rowH(rowIdx) - 1)
  }

  // --- Row separators (batched) ---
  if (rowSepYs.length > 0) {
    ctx.strokeStyle = COLORS.rowSeparator
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const sy of rowSepYs) {
      ctx.moveTo(0, sy)
      ctx.lineTo(width, sy)
    }
    ctx.stroke()
  }
}
