import './GelView.css'
/**
 * Virtual Gel Electrophoresis modal.
 *
 * Renders a canvas-based agarose gel with configurable lanes. Lane config is
 * presented as a table below the gel: Lane #, Type, Sequence/Ladder dropdown,
 * enzyme pills with a "+" button to add more, and × to remove.
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { X, Plus, GripVertical, Download, ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../store'
import { LADDERS, DEFAULT_LADDER } from '../gel/ladders'
import { sizeToY, GEL_PERCENTAGES, DEFAULT_GEL_PCT, type GelPercentage } from '../gel/migration'
import { ENZYME_DB, ENZYME_GROUPS, getEnzyme, type RestrictionEnzyme } from '../enzymes/db'
import { exportGelPdf } from '../gel/exportPdf'
import { findCutSites, computeFragments } from '../enzymes/finder'
import { useExitAnimation } from '../hooks/useExitAnimation'

// Enzyme category keys matching ENZYME_GROUPS
type EnzymeCategoryKey = 'all' | keyof typeof ENZYME_GROUPS
const ENZYME_CATEGORIES: { key: EnzymeCategoryKey; label: string }[] = [
  { key: 'all', label: 'All enzymes' },
  { key: 'Common (6-cutters)', label: 'Common (6-cutters)' },
  { key: 'Rare (8-cutters)', label: 'Rare (8-cutters)' },
  { key: 'Frequent (4-cutters)', label: 'Frequent (4-cutters)' },
  { key: 'Golden Gate (Type IIS)', label: 'Golden Gate (Type IIS)' },
  { key: 'All 6-cutters', label: 'All 6-cutters' },
  { key: 'All 4-cutters', label: 'All 4-cutters' },
  { key: 'All 8+ cutters', label: 'All 8+ cutters' },
  { key: 'Blunt cutters', label: 'Blunt cutters' },
  { key: "5' overhang", label: "5' overhang" },
  { key: "3' overhang", label: "3' overhang" },
  { key: 'Type IIS', label: 'Type IIS' },
]

function getEnzymesForCategory(key: EnzymeCategoryKey): RestrictionEnzyme[] {
  if (key === 'all') return ENZYME_DB
  const names = ENZYME_GROUPS[key]
  if (!names) return ENZYME_DB
  return ENZYME_DB.filter(e => names.includes(e.name))
}

type CutCountFilter = 'any' | '1' | '2' | '3+' | '0'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LaneType = 'ladder' | 'digest' | 'uncut'

interface LaneConfig {
  id: number
  type: LaneType
  ladderName: string
  sequenceTabId: string
  enzymeNames: string[]
}

interface BandRect {
  laneIdx: number
  x: number
  y: number
  w: number
  h: number
  size: number
  count: number
}

interface Props {
  open: boolean
  onClose: () => void
  /** Request an export filename dialog from the parent. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _laneId = 0
function nextLaneId(): number { return ++_laneId }

function defaultLanes(): LaneConfig[] {
  const lanes: LaneConfig[] = [
    { id: nextLaneId(), type: 'ladder', ladderName: DEFAULT_LADDER, sequenceTabId: '', enzymeNames: [] },
  ]
  for (let i = 1; i < 10; i++) {
    lanes.push({ id: nextLaneId(), type: 'digest', ladderName: DEFAULT_LADDER, sequenceTabId: '', enzymeNames: [] })
  }
  return lanes
}

const MAX_LANES = 16
const GEL_STORAGE_KEY = 'seqnexus_gel'

interface GelPersisted {
  lanes: LaneConfig[]
  gelPct: GelPercentage
  massIntensity?: boolean
}

function saveGelState(lanes: LaneConfig[], gelPct: GelPercentage, massIntensity: boolean): void {
  try {
    localStorage.setItem(GEL_STORAGE_KEY, JSON.stringify({ lanes, gelPct, massIntensity }))
  } catch { /* quota exceeded - ignore */ }
}

