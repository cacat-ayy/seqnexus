/**
 * Circular plasmid map view.
 *
 * Renders a classic circular diagram with:
 * - Backbone circle with bp tick marks
 * - Annotation arcs with directional arrows
 * - Annotation labels
 * - Selection highlight arc
 * - Center text (name + size)
 */

import { useRef, useEffect, useCallback, useMemo, useState, memo } from 'react'
import { formatBp } from '../utils/format'
import { visibleStroke, contrastText } from '../utils/color'
import { translate as translateSequenceStr } from '../utils/codon'
import { useEditorStore, selectionRange, isOriginSpanningSelection, selectionLength, selectionSegments } from '../store'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { displayPosition } from '../models/Document'

import { orfColor } from '../workers/orf-finder'
import {
  proposalsFrom, proposalAnnotations, isAutoAnnotationId, keyFromAutoId,
} from '../utils/auto-annotations'
import { orfIdFor, orfName, keyFromOrfId } from '../utils/orf-features'
import { reverseComplement as reverseComplementStr } from '../models/complement'
import AnnotationTooltip, { AnnotationTooltipContent } from './AnnotationTooltip'
import { annotationBases, annotationProtein, canTranslateAnnotation } from '../utils/annotation-sequence'
import { useDelayedHover, type HoverTarget } from '../hooks/useDelayedHover'
import EnzymeTooltip, { EnzymeGroupTooltipContent } from './EnzymeTooltip'
import { groupCutSites, enzymeGroupKey, type GroupedCutSite } from './SequenceView'
import ContextMenuPopup from './ContextMenuPopup'
import ConfirmDialog from './ConfirmDialog'

/** Hit-test annotation arcs. Returns the annotation under (px, py) or null. */
function hitTestAnnotationArc(
  px: number,
  py: number,
  cx: number,
  cy: number,
  baseRadius: number,
  _annotations: Annotation[],
  rings: Annotation[][],
  seqLen: number,
): Annotation | null {
  if (seqLen === 0) return null
  const dx = px - cx
  const dy = py - cy
  const dist = Math.sqrt(dx * dx + dy * dy)

  // Compute angle in the same coordinate system as posToAngle
  let angle = Math.atan2(dy, dx)

  for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
    const radius = baseRadius + 14 + ringIdx * (ANNOTATION_ARC_WIDTH + ANNOTATION_GAP)
    const halfWidth = ANNOTATION_ARC_WIDTH / 2 + 3 // small tolerance
    if (dist < radius - halfWidth || dist > radius + halfWidth) continue

    for (const ann of rings[ringIdx]) {
      const startAngle = posToAngle(ann.start, seqLen)
      const span = annArcSpan(ann.start, ann.end, seqLen)

      // Check if the click angle falls within [startAngle, startAngle + span]
      const norm = (v: number) => ((v % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      const offset = norm(angle - startAngle)
      if (offset <= span) return ann
    }
  }
  return null
}

function getPlasmidColors(container: HTMLElement) {
  const s = getComputedStyle(container)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--canvas-bg', '#ffffff'),
    backbone: v('--canvas-backbone', '#555555'),
    text: v('--canvas-text', '#333333'),
    textMuted: v('--canvas-ruler', '#888888'),
    tickMinor: v('--canvas-ruler-tick', '#cccccc'),
    accent: v('--accent', '#3b82f6'),
    selectionArc: v('--selection-bg', 'rgba(59, 130, 246, 0.3)'),
    enzyme: v('--canvas-enzyme', '#e53e3e'),
  }
}

const BACKBONE_WIDTH = 3
const MAX_TICKS = 500 // cap total ticks for performance

/** Compute adaptive tick intervals so we never exceed MAX_TICKS. */
function getTickIntervals(seqLen: number): { major: number; minor: number } {
  if (seqLen <= 5_000) return { major: 500, minor: 100 }
  if (seqLen <= 50_000) return { major: 5_000, minor: 1_000 }
  if (seqLen <= 500_000) return { major: 50_000, minor: 10_000 }
  // Genome scale: ensure < MAX_TICKS ticks
  const minor = Math.ceil(seqLen / MAX_TICKS / 1000) * 1000
  return { major: minor * 5, minor }
}
/**
 * Assign enzyme labels to radial tiers so they don't overlap.
 * Tier 0 is closest to the backbone, higher tiers are further inward.
 */
function assignEnzymeLabelTiers(
  groups: GroupedCutSite[],
  seqLen: number,
  baseRadius: number,
  ctx: CanvasRenderingContext2D,
): { group: GroupedCutSite; angle: number; tier: number }[] {
  if (groups.length === 0 || seqLen === 0) return []

  const LABEL_FONT = '9px sans-serif'
  const TIER_SPACING = 16
  const BASE_LABEL_R = baseRadius - 22
  const MIN_GAP = 6 // minimum pixel gap between labels

  ctx.font = LABEL_FONT

  // Normalize angles to [0, 2π) for consistent wrap-around handling
  const TWO_PI = Math.PI * 2
  const normalize = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI

  // Compute angular span each label occupies at its radius
  const items = groups.map(group => {
    const rawAngle = posToAngle(group.fwdCut, seqLen)
    const angle = normalize(rawAngle)
    const textWidth = ctx.measureText(group.label).width + MIN_GAP
    return { group, angle, textWidth, tier: 0 }
  })

  // Sort by angle for sweep
  items.sort((a, b) => a.angle - b.angle)

  // Check if two angular ranges overlap on a circle.
  // Each range is [center - halfSpan, center + halfSpan].
  function angularOverlap(a1: number, hs1: number, a2: number, hs2: number): boolean {
    // Angular distance between centers (shortest arc)
    let d = Math.abs(a1 - a2)
    if (d > Math.PI) d = TWO_PI - d
    return d < hs1 + hs2
  }

  // Track all labels placed on each tier (needed for wrap-around checks)
  const tierLabels: { angle: number; halfSpan: number }[][] = []

  for (const item of items) {
    let placed = false
    for (let t = 0; t < tierLabels.length; t++) {
      const tr = BASE_LABEL_R - t * TIER_SPACING
      if (tr < 30) break
      const hs = item.textWidth / (2 * tr)
      // Check against all labels on this tier
      let overlaps = false
      for (const existing of tierLabels[t]) {
        if (angularOverlap(item.angle, hs, existing.angle, existing.halfSpan)) {
          overlaps = true
          break
        }
      }
      if (!overlaps) {
        item.tier = t
        tierLabels[t].push({ angle: item.angle, halfSpan: hs })
        placed = true
        break
      }
    }
    if (!placed) {
      const t = tierLabels.length
      const tr = BASE_LABEL_R - t * TIER_SPACING
      if (tr >= 30) {
        item.tier = t
        const hs = item.textWidth / (2 * tr)
        tierLabels.push([{ angle: item.angle, halfSpan: hs }])
      }
    }
  }

  return items.filter(item => {
    const r = BASE_LABEL_R - item.tier * TIER_SPACING
    return r >= 30
  })
}

