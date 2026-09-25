/**
 * Canvas-based sequence view with selection support.
 *
 * Renders the sequence as rows of monospaced characters with:
 * - Position ruler every 10 bp
 * - Forward strand (5'→3') - bases fetched via PieceTable.charAt()
 * - Complement strand (3'→5')
 * - Annotation bars below the complement strand
 * - Selection highlight and caret
 *
 * Uniform row height: every row has the same pixel height (with a fixed
 * max annotation stack depth). Row Y positions are computed arithmetically
 * from the scroll offset - no full-scan layout pass needed.
 *
 * At 5M bp / 60 bp per row = ~83k rows. Only the ~30 visible rows are
 * drawn per frame.
 */

import { useRef, useEffect, useCallback, useState, useMemo, memo } from 'react'
import { useEditorStore, selectionRange, selectionSegments, isOriginSpanningSelection, selectionLength } from '../store'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { displayPosition } from '../models/Document'
import { IntervalTree } from '../models/IntervalTree'
import { getLayout, baseX as zBaseX, type ZoomLayout, RowLayoutMap } from './zoom-layout'
import type { CutSite } from '../enzymes/finder'
import { methylationEffect } from '../enzymes/db'
import { orfColor } from '../workers/orf-finder'
import AnnotationTooltip, { AnnotationTooltipContent } from './AnnotationTooltip'
import { annotationBases, annotationProtein, canTranslateAnnotation } from '../utils/annotation-sequence'
import { useDelayedHover, type HoverTarget } from '../hooks/useDelayedHover'
import EnzymeTooltip, { EnzymeGroupTooltipContent } from './EnzymeTooltip'
import ContextMenuPopup from './ContextMenuPopup'
import ConfirmDialog from './ConfirmDialog'
import { calcTm } from '../primers/thermodynamics'
import MinimapBar from './MinimapBar'

const MINIMAP_SEQ_THRESHOLD = 1_000 // show minimap for sequences >= 1 kb

/** Read canvas colors from CSS custom properties for theme support. */
type CanvasColors = ReturnType<typeof readCanvasColors>
function readCanvasColors(container: HTMLElement) {
  const s = getComputedStyle(container)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--canvas-bg', '#ffffff'),
    text: v('--canvas-text', '#213547'),
    complement: v('--canvas-complement', '#888888'),
    ruler: v('--canvas-ruler', '#999999'),
    rulerTick: v('--canvas-ruler-tick', '#cccccc'),
    rowSeparator: v('--canvas-row-sep', '#f0f0f0'),
    selectionBg: v('--selection-bg', 'rgba(59, 130, 246, 0.25)'),
    caret: v('--accent', '#3b82f6'),
    border: v('--border', '#e0e0e0'),
    enzyme: v('--canvas-enzyme', '#e53e3e'),
    enzymeBg: v('--canvas-enzyme-bg', 'rgba(229,62,62,.08)'),
    enzymeBgHover: v('--canvas-enzyme-bg-hover', 'rgba(229,62,62,.22)'),
  }
}

/** Cached color reader – re-reads CSS only when the theme attribute changes. */
let _cachedColors: CanvasColors | null = null
let _cachedTheme: string | null = null
function getCanvasColors(container: HTMLElement): CanvasColors {
  const root = container.closest('[data-theme]')
  const theme = root?.getAttribute('data-theme') ?? null
  if (_cachedColors && theme === _cachedTheme) return _cachedColors
  _cachedTheme = theme
  _cachedColors = readCanvasColors(container)
  return _cachedColors
}

import { visibleStroke, contrastText } from '../utils/color'
import { buildBasePalette } from '../utils/base-colors'

// Module-level layout ref - set during draw(), used by hit-test helpers
function baseX(i: number, rowStart: number, L: ZoomLayout): number {
  return zBaseX(i, rowStart, L)
}

/**
 * Compute the visible portion of an annotation on a given row [rowStart, rowEnd).
 * For origin-spanning annotations (start > end), returns the segment that
 * overlaps this row, or null if no overlap.
 */
