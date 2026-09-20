import './AlignmentPanel.css'
/**
 * Stacked contig view – multiple reads aligned to a shared reference.
 *
 * Shows reference row, read rows at mapped positions, majority consensus,
 * coverage depth track, inline expandable chromatogram, disagreement
 * navigation, and per-cell mismatch resolution.
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { WrapText, ChevronLeft, ChevronRight, AudioWaveform, ExternalLink, ArrowRightLeft, ChevronUp, ChevronDown, X } from 'lucide-react'
import type { Contig, ReadAlignment } from '../store'
import { useEditorStore } from '../store'
import { replaceBasesInPlace, undoSnapshot } from '../models/Document'

import InlineChromatogram from './InlineChromatogram'
import { buildReadMapping, computeContigStats } from '../alignment/contig'

const ZOOM_LEVELS: [number, number][] = [
  [1, 0], [2, 0], [3, 0], [4, 0],
  [6, 7], [7, 8], [8, 9], [10, 11], [14, 13], [18, 16],
]

function dnaClass(ch: string): string {
  const u = ch.toUpperCase()
  if (u === '-') return 'gap'
  if ('ACGTU'.includes(u)) return `dna-${u}`
  return ''
}

const GUTTER_WIDTH = 150
const MIN_COLS = 20

interface Props {
  contig: Contig
  onZoomChange: (level: number) => void
  /** Navigate to single-read ReadAlignmentView */
  onViewReadAlignment?: (raId: string) => void
  /** Externally controlled search open state. */
  externalSearchOpen?: boolean
  /** Called when the contig's search panel is closed. */
  onSearchClose?: () => void
  /** Reports selection changes for the status bar. */
  onSelectionChange?: (sel: { anchor: number; caret: number } | null) => void
}

