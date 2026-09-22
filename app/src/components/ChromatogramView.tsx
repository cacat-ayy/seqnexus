import './ChromatogramView.css'
/**
 * Canvas-based Sanger sequencing chromatogram viewer.
 *
 * Renders 4 fluorescence traces (A/C/G/T), called bases at peak positions,
 * per-base Phred quality bars, and draggable trim handles.
 */

import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { useEditorStore, type SequencingRead, applyEdits } from '../store'
import { Plus, WrapText, ArrowRightLeft, ChevronUp, ChevronDown, RotateCcw, Pencil, X, Copy } from 'lucide-react'
import ContextMenuPopup from './ContextMenuPopup'
import { reverseComplement } from '../models/complement'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACE_COLORS: Record<string, string> = {
  A: '#22c55e',
  C: '#3b82f6',
  G: '#666',
  T: '#ef4444',
}

const BASE_LABEL_HEIGHT = 20

const TRACE_TOP_MARGIN = 8
const TRIM_HANDLE_WIDTH = 8

/** Quality → color for quality bars only. */
function qualityColor(q: number): string {
  if (q >= 30) return '#22c55e'
  if (q >= 20) return '#eab308'
  if (q >= 10) return '#f97316'
  return '#ef4444'
}

/** Nucleotide → color matching SequenceView. */
import { baseColor } from '../utils/color'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type LayoutMode = 'horizontal' | 'wrapped'

export interface ChromZoomHandle {
  zoomIn: () => void
  zoomOut: () => void
  /** Current zoom level as a 0–100 percentage for display. */
  zoomPercent: number
  /** Scroll the chromatogram to center on the given base index (0-based). */
  scrollToBase: (baseIdx: number) => void
}

interface Props {
  readId: string
  /** When true, forces horizontal mode (used when multiple reads are stacked). */
  forceHorizontal?: boolean
  /** When true, hides the toolbar for a compact embedded view. */
  compact?: boolean
  /** Mutable ref populated with zoom controls for external toolbar use. */
  zoomRef?: React.MutableRefObject<ChromZoomHandle | null>
  /** Called when zoom level changes (for syncing external UI). */
  onZoomChange?: (pct: number) => void
  /** Externally controlled search open state. */
  externalSearchOpen?: boolean
  /** Called when the chromatogram's search panel is closed. */
  onSearchClose?: () => void
  /** Controlled scroll position (sample space) for synchronized scrolling. */
  syncScrollX?: number
  /** Called when scroll position changes (for synchronized scrolling). */
  onSyncScroll?: (scrollX: number) => void
  /** Controlled zoom level for synchronized zooming. */
  syncZoom?: number
  /** Called when zoom level changes (for synchronized zooming). */
  onSyncZoom?: (zoom: number) => void
  /** Controlled trace visibility for synchronized toggling. */
  syncShowTraces?: { A: boolean; C: boolean; G: boolean; T: boolean }
  /** Controlled quality visibility. */
  syncShowQuality?: boolean
  /** When true, hides trace curves and quality — shows only base labels. */
  hideCurves?: boolean
  /** Called when this read starts a new selection (for clearing other reads). */
  onSelectionStart?: (readId: string) => void
  /** When set, clears this read's selection (incremented by parent to trigger clear). */
  clearSelectionTrigger?: number
  /** Called with a message when a copy action succeeds (for toast display). */
  onCopyFeedback?: (msg: string) => void

}

