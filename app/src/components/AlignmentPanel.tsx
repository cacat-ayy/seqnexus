import './AlignmentPanel.css'
/**
 * Alignment viewer panel.
 *
 * Renders aligned sequences in a scrollable monospace grid with:
 * - Fixed left gutter for sequence names
 * - Color-coded residues (DNA or protein)
 * - Consensus row and conservation bar
 * - Column click tooltip
 * - Wrap toggle
 * - Statistics in the header
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { WrapText, Copy, Diff, ChevronDown, ChevronUp, Palette, ChevronLeft, ChevronRight, SlidersHorizontal, X, ArrowRightLeft, ExternalLink } from 'lucide-react'
import type { AlignmentResult } from '../alignment/types'

/** Heatmap color for pairwise identity (0–1). Red → yellow → green. */
function identityColor(val: number): string {
  // Clamp to 0–1 and map to a red-yellow-green gradient
  const t = Math.max(0, Math.min(1, val))
  // 0.0 = red (0,80,60), 0.5 = yellow (60,80,60), 1.0 = green (120,70,45)
  let h: number, s: number, l: number
  if (t < 0.5) {
    const u = t / 0.5
    h = u * 60          // 0 → 60
    s = 80
    l = 35 + u * 10     // 35 → 45
  } else {
    const u = (t - 0.5) / 0.5
    h = 60 + u * 60     // 60 → 120
    s = 80 - u * 10     // 80 → 70
    l = 45 - u * 5      // 45 → 40
  }
  return `hsl(${h}, ${s}%, ${l}%)`
}

const ALGORITHM_LABELS: Record<string, { short: string; full: string }> = {
  nw: { short: 'NW', full: 'Needleman-Wunsch (global pairwise)' },
  sw: { short: 'SW', full: 'Smith-Waterman (local pairwise)' },
  msa: { short: 'MSA', full: 'Progressive multiple sequence alignment' },
}

/** Zoom levels: [cellWidth, fontSize] – levels 0-3 hide letters and show colored blocks */
const ZOOM_LEVELS: [number, number][] = [
  [1, 0],   // 0 - overview, no letters
  [2, 0],   // 1 - overview, no letters
  [3, 0],   // 2 - mini blocks, no letters
  [4, 0],   // 3 - small blocks, no letters
  [6, 7],   // 4 - smallest with letters
  [7, 8],   // 5
  [8, 9],   // 6
  [10, 11], // 7 - default
  [14, 13], // 8
  [18, 16], // 9 - most zoomed in
]

const DEFAULT_ALIGN_ZOOM = 7

interface Props {
  result: AlignmentResult
  seqType: 'dna' | 'protein'
  algorithm?: 'nw' | 'sw' | 'msa' | 'mafft'
  zoomLevel?: number
  alignmentId?: string
  onZoomChange?: (level: number) => void
  onCopy: (format: 'fasta' | 'clustal') => void
  onAnnotateDiffs: () => void
  onJumpToSource?: (seqName: string, ungappedPos: number) => void
  /** Externally controlled search open state. */
  externalSearchOpen?: boolean
  /** Called when the alignment's search panel is closed. */
  onSearchClose?: () => void
}

// Residue coloring
function dnaClass(ch: string): string {
  const u = ch.toUpperCase()
  if (u === '-') return 'gap'
  if (u === 'A' || u === 'C' || u === 'G' || u === 'T' || u === 'U') return `dna-${u}`
  return ''
}

const HYDROPHOBIC = new Set('AVILMFWP'.split(''))
const POSITIVE = new Set('KRH'.split(''))
const NEGATIVE = new Set('DE'.split(''))
const POLAR = new Set('STNQ'.split(''))
const AROMATIC = new Set('FYW'.split(''))

function proteinClass(ch: string): string {
  const u = ch.toUpperCase()
  if (u === '-') return 'gap'
  if (u === 'C') return 'aa-cysteine'
  if (u === 'G') return 'aa-glycine'
  if (AROMATIC.has(u)) return 'aa-aromatic'
  if (HYDROPHOBIC.has(u)) return 'aa-hydrophobic'
  if (POSITIVE.has(u)) return 'aa-positive'
  if (NEGATIVE.has(u)) return 'aa-negative'
  if (POLAR.has(u)) return 'aa-polar'
  return ''
}