export default function ContigView({ contig, onZoomChange, onViewReadAlignment, externalSearchOpen, onSearchClose, onSelectionChange }: Props) {
  const { zoomLevel } = contig
  const readAlignments = useEditorStore(s => s.readAlignments)
  const tabs = useEditorStore(s => s.tabs)
  const sequencingReads = useEditorStore(s => s.sequencingReads)
  const editSequencingBase = useEditorStore(s => s.editSequencingBase)
  const setActiveTab = useEditorStore(s => s.setActiveTab)
  const setActiveSequencingRead = useEditorStore(s => s.setActiveSequencingRead)
  const addResolvedCol = useEditorStore(s => s.addReadAlignmentResolvedCol)
  const updateResult = useEditorStore(s => s.updateReadAlignmentResult)

  const [wrapped, setWrapped] = useState(true)
  const [dynamicCols, setDynamicCols] = useState(80)
  const [resolveTooltip, setResolveTooltip] = useState<{
    col: number; raId: string; x: number; y: number
  } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ raId: string; x: number; y: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)


  // --- Base-level selection (matches SequenceView behavior) ---
  const [contigSel, setContigSel] = useState<{ anchor: number; caret: number }>({ anchor: 0, caret: 0 })
  const contigSelRef = useRef(contigSel)
  contigSelRef.current = contigSel
  const isDragging = useRef(false)
  const dragAnchor = useRef(0)

  // Report selection to parent for status bar
  useEffect(() => {
    onSelectionChange?.(contigSel.anchor === 0 && contigSel.caret === 0 ? null : contigSel)
  }, [contigSel, onSelectionChange])

  // Get reference position from a mouse event target
  const colFromEvent = useCallback((e: React.MouseEvent | MouseEvent): number | null => {
    const target = e.target as HTMLElement
    const cell = target.closest('.align-cell[data-col]') as HTMLElement | null
    if (!cell) return null
    const col = parseInt(cell.dataset.col!, 10)
    return isNaN(col) ? null : col
  }, [])

  const handleCellMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const col = colFromEvent(e)
    if (col === null) return
    // Don't start selection if clicking a button or interactive element
    if ((e.target as HTMLElement).closest('button, select, input, .contig-jump-btn')) return
    isDragging.current = true
    if (e.shiftKey) {
      dragAnchor.current = contigSelRef.current.anchor
      setContigSel({ anchor: contigSelRef.current.anchor, caret: col + 1 })
    } else {
      dragAnchor.current = col
      setContigSel({ anchor: col, caret: col })
    }
  }, [colFromEvent])

  const handleCellMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return
    const col = colFromEvent(e)
    if (col === null) return
    setContigSel({ anchor: dragAnchor.current, caret: col + 1 })
  }, [colFromEvent])

  useEffect(() => {
    const handleUp = () => { isDragging.current = false }
    window.addEventListener('mouseup', handleUp)
    return () => window.removeEventListener('mouseup', handleUp)
  }, [])

  // Compute selection range for highlighting (memoized to avoid invalidating renderBlock)
  const selStart = Math.min(contigSel.anchor, contigSel.caret)
  const selEnd = Math.max(contigSel.anchor, contigSel.caret)
  const selRange = useMemo<[number, number] | null>(
    () => selStart !== selEnd ? [selStart, selEnd] : null,
    [selStart, selEnd],
  )

  // Find in contig
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
  const [searchHits, setSearchHits] = useState<number[]>([]) // start positions in refBases
  const [searchHitIdx, setSearchHitIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Inline chromatogram traces (visible when zoomed in enough)
  const [showInlineTraces, setShowInlineTraces] = useState(true)

  // Disagreement navigation
  const [currentDisagreementIdx, setCurrentDisagreementIdx] = useState(0)

  // Zoom
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
    if (!el) return
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

  // Dynamic column count for wrapping
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width - GUTTER_WIDTH
        const cols = Math.max(MIN_COLS, Math.floor(w / cellW))
        setDynamicCols(cols)
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [cellW])

  // Get the reference tab and its sequence
  const refTab = tabs.find(t => t.id === contig.tabId)
  const refBases = refTab?.doc.sequence.bases ?? ''
  const refName = refTab?.doc.name ?? 'Reference'

  // Get the ReadAlignment entities for this contig (stable reference)
  const contigRAIds = contig.readAlignmentIds.join(',')
  const contigRAs = useMemo(() => {
    return contig.readAlignmentIds
      .map(id => readAlignments.find(ra => ra.id === id))
      .filter((ra): ra is ReadAlignment => ra != null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contigRAIds, readAlignments])

  // Build read mappings
  const readMappings = useMemo(() => {
    return contigRAs.map(ra => ({
      ra,
      mapping: buildReadMapping(ra.result),
    }))
  }, [contigRAs])

  // Precompute read lookup: raId → SequencingRead (avoids .find() per block per read)
  const readByRaId = useMemo(() => {
    const map = new Map<string, typeof sequencingReads[number]>()
    for (const ra of contigRAs) {
      const read = sequencingReads.find(r => r.id === ra.readId)
      if (read) map.set(ra.id, read)
    }
    return map
  }, [contigRAs, sequencingReads])

  // Compute consensus and coverage
  const stats = useMemo(() => {
    return computeContigStats(refBases, readMappings.map(rm => rm.mapping))
  }, [refBases, readMappings])

  const { coverage, consensus, disagreements } = stats
  const maxCoverage = Math.max(1, ...coverage)
  const refLength = refBases.length

  // Gutter click: select all bases for that sequence and copy to clipboard
  const selectSequenceCells = useCallback((seqId: string) => {
    if (seqId === 'ref') {
      setContigSel({ anchor: 0, caret: refLength })
    } else if (seqId === 'consensus') {
      setContigSel({ anchor: 0, caret: refLength })
    } else if (seqId.startsWith('read-')) {
      const raId = seqId.slice(5)
      const mapping = readMappings.find(m => m.ra.id === raId)
      if (mapping) {
        setContigSel({ anchor: mapping.mapping.startPos, caret: mapping.mapping.endPos + 1 })
      }
    }
    const viewer = viewerRef.current
    if (!viewer) return
    const allCells = viewer.querySelectorAll(`.align-cells[data-seq="${seqId}"]`)
    let text = ''
    allCells.forEach(el => {
      el.querySelectorAll('.align-cell').forEach(cell => {
        const ch = cell.textContent ?? ''
        if (ch && ch !== '\u00A0') text += ch
      })
    })
    if (text) navigator.clipboard.writeText(text.replace(/-/g, '')).catch(() => {})
  }, [refLength, readMappings])

  // Active disagreement column
  const activeDisagreementCol = currentDisagreementIdx < disagreements.length
    ? disagreements[currentDisagreementIdx]
    : null

  const goToDisagreement = useCallback((idx: number) => {
    if (disagreements.length === 0) return
    const clamped = Math.max(0, Math.min(disagreements.length - 1, idx))
    setCurrentDisagreementIdx(clamped)
    const col = disagreements[clamped]
    const el = viewerRef.current?.querySelector(`[data-col="${col}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [disagreements])

  const prevDisagreement = useCallback(() => {
    if (currentDisagreementIdx <= 0) goToDisagreement(disagreements.length - 1)
    else goToDisagreement(currentDisagreementIdx - 1)
  }, [currentDisagreementIdx, disagreements, goToDisagreement])

  const nextDisagreement = useCallback(() => {
    if (currentDisagreementIdx >= disagreements.length - 1) goToDisagreement(0)
    else goToDisagreement(currentDisagreementIdx + 1)
  }, [currentDisagreementIdx, disagreements, goToDisagreement])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '[') { e.preventDefault(); prevDisagreement() }
      if (e.key === ']') { e.preventDefault(); nextDisagreement() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [prevDisagreement, nextDisagreement])

  // Search effect – find motif in reference sequence
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchHits([]); return }
    const q = searchQuery.toUpperCase()
    const ref = refBases.toUpperCase()
    const hits: number[] = []
    let pos = 0
    while (pos <= ref.length - q.length) {
      const idx = ref.indexOf(q, pos)
      if (idx < 0) break
      hits.push(idx)
      pos = idx + 1
    }
    setSearchHits(hits)
    setSearchHitIdx(0)
  }, [searchQuery, refBases])

  // Jump to search hit by scrolling the matching cell into view
  const jumpToSearchHit = useCallback((idx: number) => {
    if (searchHits.length === 0) return
    const clamped = ((idx % searchHits.length) + searchHits.length) % searchHits.length
    setSearchHitIdx(clamped)
    const col = searchHits[clamped]
    const el = viewerRef.current?.querySelector(`[data-col="${col}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [searchHits])

  // Build a set of search-highlighted columns for rendering
  const searchHighlightCols = useMemo(() => {
    if (searchHits.length === 0 || !searchQuery) return new Set<number>()
    const set = new Set<number>()
    const qLen = searchQuery.length
    for (const start of searchHits) {
      for (let i = 0; i < qLen; i++) set.add(start + i)
    }
    return set
  }, [searchHits, searchQuery])

  // Active search hit columns (for stronger highlight)
  const activeSearchHitCols = useMemo(() => {
    if (searchHits.length === 0 || !searchQuery) return new Set<number>()
    const set = new Set<number>()
    const start = searchHits[searchHitIdx]
    if (start != null) {
      for (let i = 0; i < searchQuery.length; i++) set.add(start + i)
    }
    return set
  }, [searchHits, searchHitIdx, searchQuery])

  // Close tooltip on outside click
  useEffect(() => {
    if (!resolveTooltip) return
    let downOutside = false
    const handleDown = (e: MouseEvent) => {
      downOutside = !tooltipRef.current?.contains(e.target as Node)
    }
    const handleUp = (e: MouseEvent) => {
      if (downOutside && !tooltipRef.current?.contains(e.target as Node)) {
        setResolveTooltip(null)
      }
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
    }
  }, [resolveTooltip])

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [ctxMenu])

  // Get quality score for a read base at a reference position
  const getQualityAtPos = useCallback((raId: string, refPos: number): number | null => {
    const rm = readMappings.find(r => r.ra.id === raId)
    if (!rm) return null
    const ra = rm.ra
    const read = sequencingReads.find(r => r.id === ra.readId)
    if (!read) return null
    // Count read bases from start to this position
    let baseIdx = 0
    for (let p = rm.mapping.startPos; p < refPos; p++) {
      if (rm.mapping.bases.has(p)) baseIdx++
    }
    const trimStart = read.trimStart ?? 0
    const origIdx = trimStart + baseIdx
    return read.data.qualityScores[origIdx] ?? null
  }, [readMappings, sequencingReads])

  // Precompute per-read: refPos → alnCol mapping and resolved refPos set
  const { resolvedSets, refPosToAlnCol } = useMemo(() => {
    const resolved = new Map<string, Set<number>>()
    const posMap = new Map<string, Map<number, number>>()
    for (const { ra } of readMappings) {
      const resolvedAlnCols = new Set(ra.resolvedCols)
      const resolvedRefPositions = new Set<number>()
      const refToAln = new Map<number, number>()
      const refAligned = ra.result.sequences[0].alignedBases
      let rp = -1
      for (let i = 0; i < refAligned.length; i++) {
        if (refAligned[i] !== '-') {
          rp++
          refToAln.set(rp, i)
          if (resolvedAlnCols.has(i)) resolvedRefPositions.add(rp)
        }
      }
      resolved.set(ra.id, resolvedRefPositions)
      posMap.set(ra.id, refToAln)
    }
    return { resolvedSets: resolved, refPosToAlnCol: posMap }
  }, [readMappings])

  // Resolve a mismatch
  const resolveMismatch = useCallback((refPos: number, raId: string, accept: 'read' | 'ref') => {
    const rm = readMappings.find(r => r.ra.id === raId)
    if (!rm) return
    const ra = rm.ra
    const readBase = rm.mapping.bases.get(refPos)
    if (readBase == null) return
    const refBase = refBases[refPos]

    if (accept === 'read') {
      // Edit the reference tab
      const tab = tabs.find(t => t.id === contig.tabId)
      if (tab) {
        const snap = undoSnapshot(tab.doc)
        const newDoc = replaceBasesInPlace(tab.doc, refPos, refPos + 1, readBase.toUpperCase())
        const state = useEditorStore.getState()
        const updatedTabs = state.tabs.map(t =>
          t.id === contig.tabId
            ? { ...t, doc: newDoc, undoStack: [...t.undoStack.slice(-99), snap], redoStack: [] }
            : t
        )
        useEditorStore.setState({ tabs: updatedTabs })
      }
    } else {
      // Edit the sequencing read
      const read = sequencingReads.find(r => r.id === ra.readId)
      if (read) {
        // Find original base index
        let baseIdx = 0
        for (let p = rm.mapping.startPos; p < refPos; p++) {
          if (rm.mapping.bases.has(p)) baseIdx++
        }
        const trimStart = read.trimStart ?? 0
        const origIdx = trimStart + baseIdx
        const originalBase = read.data.bases[origIdx]
        editSequencingBase(ra.readId, {
          type: 'substitute',
          pos: origIdx,
          original: originalBase,
          base: refBase.toUpperCase(),
        })
      }
    }

    // Update the pairwise alignment result to reflect the resolution
    const seqs = ra.result.sequences
    const refAligned = seqs[0].alignedBases.split('')
    const readAligned = seqs[1].alignedBases.split('')
    const alnCol = refPosToAlnCol.get(ra.id)?.get(refPos) ?? -1
    if (alnCol >= 0) {
      if (accept === 'read') refAligned[alnCol] = readBase
      else readAligned[alnCol] = refBase
      const newAligned = [refAligned.join(''), readAligned.join('')]
      const newConsensus: string[] = []
      const newConservation: number[] = []
      for (let i = 0; i < newAligned[0].length; i++) {
        const a = newAligned[0][i].toUpperCase()
        const b = newAligned[1][i].toUpperCase()
        if (a === b) { newConsensus.push(a); newConservation.push(1.0) }
        else if (a === '-' || b === '-') { newConsensus.push(a === '-' ? b : a); newConservation.push(0.0) }
        else { newConsensus.push('X'); newConservation.push(0.0) }
      }
      let matches = 0, compared = 0
      for (let i = 0; i < newAligned[0].length; i++) {
        if (newAligned[0][i] !== '-' && newAligned[1][i] !== '-') {
          compared++
          if (newAligned[0][i].toUpperCase() === newAligned[1][i].toUpperCase()) matches++
        }
      }
      updateResult(ra.id, {
        ...ra.result,
        sequences: [
          { ...seqs[0], alignedBases: newAligned[0] },
          { ...seqs[1], alignedBases: newAligned[1] },
        ],
        consensus: newConsensus.join(''),
        conservation: newConservation,
        identity: compared > 0 ? matches / compared : 1,
      })
      addResolvedCol(ra.id, alnCol)
    }

    setResolveTooltip(null)
  }, [readMappings, refBases, contig.tabId, tabs, sequencingReads, editSequencingBase, updateResult, addResolvedCol, refPosToAlnCol])

  // Event delegation: single click handler on the viewer
  const handleViewerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const cell = target.closest('[data-col]') as HTMLElement | null
    if (!cell) return
    const col = parseInt(cell.getAttribute('data-col')!, 10)
    if (isNaN(col)) return
    const raId = cell.getAttribute('data-ra')
    if (!raId) return // reference row click
    const rm = readMappings.find(r => r.ra.id === raId)
    if (!rm) return
    const readBase = rm.mapping.bases.get(col)
    if (readBase == null) return
    const refBase = refBases[col]
    if (readBase.toUpperCase() === refBase.toUpperCase()) return
    const rect = cell.getBoundingClientRect()
    setResolveTooltip({ col, raId, x: rect.left + rect.width / 2, y: rect.bottom + 4 })
  }, [readMappings, refBases])

  // Wrap into blocks
  const cols = wrapped ? dynamicCols : refLength
  const blockCount = Math.ceil(refLength / cols)

  // Virtualization for wrapped mode – only render blocks near the viewport
  // Each block has: ruler + ref row + (read rows × (1 base row + optional trace row)) + coverage + consensus
  const readCount = readMappings.length
  const traceRowCount = showInlineTraces && showLetters ? readCount : 0
  const rowsPerBlock = (showLetters ? 1 : 0) /* ruler */ + 1 /* ref */ + readCount /* read base rows */ + traceRowCount + 2 /* coverage + consensus */
  const cellH = Math.max(cellW + 2, 18)
  const traceH = showInlineTraces && showLetters ? 36 : 0
  const blockH = rowsPerBlock * cellH + traceRowCount * (traceH - cellH) + 12

  const [visibleBlockRange, setVisibleBlockRange] = useState<[number, number]>([0, 5])

  useEffect(() => {
    const el = viewerRef.current
    if (!el || !wrapped) return
    const update = () => {
      const scrollTop = el.scrollTop
      const viewH = el.clientHeight
      const first = Math.max(0, Math.floor(scrollTop / blockH) - 1)
      const last = Math.min(blockCount - 1, Math.ceil((scrollTop + viewH) / blockH) + 1)
      setVisibleBlockRange(prev => {
        if (prev[0] === first && prev[1] === last) return prev
        return [first, last]
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [wrapped, blockCount, blockH])

  const renderBlock = useCallback((blockIdx: number) => {
    const start = blockIdx * cols
    const blockLen = Math.min(cols, refLength - start)
    const isSel = (pos: number) => selRange !== null && pos >= selRange[0] && pos < selRange[1]
    const isCaretAt = (pos: number) => contigSel.anchor === contigSel.caret && contigSel.caret === pos

    return (
      <div key={blockIdx} className="align-block">
        {/* Ruler */}
        {showLetters && (
          <div className="align-row ruler-row">
            <div className="align-gutter" />
            <div className="align-cells">
              {Array.from({ length: blockLen }, (_, i) => {
                const pos = start + i
                const show = pos === 0 || (pos + 1) % 10 === 0
                return (
                  <span key={pos} className="align-cell align-ruler-cell">
                    {show ? pos + 1 : ''}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Reference row */}
        <div className={`align-row ${showLetters ? '' : 'block-mode'} contig-ref-row`}>
          <div className="align-gutter" title={refName}>
            <button
              className="contig-jump-btn"
              onClick={() => setActiveTab(contig.tabId)}
              title={`Go to ${refName}`}
            >
              <ExternalLink size={9} />
            </button>
            <span className="align-gutter-name contig-selectable" onClick={() => selectSequenceCells('ref')}>{refName}</span>
            {showLetters && wrapped && (
              <span className="align-row-pos">{start + 1}</span>
            )}
          </div>
          <div className="align-cells" data-seq="ref">
            {Array.from({ length: blockLen }, (_, i) => {
              const pos = start + i
              const ch = refBases[pos] ?? ''
              const isActiveDisagreement = pos === activeDisagreementCol
              const isSearchHit = searchHighlightCols.has(pos)
              const isActiveHit = activeSearchHitCols.has(pos)
              const selected = isSel(pos)
              const caret = isCaretAt(pos)
              return (
                <span
                  key={pos}
                  data-col={pos}
                  className={`align-cell ${dnaClass(ch)} clickable ${isActiveDisagreement ? 'active-mismatch' : ''}${isActiveHit ? ' search-hit-active' : isSearchHit ? ' search-hit' : ''}${selected ? ' contig-sel' : ''}${caret ? ' contig-caret' : ''}`}
                >
                  {showLetters ? ch : '\u00A0'}
                </span>
              )
            })}
          </div>
        </div>

        {/* Read rows */}
        {readMappings.map(({ ra, mapping }) => {
          const readName = ra.result.sequences[1].name
          const read = readByRaId.get(ra.id)
          const hasTrace = read != null && showLetters && showInlineTraces
          const isRC = readName.includes('(RC)')
          return (
            <div key={ra.id} className="contig-read-wrapper">
              {/* Inline trace strip – uses align-row so gutter sticks */}
              {hasTrace && (
                <div className="align-row contig-trace-row">
                  <div className="align-gutter" />
                  <InlineChromatogram
                    data={read.data}
                    mapping={mapping}
                    trimStart={read.trimStart ?? 0}
                    trimEnd={read.trimEnd ?? 0}
                    blockStart={start}
                    blockLen={blockLen}
                    cellW={cellW}
                    isRC={isRC}
                  />
                </div>
              )}
              {/* Base cells row – standard align-row with sticky gutter */}
              <div className={`align-row ${showLetters ? '' : 'block-mode'}`}>
                <div
                  className="align-gutter contig-read-gutter"
                  title={readName}
                  onContextMenu={e => {
                    e.preventDefault()
                    setCtxMenu({ raId: ra.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  <button
                    className="contig-jump-btn"
                    onClick={() => setActiveSequencingRead(ra.readId)}
                    title={`Go to ${readName}`}
                  >
                    <ExternalLink size={9} />
                  </button>
                  <span className="align-gutter-name contig-selectable" onClick={() => selectSequenceCells(`read-${ra.id}`)}>{readName}</span>
                </div>
                <div className="align-cells" data-seq={`read-${ra.id}`}>
                  {Array.from({ length: blockLen }, (_, i) => {
                    const pos = start + i
                    const readBase = mapping.bases.get(pos)
                    const inRange = pos >= mapping.startPos && pos <= mapping.endPos
                    const selected = isSel(pos)
                    const caret = isCaretAt(pos)
                    if (!inRange) {
                      return <span key={pos} data-col={pos} className={`align-cell contig-empty${selected ? ' contig-sel' : ''}${caret ? ' contig-caret' : ''}`}>{'\u00A0'}</span>
                    }
                    if (readBase == null) {
                      return (
                        <span key={pos} data-col={pos} data-ra={ra.id} className={`align-cell gap-col clickable${selected ? ' contig-sel' : ''}${caret ? ' contig-caret' : ''}`}>
                          {showLetters ? '-' : '\u00A0'}
                        </span>
                      )
                    }
                    const refBase = refBases[pos]
                    const isMismatch = readBase.toUpperCase() !== refBase.toUpperCase()
                    const resolved = resolvedSets.get(ra.id)?.has(pos) ?? false
                    const isActiveDisagreement = pos === activeDisagreementCol
                    return (
                      <span
                        key={pos}
                        data-col={pos}
                        data-ra={ra.id}
                        className={`align-cell ${dnaClass(readBase)} ${isMismatch ? 'mismatch' : ''} ${resolved ? 'resolved' : ''} ${isActiveDisagreement ? 'active-mismatch' : ''} clickable${selected ? ' contig-sel' : ''}${caret ? ' contig-caret' : ''}`}
                      >
                        {showLetters ? readBase : '\u00A0'}
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}


        {/* Consensus row */}
        <div className={`align-row ${showLetters ? '' : 'block-mode'} contig-consensus-row`}>
          <div className="align-gutter">
            <span className="align-gutter-name contig-selectable" onClick={() => selectSequenceCells('consensus')}>Consensus</span>
          </div>
          <div className="align-cells" data-seq="consensus">
            {Array.from({ length: blockLen }, (_, i) => {
              const pos = start + i
              const con = consensus[pos]
              const ref = refBases[pos]?.toUpperCase()
              const disagrees = con !== ref && coverage[pos] > 0
              const selected = isSel(pos)
              const caret = isCaretAt(pos)
              return (
                <span
                  key={pos}
                  data-col={pos}
                  className={`align-cell ${dnaClass(con)} ${disagrees ? 'mismatch' : ''} ${coverage[pos] === 0 ? 'contig-no-coverage' : ''}${selected ? ' contig-sel' : ''}${caret ? ' contig-caret' : ''}`}
                >
                  {showLetters ? con : '\u00A0'}
                </span>
              )
            })}
          </div>
        </div>

        {/* Coverage track */}
        <div className="contig-coverage-row">
          <div className="align-gutter">
            <span className="align-gutter-name" style={{ fontSize: '10px' }}>Coverage</span>
          </div>
          <div className="align-cells contig-coverage-cells">
            {Array.from({ length: blockLen }, (_, i) => {
              const pos = start + i
              const depth = coverage[pos]
              const pct = Math.round((depth / maxCoverage) * 100)
              const opacity = depth === 0 ? 0 : Math.max(0.15, pct / 100)
              return (
                <span
                  key={pos}
                  className="align-cell contig-coverage-bar"
                  title={`${depth}×`}
                >
                  <span
                    className="contig-coverage-fill"
                    style={{ height: `${pct}%`, opacity }}
                  />
                </span>
              )
            })}
          </div>
        </div>
      </div>
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, refLength, refBases, refName, readMappings, readByRaId, consensus, coverage, maxCoverage, disagreements, activeDisagreementCol, resolvedSets, showLetters, showInlineTraces, cellW, wrapped, searchHighlightCols, activeSearchHitCols, contig.tabId, setActiveTab, setActiveSequencingRead, selectSequenceCells, selRange, contigSel.anchor, contigSel.caret, setCtxMenu])

  // Render blocks on demand (only visible blocks in wrapped mode)
  const renderedBlocks = useMemo(
    () => {
      if (wrapped) {
        // Only render visible blocks + buffer
        const result: (React.ReactNode | null)[] = new Array(blockCount).fill(null)
        for (let i = visibleBlockRange[0]; i <= visibleBlockRange[1] && i < blockCount; i++) {
          result[i] = renderBlock(i)
        }
        return result
      }
      return Array.from({ length: blockCount }, (_, i) => renderBlock(i))
    },
    [blockCount, renderBlock, wrapped, visibleBlockRange],
  )

  if (contigRAs.length === 0) {
    return <div className="align-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No read alignments in this contig</div>
  }

  return (
    <div className="align-panel read-align-panel contig-panel" ref={panelRef} style={zoomStyle}>
      {/* Header */}
      <div className="align-header">
        <div className="align-header-left">
          <span className="align-title">{contig.name}</span>
          <span className="align-stat">{contigRAs.length} reads</span>
          <span className="align-stat">{refLength} bp</span>
          <span className="align-stat">Disagreements: {disagreements.length}</span>
        </div>
        <div className="align-header-right">
          {disagreements.length > 0 && (
            <div className="align-nav-group">
              <button className="align-panel-btn" onClick={prevDisagreement} title="Previous disagreement ([)">
                <ChevronLeft size={14} />
              </button>
              <span className="align-nav-label" title={`${disagreements.length} disagreements`}>
                {currentDisagreementIdx + 1}/{disagreements.length}
              </span>
              <button className="align-panel-btn" onClick={nextDisagreement} title="Next disagreement (])">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          <button
            className={`align-hdr-btn ${showInlineTraces ? 'active' : ''}`}
            onClick={() => setShowInlineTraces(v => !v)}
            title={showInlineTraces ? 'Hide inline traces' : 'Show inline traces'}
          >
            <AudioWaveform size={14} />
          </button>
          <button
            className="align-hdr-btn"
            onClick={() => setWrapped(w => !w)}
            title={wrapped ? 'Switch to linear scroll' : 'Switch to wrapped rows'}
          >
            {wrapped ? <ArrowRightLeft size={14} /> : <WrapText size={14} />}
          </button>
        </div>
      </div>

      {/* Alignment grid */}
      <div className="align-viewer" ref={viewerRef} onClick={handleViewerClick} onMouseDown={handleCellMouseDown} onMouseMove={handleCellMouseMove}>
        {wrapped ? (
          <div style={{ height: blockCount * blockH, position: 'relative' }}>
            {renderedBlocks.map((block, i) => {
              if (i < visibleBlockRange[0] || i > visibleBlockRange[1]) return null
              return (
                <div key={i} style={{ position: 'absolute', top: i * blockH, left: 0, right: 0 }}>
                  {block}
                </div>
              )
            })}
          </div>
        ) : (
          renderedBlocks
        )}
      </div>

      {/* Find panel */}
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

      {/* Resolve tooltip */}
      {resolveTooltip && showLetters && (() => {
        const { col, raId } = resolveTooltip
        const refBase = refBases[col]
        const rm = readMappings.find(r => r.ra.id === raId)
        const readBase = rm?.mapping.bases.get(col) ?? '?'
        const qual = getQualityAtPos(raId, col)
        return (
          <div
            ref={tooltipRef}
            className="resolve-tooltip"
            style={{ left: resolveTooltip.x, top: resolveTooltip.y }}
          >
            <div className="resolve-tooltip-header">
              Mismatch at position {col + 1}
            </div>
            <div className="resolve-tooltip-detail">
              <span>Ref: <strong className={`dna-letter ${dnaClass(refBase)}`}>{refBase}</strong></span>
              <span>Read: <strong className={`dna-letter ${dnaClass(readBase)}`}>{readBase}</strong>{qual != null && <span className="resolve-qual"> Q{qual}</span>}</span>
            </div>
            <div className="resolve-tooltip-actions">
              <button className="btn btn-sm" onClick={() => resolveMismatch(col, raId, 'read')}>Accept Read</button>
              <button className="btn btn-sm" onClick={() => resolveMismatch(col, raId, 'ref')}>Accept Reference</button>
            </div>
          </div>
        )
      })()}

      {/* Context menu for read rows */}
      {ctxMenu && (
        <div
          className="align-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button className="align-ctx-item" onClick={() => {
            const raId = ctxMenu.raId
            setCtxMenu(null)
            onViewReadAlignment?.(raId)
          }}>
            View Read Alignment
          </button>

        </div>
      )}
    </div>
  )
}
