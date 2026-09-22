/**
 * Minimap overview bar for long sequences.
 *
 * Shows the entire sequence as a horizontal bar with:
 * - Position ruler with tick labels
 * - Annotation bars at miniature scale (stacked by strand)
 * - Viewport indicator (draggable)
 * - Selection highlight
 * - Click-to-scroll navigation
 */

import { useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useEditorStore, selectionSegments } from '../store'
import type { Annotation } from '../models/Annotation'
import { displayPosition } from '../models/Document'
import { visibleStroke } from '../utils/color'
import type { IntervalTree } from '../models/IntervalTree'

interface MinimapBarProps {
  /** Scroll the main sequence view to a base position */
  onScrollToBase: (base: number) => void
  /** Current scroll position as a fraction [0, 1] */
  scrollFraction: number
  /** Fraction of the sequence visible in the viewport */
  viewportFraction: number
  /** The annotation tree (includes ORFs, primers) */
  annTree: IntervalTree
  /** Whether the minimap is collapsed */
  collapsed: boolean
  onToggleCollapse: () => void
}

// Layout constants
const RULER_H = 16
const STRAND_H = 4       // height per annotation lane
const STRAND_GAP = 1
const MAX_LANES = 3       // max stacking depth per strand direction
const FWD_AREA_H = MAX_LANES * (STRAND_H + STRAND_GAP)
const REV_AREA_H = MAX_LANES * (STRAND_H + STRAND_GAP)
const BACKBONE_H = 2
const GC_PLOT_H = 20     // GC content sparkline height
const GC_GAP = 2
const PADDING_Y = 2
const FULL_H = PADDING_Y + RULER_H + FWD_AREA_H + BACKBONE_H + REV_AREA_H + GC_GAP + GC_PLOT_H + PADDING_Y
const COLLAPSED_H = 6
const LEFT_MARGIN = 4
const RIGHT_MARGIN = 4

/** Stack annotations into lanes (simple greedy, forward or reverse). */
function stackMiniAnns(anns: Annotation[], seqLen: number): Annotation[][] {
  const lanes: { end: number; ann: Annotation }[][] = []
  // Sort by start position for greedy packing
  const sorted = [...anns].sort((a, b) => a.start - b.start)
  for (const ann of sorted) {
    const aEnd = ann.spansOrigin() ? seqLen : ann.end
    let placed = false
    for (const lane of lanes) {
      if (lane.length === 0 || lane[lane.length - 1].end <= ann.start) {
        lane.push({ end: aEnd, ann })
        placed = true
        break
      }
    }
    if (!placed && lanes.length < MAX_LANES) {
      lanes.push([{ end: aEnd, ann }])
    }
  }
  return lanes.map(lane => lane.map(e => e.ann))
}