function annVisibleRange(
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

function stackAnnotations(
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

function hitTestAnnotation(
  px: number,
  py: number,
  seqLen: number,
  annTree: IntervalTree,
  L: ZoomLayout,
  rl: RowLayoutMap,
): Annotation | null {
  if (seqLen === 0) return null
  const rowIndex = rl.rowAtY(py)
  const totalRows = Math.ceil(seqLen / L.basesPerRow)
  if (rowIndex < 0 || rowIndex >= totalRows) return null
  const rowStart = rowIndex * L.basesPerRow
  const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
  const rowY = rl.rowY(rowIndex)
  const annStartY = rowY + L.enzymeLabelAreaH + L.rulerHeight + L.seqLineHeight + L.annotationGap
  if (py < annStartY) return null
  const annEndY = annStartY + rl.lanes[rowIndex] * (L.annotationRowH + L.annotationGap)
  if (py > annEndY) return null
  const annRowIdx = Math.floor((py - annStartY) / (L.annotationRowH + L.annotationGap))
  if (annRowIdx >= rl.lanes[rowIndex]) return null
  const rowAnnotations = annTree.queryRange(rowStart, rowEnd)
  const { rows: stacked } = stackAnnotations(rowAnnotations, rowStart, rowEnd, L)
  if (annRowIdx >= stacked.length) return null
  for (const ann of stacked[annRowIdx]) {
    const visRange = annVisibleRange(ann, rowStart, rowEnd)
    if (!visRange) continue
    const [aStart, aEnd] = visRange
    const x1 = baseX(aStart, rowStart, L)
    const x2 = baseX(aEnd - 1, rowStart, L) + L.bpWidth
    if (px >= x1 && px <= x2) return ann
  }
  return null
}

/**
 * Detect if a pixel position is near the start or end edge of an annotation bar.
 * Returns the annotation and which edge, or null.
 * Skips ORFs (type starting with 'ORF') and auto-generated primers.
 */
function hitTestAnnotationEdge(
  px: number,
  py: number,
  seqLen: number,
  annTree: IntervalTree,
  L: ZoomLayout,
  rl: RowLayoutMap,
): { annotation: Annotation; edge: 'start' | 'end' } | null {
  if (seqLen === 0) return null
  const TOLERANCE = Math.max(5, L.bpWidth * 0.6)
  const rowIndex = rl.rowAtY(py)
  const totalRows = Math.ceil(seqLen / L.basesPerRow)
  if (rowIndex < 0 || rowIndex >= totalRows) return null
  const rowStart = rowIndex * L.basesPerRow
  const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
  const rowY = rl.rowY(rowIndex)
  const annStartY = rowY + L.enzymeLabelAreaH + L.rulerHeight + L.seqLineHeight + L.annotationGap
  if (py < annStartY) return null
  const annEndY = annStartY + rl.lanes[rowIndex] * (L.annotationRowH + L.annotationGap)
  if (py > annEndY) return null
  const annRowIdx = Math.floor((py - annStartY) / (L.annotationRowH + L.annotationGap))
  if (annRowIdx >= rl.lanes[rowIndex]) return null

  const rowAnnotations = annTree.queryRange(rowStart, rowEnd)
  const { rows: stacked } = stackAnnotations(rowAnnotations, rowStart, rowEnd, L)
  if (annRowIdx >= stacked.length) return null

  for (const ann of stacked[annRowIdx]) {
    // Skip ORFs and auto-generated primers
    if (ann.type.startsWith('ORF') || ann.id.startsWith('orf_') || ann.id.startsWith('primer_')) continue

    const visRange = annVisibleRange(ann, rowStart, rowEnd)
    if (!visRange) continue
    const [aStart, aEnd] = visRange
    const x1 = baseX(aStart, rowStart, L)
    const x2 = baseX(aEnd - 1, rowStart, L) + L.bpWidth

    // Check left edge (start of annotation visible on this row)
    if (aStart === ann.start && Math.abs(px - x1) <= TOLERANCE) {
      return { annotation: ann, edge: 'start' }
    }
    // Check right edge (end of annotation visible on this row)
    if (aEnd === ann.end && Math.abs(px - x2) <= TOLERANCE) {
      return { annotation: ann, edge: 'end' }
    }
  }
  return null
}

// --- Grouped enzyme sites (isoschizomer merging) ---

export interface GroupedCutSite {
  /** All individual cut sites in this group */
  sites: CutSite[]
  /** Start of the union recognition region */
  recognitionStart: number
  /** End of the union recognition region (exclusive) */
  recognitionEnd: number
  /** Display label */
  label: string
  /** Primary cut position (fwdCut of first site) */
  fwdCut: number
  /** Methylation effect on this group: 'blocked', 'impaired', or null */
  methEffect: 'blocked' | 'impaired' | null
}

/**
 * Stable identity for a grouped cut site, for hover tracking.
 *
 * Grouped sites are rebuilt on each scan, so object identity is useless here —
 * the delayed-hover hook needs a key that survives that and still distinguishes
 * two different enzymes cutting at nearby positions.
 */
export function enzymeGroupKey(group: GroupedCutSite): string {
  return `${group.label}@${group.recognitionStart}`
}

/** Group cut sites at the same position into combined entries. */
let _groupedCache: { input: CutSite[]; dam: boolean; dcm: boolean; result: GroupedCutSite[] } | null = null
export function groupCutSites(sites: CutSite[], damMethylated = false, dcmMethylated = false): GroupedCutSite[] {
  if (_groupedCache && _groupedCache.input === sites && _groupedCache.dam === damMethylated && _groupedCache.dcm === dcmMethylated) return _groupedCache.result
  const result = _groupCutSitesImpl(sites, damMethylated, dcmMethylated)
  _groupedCache = { input: sites, dam: damMethylated, dcm: dcmMethylated, result }
  return result
}

function _groupCutSitesImpl(sites: CutSite[], damMethylated: boolean, dcmMethylated: boolean): GroupedCutSite[] {
  if (sites.length === 0) return []
  const groups: GroupedCutSite[] = []
  let i = 0
  while (i < sites.length) {
    const current = sites[i]
    const bucket: CutSite[] = [current]
    let recStart = current.position
    let recEnd = current.position + current.enzyme.recognition.length
    // Collect sites at the same position
    let j = i + 1
    while (j < sites.length && sites[j].position === current.position) {
      bucket.push(sites[j])
      const end = sites[j].position + sites[j].enzyme.recognition.length
      if (end > recEnd) recEnd = end
      j++
    }
    // Build label
    let label: string
    if (bucket.length === 1) {
      label = bucket[0].enzyme.name
    } else if (bucket.length === 2) {
      label = bucket[0].enzyme.name + ' / ' + bucket[1].enzyme.name
    } else {
      label = bucket[0].enzyme.name + ' +' + (bucket.length - 1)
    }
    // Worst methylation effect across all enzymes in the group
    let methEffect: 'blocked' | 'impaired' | null = null
    if (damMethylated || dcmMethylated) {
      for (const site of bucket) {
        const eff = methylationEffect(site.enzyme, damMethylated, dcmMethylated)
        if (eff === 'blocked') { methEffect = 'blocked'; break }
        if (eff === 'impaired') methEffect = 'impaired'
      }
    }
    groups.push({
      sites: bucket,
      recognitionStart: recStart,
      recognitionEnd: recEnd,
      label,
      fwdCut: current.fwdCut,
      methEffect,
    })
    i = j
  }
  return groups
}

/** Compare two grouped sites by position (reference-independent). */
function sameGroup(a: GroupedCutSite | null, b: GroupedCutSite | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.recognitionStart === b.recognitionStart && a.label === b.label
}

function lowerBoundGroups(groups: GroupedCutSite[], minPos: number): number {
  let lo = 0, hi = groups.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (groups[mid].recognitionStart < minPos) lo = mid + 1
    else hi = mid
  }
  return lo
}

// --- Label tier assignment ---

interface TieredLabel {
  group: GroupedCutSite
  /** X position of the label (left edge) */
  x: number
  /** Pixel width of the label text */
  width: number
  /** Tier index (0 = closest to ruler, higher = further above) */
  tier: number
}

const ENZYME_LABEL_FONT = '10px sans-serif'
const ENZYME_LABEL_PAD = 6 // horizontal padding between labels

/** Measure text width using a shared offscreen canvas. */
let _measureCtx: CanvasRenderingContext2D | null = null
function measureLabelWidth(text: string): number {
  if (!_measureCtx) {
    const c = document.createElement('canvas')
    _measureCtx = c.getContext('2d')!
  }
  _measureCtx.font = ENZYME_LABEL_FONT
  return _measureCtx.measureText(text).width
}

/**
 * Assign enzyme labels to tiers so they don't overlap horizontally.
 * Labels are placed at the cut site x-position, stacked into the lowest
 * available tier. Capped at maxTiers.
 */
function assignEnzymeTiers(
  groups: GroupedCutSite[],
  rowStart: number,
  rowEnd: number,
  L: ZoomLayout,
): TieredLabel[] {
  const labels: TieredLabel[] = []
  if (L.maxEnzymeTiers === 0) return labels

  // Track the right edge of the last label placed in each tier
  const tierRightEdge: number[] = new Array(L.maxEnzymeTiers).fill(-Infinity)

  for (const group of groups) {
    // Position label at the cut site x
    const cutPos = group.fwdCut
    if (cutPos < rowStart || cutPos >= rowEnd) continue
    const labelX = baseX(cutPos, rowStart, L)
    const labelW = measureLabelWidth(group.label)

    // Find lowest tier where this label fits
    let tier = 0
    for (let t = 0; t < L.maxEnzymeTiers; t++) {
      if (labelX >= tierRightEdge[t]) {
        tier = t
        break
      }
      if (t === L.maxEnzymeTiers - 1) {
        tier = t // force into top tier
      }
    }

    tierRightEdge[tier] = labelX + labelW + ENZYME_LABEL_PAD
    labels.push({ group, x: labelX, width: labelW, tier })
  }
  return labels
}

// --- Hit-test for enzyme labels (tier area above ruler) ---

function hitTestEnzymeLabel(
  px: number,
  py: number,
  seqLen: number,
  groupedSites: GroupedCutSite[],
  L: ZoomLayout,
  rl: RowLayoutMap,
): GroupedCutSite | null {
  if (seqLen === 0 || groupedSites.length === 0 || L.maxEnzymeTiers === 0) return null
  const rowIndex = rl.rowAtY(py)
  const totalRows = Math.ceil(seqLen / L.basesPerRow)
  if (rowIndex < 0 || rowIndex >= totalRows) return null
  const rowStart = rowIndex * L.basesPerRow
  const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
  const rowY = rl.rowY(rowIndex)

  // Enzyme label area is at the top of the row
  const labelAreaTop = rowY
  const labelAreaBottom = rowY + L.enzymeLabelAreaH
  if (py < labelAreaTop || py > labelAreaBottom) return null

  // Determine which tier was clicked
  // Tiers are drawn bottom-up: tier 0 is at the bottom of the label area
  const tierFromBottom = Math.floor((labelAreaBottom - py) / L.enzymeLabelTierH)

  const labels = assignEnzymeTiers(groupedSites, rowStart, rowEnd, L)
  for (const lbl of labels) {
    if (lbl.tier !== tierFromBottom) continue
    if (px >= lbl.x && px <= lbl.x + lbl.width) return lbl.group
  }
  return null
}

// --- Hit-test for enzyme recognition site highlight on sequence ---

function hitTestEnzymeHighlight(
  px: number,
  py: number,
  seqLen: number,
  groupedSites: GroupedCutSite[],
  L: ZoomLayout,
  rl: RowLayoutMap,
): GroupedCutSite | null {
  if (seqLen === 0 || groupedSites.length === 0) return null
  const rowIndex = rl.rowAtY(py)
  const totalRows = Math.ceil(seqLen / L.basesPerRow)
  if (rowIndex < 0 || rowIndex >= totalRows) return null
  const rowStart = rowIndex * L.basesPerRow
  const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
  const rowY = rl.rowY(rowIndex)

  // Sequence area starts after enzyme label area + ruler
  const seqTop = rowY + L.enzymeLabelAreaH + L.rulerHeight
  const seqBottom = seqTop + L.seqLineHeight
  if (py < seqTop || py > seqBottom) return null

  const searchStart = lowerBoundGroups(groupedSites, rowStart - 20)
  for (let i = searchStart; i < groupedSites.length; i++) {
    const group = groupedSites[i]
    if (group.recognitionStart >= rowEnd) break
    if (group.recognitionEnd <= rowStart) continue
    const aStart = Math.max(group.recognitionStart, rowStart)
    const aEnd = Math.min(group.recognitionEnd, rowEnd)
    const x1 = baseX(aStart, rowStart, L)
    const x2 = baseX(aEnd - 1, rowStart, L) + L.bpWidth
    if (px >= x1 && px <= x2) return group
  }
  return null
}

function hitTest(
  px: number,
  py: number,
  seqLen: number,
  scrollTop: number,
  L: ZoomLayout,
  rl: RowLayoutMap,
): number | null {
  if (seqLen === 0) return null
  const rowIndex = rl.rowAtY(py + scrollTop)
  const totalRows = Math.ceil(seqLen / L.basesPerRow)
  if (rowIndex < 0) return 0
  if (rowIndex >= totalRows) return seqLen
  const rowStart = rowIndex * L.basesPerRow
  const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
  if (px < L.leftMargin) return rowStart
  // For large rows (zoomed out), use binary-ish approach via bpWidth
  if (L.bpWidth < 1) {
    const col = Math.round((px - L.leftMargin) / L.bpWidth)
    return Math.min(rowStart + Math.max(0, col), rowEnd)
  }
  let bestIdx = rowEnd
  let bestDist = Infinity
  for (let i = rowStart; i < rowEnd; i++) {
    const x = baseX(i, rowStart, L)
    const center = x + L.bpWidth / 2
    const dist = Math.abs(px - center)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  const bx = baseX(bestIdx, rowStart, L)
  if (px > bx + L.bpWidth / 2 && bestIdx < rowEnd) {
    return bestIdx + 1
  }
  return bestIdx
}

/**
 * Detect if a pixel position is near the start or end edge of a selection.
 * Returns 'start', 'end', or null. Uses a tolerance in pixels.
 */
function hitTestSelectionEdge(
  px: number,
  py: number,
  seqLen: number,
  scrollTop: number,
  selStart: number,
  selEnd: number,
  L: ZoomLayout,
  rl: RowLayoutMap,
): 'start' | 'end' | null {
  if (seqLen === 0 || selStart === selEnd) return null
  const TOLERANCE = Math.max(4, L.bpWidth / 2)

  // Check start edge
  const startRow = Math.floor(selStart / L.basesPerRow)
  const startRowStart = startRow * L.basesPerRow
  const startX = baseX(selStart, startRowStart, L)
  const startY = rl.rowY(startRow) - scrollTop + L.enzymeLabelAreaH + L.rulerHeight
  if (Math.abs(px - startX) <= TOLERANCE && py >= startY && py <= startY + L.seqLineHeight) {
    return 'start'
  }

  // Check end edge
  const endRow = Math.floor((selEnd - 1) / L.basesPerRow)
  const endRowStart = endRow * L.basesPerRow
  const endX = baseX(selEnd - 1, endRowStart, L) + L.bpWidth
  const endY = rl.rowY(endRow) - scrollTop + L.enzymeLabelAreaH + L.rulerHeight
  if (Math.abs(px - endX) <= TOLERANCE && py >= endY && py <= endY + L.seqLineHeight) {
    return 'end'
  }

  return null
}

import { COMPLEMENT, reverseComplement as reverseComplementStr } from '../models/complement'

import { translateCodon, translate as translateSequenceStr } from '../utils/codon'

// EnzymeTooltipPopup alias for backward compat within this file
const EnzymeTooltipPopup = EnzymeTooltip

interface SequenceViewProps {
  onFindRequest?: () => void
  onAnnotateRequest?: () => void
  onEditFeature?: (annId: string) => void
  onCopyFeedback?: (msg: string) => void
}

function SequenceView({ onFindRequest, onAnnotateRequest, onEditFeature, onCopyFeedback }: SequenceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<ZoomLayout>(getLayout(14, 800))
  const rowLayoutRef = useRef<RowLayoutMap>(new RowLayoutMap(0))
  const rowLayoutCacheRef = useRef<{ key: string; tree: IntervalTree; map: RowLayoutMap; layoutKey: string } | null>(null)
  const stackCacheRef = useRef<{ key: string; tree: IntervalTree; stacks: Map<number, { rows: Annotation[][]; overflow: number }> } | null>(null)
  const canvasTopRef = useRef(0)
  const isDragging = useRef(false)
  // 'start' or 'end' when dragging a selection edge, null for normal drag
  const edgeDrag = useRef<'start' | 'end' | null>(null)
  // Fixed anchor position for the current drag (the end that doesn't move)
  const dragAnchor = useRef<number>(0)
  // Annotation edge drag state
  const annEdgeDrag = useRef<{
    annId: string
    edge: 'start' | 'end'
    originalStart: number
    originalEnd: number
    currentPos: number
  } | null>(null)

  // State subscriptions - trigger re-renders for JSX and feed refs for canvas callbacks
  const doc = useEditorStore(s => s.doc)
  const colorScheme = useEditorStore(s => s.colorScheme)
  const colorTarget = useEditorStore(s => s.colorTarget)
  const showComplement = useEditorStore(s => s.showComplement)
  const showAnnotationTracks = useEditorStore(s => s.showAnnotationTracks)
  const selection = useEditorStore(s => s.selection)
  const search = useEditorStore(s => s.search)
  const zoomLevel = useEditorStore(s => s.zoomLevel)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const showPrimers = useEditorStore(s => s.showPrimers)
  const allEnzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const allPrimerResults = useEditorStore(s => s.primerResults)
  const enzymeCutSites = showEnzymes ? allEnzymeCutSites : []
  const orfResults = showOrfs ? allOrfResults : []
  const primerResults = showPrimers ? allPrimerResults : []
  const selectedPrimerIndices = useEditorStore(s => s.selectedPrimerIndices)

  // Actions used in JSX event handlers (context menu)
  const setSelection = useEditorStore(s => s.setSelection)
  const removeAnnotation = useEditorStore(s => s.removeAnnotation)

  const [hoveredEnzymeGroup, setHoveredEnzymeGroup] = useState<GroupedCutSite | null>(null)
  // Enzyme popover: same delay as the feature popover, so the two behave
  // identically on the same canvas.
  const { target: enzymeTooltip, show: showEnzymeTooltip, hide: hideEnzymeTooltip } =
    useDelayedHover<HoverTarget & { group: GroupedCutSite }>()
  // Feature popover: delayed on appear, immediate on leave. See useDelayedHover.
  const { target: annTooltip, show: showAnnTooltip, hide: hideAnnTooltip } = useDelayedHover<HoverTarget>()

  // Context menu
  interface ContextMenuState {
    x: number
    y: number
    seqPos: number
    annId: string | null  // annotation under cursor, if any
    enzymeGroup: GroupedCutSite | null  // enzyme group under cursor, if any
  }
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ annId: string; annName: string } | null>(null)
  const [largeDeleteConfirm, setLargeDeleteConfirm] = useState<{ action: () => void; count: number } | null>(null)

  const [caretVisible, setCaretVisible] = useState(true)
  const caretBlinkRef = useRef<number>(0)
  const drawRef = useRef<(() => void) | null>(null)

  // Minimap state
  const [minimapCollapsed, setMinimapCollapsed] = useState(false)
  const [minimapScroll, setMinimapScroll] = useState({ scrollFrac: 0, viewFrac: 1 })
  const minimapScrollRef = useRef({ scrollFrac: 0, viewFrac: 1 })

  // Convert ORF results to Annotation objects for unified rendering
  const orfAnnotations = useMemo(() => {
    return orfResults.map((orf, i) => {
      const strandLabel = orf.strand === 1 ? '+' : '−'
      const data: AnnotationData = {
        id: `_orf_${i}`,
        name: `ORF ${strandLabel}${orf.frame + 1} (${orf.codons} aa)`,
        type: 'CDS',
        start: orf.start,
        end: orf.end,
        strand: orf.strand,
        color: orfColor(orf.strand, orf.frame),
      }
      return new Annotation(data)
    })
  }, [orfResults])

  // Convert selected primer pairs to Annotation objects for rendering
  const primerAnnotations = useMemo(() => {
    if (selectedPrimerIndices.size === 0) return []
    const anns: Annotation[] = []
    for (const idx of selectedPrimerIndices) {
      const pair = primerResults[idx]
      if (!pair) continue
      const suffix = selectedPrimerIndices.size > 1 ? ` #${idx + 1}` : ''
      anns.push(new Annotation({
        id: `_primer_fwd_${idx}`,
        name: `FWD${suffix} ${pair.forward.tm.toFixed(1)}°C`,
        type: 'primer_bind',
        start: pair.forward.start,
        end: pair.forward.end,
        strand: 1,
        color: '#3b82f6',
      }))
      anns.push(new Annotation({
        id: `_primer_rev_${idx}`,
        name: `REV${suffix} ${pair.reverse.tm.toFixed(1)}°C`,
        type: 'primer_bind',
        start: pair.reverse.start,
        end: pair.reverse.end,
        strand: -1,
        color: '#ef4444',
      }))
      if (pair.probe) {
        anns.push(new Annotation({
          id: `_primer_probe_${idx}`,
          name: `PRB${suffix} ${pair.probe.tm.toFixed(1)}°C`,
          type: 'primer_bind',
          start: pair.probe.start,
          end: pair.probe.end,
          strand: pair.probe.strand,
          color: '#f59e0b',
        }))
      }
    }
    return anns
  }, [primerResults, selectedPrimerIndices])

  // Filter out hidden annotations
  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])
  const visibleAnnotations = useMemo(() =>
    hiddenSet.size === 0 ? doc.annotations : doc.annotations.filter(a => !hiddenSet.has(a.id)),
    [doc.annotations, hiddenSet]
  )

  const annTree = useMemo(() => {
    const tree = new IntervalTree()
    for (const ann of visibleAnnotations) {
      tree.insert(ann)
    }
    for (const ann of orfAnnotations) {
      tree.insert(ann)
    }
    for (const ann of primerAnnotations) {
      tree.insert(ann)
    }
    return tree
  }, [visibleAnnotations, orfAnnotations, primerAnnotations])

  // Combined list for hit-testing (visible annotations + ORFs + primers)
  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...primerAnnotations]
    if (extra.length === 0) return visibleAnnotations
    return [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, primerAnnotations])

  // --- Refs mirroring frequently-changing state ---
  // Allows draw() and event handlers to stay referentially stable
  // while always reading current values at call time.
  const docRef = useRef(doc)
  const selectionRef = useRef(selection)
  const searchRef = useRef(search)
  const caretVisibleRef = useRef(caretVisible)
  const annTreeRef = useRef(annTree)
  const zoomLevelRef = useRef(zoomLevel)
  const hoveredAnnotationIdRef = useRef(hoveredAnnotationId)
  const enzymeCutSitesRef = useRef(enzymeCutSites)
  const hoveredEnzymeGroupRef = useRef(hoveredEnzymeGroup)
  const showEnzymesRef = useRef(showEnzymes)
  const colorSchemeRef = useRef(colorScheme)
  const colorTargetRef = useRef(colorTarget)
  const showComplementRef = useRef(showComplement)
  const showAnnotationTracksRef = useRef(showAnnotationTracks)
  const allAnnotationsRef = useRef(allAnnotations)
  const onFindRequestRef = useRef(onFindRequest)

  // Sync refs on every render (cheap assignments, no effects needed)
  docRef.current = doc
  selectionRef.current = selection
  searchRef.current = search
  caretVisibleRef.current = caretVisible
  annTreeRef.current = annTree
  zoomLevelRef.current = zoomLevel
  hoveredAnnotationIdRef.current = hoveredAnnotationId
  enzymeCutSitesRef.current = enzymeCutSites
  hoveredEnzymeGroupRef.current = hoveredEnzymeGroup
  showEnzymesRef.current = showEnzymes
  colorSchemeRef.current = colorScheme
  colorTargetRef.current = colorTarget
  showComplementRef.current = showComplement
  showAnnotationTracksRef.current = showAnnotationTracks
  allAnnotationsRef.current = allAnnotations
  onFindRequestRef.current = onFindRequest

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const showEnzymesNow = showEnzymesRef.current && enzymeCutSitesRef.current.length > 0
    const L = getLayout(zoomLevelRef.current, width, showEnzymesNow, docRef.current.sequence.length, {
      showComplement: showComplementRef.current,
      showAnnotations: showAnnotationTracksRef.current,
    })
    layoutRef.current = L

    // Read current state from refs (not closure) so draw stays stable
    const doc = docRef.current
    const selection = selectionRef.current
    const search = searchRef.current
    const caretVisible = caretVisibleRef.current
    const annTree = annTreeRef.current
    const hoveredAnnotationId = hoveredAnnotationIdRef.current
    const enzymeCutSites = enzymeCutSitesRef.current
    const hoveredEnzymeGroup = hoveredEnzymeGroupRef.current

    // Group cut sites for rendering (isoschizomer merging)
    const damMeth = doc.metadata?.damMethylated || false
    const dcmMeth = doc.metadata?.dcmMethylated || false
    const groupedSites = groupCutSites(enzymeCutSites, damMeth, dcmMeth)

    const seq = doc.sequence
    const seqLen = seq.length
    const topology = seq.topology
    const totalRows = Math.max(1, Math.ceil(seqLen / L.basesPerRow))

    // Build per-row annotation lane counts for adaptive row heights.
    // Uses an O(annotations) sweep instead of O(totalRows) stacking scan:
    // for each annotation, increment a counter on the rows it spans.
    // The counter is clamped to maxAnnotationRows for the lane estimate.
    const rlCacheKey = `${L.basesPerRow}_${seqLen}`
    const rlLayoutKey = `${rlCacheKey}_${L.annotationRowH}_${L.annotationGap}_${L.maxAnnotationRows}_${L.rulerHeight}_${L.seqLineHeight}_${L.enzymeLabelAreaH}_${L.translationRowH}_${L.translationGap}_${L.maxTranslationRows}_${L.rowPaddingBottom}`
    let rl: RowLayoutMap
    if (rowLayoutCacheRef.current
        && rowLayoutCacheRef.current.key === rlCacheKey
        && rowLayoutCacheRef.current.tree === annTree) {
      rl = rowLayoutCacheRef.current.map
      // Only rebuild offsets if layout constants changed
      if (rowLayoutCacheRef.current.layoutKey !== rlLayoutKey) {
        rl.build(L)
        rowLayoutCacheRef.current.layoutKey = rlLayoutKey
      }
    } else {
      rl = new RowLayoutMap(totalRows)
      // Sweep: count overlapping annotations per row using a difference array.
      // For each annotation, mark +1 at its first row and -1 after its last row.
      // A prefix sum then gives the overlap count per row. O(annotations + totalRows).
      const bpr = L.basesPerRow
      const diff = new Int16Array(totalRows + 1)
      const allAnns = annTree.all()
      for (const ann of allAnns) {
        if (ann.spansOrigin()) {
          // [start, seqLen) ∪ [0, end)
          const r1a = Math.floor(ann.start / bpr)
          diff[r1a]++
          // no -1 needed at seqLen since it's the end of the array
          const r2b = Math.min(Math.ceil(ann.end / bpr), totalRows)
          diff[0]++
          diff[r2b]--
        } else {
          const r1 = Math.floor(ann.start / bpr)
          const r2 = Math.min(Math.ceil(ann.end / bpr), totalRows)
          diff[r1]++
          diff[r2]--
        }
      }
      // Prefix sum → overlap count per row → clamped lane count
      let count = 0
      const maxLanes = L.maxAnnotationRows
      for (let r = 0; r < totalRows; r++) {
        count += diff[r]
        rl.lanes[r] = Math.min(count, maxLanes) as number
      }
      rl.build(L)
      rowLayoutCacheRef.current = { key: rlCacheKey, tree: annTree, map: rl, layoutKey: rlLayoutKey }
      // Clear stacking cache — will be computed lazily for visible rows
      stackCacheRef.current = { key: rlCacheKey, tree: annTree, stacks: new Map() }
    }
    rowLayoutRef.current = rl

    const totalHeight = rl.totalHeight + 4

    // Virtual scrolling: use a spacer for scroll height, canvas covers viewport
    const scrollTop = container.scrollTop
    const viewHeight = container.clientHeight

    // Set spacer to full height for scrollbar
    if (spacerRef.current) spacerRef.current.style.height = `${totalHeight}px`

    // Canvas covers only the visible area + buffer.
    // Clamp so the canvas never extends past totalHeight (which would
    // create extra scrollable area and allow infinite scrolling).
    const bufferH = L.rowHeight * 4
    const canvasTop = Math.max(0, scrollTop - bufferH / 2)
    const canvasH = Math.min(totalHeight - canvasTop, viewHeight + bufferH)

    canvas.width = width * dpr
    canvas.height = canvasH * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${canvasH}px`
    canvas.style.top = `${canvasTop}px`
    canvasTopRef.current = canvasTop

    // Update minimap scroll fractions
    if (seqLen >= MINIMAP_SEQ_THRESHOLD) {
      const sf = Math.max(0, Math.min(1, scrollTop / Math.max(1, totalHeight)))
      const vf = Math.max(0, Math.min(1, viewHeight / Math.max(1, totalHeight)))
      const prev = minimapScrollRef.current
      if (Math.abs(prev.scrollFrac - sf) > 0.0001 || Math.abs(prev.viewFrac - vf) > 0.0001) {
        minimapScrollRef.current = { scrollFrac: sf, viewFrac: vf }
        setMinimapScroll({ scrollFrac: sf, viewFrac: vf })
      }
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const COLORS = getCanvasColors(container)
    // Resolved once per draw rather than per base: a full screen of letters is
    // thousands of lookups, and the palette depends only on the scheme and the
    // theme foreground, neither of which changes mid-frame.
    const basePalette = buildBasePalette(colorSchemeRef.current, COLORS.text)
    // "None" has no colour to place anywhere, so background mode is moot.
    const paintBackground =
      colorTargetRef.current === 'background' && colorSchemeRef.current !== 'none'

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, width, canvasH)

    if (seqLen === 0) return

    const firstRow = Math.max(0, rl.rowAtY(canvasTop))
    const lastRow = Math.min(totalRows - 1, rl.rowAtY(canvasTop + canvasH))

    // Offset drawing: translate so row positions map to canvas coordinates
    ctx.save()
    ctx.translate(0, -canvasTop)

    const visibleStart = firstRow * L.basesPerRow
    const visibleEnd = Math.min((lastRow + 1) * L.basesPerRow, seqLen)
    const visibleBases = seq.basesIn(visibleStart, visibleEnd)

    const rowSepYs: number[] = []
    for (let rowIdx = firstRow; rowIdx <= lastRow; rowIdx++) {
      const rowStart = rowIdx * L.basesPerRow
      const rowEnd = Math.min(rowStart + L.basesPerRow, seqLen)
      const rowY = rl.rowY(rowIdx)
      let cy = rowY

      // --- Enzyme labels above ruler (SnapGene-style tiered labels) ---
      if (groupedSites.length > 0 && L.maxEnzymeTiers > 0) {
        const tieredLabels = assignEnzymeTiers(groupedSites, rowStart, rowEnd, L)
        const labelAreaBottom = rowY + L.enzymeLabelAreaH

        for (const lbl of tieredLabels) {
          const isHovered = sameGroup(hoveredEnzymeGroup, lbl.group)
          const methDim = lbl.group.methEffect
          if (methDim) ctx.globalAlpha = methDim === 'blocked' ? 0.25 : 0.5
          // Tier 0 is closest to ruler (bottom of label area)
          const tierY = labelAreaBottom - (lbl.tier + 1) * L.enzymeLabelTierH

          // Draw label text
          ctx.font = isHovered ? 'bold 10px sans-serif' : ENZYME_LABEL_FONT
          ctx.fillStyle = COLORS.enzyme
          ctx.textBaseline = 'top'
          ctx.textAlign = 'left'
          ctx.fillText(lbl.group.label, lbl.x, tierY + 1)

          // Leader line from label down to ruler line
          const cutX = baseX(lbl.group.fwdCut, rowStart, L)
          const rulerLineYAbs = labelAreaBottom + 14
          ctx.strokeStyle = isHovered ? COLORS.enzymeBgHover : COLORS.enzymeBg
          ctx.lineWidth = 1
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
          if (methDim) ctx.globalAlpha = 1
        }
      }

      cy += L.enzymeLabelAreaH

      // --- Ruler ---
      ctx.fillStyle = COLORS.ruler
      ctx.font = '11px monospace'
      ctx.textBaseline = 'top'
      ctx.textAlign = 'left'
      // Adaptive tick interval based on zoom
      const tickInterval = L.mode === 'letters' ? L.basesPerGroup
        : L.basesPerRow <= 500 ? 50
        : L.basesPerRow <= 2000 ? 100
        : L.basesPerRow <= 5000 ? 500
        : 1000
      const dispOrigin = (topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
      for (let i = rowStart; i < rowEnd; i += tickInterval) {
        const x = baseX(i, rowStart, L)
        // Only draw label if there's enough space
        if (L.bpWidth * tickInterval > 30 || i === rowStart) {
          ctx.fillText(displayPosition(i, dispOrigin, seqLen).toLocaleString(), x, cy)
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
          ctx.fillStyle = '#3b82f6' // blue
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
          ctx.fillStyle = '#f59e0b' // amber
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

      const forwardY = cy

      // --- Enzyme recognition site highlights (subtle tint on sequence) ---
      if (groupedSites.length > 0) {
        const searchStart = lowerBoundGroups(groupedSites, rowStart - 20)
        for (let gi = searchStart; gi < groupedSites.length; gi++) {
          const group = groupedSites[gi]
          if (group.recognitionStart >= rowEnd) break
          if (group.recognitionEnd <= rowStart) continue
          const aStart = Math.max(group.recognitionStart, rowStart)
          const aEnd = Math.min(group.recognitionEnd, rowEnd)
          const x1 = baseX(aStart, rowStart, L)
          const x2 = baseX(aEnd - 1, rowStart, L) + L.bpWidth

          const isHovered = sameGroup(hoveredEnzymeGroup, group)
          if (group.methEffect) ctx.globalAlpha = group.methEffect === 'blocked' ? 0.25 : 0.5
          ctx.fillStyle = isHovered ? COLORS.enzymeBgHover : COLORS.enzymeBg
          ctx.fillRect(x1, cy, x2 - x1, L.seqLineHeight)
          if (isHovered) {
            ctx.strokeStyle = COLORS.enzymeBgHover
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(x1, cy + L.seqLineHeight)
            ctx.lineTo(x2, cy + L.seqLineHeight)
            ctx.stroke()
          }
          if (group.methEffect) ctx.globalAlpha = 1
        }
      }

      // --- Selection highlight ---
      // Supports origin-spanning selections on circular sequences via selectionSegments
      {
        const segs = selectionSegments(selection, topology, seqLen)
        for (const [selStart, selEnd] of segs) {
          const hlStart = Math.max(selStart, rowStart)
          const hlEnd = Math.min(selEnd, rowEnd)
          if (hlStart < hlEnd) {
            const x1 = baseX(hlStart, rowStart, L)
            const x2 = baseX(hlEnd - 1, rowStart, L) + L.bpWidth
            ctx.fillStyle = COLORS.selectionBg
            ctx.fillRect(x1, cy, x2 - x1, L.seqLineHeight)

            // Draw drag handles at selection edges
            const handleW = Math.max(2, Math.min(3, L.bpWidth / 3))
            ctx.fillStyle = COLORS.caret
            ctx.globalAlpha = 0.7
            if (selStart >= rowStart && selStart < rowEnd) {
              const hx = baseX(selStart, rowStart, L)
              ctx.fillRect(hx - handleW / 2, cy, handleW, L.seqLineHeight)
            }
            if (selEnd > rowStart && selEnd <= rowEnd) {
              const hx = baseX(selEnd - 1, rowStart, L) + L.bpWidth
              ctx.fillRect(hx - handleW / 2, cy, handleW, L.seqLineHeight)
            }
            ctx.globalAlpha = 1
          }
        }
      }

      // --- Search match highlights ---
      if (search.matches.length > 0) {
        // Binary search for first match that could overlap this row
        let mi = 0
        {
          let lo = 0, hi = search.matches.length
          while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (search.matches[mid][1] <= rowStart) lo = mid + 1
            else hi = mid
          }
          mi = lo
        }
        for (; mi < search.matches.length; mi++) {
          const [mStart, mEnd] = search.matches[mi]
          if (mStart >= rowEnd) break
          const hlStart = Math.max(mStart, rowStart)
          const hlEnd = Math.min(mEnd, rowEnd)
          if (hlStart < hlEnd) {
            const x1 = baseX(hlStart, rowStart, L)
            const x2 = baseX(hlEnd - 1, rowStart, L) + L.bpWidth
            ctx.fillStyle = mi === search.currentMatch
              ? 'rgba(255, 165, 0, 0.45)'
              : 'rgba(255, 220, 50, 0.3)'
            ctx.fillRect(x1, cy, x2 - x1, L.seqLineHeight)
          }
        }
      }

      // --- Row position label ---
      ctx.fillStyle = COLORS.ruler
      ctx.font = '12px monospace'
      ctx.textAlign = 'right'
      ctx.fillText((rowStart + 1).toLocaleString(), L.leftMargin - 8, cy)
      ctx.textAlign = 'left'

      // --- Sequence rendering (mode-dependent) ---
      if (L.mode === 'letters') {
        const letterH = 16
        ctx.font = '14px monospace'
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
                // Unpalettised characters (N, gaps) get no block — a filled
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
            // Complement gets the same treatment as the forward strand —
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
      } else if (L.mode === 'dots') {
        // Colored dots/dashes per base — batched by color
        const dotY = cy + L.seqLineHeight / 2
        // Draw backbone line
        ctx.strokeStyle = '#333'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(L.leftMargin, dotY)
        ctx.lineTo(baseX(rowEnd - 1, rowStart, L) + L.bpWidth, dotY)
        ctx.stroke()
        // Batch dots by color: collect x positions per color, then draw
        const dotR = Math.max(1, Math.min(3, L.bpWidth * 0.4))
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
            ctx.moveTo(x + dotR, dotY)
            ctx.arc(x, dotY, dotR, 0, Math.PI * 2)
          }
          ctx.fill()
        }
        cy += L.seqLineHeight
      } else {
        // Line mode - thin black backbone
        const lineY = cy + L.seqLineHeight / 2
        ctx.strokeStyle = '#333'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(L.leftMargin, lineY)
        ctx.lineTo(baseX(rowEnd - 1, rowStart, L) + L.bpWidth, lineY)
        ctx.stroke()
        cy += L.seqLineHeight
      }

      // --- Caret ---
      if (caretVisible && selection.caret >= rowStart && selection.caret <= rowEnd) {
        const caretX = selection.caret < rowEnd
          ? baseX(selection.caret, rowStart, L)
          : baseX(rowEnd - 1, rowStart, L) + L.bpWidth
        ctx.strokeStyle = COLORS.caret
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(caretX, forwardY)
        ctx.lineTo(caretX, forwardY + L.seqLineHeight)
        ctx.stroke()
      }

      // --- Annotation bars (lazy stacking: compute on first visit, cache for reuse) ---
      let cached = stackCacheRef.current?.stacks.get(rowIdx)
      if (!cached) {
        const result = stackAnnotations(annTree.queryRange(rowStart, rowEnd), rowStart, rowEnd, L)
        cached = result
        stackCacheRef.current?.stacks.set(rowIdx, result)
      }
      const annRows = cached.rows
      // With the tracks hidden there are zero lanes, so everything lands in
      // overflow. Reporting "+N more" for a band the user deliberately closed
      // would be noise, and rowHeightForLanes reserves no gap in that case
      // either — so neither the label nor the leading gap applies.
      const tracksVisible = L.maxAnnotationRows > 0
      const annOverflow = tracksVisible ? cached.overflow : 0
      if (tracksVisible) cy += L.annotationGap

      // Batch annotation rendering: group by color to minimize state changes.
      // First pass: collect geometry. Second pass: fill then stroke by color.
      const annBatch: { ann: Annotation; x1: number; x2: number; cy: number; isStart: boolean; isEnd: boolean }[] = []
      let annCy = cy
      for (const annRow of annRows) {
        for (const ann of annRow) {
          const visRange = annVisibleRange(ann, rowStart, rowEnd)
          if (!visRange) continue
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
        const { ann, x1, x2, cy: ay, isStart, isEnd } = a
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
          if (!isStart && barW > cw * 2) {
            ctx.moveTo(x1, ay); ctx.lineTo(x1 + cw, midY); ctx.lineTo(x1, ay + h)
          } else {
            ctx.moveTo(x1, ay); ctx.lineTo(x1, ay + h)
          }
          if (isEnd && barW > arrowW * 2) {
            ctx.lineTo(x2 - arrowW, ay + h); ctx.lineTo(x2, midY); ctx.lineTo(x2 - arrowW, ay)
          } else if (!isEnd && barW > cw * 2) {
            ctx.lineTo(x2 - cw, ay + h); ctx.lineTo(x2, midY); ctx.lineTo(x2 - cw, ay)
          } else {
            ctx.lineTo(x2, ay + h); ctx.lineTo(x2, ay)
          }
        } else if (ann.strand === -1) {
          if (isStart && barW > arrowW * 2) {
            ctx.moveTo(x1 + arrowW, ay); ctx.lineTo(x1, midY); ctx.lineTo(x1 + arrowW, ay + h)
          } else if (!isStart && barW > cw * 2) {
            ctx.moveTo(x1 + cw, ay); ctx.lineTo(x1, midY); ctx.lineTo(x1 + cw, ay + h)
          } else {
            ctx.moveTo(x1, ay); ctx.lineTo(x1, ay + h)
          }
          if (!isEnd && barW > cw * 2) {
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
      // Group by color for fewer state changes
      const colorGroups = new Map<string, typeof annBatch>()
      for (const a of annBatch) {
        const c = a.ann.color
        if (!colorGroups.has(c)) colorGroups.set(c, [])
        colorGroups.get(c)!.push(a)
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

      // Draw hovered annotation on top
      for (const a of annBatch) {
        if (a.ann.id !== hoveredAnnotationId) continue
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

      // Labels — only for bars wide enough
      ctx.fillStyle = COLORS.text
      ctx.font = '11px sans-serif'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (const a of annBatch) {
        const barW = a.x2 - a.x1
        if (barW <= 20) continue
        const h = L.annotationRowH
        const arrowW = Math.min(6, barW / 3)
        const cw = Math.min(5, barW / 4)
        let clipLeft = a.x1
        let clipRight = a.x2
        if (a.ann.strand === 1) {
          if (!a.isStart) clipLeft += cw
          if (a.isEnd) clipRight -= arrowW
          else clipRight -= cw
        } else if (a.ann.strand === -1) {
          if (a.isStart) clipLeft += arrowW
          else clipLeft += cw
          if (!a.isEnd) clipRight -= cw
        }
        const availW = clipRight - clipLeft
        const textW = ctx.measureText(a.ann.name).width
        if (textW <= availW) {
          // Text fits — no clipping needed (fast path)
          ctx.fillText(a.ann.name, (clipLeft + clipRight) / 2, a.cy + h / 2)
        } else if (availW > 12) {
          // Text overflows — clip (slow path, only when necessary)
          ctx.save()
          ctx.beginPath()
          ctx.rect(clipLeft, a.cy, availW, h)
          ctx.clip()
          ctx.fillText(a.ann.name, (clipLeft + clipRight) / 2, a.cy + h / 2)
          ctx.restore()
        }
      }
      ctx.textAlign = 'left'

      // Annotation edge drag preview - dashed outline at new boundary
      if (annEdgeDrag.current) {
        for (const a of annBatch) {
          if (annEdgeDrag.current.annId !== a.ann.id) continue
          const drag = annEdgeDrag.current
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
        ctx.font = '500 9px sans-serif'
        const px = L.leftMargin + 4
        const py = cy - L.annotationGap - 2
        ctx.globalAlpha = 0.6
        ctx.fillStyle = COLORS.text
        ctx.fillText(label, px, py)
        ctx.globalAlpha = 1
      }

      // --- Amino acid translation (letters mode only) ---
      if (L.mode === 'letters') {
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
          let key = `${ann.strand}:`
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
          if (translationCount >= L.maxTranslationRows) break
          const data = cdsVisData.get(ann)!
          const { aStart, aEnd, seqForTranslation } = data

          // Draw alternating codon backgrounds spanning the 3 nucleotide columns
          for (let pos = aStart; pos < aEnd; pos++) {
            const fOffset = fullAnnOffset(ann, pos)
            if (fOffset % 3 !== 0) continue
            const lOffset = localOffset(ann, pos, data)
            if (lOffset < 0 || lOffset + 3 > seqForTranslation.length) continue
            const codonIdx = Math.floor(fOffset / 3)
            if (codonIdx % 2 !== 0) continue
            const firstBase = ann.strand === 1 ? pos : pos - 2
            const lastBase = ann.strand === 1 ? pos + 2 : pos
            const clampedFirst = Math.max(firstBase, rowStart)
            const clampedLast = Math.min(lastBase, rowEnd - 1)
            if (clampedFirst > clampedLast) continue
            const x1 = baseX(clampedFirst, rowStart, L)
            const x2 = baseX(clampedLast, rowStart, L) + L.bpWidth
            ctx.fillStyle = COLORS.selectionBg
            ctx.fillRect(x1, cy, x2 - x1, L.translationRowH)
          }

          // Draw AA letters
          ctx.font = '10px monospace'
          ctx.textBaseline = 'middle'
          ctx.textAlign = 'center'
          const aaHalfBp = L.bpWidth / 2
          for (let pos = aStart; pos < aEnd; pos++) {
            const fOffset = fullAnnOffset(ann, pos)
            if (fOffset % 3 !== 0) continue
            const lOffset = localOffset(ann, pos, data)
            if (lOffset < 0 || lOffset + 3 > seqForTranslation.length) continue
            const codon = seqForTranslation.slice(lOffset, lOffset + 3)
            const aa = translateCodon(codon)
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
            ctx.fillStyle = aa === '*' ? '#c0392b' : COLORS.text
            ctx.fillText(aa, x, cy + L.translationRowH / 2)
          }
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          cy += L.translationRowH + L.translationGap
          translationCount++
        }
      }

      // --- Enzyme cut-site dashed lines (drawn after all row content) ---
      if (groupedSites.length > 0) {
        const searchStart = lowerBoundGroups(groupedSites, rowStart - 20)
        const lineTop = rowY + L.enzymeLabelAreaH + L.rulerHeight
        const lineBottom = rowY + rl.rowH(rowIdx) - L.rowPaddingBottom
        ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        // Normal lines (no methylation effect)
        ctx.strokeStyle = COLORS.enzymeBg
        ctx.beginPath()
        let hasNormal = false
        let hasHovered = false
        let hasMethDimmed = false
        for (let gi = searchStart; gi < groupedSites.length; gi++) {
          const group = groupedSites[gi]
          if (group.recognitionStart >= rowEnd) break
          if (group.fwdCut < rowStart || group.fwdCut >= rowEnd) continue
          if (sameGroup(hoveredEnzymeGroup, group)) { hasHovered = true; continue }
          if (group.methEffect) { hasMethDimmed = true; continue }
          hasNormal = true
          const cutX = baseX(group.fwdCut, rowStart, L)
          ctx.moveTo(cutX, lineTop)
          ctx.lineTo(cutX, lineBottom)
        }
        if (hasNormal) ctx.stroke()
        // Methylation-dimmed lines
        if (hasMethDimmed) {
          ctx.strokeStyle = COLORS.enzymeBg
          for (let gi = searchStart; gi < groupedSites.length; gi++) {
            const group = groupedSites[gi]
            if (group.recognitionStart >= rowEnd) break
            if (group.fwdCut < rowStart || group.fwdCut >= rowEnd) continue
            if (sameGroup(hoveredEnzymeGroup, group) || !group.methEffect) continue
            ctx.globalAlpha = group.methEffect === 'blocked' ? 0.25 : 0.5
            ctx.beginPath()
            const cutX = baseX(group.fwdCut, rowStart, L)
            ctx.moveTo(cutX, lineTop)
            ctx.lineTo(cutX, lineBottom)
            ctx.stroke()
          }
          ctx.globalAlpha = 1
        }
        // Hovered lines
        if (hasHovered) {
          ctx.strokeStyle = COLORS.enzymeBgHover
          ctx.beginPath()
          for (let gi = searchStart; gi < groupedSites.length; gi++) {
            const group = groupedSites[gi]
            if (group.recognitionStart >= rowEnd) break
            if (group.fwdCut < rowStart || group.fwdCut >= rowEnd) continue
            if (!sameGroup(hoveredEnzymeGroup, group)) continue
            const cutX = baseX(group.fwdCut, rowStart, L)
            ctx.moveTo(cutX, lineTop)
            ctx.lineTo(cutX, lineBottom)
          }
          ctx.stroke()
        }
        ctx.setLineDash([])
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

    // --- Selection tooltip (length, position, Tm) ---
    // Shows whenever any part of the selection is visible on screen.
    // Positions at the caret row if visible, otherwise at the nearest visible edge.
    {
      const selSegs = selectionSegments(selection, topology, seqLen)
      const selLen = selectionLength(selection, topology, seqLen)
      const isOriginSel = isOriginSpanningSelection(selection, topology)
    if (selLen > 0) {
      // Determine the row range covered by the selection
      const selStart = isOriginSel ? 0 : Math.min(selection.anchor, selection.caret)
      const selEnd = isOriginSel ? seqLen : Math.max(selection.anchor, selection.caret)
      const selFirstRow = Math.floor(selStart / L.basesPerRow)
      const selLastRow = Math.min(Math.floor((selEnd - 1) / L.basesPerRow), totalRows - 1)

      // Check if any part of the selection is visible in the actual viewport
      const vpFirstRow = Math.max(0, rl.rowAtY(scrollTop))
      const vpLastRow = Math.min(totalRows - 1, rl.rowAtY(scrollTop + viewHeight))
      const selVisible = selLastRow >= vpFirstRow && selFirstRow <= vpLastRow

      if (selVisible) {
        // Pick the anchor row for the tooltip:
        // prefer caret row, fall back to nearest visible selection edge
        const caretRow = Math.floor(selection.caret / L.basesPerRow)
        let tipRow: number
        if (caretRow >= vpFirstRow && caretRow <= vpLastRow) {
          tipRow = caretRow
        } else if (caretRow < vpFirstRow) {
          tipRow = Math.max(selFirstRow, vpFirstRow)
        } else {
          tipRow = Math.min(selLastRow, vpLastRow)
        }

        const tipRowStart = tipRow * L.basesPerRow
        const tipRowEnd = Math.min(tipRowStart + L.basesPerRow, seqLen)
        let tipX: number
        if (tipRow === caretRow) {
          const caretInRow = Math.min(Math.max(selection.caret, tipRowStart), tipRowEnd)
          tipX = caretInRow < tipRowEnd
            ? baseX(caretInRow, tipRowStart, L)
            : baseX(tipRowEnd - 1, tipRowStart, L) + L.bpWidth
        } else {
          // Anchor at the center of the row
          tipX = L.leftMargin + (tipRowEnd - tipRowStart) * L.bpWidth / 2
        }

        // Build tooltip lines
        const lines: string[] = []
        const dispO = (topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
        const dpSel = (p: number) => displayPosition(p, dispO, seqLen)
        if (isOriginSel) {
          lines.push(`${dpSel(selection.anchor)}..${dpSel(selection.caret - 1)}  (${selLen} bp)`)
        } else {
          const s = Math.min(selection.anchor, selection.caret)
          const e = Math.max(selection.anchor, selection.caret)
          lines.push(`${dpSel(s)}..${dpSel(e - 1)}  (${selLen} bp)`)
        }
        if (selLen >= 4 && selLen <= 200) {
          let selBases = ''
          for (const [ss, se] of selSegs) selBases += seq.basesIn(ss, se)
          selBases = selBases.toUpperCase()
          let tm: number
          if (selLen <= 14) {
            let at = 0, gc = 0
            for (let i = 0; i < selBases.length; i++) {
              const ch = selBases[i]
              if (ch === 'A' || ch === 'T') at++
              else if (ch === 'G' || ch === 'C') gc++
            }
            tm = 2 * at + 4 * gc
          } else {
            tm = calcTm(selBases)
          }
          if (!isNaN(tm)) {
            lines.push(`Tm ≈ ${tm.toFixed(1)} °C`)
          }
        }

        ctx.font = 'bold 11px sans-serif'
        const lineHeight = 14
        const padX = 6
        const padY = 4
        const textWidths = lines.map(l => ctx.measureText(l).width)
        const boxW = Math.max(...textWidths) + padX * 2
        const boxH = lines.length * lineHeight + padY * 2
        // Clamp tooltip Y to the actual viewport (not the canvas buffer)
        const vpTop = scrollTop
        const vpBottom = scrollTop + viewHeight
        const tipYAbove = rl.rowY(tipRow) + L.rulerHeight - 2
        const boxYAbove = tipYAbove - boxH - 2
        let boxY: number
        if (boxYAbove >= vpTop) {
          boxY = boxYAbove
        } else {
          // Try below the row
          const below = rl.rowY(tipRow) + rl.rowH(tipRow) + 4
          if (below + boxH <= vpBottom) {
            boxY = below
          } else {
            // Pin to top of viewport
            boxY = vpTop + 4
          }
        }
        const boxX = Math.max(2, Math.min(tipX - boxW / 2, width - boxW - 2))

        ctx.fillStyle = '#1a1a1a'
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.roundRect(boxX, boxY, boxW, boxH, 4)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#ffffff'
        ctx.textBaseline = 'middle'
        ctx.textAlign = 'center'
        const cx = boxX + boxW / 2
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], cx, boxY + padY + i * lineHeight + lineHeight / 2)
        }
        ctx.textAlign = 'left'
      }
    }
    }

    ctx.restore() // end virtual scroll translate
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep drawRef in sync so drag handlers can trigger redraws
  drawRef.current = draw

  // --- Mouse event handlers ---
  const handleMouseDown = useCallback((e: MouseEvent) => {
    // Right-click: preserve existing selection for context menu
    if (e.button === 2) return

    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top

    // Close any open context menu on left click
    setCtxMenu(null)

    const sel = useEditorStore.getState().selection
    const seqLen = docRef.current.sequence.length

    // Check if clicking near a selection edge to resize
    const selRange = selectionRange(sel)
    if (selRange && !e.shiftKey) {
      const edge = hitTestSelectionEdge(px, py, seqLen, canvasTopRef.current, selRange[0], selRange[1], layoutRef.current, rowLayoutRef.current)
      if (edge) {
        isDragging.current = true
        edgeDrag.current = edge
        // The fixed end is the opposite edge from the one being dragged
        dragAnchor.current = edge === 'start' ? selRange[1] : selRange[0]
        return
      }
    }

    // Check enzyme label click (above ruler only) - select recognition site
    const groupedSitesNow = groupCutSites(enzymeCutSitesRef.current)
    const hitLabel = hitTestEnzymeLabel(px, py + canvasTopRef.current, seqLen, groupedSitesNow, layoutRef.current, rowLayoutRef.current)
    if (hitLabel) {
      useEditorStore.getState().setSelection({ anchor: hitLabel.recognitionStart, caret: hitLabel.recognitionEnd })
      return
    }

    // Check annotation edge drag (resize) - only when the annotation is selected
    if (!useEditorStore.getState().readOnly) {
      const annEdge = hitTestAnnotationEdge(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
      if (annEdge) {
        const sel = useEditorStore.getState().selection
        const selStart = Math.min(sel.anchor, sel.caret)
        const selEnd = Math.max(sel.anchor, sel.caret)
        const isSelected = selStart === annEdge.annotation.start && selEnd === annEdge.annotation.end
        if (!isSelected) {
          // Not selected – treat as a normal annotation click (select it)
          useEditorStore.getState().setSelection({ anchor: annEdge.annotation.start, caret: annEdge.annotation.end })
          return
        }
        isDragging.current = true
        annEdgeDrag.current = {
          annId: annEdge.annotation.id,
          edge: annEdge.edge,
          originalStart: annEdge.annotation.start,
          originalEnd: annEdge.annotation.end,
          currentPos: annEdge.edge === 'start' ? annEdge.annotation.start : annEdge.annotation.end,
        }
        return
      }
    }

    const hitAnn = hitTestAnnotation(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
    if (hitAnn) {
      useEditorStore.getState().setSelection({ anchor: hitAnn.start, caret: hitAnn.end })
      return
    }
    const seqPos = hitTest(px, py, seqLen, canvasTopRef.current, layoutRef.current, rowLayoutRef.current)
    if (seqPos === null) return
    isDragging.current = true
    edgeDrag.current = null
    if (e.shiftKey) {
      dragAnchor.current = sel.anchor
      useEditorStore.getState().setSelection({ anchor: sel.anchor, caret: seqPos })
    } else {
      dragAnchor.current = seqPos
      useEditorStore.getState().setCaret(seqPos)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drag handler - attached to window so dragging outside the canvas still works
  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const seqLen = docRef.current.sequence.length
    const seqPos = hitTest(px, py, seqLen, canvasTopRef.current, layoutRef.current, rowLayoutRef.current)
    if (seqPos === null) return

    // Annotation edge drag - update preview position
    if (annEdgeDrag.current) {
      const drag = annEdgeDrag.current
      // Enforce minimum 1bp annotation
      if (drag.edge === 'start') {
        const maxStart = drag.originalEnd > 0 ? drag.originalEnd - 1 : seqLen - 1
        drag.currentPos = Math.min(seqPos, maxStart)
      } else {
        const minEnd = drag.originalStart + 1
        drag.currentPos = Math.max(seqPos, minEnd)
      }
      // Trigger redraw to show preview
      drawRef.current?.()
      return
    }

    // Use the stable drag anchor stored on mousedown, not the store's
    // anchor which may have been normalized on a previous frame.
    const anchor = dragAnchor.current
    // Always keep anchor <= caret to avoid triggering origin-spanning
    const lo = Math.min(anchor, seqPos)
    const hi = Math.max(anchor, seqPos)
    useEditorStore.getState().setSelection({ anchor: lo, caret: hi })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hover handler - attached to canvas only so it doesn't interfere with other views
  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const seqLen = docRef.current.sequence.length

    // Check selection edge hover for resize cursor
    const sel = useEditorStore.getState().selection
    const selR = selectionRange(sel)
    if (selR) {
      const edge = hitTestSelectionEdge(px, py, seqLen, canvasTopRef.current, selR[0], selR[1], layoutRef.current, rowLayoutRef.current)
      if (edge) {
        canvas.style.cursor = 'col-resize'
        // Clear other hovers
        if (hoveredEnzymeGroupRef.current) { setHoveredEnzymeGroup(null); hideEnzymeTooltip() }
        if (useEditorStore.getState().hoveredAnnotationId) useEditorStore.getState().setHoveredAnnotation(null)
        hideAnnTooltip()
        return
      }
    }

    // Check enzyme label/highlight hover (labels above ruler, highlights on sequence)
    const groupedSitesNow = groupCutSites(enzymeCutSitesRef.current)
    const hitLabel = hitTestEnzymeLabel(px, py + canvasTopRef.current, seqLen, groupedSitesNow, layoutRef.current, rowLayoutRef.current)
    const hitHighlight = !hitLabel ? hitTestEnzymeHighlight(px, py + canvasTopRef.current, seqLen, groupedSitesNow, layoutRef.current, rowLayoutRef.current) : null
    const hitEnzyme = hitLabel || hitHighlight
    if (hitEnzyme) {
      setHoveredEnzymeGroup(hitEnzyme)
      showEnzymeTooltip({ x: e.clientX, y: e.clientY, key: enzymeGroupKey(hitEnzyme), group: hitEnzyme })
      hideAnnTooltip()
      canvas.style.cursor = 'pointer'
      // Clear annotation hover
      if (useEditorStore.getState().hoveredAnnotationId) {
        useEditorStore.getState().setHoveredAnnotation(null)
      }
      return
    }

    // Clear enzyme hover
    if (hoveredEnzymeGroupRef.current) {
      setHoveredEnzymeGroup(null)
      hideEnzymeTooltip()
    }

    // Check annotation edge hover for resize cursor (only when annotation is selected)
    if (!useEditorStore.getState().readOnly) {
      const annEdge = hitTestAnnotationEdge(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
      if (annEdge) {
        const sel = useEditorStore.getState().selection
        const selStart = Math.min(sel.anchor, sel.caret)
        const selEnd = Math.max(sel.anchor, sel.caret)
        if (selStart === annEdge.annotation.start && selEnd === annEdge.annotation.end) {
          canvas.style.cursor = 'col-resize'
          useEditorStore.getState().setHoveredAnnotation(annEdge.annotation.id)
          hideAnnTooltip()
          return
        }
      }
    }

    const hitAnn = hitTestAnnotation(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
    const currentHover = useEditorStore.getState().hoveredAnnotationId
    const newId = hitAnn?.id ?? null
    if (newId !== currentHover) {
      useEditorStore.getState().setHoveredAnnotation(newId)
    }
    if (hitAnn) {
      showAnnTooltip({ x: e.clientX + 12, y: e.clientY - 10, key: hitAnn.id })
    } else {
      hideAnnTooltip()
    }
    canvas.style.cursor = hitAnn ? 'pointer' : 'text'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleMouseUp = useCallback(() => {
    // Commit annotation edge drag
    if (annEdgeDrag.current) {
      const drag = annEdgeDrag.current
      const newStart = drag.edge === 'start' ? drag.currentPos : drag.originalStart
      const newEnd = drag.edge === 'end' ? drag.currentPos : drag.originalEnd
      // Only commit if something changed
      if (newStart !== drag.originalStart || newEnd !== drag.originalEnd) {
        // Push undo snapshot before the change
        const store = useEditorStore.getState()
        // Use the store's internal undo mechanism via a wrapper
        store.updateAnnotation(drag.annId, { start: newStart, end: newEnd })
      }
      annEdgeDrag.current = null
    }
    isDragging.current = false
    edgeDrag.current = null
    setDragEnded(v => v + 1)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (useEditorStore.getState().hoveredAnnotationId) {
      useEditorStore.getState().setHoveredAnnotation(null)
    }
    setHoveredEnzymeGroup(null)
    hideEnzymeTooltip()
    hideAnnTooltip()
  }, [hideAnnTooltip, hideEnzymeTooltip])

  // Double-click on annotation opens the edit annotation panel
  const handleDblClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const seqLen = docRef.current.sequence.length
    const hitAnn = hitTestAnnotation(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
    if (hitAnn) {
      useEditorStore.getState().setEditAnnotation(hitAnn.id)
      onEditFeature?.(hitAnn.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEditFeature])

  // --- Context menu ---
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const seqLen = docRef.current.sequence.length
    const seqPos = hitTest(px, py, seqLen, canvasTopRef.current, layoutRef.current, rowLayoutRef.current)
    if (seqPos === null) return
    const hitAnn = hitTestAnnotation(px, py + canvasTopRef.current, seqLen, annTreeRef.current, layoutRef.current, rowLayoutRef.current)
    const groupedSitesNow = groupCutSites(enzymeCutSitesRef.current)
    const hitLabel = hitTestEnzymeLabel(px, py + canvasTopRef.current, seqLen, groupedSitesNow, layoutRef.current, rowLayoutRef.current)
    const hitHighlight = !hitLabel ? hitTestEnzymeHighlight(px, py + canvasTopRef.current, seqLen, groupedSitesNow, layoutRef.current, rowLayoutRef.current) : null
    const hitEnzymeGroup = hitLabel || hitHighlight
    // Clear hover tooltips - the context menu will embed tooltip content
    hideAnnTooltip()
    hideEnzymeTooltip()

    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      seqPos,
      annId: hitAnn?.id ?? null,
      enzymeGroup: hitEnzymeGroup,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close context menu on outside click or scroll
  // (ContextMenuPopup stops mousedown/mouseup propagation, so any event
  // reaching the window is outside the menu)
  useEffect(() => {
    if (!ctxMenu) return
    let downOutside = false
    const handleDown = () => { downOutside = true }
    const handleUp = () => {
      if (downOutside) setCtxMenu(null)
      downOutside = false
    }
    const closeScroll = () => setCtxMenu(null)
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('scroll', closeScroll, true)
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('scroll', closeScroll, true)
    }
  }, [ctxMenu])

  // --- Keyboard handler ---
  const readOnly = useEditorStore(s => s.readOnly)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't capture keystrokes aimed at text inputs, textareas, or contenteditable
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

    const store = useEditorStore.getState()
    const curDoc = docRef.current
    const seqLen = curDoc.sequence.length
    const curTopology = curDoc.sequence.topology
    const sel = store.selection
    const range = selectionRange(sel)
    const segs = selectionSegments(sel, curTopology, seqLen)
    const ctrlOrMeta = e.ctrlKey || e.metaKey
    const ro = store.readOnly
    const roBlock = () => { store.notifyReadOnlyBlock() }

    /** Get selected bases, handling origin-spanning. */
    const getSelectedBases = () => {
      let text = ''
      for (const [s, e] of segs) text += curDoc.sequence.basesIn(s, e)
      return text
    }

    const isOriginSpan = isOriginSpanningSelection(sel, curTopology)
    const selLen = selectionLength(sel, curTopology, seqLen)
    const LARGE_DELETE_THRESHOLD = 1000

    /** Delete the current selection, handling origin-spanning. */
    const doDelete = () => {
      if (isOriginSpan && segs.length === 2) {
        const [tailStart, tailEnd] = segs[0]
        const [headStart, headEnd] = segs[1]
        store.deleteTwo(tailStart, tailEnd, headStart, headEnd)
        store.setCaret(0)
      } else if (range) {
        store.delete(range[0], range[1])
        store.setCaret(range[0])
      }
    }

    /** Delete with confirmation for large selections. */
    const deleteSelection = () => {
      if (selLen >= LARGE_DELETE_THRESHOLD) {
        setLargeDeleteConfirm({ action: doDelete, count: selLen })
      } else {
        doDelete()
      }
    }

    /** Replace the current selection with text, handling origin-spanning. */
    const replaceSelection = (text: string) => {
      if (isOriginSpan && segs.length === 2) {
        const [tailStart, tailEnd] = segs[0]
        const [headStart, headEnd] = segs[1]
        store.deleteTwo(tailStart, tailEnd, headStart, headEnd, text)
        store.setCaret(text.length)
      } else if (range) {
        store.replace(range[0], range[1], text)
        store.setCaret(range[0] + text.length)
      } else {
        store.insert(sel.caret, text)
        store.setCaret(sel.caret + text.length)
      }
    }

    if (ctrlOrMeta && e.key === 'z') {
      if (ro) { roBlock(); return }
      e.preventDefault()
      if (e.shiftKey) { store.redo() } else { store.undo() }
      return
    }
    if (ctrlOrMeta && e.key === 'y') {
      if (ro) { roBlock(); return }
      e.preventDefault()
      store.redo()
      return
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const isCirc = curTopology === 'circular'
      const newPos = sel.caret - 1 < 0 ? (isCirc ? seqLen : 0) : sel.caret - 1
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: newPos }) }
      else { store.setCaret(range ? range[0] : newPos) }
      return
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const isCirc = curTopology === 'circular'
      const newPos = sel.caret + 1 > seqLen ? (isCirc ? 0 : seqLen) : sel.caret + 1
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: newPos }) }
      else { store.setCaret(range ? range[1] : newPos) }
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const bpr = layoutRef.current.basesPerRow
      const isCirc = curTopology === 'circular'
      let newPos = sel.caret - bpr
      if (newPos < 0) newPos = isCirc ? ((newPos % seqLen) + seqLen) % seqLen : 0
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: newPos }) }
      else { store.setCaret(newPos) }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const bpr = layoutRef.current.basesPerRow
      const isCirc = curTopology === 'circular'
      let newPos = sel.caret + bpr
      if (newPos > seqLen) newPos = isCirc ? newPos % seqLen : seqLen
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: newPos }) }
      else { store.setCaret(newPos) }
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: 0 }) }
      else { store.setCaret(0) }
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      if (e.shiftKey) { store.setSelection({ anchor: sel.anchor, caret: seqLen }) }
      else { store.setCaret(seqLen) }
      return
    }
    if (ctrlOrMeta && e.key === 'a') {
      e.preventDefault()
      store.setSelection({ anchor: 0, caret: seqLen })
      return
    }
    if (ctrlOrMeta && e.key === 'f') {
      e.preventDefault()
      onFindRequestRef.current?.()
      return
    }
    if (e.key === 'Escape') {
      if (store.search.query) {
        e.preventDefault()
        store.clearSearch()
        return
      }
    }
    if (ctrlOrMeta && e.key === 'c') {
      if (segs.length > 0) {
        e.preventDefault()
        const bases = getSelectedBases()
        navigator.clipboard.writeText(bases).then(() => onCopyFeedback?.(`Copied ${bases.length} bp`)).catch(e => console.warn('Clipboard write failed:', e))
      }
      return
    }
    if (ctrlOrMeta && e.key === 'x') {
      if (segs.length > 0) {
        e.preventDefault()
        const bases = getSelectedBases()
        navigator.clipboard.writeText(bases).then(() => onCopyFeedback?.(`Cut ${bases.length} bp`)).catch(e => console.warn('Clipboard write failed:', e))
        if (!ro) deleteSelection()
      }
      return
    }
    if (ctrlOrMeta && e.key === 'v') {
      if (ro) { roBlock(); e.preventDefault(); return }
      // Let the native paste event fire — handled by handlePaste listener
      return
    }
    if (e.key === 'Backspace') {
      if (ro) { roBlock(); return }
      e.preventDefault()
      if (segs.length > 0) {
        deleteSelection()
      } else if (sel.caret > 0) {
        store.delete(sel.caret - 1, sel.caret)
        store.setCaret(sel.caret - 1)
      }
      return
    }
    if (e.key === 'Delete') {
      if (ro) { roBlock(); return }
      e.preventDefault()
      if (segs.length > 0) {
        deleteSelection()
      } else if (sel.caret < seqLen) {
        store.delete(sel.caret, sel.caret + 1)
      }
      return
    }
    if (e.key.length === 1 && !ctrlOrMeta) {
      if (ro) { roBlock(); return }
      const validBases = /^[ATGCUatgcuRYSWKMBVDHNryswkmbvdhn]$/
      if (validBases.test(e.key)) {
        e.preventDefault()
        replaceSelection(e.key.toUpperCase())
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

    const store = useEditorStore.getState()
    if (store.readOnly) return

    const text = e.clipboardData?.getData('text') ?? ''
    const filtered = text.replace(/[^ATGCUatgcuRYSWKMBVDHNryswkmbvdhn]/g, '').toUpperCase()
    if (filtered.length === 0) return

    e.preventDefault()

    const curDoc = docRef.current
    const seqLen = curDoc.sequence.length
    const sel = store.selection
    const range = selectionRange(sel)
    const segs = selectionSegments(sel, curDoc.sequence.topology, seqLen)
    const isOriginSpan = isOriginSpanningSelection(sel, curDoc.sequence.topology)

    if (isOriginSpan && segs.length === 2) {
      const [tailStart, tailEnd] = segs[0]
      const [headStart, headEnd] = segs[1]
      store.deleteTwo(tailStart, tailEnd, headStart, headEnd, filtered)
      store.setCaret(filtered.length)
    } else if (range) {
      store.replace(range[0], range[1], filtered)
      store.setCaret(range[0] + filtered.length)
    } else {
      store.insert(sel.caret, filtered)
      store.setCaret(sel.caret + filtered.length)
    }
  }, [])

  // Scroll to keep the selection anchor visible
  useEffect(() => {
    // Don't auto-scroll while the user is dragging a selection handle
    if (isDragging.current) return
    const container = containerRef.current
    if (!container) return
    const selStart = Math.min(selection.anchor, selection.caret)
    const row = Math.floor(selStart / layoutRef.current.basesPerRow)
    const rl = rowLayoutRef.current
    const rowTop = rl.rowY(row)
    const rowBottom = rowTop + rl.rowH(row)
    const viewTop = container.scrollTop
    const viewBottom = viewTop + container.clientHeight
    const store = useEditorStore.getState()
    const useSmooth = store.smoothScrollRequested
    if (useSmooth) store.smoothScrollRequested = false
    if (rowTop < viewTop) {
      if (useSmooth) {
        container.scrollTo({ top: rowTop, behavior: 'smooth' })
      } else {
        container.scrollTop = rowTop
      }
    } else if (rowBottom > viewBottom) {
      const target = rowBottom - container.clientHeight
      if (useSmooth) {
        container.scrollTo({ top: target, behavior: 'smooth' })
      } else {
        container.scrollTop = target
      }
    }
  }, [selection])

  // Caret blink timer – reset when caret position changes or drag ends
  const caretPos = selection.caret
  const [dragEnded, setDragEnded] = useState(0)
  useEffect(() => {
    setCaretVisible(true)
    clearInterval(caretBlinkRef.current)
    caretBlinkRef.current = window.setInterval(() => {
      setCaretVisible(v => !v)
    }, 530)
    return () => clearInterval(caretBlinkRef.current)
  }, [caretPos, dragEnded])

  // Minimap: scroll to a base position
  const handleMinimapScrollToBase = useCallback((base: number) => {
    const container = containerRef.current
    if (!container) return
    const rl = rowLayoutRef.current
    const L = layoutRef.current
    const row = Math.floor(base / L.basesPerRow)
    const targetY = rl.rowY(row)
    container.scrollTop = targetY
  }, [])

  // Ctrl+wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -1 : 1
      useEditorStore.getState().setZoom(useEditorStore.getState().zoomLevel + delta)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attach event listeners once (all callbacks are stable via refs)
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    let scrollRaf = 0
    const onScroll = () => {
      if (scrollRaf) return
      scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; draw() })
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: false })

    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('dblclick', handleDblClick)
    canvas.addEventListener('mousemove', handleCanvasMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('paste', handlePaste)

    const ro = new ResizeObserver(() => draw())
    ro.observe(container)

    return () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf)
      container.removeEventListener('scroll', onScroll)
      container.removeEventListener('wheel', handleWheel)
      canvas.removeEventListener('mousedown', handleMouseDown)
      canvas.removeEventListener('dblclick', handleDblClick)
      canvas.removeEventListener('mousemove', handleCanvasMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('paste', handlePaste)
      ro.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Preserve scroll position across zoom changes
  const prevZoomRef = useRef(zoomLevel)
  useEffect(() => {
    const container = containerRef.current
    if (!container || prevZoomRef.current === zoomLevel) {
      prevZoomRef.current = zoomLevel
      return
    }
    const oldRl = rowLayoutRef.current
    const oldScrollTop = container.scrollTop
    // Which base was at the top of the viewport?
    const topRow = oldRl.totalRows > 0 ? oldRl.rowAtY(oldScrollTop) : 0
    const topBase = topRow * layoutRef.current.basesPerRow

    prevZoomRef.current = zoomLevel
    // Set scroll after draw updates the spacer height and RowLayoutMap
    requestAnimationFrame(() => {
      const newRl = rowLayoutRef.current
      const newL = layoutRef.current
      const newRow = Math.floor(topBase / newL.basesPerRow)
      container.scrollTop = newRl.rowY(newRow)
    })
  }, [zoomLevel, showEnzymes, enzymeCutSites])

  // Redraw when any render-affecting state changes
  useEffect(() => {
    draw()
  }, [doc, selection, search, caretVisible, annTree, zoomLevel, hoveredAnnotationId, enzymeCutSites, hoveredEnzymeGroup, showEnzymes, draw])

  const showMinimap = doc.sequence.length >= MINIMAP_SEQ_THRESHOLD

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {showMinimap && (
        <MinimapBar
          onScrollToBase={handleMinimapScrollToBase}
          scrollFraction={minimapScroll.scrollFrac}
          viewportFraction={minimapScroll.viewFrac}
          annTree={annTree}
          collapsed={minimapCollapsed}
          onToggleCollapse={() => setMinimapCollapsed(c => !c)}
        />
      )}
    <div
      ref={containerRef}
      className="sequence-view-container"
      style={{
        width: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        position: 'relative',
      }}
    >
      <div ref={spacerRef} style={{ width: '100%', pointerEvents: 'none' }} />
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'text', position: 'absolute', top: 0, left: 0, willChange: 'transform' }}
      />
      {/* Hover tooltips - hidden when context menu is open */}
      {!ctxMenu && enzymeTooltip && (
        <EnzymeTooltipPopup
          x={enzymeTooltip.x + 12}
          y={enzymeTooltip.y - 10}
          group={enzymeTooltip.group}
        />
      )}
      {!ctxMenu && annTooltip && (() => {
        const ann = allAnnotations.find(a => a.id === annTooltip.key)
        if (!ann) return null
        return (
          <AnnotationTooltip
            ann={ann}
            sequence={doc.sequence}
            x={annTooltip.x}
            y={annTooltip.y}
          />
        )
      })()}

      {/* Context menu with embedded tooltip */}
      {ctxMenu && (() => {
        const ctxSegs = selectionSegments(selection, doc.sequence.topology, doc.sequence.length)
        const hasSelection = ctxSegs.length > 0
        const ctxAnn = ctxMenu.annId
          ? allAnnotations.find(a => a.id === ctxMenu.annId) ?? null
          : null
        const isUserAnn = ctxAnn && !ctxAnn.id.startsWith('_orf_') && !ctxAnn.id.startsWith('_primer_')

        const ctxEnzymeGroup = ctxMenu.enzymeGroup

        const getCtxSelectedBases = () => {
          let text = ''
          for (const [s, e] of ctxSegs) text += doc.sequence.basesIn(s, e)
          return text
        }

        const handleCopy = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          navigator.clipboard.writeText(bases).then(() => onCopyFeedback?.(`Copied ${bases.length} bp`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyRevComp = () => {
          if (!hasSelection) return
          const text = reverseComplementStr(getCtxSelectedBases())
          navigator.clipboard.writeText(text).then(() => onCopyFeedback?.(`Copied reverse complement (${text.length} bp)`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handlePasteRevComp = () => {
          navigator.clipboard.readText().then(text => {
            const filtered = text.replace(/[^ATGCUatgcuRYSWKMBVDHNryswkmbvdhn]/g, '').toUpperCase()
            if (filtered.length === 0) return
            const rc = reverseComplementStr(filtered)
            const s = useEditorStore.getState()
            const currentSel = s.selection
            const currentRange = selectionRange(currentSel)
            if (currentRange) {
              s.replace(currentRange[0], currentRange[1], rc)
              s.setCaret(currentRange[0] + rc.length)
            } else {
              s.insert(currentSel.caret, rc)
              s.setCaret(currentSel.caret + rc.length)
            }
          }).catch(e => console.warn('Clipboard read failed:', e))
          setCtxMenu(null)
        }
        const handleCopyProtein = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          const protein = translateSequenceStr(bases)
          navigator.clipboard.writeText(protein).then(() => onCopyFeedback?.(`Copied protein (${protein.length} aa)`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleAddAnnotation = () => {
          // If no selection, select the clicked position so the modal pre-fills it
          const selR = selectionRange(selection)
          if (!selR) {
            const pos = ctxMenu.seqPos
            setSelection({ anchor: pos, caret: Math.min(pos + 1, doc.sequence.length) })
          }
          setCtxMenu(null)
          onAnnotateRequest?.()
        }
        const handleSelectAnnotation = () => {
          if (!ctxAnn) return
          setSelection({ anchor: ctxAnn.start, caret: ctxAnn.end })
          setCtxMenu(null)
        }
        const handleEditAnnotation = () => {
          if (!ctxAnn) return
          useEditorStore.getState().setEditAnnotation(ctxAnn.id)
          onEditFeature?.(ctxAnn.id)
          setCtxMenu(null)
        }
        const handleDeleteAnnotation = () => {
          if (!ctxAnn) return
          setDeleteConfirm({ annId: ctxAnn.id, annName: ctxAnn.name })
          setCtxMenu(null)
        }
        const handleCopyAnnotationBases = () => {
          if (!ctxAnn) return
          const bases = annotationBases(ctxAnn, doc.sequence)
          navigator.clipboard.writeText(bases).then(() => onCopyFeedback?.(`Copied ${bases.length} bp from "${ctxAnn!.name}"`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyAnnotationProtein = () => {
          if (!ctxAnn) return
          const protein = annotationProtein(ctxAnn, doc.sequence)
          navigator.clipboard.writeText(protein).then(() => onCopyFeedback?.(`Copied ${protein.length} aa from "${ctxAnn!.name}"`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyRecognition = () => {
          if (!ctxEnzymeGroup) return
          const primary = ctxEnzymeGroup.sites[0]
          navigator.clipboard.writeText(primary.enzyme.recognition).then(() => onCopyFeedback?.(`Copied ${primary.enzyme.recognition}`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleSelectRecognition = () => {
          if (!ctxEnzymeGroup) return
          setSelection({ anchor: ctxEnzymeGroup.recognitionStart, caret: ctxEnzymeGroup.recognitionEnd })
          setCtxMenu(null)
        }
        const handleLookupEnzyme = () => {
          if (!ctxEnzymeGroup) return
          const primary = ctxEnzymeGroup.sites[0]
          window.open(`https://www.google.com/search?q=${encodeURIComponent(primary.enzyme.name + ' restriction enzyme')}`, '_blank')
          setCtxMenu(null)
        }

        return (
          <ContextMenuPopup x={ctxMenu.x} y={ctxMenu.y}>
            {/* Embedded tooltip content */}
            {ctxAnn && (
              <div className="ctx-menu-tooltip-embed">
                <AnnotationTooltipContent ann={ctxAnn} sequence={doc.sequence} />
              </div>
            )}
            {ctxEnzymeGroup && (
              <div className="ctx-menu-tooltip-embed ctx-menu-tooltip-enzyme">
                <EnzymeGroupTooltipContent group={ctxEnzymeGroup} />
              </div>
            )}

            {/* Annotation actions */}
            {ctxAnn && (
              <>
                <button className="ctx-menu-item" onClick={handleSelectAnnotation}>
                  Select Annotation
                </button>
                <button className="ctx-menu-item" onClick={handleCopyAnnotationBases}>
                  Copy Annotation Bases
                </button>
                {/* Shown on exactly the features whose translation the popover
                    above is already displaying. */}
                {canTranslateAnnotation(ctxAnn, doc.sequence) && (
                  <button className="ctx-menu-item" onClick={handleCopyAnnotationProtein}>
                    Copy Amino Acid Sequence
                  </button>
                )}
                {isUserAnn && !readOnly && (
                  <button className="ctx-menu-item" onClick={handleEditAnnotation}>
                    Edit Annotation
                  </button>
                )}
                {isUserAnn && !readOnly && (
                  <button className="ctx-menu-item ctx-menu-danger" onClick={handleDeleteAnnotation}>
                    Delete Annotation
                  </button>
                )}
                <div className="ctx-menu-sep" />
              </>
            )}

            {/* Enzyme actions */}
            {ctxEnzymeGroup && (
              <>
                <button className="ctx-menu-item" onClick={handleCopyRecognition}>
                  Copy Recognition Sequence
                </button>
                <button className="ctx-menu-item" onClick={handleSelectRecognition}>
                  Select Recognition Site
                </button>
                <button className="ctx-menu-item" onClick={handleLookupEnzyme}>
                  Look Up Enzyme…
                </button>
                <div className="ctx-menu-sep" />
              </>
            )}

            {/* Selection actions */}
            {hasSelection && (
              <>
                <button className="ctx-menu-item" onClick={handleCopy}>
                  Copy Selection
                </button>
                <button className="ctx-menu-item" onClick={handleCopyRevComp}>
                  Copy Reverse Complement
                </button>
                <button className="ctx-menu-item" onClick={handleCopyProtein}>
                  Copy Protein Translation
                </button>
                <div className="ctx-menu-sep" />
              </>
            )}
            {!readOnly && (
              <>
                <button className="ctx-menu-item" onClick={handlePasteRevComp}>
                  Paste Reverse Complement
                </button>
                <button className="ctx-menu-item" onClick={handleAddAnnotation}>
                  {hasSelection ? 'Add Annotation to Selection' : 'Add Annotation Here'}
                </button>
              </>
            )}
            {doc.sequence.topology === 'circular' && !hasSelection && (
              <>
                <div className="ctx-menu-sep" />
                <button className="ctx-menu-item" onClick={() => {
                  useEditorStore.getState().setDisplayOrigin(ctxMenu.seqPos)
                  setCtxMenu(null)
                }}>
                  Set Display Origin Here
                </button>
                <button className="ctx-menu-item" onClick={() => {
                  useEditorStore.getState().rotateOrigin(ctxMenu.seqPos)
                  setCtxMenu(null)
                }}>
                  Set as Position 1
                </button>
              </>
            )}
          </ContextMenuPopup>
        )
      })()}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete Annotation"
        message={`Delete "${deleteConfirm?.annName}"? You can undo with Ctrl+Z.`}
        buttons={[
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ]}
        onResult={(v) => {
          if (v === 'delete' && deleteConfirm) {
            removeAnnotation(deleteConfirm.annId)
          }
          setDeleteConfirm(null)
        }}
      />
      <ConfirmDialog
        open={largeDeleteConfirm !== null}
        title="Delete Selection"
        message={`Delete ${largeDeleteConfirm?.count.toLocaleString()} bp? You can undo with Ctrl+Z.`}
        buttons={[
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ]}
        onResult={(v) => {
          if (v === 'delete' && largeDeleteConfirm) {
            largeDeleteConfirm.action()
          }
          setLargeDeleteConfirm(null)
        }}
      />
    </div>
    </div>
  )
}

/**
 * Memoised: App re-renders on any of its many state hooks, and re-rendering a
 * canvas view means re-running its layout memos and draw effects for nothing.
 * Every prop above is a stable useCallback in App, so this bails out cleanly;
 * the component still re-renders on its own store subscriptions.
 */
export default memo(SequenceView)