function loadGelState(): { lanes: LaneConfig[]; gelPct: GelPercentage; massIntensity: boolean } | null {
  try {
    const raw = localStorage.getItem(GEL_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as GelPersisted
    if (!Array.isArray(data.lanes) || data.lanes.length === 0) return null
    // Ensure lane ids don't collide with the counter
    for (const l of data.lanes) {
      if (l.id >= _laneId) _laneId = l.id
    }
    return { lanes: data.lanes, gelPct: data.gelPct ?? DEFAULT_GEL_PCT, massIntensity: data.massIntensity ?? false }
  } catch {
    return null
  }
}

function formatSize(bp: number): string {
  if (bp >= 1000) return `${(bp / 1000).toFixed(bp >= 10000 ? 0 : 1)} kb`
  return `${bp} bp`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GelView({ open, onClose, onExportPrompt }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const backdropRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const savedGel = useRef(loadGelState())
  const [lanes, setLanes] = useState<LaneConfig[]>(() => savedGel.current?.lanes ?? defaultLanes())
  const [gelPct, setGelPct] = useState<GelPercentage>(() => savedGel.current?.gelPct ?? DEFAULT_GEL_PCT)
  const [massIntensity, setMassIntensity] = useState(() => savedGel.current?.massIntensity ?? false)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  // Persist gel state on change
  useEffect(() => {
    saveGelState(lanes, gelPct, massIntensity)
  }, [lanes, gelPct, massIntensity])

  // Enzyme add popover state
  const [enzymePopoverLaneId, setEnzymePopoverLaneId] = useState<number | null>(null)
  const [enzymePopoverPos, setEnzymePopoverPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [enzymeFilter, setEnzymeFilter] = useState('')
  const [enzymeCategory, setEnzymeCategory] = useState<EnzymeCategoryKey>('all')
  const [cutCountFilter, setCutCountFilter] = useState<CutCountFilter>('any')
  const enzymePopoverRef = useRef<HTMLDivElement>(null)
  const enzymeInputRef = useRef<HTMLInputElement>(null)

  // Expanded fragment detail rows
  const [expandedLanes, setExpandedLanes] = useState<Set<number>>(new Set())
  const toggleLaneExpand = useCallback((id: number) => {
    setExpandedLanes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return
    const handle = (e: MouseEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [exportOpen])

  // Store band rects for hit-testing
  const bandRectsRef = useRef<BandRect[]>([])

  // Store lane header hit regions for click-to-scroll
  const laneHeaderRectsRef = useRef<{ laneIdx: number; x: number; y: number; w: number; h: number }[]>([])
  const [highlightedLaneId, setHighlightedLaneId] = useState<number | null>(null)
  const highlightTimerRef = useRef<number>(0)
  const tableWrapRef = useRef<HTMLDivElement>(null)
  const [hoveredLaneIdx, setHoveredLaneIdx] = useState<number | null>(null)
  const hoveredLaneIdxRef = useRef<number | null>(null)

  // Table drag-to-reorder state
  const [tableDragIdx, setTableDragIdx] = useState<number | null>(null)
  const [tableDropIdx, setTableDropIdx] = useState<number | null>(null)

  // Canvas drag-to-reorder state
  const canvasDragRef = useRef<{ laneIdx: number; startX: number; started: boolean } | null>(null)
  const [canvasDragTarget, setCanvasDragTarget] = useState<number | null>(null)
  const canvasDragDidDrop = useRef(false)

  // Close enzyme popover on outside click (full click: mousedown + mouseup both outside)
  useEffect(() => {
    if (enzymePopoverLaneId === null) return
    let downOutside = false
    const isInside = (target: HTMLElement) =>
      !!target.closest('.gel-enzyme-add-btn') ||
      !!enzymePopoverRef.current?.contains(target)
    const handleDown = (e: MouseEvent) => {
      downOutside = !isInside(e.target as HTMLElement)
    }
    const handleUp = (e: MouseEvent) => {
      if (downOutside && !isInside(e.target as HTMLElement)) {
        setEnzymePopoverLaneId(null)
        setEnzymeFilter('')
        setEnzymeCategory('all')
        setCutCountFilter('any')
      }
      downOutside = false
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [enzymePopoverLaneId])

  // Focus enzyme input when popover opens
  useEffect(() => {
    if (enzymePopoverLaneId !== null) {
      setTimeout(() => enzymeInputRef.current?.focus(), 30)
    }
  }, [enzymePopoverLaneId])

  // ---- Resolve lane data for rendering ----
  const laneData = useMemo(() => {
    return lanes.map(lane => {
      if (lane.type === 'ladder') {
        const ladder = LADDERS.find(l => l.name === lane.ladderName) ?? LADDERS[0]
        return { sizes: ladder.sizes, label: ladder.name }
      }
      const tab = tabs.find(t => t.id === lane.sequenceTabId)
      if (!tab) return { sizes: [] as number[], label: 'Empty' }

      if (lane.type === 'uncut') {
        return { sizes: [tab.doc.sequence.length], label: tab.doc.name }
      }

      // Digest
      const bases = tab.doc.sequence.bases
      const topology = tab.doc.sequence.topology
      const enzymes = lane.enzymeNames.map(n => getEnzyme(n)).filter(Boolean) as NonNullable<ReturnType<typeof getEnzyme>>[]
      if (enzymes.length === 0) return { sizes: [] as number[], label: tab.doc.name }

      const allSites = enzymes.flatMap(e => findCutSites(bases, e, topology))
      const fragments = computeFragments(bases.length, allSites, topology)
      const enzymeLabel = lane.enzymeNames.join('+')
      return { sizes: fragments, label: `${tab.doc.name} / ${enzymeLabel}` }
    })
  }, [lanes, tabs])

  // ---- Canvas drawing ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    // Measure the content area inside padding
    const cs = getComputedStyle(container)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const width = container.clientWidth - padL - padR
    const height = 440
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    // Gel background - dark off-black
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    grad.addColorStop(0, '#0d0d12')
    grad.addColorStop(1, '#0a0a0f')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

    const laneCount = lanes.length
    if (laneCount === 0) return

    // Layout
    const gelTop = 44
    const gelBottom = height - 16
    const wellHeight = 7
    const bandHeight = 3
    const margin = 40
    const laneGap = 6
    const totalLaneWidth = width - margin * 2
    const laneWidth = Math.min(48, Math.max(24, (totalLaneWidth - laneGap * (laneCount - 1)) / laneCount))
    const totalUsed = laneCount * laneWidth + (laneCount - 1) * laneGap
    const startX = (width - totalUsed) / 2

    const newBandRects: BandRect[] = []
    const newHeaderRects: typeof laneHeaderRectsRef.current = []

    for (let i = 0; i < laneCount; i++) {
      const lx = startX + i * (laneWidth + laneGap)
      const cx = lx + laneWidth / 2
      const data = laneData[i]

      const isHovered = hoveredLaneIdxRef.current === i

      // Well
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)'
      ctx.fillRect(lx, gelTop, laneWidth, wellHeight)

      // Well glow on hover
      if (isHovered) {
        ctx.shadowColor = 'rgba(100,200,255,0.5)'
        ctx.shadowBlur = 8
        ctx.fillStyle = 'rgba(100,200,255,0.08)'
        ctx.fillRect(lx, gelTop, laneWidth, wellHeight)
        ctx.shadowBlur = 0
      }

      // Lane label
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)'
      ctx.font = isHovered ? 'bold 10px Inter, system-ui, sans-serif' : '9px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`L${i + 1}`, cx, gelTop - 6)

      // Store header hit region (label + well area)
      newHeaderRects.push({ laneIdx: i, x: lx - 2, y: gelTop - 16, w: laneWidth + 4, h: wellHeight + 18 })

      if (data.sizes.length === 0) continue

      // Count duplicate sizes for intensity
      const sizeCounts = new Map<number, number>()
      for (const s of data.sizes) {
        sizeCounts.set(s, (sizeCounts.get(s) || 0) + 1)
      }

      const isLadder = lanes[i].type === 'ladder'
      const bandColor = isLadder
        ? [100, 255, 100]
        : [80, 180, 255]

      // Compute max mass in this lane for mass-proportional scaling
      let maxMass = 0
      if (massIntensity) {
        for (const [sz, ct] of sizeCounts) {
          const m = sz * ct
          if (m > maxMass) maxMass = m
        }
      }

      for (const [size, count] of sizeCounts) {
        const y = sizeToY(size, gelPct, gelTop + wellHeight + 4, gelBottom)
        const intensity = massIntensity && maxMass > 0
          ? Math.max(0.15, Math.min(0.95, (size * count / maxMass) * 0.85 + 0.1))
          : Math.min(0.95, 0.4 + count * 0.2)
        const [r, g, b] = bandColor

        // Band glow
        ctx.fillStyle = `rgba(${r},${g},${b},${intensity * 0.12})`
        ctx.fillRect(lx + 1, y - 5, laneWidth - 2, 10)

        // Band
        const bh = massIntensity && maxMass > 0
          ? Math.max(bandHeight, Math.min(7, bandHeight + (size * count / maxMass) * 4))
          : Math.min(bandHeight + count - 1, 6)
        ctx.fillStyle = `rgba(${r},${g},${b},${intensity})`
        ctx.fillRect(lx + 3, y - bh / 2, laneWidth - 6, bh)

        newBandRects.push({ laneIdx: i, x: lx + 3, y: y - bh / 2, w: laneWidth - 6, h: bh, size, count })

        // Size labels on first ladder lane
        if (isLadder && i === lanes.findIndex(l => l.type === 'ladder')) {
          const isMajor = size >= 1000 && size % 1000 === 0
          ctx.fillStyle = isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)'
          ctx.textAlign = 'right'
          ctx.font = isMajor ? 'bold 8px Inter, system-ui, sans-serif' : '8px Inter, system-ui, sans-serif'
          ctx.fillText(formatSize(size), lx - 3, y + 3)
        }
      }
    }

    // Empty state - when no lane has any bands
    if (newBandRects.length === 0) {
      const cx = width / 2
      const cy = height / 2

      // Test tube icon (simple outline)
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const ix = cx, iy = cy - 28
      // Tube body
      ctx.beginPath()
      ctx.moveTo(ix - 6, iy)
      ctx.lineTo(ix - 6, iy + 24)
      ctx.quadraticCurveTo(ix - 6, iy + 32, ix, iy + 32)
      ctx.quadraticCurveTo(ix + 6, iy + 32, ix + 6, iy + 24)
      ctx.lineTo(ix + 6, iy)
      ctx.stroke()
      // Rim
      ctx.beginPath()
      ctx.moveTo(ix - 9, iy)
      ctx.lineTo(ix + 9, iy)
      ctx.stroke()
      ctx.restore()

      // Text
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = '13px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Configure lanes below to visualize fragments', cx, cy + 20)
    }

    // Gel percentage label in bottom-right corner
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.font = '10px Inter, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`${gelPct}% agarose`, width - 8, height - 6)

    // Canvas drag drop indicator
    const drag = canvasDragRef.current
    if (drag?.started && canvasDragTarget !== null && laneCount > 0) {
      const targetSlot = canvasDragTarget
      let indicatorX: number
      if (targetSlot >= laneCount) {
        // After last lane
        const lastHr = newHeaderRects[laneCount - 1]
        indicatorX = lastHr.x + lastHr.w + 1
      } else {
        indicatorX = newHeaderRects[targetSlot].x - laneGap / 2
      }

      // Glowing vertical line
      ctx.save()
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.8)'
      ctx.lineWidth = 2
      ctx.shadowColor = 'rgba(100, 200, 255, 0.6)'
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(indicatorX, gelTop - 12)
      ctx.lineTo(indicatorX, gelBottom + 4)
      ctx.stroke()
      ctx.restore()
    }

    bandRectsRef.current = newBandRects
    laneHeaderRectsRef.current = newHeaderRects
  }, [lanes, laneData, gelPct, hoveredLaneIdx, canvasDragTarget, massIntensity])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(draw, 30)
    return () => clearTimeout(t)
  }, [open, draw])

  useEffect(() => {
    if (!open) return
    const obs = new ResizeObserver(draw)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [open, draw])

  /** Move a lane from one index to another. Used by both table and canvas drag. */
  const moveLane = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return
    setLanes(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
      return next
    })
  }, [])

  // ---- Canvas drag-to-reorder helpers ----
  const DRAG_THRESHOLD = 4

  /** Compute which lane slot index the mouse X maps to (insertion point 0..laneCount). */
  const xToLaneSlot = useCallback((mx: number): number => {
    const headers = laneHeaderRectsRef.current
    if (headers.length === 0) return 0
    for (let i = 0; i < headers.length; i++) {
      const hr = headers[i]
      const mid = hr.x + hr.w / 2
      if (mx < mid) return i
    }
    return headers.length
  }, [])

  // ---- Canvas mousedown: start potential drag ----
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    for (const hr of laneHeaderRectsRef.current) {
      if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
        canvasDragRef.current = { laneIdx: hr.laneIdx, startX: e.clientX, started: false }
        return
      }
    }
  }, [])

  // ---- Tooltip on hover + lane header cursor + canvas drag ----
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left

    // Canvas drag in progress
    const drag = canvasDragRef.current
    if (drag) {
      const dx = Math.abs(e.clientX - drag.startX)
      if (!drag.started && dx >= DRAG_THRESHOLD) {
        drag.started = true
      }
      if (drag.started) {
        canvas.style.cursor = 'grabbing'
        setCanvasDragTarget(xToLaneSlot(mx))
        setTooltip(null)
        return
      }
    }

    const my = e.clientY - rect.top

    // Check lane headers for grab cursor + hover glow
    let newHoveredIdx: number | null = null
    for (const hr of laneHeaderRectsRef.current) {
      if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
        newHoveredIdx = hr.laneIdx
        break
      }
    }
    canvas.style.cursor = newHoveredIdx !== null ? 'grab' : ''
    if (newHoveredIdx !== hoveredLaneIdxRef.current) {
      hoveredLaneIdxRef.current = newHoveredIdx
      setHoveredLaneIdx(newHoveredIdx)
    }

    // Check bands for tooltip
    for (const br of bandRectsRef.current) {
      if (mx >= br.x && mx <= br.x + br.w && my >= br.y - 4 && my <= br.y + br.h + 4) {
        const label = br.count > 1 ? `${formatSize(br.size)} ×${br.count}` : formatSize(br.size)
        setTooltip({ x: e.clientX, y: e.clientY, text: label })
        return
      }
    }
    setTooltip(null)
  }, [xToLaneSlot])

  const handleCanvasMouseUp = useCallback(() => {
    const drag = canvasDragRef.current
    if (drag && drag.started) {
      canvasDragDidDrop.current = true
      const target = canvasDragTarget
      if (target !== null) {
        moveLane(drag.laneIdx, target)
      }
    }
    canvasDragRef.current = null
    setCanvasDragTarget(null)
  }, [canvasDragTarget, moveLane])

  const handleCanvasMouseLeave = useCallback(() => {
    setTooltip(null)
    if (hoveredLaneIdxRef.current !== null) {
      hoveredLaneIdxRef.current = null
      setHoveredLaneIdx(null)
    }
    // Cancel canvas drag if mouse leaves
    if (canvasDragRef.current) {
      canvasDragRef.current = null
      setCanvasDragTarget(null)
    }
  }, [])

  // ---- Click lane header to scroll table (suppressed during drag) ----
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // If a drag just completed, suppress the click
    if (canvasDragDidDrop.current) {
      canvasDragDidDrop.current = false
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    for (const hr of laneHeaderRectsRef.current) {
      if (mx >= hr.x && mx <= hr.x + hr.w && my >= hr.y && my <= hr.y + hr.h) {
        const lane = lanes[hr.laneIdx]
        if (!lane) return

        // Scroll the table row into view
        const row = tableWrapRef.current?.querySelector(`[data-lane-id="${lane.id}"]`) as HTMLElement | null
        if (row) {
          row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }

        // Flash highlight
        clearTimeout(highlightTimerRef.current)
        setHighlightedLaneId(lane.id)
        highlightTimerRef.current = window.setTimeout(() => setHighlightedLaneId(null), 1200)
        return
      }
    }
  }, [lanes])

  // ---- Lane management ----
  const addLane = useCallback(() => {
    if (lanes.length >= MAX_LANES) return
    setLanes(prev => [...prev, { id: nextLaneId(), type: 'digest', ladderName: DEFAULT_LADDER, sequenceTabId: '', enzymeNames: [] }])
  }, [lanes.length])

  const removeLane = useCallback((id: number) => {
    setLanes(prev => {
      const next = prev.filter(l => l.id !== id)
      return next.length > 0 ? next : prev
    })
    if (enzymePopoverLaneId === id) {
      setEnzymePopoverLaneId(null)
      setEnzymeFilter('')
      setEnzymeCategory('all')
      setCutCountFilter('any')
    }
  }, [enzymePopoverLaneId])

  const updateLane = useCallback((id: number, patch: Partial<LaneConfig>) => {
    setLanes(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }, [])

  // ---- Modal chrome ----
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (enzymePopoverLaneId !== null) {
        setEnzymePopoverLaneId(null)
        setEnzymeFilter('')
        setEnzymeCategory('all')
        setCutCountFilter('any')
      } else {
        onClose()
      }
    }
  }, [onClose, enzymePopoverLaneId])

  // Resolve popover lane and its sequence for cut count computation
  const popoverLane = enzymePopoverLaneId !== null ? lanes.find(l => l.id === enzymePopoverLaneId) : null
  const popoverTab = popoverLane ? tabs.find(t => t.id === popoverLane.sequenceTabId) : null
  const popoverBases = popoverTab?.doc.sequence.bases ?? ''
  const popoverTopology = popoverTab?.doc.sequence.topology ?? 'linear'

  // Compute cut counts per enzyme for the popover lane's sequence
  const enzymeCutCounts = useMemo(() => {
    const map = new Map<string, number>()
    if (!popoverBases) return map
    const pool = getEnzymesForCategory(enzymeCategory)
    for (const e of pool) {
      const sites = findCutSites(popoverBases, e, popoverTopology)
      map.set(e.name, sites.length)
    }
    return map
  }, [popoverBases, popoverTopology, enzymeCategory])

  // Filtered enzyme list for the popover
  const filteredEnzymes = useMemo(() => {
    let pool = getEnzymesForCategory(enzymeCategory)

    // Text search
    if (enzymeFilter) {
      const q = enzymeFilter.toLowerCase()
      pool = pool.filter(e => e.name.toLowerCase().includes(q) || e.recognition.toLowerCase().includes(q))
    }

    // Cut count filter (only when a sequence is selected)
    if (cutCountFilter !== 'any' && popoverBases) {
      pool = pool.filter(e => {
        const c = enzymeCutCounts.get(e.name) ?? 0
        switch (cutCountFilter) {
          case '0': return c === 0
          case '1': return c === 1
          case '2': return c === 2
          case '3+': return c >= 3
          default: return true
        }
      })
    }

    return pool
  }, [enzymeCategory, enzymeFilter, cutCountFilter, popoverBases, enzymeCutCounts])

  // ---- Export functions ----
  // Active doc name for export filenames
  const activeDocName = useEditorStore(s => s.doc.name) || 'virtual-gel'

  const exportGelPng = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const defaultName = `${activeDocName}-gel.png`
    const doExport = (filename: string) => {
      const link = document.createElement('a')
      link.download = filename
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    if (onExportPrompt) {
      onExportPrompt(defaultName, doExport)
    } else {
      doExport(defaultName)
    }
  }, [activeDocName, onExportPrompt])

  const exportGelSvg = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cs = getComputedStyle(container)
    const padL = parseFloat(cs.paddingLeft) || 0
    const padR = parseFloat(cs.paddingRight) || 0
    const width = container.clientWidth - padL - padR
    const height = 440

    const laneCount = lanes.length
    const gelTop = 44
    const gelBottom = height - 16
    const wellHeight = 7
    const bandHeight = 3
    const margin = 40
    const laneGap = 6
    const totalLaneWidth = width - margin * 2
    const laneWidth = Math.min(48, Math.max(24, (totalLaneWidth - laneGap * (laneCount - 1)) / laneCount))
    const totalUsed = laneCount * laneWidth + (laneCount - 1) * laneGap
    const startX = (width - totalUsed) / 2

    const els: string[] = []

    // Background
    els.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0d12"/><stop offset="1" stop-color="#0a0a0f"/></linearGradient></defs>`)
    els.push(`<rect width="${width}" height="${height}" fill="url(#bg)"/>`)
    els.push(`<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="rgba(255,255,255,0.08)"/>`)

    for (let i = 0; i < laneCount; i++) {
      const lx = startX + i * (laneWidth + laneGap)
      const cx = lx + laneWidth / 2
      const data = laneData[i]

      // Well
      els.push(`<rect x="${lx}" y="${gelTop}" width="${laneWidth}" height="${wellHeight}" fill="rgba(255,255,255,0.06)"/>`)

      // Lane label
      els.push(`<text x="${cx}" y="${gelTop - 6}" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-size="9" font-family="Inter, system-ui, sans-serif">L${i + 1}</text>`)

      if (data.sizes.length === 0) continue

      const sizeCounts = new Map<number, number>()
      for (const s of data.sizes) sizeCounts.set(s, (sizeCounts.get(s) || 0) + 1)

      const isLadder = lanes[i].type === 'ladder'
      const [r, g, b] = isLadder ? [100, 255, 100] : [80, 180, 255]

      let maxMass = 0
      if (massIntensity) {
        for (const [sz, ct] of sizeCounts) { const m = sz * ct; if (m > maxMass) maxMass = m }
      }

      for (const [size, count] of sizeCounts) {
        const y = sizeToY(size, gelPct, gelTop + wellHeight + 4, gelBottom)
        const intensity = massIntensity && maxMass > 0
          ? Math.max(0.15, Math.min(0.95, (size * count / maxMass) * 0.85 + 0.1))
          : Math.min(0.95, 0.4 + count * 0.2)

        const bh = massIntensity && maxMass > 0
          ? Math.max(bandHeight, Math.min(7, bandHeight + (size * count / maxMass) * 4))
          : Math.min(bandHeight + count - 1, 6)

        // Glow
        els.push(`<rect x="${lx + 1}" y="${y - 5}" width="${laneWidth - 2}" height="10" fill="rgba(${r},${g},${b},${(intensity * 0.12).toFixed(3)})"/>`)
        // Band
        els.push(`<rect x="${lx + 3}" y="${(y - bh / 2).toFixed(1)}" width="${laneWidth - 6}" height="${bh.toFixed(1)}" fill="rgba(${r},${g},${b},${intensity.toFixed(3)})"/>`)

        // Size labels on first ladder
        if (isLadder && i === lanes.findIndex(l => l.type === 'ladder')) {
          const isMajor = size >= 1000 && size % 1000 === 0
          const labelFill = isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)'
          const fw = isMajor ? ' font-weight="bold"' : ''
          els.push(`<text x="${lx - 3}" y="${y + 3}" text-anchor="end" fill="${labelFill}" font-size="8"${fw} font-family="Inter, system-ui, sans-serif">${formatSize(size)}</text>`)
        }
      }
    }

    // Gel % label
    els.push(`<text x="${width - 8}" y="${height - 6}" text-anchor="end" fill="rgba(255,255,255,0.35)" font-size="10" font-family="Inter, system-ui, sans-serif">${gelPct}% agarose</text>`)

    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${els.join('\n')}\n</svg>`

    const defaultName = `${activeDocName}-gel.svg`
    const doExport = (filename: string) => {
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const link = document.createElement('a')
      link.download = filename
      const url = URL.createObjectURL(blob)
      link.href = url
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    if (onExportPrompt) {
      onExportPrompt(defaultName, doExport)
    } else {
      doExport(defaultName)
    }
  }, [lanes, laneData, gelPct, massIntensity, activeDocName, onExportPrompt])

  const exportTableCsv = useCallback(() => {
    const defaultName = `${activeDocName}-gel-lanes.csv`
    const doExport = (filename: string) => {
      const header = 'Lane,Type,Source,Enzymes,# Fragments,Fragments (bp)'
      const rows = lanes.map((lane, idx) => {
        const data = laneData[idx]
        const type = lane.type.charAt(0).toUpperCase() + lane.type.slice(1)
        let source = ''
        if (lane.type === 'ladder') {
          source = lane.ladderName
        } else {
          const tab = tabs.find(t => t.id === lane.sequenceTabId)
          source = tab?.doc.name ?? ''
        }
        const enzymes = lane.type === 'digest' ? lane.enzymeNames.join('+') : ''
        const fragCount = data.sizes.length
        const fragments = data.sizes.sort((a, b) => b - a).join('; ')
        const esc = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
        return [idx + 1, type, esc(source), esc(enzymes), fragCount, esc(fragments)].join(',')
      })
      const csv = [header, ...rows].join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const link = document.createElement('a')
      link.download = filename
      const url = URL.createObjectURL(blob)
      link.href = url
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    if (onExportPrompt) {
      onExportPrompt(defaultName, doExport)
    } else {
      doExport(defaultName)
    }
  }, [activeDocName, lanes, laneData, tabs, onExportPrompt])

  const exportPdf = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rows = lanes.map((lane, idx) => {
      const data = laneData[idx]
      const type = lane.type.charAt(0).toUpperCase() + lane.type.slice(1)
      let source = ''
      if (lane.type === 'ladder') {
        source = lane.ladderName
      } else {
        const tab = tabs.find(t => t.id === lane.sequenceTabId)
        source = tab?.doc.name ?? ''
      }
      const enzymes = lane.type === 'digest' ? lane.enzymeNames.join(' + ') : ''
      const fragCount = data.sizes.length
      const fragments = data.sizes.sort((a, b) => b - a).map(s => formatSize(s)).join(', ')
      return { lane: idx + 1, type, source, enzymes, fragCount, fragments }
    })
    exportGelPdf(canvas, rows, gelPct)
  }, [lanes, laneData, tabs, gelPct])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog gel-modal">
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title">Virtual Gel</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        {/* Top bar */}
        <div className="gel-topbar">
          <label className="gel-pct-label">
            Gel %
            <select
              className="select gel-pct-select"
              value={gelPct}
              onChange={e => setGelPct(Number(e.target.value) as GelPercentage)}
            >
              {GEL_PERCENTAGES.map(p => (
                <option key={p} value={p}>{p}%</option>
              ))}
            </select>
          </label>
          <span className="gel-lane-count">{lanes.length} / {MAX_LANES} lanes</span>
          <label className="gel-mass-toggle" title="Scale band brightness by DNA mass (size × count)">
            <input type="checkbox" checked={massIntensity} onChange={e => setMassIntensity(e.target.checked)} />
            <span>Mass</span>
          </label>
          <div className="gel-export-wrap" ref={exportRef}>
            <button className="gel-export-trigger" onClick={() => setExportOpen(o => !o)}>
              <Download size={13} />
              Export
              <ChevronDown size={12} />
            </button>
            {exportOpen && (
              <div className="gel-export-menu">
                <button className="gel-export-item" onClick={() => { exportGelPng(); setExportOpen(false) }}>
                  <span className="gel-export-label">PNG</span>
                  <span className="gel-export-desc">Raster image</span>
                </button>
                <button className="gel-export-item" onClick={() => { exportGelSvg(); setExportOpen(false) }}>
                  <span className="gel-export-label">SVG</span>
                  <span className="gel-export-desc">Vector image</span>
                </button>
                <button className="gel-export-item" onClick={() => { exportTableCsv(); setExportOpen(false) }}>
                  <span className="gel-export-label">CSV</span>
                  <span className="gel-export-desc">Lane table</span>
                </button>
                <button className="gel-export-item" onClick={() => { exportPdf(); setExportOpen(false) }}>
                  <span className="gel-export-label">PDF</span>
                  <span className="gel-export-desc">Gel + table</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Gel canvas */}
        <div className="gel-scroll-area">
        <div className="gel-canvas-wrap" ref={containerRef}>
          <canvas
            ref={canvasRef}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseLeave}
            onClick={handleCanvasClick}
          />
          {tooltip && (
            <div
              className="gel-tooltip"
              style={{
                position: 'fixed',
                left: tooltip.x + 12,
                top: tooltip.y - 8,
              }}
            >
              {tooltip.text}
            </div>
          )}
        </div>

        {/* Lane table */}
        <div className="gel-table-wrap" ref={tableWrapRef}>
          <table className="gel-table">
            <thead>
              <tr>
                <th className="gel-th gel-th-grip"></th>
                <th className="gel-th gel-th-lane">Lane</th>
                <th className="gel-th gel-th-type">Type</th>
                <th className="gel-th gel-th-source">Sequence / Ladder</th>
                <th className="gel-th gel-th-enzymes">Enzymes</th>
                <th className="gel-th gel-th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {lanes.map((lane, idx) => {
                const data = laneData[idx]
                const fragSizes = data.sizes.length > 0 ? [...data.sizes].sort((a, b) => b - a) : []
                const isExpanded = expandedLanes.has(lane.id)
                const hasFrags = fragSizes.length > 0
                return (<React.Fragment key={lane.id}>
                <tr
                  className={`gel-tr ${highlightedLaneId === lane.id ? 'gel-tr-highlight' : ''} ${tableDragIdx === idx ? 'gel-tr-dragging' : ''} ${tableDropIdx === idx ? 'gel-tr-drop-above' : ''}`}
                  data-lane-id={lane.id}
                  draggable
                  onDragStart={e => {
                    setTableDragIdx(idx)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(idx))
                  }}
                  onDragEnd={() => { setTableDragIdx(null); setTableDropIdx(null) }}
                  onDragOver={e => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (tableDragIdx !== null && idx !== tableDragIdx) {
                      setTableDropIdx(idx)
                    }
                  }}
                  onDragLeave={() => { if (tableDropIdx === idx) setTableDropIdx(null) }}
                  onDrop={e => {
                    e.preventDefault()
                    const fromIdx = tableDragIdx
                    if (fromIdx !== null && fromIdx !== idx) {
                      moveLane(fromIdx, idx)
                    }
                    setTableDragIdx(null)
                    setTableDropIdx(null)
                  }}
                >
                  {/* Drag handle */}
                  <td className="gel-td gel-td-grip">
                    <GripVertical size={12} className="gel-grip-icon" />
                  </td>
                  {/* Lane # with expand chevron */}
                  <td className="gel-td gel-td-lane">
                    <button
                      className={`gel-lane-expand ${hasFrags ? '' : 'disabled'}`}
                      onClick={() => hasFrags && toggleLaneExpand(lane.id)}
                      tabIndex={hasFrags ? 0 : -1}
                    >
                      {hasFrags && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                      {idx + 1}
                    </button>
                  </td>

                  {/* Type */}
                  <td className="gel-td gel-td-type">
                    <div className="toggle-group">
                      {(['ladder', 'digest', 'uncut'] as LaneType[]).map(t => (
                        <button
                          key={t}
                          className={`toggle-btn ${lane.type === t ? 'active' : ''}`}
                          onClick={() => updateLane(lane.id, { type: t })}
                        >
                          {t === 'ladder' ? 'Ladder' : t === 'digest' ? 'Digest' : 'Uncut'}
                        </button>
                      ))}
                    </div>
                  </td>

                  {/* Sequence / Ladder dropdown */}
                  <td className="gel-td gel-td-source">
                    {lane.type === 'ladder' ? (
                      <select
                        className="select gel-cfg-select"
                        value={lane.ladderName}
                        onChange={e => updateLane(lane.id, { ladderName: e.target.value })}
                      >
                        {LADDERS.map(l => (
                          <option key={l.name} value={l.name}>{l.name}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className="select gel-cfg-select"
                        value={lane.sequenceTabId}
                        onChange={e => updateLane(lane.id, { sequenceTabId: e.target.value })}
                      >
                        <option value="">– Select –</option>
                        {tabs.map(t => (
                          <option key={t.id} value={t.id}>{t.doc.name}</option>
                        ))}
                      </select>
                    )}
                  </td>

                  {/* Enzymes */}
                  <td className="gel-td gel-td-enzymes">
                    {lane.type === 'digest' ? (
                      <div className="gel-enzyme-cell">
                        {lane.enzymeNames.map(name => (
                          <span key={name} className="gel-enzyme-pill">
                            {name}
                            <button
                              className="gel-pill-x"
                              onClick={() => updateLane(lane.id, { enzymeNames: lane.enzymeNames.filter(n => n !== name) })}
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        <button
                          className="gel-enzyme-add-btn"
                          onClick={(ev) => {
                            if (enzymePopoverLaneId === lane.id) {
                              setEnzymePopoverLaneId(null)
                              setEnzymeCategory('all')
                              setCutCountFilter('any')
                            } else {
                              const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
                              setEnzymePopoverPos({ top: rect.bottom + 4, left: rect.left })
                              setEnzymePopoverLaneId(lane.id)
                            }
                            setEnzymeFilter('')
                          }}
                          title="Add enzyme"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    ) : (
                      <span className="gel-td-muted">–</span>
                    )}
                  </td>

                  {/* Remove */}
                  <td className="gel-td gel-td-actions">
                    {lanes.length > 1 && (
                      <button
                        className="gel-row-remove"
                        onClick={() => removeLane(lane.id)}
                        title="Remove lane"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && hasFrags && (
                  <tr className="gel-tr-detail">
                    <td colSpan={6} className="gel-td-detail">
                      <span className="gel-frag-count">{fragSizes.length} fragment{fragSizes.length !== 1 ? 's' : ''}</span>
                      <div className="gel-frag-chips">
                        {fragSizes.map((s, fi) => (
                          <span key={fi} className="gel-frag-chip">{formatSize(s)}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>)
              })}
            </tbody>
          </table>

          <button
            className="btn-add gel-add-lane-btn"
            onClick={addLane}
            disabled={lanes.length >= MAX_LANES}
          >
            <Plus size={13} /> Add Lane
          </button>
        </div>
        </div>{/* end gel-scroll-area */}

      </div>

      {/* Enzyme popover - rendered outside modal-dialog to escape overflow/transform clipping */}
      {enzymePopoverLaneId !== null && popoverLane && (
        <div
          className="gel-enzyme-popover"
          ref={enzymePopoverRef}
          style={{ top: enzymePopoverPos.top, left: enzymePopoverPos.left }}
        >
          {/* Category dropdown */}
          <div className="gel-ep-controls">
            <select
              className="select gel-ep-category"
              value={enzymeCategory}
              onChange={e => setEnzymeCategory(e.target.value as EnzymeCategoryKey)}
            >
              {ENZYME_CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Cut count filter */}
          {popoverBases && (
            <div className="gel-ep-cuts">
              <span className="gel-ep-cuts-label">Cuts:</span>
              {(['any', '0', '1', '2', '3+'] as CutCountFilter[]).map(v => (
                <button
                  key={v}
                  className={`gel-ep-cut-btn ${cutCountFilter === v ? 'active' : ''}`}
                  onClick={() => setCutCountFilter(v)}
                >
                  {v === 'any' ? 'Any' : v === '0' ? '0' : v === '3+' ? '3+' : v}
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <input
            ref={enzymeInputRef}
            className="gel-enzyme-input"
            type="text"
            placeholder="Search enzymes..."
            value={enzymeFilter}
            onChange={e => setEnzymeFilter(e.target.value)}
          />

          {/* Results */}
          <div className="gel-enzyme-dropdown">
            {filteredEnzymes.length === 0 && (
              <div className="gel-enzyme-empty">No matches</div>
            )}
            {filteredEnzymes.slice(0, 30).map(e => {
              const cuts = enzymeCutCounts.get(e.name)
              const isSelected = popoverLane.enzymeNames.includes(e.name)
              return (
                <button
                  key={e.name}
                  className={`gel-enzyme-option ${isSelected ? 'selected' : ''}`}
                  onMouseDown={ev => {
                    ev.stopPropagation()
                    const laneId = popoverLane.id
                    const name = e.name
                    setLanes(prev => prev.map(l => {
                      if (l.id !== laneId) return l
                      const has = l.enzymeNames.includes(name)
                      return { ...l, enzymeNames: has ? l.enzymeNames.filter(n => n !== name) : [...l.enzymeNames, name] }
                    }))
                  }}
                >
                  <span className="gel-eo-name">{e.name}</span>
                  <span className="gel-enzyme-rec">{e.recognition}</span>
                  {cuts !== undefined && (
                    <span className={`gel-eo-cuts ${cuts === 0 ? 'zero' : ''}`}>{cuts}×</span>
                  )}
                </button>
              )
            })}
            {filteredEnzymes.length > 30 && (
              <div className="gel-enzyme-empty">
                {filteredEnzymes.length - 30} more – refine search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