const ANNOTATION_ARC_WIDTH = 16
const ANNOTATION_GAP = 2
const LABEL_FONT = '11px sans-serif'
const TICK_FONT = '9px monospace'
const CENTER_FONT_NAME = 'bold 14px sans-serif'
const CENTER_FONT_SIZE = '12px sans-serif'



/** Convert a base position to an angle (0 = top, clockwise). */
function posToAngle(pos: number, seqLen: number): number {
  return (pos / seqLen) * Math.PI * 2 - Math.PI / 2
}

/** Hit-test enzyme cut site markers on the plasmid map. */
function hitTestEnzymeGroup(
  px: number, py: number,
  cx: number, cy: number,
  baseRadius: number,
  groups: GroupedCutSite[],
  seqLen: number,
): GroupedCutSite | null {
  if (seqLen === 0) return null
  const hitRadius = 14 // generous click target around the tick mark
  for (const group of groups) {
    const angle = posToAngle(group.fwdCut, seqLen)
    // Check proximity to the tick mark (from innerR to outerR)
    const mx = cx + Math.cos(angle) * baseRadius
    const my = cy + Math.sin(angle) * baseRadius
    const dx = px - mx
    const dy = py - my
    if (dx * dx + dy * dy < hitRadius * hitRadius) return group
    // Also check the label area (inside the circle)
    const labelR = baseRadius - 22
    const lx = cx + Math.cos(angle) * labelR
    const ly = cy + Math.sin(angle) * labelR
    const ldx = px - lx
    const ldy = py - ly
    if (ldx * ldx + ldy * ldy < hitRadius * hitRadius) return group
  }
  return null
}

/** Check whether two annotations overlap, accounting for origin-spanning. */
export function annotationsOverlap(a: Annotation, b: Annotation): boolean {
  const aWraps = a.start > a.end
  const bWraps = b.start > b.end
  if (!aWraps && !bWraps) {
    // Both normal
    return a.start < b.end && a.end > b.start
  }
  if (aWraps && bWraps) {
    // Both wrap - they always overlap (both cover the origin)
    return true
  }
  // One wraps, one doesn't. The wrapping one covers [start, ∞) ∪ [0, end).
  const wrap = aWraps ? a : b
  const norm = aWraps ? b : a
  return norm.start < wrap.end || norm.end > wrap.start
}

/** Stack annotations into non-overlapping rings. */
export function stackAnnotations(annotations: Annotation[]): Annotation[][] {
  const sorted = [...annotations].sort((a, b) => a.start - b.start)
  const rings: Annotation[][] = []
  for (const ann of sorted) {
    let placed = false
    for (const ring of rings) {
      const overlaps = ring.some(existing => annotationsOverlap(ann, existing))
      if (!overlaps) {
        ring.push(ann)
        placed = true
        break
      }
    }
    if (!placed) {
      rings.push([ann])
    }
  }
  return rings
}

/** Compute the angular span for an annotation, using its base positions
 *  to unambiguously determine whether it spans the origin.
 *  Always returns a positive value in (0, 2π]. */
export function annArcSpan(start: number, end: number, seqLen: number): number {
  const spansOrigin = start > end
  let bpSpan: number
  if (spansOrigin) {
    bpSpan = seqLen - start + end
  } else {
    bpSpan = end - start
  }
  if (bpSpan <= 0) bpSpan = seqLen // full circle
  return (bpSpan / seqLen) * Math.PI * 2
}

/** Draw an arc with an arrowhead at the end for directionality.
 *  `span` is the pre-computed angular span (always positive). */
function drawAnnotationArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  span: number,
  strand: number,
  _color: string,
  arcWidth: number,
) {
  const arrowAngle = Math.min(0.08, span * 0.2)

  ctx.beginPath()
  if (strand === 1) {
    // Forward: arrow at end
    ctx.arc(cx, cy, radius, startAngle, startAngle + span - arrowAngle)
    ctx.stroke()
    // Arrowhead
    const tipAngle = startAngle + span
    const baseAngle = startAngle + span - arrowAngle
    const innerR = radius - arcWidth / 2
    const outerR = radius + arcWidth / 2
    ctx.beginPath()
    ctx.moveTo(
      cx + Math.cos(baseAngle) * innerR,
      cy + Math.sin(baseAngle) * innerR,
    )
    ctx.lineTo(
      cx + Math.cos(tipAngle) * radius,
      cy + Math.sin(tipAngle) * radius,
    )
    ctx.lineTo(
      cx + Math.cos(baseAngle) * outerR,
      cy + Math.sin(baseAngle) * outerR,
    )
    ctx.closePath()
    ctx.fill()
  } else if (strand === -1) {
    // Reverse: arrow at start
    ctx.arc(cx, cy, radius, startAngle + arrowAngle, startAngle + span)
    ctx.stroke()
    // Arrowhead
    const tipAngle = startAngle
    const baseAngle = startAngle + arrowAngle
    const innerR = radius - arcWidth / 2
    const outerR = radius + arcWidth / 2
    ctx.beginPath()
    ctx.moveTo(
      cx + Math.cos(baseAngle) * innerR,
      cy + Math.sin(baseAngle) * innerR,
    )
    ctx.lineTo(
      cx + Math.cos(tipAngle) * radius,
      cy + Math.sin(tipAngle) * radius,
    )
    ctx.lineTo(
      cx + Math.cos(baseAngle) * outerR,
      cy + Math.sin(baseAngle) * outerR,
    )
    ctx.closePath()
    ctx.fill()
  } else {
    // No strand - plain arc, use span to go the right way around
    ctx.arc(cx, cy, radius, startAngle, startAngle + span)
    ctx.stroke()
  }
}