export default function MinimapBar({
  onScrollToBase,
  scrollFraction,
  viewportFraction,
  annTree,
  collapsed,
  onToggleCollapse,
}: MinimapBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ dragging: boolean; offsetFrac: number }>({ dragging: false, offsetFrac: 0 })

  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const seqLen = doc.sequence.length
  const topology = doc.sequence.topology

  // Get all annotations from the tree
  const allAnns = useMemo(() => annTree.all(), [annTree])

  // Split into forward/reverse/neutral
  const { fwdAnns, revAnns } = useMemo(() => {
    const fwd: Annotation[] = []
    const rev: Annotation[] = []
    for (const ann of allAnns) {
      if (ann.strand === 1) fwd.push(ann)
      else if (ann.strand === -1) rev.push(ann)
      else fwd.push(ann) // neutral goes to forward track
    }
    return { fwdAnns: fwd, revAnns: rev }
  }, [allAnns])

  // Stack into lanes
  const fwdLanes = useMemo(() => stackMiniAnns(fwdAnns, seqLen), [fwdAnns, seqLen])
  const revLanes = useMemo(() => stackMiniAnns(revAnns, seqLen), [revAnns, seqLen])

  // GC content per bin (one bin per ~pixel column, max 2000 bins)
  const gcBins = useMemo(() => {
    if (seqLen === 0) return new Float32Array(0)
    const numBins = Math.min(2000, Math.max(100, seqLen))
    const binSize = seqLen / numBins
    const bins = new Float32Array(numBins)
    const bases = doc.sequence.bases
    for (let b = 0; b < numBins; b++) {
      const start = Math.floor(b * binSize)
      const end = Math.min(Math.floor((b + 1) * binSize), seqLen)
      let gc = 0
      for (let i = start; i < end; i++) {
        const ch = bases.charCodeAt(i)
        // G=71, C=67, g=103, c=99
        if (ch === 71 || ch === 67 || ch === 103 || ch === 99) gc++
      }
      bins[b] = gc / Math.max(1, end - start)
    }
    return bins
  }, [doc.sequence, seqLen])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth
    const height = collapsed ? COLLAPSED_H : FULL_H

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const barLeft = LEFT_MARGIN
    const barRight = width - RIGHT_MARGIN
    const barW = barRight - barLeft

    if (seqLen === 0 || barW <= 0) return

    const bpToX = (bp: number) => barLeft + (bp / seqLen) * barW

    // Background
    const cs = getComputedStyle(container)
    ctx.fillStyle = cs.getPropertyValue('--bg').trim() || '#ffffff'
    ctx.fillRect(0, 0, width, height)
    const accent = cs.getPropertyValue('--accent').trim() || '#6366f1'
    // Parse accent hex to rgba helper
    const ar = parseInt(accent.slice(1, 3), 16) || 99
    const ag = parseInt(accent.slice(3, 5), 16) || 102
    const ab = parseInt(accent.slice(5, 7), 16) || 241
    const accentA = (a: number) => `rgba(${ar},${ag},${ab},${a})`

    if (collapsed) {
      // Collapsed: just show viewport indicator
      ctx.fillStyle = accentA(0.3)
      const vpX = barLeft + scrollFraction * barW
      const vpW = Math.max(2, viewportFraction * barW)
      ctx.fillRect(vpX, 0, vpW, COLLAPSED_H)
      // Thin backbone line
      ctx.strokeStyle = '#999'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(barLeft, COLLAPSED_H / 2)
      ctx.lineTo(barRight, COLLAPSED_H / 2)
      ctx.stroke()
      return
    }

    let cy = PADDING_Y

    // --- Ruler ---
    ctx.fillStyle = '#999'
    ctx.font = '9px sans-serif'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'

    const dispOrigin = (topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0

    // Adaptive tick interval
    const targetTickPx = 80
    const bpPerPx = seqLen / barW
    const rawInterval = bpPerPx * targetTickPx
    // Round to a nice number
    const mag = Math.pow(10, Math.floor(Math.log10(rawInterval)))
    const nice = [1, 2, 2.5, 5, 10].find(m => m * mag >= rawInterval) ?? 10
    const tickInterval = nice * mag

    // Tick marks and labels
    ctx.strokeStyle = '#ccc'
    ctx.lineWidth = 1
    for (let bp = 0; bp < seqLen; bp += tickInterval) {
      const x = bpToX(bp)
      ctx.beginPath()
      ctx.moveTo(x, cy + RULER_H - 4)
      ctx.lineTo(x, cy + RULER_H)
      ctx.stroke()
      const label = displayPosition(Math.round(bp), dispOrigin, seqLen).toLocaleString()
      ctx.fillText(label, x, cy)
    }
    // Ruler baseline
    ctx.strokeStyle = '#ccc'
    ctx.beginPath()
    ctx.moveTo(barLeft, cy + RULER_H - 0.5)
    ctx.lineTo(barRight, cy + RULER_H - 0.5)
    ctx.stroke()

    cy += RULER_H

    // --- Forward strand annotations ---
    const drawLanes = (lanes: Annotation[][], startY: number) => {
      // Batch by color
      const colorBatch = new Map<string, { x: number; w: number; y: number }[]>()
      for (let li = 0; li < lanes.length; li++) {
        const laneY = startY + li * (STRAND_H + STRAND_GAP)
        for (const ann of lanes[li]) {
          const x1 = bpToX(ann.start)
          const x2 = ann.spansOrigin() ? barRight : bpToX(ann.end)
          const w = Math.max(1, x2 - x1)
          const c = ann.color
          if (!colorBatch.has(c)) colorBatch.set(c, [])
          colorBatch.get(c)!.push({ x: x1, w, y: laneY })
          // Origin-spanning: also draw [0, end)
          if (ann.spansOrigin()) {
            const x2b = bpToX(ann.end)
            colorBatch.get(c)!.push({ x: barLeft, w: Math.max(1, x2b - barLeft), y: laneY })
          }
        }
      }
      for (const [color, rects] of colorBatch) {
        ctx.fillStyle = color
        for (const r of rects) {
          ctx.fillRect(r.x, r.y, r.w, STRAND_H)
        }
        // Stroke for visibility on light colors
        const sc = visibleStroke(color)
        if (sc !== color) {
          ctx.strokeStyle = sc
          ctx.lineWidth = 0.5
          for (const r of rects) {
            if (r.w > 2) ctx.strokeRect(r.x, r.y, r.w, STRAND_H)
          }
        }
      }
    }

    drawLanes(fwdLanes, cy)
    cy += FWD_AREA_H

    // --- Backbone ---
    ctx.fillStyle = '#333'
    ctx.fillRect(barLeft, cy, barW, BACKBONE_H)
    cy += BACKBONE_H

    // --- Reverse strand annotations ---
    drawLanes(revLanes, cy)
    cy += REV_AREA_H

    // --- GC content plot ---
    cy += GC_GAP
    if (gcBins.length > 0) {
      const plotTop = cy
      const plotH = GC_PLOT_H

      // 50% reference line
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(barLeft, plotTop + plotH * 0.5)
      ctx.lineTo(barRight, plotTop + plotH * 0.5)
      ctx.stroke()

      // GC trace — filled area
      const numBins = gcBins.length
      ctx.beginPath()
      ctx.moveTo(barLeft, plotTop + plotH) // bottom-left
      for (let b = 0; b < numBins; b++) {
        const x = barLeft + (b / numBins) * barW
        const y = plotTop + plotH * (1 - gcBins[b])
        if (b === 0) ctx.lineTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.lineTo(barRight, plotTop + plotH) // bottom-right
      ctx.closePath()
      ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
      ctx.fill()

      // GC trace — line
      ctx.beginPath()
      for (let b = 0; b < numBins; b++) {
        const x = barLeft + (b / numBins) * barW
        const y = plotTop + plotH * (1 - gcBins[b])
        if (b === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.6)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Label
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.font = '8px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillText('GC%', barLeft + 1, plotTop + 1)
    }
    cy += GC_PLOT_H

    // --- Selection highlight ---
    const annAreaTop = PADDING_Y + RULER_H
    const annAreaH = FWD_AREA_H + BACKBONE_H + REV_AREA_H + GC_GAP + GC_PLOT_H
    const selSegs = selectionSegments(selection, topology, seqLen)
    for (const [s, e] of selSegs) {
      const x1 = bpToX(s)
      const x2 = bpToX(e)
      ctx.fillStyle = accentA(0.35)
      ctx.fillRect(x1, annAreaTop, Math.max(1, x2 - x1), annAreaH)
    }

    // --- Viewport indicator ---
    const vpX = barLeft + scrollFraction * barW
    const vpW = Math.max(3, viewportFraction * barW)

    // Semi-transparent overlay outside viewport
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)'
    if (vpX > barLeft) ctx.fillRect(barLeft, annAreaTop, vpX - barLeft, annAreaH)
    if (vpX + vpW < barRight) ctx.fillRect(vpX + vpW, annAreaTop, barRight - vpX - vpW, annAreaH)

    // Viewport border
    ctx.strokeStyle = accentA(0.7)
    ctx.lineWidth = 1.5
    ctx.strokeRect(vpX, annAreaTop, vpW, annAreaH)
  }, [collapsed, seqLen, topology, doc.metadata?.displayOrigin, fwdLanes, revLanes, selection, scrollFraction, viewportFraction])

  // Draw on mount and when dependencies change
  useEffect(() => {
    draw()
  }, [draw])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // Click / drag handling
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (collapsed) {
      onToggleCollapse()
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const barW = rect.width - LEFT_MARGIN - RIGHT_MARGIN
    const frac = Math.max(0, Math.min(1, (x - LEFT_MARGIN) / barW))

    // Check if clicking on the viewport indicator
    const vpX = LEFT_MARGIN + scrollFraction * barW
    const vpW = Math.max(3, viewportFraction * barW)
    if (x >= vpX && x <= vpX + vpW) {
      // Start dragging the viewport
      dragRef.current = { dragging: true, offsetFrac: frac - scrollFraction }
      canvas.setPointerCapture(e.pointerId)
      return
    }

    // Click outside viewport: jump to position
    const baseFrac = frac - viewportFraction / 2
    onScrollToBase(Math.max(0, Math.min(seqLen - 1, Math.round(baseFrac * seqLen))))
    dragRef.current = { dragging: true, offsetFrac: viewportFraction / 2 }
    canvas.setPointerCapture(e.pointerId)
  }, [collapsed, onToggleCollapse, scrollFraction, viewportFraction, seqLen, onScrollToBase])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.dragging) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const barW = rect.width - LEFT_MARGIN - RIGHT_MARGIN
    const frac = Math.max(0, Math.min(1, (x - LEFT_MARGIN) / barW))
    const targetFrac = frac - dragRef.current.offsetFrac
    onScrollToBase(Math.max(0, Math.min(seqLen - 1, Math.round(targetFrac * seqLen))))
  }, [seqLen, onScrollToBase])

  const handlePointerUp = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  const barHeight = collapsed ? COLLAPSED_H : FULL_H

  return (
    <div
      ref={containerRef}
      className="minimap-bar"
      style={{
        width: '100%',
        height: barHeight,
        position: 'relative',
        borderBottom: '1px solid var(--border, #e0e0e0)',
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'height 0.15s ease',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: collapsed ? 'pointer' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <button
        className="minimap-collapse-btn"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand minimap' : 'Collapse minimap'}
        style={{
          position: 'absolute',
          right: 2,
          top: collapsed ? -2 : 0,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
          color: 'var(--text-muted, #999)',
          opacity: 0.6,
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
    </div>
  )
}