function conservationColor(value: number): string {
  // Red (low) → yellow (mid) → green (high)
  if (value >= 0.8) return '#22c55e'
  if (value >= 0.6) return '#84cc16'
  if (value >= 0.4) return '#eab308'
  if (value >= 0.2) return '#f97316'
  return '#ef4444'
}

const GUTTER_WIDTH = 150 // approximate gutter width in px
const MIN_COLS = 20

/** Virtualized block renderer for wrapped mode – only renders blocks near the viewport. */
function VirtualizedBlocks({
  blocks,
  renderBlock,
  viewerRef,
  scrollTick,
  rowCount,
  cellH,
}: {
  blocks: { start: number; end: number }[]
  renderBlock: (startCol: number, endCol: number, blockKey: string) => React.ReactNode
  viewerRef: React.RefObject<HTMLDivElement | null>
  scrollTick: number
  rowCount: number
  cellH: number
}) {
  // Estimate block height: ruler + consensus + sequences + conservation + gaps/margins
  const blockH = (rowCount + 3) * Math.max(cellH + 2, 18) + 12

  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 5])

  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const scrollTop = el.scrollTop
    const viewH = el.clientHeight
    const first = Math.max(0, Math.floor(scrollTop / blockH) - 1)
    const last = Math.min(blocks.length - 1, Math.ceil((scrollTop + viewH) / blockH) + 1)
    setVisibleRange([first, last])
  }, [scrollTick, blocks.length, blockH, viewerRef])

  const totalH = blocks.length * blockH

  return (
    <div style={{ height: totalH, position: 'relative' }}>
      {blocks.map((b, i) => {
        if (i < visibleRange[0] || i > visibleRange[1]) return null
        return (
          <div key={i} style={{ position: 'absolute', top: i * blockH, left: 0, right: 0 }}>
            {renderBlock(b.start, b.end, `block-${i}`)}
          </div>
        )
      })}
    </div>
  )
}