/** Draw the outline of an annotation arc (body + arrowhead) as a closed path. */
function strokeAnnotationArcOutline(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number,
  startAngle: number, span: number,
  strand: number,
  arcWidth: number,
  strokeColor: string,
  lineWidth = 1,
) {
  const arrowAngle = Math.min(0.08, span * 0.2)
  const innerR = radius - arcWidth / 2
  const outerR = radius + arcWidth / 2

  ctx.save()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.beginPath()

  if (strand === 1) {
    // Forward: arrow at end
    const bodyEnd = startAngle + span - arrowAngle
    const tipAngle = startAngle + span
    // Outer arc (forward)
    ctx.arc(cx, cy, outerR, startAngle, bodyEnd)
    // Arrow outer edge → tip
    ctx.lineTo(cx + Math.cos(tipAngle) * radius, cy + Math.sin(tipAngle) * radius)
    // Arrow tip → inner edge
    ctx.lineTo(cx + Math.cos(bodyEnd) * innerR, cy + Math.sin(bodyEnd) * innerR)
    // Inner arc (reverse)
    ctx.arc(cx, cy, innerR, bodyEnd, startAngle, true)
    ctx.closePath()
  } else if (strand === -1) {
    // Reverse: arrow at start
    const bodyStart = startAngle + arrowAngle
    const tipAngle = startAngle
    // Outer arc (forward from bodyStart)
    ctx.arc(cx, cy, outerR, bodyStart, startAngle + span)
    // End cap → inner arc
    ctx.arc(cx, cy, innerR, startAngle + span, bodyStart, true)
    // Arrow inner edge → tip
    ctx.lineTo(cx + Math.cos(tipAngle) * radius, cy + Math.sin(tipAngle) * radius)
    // Arrow tip → outer edge
    ctx.lineTo(cx + Math.cos(bodyStart) * outerR, cy + Math.sin(bodyStart) * outerR)
    ctx.closePath()
  } else {
    // No strand: outline the thick arc as a closed ring segment
    ctx.arc(cx, cy, outerR, startAngle, startAngle + span)
    ctx.arc(cx, cy, innerR, startAngle + span, startAngle, true)
    ctx.closePath()
  }

  ctx.stroke()
  ctx.restore()
}

interface PlasmidMapProps {
  onFindRequest?: () => void
  onEditFeature?: (annId: string) => void
  onCopyFeedback?: (msg: string) => void
}