export default function ChromatogramView({ readId, forceHorizontal, compact, zoomRef, onZoomChange, externalSearchOpen, onSearchClose, syncScrollX, onSyncScroll, syncZoom, onSyncZoom, syncShowTraces, syncShowQuality, hideCurves: hideCurvesProp, onSelectionStart, clearSelectionTrigger, onCopyFeedback }: Props) {
  const read = useEditorStore(s => s.sequencingReads.find(r => r.id === readId)) as SequencingRead | undefined
  const setTrim = useEditorStore(s => s.setSequencingTrim)
  const openDocument = useEditorStore(s => s.openDocument)
  const editBase = useEditorStore(s => s.editSequencingBase)
  const resetEdits = useEditorStore(s => s.resetSequencingEdits)
  const undoSeq = useEditorStore(s => s.undoSequencing)
  const redoSeq = useEditorStore(s => s.redoSequencing)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)

  // Tracks canvas layout changes so visible-range calculations recompute after initial sizing
  const [layoutGeneration, setLayoutGeneration] = useState(0)

  // View state — use synced values when provided (multi-read mode)
  const [localZoom, setLocalZoom] = useState(1)
  const [localScrollX, setLocalScrollX] = useState(0)
  const zoom = syncZoom ?? localZoom
  const scrollX = syncScrollX ?? localScrollX
  // Refs to avoid stale closures in wheel/scroll handlers
  const zoomRef2 = useRef(zoom)
  zoomRef2.current = zoom
  const scrollXRef = useRef(scrollX)
  scrollXRef.current = scrollX
  const onSyncZoomRef = useRef(onSyncZoom)
  onSyncZoomRef.current = onSyncZoom
  const onSyncScrollRef = useRef(onSyncScroll)
  onSyncScrollRef.current = onSyncScroll
  const setZoom = useCallback((v: number | ((prev: number) => number)) => {
    const cur = zoomRef2.current
    const next = typeof v === 'function' ? v(cur) : v
    if (onSyncZoomRef.current) onSyncZoomRef.current(next)
    else setLocalZoom(next)
  }, [])
  const setScrollX = useCallback((v: number | ((prev: number) => number)) => {
    const cur = scrollXRef.current
    const next = typeof v === 'function' ? v(cur) : v
    if (onSyncScrollRef.current) onSyncScrollRef.current(next)
    else setLocalScrollX(next)
  }, [])
  const [localShowTraces, setLocalShowTraces] = useState({ A: true, C: true, G: true, T: true })
  const [localShowQuality, setLocalShowQuality] = useState(true)
  const showTraces = syncShowTraces ?? localShowTraces
  const showQuality = syncShowQuality ?? localShowQuality
  const setShowTraces = setLocalShowTraces
  const setShowQuality = setLocalShowQuality
  const [localHideCurves, setLocalHideCurves] = useState(false)
  const hideCurves = hideCurvesProp ?? localHideCurves
  const [peakScale, setPeakScale] = useState(1) // vertical intensity multiplier (higher = taller peaks)
  const [editing, setEditing] = useState(false)
  const [selectedBase, setSelectedBase] = useState<number | null>(null)
  const [layout, setLayout] = useState<LayoutMode>('horizontal')
  const [qualTooltip, setQualTooltip] = useState<{ x: number; y: number; base: string; quality: number; index: number } | null>(null)
  const effectiveLayout = forceHorizontal ? 'horizontal' : layout

  // Expose zoom controls to parent via ref and notify on changes
  const zoomPct = useMemo(() => {
    return Math.max(0, Math.min(100, Math.round(Math.log(zoom / 0.05) / Math.log(20 / 0.05) * 100)))
  }, [zoom])

  // Stable ref to scrollToBase so the handle can call it without circular deps
  const scrollToBaseRef = useRef<(baseIdx: number) => void>(() => {})

  useEffect(() => {
    if (zoomRef) {
      zoomRef.current = {
        zoomIn: () => setZoom(z => Math.min(20, z * 1.3)),
        zoomOut: () => setZoom(z => Math.max(0.05, z / 1.3)),
        zoomPercent: zoomPct,
        scrollToBase: (baseIdx: number) => scrollToBaseRef.current(baseIdx),
      }
    }
    onZoomChange?.(zoomPct)
  }, [zoomRef, zoom, zoomPct, onZoomChange])

  // Go-to-base (footer – matches sequence view status bar pattern)
  const [footerGotoActive, setFooterGotoActive] = useState(false)
  const [footerGotoValue, setFooterGotoValue] = useState('')
  const footerGotoRef = useRef<HTMLInputElement>(null)

  // Find motif
  const [searchOpenInternal, setSearchOpenInternal] = useState(false)
  const searchOpen = externalSearchOpen || searchOpenInternal
  const setSearchOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    const newVal = typeof v === 'function' ? v(searchOpenInternal) : v
    setSearchOpenInternal(newVal)
    if (!newVal && onSearchClose) onSearchClose()
  }, [searchOpenInternal, onSearchClose])
  // Focus search input when opened externally
  useEffect(() => {
    if (externalSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [externalSearchOpen])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<number[]>([]) // base indices
  const [searchHitIdx, setSearchHitIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Quality stats panel
  const [statsOpen, setStatsOpen] = useState(false)
  const statsAnchorRef = useRef<HTMLSpanElement>(null)
  const statsPopoverRef = useRef<HTMLDivElement>(null)
  const [statsPopoverStyle, setStatsPopoverStyle] = useState<React.CSSProperties>({})

  // Position the stats popover so it doesn't run off-screen
  useEffect(() => {
    if (!statsOpen) return
    const anchor = statsAnchorRef.current
    const popover = statsPopoverRef.current
    if (!anchor || !popover) return

    const anchorRect = anchor.getBoundingClientRect()
    const popW = popover.offsetWidth
    const popH = popover.offsetHeight
    const pad = 8

    // Center horizontally on the anchor, clamp to viewport
    let left = anchorRect.left + anchorRect.width / 2 - popW / 2
    left = Math.max(pad, Math.min(left, window.innerWidth - popW - pad))

    // Place above the anchor; if not enough room, place below
    let top = anchorRect.top - popH - 6
    if (top < pad) top = anchorRect.bottom + 6

    setStatsPopoverStyle({ position: 'fixed', left, top, zIndex: 60 })
  }, [statsOpen])

  // Quality threshold line
  const [qualThreshold, setQualThreshold] = useState(20) // Q20 default

  // Mixed base detection
  const [showMixedBases, setShowMixedBases] = useState(true)

  // Base selection range (independent of edit cursor)
  const [selRange, setSelRange] = useState<{ start: number; end: number } | null>(null)

  // Clear selection when parent signals (another read started selecting)
  const prevClearTrigger = useRef(clearSelectionTrigger ?? 0)
  useEffect(() => {
    if (clearSelectionTrigger !== undefined && clearSelectionTrigger !== prevClearTrigger.current) {
      prevClearTrigger.current = clearSelectionTrigger
      setSelRange(null)
      setSelectedBase(null)
    }
  }, [clearSelectionTrigger])

  const selAnchorRef = useRef<number | null>(null)
  const selDragging = useRef(false)
  const selResizing = useRef<'start' | 'end' | null>(null)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!ctxMenu) return
    const dismiss = () => setCtxMenu(null)
    window.addEventListener('mousedown', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => { window.removeEventListener('mousedown', dismiss); window.removeEventListener('scroll', dismiss, true) }
  }, [ctxMenu])

  // Trim drag state
  const trimDragRef = useRef<{ side: 'left' | 'right'; startX: number; startVal: number } | null>(null)

  // Scrollbar drag state
  const scrollDragRef = useRef<{ startX: number; startScroll: number } | null>(null)
  const [scrollDragging, setScrollDragging] = useState(false)

  // Minimap drag state
  const minimapDragRef = useRef<{ dragging: boolean; offsetFrac: number }>({ dragging: false, offsetFrac: 0 })

  const data = read?.data
  const trimStart = read?.trimStart ?? 0
  const trimEnd = read?.trimEnd ?? (data?.bases.length ?? 0)
  const edits = read?.edits ?? []

  // Compute edited bases and per-position edit type map
  const { editedBases, editMap } = useMemo(() => {
    if (!data) return { editedBases: '', editMap: [] as Array<'original' | 'substitute' | 'insert' | 'delete'> }
    const result = applyEdits(data.bases, edits)
    return { editedBases: result.bases, editMap: result.editMap }
  }, [data, edits])

  // Trace length (max across all channels)
  const traceLength = useMemo(() => {
    if (!data) return 0
    return Math.max(data.traces.A.length, data.traces.C.length, data.traces.G.length, data.traces.T.length)
  }, [data])

  // Compute insert gaps: sorted list of { samplePos, count } for trace shifting
  const insertGaps = useMemo(() => {
    if (!data || edits.length === 0) return []
    const gapsByPos = new Map<number, number>()
    for (const e of edits) {
      if (e.type === 'insert') {
        gapsByPos.set(e.pos, (gapsByPos.get(e.pos) || 0) + 1)
      }
    }
    // Convert base positions to sample positions and sort
    const gaps: { samplePos: number; count: number }[] = []
    for (const [pos, count] of gapsByPos) {
      const samplePos = pos < data.peakLocations.length ? data.peakLocations[pos] : traceLength
      gaps.push({ samplePos, count })
    }
    gaps.sort((a, b) => a.samplePos - b.samplePos)
    return gaps
  }, [data, edits, traceLength])

  // Average sample spacing between bases (used for insert gap width)
  const avgBaseSpacing = useMemo(() => {
    if (!data || data.peakLocations.length < 2) return 15
    const total = data.peakLocations[data.peakLocations.length - 1] - data.peakLocations[0]
    return total / (data.peakLocations.length - 1)
  }, [data])

  // Piecewise linear mapping: sample position → absolute grid pixel position
  // Maps peak[i] to (i + 0.5) * cellWidth, interpolating between peaks
  const sampleToGrid = useCallback((s: number, cellW: number): number => {
    if (!data) return 0
    const peaks = data.peakLocations
    if (peaks.length < 2) return 0.5 * cellW
    if (s <= peaks[0]) {
      const sp = peaks[1] - peaks[0]
      return (0.5 - (peaks[0] - s) / sp) * cellW
    }
    if (s >= peaks[peaks.length - 1]) {
      const sp = peaks[peaks.length - 1] - peaks[peaks.length - 2]
      return (peaks.length - 1 + 0.5 + (s - peaks[peaks.length - 1]) / sp) * cellW
    }
    let lo = 0, hi = peaks.length - 2
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (peaks[mid + 1] < s) lo = mid + 1
      else hi = mid
    }
    const frac = (s - peaks[lo]) / (peaks[lo + 1] - peaks[lo])
    return (lo + 0.5 + frac) * cellW
  }, [data])

  // Total number of inserted bases (for effective trace length)
  const totalInsertCount = useMemo(() => {
    return insertGaps.reduce((sum, g) => sum + g.count, 0)
  }, [insertGaps])

  // Effective trace length including insert gap space (in sample units)
  const effectiveTraceLength = traceLength + totalInsertCount * avgBaseSpacing

  // Visible range in trace sample points
  const getVisibleRange = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return { start: 0, end: 0, width: 0 }
    const width = canvas.clientWidth
    const visibleSamples = width / zoom
    const start = Math.max(0, scrollX)
    const end = Math.min(traceLength, start + visibleSamples)
    return { start, end, width }
  }, [scrollX, zoom, traceLength])

  // Mixed base detection – find positions where secondary peak > 50% of primary
  const mixedBases = useMemo(() => {
    if (!data || !showMixedBases) return new Set<number>()
    const set = new Set<number>()
    const channels = ['A', 'C', 'G', 'T'] as const
    for (let i = 0; i < data.peakLocations.length; i++) {
      const peakX = data.peakLocations[i]
      const calledBase = data.bases[i]?.toUpperCase()
      if (!calledBase || calledBase === 'N') continue
      // Get trace values at peak position for all channels
      const vals = channels.map(ch => data.traces[ch][peakX] ?? 0)
      const calledIdx = channels.indexOf(calledBase as typeof channels[number])
      if (calledIdx < 0) continue
      const primary = vals[calledIdx]
      if (primary < 50) continue // too low to be meaningful
      // Check if any other channel exceeds 50% of primary
      for (let j = 0; j < 4; j++) {
        if (j !== calledIdx && vals[j] > primary * 0.5) {
          set.add(i)
          break
        }
      }
    }
    return set
  }, [data, showMixedBases])

  // Quality statistics
  const qualStats = useMemo(() => {
    if (!data) return null
    const scores = data.qualityScores.slice(trimStart, trimEnd)
    if (scores.length === 0) return null
    const total = scores.reduce((a, b) => a + b, 0)
    const avg = total / scores.length
    const q20 = scores.filter(q => q >= 20).length
    const q30 = scores.filter(q => q >= 30).length
    const sorted = [...scores].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    return {
      count: scores.length,
      avg: avg.toFixed(1),
      median,
      min,
      max,
      q20pct: ((q20 / scores.length) * 100).toFixed(1),
      q30pct: ((q30 / scores.length) * 100).toFixed(1),
      nCount: data.bases.slice(trimStart, trimEnd).split('').filter(b => b.toUpperCase() === 'N').length,
      mixedCount: [...mixedBases].filter(i => i >= trimStart && i < trimEnd).length,
    }
  }, [data, trimStart, trimEnd, mixedBases])

  // Search effect
  useEffect(() => {
    if (!data || !searchQuery.trim()) { setSearchHits([]); return }
    const q = searchQuery.toUpperCase()
    const bases = editedBases.toUpperCase()
    const hits: number[] = []
    let idx = bases.indexOf(q)
    while (idx !== -1) {
      hits.push(idx)
      idx = bases.indexOf(q, idx + 1)
    }
    setSearchHits(hits)
    setSearchHitIdx(0)
  }, [searchQuery, editedBases, data])

  // Clamp scroll
  const clampScroll = useCallback((s: number) => {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const visibleSamples = canvas.clientWidth / zoom
    return Math.max(0, Math.min(s, effectiveTraceLength - visibleSamples))
  }, [zoom, effectiveTraceLength])

  // Jump to a base index by scrolling
  const scrollToBase = useCallback((baseIdx: number) => {
    if (!data || baseIdx < 0 || baseIdx >= data.peakLocations.length) return
    if (effectiveLayout === 'wrapped') {
      const row = Math.floor(baseIdx / BASES_PER_ROW)
      const container = containerRef.current
      if (container) {
        const targetY = row * ROW_HEIGHT
        container.scrollTo({ top: targetY, behavior: 'smooth' })
      }
    } else {
      const peakX = data.peakLocations[baseIdx]
      const canvas = canvasRef.current
      if (!canvas) return
      const visibleSamples = canvas.clientWidth / zoom
      setScrollX(clampScroll(peakX - visibleSamples / 2))
    }
    setSelectedBase(baseIdx)
  }, [data, zoom, clampScroll, effectiveLayout])

  // Scroll to center a base without changing selection (used by minimap drag)
  const scrollToBaseNoSelect = useCallback((baseIdx: number) => {
    if (!data || baseIdx < 0 || baseIdx >= data.peakLocations.length) return
    if (effectiveLayout === 'wrapped') {
      const row = Math.floor(baseIdx / BASES_PER_ROW)
      const container = containerRef.current
      if (container) {
        container.scrollTop = row * ROW_HEIGHT
      }
    } else {
      const peakX = data.peakLocations[baseIdx]
      const canvas = canvasRef.current
      if (!canvas) return
      const visibleSamples = canvas.clientWidth / zoom
      setScrollX(clampScroll(peakX - visibleSamples / 2))
    }
  }, [data, zoom, clampScroll, effectiveLayout])

  // Keep stable ref in sync
  scrollToBaseRef.current = scrollToBase

  const jumpToSearchHit = useCallback((idx: number) => {
    if (searchHits.length === 0) return
    const clamped = ((idx % searchHits.length) + searchHits.length) % searchHits.length
    setSearchHitIdx(clamped)
    scrollToBase(searchHits[clamped])
  }, [searchHits, scrollToBase])

  // ---- Wrapped-mode coordinate helpers ----
  const BASES_PER_ROW = 80
  const ROW_HEIGHT = 130
  const WRAPPED_MARGIN = 30 // left margin for position label

  /** Given canvas-local (mx, my), return the nearest base index in wrapped mode. */
  const wrappedMouseToBase = useCallback((mx: number, my: number, canvasWidth: number): number => {
    if (!data) return 0
    const row = Math.max(0, Math.floor(my / ROW_HEIGHT))
    const baseStart = row * BASES_PER_ROW
    const baseEnd = Math.min(baseStart + BASES_PER_ROW, data.bases.length)
    if (baseStart >= data.bases.length) return data.bases.length - 1

    const rowBaseCount = baseEnd - baseStart
    const traceWidth = canvasWidth - WRAPPED_MARGIN - 4
    const cellWidth = traceWidth / rowBaseCount
    const baseIdx = baseStart + Math.floor((mx - WRAPPED_MARGIN) / cellWidth)
    return Math.max(baseStart, Math.min(baseEnd - 1, baseIdx))
  }, [data])

  /** Get the canvas X position and row Y for a given base index in wrapped mode. */
  const wrappedBaseToXY = useCallback((baseIdx: number, canvasWidth: number): { x: number, rowY: number } => {
    if (!data) return { x: 0, rowY: 0 }
    const row = Math.floor(baseIdx / BASES_PER_ROW)
    const rowY = row * ROW_HEIGHT
    const baseStart = row * BASES_PER_ROW
    const baseEnd = Math.min(baseStart + BASES_PER_ROW, data.bases.length)
    const rowBaseCount = baseEnd - baseStart
    const traceWidth = canvasWidth - WRAPPED_MARGIN - 4
    const cellWidth = traceWidth / rowBaseCount
    const x = WRAPPED_MARGIN + (baseIdx - baseStart + 0.5) * cellWidth
    return { x, rowY }
  }, [data])

  // ---- Drawing ----
  // Refs for draw functions so `draw` always calls the latest version
  const drawHorizontalRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>(() => {})
  const drawWrappedRef = useRef<(ctx: CanvasRenderingContext2D, w: number, h: number) => void>(() => {})

  // ---- Horizontal (scrollable) draw ----
  const drawHorizontal = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    if (!data) return
    const canvas = canvasRef.current
    const cs = canvas ? getComputedStyle(canvas) : null
    const accentColor = cs?.getPropertyValue('--accent').trim() || '#6366f1'
    // Detect dark mode from background luminance for quality mountain opacity
    const bgHex = cs?.getPropertyValue('--bg').trim() || '#f0f2f5'
    const bgR = parseInt(bgHex.slice(1, 3), 16) || 200
    const isDark = bgR < 128
    const qMountainFillAlpha = isDark ? 0.25 : 0.15
    const qMountainStrokeAlpha = isDark ? 0.45 : 0.3
    const { start } = getVisibleRange()
    const traceTop = hideCurves ? 0 : TRACE_TOP_MARGIN
    const traceHeight = hideCurves ? 0 : height - traceTop - BASE_LABEL_HEIGHT - 4
    const baseLabelY = hideCurves ? 2 : traceTop + traceHeight + 2

    if (!hideCurves && traceHeight <= 0) return

    // Uniform grid: each base gets a fixed-width cell
    const cellWidth = avgBaseSpacing * zoom

    // Convert scrollX (sample space) to pixel offset using piecewise linear mapping
    const scrollPx = sampleToGrid(start, cellWidth)

    // Compute visible sample range from grid positions
    const peaks = data.peakLocations
    const visFirstBase = Math.max(0, Math.floor(scrollPx / cellWidth) - 2)
    const visLastBase = Math.min(data.bases.length - 1, Math.ceil((scrollPx + width) / cellWidth) + 2)
    const visSampleStart = Math.max(0, visFirstBase > 0 && visFirstBase < peaks.length ? peaks[visFirstBase] - Math.ceil(avgBaseSpacing) : 0)
    const visSampleEnd = Math.min(traceLength, visLastBase < peaks.length ? peaks[visLastBase] + Math.ceil(avgBaseSpacing) + 1 : traceLength)

    // Compute Y scale from visible trace data
    let maxIntensity = 100
    for (const base of ['A', 'C', 'G', 'T'] as const) {
      if (!showTraces[base]) continue
      const trace = data.traces[base]
      for (let i = visSampleStart; i < Math.min(visSampleEnd, trace.length); i++) {
        if (trace[i] > maxIntensity) maxIntensity = trace[i]
      }
    }
    maxIntensity *= 1.1
    const scaledMax = maxIntensity / peakScale
    // Grid position helpers (base index → canvas X)
    const baseToX = (i: number) => (i + 0.5) * cellWidth - scrollPx
    const baseLX = (i: number) => i * cellWidth - scrollPx
    const baseRX = (i: number) => (i + 1) * cellWidth - scrollPx

    // Piecewise linear mapping: sample → canvas X
    const sampleToX = (s: number) => sampleToGrid(s, cellWidth) - scrollPx

    // Insert gap helpers (for gap indicators)
    const gapSize = cellWidth

    const intensityToY = (v: number) => traceTop + traceHeight - (v / scaledMax) * traceHeight

    if (!hideCurves) {
    // Trim overlays
    if (trimStart > 0) {
      const x = baseLX(trimStart)
      if (x > 0) {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'
        ctx.fillRect(0, 0, Math.min(x, width), height)
      }
    }
    if (trimEnd < data.bases.length) {
      const x = baseLX(trimEnd)
      if (x < width) {
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'
        ctx.fillRect(Math.max(0, x), 0, width - Math.max(0, x), height)
      }
    }

    // Quality mountain underlay (drawn in trace area, behind everything)
    if (showQuality) {
      const viFirst = Math.max(0, Math.floor(scrollPx / cellWidth) - 1)
      const viLast = Math.min(data.bases.length - 1, Math.ceil((scrollPx + width) / cellWidth) + 1)
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, traceTop, width, traceHeight)
      ctx.clip()
      // Build mountain path
      ctx.beginPath()
      ctx.moveTo(baseLX(viFirst), traceTop + traceHeight)
      for (let i = viFirst; i <= viLast; i++) {
        const cx = baseToX(i)
        const q = data.qualityScores[i] ?? 0
        const qH = Math.min(q / 60, 1) * traceHeight
        ctx.lineTo(cx, traceTop + traceHeight - qH)
      }
      ctx.lineTo(baseRX(viLast), traceTop + traceHeight)
      ctx.closePath()
      // Fill
      ctx.fillStyle = accentColor
      ctx.globalAlpha = qMountainFillAlpha
      ctx.fill()
      // Outline
      ctx.strokeStyle = accentColor
      ctx.globalAlpha = qMountainStrokeAlpha
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1
      // Quality threshold line
      const threshH = Math.min(qualThreshold / 60, 1) * traceHeight
      const threshY = traceTop + traceHeight - threshH
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(0, threshY)
      ctx.lineTo(width, threshY)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.fillStyle = '#ef4444'
      ctx.font = '8px Inter, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`Q${qualThreshold}`, 2, threshY - 1)
      ctx.restore()
    }

    // Selection highlight
    if (selRange) {
      const x1 = baseLX(selRange.start)
      const x2 = baseRX(selRange.end - 1)
      if (x2 > 0 && x1 < width) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
        ctx.fillRect(Math.max(0, x1), 0, Math.min(x2, width) - Math.max(0, x1), height)

        // Selection boundary handles
        const handleW = 3, handleH = 18
        for (const bx of [x1, x2]) {
          if (bx >= -1 && bx <= width + 1) {
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 1.5
            ctx.globalAlpha = 0.5
            ctx.beginPath()
            ctx.moveTo(bx, 0)
            ctx.lineTo(bx, height)
            ctx.stroke()
            ctx.globalAlpha = 0.8
            ctx.fillStyle = accentColor
            const hy = height / 2 - handleH / 2
            ctx.beginPath()
            ctx.roundRect(bx - handleW / 2, hy, handleW, handleH, 1.5)
            ctx.fill()
          }
        }
        ctx.globalAlpha = 1
      }
    }
    } // end if (!hideCurves)

    // Base labels (using uniform grid)
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const editsByPos = new Map<number, typeof edits>()
    for (const e of edits) {
      const arr = editsByPos.get(e.pos) || []
      arr.push(e)
      editsByPos.set(e.pos, arr)
    }
    for (let i = 0; i < data.bases.length; i++) {
      const cx = baseToX(i)
      const lx = baseLX(i)
      const cw = cellWidth
      if (cx < -cw || cx > width + cw) continue

      const posEdits = editsByPos.get(i)
      const del = posEdits?.find(e => e.type === 'delete')
      const sub = posEdits?.find(e => e.type === 'substitute')
      const inserts = (posEdits?.filter(e => e.type === 'insert') ?? [])
        .sort((a, b) => (a as any).offset - (b as any).offset)

      // Inserted bases before this position
      if (inserts.length > 0) {
        for (let j = 0; j < inserts.length; j++) {
          const ins = inserts[j]
          const ix = lx - (inserts.length - j) * (cw * 0.5)
          if (ix >= -10 && ix <= width + 10) {
            ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
            ctx.fillRect(ix - cw * 0.25, baseLabelY, cw * 0.5, BASE_LABEL_HEIGHT)
            ctx.fillStyle = '#16a34a'
            ctx.fillText(ins.base, ix, baseLabelY + BASE_LABEL_HEIGHT / 2)
            ctx.fillRect(ix - cw * 0.25, baseLabelY, cw * 0.5, 2)
          }
        }
      }

      // Caret (non-edit mode) or highlight (edit mode)
      if (selectedBase === i) {
        if (editing) {
          ctx.fillStyle = accentColor
          ctx.globalAlpha = 0.15
          ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
          ctx.globalAlpha = 1
          ctx.strokeStyle = accentColor
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(lx, baseLabelY)
          ctx.lineTo(lx, baseLabelY + BASE_LABEL_HEIGHT)
          ctx.stroke()
        } else {
          ctx.strokeStyle = accentColor
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(lx, baseLabelY)
          ctx.lineTo(lx, baseLabelY + BASE_LABEL_HEIGHT)
          ctx.stroke()
        }
      }

      if (del) {
        ctx.globalAlpha = 0.3
        ctx.fillStyle = baseColor(data.bases[i])
        ctx.fillText(data.bases[i], cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(cx - 5, baseLabelY + BASE_LABEL_HEIGHT / 2)
        ctx.lineTo(cx + 5, baseLabelY + BASE_LABEL_HEIGHT / 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
        ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(lx, baseLabelY, cw, 2)
      } else if (sub) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.12)'
        ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(lx, baseLabelY, cw, 2)
        ctx.fillStyle = baseColor(sub.base)
        ctx.fillText(sub.base, cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
      } else {
        const b = data.bases[i]
        if (b.toUpperCase() === 'N') {
          ctx.fillStyle = 'rgba(239, 68, 68, 0.12)'
          ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
          ctx.fillStyle = '#ef4444'
          ctx.font = 'bold 11px monospace'
          ctx.fillText('N', cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
        } else {
          ctx.fillStyle = baseColor(b)
          ctx.fillText(b, cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
        }
      }

      // Mixed base marker
      if (mixedBases.has(i)) {
        ctx.fillStyle = '#f59e0b'
        ctx.beginPath()
        const dy = baseLabelY + BASE_LABEL_HEIGHT - 2
        ctx.moveTo(cx, dy - 3)
        ctx.lineTo(cx + 3, dy)
        ctx.lineTo(cx, dy + 3)
        ctx.lineTo(cx - 3, dy)
        ctx.closePath()
        ctx.fill()
      }

      // Search hit highlighting
      if (searchHits.length > 0) {
        const qLen = searchQuery.length
        for (let h = 0; h < searchHits.length; h++) {
          if (i >= searchHits[h] && i < searchHits[h] + qLen) {
            const isActive = h === searchHitIdx
            ctx.fillStyle = isActive ? 'rgba(251, 191, 36, 0.4)' : 'rgba(251, 191, 36, 0.2)'
            ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
            if (isActive) {
              ctx.strokeStyle = '#f59e0b'
              ctx.lineWidth = 1.5
              ctx.strokeRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
            }
            break
          }
        }
      }
    }

    // Separator
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, traceTop - 2)
    ctx.lineTo(width, traceTop - 2)
    ctx.stroke()

    // Build a set of sample positions where insert gaps occur for trace breaking
    const gapSampleSet = new Set(insertGaps.map(g => g.samplePos))

    // Traces - clip to trace area so scaled peaks don't overflow
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, traceTop, width, traceHeight)
    ctx.clip()

    // Draw subtle gap indicators for insert regions
    for (const gap of insertGaps) {
      const gapX = sampleToX(gap.samplePos)
      const gapW = gap.count * gapSize
      ctx.fillStyle = 'rgba(34, 197, 94, 0.06)'
      ctx.fillRect(gapX - gapW, traceTop, gapW, traceHeight)
    }

    for (const base of ['A', 'C', 'G', 'T'] as const) {
      if (!showTraces[base]) continue
      const trace = data.traces[base]
      if (trace.length === 0) continue
      ctx.strokeStyle = TRACE_COLORS[base]
      ctx.lineWidth = 1.2
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      const iStart = visSampleStart
      const iEnd = Math.min(trace.length, visSampleEnd)
      let first = true
      // Sequential scan optimization: track current peak interval to avoid binary search per sample
      let curPeakIdx = 0
      const pks = data.peakLocations
      const nPeaks = pks.length
      if (nPeaks >= 2) {
        // Advance to the interval containing iStart
        while (curPeakIdx < nPeaks - 2 && pks[curPeakIdx + 1] < iStart) curPeakIdx++
      }
      for (let i = iStart; i < iEnd; i++) {
        if (gapSampleSet.has(i) && !first) {
          ctx.stroke()
          ctx.beginPath()
          first = true
        }
        // Inline piecewise linear mapping (sequential, no binary search)
        let x: number
        if (nPeaks < 2) {
          x = 0.5 * cellWidth - scrollPx
        } else if (i <= pks[0]) {
          const sp = pks[1] - pks[0]
          x = (0.5 - (pks[0] - i) / sp) * cellWidth - scrollPx
        } else if (i >= pks[nPeaks - 1]) {
          const sp = pks[nPeaks - 1] - pks[nPeaks - 2]
          x = (nPeaks - 1 + 0.5 + (i - pks[nPeaks - 1]) / sp) * cellWidth - scrollPx
        } else {
          // Advance interval pointer
          while (curPeakIdx < nPeaks - 2 && pks[curPeakIdx + 1] < i) curPeakIdx++
          const frac = (i - pks[curPeakIdx]) / (pks[curPeakIdx + 1] - pks[curPeakIdx])
          x = (curPeakIdx + 0.5 + frac) * cellWidth - scrollPx
        }
        const y = intensityToY(trace[i])
        if (first) { ctx.moveTo(x, y); first = false }
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.restore()

    // Trim handles
    const drawTrimHandle = (baseIdx: number, side: 'left' | 'right') => {
      const x = side === 'left' ? baseLX(baseIdx) : baseRX(baseIdx - 1)
      if (x < -TRIM_HANDLE_WIDTH || x > width + TRIM_HANDLE_WIDTH) return
      ctx.strokeStyle = accentColor
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 2
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 0.85
      ctx.fillStyle = accentColor
      const hw = TRIM_HANDLE_WIDTH
      const hh = 24
      const hy = traceTop + traceHeight / 2 - hh / 2
      const hx = x - hw / 2
      ctx.beginPath()
      ctx.roundRect(hx, hy, hw, hh, 3)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1
      for (let dy = -4; dy <= 4; dy += 4) {
        ctx.beginPath()
        ctx.moveTo(hx + 2, hy + hh / 2 + dy)
        ctx.lineTo(hx + hw - 2, hy + hh / 2 + dy)
        ctx.stroke()
      }
    }
    drawTrimHandle(trimStart, 'left')
    drawTrimHandle(trimEnd, 'right')

    // Position ruler
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.font = '9px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    for (let i = 0; i < data.bases.length; i += 50) {
      const cx = baseToX(i)
      if (cx < -20 || cx > width + 20) continue
      ctx.fillText(String(i + 1), cx, height - 2)
    }
  }, [data, zoom, getVisibleRange, showTraces, showQuality, trimStart, trimEnd, traceLength, peakScale, edits, editing, selectedBase, insertGaps, avgBaseSpacing, qualThreshold, mixedBases, searchHits, searchHitIdx, searchQuery, selRange, hideCurves, sampleToGrid])

  // ---- Wrapped (stacked rows) draw ----
  const drawWrapped = useCallback((ctx: CanvasRenderingContext2D, width: number, _height: number) => {
    if (!data) return

    const numBases = data.bases.length
    const numRows = Math.ceil(numBases / BASES_PER_ROW)
    const rowTraceH = ROW_HEIGHT - BASE_LABEL_HEIGHT - TRACE_TOP_MARGIN - 14

    // Compute global max intensity for consistent Y scaling
    let maxIntensity = 100
    for (const base of ['A', 'C', 'G', 'T'] as const) {
      if (!showTraces[base]) continue
      for (const v of data.traces[base]) {
        if (v > maxIntensity) maxIntensity = v
      }
    }
    maxIntensity *= 1.1
    const scaledMax = maxIntensity / peakScale
    const wcs = getComputedStyle(canvasRef.current!)
    const accentColor = wcs.getPropertyValue('--accent').trim() || '#6366f1'
    const wBgHex = wcs.getPropertyValue('--bg').trim() || '#f0f2f5'
    const wBgR = parseInt(wBgHex.slice(1, 3), 16) || 200
    const wIsDark = wBgR < 128
    const qMountainFillAlpha = wIsDark ? 0.25 : 0.15
    const qMountainStrokeAlpha = wIsDark ? 0.45 : 0.3

    // Build edit lookup for wrapped mode
    const wrappedEditsByPos = new Map<number, typeof edits>()
    for (const e of edits) {
      const arr = wrappedEditsByPos.get(e.pos) || []
      arr.push(e)
      wrappedEditsByPos.set(e.pos, arr)
    }

    for (let row = 0; row < numRows; row++) {
      const baseStart = row * BASES_PER_ROW
      const baseEnd = Math.min(baseStart + BASES_PER_ROW, numBases)
      const rowY = row * ROW_HEIGHT

      // Trace sample range for this row
      const sampleStart = baseStart < data.peakLocations.length ? data.peakLocations[baseStart] : 0
      const sampleEnd = baseEnd < data.peakLocations.length
        ? data.peakLocations[baseEnd - 1] + 20
        : traceLength
      const sampleSpan = sampleEnd - sampleStart
      if (sampleSpan <= 0) continue

      const margin = 30 // left margin for position label
      const traceWidth = width - margin - 4
      const rowBaseCount = baseEnd - baseStart
      const cellWidth = traceWidth / rowBaseCount

      // Uniform grid helpers
      const baseToX = (i: number) => margin + (i - baseStart + 0.5) * cellWidth
      const baseLX = (i: number) => margin + (i - baseStart) * cellWidth
      const baseRX = (i: number) => margin + (i - baseStart + 1) * cellWidth

      // Piecewise linear mapping: sample → canvas X (stretches traces to align peaks to grid)
      const peaks = data.peakLocations
      const sToX = (s: number) => {
        if (rowBaseCount <= 1) return baseToX(baseStart)
        if (s <= peaks[baseStart]) {
          const dist = peaks[baseStart] - s
          const sp = baseStart > 0 ? peaks[baseStart] - peaks[baseStart - 1] : avgBaseSpacing
          return baseToX(baseStart) - (dist / sp) * cellWidth
        }
        if (s >= peaks[baseEnd - 1]) {
          const dist = s - peaks[baseEnd - 1]
          const sp = baseEnd < peaks.length ? peaks[baseEnd] - peaks[baseEnd - 1] : avgBaseSpacing
          return baseToX(baseEnd - 1) + (dist / sp) * cellWidth
        }
        for (let j = baseStart; j < baseEnd - 1; j++) {
          if (s >= peaks[j] && s <= peaks[j + 1]) {
            const frac = (s - peaks[j]) / (peaks[j + 1] - peaks[j])
            return baseToX(j) + frac * cellWidth
          }
        }
        return baseToX(baseStart)
      }

      // Collect insert gaps for this row
      const rowGaps: { samplePos: number; count: number }[] = []
      for (const gap of insertGaps) {
        if (gap.samplePos >= sampleStart && gap.samplePos <= sampleEnd) {
          rowGaps.push(gap)
        }
      }

      // Layout: traces (with quality underlay) → baseLabels (top to bottom)
      const traceTop = rowY + TRACE_TOP_MARGIN
      const baseLabelY = traceTop + rowTraceH + 2
      const intensityToY = (v: number) => traceTop + rowTraceH - (v / scaledMax) * rowTraceH

      // Row separator
      if (row > 0) {
        ctx.strokeStyle = 'rgba(0,0,0,0.06)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, rowY)
        ctx.lineTo(width, rowY)
        ctx.stroke()
      }

      // Position label (left of base row)
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.font = '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(baseStart + 1), 2, baseLabelY + BASE_LABEL_HEIGHT / 2 + 1)

      // Trim overlays
      if (trimStart > baseStart) {
        const trimBaseInRow = Math.min(trimStart, baseEnd)
        const x = baseLX(trimBaseInRow)
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'
        ctx.fillRect(margin, rowY, Math.min(x - margin, traceWidth), ROW_HEIGHT)
      }
      if (trimEnd < baseEnd) {
        const trimBaseInRow = Math.max(trimEnd, baseStart)
        const x = baseLX(trimBaseInRow)
        ctx.fillStyle = 'rgba(128, 128, 128, 0.15)'
        ctx.fillRect(Math.max(margin, x), rowY, width - Math.max(margin, x), ROW_HEIGHT)
      }

      // Quality mountain underlay (drawn in trace area, behind everything else)
      if (showQuality) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(margin, traceTop, traceWidth, rowTraceH)
        ctx.clip()
        // Build mountain path
        ctx.beginPath()
        ctx.moveTo(baseLX(baseStart), traceTop + rowTraceH)
        for (let i = baseStart; i < baseEnd; i++) {
          const cx = baseToX(i)
          const q = data.qualityScores[i] ?? 0
          const qH = Math.min(q / 60, 1) * rowTraceH
          ctx.lineTo(cx, traceTop + rowTraceH - qH)
        }
        ctx.lineTo(baseRX(baseEnd - 1), traceTop + rowTraceH)
        ctx.closePath()
        // Fill
        ctx.fillStyle = accentColor
        ctx.globalAlpha = qMountainFillAlpha
        ctx.fill()
        // Outline
        ctx.strokeStyle = accentColor
        ctx.globalAlpha = qMountainStrokeAlpha
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = 1
        // Quality threshold line
        const threshH = Math.min(qualThreshold / 60, 1) * rowTraceH
        const threshY = traceTop + rowTraceH - threshH
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(margin, threshY)
        ctx.lineTo(width, threshY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        ctx.restore()
      }

      // Selection highlight — continuous rectangle
      if (selRange) {
        const selLo = Math.max(selRange.start, baseStart)
        const selHi = Math.min(selRange.end, baseEnd)
        if (selLo < selHi) {
          const x1 = baseLX(selLo)
          const x2 = baseRX(selHi - 1)
          ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
          ctx.fillRect(x1, rowY, x2 - x1, ROW_HEIGHT)

          // Selection boundary handles
          const handleW = 3, handleH = 18
          if (selRange.start >= baseStart && selRange.start < baseEnd) {
            const bx = baseLX(selRange.start)
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 1.5
            ctx.globalAlpha = 0.5
            ctx.beginPath()
            ctx.moveTo(bx, rowY)
            ctx.lineTo(bx, rowY + ROW_HEIGHT)
            ctx.stroke()
            ctx.globalAlpha = 0.8
            ctx.fillStyle = accentColor
            const hy = rowY + ROW_HEIGHT / 2 - handleH / 2
            ctx.beginPath()
            ctx.roundRect(bx - handleW / 2, hy, handleW, handleH, 1.5)
            ctx.fill()
            ctx.globalAlpha = 1
          }
          if (selRange.end > baseStart && selRange.end <= baseEnd) {
            const bx = baseRX(selRange.end - 1)
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 1.5
            ctx.globalAlpha = 0.5
            ctx.beginPath()
            ctx.moveTo(bx, rowY)
            ctx.lineTo(bx, rowY + ROW_HEIGHT)
            ctx.stroke()
            ctx.globalAlpha = 0.8
            ctx.fillStyle = accentColor
            const hy = rowY + ROW_HEIGHT / 2 - handleH / 2
            ctx.beginPath()
            ctx.roundRect(bx - handleW / 2, hy, handleW, handleH, 1.5)
            ctx.fill()
            ctx.globalAlpha = 1
          }
        }
      }

      // Base labels (with edit markers) — using uniform grid
      ctx.font = 'bold 11px monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = baseStart; i < baseEnd; i++) {
        const cx = baseToX(i)
        const lx = baseLX(i)
        const cw = cellWidth

        const posEdits = wrappedEditsByPos.get(i)
        const del = posEdits?.find(e => e.type === 'delete')
        const sub = posEdits?.find(e => e.type === 'substitute')
        const inserts = (posEdits?.filter(e => e.type === 'insert') ?? [])
          .sort((a, b) => (a as any).offset - (b as any).offset)

        // Inserted bases before this position
        if (inserts.length > 0) {
          for (let j = 0; j < inserts.length; j++) {
            const ins = inserts[j]
            const ix = lx - (inserts.length - j) * (cw * 0.5)
            ctx.fillStyle = 'rgba(34, 197, 94, 0.15)'
            ctx.fillRect(ix - cw * 0.25, baseLabelY, cw * 0.5, BASE_LABEL_HEIGHT)
            ctx.fillStyle = '#16a34a'
            ctx.fillText(ins.base, ix, baseLabelY + BASE_LABEL_HEIGHT / 2)
            ctx.fillRect(ix - cw * 0.25, baseLabelY, cw * 0.5, 2)
          }
        }

        // Caret (non-edit mode) or highlight (edit mode)
        if (selectedBase === i) {
          if (editing) {
            ctx.fillStyle = accentColor
            ctx.globalAlpha = 0.15
            ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
            ctx.globalAlpha = 1
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(lx, baseLabelY)
            ctx.lineTo(lx, baseLabelY + BASE_LABEL_HEIGHT)
            ctx.stroke()
          } else {
            // Thin caret line
            ctx.strokeStyle = accentColor
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(lx, baseLabelY)
            ctx.lineTo(lx, baseLabelY + BASE_LABEL_HEIGHT)
            ctx.stroke()
          }
        }

        if (del) {
          ctx.globalAlpha = 0.3
          ctx.fillStyle = baseColor(data.bases[i])
          ctx.fillText(data.bases[i], cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
          ctx.globalAlpha = 1
          ctx.strokeStyle = '#ef4444'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(cx - 5, baseLabelY + BASE_LABEL_HEIGHT / 2)
          ctx.lineTo(cx + 5, baseLabelY + BASE_LABEL_HEIGHT / 2)
          ctx.stroke()
          ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
          ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
          ctx.fillStyle = '#ef4444'
          ctx.fillRect(lx, baseLabelY, cw, 2)
        } else if (sub) {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.12)'
          ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
          ctx.fillStyle = '#2563eb'
          ctx.fillRect(lx, baseLabelY, cw, 2)
          ctx.fillStyle = baseColor(sub.base)
          ctx.fillText(sub.base, cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
        } else {
          const b = data.bases[i]
          if (b.toUpperCase() === 'N') {
            ctx.fillStyle = 'rgba(239, 68, 68, 0.12)'
            ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
            ctx.fillStyle = '#ef4444'
            ctx.font = 'bold 11px monospace'
            ctx.fillText('N', cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
          } else {
            ctx.fillStyle = baseColor(b)
            ctx.fillText(b, cx, baseLabelY + BASE_LABEL_HEIGHT / 2)
          }
        }

        // Mixed base marker
        if (mixedBases.has(i)) {
          ctx.fillStyle = '#f59e0b'
          ctx.beginPath()
          const dy = baseLabelY + BASE_LABEL_HEIGHT - 2
          ctx.moveTo(cx, dy - 3)
          ctx.lineTo(cx + 3, dy)
          ctx.lineTo(cx, dy + 3)
          ctx.lineTo(cx - 3, dy)
          ctx.closePath()
          ctx.fill()
        }

        // Search hit highlighting
        if (searchHits.length > 0) {
          const qLen = searchQuery.length
          for (let h = 0; h < searchHits.length; h++) {
            if (i >= searchHits[h] && i < searchHits[h] + qLen) {
              const isActive = h === searchHitIdx
              ctx.fillStyle = isActive ? 'rgba(251, 191, 36, 0.4)' : 'rgba(251, 191, 36, 0.2)'
              ctx.fillRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
              if (isActive) {
                ctx.strokeStyle = '#f59e0b'
                ctx.lineWidth = 1.5
                ctx.strokeRect(lx, baseLabelY, cw, BASE_LABEL_HEIGHT)
              }
              break
            }
          }
        }
      }

      // Traces - clip to trace area so scaled peaks don't overflow
      const rowGapSampleSet = new Set(rowGaps.map(g => g.samplePos))
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, traceTop, width, rowTraceH)
      ctx.clip()

      // Draw subtle gap indicators for insert regions
      for (const gap of rowGaps) {
        const gapX = sToX(gap.samplePos)
        const gapW = gap.count * cellWidth
        ctx.fillStyle = 'rgba(34, 197, 94, 0.06)'
        ctx.fillRect(gapX - gapW, traceTop, gapW, rowTraceH)
      }

      for (const base of ['A', 'C', 'G', 'T'] as const) {
        if (!showTraces[base]) continue
        const trace = data.traces[base]
        if (trace.length === 0) continue
        ctx.strokeStyle = TRACE_COLORS[base]
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.8
        ctx.beginPath()
        const iStart = Math.max(0, Math.floor(sampleStart))
        const iEnd = Math.min(trace.length, Math.ceil(sampleEnd) + 1)
        let first = true
        for (let i = iStart; i < iEnd; i++) {
          if (rowGapSampleSet.has(i) && !first) {
            ctx.stroke()
            ctx.beginPath()
            first = true
          }
          const x = sToX(i)
          const y = intensityToY(trace[i])
          if (first) { ctx.moveTo(x, y); first = false }
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.globalAlpha = 1
      }
      ctx.restore()

      // Trim handles - draw on the row where the trim boundary falls
      const drawWrappedTrimHandle = (baseIdx: number, side: 'left' | 'right') => {
        if (baseIdx < baseStart || baseIdx > baseEnd) return
        const x = side === 'left' ? baseLX(baseIdx) : baseRX(baseIdx - 1)
        ctx.strokeStyle = accentColor
        ctx.globalAlpha = 0.5
        ctx.lineWidth = 2
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(x, rowY)
        ctx.lineTo(x, rowY + ROW_HEIGHT)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 0.85
        ctx.fillStyle = accentColor
        const hw = TRIM_HANDLE_WIDTH
        const hh = 24
        const hy = traceTop + rowTraceH / 2 - hh / 2
        const hx = x - hw / 2
        ctx.beginPath()
        ctx.roundRect(hx, hy, hw, hh, 3)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1
        for (let dy = -4; dy <= 4; dy += 4) {
          ctx.beginPath()
          ctx.moveTo(hx + 2, hy + hh / 2 + dy)
          ctx.lineTo(hx + hw - 2, hy + hh / 2 + dy)
          ctx.stroke()
        }
      }
      drawWrappedTrimHandle(trimStart, 'left')
      drawWrappedTrimHandle(trimEnd, 'right')
    }
  }, [data, showTraces, showQuality, trimStart, trimEnd, traceLength, peakScale, edits, editing, selectedBase, insertGaps, avgBaseSpacing, qualThreshold, mixedBases, searchHits, searchHitIdx, searchQuery, selRange])

  // Keep draw function refs current
  drawHorizontalRef.current = drawHorizontal
  drawWrappedRef.current = drawWrapped

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !data) return

    const dpr = window.devicePixelRatio || 1
    const width = container.clientWidth

    let height: number
    if (effectiveLayout === 'wrapped') {
      const numRows = Math.ceil(data.bases.length / BASES_PER_ROW)
      height = Math.max(numRows * ROW_HEIGHT, 100)
    } else {
      height = container.clientHeight
    }

    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    if (effectiveLayout === 'wrapped') {
      drawWrappedRef.current(ctx, width, height)
    } else {
      drawHorizontalRef.current(ctx, width, height)
    }
  }, [data, effectiveLayout, drawHorizontal, drawWrapped])

  // Redraw on state changes — batched via rAF to avoid redundant draws
  const rafRef = useRef(0)
  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(rafRef.current)
  }, [draw])

  // Visible base range for info display (computed as memo so minimap effect can use it)
  const [wrappedScrollTop, setWrappedScrollTop] = useState(0)
  // Track vertical scroll in wrapped mode for minimap
  useEffect(() => {
    if (effectiveLayout !== 'wrapped') return
    const container = containerRef.current
    if (!container) return
    const onScroll = () => setWrappedScrollTop(container.scrollTop)
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [effectiveLayout])

  const { firstVisBase, lastVisBase } = useMemo(() => {
    if (!data) return { firstVisBase: 0, lastVisBase: 0 }
    if (effectiveLayout === 'wrapped') {
      const container = containerRef.current
      const viewH = container?.clientHeight ?? 400
      const firstRow = Math.floor(wrappedScrollTop / ROW_HEIGHT)
      const lastRow = Math.floor((wrappedScrollTop + viewH) / ROW_HEIGHT)
      const first = firstRow * BASES_PER_ROW
      const last = Math.min((lastRow + 1) * BASES_PER_ROW - 1, data.bases.length - 1)
      return { firstVisBase: Math.max(0, first), lastVisBase: last }
    }
    // Uniform grid: compute visible base range from scroll position
    const { start, width: canvasW } = getVisibleRange()
    const cellWidth = avgBaseSpacing * zoom
    const scrollPx = sampleToGrid(start, cellWidth)
    const first = Math.max(0, Math.floor(scrollPx / cellWidth))
    const last = Math.min(data.bases.length - 1, Math.floor((scrollPx + canvasW) / cellWidth))
    return { firstVisBase: first, lastVisBase: last }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, getVisibleRange, effectiveLayout, wrappedScrollTop, zoom, avgBaseSpacing, sampleToGrid, layoutGeneration])

  // Draw quality minimap
  useEffect(() => {
    const el = minimapRef.current
    if (!el || !data) return
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth * dpr
    const h = 20 * dpr // fixed height, matches CSS
    if (w === 0) return
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
    const mctx = el.getContext('2d')
    if (!mctx) return
    mctx.clearRect(0, 0, w, h)
    const n = data.qualityScores.length
    if (n === 0) return
    const barW = Math.max(1, w / n)
    for (let i = 0; i < n; i++) {
      const q = data.qualityScores[i] ?? 0
      const barH = (q / 60) * h
      mctx.fillStyle = qualityColor(q)
      mctx.globalAlpha = 0.7
      mctx.fillRect(i * barW, h - barH, Math.ceil(barW), barH)
    }
    mctx.globalAlpha = 1
    // N-call markers on minimap
    for (let i = 0; i < n; i++) {
      if (data.bases[i]?.toUpperCase() === 'N') {
        mctx.fillStyle = '#ef4444'
        mctx.globalAlpha = 0.8
        mctx.fillRect(i * barW, 0, Math.ceil(barW), h)
      }
    }
    mctx.globalAlpha = 1
    // Mixed base markers on minimap
    for (const idx of mixedBases) {
      mctx.fillStyle = '#f59e0b'
      mctx.globalAlpha = 0.6
      mctx.fillRect(idx * barW, 0, Math.ceil(barW), 3)
    }
    mctx.globalAlpha = 1
    // Viewport indicator
    const vStart = firstVisBase / n
    const vEnd = (lastVisBase + 1) / n
    mctx.fillStyle = 'rgba(99, 102, 241, 0.15)'
    mctx.fillRect(vStart * w, 0, (vEnd - vStart) * w, h)
    mctx.strokeStyle = 'rgba(99, 102, 241, 0.5)'
    mctx.lineWidth = 1
    mctx.strokeRect(vStart * w, 0, (vEnd - vStart) * w, h)
    // Threshold line
    const threshFrac = Math.min(qualThreshold / 60, 1)
    const threshY = h - threshFrac * h
    mctx.strokeStyle = '#ef4444'
    mctx.globalAlpha = 0.5
    mctx.setLineDash([2, 2])
    mctx.beginPath()
    mctx.moveTo(0, threshY)
    mctx.lineTo(w, threshY)
    mctx.stroke()
    mctx.setLineDash([])
    mctx.globalAlpha = 1
  }, [data, effectiveLayout, firstVisBase, lastVisBase, qualThreshold, mixedBases])

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => {
      draw()
      setLayoutGeneration(g => g + 1)
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [draw])

  // ---- Scroll / zoom handlers ----
  // Ctrl+scroll zoom – must use native listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
        setZoom(z => Math.max(0.05, Math.min(20, z * factor)))
      } else {
        const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
        setScrollX(s => clampScroll(s + delta / zoom))
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [zoom, clampScroll])

  // ---- Mouse-to-base helper ----
  const mouseToBase = useCallback((mx: number, my: number): number => {
    if (!data) return 0
    if (effectiveLayout === 'wrapped') {
      return wrappedMouseToBase(mx, my, canvasRef.current?.clientWidth ?? 0)
    }
    // Uniform grid: convert pixel X to base index
    const { start } = getVisibleRange()
    const cellWidth = avgBaseSpacing * zoom
    const scrollPx = sampleToGrid(start, cellWidth)
    const baseIdx = Math.floor((mx + scrollPx) / cellWidth)
    return Math.max(0, Math.min(baseIdx, data.bases.length - 1))
  }, [data, effectiveLayout, wrappedMouseToBase, getVisibleRange, zoom, avgBaseSpacing, sampleToGrid])

  // ---- Trim handle drag ----
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (!data) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const TRIM_NUDGE = 6
    if (effectiveLayout === 'wrapped') {
      // Wrapped mode: compute handle position per-row (layout: traces → bases)
      const rowTraceH = ROW_HEIGHT - BASE_LABEL_HEIGHT - TRACE_TOP_MARGIN - 14
      for (const side of ['left', 'right'] as const) {
        const baseIdx = side === 'left' ? trimStart : trimEnd
        const { x: rawX, rowY } = wrappedBaseToXY(baseIdx, canvas.clientWidth)
        const x = rawX + (side === 'left' ? -TRIM_NUDGE : TRIM_NUDGE)
        const traceTop = rowY + TRACE_TOP_MARGIN
        const hw = TRIM_HANDLE_WIDTH
        const hh = 24
        const hy = traceTop + rowTraceH / 2 - hh / 2
        const hx = x - hw / 2

        if (mx >= hx - 4 && mx <= hx + hw + 4 && my >= hy - 4 && my <= hy + hh + 4) {
          trimDragRef.current = { side, startX: e.clientX, startVal: baseIdx }
          e.preventDefault()
          return
        }
      }
    } else {
      // Horizontal mode – use uniform grid positions for trim handles
      const { start } = getVisibleRange()
      const height = canvas.clientHeight
      const cellWidth = avgBaseSpacing * zoom
      const scrollPx = sampleToGrid(start, cellWidth)
      const traceTop2 = TRACE_TOP_MARGIN
      const traceHeight2 = height - traceTop2 - BASE_LABEL_HEIGHT - 4

      for (const side of ['left', 'right'] as const) {
        const baseIdx = side === 'left' ? trimStart : trimEnd
        const x = side === 'left' ? baseIdx * cellWidth - scrollPx : baseIdx * cellWidth - scrollPx
        const hw = TRIM_HANDLE_WIDTH
        const hh = 24
        const hy = traceTop2 + traceHeight2 / 2 - hh / 2
        const hx = x - hw / 2

        if (mx >= hx - 4 && mx <= hx + hw + 4 && my >= hy - 4 && my <= hy + hh + 4) {
          trimDragRef.current = { side, startX: e.clientX, startVal: baseIdx }
          e.preventDefault()
          return
        }
      }
    }

    // Base selection / edit cursor
    const nearestBase = mouseToBase(mx, my)

    // Right-click: preserve existing selection, just open context menu
    if (e.button === 2) {
      // If right-clicking inside the selection, keep it
      if (selRange && nearestBase >= selRange.start && nearestBase < selRange.end) return
      // If right-clicking outside, move cursor there but don't start drag
      setSelectedBase(nearestBase)
      setSelRange(null)
      selAnchorRef.current = null
      return
    }

    setSelectedBase(nearestBase)

    // In editing mode, only set the edit cursor — no selection
    if (editing) {
      setSelRange(null)
      containerRef.current?.focus()
      e.preventDefault()
      return
    }

    // Check if clicking near a selection handle to resize
    if (selRange) {
      const hitThreshold = 2 // bases proximity
      const distToStart = Math.abs(nearestBase - selRange.start)
      const distToEnd = Math.abs(nearestBase - (selRange.end - 1))
      const selMid = (selRange.start + selRange.end - 1) / 2
      if (distToStart <= hitThreshold && (nearestBase <= selMid || distToEnd > hitThreshold)) {
        selResizing.current = 'start'
        e.preventDefault()
        containerRef.current?.focus()
        return
      }
      if (distToEnd <= hitThreshold) {
        selResizing.current = 'end'
        e.preventDefault()
        containerRef.current?.focus()
        return
      }
    }

    if (e.shiftKey) {
      // Shift+Click: extend selection from anchor or nearest edge
      let anchor = selAnchorRef.current
      if (anchor === null && selRange) {
        // No anchor stored - pick the edge farthest from the click to keep as anchor
        const distToStart = Math.abs(nearestBase - selRange.start)
        const distToEnd = Math.abs(nearestBase - (selRange.end - 1))
        anchor = distToStart >= distToEnd ? selRange.start : selRange.end - 1
        selAnchorRef.current = anchor
      }
      if (anchor === null) {
        // No selection at all - use cursor or 0
        anchor = selectedBase ?? 0
        selAnchorRef.current = anchor
      }
      setSelRange({ start: Math.min(anchor, nearestBase), end: Math.max(anchor, nearestBase) + 1 })
      setSelectedBase(null)
    } else {
      // Start new selection
      selAnchorRef.current = nearestBase
      selDragging.current = true
      setSelRange(null)
      onSelectionStart?.(readId)
    }

    containerRef.current?.focus()
    e.preventDefault()
  }, [data, trimStart, trimEnd, zoom, getVisibleRange, traceLength, effectiveLayout, wrappedBaseToXY, editing, mouseToBase, selRange, onSelectionStart, readId])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!data) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    // Trim dragging
    const drag = trimDragRef.current
    if (drag) {
      const nearestBase = mouseToBase(mx, my)
      if (drag.side === 'left') {
        const newStart = Math.max(0, Math.min(nearestBase, trimEnd - 1))
        setTrim(readId, newStart, trimEnd)
      } else {
        const newEnd = Math.max(trimStart + 1, Math.min(nearestBase, data.bases.length))
        setTrim(readId, trimStart, newEnd)
      }
      setQualTooltip(null)
      return
    }

    // Selection handle resize
    if (selResizing.current && selRange) {
      const nearestBase = mouseToBase(mx, my)
      if (selResizing.current === 'start') {
        const newStart = Math.min(nearestBase, selRange.end - 1)
        setSelRange({ start: newStart, end: selRange.end })
      } else {
        const newEnd = Math.max(nearestBase + 1, selRange.start + 1)
        setSelRange({ start: selRange.start, end: newEnd })
      }
      return
    }

    // Selection drag
    if (selDragging.current && selAnchorRef.current !== null) {
      const nearestBase = mouseToBase(mx, my)
      const anchor = selAnchorRef.current
      if (nearestBase !== anchor) {
        setSelRange({ start: Math.min(anchor, nearestBase), end: Math.max(anchor, nearestBase) + 1 })
        setSelectedBase(null)
      } else {
        setSelRange(null)
      }
      // Auto-scroll when dragging near edges (horizontal mode only)
      if (effectiveLayout !== 'wrapped') {
        const edgeZone = 40
        if (mx < edgeZone) {
          setScrollX(s => clampScroll(s - avgBaseSpacing * 2))
        } else if (mx > rect.width - edgeZone) {
          setScrollX(s => clampScroll(s + avgBaseSpacing * 2))
        }
      }
      return
    }

    // Selection handle resize - auto-scroll
    if (selResizing.current && effectiveLayout !== 'wrapped') {
      const edgeZone = 40
      if (mx < edgeZone) {
        setScrollX(s => clampScroll(s - avgBaseSpacing * 2))
      } else if (mx > rect.width - edgeZone) {
        setScrollX(s => clampScroll(s + avgBaseSpacing * 2))
      }
    }

    // Cursor: show col-resize when hovering near selection handles
    if (selRange && !selDragging.current && !selResizing.current && canvas) {
      const hoverBase = mouseToBase(mx, my)
      const distToStart = Math.abs(hoverBase - selRange.start)
      const distToEnd = Math.abs(hoverBase - (selRange.end - 1))
      if (distToStart <= 2 || distToEnd <= 2) {
        canvas.style.cursor = 'col-resize'
      } else {
        canvas.style.cursor = ''
      }
    }

    // Quality tooltip on hover – check if mouse is in the quality bar region
    if (!showQuality) { setQualTooltip(null); return }

    let baseIdx: number
    let inQualRegion: boolean

    if (effectiveLayout === 'wrapped') {
      baseIdx = wrappedMouseToBase(mx, my, canvas.clientWidth)
      const row = Math.floor(my / ROW_HEIGHT)
      const localY = my - row * ROW_HEIGHT
      const rowTraceH = ROW_HEIGHT - BASE_LABEL_HEIGHT - TRACE_TOP_MARGIN - 14
      inQualRegion = localY >= TRACE_TOP_MARGIN && localY <= TRACE_TOP_MARGIN + rowTraceH
    } else {
      baseIdx = mouseToBase(mx, my)
      const traceH = canvas.clientHeight - TRACE_TOP_MARGIN - BASE_LABEL_HEIGHT - 4
      inQualRegion = my >= TRACE_TOP_MARGIN && my <= TRACE_TOP_MARGIN + traceH
    }

    if (inQualRegion && baseIdx >= 0 && baseIdx < data.bases.length) {
      const q = data.qualityScores[baseIdx] ?? 0
      setQualTooltip({
        x: e.clientX,
        y: e.clientY,
        base: data.bases[baseIdx],
        quality: q,
        index: baseIdx,
      })
    } else {
      setQualTooltip(null)
    }
  }, [data, readId, trimStart, trimEnd, zoom, getVisibleRange, setTrim, effectiveLayout, wrappedMouseToBase, showQuality, mouseToBase, selRange, clampScroll, avgBaseSpacing])

  const handleCanvasMouseUp = useCallback(() => {
    // If click without drag, create a 1-base selection at the anchor (non-edit mode only)
    if (!editing && selDragging.current && selAnchorRef.current !== null && !selRange) {
      const base = selAnchorRef.current
      setSelRange({ start: base, end: base + 1 })
      setSelectedBase(null)
    }
    trimDragRef.current = null
    selDragging.current = false
    selResizing.current = null
  }, [selRange, editing])

  // ---- Sequence helpers ----
  const getTrimmedSequence = useCallback(() => {
    if (!data) return ''
    let result = ''
    for (let i = trimStart; i < trimEnd && i < editedBases.length; i++) {
      if (editMap[i] !== 'delete') result += editedBases[i]
    }
    return result
  }, [data, trimStart, trimEnd, editedBases, editMap])

  const getSelectedText = useCallback(() => {
    if (!data) return ''
    if (selRange) {
      let result = ''
      const lo = Math.max(selRange.start, 0)
      const hi = Math.min(selRange.end, editedBases.length)
      for (let i = lo; i < hi; i++) {
        if (editMap[i] !== 'delete') result += editedBases[i]
      }
      return result
    }
    return getTrimmedSequence()
  }, [data, selRange, editedBases, editMap, getTrimmedSequence])

  const handleCopy = useCallback(() => {
    const text = getSelectedText()
    if (text) {
      navigator.clipboard.writeText(text)
        .then(() => onCopyFeedback?.(`Copied ${text.length} bp`))
        .catch(e => console.warn('Clipboard write failed:', e))
    }
  }, [getSelectedText, onCopyFeedback])

  const handleCopyRevComp = useCallback(() => {
    const text = getSelectedText()
    if (text) {
      const rc = reverseComplement(text)
      navigator.clipboard.writeText(rc)
        .then(() => onCopyFeedback?.(`Copied reverse complement (${rc.length} bp)`))
        .catch(e => console.warn('Clipboard write failed:', e))
    }
  }, [getSelectedText, onCopyFeedback])

  const handleCopyFasta = useCallback(() => {
    const text = getSelectedText()
    if (!text) return
    const name = data?.name || readId
    const rangeLabel = selRange ? ` ${selRange.start + 1}..${selRange.end}` : ''
    const fasta = `>${name}${rangeLabel}\n${text}\n`
    navigator.clipboard.writeText(fasta)
      .then(() => onCopyFeedback?.(`Copied as FASTA (${text.length} bp)`))
      .catch(e => console.warn('Clipboard write failed:', e))
  }, [getSelectedText, data?.name, readId, selRange, onCopyFeedback])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])



  // ---- Keyboard handler ----
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const ctrlOrMeta = e.ctrlKey || e.metaKey
    if (!data) return

    const maxBase = data.bases.length - 1

    // Find motif (Ctrl+F)
    if (ctrlOrMeta && e.key === 'f') {
      e.preventDefault()
      setSearchOpen(true)
      setTimeout(() => searchInputRef.current?.focus(), 0)
      return
    }

    // Go to position (Ctrl+G)
    if (ctrlOrMeta && e.key === 'g') {
      e.preventDefault()
      setFooterGotoValue('')
      setFooterGotoActive(true)
      setTimeout(() => footerGotoRef.current?.focus(), 0)
      return
    }

    // Close find on Escape when search is open
    if (e.key === 'Escape' && searchOpen) {
      e.preventDefault()
      setSearchOpen(false)
      setSearchQuery('')
      setSearchHits([])
      return
    }

    // Clear selection on Escape
    if (e.key === 'Escape' && selRange) {
      e.preventDefault()
      setSelRange(null)
      selAnchorRef.current = null
      return
    }

    // Escape in editing mode: deselect cursor
    if (e.key === 'Escape' && editing && selectedBase !== null) {
      setSelectedBase(null)
      e.preventDefault()
      return
    }

    // Copy (Ctrl+C)
    if (ctrlOrMeta && e.key === 'c') {
      e.preventDefault()
      handleCopy()
      return
    }

    // Select all (Ctrl+A)
    if (ctrlOrMeta && e.key === 'a') {
      e.preventDefault()
      setSelRange({ start: 0, end: data.bases.length })
      selAnchorRef.current = 0
      return
    }

    // Undo/redo works regardless of editing mode
    if (ctrlOrMeta && e.key === 'z' && !e.shiftKey) {
      undoSeq(readId)
      e.preventDefault()
      return
    }
    if (ctrlOrMeta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
      redoSeq(readId)
      e.preventDefault()
      return
    }
    if (ctrlOrMeta && e.key === 'y') {
      redoSeq(readId)
      e.preventDefault()
      return
    }

    // --- Arrow keys: work in both editing and view mode ---
    // Determine current cursor position
    const cursor = selectedBase ?? (selRange ? selRange.start : null)

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      let target: number
      if (e.key === 'Home') target = 0
      else if (e.key === 'End') target = maxBase
      else if (e.key === 'ArrowLeft') target = Math.max(0, (cursor ?? 0) - 1)
      else target = Math.min(maxBase, (cursor ?? 0) + 1)

      if (e.shiftKey && !editing) {
        // Shift+Arrow: extend or create selection
        if (selRange) {
          // Extend from anchor
          const anchor = selAnchorRef.current ?? selRange.start
          const newStart = Math.min(anchor, target)
          const newEnd = Math.max(anchor, target) + 1
          setSelRange({ start: newStart, end: Math.min(newEnd, data.bases.length) })
        } else {
          // Start new selection from cursor
          const anchor = cursor ?? 0
          selAnchorRef.current = anchor
          const newStart = Math.min(anchor, target)
          const newEnd = Math.max(anchor, target) + 1
          setSelRange({ start: newStart, end: Math.min(newEnd, data.bases.length) })
        }
        setSelectedBase(null)
        scrollToBaseNoSelect(target)
      } else {
        // Plain arrow: move cursor, clear selection
        setSelectedBase(target)
        setSelRange(null)
        selAnchorRef.current = null
        scrollToBaseNoSelect(target)
      }
      return
    }

    // --- Editing-mode-only keys below ---
    if (!editing || selectedBase === null) return

    const key = e.key.toUpperCase()
    if ('ACGT'.includes(key) && e.shiftKey) {
      // Shift+letter: substitute the selected base
      if (data.bases[selectedBase] !== key) {
        editBase(readId, { type: 'substitute', pos: selectedBase, original: data.bases[selectedBase], base: key })
      }
      if (selectedBase < maxBase) setSelectedBase(selectedBase + 1)
      e.preventDefault()
    } else if ('ACGT'.includes(key)) {
      // Plain letter: insert before the selected base
      const existingInserts = edits.filter(ed => ed.type === 'insert' && ed.pos === selectedBase)
      const nextOffset = existingInserts.length
      editBase(readId, { type: 'insert', pos: selectedBase, offset: nextOffset, base: key })
      e.preventDefault()
    } else if (e.key === 'Delete') {
      // Selection-aware delete
      if (selRange) {
        for (let i = selRange.start; i < selRange.end && i < data.bases.length; i++) {
          const alreadyDeleted = edits.some(ed => ed.type === 'delete' && ed.pos === i)
          if (!alreadyDeleted) {
            editBase(readId, { type: 'delete', pos: i, original: data.bases[i] })
          }
        }
        setSelectedBase(selRange.start)
        setSelRange(null)
        selAnchorRef.current = null
      } else {
        const alreadyDeleted = edits.some(ed => ed.type === 'delete' && ed.pos === selectedBase)
        if (!alreadyDeleted) {
          editBase(readId, { type: 'delete', pos: selectedBase, original: data.bases[selectedBase] })
        }
      }
      e.preventDefault()
    } else if (e.key === 'Backspace') {
      if (selRange) {
        for (let i = selRange.start; i < selRange.end && i < data.bases.length; i++) {
          const alreadyDeleted = edits.some(ed => ed.type === 'delete' && ed.pos === i)
          if (!alreadyDeleted) {
            editBase(readId, { type: 'delete', pos: i, original: data.bases[i] })
          }
        }
        setSelectedBase(selRange.start)
        setSelRange(null)
        selAnchorRef.current = null
      } else if (selectedBase > 0) {
        const targetPos = selectedBase - 1
        const alreadyDeleted = edits.some(ed => ed.type === 'delete' && ed.pos === targetPos)
        if (!alreadyDeleted) {
          editBase(readId, { type: 'delete', pos: targetPos, original: data.bases[targetPos] })
        }
        setSelectedBase(targetPos)
      }
      e.preventDefault()
    }
  }, [editing, selectedBase, data, readId, edits, editBase, undoSeq, redoSeq, searchOpen, selRange, handleCopy, scrollToBaseNoSelect])

  // Global keyboard shortcuts (Ctrl+F find, Ctrl+G go-to)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrlOrMeta = e.ctrlKey || e.metaKey
      if (ctrlOrMeta && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (ctrlOrMeta && e.key === 'g') {
        e.preventDefault()
        setFooterGotoValue('')
        setFooterGotoActive(true)
        setTimeout(() => footerGotoRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // ---- Scrollbar ----
  const scrollbarRef = useRef<HTMLDivElement>(null)

  const thumbStyle = useMemo(() => {
    const canvas = canvasRef.current
    if (!canvas || effectiveTraceLength === 0) return { left: 0, width: 30 }
    const containerWidth = canvas.clientWidth
    const visibleFraction = Math.min(1, (containerWidth / zoom) / effectiveTraceLength)
    const scrollFraction = effectiveTraceLength > 0 ? scrollX / effectiveTraceLength : 0
    const barWidth = scrollbarRef.current?.clientWidth ?? containerWidth
    return {
      left: scrollFraction * barWidth,
      width: Math.max(30, visibleFraction * barWidth),
    }
  }, [scrollX, zoom, effectiveTraceLength])

  const handleScrollbarMouseDown = useCallback((e: React.MouseEvent) => {
    const thumb = e.target as HTMLElement
    if (thumb.classList.contains('chrom-scrollbar-thumb')) {
      scrollDragRef.current = { startX: e.clientX, startScroll: scrollX }
      setScrollDragging(true)
      e.preventDefault()
    } else {
      // Click on track - jump to position
      const bar = scrollbarRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      const fraction = (e.clientX - rect.left) / rect.width
      setScrollX(clampScroll(fraction * effectiveTraceLength))
    }
  }, [scrollX, effectiveTraceLength, clampScroll])

  // Global mouse handlers for scrollbar drag
  useEffect(() => {
    if (!scrollDragging) return
    const handleMove = (e: MouseEvent) => {
      const drag = scrollDragRef.current
      if (!drag) return
      const bar = scrollbarRef.current
      if (!bar) return
      const dx = e.clientX - drag.startX
      const barWidth = bar.clientWidth
      const scrollDelta = (dx / barWidth) * effectiveTraceLength
      setScrollX(clampScroll(drag.startScroll + scrollDelta))
    }
    const handleUp = () => {
      scrollDragRef.current = null
      setScrollDragging(false)
    }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [scrollDragging, effectiveTraceLength, clampScroll])

  // Global mouse handlers for trim drag
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!trimDragRef.current || !data) return
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top

      let nearestBase: number
      if (effectiveLayout === 'wrapped') {
        nearestBase = wrappedMouseToBase(mx, my, canvas.clientWidth)
      } else {
        // Uniform grid: convert pixel X to base index
        const { start } = getVisibleRange()
        const cellW = avgBaseSpacing * zoom
        const scrollPx = sampleToGrid(start, cellW)
        nearestBase = Math.max(0, Math.min(Math.floor((mx + scrollPx) / cellW), data.bases.length - 1))
      }

      const drag = trimDragRef.current
      if (drag.side === 'left') {
        const newStart = Math.max(0, Math.min(nearestBase, trimEnd - 1))
        setTrim(readId, newStart, trimEnd)
      } else {
        const newEnd = Math.max(trimStart + 1, Math.min(nearestBase, data.bases.length))
        setTrim(readId, trimStart, newEnd)
      }
    }
    const handleUp = () => { trimDragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [data, readId, trimStart, trimEnd, zoom, getVisibleRange, setTrim, effectiveLayout, wrappedMouseToBase, avgBaseSpacing, traceLength])

  // ---- Add as Sequence ----
  const handleAddAsSequence = useCallback(() => {
    if (!data) return
    const result = getTrimmedSequence()
    if (result.length === 0) return
    const name = `${data.name} (trimmed)`
    openDocument(name, result, 'linear')
  }, [data, getTrimmedSequence, openDocument])

  // ---- Trim input handlers ----
  const handleTrimStartChange = useCallback((val: string) => {
    const n = parseInt(val, 10)
    if (!isNaN(n) && n >= 1 && data) {
      setTrim(readId, Math.min(n - 1, trimEnd - 1), trimEnd)
    }
  }, [readId, trimEnd, data, setTrim])

  const handleTrimEndChange = useCallback((val: string) => {
    const n = parseInt(val, 10)
    if (!isNaN(n) && data) {
      setTrim(readId, trimStart, Math.max(trimStart + 1, Math.min(n, data.bases.length)))
    }
  }, [readId, trimStart, data, setTrim])

  if (!read || !data) {
    return <div className="chrom-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No sequencing read selected</div>
  }

  const trimmedLength = trimEnd - trimStart

  return (
    <div className={`chrom-container ${effectiveLayout === 'wrapped' ? 'chrom-wrapped' : ''} ${hideCurves ? 'chrom-seq-only' : ''}`}>
      {/* Compact read label for multi-trace stacked view */}
      {compact && <div className="chrom-compact-label">{data.name}</div>}
      {/* Toolbar */}
      {!compact && <div className="chrom-toolbar">
        {/* Vertical peak scale */}
        <div className="chrom-toolbar-group">
          <button className="chrom-tb" onClick={() => setPeakScale(s => Math.max(0.1, s / 1.4))} title="Decrease peak height">
            <ChevronDown size={13} />
          </button>
          <button className="chrom-tb" onClick={() => setPeakScale(s => Math.min(20, s * 1.4))} title="Increase peak height">
            <ChevronUp size={13} />
          </button>
          <button
            className="chrom-tb"
            onClick={() => setPeakScale(1)}
            title="Reset peak scale"
            disabled={peakScale === 1}
          >
            <RotateCcw size={11} />
          </button>
        </div>

        <div className="chrom-toolbar-sep" />

        {/* Trace toggles */}
        <div className="chrom-toolbar-group">
          <button
            className={`chrom-tb ${!hideCurves ? 'active' : ''}`}
            onClick={() => setLocalHideCurves(v => !v)}
            title="Show/hide trace curves"
            style={{ fontSize: 10 }}
          >
            Traces
          </button>
          {!hideCurves && <>
            {(['A', 'C', 'G', 'T'] as const).map(base => (
              <button
                key={base}
                className={`chrom-trace-toggle chrom-trace-${base} ${showTraces[base] ? '' : 'off'}`}
                onClick={() => setShowTraces(s => ({ ...s, [base]: !s[base] }))}
                title={`Toggle ${base} trace`}
              >
                {base}
              </button>
            ))}
            <button
              className={`chrom-tb ${showQuality ? 'active' : ''}`}
              onClick={() => setShowQuality(q => !q)}
              title="Toggle quality bars"
              style={{ fontSize: 10 }}
            >
              Q
            </button>
          </>}
        </div>

        <div className="chrom-toolbar-sep" />

        {/* Trim controls */}
        <div className="chrom-trim-group">
          Trim:
          <input
            className="input chrom-trim-input"
            type="number"
            min={1}
            max={trimEnd}
            value={trimStart + 1}
            onChange={e => handleTrimStartChange(e.target.value)}
          />
          –
          <input
            className="input chrom-trim-input"
            type="number"
            min={trimStart + 1}
            max={data.bases.length}
            value={trimEnd}
            onChange={e => handleTrimEndChange(e.target.value)}
          />
          <span>of {data.bases.length} bp</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>({trimmedLength} bp kept)</span>
        </div>

        <div className="chrom-toolbar-sep" />

        {/* Edit mode */}
        <div className="chrom-toolbar-group">
          <button
            className={`chrom-tb ${editing ? 'active' : ''}`}
            onClick={() => setEditing(e => !e)}
            title={editing ? 'Exit edit mode' : 'Edit base calls'}
          >
            <Pencil size={12} />
          </button>
          {edits.length > 0 && (
            <button
              className="chrom-tb"
              onClick={() => resetEdits(readId)}
              title="Reset all edits"
            >
              <RotateCcw size={11} />
            </button>
          )}
          {edits.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {edits.length} edit{edits.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="chrom-toolbar-sep" />

        {/* Quality threshold */}
        {showQuality && (
          <div className="chrom-toolbar-group chrom-threshold-group">
            <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Q≥</span>
            <input
              className="input chrom-threshold-input"
              type="number"
              min={0}
              max={60}
              value={qualThreshold}
              onChange={e => setQualThreshold(Math.max(0, Math.min(60, parseInt(e.target.value) || 0)))}
              title="Quality threshold line"
            />
          </div>
        )}

        {/* Mixed base toggle */}
        <button
          className={`chrom-tb ${showMixedBases ? 'active' : ''}`}
          onClick={() => setShowMixedBases(v => !v)}
          title="Show mixed/ambiguous base markers"
          style={{ fontSize: 10 }}
        >
          Mix
        </button>

        <div className="chrom-toolbar-sep" />

        <button className="chrom-tb" onClick={handleCopy} title={selRange ? `Copy selection (${selRange.end - selRange.start} bp)` : 'Copy trimmed sequence (Ctrl+C)'}>
          <Copy size={12} />
        </button>
        <div className="chrom-toolbar-sep" />

        <button className="chrom-tb chrom-tb-primary" onClick={handleAddAsSequence} disabled={trimmedLength === 0}>
          <Plus size={13} /> Add as Sequence
        </button>
        <span className="chrom-info">
          {effectiveLayout === 'horizontal'
            ? selRange
              ? `Selected ${selRange.start + 1}–${selRange.end} (${selRange.end - selRange.start} bp)`
              : `Bases ${firstVisBase + 1}–${lastVisBase + 1}`
            : `${data.bases.length} bases`
          }
        </span>

        <span style={{ flex: 1 }} />

        {!forceHorizontal && (
          <button
            className="chrom-tb"
            onClick={() => setLayout(l => l === 'horizontal' ? 'wrapped' : 'horizontal')}
            title={effectiveLayout === 'horizontal' ? 'Switch to wrapped rows' : 'Switch to horizontal scroll'}
          >
            {effectiveLayout === 'horizontal' ? <WrapText size={14} /> : <ArrowRightLeft size={14} />}
          </button>
        )}
      </div>}

      {/* Quality minimap */}
      {!compact && (
        <div
          className="chrom-minimap"
          style={{ cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={e => {
            if (!data) return
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            const n = data.bases.length
            // Check if click is inside the viewport indicator
            const vStart = firstVisBase / n
            const vEnd = (lastVisBase + 1) / n
            if (frac >= vStart && frac <= vEnd) {
              // Start dragging the viewport
              minimapDragRef.current = { dragging: true, offsetFrac: frac - vStart }
            } else {
              // Click outside viewport - jump to position, then start drag
              const vpWidth = vEnd - vStart
              const centerFrac = Math.max(0, Math.min(1, frac))
              const baseIdx = Math.round(centerFrac * (n - 1))
              scrollToBaseNoSelect(baseIdx)
              minimapDragRef.current = { dragging: true, offsetFrac: vpWidth / 2 }
            }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={e => {
            if (!minimapDragRef.current.dragging || !data) return
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const frac = (e.clientX - rect.left) / rect.width
            const n = data.bases.length
            const vWidth = (lastVisBase - firstVisBase + 1) / n
            const targetStart = frac - minimapDragRef.current.offsetFrac
            const centerFrac = targetStart + vWidth / 2
            const baseIdx = Math.round(Math.max(0, Math.min(1, centerFrac)) * (n - 1))
            scrollToBaseNoSelect(baseIdx)
          }}
          onPointerUp={() => { minimapDragRef.current.dragging = false }}
          onPointerCancel={() => { minimapDragRef.current.dragging = false }}
        >
          <canvas ref={minimapRef} />
        </div>
      )}

      {/* Canvas */}
      <div
        className={`chrom-canvas-area ${editing ? 'chrom-editing' : ''}`}
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => setQualTooltip(null)}
          onContextMenu={handleContextMenu}
        />

        {/* Selection info tooltip */}
        {selRange && !compact && data && (() => {
          const bpCount = selRange.end - selRange.start
          const midBase = Math.floor((selRange.start + selRange.end - 1) / 2)
          const midPeak = midBase < data.peakLocations.length ? data.peakLocations[midBase] : 0
          const x = (midPeak - scrollX) * zoom
          return (
            <div className="chrom-sel-tooltip" style={{ left: x }}>
              <span>{selRange.start + 1}..{selRange.end}</span>
              {' '}
              <span>({bpCount} bp)</span>
            </div>
          )
        })()}

        {/* Floating find panel */}
        {searchOpen && (
          <div className="chrom-find-panel">
            <div className="chrom-find-header">
              <span className="chrom-find-title">Find Motif</span>
              <button className="chrom-find-close" onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchHits([]) }} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <div className="chrom-find-body">
              <div className="chrom-find-input-row">
                <input
                  ref={searchInputRef}
                  type="text"
                  className="input chrom-find-input"
                  placeholder="Sequence (e.g. ATGCN)…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      jumpToSearchHit(e.shiftKey ? searchHitIdx - 1 : searchHitIdx + 1)
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      setSearchOpen(false); setSearchQuery(''); setSearchHits([])
                    }
                  }}
                />
                <div className="chrom-find-nav">
                  <button className="chrom-find-nav-btn" onClick={() => jumpToSearchHit(searchHitIdx - 1)} disabled={searchHits.length === 0} aria-label="Previous match">
                    <ChevronUp size={14} />
                  </button>
                  <button className="chrom-find-nav-btn" onClick={() => jumpToSearchHit(searchHitIdx + 1)} disabled={searchHits.length === 0} aria-label="Next match">
                    <ChevronDown size={14} />
                  </button>
                </div>
              </div>
              <div className="chrom-find-match-count">
                {searchQuery
                  ? searchHits.length > 0
                    ? `${searchHitIdx + 1} of ${searchHits.length} match${searchHits.length !== 1 ? 'es' : ''}`
                    : 'No matches'
                  : '\u00A0'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quality tooltip */}
      {qualTooltip && (
        <div
          className="chrom-qual-tooltip"
          style={{ left: qualTooltip.x, top: qualTooltip.y - 40 }}
        >
          <span className="chrom-qual-tooltip-base">{qualTooltip.base}</span>
          <span className="chrom-qual-tooltip-score">Q{qualTooltip.quality}</span>
          <span className="chrom-qual-tooltip-pos">pos {qualTooltip.index + 1}</span>
        </div>
      )}

      {/* Scrollbar (hidden in compact/multi-read mode — parent provides shared scrollbar) */}
      {!compact && <div
        className="chrom-scrollbar"
        ref={scrollbarRef}
        onMouseDown={handleScrollbarMouseDown}
      >
        <div
          className={`chrom-scrollbar-thumb ${scrollDragging ? 'dragging' : ''}`}
          style={{ left: thumbStyle.left, width: thumbStyle.width }}
        />
      </div>}

      {/* Read info footer */}
      {!compact && <div className="chrom-read-info">
        <span><strong>{data.name}</strong></span>
        <span>{data.bases.length} bases</span>
        {data.metadata.lane !== undefined && <span>Lane {data.metadata.lane}</span>}
        {data.metadata.runStartDate && <span>Run: {data.metadata.runStartDate}</span>}

        {/* Stats + position – right-aligned group */}
        <span className="chrom-footer-right">
          <span className="chrom-footer-stats" ref={statsAnchorRef}>
            <button
              className={`chrom-quality-btn ${statsOpen ? 'active' : ''}`}
              onClick={() => setStatsOpen(v => !v)}
            >
              Avg Q{qualStats ? qualStats.avg : '–'}
              {qualStats && <> · ≥Q20 {qualStats.q20pct}%</>}
            </button>
          </span>

          <span className="chrom-footer-sep">|</span>

          {footerGotoActive ? (
            <input
              ref={footerGotoRef}
              className="chrom-footer-goto-input"
              type="text"
              value={footerGotoValue}
              placeholder={`1–${data.bases.length}`}
              onChange={e => setFooterGotoValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const n = parseInt(footerGotoValue.replace(/,/g, ''))
                  if (n >= 1 && n <= data.bases.length) scrollToBase(n - 1)
                  setFooterGotoActive(false)
                } else if (e.key === 'Escape') {
                  setFooterGotoActive(false)
                }
              }}
              onBlur={() => setFooterGotoActive(false)}
            />
          ) : (
            <button
              className="chrom-footer-goto-btn"
              onClick={() => {
                setFooterGotoValue('')
                setFooterGotoActive(true)
                requestAnimationFrame(() => footerGotoRef.current?.focus())
              }}
              title="Click to go to position (Ctrl+G)"
            >
              {selRange
                ? `${selRange.start + 1}..${selRange.end} (${selRange.end - selRange.start} bp)`
                : selectedBase != null
                  ? `Base ${selectedBase + 1}`
                  : `Pos –`}
            </button>
          )}
        </span>

        {/* Quality stats popover – rendered as fixed to avoid clipping */}
        {statsOpen && qualStats && (
          <div className="chrom-quality-popover" ref={statsPopoverRef} style={statsPopoverStyle}>
            <div className="chrom-quality-popover-header">
              <span>Quality Statistics</span>
              <button className="chrom-find-close" onClick={() => setStatsOpen(false)}><X size={12} /></button>
            </div>
            <div className="chrom-stats-grid">
              <span className="chrom-stats-label">Bases (trimmed)</span><span>{qualStats.count}</span>
              <span className="chrom-stats-label">Avg quality</span><span className="chrom-stats-value">Q{qualStats.avg}</span>
              <span className="chrom-stats-label">Median quality</span><span className="chrom-stats-value">Q{qualStats.median}</span>
              <span className="chrom-stats-label">Min / Max</span><span className="chrom-stats-value">Q{qualStats.min} / Q{qualStats.max}</span>
              <span className="chrom-stats-label">≥Q20</span><span className="chrom-stats-value">{qualStats.q20pct}%</span>
              <span className="chrom-stats-label">≥Q30</span><span className="chrom-stats-value">{qualStats.q30pct}%</span>
              <span className="chrom-stats-label">N calls</span><span className="chrom-stats-value">{qualStats.nCount}</span>
              <span className="chrom-stats-label">Mixed bases</span><span className="chrom-stats-value">{qualStats.mixedCount}</span>
            </div>
          </div>
        )}
      </div>}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenuPopup x={ctxMenu.x} y={ctxMenu.y}>
          <button className="ctx-menu-item" onClick={() => { handleCopy(); setCtxMenu(null) }}>
            Copy{selRange ? ` (${selRange.end - selRange.start} bp)` : ''}
          </button>
          <button className="ctx-menu-item" onClick={() => { handleCopyRevComp(); setCtxMenu(null) }}>
            Copy Reverse Complement
          </button>
          <button className="ctx-menu-item" onClick={() => { handleCopyFasta(); setCtxMenu(null) }}>
            Copy as FASTA
          </button>
          {selRange && (
            <>
              <div className="ctx-menu-sep" />
              <button className="ctx-menu-item" onClick={() => {
                if (data) { setSelRange({ start: 0, end: data.bases.length }); selAnchorRef.current = 0 }
                setCtxMenu(null)
              }}>
                Select All
              </button>
            </>
          )}
        </ContextMenuPopup>
      )}
    </div>
  )
}