export default function AlignmentPanel({ result, seqType, algorithm, zoomLevel = DEFAULT_ALIGN_ZOOM, onZoomChange, onCopy, onAnnotateDiffs, onJumpToSource, externalSearchOpen, onSearchClose }: Props) {
  const [wrapped, setWrapped] = useState(false)
  const [colorMode, setColorMode] = useState(false) // conservation coloring
  const [hoveredRow, setHoveredRow] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; col: number } | null>(null)
  const [matrixOpen, setMatrixOpen] = useState(false)
  const [diffsAnnotated, setDiffsAnnotated] = useState(false)
  const [dynamicCols, setDynamicCols] = useState(80)
  const viewerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)

  // Column range selection
  const [selStart, setSelStart] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const isDraggingSelection = useRef(false)

  const selRange = useMemo<[number, number] | null>(() => {
    if (selStart === null || selEnd === null) return null
    return [Math.min(selStart, selEnd), Math.max(selStart, selEnd)]
  }, [selStart, selEnd])

  const handleCellMouseDown = useCallback((col: number) => {
    isDraggingSelection.current = true
    setSelStart(col)
    setSelEnd(col)
  }, [])

  const handleCellMouseEnter = useCallback((col: number) => {
    if (isDraggingSelection.current) setSelEnd(col)
  }, [])

  useEffect(() => {
    const handleUp = () => { isDraggingSelection.current = false }
    window.addEventListener('mouseup', handleUp)
    return () => window.removeEventListener('mouseup', handleUp)
  }, [])

  // Conservation threshold filter
  const [conservationThreshold, setConservationThreshold] = useState(0) // 0 = show all
  const [showThresholdSlider, setShowThresholdSlider] = useState(false)

  // Find in alignment
  const [searchOpenInternal, setSearchOpenInternal] = useState(false)
  const searchOpen = externalSearchOpen || searchOpenInternal
  const closeSearch = useCallback(() => {
    setSearchOpenInternal(false)
    setSearchQuery('')
    setSearchHits([])
    if (onSearchClose) onSearchClose()
  }, [onSearchClose])
  useEffect(() => {
    if (externalSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }, [externalSearchOpen])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHits, setSearchHits] = useState<{ seqIdx: number; col: number; len: number }[]>([])
  const [searchHitIdx, setSearchHitIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Context menu (for jump-to-source and copy stats)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; col: number } | null>(null)

  // Zoom CSS vars
  const zoomIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomLevel))
  const [cellW, fontSize] = ZOOM_LEVELS[zoomIdx]
  const showLetters = fontSize > 0
  const zoomStyle = {
    '--align-cell-w': `${cellW}px`,
    '--align-font-size': showLetters ? `${fontSize}px` : '0px',
  } as React.CSSProperties

  // Ctrl+Scroll zoom
  useEffect(() => {
    const el = panelRef.current
    if (!el || !onZoomChange) return
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const dir = e.deltaY < 0 ? 1 : -1
      const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomLevel + dir))
      if (next !== zoomLevel) onZoomChange(next)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [zoomLevel, onZoomChange])

  // Vertical wheel → horizontal scroll in linear (non-wrapped) mode
  useEffect(() => {
    const el = viewerRef.current
    if (!el || wrapped) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [wrapped])

  // Dynamic wrap width via ResizeObserver
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        const cols = Math.max(MIN_COLS, Math.floor((w - GUTTER_WIDTH) / cellW))
        setDynamicCols(cols)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [cellW])

  // Track scroll position for minimap viewport indicator
  const [scrollTick, setScrollTick] = useState(0)

  // Draw minimap
  useEffect(() => {
    const el = minimapRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w === 0 || h === 0) return
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    for (let px = 0; px < w; px++) {
      const col = Math.floor((px / w) * result.alignmentLength)
      const val = result.conservation[col] ?? 0
      ctx.fillStyle = conservationColor(val)
      ctx.fillRect(px, h * (1 - val), 1, h * val)
    }
    // Selection overlay
    if (selRange) {
      const x0 = (selRange[0] / result.alignmentLength) * w
      const x1 = ((selRange[1] + 1) / result.alignmentLength) * w
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'
      ctx.fillRect(x0, 0, x1 - x0, h)
    }
    // Viewport indicator
    if (viewerRef.current) {
      const scrollLeft = viewerRef.current.scrollLeft
      const clientW = viewerRef.current.clientWidth
      const totalW = result.alignmentLength * cellW
      if (totalW > clientW) {
        const vx = (scrollLeft / totalW) * w
        const vw = Math.max(2, (clientW / totalW) * w)
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth = 1.5
        ctx.strokeRect(vx, 0.5, vw, h - 1)
      }
    }
  }, [result, selRange, cellW, scrollTick, wrapped])

  const { sequences, consensus, conservation, identity, similarity, gaps, alignmentLength, score, pairwiseIdentityMatrix } = result
  const alnLen = alignmentLength
  const isPairwise = sequences.length === 2

  const colorFn = seqType === 'dna' ? dnaClass : proteinClass

  // Determine mismatch columns (for pairwise highlighting)
  const mismatchCols = useMemo(() => {
    if (!isPairwise) return new Set<number>()
    const set = new Set<number>()
    const a = sequences[0].alignedBases
    const b = sequences[1].alignedBases
    for (let i = 0; i < alnLen; i++) {
      if (a[i] !== '-' && b[i] !== '-' && a[i].toUpperCase() !== b[i].toUpperCase()) {
        set.add(i)
      }
    }
    return set
  }, [sequences, alnLen, isPairwise])

  // Search effect – find motif in aligned sequences
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchHits([]); return }
    const q = searchQuery.toUpperCase()
    const hits: { seqIdx: number; col: number; len: number }[] = []
    // Search in consensus
    const consStr = consensus.toUpperCase()
    let idx = consStr.indexOf(q)
    while (idx !== -1) {
      hits.push({ seqIdx: -1, col: idx, len: q.length })
      idx = consStr.indexOf(q, idx + 1)
    }
    // Search in each sequence
    for (let si = 0; si < sequences.length; si++) {
      const seqStr = sequences[si].alignedBases.toUpperCase()
      idx = seqStr.indexOf(q)
      while (idx !== -1) {
        hits.push({ seqIdx: si, col: idx, len: q.length })
        idx = seqStr.indexOf(q, idx + 1)
      }
    }
    hits.sort((a, b) => a.col - b.col || a.seqIdx - b.seqIdx)
    setSearchHits(hits)
    setSearchHitIdx(0)
  }, [searchQuery, consensus, sequences])

  // Jump to current search hit
  const jumpToSearchHit = useCallback((idx: number) => {
    if (searchHits.length === 0) return
    const clamped = ((idx % searchHits.length) + searchHits.length) % searchHits.length
    setSearchHitIdx(clamped)
    const hit = searchHits[clamped]
    const viewer = viewerRef.current
    if (viewer && !wrapped) {
      viewer.scrollLeft = Math.max(0, hit.col * cellW - viewer.clientWidth / 2)
    }
    setSelStart(hit.col)
    setSelEnd(hit.col + hit.len - 1)
  }, [searchHits, cellW, wrapped])

  // Build a set of highlighted columns from search hits for fast lookup
  const searchHighlightCols = useMemo(() => {
    if (searchHits.length === 0) return new Set<number>()
    const set = new Set<number>()
    for (const hit of searchHits) {
      for (let c = hit.col; c < hit.col + hit.len; c++) set.add(c)
    }
    return set
  }, [searchHits])

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  // Mismatch/difference columns (sorted) – for all alignment types
  const diffCols = useMemo(() => {
    const cols: number[] = []
    for (let i = 0; i < alnLen; i++) {
      if (conservation[i] < 1) cols.push(i)
    }
    return cols
  }, [conservation, alnLen])

  const [currentDiffIdx, setCurrentDiffIdx] = useState(0)

  const jumpToDiff = useCallback((idx: number) => {
    if (diffCols.length === 0) return
    const clamped = ((idx % diffCols.length) + diffCols.length) % diffCols.length
    setCurrentDiffIdx(clamped)
    const col = diffCols[clamped]
    // Scroll to the column
    const viewer = viewerRef.current
    if (viewer && !wrapped) {
      const scrollLeft = col * cellW - viewer.clientWidth / 2
      viewer.scrollLeft = Math.max(0, scrollLeft)
    }
    // Highlight the column briefly via selection
    setSelStart(col)
    setSelEnd(col)
  }, [diffCols, cellW, wrapped])

  const nextDiff = useCallback(() => jumpToDiff(currentDiffIdx + 1), [jumpToDiff, currentDiffIdx])
  const prevDiff = useCallback(() => jumpToDiff(currentDiffIdx - 1), [jumpToDiff, currentDiffIdx])

  // Column click handler
  const handleColClick = useCallback((e: React.MouseEvent, col: number) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setCtxMenu(null)
    setTooltip(prev => prev?.col === col ? null : { x: rect.left, y: rect.bottom + 4, col })
  }, [])

  // Close tooltip on scroll or click outside
  const handleScroll = useCallback(() => {
    setTooltip(null)
    setScrollTick(t => t + 1)
  }, [])

  useEffect(() => {
    if (!tooltip) return
    let downOutside = false
    const isInside = (target: HTMLElement) =>
      !!target.closest('.align-col-tooltip') || !!target.closest('.align-cell')
    const handleDown = (e: MouseEvent) => {
      downOutside = !isInside(e.target as HTMLElement)
    }
    const handleUp = (e: MouseEvent) => {
      if (downOutside && !isInside(e.target as HTMLElement)) setTooltip(null)
      downOutside = false
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTooltip(null)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('keydown', handleKey)
    }
  }, [tooltip])

  // Compute column from a mouse event on a cell within .align-cols
  const colFromEvent = useCallback((e: React.MouseEvent, startCol: number): number | null => {
    const cell = (e.target as HTMLElement).closest('.align-cell, .align-ruler-cell, .align-conservation-cell') as HTMLElement | null
    if (!cell) return null
    const parent = cell.parentElement
    if (!parent) return null
    const idx = Array.prototype.indexOf.call(parent.children, cell)
    if (idx < 0) return null
    return startCol + idx
  }, [])

  // Render a block of columns
  const renderBlock = (startCol: number, endCol: number, blockKey: string) => {
    const cols = endCol - startCol

    // Event delegation handlers for the columns container
    const handleColsClick = (e: React.MouseEvent) => {
      const col = colFromEvent(e, startCol)
      if (col !== null) handleColClick(e, col)
    }
    const handleColsMouseDown = (e: React.MouseEvent) => {
      const col = colFromEvent(e, startCol)
      if (col !== null) handleCellMouseDown(col)
    }
    const handleColsMouseMove = (e: React.MouseEvent) => {
      const col = colFromEvent(e, startCol)
      if (col !== null) handleCellMouseEnter(col)
    }

    return (
      <div className="align-wrap-block" key={blockKey}>
        {/* Gutter */}
        <div className="align-gutter">
          {/* Ruler gutter */}
          <div className="align-gutter-row align-gutter-ruler" />
          {/* Consensus label */}
          <div className="align-gutter-row consensus-row">Consensus</div>
          {/* Sequence names */}
          {sequences.map((seq, i) => (
            <div
              key={i}
              className={`align-gutter-row ${hoveredRow === i ? 'highlighted' : ''}`}
              onMouseEnter={() => setHoveredRow(i)}
              onMouseLeave={() => setHoveredRow(null)}
              title={seq.name}
            >
              <span className="align-gutter-name">{seq.name}</span>
              {onJumpToSource && (
                <button
                  className="align-gutter-jump"
                  title={`Go to ${seq.name}`}
                  onClick={(e) => { e.stopPropagation(); onJumpToSource(seq.name, 0) }}
                >
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
          ))}
          {/* Conservation label */}
          <div className="align-gutter-row conservation-row">Conserv.</div>
        </div>

        {/* Columns – event delegation */}
        <div
          className="align-cols"
          onClick={handleColsClick}
          onMouseDown={handleColsMouseDown}
          onMouseMove={handleColsMouseMove}
          onContextMenu={e => {
            const col = colFromEvent(e, startCol)
            if (col !== null) {
              e.preventDefault()
              setTooltip(null)
              setCtxMenu({ x: e.clientX, y: e.clientY, col })
            }
          }}
        >
          {/* Ruler */}
          <div className="align-ruler-row">
            {Array.from({ length: cols }, (_, ci) => {
              const col = startCol + ci
              const pos = col + 1
              const showLabel = pos === 1 || pos % 10 === 0
              const isSelected = selRange && col >= selRange[0] && col <= selRange[1]
              const ungappedPos = showLabel && ungappedMaps[0] ? ungappedMaps[0][col] : null
              const label = showLabel
                ? (ungappedPos && ungappedPos !== pos ? `${pos}(${ungappedPos})` : String(pos))
                : ''
              return (
                <span key={ci} className={`align-ruler-cell${isSelected ? ' selected' : ''}`}>
                  {label}
                </span>
              )
            })}
          </div>

          {/* Consensus row */}
          <div className="align-row">
            {Array.from({ length: cols }, (_, ci) => {
              const col = startCol + ci
              const ch = consensus[col] ?? '-'
              const isSelected = selRange && col >= selRange[0] && col <= selRange[1]
              const dimmed = conservationThreshold > 0 && (conservation[col] ?? 0) >= conservationThreshold
              return (
                <span
                  key={ci}
                  className={`align-cell ${colorFn(ch)}${isSelected ? ' selected' : ''}${dimmed ? ' threshold-dim' : ''}`}
                >
                  {ch}
                </span>
              )
            })}
          </div>

          {/* Sequence rows */}
          {sequences.map((seq, i) => (
            <div
              key={i}
              className={`align-row ${hoveredRow === i ? 'highlighted' : ''}`}
              onMouseEnter={() => setHoveredRow(i)}
              onMouseLeave={() => setHoveredRow(null)}
            >
              {Array.from({ length: cols }, (_, ci) => {
                const col = startCol + ci
                const ch = seq.alignedBases[col] ?? '-'
                const isMismatch = mismatchCols.has(col) && ch !== '-'
                const isSelected = selRange && col >= selRange[0] && col <= selRange[1]
                const dimmed = conservationThreshold > 0 && (conservation[col] ?? 0) >= conservationThreshold
                const isSearchHit = searchHighlightCols.has(col)
                const bgStyle = colorMode && ch !== '-'
                  ? { background: conservationColor(conservation[col] ?? 0), color: '#fff' }
                  : undefined
                return (
                  <span
                    key={ci}
                    className={`align-cell ${colorFn(ch)} ${isMismatch ? 'mismatch' : ''}${isSelected ? ' selected' : ''}${dimmed ? ' threshold-dim' : ''}${isSearchHit ? ' search-hit' : ''}`}
                    style={bgStyle}
                  >
                    {ch}
                  </span>
                )
              })}
              {wrapped && (
                <span className="align-row-pos">
                  {ungappedMaps[i]?.[endCol - 1] ?? ''}
                </span>
              )}
            </div>
          ))}

          {/* Conservation bar */}
          <div className="align-row">
            {Array.from({ length: cols }, (_, ci) => {
              const col = startCol + ci
              const val = conservation[col] ?? 0
              const isSelected = selRange && col >= selRange[0] && col <= selRange[1]
              const dimmed = conservationThreshold > 0 && val >= conservationThreshold
              return (
                <span key={ci} className={`align-conservation-cell${isSelected ? ' selected' : ''}${dimmed ? ' threshold-dim' : ''}`}>
                  <span
                    className="align-conservation-bar"
                    style={{
                      height: `${Math.round(val * 100)}%`,
                      background: conservationColor(val),
                    }}
                  />
                  {conservationThreshold > 0 && (
                    <span
                      className="align-threshold-line"
                      style={{ bottom: `${Math.round(conservationThreshold * 100)}%` }}
                    />
                  )}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Precompute ungapped position maps for each sequence
  const ungappedMaps = useMemo(() => {
    return sequences.map(seq => {
      const map: number[] = []
      let pos = 0
      for (let i = 0; i < seq.alignedBases.length; i++) {
        if (seq.alignedBases[i] !== '-') pos++
        map.push(pos)
      }
      return map
    })
  }, [sequences])

  // Build blocks
  const colsPerBlock = dynamicCols
  const blocks = useMemo(() => {
    if (!wrapped) return [{ start: 0, end: alnLen }]
    const result: { start: number; end: number }[] = []
    for (let i = 0; i < alnLen; i += colsPerBlock) {
      result.push({ start: i, end: Math.min(i + colsPerBlock, alnLen) })
    }
    return result
  }, [wrapped, alnLen, colsPerBlock])

  return (
    <div className={`align-panel ${showLetters ? '' : 'block-mode'}`} ref={panelRef} style={zoomStyle}>
      {/* Header */}
      <div className="align-panel-header">
        <span className="align-panel-title">Alignment</span>

        {algorithm && (
          <span className="align-algo-badge" title={ALGORITHM_LABELS[algorithm]?.full}>
            {ALGORITHM_LABELS[algorithm]?.short ?? algorithm.toUpperCase()}
          </span>
        )}

        <div className="align-panel-stats">
          <span className="align-panel-stat">
            Identity: <span className="align-panel-stat-val">{(identity * 100).toFixed(1)}%</span>
          </span>
          {isPairwise && (
            <span className="align-panel-stat">
              Similarity: <span className="align-panel-stat-val">{(similarity * 100).toFixed(1)}%</span>
            </span>
          )}
          <span className="align-panel-stat">
            Gaps: <span className="align-panel-stat-val">{(gaps * 100).toFixed(1)}%</span>
          </span>
          <span className="align-panel-stat">
            Length: <span className="align-panel-stat-val">{alnLen.toLocaleString()}</span>
          </span>
          {isPairwise && (
            <span className="align-panel-stat">
              Score: <span className="align-panel-stat-val">{score.toFixed(1)}</span>
            </span>
          )}
        </div>

        <span className="align-panel-spacer" />

        {/* Jump to mismatch */}
        {diffCols.length > 0 && (
          <div className="align-nav-group">
            <button className="align-panel-btn" onClick={prevDiff} title="Previous difference">
              <ChevronLeft size={14} />
            </button>
            <span className="align-nav-label" title={`${diffCols.length} variable columns`}>
              {currentDiffIdx + 1}/{diffCols.length}
            </span>
            <button className="align-panel-btn" onClick={nextDiff} title="Next difference">
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {/* Conservation threshold */}
        <div style={{ position: 'relative' }}>
          <button
            className={`align-panel-btn ${conservationThreshold > 0 ? 'active' : ''}`}
            onClick={() => setShowThresholdSlider(v => !v)}
            title="Conservation threshold filter"
          >
            <SlidersHorizontal size={14} />
          </button>
          {showThresholdSlider && (
            <div className="align-threshold-popup">
              <label>Hide columns ≥ {conservationThreshold > 0 ? `${(conservationThreshold * 100).toFixed(0)}%` : 'off'}</label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={conservationThreshold * 100}
                onChange={e => setConservationThreshold(parseInt(e.target.value) / 100)}
              />
              {conservationThreshold > 0 && (
                <button className="btn btn-sm" onClick={() => { setConservationThreshold(0); setShowThresholdSlider(false) }}>Reset</button>
              )}
            </div>
          )}
        </div>

        {/* Wrap toggle */}
        <button
          className="align-panel-btn"
          onClick={() => setWrapped(v => !v)}
          title={wrapped ? 'Switch to linear scroll' : 'Switch to wrapped rows'}
        >
          {wrapped ? <ArrowRightLeft size={14} /> : <WrapText size={14} />}
        </button>

        {/* Conservation color toggle */}
        <button
          className={`align-panel-btn ${colorMode ? 'active' : ''}`}
          onClick={() => setColorMode(v => !v)}
          title="Toggle conservation coloring"
        >
          <Palette size={14} />
        </button>

        {/* Copy as FASTA */}
        <button
          className="align-panel-btn"
          onClick={() => onCopy('fasta')}
          title="Copy as FASTA"
        >
          <Copy size={14} />
        </button>

        {/* Annotate differences (pairwise only) */}
        {isPairwise && (
          <button
            className={`align-panel-btn ${diffsAnnotated ? 'active' : ''}`}
            onClick={() => { onAnnotateDiffs(); setDiffsAnnotated(true) }}
            disabled={diffsAnnotated}
            title={diffsAnnotated ? 'Differences already annotated' : 'Annotate differences on reference'}
          >
            <Diff size={14} />
          </button>
        )}

        {/* Pairwise identity matrix toggle (MSA only) */}
        {pairwiseIdentityMatrix && (
          <button
            className={`align-panel-btn ${matrixOpen ? 'active' : ''}`}
            onClick={() => setMatrixOpen(v => !v)}
            title="Pairwise identity matrix"
          >
            <ChevronDown size={14} />
          </button>
        )}

      </div>

      {/* Pairwise identity matrix (MSA) */}
      {matrixOpen && pairwiseIdentityMatrix && (
        <div className="align-identity-matrix" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th />
                {sequences.map((s, i) => <th key={i} title={s.name}>{s.name.slice(0, 12)}</th>)}
              </tr>
            </thead>
            <tbody>
              {sequences.map((s, i) => (
                <tr key={i}>
                  <th title={s.name}>{s.name.slice(0, 12)}</th>
                  {pairwiseIdentityMatrix[i].map((val, j) => (
                    <td key={j} style={{ background: i === j ? 'var(--bg)' : identityColor(val), color: i === j ? undefined : val > 0.65 ? '#000' : '#fff' }}>
                      {(val * 100).toFixed(1)}%
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Find panel (floating, matches chromatogram style) */}
      {searchOpen && (
        <div className="chrom-find-panel" style={{ position: 'absolute', top: 8, right: 8, zIndex: 50 }}>
          <div className="chrom-find-header">
            <span className="chrom-find-title">Find Motif</span>
            <button className="chrom-find-close" onClick={closeSearch} aria-label="Close">
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
                    closeSearch()
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

      {/* Minimap – overview bar showing conservation across the full alignment */}
      {!wrapped && (
        <div className="align-minimap" onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const frac = (e.clientX - rect.left) / rect.width
          const col = Math.floor(frac * alnLen)
          if (viewerRef.current) {
            viewerRef.current.scrollLeft = Math.max(0, col * cellW - viewerRef.current.clientWidth / 2)
          }
        }}>
          <canvas ref={minimapRef} className="align-minimap-canvas" />
        </div>
      )}

      {/* Alignment viewer */}
      <div
        className={`align-viewer ${wrapped ? 'wrapped' : ''}`}
        ref={viewerRef}
        onScroll={handleScroll}
      >
        <div className="align-viewer-inner">
          {wrapped ? (
            <VirtualizedBlocks
              blocks={blocks}
              renderBlock={renderBlock}
              viewerRef={viewerRef}
              scrollTick={scrollTick}
              rowCount={sequences.length}
              cellH={cellW}
            />
          ) : (
            renderBlock(0, alnLen, 'single')
          )}
        </div>
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="align-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="align-ctx-label">Column {ctxMenu.col + 1}</div>
          {onJumpToSource && sequences.map((seq, i) => (
            <button
              key={i}
              className="align-ctx-item"
              onClick={() => {
                const pos = ungappedMaps[i]?.[ctxMenu.col] ?? 0
                onJumpToSource(seq.name, pos)
                setCtxMenu(null)
              }}
            >
              Go to pos {ungappedMaps[i]?.[ctxMenu.col] ?? '–'} in {seq.name.slice(0, 20)}
            </button>
          ))}
          <div className="align-ctx-sep" />
          {selRange && (
            <button className="align-ctx-item" onClick={() => {
              // Copy selected columns as FASTA
              const lines: string[] = []
              for (const seq of sequences) {
                lines.push(`>${seq.name}`)
                lines.push(seq.alignedBases.slice(selRange[0], selRange[1] + 1))
              }
              navigator.clipboard.writeText(lines.join('\n'))
              setCtxMenu(null)
            }}>
              Copy selected region
            </button>
          )}
        </div>
      )}

      {/* Column tooltip */}
      {tooltip && (
        <div
          className="align-col-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2, color: 'var(--text-muted)', fontSize: 10 }}>
            Column {tooltip.col + 1}
            {selRange && selRange[0] !== selRange[1] && (
              <span style={{ marginLeft: 6, fontWeight: 400 }}>
                Selection: {selRange[0] + 1}–{selRange[1] + 1} ({selRange[1] - selRange[0] + 1} cols)
              </span>
            )}
          </div>
          <div className="align-col-tooltip-row">
            <span className="align-col-tooltip-name">Consensus</span>
            <span className="align-col-tooltip-base">{consensus[tooltip.col]}</span>
          </div>
          {sequences.map((seq, i) => (
            <div key={i} className="align-col-tooltip-row">
              <span className="align-col-tooltip-name">{seq.name.slice(0, 15)}</span>
              <span className="align-col-tooltip-base">{seq.alignedBases[tooltip.col]}</span>
              <span className="align-col-tooltip-pos">pos {ungappedMaps[i]?.[tooltip.col] ?? '–'}</span>
            </div>
          ))}
          <div className="align-col-tooltip-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 2, marginTop: 2 }}>
            <span className="align-col-tooltip-name">Conservation</span>
            <span className="align-col-tooltip-base">{(conservation[tooltip.col] * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