function PlasmidMap(_props: PlasmidMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const setSelection = useEditorStore(s => s.setSelection)
  const setCaret = useEditorStore(s => s.setCaret)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const removeAnnotation = useEditorStore(s => s.removeAnnotation)
  const renameTab = useEditorStore(s => s.renameTab)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const readOnly = useEditorStore(s => s.readOnly)

  // Inline name editing
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const setViewMode = useEditorStore(s => s.setViewMode)
  // Feature popover: delayed on appear, immediate on leave. See useDelayedHover.
  const { target: annTooltip, show: showAnnTooltip, hide: hideAnnTooltip } = useDelayedHover<HoverTarget>()
  // Enzyme popover: same delay as the feature popover, so the two behave
  // identically on the same canvas.
  const { target: enzymeTooltip, show: showEnzymeTooltip, hide: hideEnzymeTooltip } =
    useDelayedHover<HoverTarget & { group: GroupedCutSite }>()
  const [hoveredEnzymeGroup, setHoveredEnzymeGroup] = useState<GroupedCutSite | null>(null)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const allEnzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const allAutoAnnotations = useEditorStore(s => s.autoAnnotations)
  const autoAnnotationPicks = useEditorStore(s => s.autoAnnotationPicks)
  const orfPicks = useEditorStore(s => s.orfPicks)
  const autoOverlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)
  const enzymeCutSites = showEnzymes ? allEnzymeCutSites : []
  const damMeth = doc.metadata?.damMethylated || false
  const dcmMeth = doc.metadata?.dcmMethylated || false
  const groupedEnzymeSites = useMemo(() => groupCutSites(enzymeCutSites, damMeth, dcmMeth), [enzymeCutSites, damMeth, dcmMeth])
  const orfResults = showOrfs ? allOrfResults : []

  // Context menu
  interface ContextMenuState {
    x: number
    y: number
    annId: string | null
    enzymeGroup: GroupedCutSite | null
  }
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ annId: string; annName: string } | null>(null)

  // Convert ORF results to Annotation objects for unified arc rendering.
  // Identity-based ids, so a pick survives a re-scan (see orf-features).
  const orfAnnotations = useMemo(() => {
    return orfResults.map(orf => {
      const data: AnnotationData = {
        id: orfIdFor(orf),
        name: orfName(orf),
        type: 'CDS',
        start: orf.start,
        end: orf.end,
        strand: orf.strand,
        color: orfColor(orf.strand, orf.frame),
      }
      return new Annotation(data)
    })
  }, [orfResults])

  // Filter out hidden annotations
  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])
  const visibleAnnotations = useMemo(() =>
    hiddenSet.size === 0 ? doc.annotations : doc.annotations.filter(a => !hiddenSet.has(a.id)),
    [doc.annotations, hiddenSet]
  )

  /** Auto-annotation proposals the document does not already cover. */
  const autoAnnotations = useMemo(() => {
    if (!showAutoAnnotations || allAutoAnnotations.length === 0) return []
    return proposalAnnotations(
      proposalsFrom(allAutoAnnotations, doc.annotations, autoOverlapThreshold),
    )
  }, [showAutoAnnotations, allAutoAnnotations, doc.annotations, autoOverlapThreshold])

  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...autoAnnotations]
    if (extra.length === 0) return visibleAnnotations
    return [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, autoAnnotations])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const size = Math.min(container.clientWidth, container.clientHeight)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const C = getPlasmidColors(container)
    const cx = size / 2
    const cy = size / 2
    const seqLen = doc.sequence.length
    const baseRadius = size * 0.32

    // Clear
    ctx.fillStyle = C.bg
    ctx.fillRect(0, 0, size, size)

    if (seqLen === 0) {
      ctx.fillStyle = C.textMuted
      ctx.font = CENTER_FONT_NAME
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('No sequence loaded', cx, cy)
      return
    }

    // --- Selection arc ---
    // For origin-spanning selections (anchor > caret on circular), draw from anchor
    // through the origin to caret. For normal selections, draw from min to max.
    if (selection.anchor !== selection.caret) {
      const isOriginSel = isOriginSpanningSelection(selection, 'circular')
      let arcStart: number, arcEnd: number
      if (isOriginSel) {
        arcStart = selection.anchor
        arcEnd = selection.caret
      } else {
        arcStart = Math.min(selection.anchor, selection.caret)
        arcEnd = Math.max(selection.anchor, selection.caret)
      }
      const startAngle = posToAngle(arcStart, seqLen)
      const endAngle = posToAngle(arcEnd, seqLen)
      ctx.beginPath()
      ctx.arc(cx, cy, baseRadius, startAngle, endAngle)
      ctx.strokeStyle = C.selectionArc
      ctx.lineWidth = ANNOTATION_ARC_WIDTH * 3
      ctx.stroke()
    }

    // --- Backbone circle ---
    ctx.beginPath()
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2)
    ctx.strokeStyle = C.backbone
    ctx.lineWidth = BACKBONE_WIDTH
    ctx.stroke()

    // --- Tick marks ---
    const ticks = getTickIntervals(seqLen)
    ctx.font = TICK_FONT
    ctx.fillStyle = C.textMuted
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const dispOrigin = doc.metadata?.displayOrigin || 0

    for (let pos = 0; pos < seqLen; pos += ticks.minor) {
      const angle = posToAngle(pos, seqLen)
      const isMajor = pos % ticks.major === 0
      const innerR = baseRadius - (isMajor ? 8 : 4)
      const outerR = baseRadius + (isMajor ? 8 : 4)

      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR)
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR)
      ctx.strokeStyle = isMajor ? C.textMuted : C.tickMinor
      ctx.lineWidth = isMajor ? 1.5 : 0.5
      ctx.stroke()

      if (isMajor && pos > 0) {
        const labelR = baseRadius - 18
        const lx = cx + Math.cos(angle) * labelR
        const ly = cy + Math.sin(angle) * labelR
        ctx.save()
        ctx.translate(lx, ly)
        // Rotate text to be readable
        let textAngle = angle + Math.PI / 2
        if (textAngle > Math.PI / 2 && textAngle < Math.PI * 1.5) {
          textAngle += Math.PI
        }
        ctx.rotate(textAngle)
        ctx.fillText(String(displayPosition(pos, dispOrigin, seqLen)), 0, 0)
        ctx.restore()
      }
    }

    // --- Methylation site markers (subtle dots on backbone) ---
    if ((damMeth || dcmMeth) && seqLen > 0) {
      const bases = doc.sequence.bases.toUpperCase()
      ctx.globalAlpha = 0.3
      const dotR = Math.max(1, baseRadius * 0.008)
      if (damMeth) {
        ctx.fillStyle = '#3b82f6'
        for (let i = 0; i <= bases.length - 4; i++) {
          if (bases[i] === 'G' && bases[i+1] === 'A' && bases[i+2] === 'T' && bases[i+3] === 'C') {
            const angle = posToAngle(i + 2, seqLen) // center of GATC
            const dx = cx + Math.cos(angle) * baseRadius
            const dy = cy + Math.sin(angle) * baseRadius
            ctx.beginPath()
            ctx.arc(dx, dy, dotR, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      if (dcmMeth) {
        ctx.fillStyle = '#f59e0b'
        for (let i = 0; i <= bases.length - 5; i++) {
          if (bases[i] === 'C' && bases[i+1] === 'C' &&
              (bases[i+2] === 'A' || bases[i+2] === 'T') &&
              bases[i+3] === 'G' && bases[i+4] === 'G') {
            const angle = posToAngle(i + 2, seqLen)
            const dx = cx + Math.cos(angle) * baseRadius
            const dy = cy + Math.sin(angle) * baseRadius
            ctx.beginPath()
            ctx.arc(dx, dy, dotR, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }
      ctx.globalAlpha = 1
    }

    // --- Enzyme cut site markers ---
    if (groupedEnzymeSites.length > 0) {
      const TIER_SPACING = 16
      const BASE_LABEL_R = baseRadius - 22

      // Draw tick marks and dots first (always at backbone)
      for (const group of groupedEnzymeSites) {
        const isHovered = hoveredEnzymeGroup && group.fwdCut === hoveredEnzymeGroup.fwdCut && group.label === hoveredEnzymeGroup.label
        const methDim = group.methEffect
        if (methDim) ctx.globalAlpha = methDim === 'blocked' ? 0.25 : 0.5
        const angle = posToAngle(group.fwdCut, seqLen)
        const innerR = baseRadius - 12
        const outerR = baseRadius + 12

        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR)
        ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR)
        ctx.strokeStyle = C.enzyme
        ctx.lineWidth = isHovered ? 3 : 2
        ctx.stroke()

        const bx = cx + Math.cos(angle) * baseRadius
        const by = cy + Math.sin(angle) * baseRadius
        ctx.fillStyle = C.enzyme
        ctx.beginPath()
        ctx.arc(bx, by, isHovered ? 4 : 3, 0, Math.PI * 2)
        ctx.fill()
        if (methDim) ctx.globalAlpha = 1
      }

      // Assign labels to tiers and draw with leader lines
      const tieredLabels = assignEnzymeLabelTiers(groupedEnzymeSites, seqLen, baseRadius, ctx)
      for (const item of tieredLabels) {
        const isHovered = hoveredEnzymeGroup && item.group.fwdCut === hoveredEnzymeGroup.fwdCut && item.group.label === hoveredEnzymeGroup.label
        const methDim = item.group.methEffect
        if (methDim) ctx.globalAlpha = methDim === 'blocked' ? 0.25 : 0.5
        const labelR = BASE_LABEL_R - item.tier * TIER_SPACING

        // Leader line from backbone inward to label position
        if (item.tier > 0) {
          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(item.angle) * (baseRadius - 12), cy + Math.sin(item.angle) * (baseRadius - 12))
          ctx.lineTo(cx + Math.cos(item.angle) * (labelR + 6), cy + Math.sin(item.angle) * (labelR + 6))
          ctx.strokeStyle = C.enzyme
          ctx.globalAlpha = methDim ? (methDim === 'blocked' ? 0.15 : 0.25) : 0.3
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.globalAlpha = methDim ? (methDim === 'blocked' ? 0.25 : 0.5) : 1
        }

        // Label text
        const lx = cx + Math.cos(item.angle) * labelR
        const ly = cy + Math.sin(item.angle) * labelR
        ctx.save()
        ctx.font = isHovered ? 'bold 10px sans-serif' : '9px sans-serif'
        ctx.fillStyle = C.enzyme
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.translate(lx, ly)
        let textAngle = item.angle + Math.PI / 2
        if (textAngle > Math.PI / 2 && textAngle < Math.PI * 1.5) {
          textAngle += Math.PI
        }
        ctx.rotate(textAngle)
        ctx.fillText(item.group.label, 0, 0)
        ctx.restore()
        if (methDim) ctx.globalAlpha = 1
      }
    }

    // --- Annotation arcs ---
    const outsideLabels: { name: string; midAngle: number; arcRadius: number; isHovered: boolean; color: string }[] = []
    const rings = stackAnnotations(allAnnotations)
    for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
      const radius = baseRadius + 14 + ringIdx * (ANNOTATION_ARC_WIDTH + ANNOTATION_GAP)

      for (const ann of rings[ringIdx]) {
        const startAngle = posToAngle(ann.start, seqLen)
        const span = annArcSpan(ann.start, ann.end, seqLen)
        const isHovered = ann.id === hoveredAnnotationId

        const arcW = isHovered ? ANNOTATION_ARC_WIDTH + 4 : ANNOTATION_ARC_WIDTH

        // Auto-annotation proposals are not in the document yet, so they are
        // drawn faint with a dashed outline; picking one fills it in and
        // outlines it solid in the accent colour. Same language as the linear
        // view, because the same Ctrl-click works in both.
        const autoKey = keyFromAutoId(ann.id)
        const orfK = keyFromOrfId(ann.id)
        const isProposal = autoKey !== null
        const isPicked = (autoKey !== null && autoAnnotationPicks.has(autoKey))
          || (orfK !== null && orfPicks.has(orfK))

        // Draw arc with original color
        ctx.strokeStyle = ann.color
        ctx.fillStyle = ann.color
        ctx.lineWidth = arcW
        ctx.lineCap = 'butt'
        ctx.globalAlpha = isHovered ? 1 : isProposal ? (isPicked ? 0.6 : 0.28) : 0.7

        drawAnnotationArc(ctx, cx, cy, radius, startAngle, span, ann.strand, ann.color, arcW)

        // Draw outline border around the full annotation shape
        ctx.globalAlpha = isHovered ? 1 : 0.8
        if (isProposal && !isPicked) ctx.setLineDash([4, 3])
        strokeAnnotationArcOutline(
          ctx, cx, cy, radius, startAngle, span, ann.strand, arcW,
          isPicked ? C.accent : visibleStroke(ann.color),
          isPicked ? 2 : 1,
        )
        ctx.setLineDash([])

        ctx.globalAlpha = 1

        // Label - render inside the arc if it fits, otherwise collect for outside placement
        const midAngle = startAngle + span / 2
        const labelFont = isHovered ? 'bold 12px sans-serif' : LABEL_FONT
        ctx.font = labelFont
        const textWidth = ctx.measureText(ann.name).width
        const arcLength = Math.abs(span) * radius
        const textPad = 8

        if (textWidth + textPad < arcLength) {
          // Render text curved along the arc
          ctx.save()
          ctx.font = labelFont
          ctx.fillStyle = contrastText(ann.color)
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          // Measure each character width
          const chars = ann.name.split('')
          const charWidths = chars.map(ch => ctx.measureText(ch).width)
          const totalCharWidth = charWidths.reduce((a, b) => a + b, 0)

          // Angular span the text occupies
          const textAngularSpan = totalCharWidth / radius

          // Determine if text should be flipped (bottom half of circle)
          const normMid = ((midAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
          const flip = normMid > Math.PI / 2 && normMid < Math.PI * 1.5

          // Starting angle: center the text at midAngle
          let charAngle: number
          if (flip) {
            // Read right-to-left so text isn't upside down
            charAngle = midAngle + textAngularSpan / 2
            for (let ci = 0; ci < chars.length; ci++) {
              const halfChar = charWidths[ci] / 2 / radius
              charAngle -= halfChar
              const x = cx + Math.cos(charAngle) * radius
              const y = cy + Math.sin(charAngle) * radius
              ctx.save()
              ctx.translate(x, y)
              ctx.rotate(charAngle - Math.PI / 2)
              ctx.fillText(chars[ci], 0, 0)
              ctx.restore()
              charAngle -= halfChar
            }
          } else {
            charAngle = midAngle - textAngularSpan / 2
            for (let ci = 0; ci < chars.length; ci++) {
              const halfChar = charWidths[ci] / 2 / radius
              charAngle += halfChar
              const x = cx + Math.cos(charAngle) * radius
              const y = cy + Math.sin(charAngle) * radius
              ctx.save()
              ctx.translate(x, y)
              ctx.rotate(charAngle + Math.PI / 2)
              ctx.fillText(chars[ci], 0, 0)
              ctx.restore()
              charAngle += halfChar
            }
          }
          ctx.restore()
        } else {
          // Collect for outside label placement (rendered after all arcs)
          outsideLabels.push({
            name: ann.name,
            midAngle,
            arcRadius: radius,
            isHovered,
            color: ann.color,
          })
        }
      }
    }

    // --- Outside annotation labels (straight text, tiered to avoid overlap) ---
    if (outsideLabels.length > 0) {
      const TWO_PI = Math.PI * 2
      const normalize = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI
      const OUTSIDE_LABEL_FONT = '10px sans-serif'
      const OUTSIDE_LABEL_FONT_BOLD = 'bold 11px sans-serif'
      const TIER_GAP = 14
      const MAX_LABEL_WIDTH = size * 0.22
      const LEADER_GAP = 4 // gap between arc and leader line start

      // Compute the outermost annotation ring radius
      const outermostRingR = baseRadius + 14 + (rings.length - 1) * (ANNOTATION_ARC_WIDTH + ANNOTATION_GAP)
      const baseLabelR = outermostRingR + ANNOTATION_ARC_WIDTH / 2 + 18

      // Prepare labels: measure text, truncate if needed
      ctx.font = OUTSIDE_LABEL_FONT
      interface OutsideLabel {
        name: string
        displayName: string
        angle: number // normalized [0, 2π)
        midAngle: number // original (for positioning)
        arcRadius: number
        textWidth: number
        isHovered: boolean
        color: string
        tier: number
      }

      const labels: OutsideLabel[] = outsideLabels.map(ol => {
        const font = ol.isHovered ? OUTSIDE_LABEL_FONT_BOLD : OUTSIDE_LABEL_FONT
        ctx.font = font
        let displayName = ol.name
        let tw = ctx.measureText(displayName).width
        if (tw > MAX_LABEL_WIDTH) {
          // Truncate with ellipsis
          while (displayName.length > 1 && tw > MAX_LABEL_WIDTH) {
            displayName = displayName.slice(0, -1)
            tw = ctx.measureText(displayName + '…').width
          }
          displayName += '…'
          tw = ctx.measureText(displayName).width
        }
        return {
          name: ol.name,
          displayName,
          angle: normalize(ol.midAngle),
          midAngle: ol.midAngle,
          arcRadius: ol.arcRadius,
          textWidth: tw,
          isHovered: ol.isHovered,
          color: ol.color,
          tier: 0,
        }
      })

      // Sort by angle for consistent processing
      labels.sort((a, b) => a.angle - b.angle)

      // Assign tiers using screen-space bounding box collision detection.
      // For horizontal text, angular overlap doesn't capture the real overlap –
      // we need to check if the actual rendered rectangles intersect.
      const LABEL_H = 12 // approximate line height
      const LABEL_PAD = 3

      // For x-extent computation: use the label's own arc radius (not just
      // the outermost ring) to ensure clearance from its specific feature.
      const TEXT_GAP_ = 6

      function labelXPos(l: OutsideLabel, tier: number): { lx: number; ly: number; align: CanvasTextAlign } {
        const tierOffset = tier * TIER_GAP
        const r = baseLabelR + tierOffset
        // Position along the radial direction
        const rx = cx + Math.cos(l.midAngle) * r
        const ry = cy + Math.sin(l.midAngle) * r
        const na = normalize(l.midAngle)
        // Very narrow top/bottom zones (within ~5° of 12/6 o'clock)
        const nearTop = na > Math.PI * 1.47 || na < Math.PI * 0.03
        const nearBottom = na > Math.PI * 0.47 && na < Math.PI * 0.53
        const onRight = na < Math.PI / 2 || na > Math.PI * 1.5

        if (nearTop || nearBottom) {
          return { lx: rx, ly: ry, align: 'center' }
        }

        // For all other labels: ensure the text clears the outermost arc
        // at this y-coordinate.  Compute the arc's x-extent at ry, then
        // place text just beyond it – but never closer than the radial point.
        const arcOuter = Math.max(l.arcRadius, outermostRingR) + ANNOTATION_ARC_WIDTH / 2 + 4
        const dy = ry - cy
        const rSq = arcOuter * arcOuter
        const dySq = dy * dy
        if (dySq < rSq) {
          const xExtent = Math.sqrt(rSq - dySq)
          if (onRight) {
            const clearX = cx + xExtent + TEXT_GAP_ + tierOffset
            const lx = Math.max(clearX, rx)
            return { lx, ly: ry, align: 'left' }
          } else {
            const clearX = cx - xExtent - TEXT_GAP_ - tierOffset
            const lx = Math.min(clearX, rx)
            return { lx, ly: ry, align: 'right' }
          }
        }
        // dy >= arcOuter means we're above/below the arc circle – use radial
        return { lx: rx, ly: ry, align: onRight ? 'left' : 'right' }
      }

      function labelRect(l: OutsideLabel, tier: number): { x1: number; y1: number; x2: number; y2: number } {
        const { lx, ly, align } = labelXPos(l, tier)
        let x1: number, x2: number
        if (align === 'center') {
          x1 = lx - l.textWidth / 2 - LABEL_PAD
          x2 = lx + l.textWidth / 2 + LABEL_PAD
        } else if (align === 'left') {
          x1 = lx - LABEL_PAD
          x2 = lx + l.textWidth + LABEL_PAD
        } else {
          x1 = lx - l.textWidth - LABEL_PAD
          x2 = lx + LABEL_PAD
        }
        return { x1, y1: ly - LABEL_H / 2 - LABEL_PAD, x2, y2: ly + LABEL_H / 2 + LABEL_PAD }
      }

      function rectsOverlap(a: ReturnType<typeof labelRect>, b: ReturnType<typeof labelRect>): boolean {
        return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1
      }

      const tierRects: ReturnType<typeof labelRect>[][] = []

      for (const label of labels) {
        let placed = false
        for (let t = 0; t < tierRects.length; t++) {
          const rect = labelRect(label, t)
          let overlaps = false
          for (const existing of tierRects[t]) {
            if (rectsOverlap(rect, existing)) {
              overlaps = true
              break
            }
          }
          if (!overlaps) {
            label.tier = t
            tierRects[t].push(rect)
            placed = true
            break
          }
        }
        if (!placed) {
          label.tier = tierRects.length
          tierRects.push([labelRect(label, label.tier)])
        }
      }

      // Draw labels with leader lines
      for (const label of labels) {
        const { lx, ly, align } = labelXPos(label, label.tier)

        // Leader line from arc edge to near the label
        const leaderStartR = label.arcRadius + ANNOTATION_ARC_WIDTH / 2 + LEADER_GAP
        const leaderEndX = lx + (align === 'left' ? -3 : align === 'right' ? 3 : 0)
        const leaderEndY = ly
        const sx = cx + Math.cos(label.midAngle) * leaderStartR
        const sy = cy + Math.sin(label.midAngle) * leaderStartR
        const leaderLen = Math.hypot(leaderEndX - sx, leaderEndY - sy)
        if (leaderLen > 8) {
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(leaderEndX, leaderEndY)
          ctx.strokeStyle = label.isHovered ? C.text : C.tickMinor
          ctx.lineWidth = 0.75
          ctx.stroke()
        }

        // Draw horizontal text
        const font = label.isHovered ? OUTSIDE_LABEL_FONT_BOLD : OUTSIDE_LABEL_FONT
        ctx.font = font
        ctx.fillStyle = label.isHovered ? C.text : C.textMuted
        ctx.textAlign = align
        ctx.textBaseline = 'middle'
        ctx.fillText(label.displayName, lx, ly)
      }
    }

    // --- Caret indicator ---
    const hasSelection = selection.anchor !== selection.caret
    if (!hasSelection) {
      const caretAngle = posToAngle(selection.caret, seqLen)
      const innerR = baseRadius - 10
      const outerR = baseRadius + 10
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(caretAngle) * innerR, cy + Math.sin(caretAngle) * innerR)
      ctx.lineTo(cx + Math.cos(caretAngle) * outerR, cy + Math.sin(caretAngle) * outerR)
      ctx.strokeStyle = C.accent
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // --- Center text ---
    ctx.fillStyle = C.text
    ctx.font = CENTER_FONT_NAME
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const maxNameW = baseRadius * 1.6
    let centerName = doc.name
    if (ctx.measureText(centerName).width > maxNameW) {
      while (centerName.length > 1 && ctx.measureText(centerName + '…').width > maxNameW) {
        centerName = centerName.slice(0, -1)
      }
      centerName += '…'
    }
    ctx.fillText(centerName, cx, cy - 10)
    ctx.font = CENTER_FONT_SIZE
    ctx.fillStyle = C.textMuted
    ctx.fillText(formatBp(seqLen), cx, cy + 10)

    if (hasSelection) {
      const selBpCount = selectionLength(selection, 'circular', seqLen)
      ctx.font = '11px sans-serif'
      ctx.fillStyle = C.accent
      ctx.fillText(`${selBpCount} bp selected`, cx, cy + 28)
    }
  }, [doc, selection, hoveredAnnotationId, groupedEnzymeSites, hoveredEnzymeGroup, allAnnotations, autoAnnotationPicks, orfPicks])

  // --- Click handler: click annotation to select its range, or backbone to place caret ---
  const handleClick = useCallback((e: MouseEvent) => {
    setCtxMenu(null)

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const size = Math.min(container.clientWidth, container.clientHeight)
    const cx = size / 2
    const cy = size / 2
    const seqLen = doc.sequence.length
    if (seqLen === 0) return

    const baseRadius = size * 0.32
    const rings = stackAnnotations(allAnnotations)

    // Check center name click - open inline editor
    const dxCenter = px - cx
    const dyCenter = py - cy
    if (Math.abs(dxCenter) < 60 && Math.abs(dyCenter) < 16) {
      setNameValue(doc.name)
      setEditingName(true)
      setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 30)
      return
    }

    // Check enzyme hit first - select recognition site, switch to linear only if in circular-only view
    const hitEnzyme = hitTestEnzymeGroup(px, py, cx, cy, baseRadius, groupedEnzymeSites, seqLen)
    if (hitEnzyme) {
      setSelection({ anchor: hitEnzyme.recognitionStart, caret: hitEnzyme.recognitionEnd })
      if (useEditorStore.getState().viewMode === 'circular') {
        setViewMode('linear')
      }
      return
    }

    // Check annotation hit
    const hitAnn = hitTestAnnotationArc(px, py, cx, cy, baseRadius, allAnnotations, rings, seqLen)
    if (hitAnn) {
      // Ctrl/Cmd-click picks a suggestion or an ORF, as in the linear view.
      if (e.ctrlKey || e.metaKey) {
        const autoKey = keyFromAutoId(hitAnn.id)
        if (autoKey !== null) {
          useEditorStore.getState().toggleAutoAnnotationPick(autoKey)
          return
        }
        const orfK = keyFromOrfId(hitAnn.id)
        if (orfK !== null) {
          useEditorStore.getState().toggleOrfPick(orfK)
          return
        }
      }
      setSelection({ anchor: hitAnn.start, caret: hitAnn.end })
      return
    }

    // Calculate angle from center
    const dx = px - cx
    const dy = py - cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    // Only respond to clicks near the backbone
    if (dist < baseRadius * 0.5 || dist > baseRadius * 1.8) return

    let angle = Math.atan2(dy, dx) + Math.PI / 2
    if (angle < 0) angle += Math.PI * 2
    const pos = Math.round((angle / (Math.PI * 2)) * seqLen) % seqLen

    if (e.shiftKey) {
      setSelection({ anchor: selection.anchor, caret: pos })
    } else {
      setCaret(pos)
    }
  }, [doc.sequence.length, allAnnotations, groupedEnzymeSites, selection.anchor, setSelection, setCaret, setViewMode])

  // --- Mousemove handler: hover detection for annotations and enzymes ---
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const size = Math.min(container.clientWidth, container.clientHeight)
    const cx = size / 2
    const cy = size / 2
    const seqLen = doc.sequence.length
    if (seqLen === 0) return

    const baseRadius = size * 0.32

    // Check enzyme hover first
    const hitEnzyme = hitTestEnzymeGroup(px, py, cx, cy, baseRadius, groupedEnzymeSites, seqLen)
    if (hitEnzyme) {
      setHoveredEnzymeGroup(hitEnzyme)
      showEnzymeTooltip({ x: e.clientX, y: e.clientY, key: enzymeGroupKey(hitEnzyme), group: hitEnzyme })
      hideAnnTooltip()
      canvas.style.cursor = 'pointer'
      if (useEditorStore.getState().hoveredAnnotationId) {
        setHoveredAnnotation(null)
      }
      return
    }

    // Clear enzyme hover
    if (hoveredEnzymeGroup) {
      setHoveredEnzymeGroup(null)
      hideEnzymeTooltip()
    }

    const rings = stackAnnotations(allAnnotations)
    const hitAnn = hitTestAnnotationArc(px, py, cx, cy, baseRadius, allAnnotations, rings, seqLen)

    const currentHover = useEditorStore.getState().hoveredAnnotationId
    const newId = hitAnn?.id ?? null
    if (newId !== currentHover) {
      setHoveredAnnotation(newId)
    }
    if (hitAnn) {
      showAnnTooltip({ x: e.clientX + 12, y: e.clientY - 10, key: hitAnn.id })
    } else {
      hideAnnTooltip()
    }
    canvas.style.cursor = hitAnn ? 'pointer' : 'crosshair'
  }, [doc.sequence.length, allAnnotations, groupedEnzymeSites, hoveredEnzymeGroup, setHoveredAnnotation, showAnnTooltip, hideAnnTooltip, showEnzymeTooltip, hideEnzymeTooltip])

  const handleMouseLeave = useCallback(() => {
    if (useEditorStore.getState().hoveredAnnotationId) {
      setHoveredAnnotation(null)
    }
    setHoveredEnzymeGroup(null)
    hideEnzymeTooltip()
    hideAnnTooltip()
  }, [setHoveredAnnotation, hideAnnTooltip, hideEnzymeTooltip])

  // --- Context menu ---
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const size = Math.min(container.clientWidth, container.clientHeight)
    const cx = size / 2
    const cy = size / 2
    const seqLen = doc.sequence.length
    if (seqLen === 0) return

    const baseRadius = size * 0.32
    const rings = stackAnnotations(allAnnotations)
    const hitAnn = hitTestAnnotationArc(px, py, cx, cy, baseRadius, allAnnotations, rings, seqLen)
    const hitEnzyme = hitTestEnzymeGroup(px, py, cx, cy, baseRadius, groupedEnzymeSites, seqLen)

    // Clear hover tooltips - the context menu will embed tooltip content
    hideAnnTooltip()
    hideEnzymeTooltip()

    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      annId: hitAnn?.id ?? null,
      enzymeGroup: hitEnzyme,
    })
  }, [doc.sequence.length, allAnnotations, groupedEnzymeSites, hideAnnTooltip, hideEnzymeTooltip])

  // Close context menu on outside click or scroll
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

  // Double-click on annotation opens the edit annotation panel
  const handleDblClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const size = Math.min(container.clientWidth, container.clientHeight)
    const cx = size / 2
    const cy = size / 2
    const seqLen = doc.sequence.length
    if (seqLen === 0) return
    const baseRadius = size * 0.32
    const rings = stackAnnotations(allAnnotations)
    const hitAnn = hitTestAnnotationArc(px, py, cx, cy, baseRadius, allAnnotations, rings, seqLen)
    if (hitAnn) {
      useEditorStore.getState().setEditAnnotation(hitAnn.id)
      _props.onEditFeature?.(hitAnn.id)
    }
  }, [doc.sequence.length, allAnnotations, _props.onEditFeature])

  useEffect(() => {
    draw()

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    canvas.addEventListener('click', handleClick)
    canvas.addEventListener('dblclick', handleDblClick)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('contextmenu', handleContextMenu)
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)

    return () => {
      canvas.removeEventListener('click', handleClick)
      canvas.removeEventListener('dblclick', handleDblClick)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      ro.disconnect()
    }
  }, [draw, handleClick, handleDblClick, handleMouseMove, handleMouseLeave, handleContextMenu])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair' }}
      />
      {editingName && (() => {
        // Position the input at the center of the canvas
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return null
        const size = Math.min(container.clientWidth, container.clientHeight)
        const canvasLeft = (container.clientWidth - size) / 2
        const canvasTop = (container.clientHeight - size) / 2
        const cx = canvasLeft + size / 2
        const cy = canvasTop + size / 2
        const handleSubmit = () => {
          const trimmed = nameValue.trim()
          if (trimmed && activeTabId) renameTab(activeTabId, trimmed)
          setEditingName(false)
        }
        return (
          <input
            ref={nameInputRef}
            className="plasmid-name-input"
            style={{
              position: 'absolute',
              left: cx - 70,
              top: cy - 20,
              width: 140,
            }}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') setEditingName(false)
            }}
            spellCheck={false}
          />
        )
      })()}
      {/* Hover tooltips - hidden when context menu is open */}
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

      {!ctxMenu && enzymeTooltip && (
        <EnzymeTooltip
          x={enzymeTooltip.x}
          y={enzymeTooltip.y}
          group={enzymeTooltip.group}
        />
      )}

      {/* Context menu with embedded tooltip */}
      {ctxMenu && (() => {
        const ctxSegs = selectionSegments(selection, doc.sequence.topology, doc.sequence.length)
        const hasSelection = ctxSegs.length > 0
        const ctxAnn = ctxMenu.annId
          ? allAnnotations.find(a => a.id === ctxMenu.annId) ?? null
          : null
        const isUserAnn = ctxAnn && !ctxAnn.id.startsWith('_orf_') && !ctxAnn.id.startsWith('_primer_')
          && !isAutoAnnotationId(ctxAnn.id)
        const ctxEnzymeGroup = ctxMenu.enzymeGroup
        // Use first site for single-enzyme actions (copy recognition, lookup)
        const ctxEnzymeSite = ctxEnzymeGroup?.sites[0] ?? null

        const getCtxSelectedBases = () => {
          let text = ''
          for (const [s, e] of ctxSegs) text += doc.sequence.basesIn(s, e)
          return text
        }

        const handleCopy = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          navigator.clipboard.writeText(bases).then(() => _props.onCopyFeedback?.(`Copied ${bases.length} bp`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyRevComp = () => {
          if (!hasSelection) return
          const text = reverseComplementStr(getCtxSelectedBases())
          navigator.clipboard.writeText(text).then(() => _props.onCopyFeedback?.(`Copied reverse complement (${text.length} bp)`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyProtein = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          const protein = translateSequenceStr(bases)
          navigator.clipboard.writeText(protein).then(() => _props.onCopyFeedback?.(`Copied protein (${protein.length} aa)`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleSelectAnnotation = () => {
          if (!ctxAnn) return
          setSelection({ anchor: ctxAnn.start, caret: ctxAnn.end })
          setCtxMenu(null)
        }
        const handleCopyAnnotationBases = () => {
          if (!ctxAnn) return
          const bases = annotationBases(ctxAnn, doc.sequence)
          navigator.clipboard.writeText(bases).then(() => _props.onCopyFeedback?.(`Copied ${bases.length} bp from "${ctxAnn!.name}"`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleCopyAnnotationProtein = () => {
          if (!ctxAnn) return
          const protein = annotationProtein(ctxAnn, doc.sequence)
          navigator.clipboard.writeText(protein).then(() => _props.onCopyFeedback?.(`Copied ${protein.length} aa from "${ctxAnn!.name}"`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleEditAnnotation = () => {
          if (!ctxAnn) return
          useEditorStore.getState().setEditAnnotation(ctxAnn.id)
          _props.onEditFeature?.(ctxAnn.id)
          setCtxMenu(null)
        }
        const handleDeleteAnnotation = () => {
          if (!ctxAnn) return
          setDeleteConfirm({ annId: ctxAnn.id, annName: ctxAnn.name })
          setCtxMenu(null)
        }
        const handleAddAnnotation = () => {
          if (!hasSelection) return
          const selR = selectionRange(selection)
          if (!selR) return
          const id = `ann_${Date.now()}`
          addAnnotation({
            id,
            name: 'New Feature',
            type: 'misc_feature',
            start: selR[0],
            end: selR[1],
            strand: 1,
            color: '#4dabf7',
          })
          setCtxMenu(null)
        }
        const handleCopyRecognition = () => {
          if (!ctxEnzymeSite) return
          navigator.clipboard.writeText(ctxEnzymeSite.enzyme.recognition).then(() => _props.onCopyFeedback?.(`Copied ${ctxEnzymeSite!.enzyme.recognition}`)).catch(e => console.warn('Clipboard write failed:', e))
          setCtxMenu(null)
        }
        const handleSelectRecognition = () => {
          if (!ctxEnzymeGroup) return
          setSelection({ anchor: ctxEnzymeGroup.recognitionStart, caret: ctxEnzymeGroup.recognitionEnd })
          setCtxMenu(null)
        }
        const handleLookupEnzyme = () => {
          if (!ctxEnzymeSite) return
          window.open(`https://www.google.com/search?q=${encodeURIComponent(ctxEnzymeSite.enzyme.name + ' restriction enzyme')}`, '_blank')
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
            {!readOnly && hasSelection && (
              <button className="ctx-menu-item" onClick={handleAddAnnotation}>
                Add Annotation to Selection
              </button>
            )}
          </ContextMenuPopup>
        )
      })()}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete Annotation"
        message={`Delete "${deleteConfirm?.annName}"? This cannot be undone.`}
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
    </div>
  )
}

/** Memoised for the same reason as SequenceView — see the note there. */
export default memo(PlasmidMap)
