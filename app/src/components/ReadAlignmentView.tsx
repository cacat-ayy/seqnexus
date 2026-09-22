import './AlignmentPanel.css'
/**
 * Read-to-reference alignment viewer.
 *
 * Shows a two-row alignment grid (reference + read) with:
 * - Mismatch highlighting
 * - Optional synced chromatogram below
 * - Zoom via CSS custom properties (reuses AlignmentPanel.css)
 */

import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import { WrapText, Activity, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import type { ReadAlignment } from '../store'
import { useEditorStore, applyEdits } from '../store'
import { replaceBasesInPlace, undoSnapshot } from '../models/Document'
import ChromatogramView, { type ChromZoomHandle } from './ChromatogramView'
import { runAlignment } from '../workers/alignment'
import { DEFAULT_DNA_SCORING } from '../alignment/types'

/** Zoom levels: [cellWidth, fontSize] – levels 0-3 hide letters */
const ZOOM_LEVELS: [number, number][] = [
  [1, 0],   // 0
  [2, 0],   // 1
  [3, 0],   // 2
  [4, 0],   // 3
  [6, 7],   // 4
  [7, 8],   // 5
  [8, 9],   // 6
  [10, 11], // 7 - default
  [14, 13], // 8
  [18, 16], // 9
]

function dnaClass(ch: string): string {
  const u = ch.toUpperCase()
  if (u === '-') return 'gap'
  if (u === 'A' || u === 'C' || u === 'G' || u === 'T' || u === 'U') return `dna-${u}`
  return ''
}

const GUTTER_WIDTH = 150
const MIN_COLS = 20

interface Props {
  ra: ReadAlignment
  onZoomChange: (level: number) => void
}

export default function ReadAlignmentView({ ra, onZoomChange }: Props) {
  const { result, zoomLevel, showChromatogram } = ra
  const toggleChromatogram = useEditorStore(s => s.toggleReadAlignmentChromatogram)
  const updateResult = useEditorStore(s => s.updateReadAlignmentResult)
  const sequencingRead = useEditorStore(s => s.sequencingReads.find(r => r.id === ra.readId))
  const editSequencingBase = useEditorStore(s => s.editSequencingBase)
  const addResolvedCol = useEditorStore(s => s.addReadAlignmentResolvedCol)
  const clearResolvedCols = useEditorStore(s => s.clearReadAlignmentResolvedCols)

  // Derive a Set from the persisted array for fast lookups
  const resolvedCols = useMemo(() => new Set(ra.resolvedCols), [ra.resolvedCols])

  const [wrapped, setWrapped] = useState(true)
  const [dynamicCols, setDynamicCols] = useState(80)
  const [realigning, setRealigning] = useState(false)
  const [resolveTooltip, setResolveTooltip] = useState<{ col: number; x: number; y: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const chromRef = useRef<ChromZoomHandle | null>(null)

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

  // Dynamic wrap width
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

  const { sequences, identity, alignmentLength, score } = result
  const alnLen = alignmentLength
  const refSeq = sequences[0]
  const readSeq = sequences[1]

  // Mismatch columns
  const mismatchCols = useMemo(() => {
    const set = new Set<number>()
    const a = refSeq.alignedBases
    const b = readSeq.alignedBases
    for (let i = 0; i < alnLen; i++) {
      if (a[i] !== '-' && b[i] !== '-' && a[i].toUpperCase() !== b[i].toUpperCase()) {
        set.add(i)
      }
    }
    return set
  }, [refSeq, readSeq, alnLen])

  // Gap columns
  const gapCols = useMemo(() => {
    const set = new Set<number>()
    const a = refSeq.alignedBases
    const b = readSeq.alignedBases
    for (let i = 0; i < alnLen; i++) {
      if (a[i] === '-' || b[i] === '-') set.add(i)
    }
    return set
  }, [refSeq, readSeq, alnLen])

  const mismatchCount = mismatchCols.size
  const gapCount = gapCols.size

  // Map from read's ungapped position (0-based) to original base index for quality lookup
  const readQualityMap = useMemo(() => {
    if (!sequencingRead) return null
    const read = sequencingRead
    const edits = read.edits ?? []
    const { editMap } = applyEdits(read.data.bases, edits)
    const trimStart = read.trimStart ?? 0
    const trimEnd = read.trimEnd ?? read.data.bases.length
    // Build array: for each position in the trimmed+edited read, store the original base index
    const map: number[] = []
    for (let i = trimStart; i < trimEnd && i < editMap.length; i++) {
      if (editMap[i] === 'delete') continue
      if (editMap[i] === 'insert') {
        map.push(-1) // inserted bases have no original quality
      } else {
        map.push(i) // original or substituted – quality is at original position
      }
    }
    return map
  }, [sequencingRead])

  /** Get Phred quality score for a read base at a given alignment column. */
  const getQualityAtCol = useCallback((col: number): number | null => {
    if (!sequencingRead || !readQualityMap) return null
    // Count non-gap read bases up to this column
    const aligned = readSeq.alignedBases
    let readPos = 0
    for (let i = 0; i < col; i++) {
      if (aligned[i] !== '-') readPos++
    }
    if (aligned[col] === '-') return null
    const origIdx = readQualityMap[readPos]
    if (origIdx == null || origIdx < 0) return null
    return sequencingRead.data.qualityScores[origIdx] ?? null
  }, [sequencingRead, readQualityMap, readSeq])

  // Sorted mismatch positions for navigation
  const mismatchList = useMemo(() => {
    return Array.from(mismatchCols).sort((a, b) => a - b)
  }, [mismatchCols])

  const [currentMismatchIdx, setCurrentMismatchIdx] = useState(-1)
  const activeMismatchCol = currentMismatchIdx >= 0 && currentMismatchIdx < mismatchList.length
    ? mismatchList[currentMismatchIdx]
    : null

  // Stable ref for scrolling chromatogram (avoids circular deps with goToMismatch)
  const scrollChromToColRef = useRef<(col: number) => void>(() => {})

  const goToMismatch = useCallback((idx: number) => {
    if (mismatchList.length === 0) return
    const clamped = Math.max(0, Math.min(mismatchList.length - 1, idx))
    setCurrentMismatchIdx(clamped)
    // Scroll the mismatch column into view
    const col = mismatchList[clamped]
    const el = viewerRef.current?.querySelector(`[data-col="${col}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    // Also scroll chromatogram
    scrollChromToColRef.current(col)
  }, [mismatchList])

  const prevMismatch = useCallback(() => {
    if (mismatchList.length === 0) return
    if (currentMismatchIdx <= 0) goToMismatch(mismatchList.length - 1) // wrap
    else goToMismatch(currentMismatchIdx - 1)
  }, [currentMismatchIdx, mismatchList, goToMismatch])

  const nextMismatch = useCallback(() => {
    if (mismatchList.length === 0) return
    if (currentMismatchIdx >= mismatchList.length - 1) goToMismatch(0) // wrap
    else goToMismatch(currentMismatchIdx + 1)
  }, [currentMismatchIdx, mismatchList, goToMismatch])

  // Close resolve tooltip on outside click (full click) or Escape
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
      downOutside = false
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setResolveTooltip(null)
    }
    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
      document.removeEventListener('keydown', handleKey)
    }
  }, [resolveTooltip])

  // Keyboard shortcuts: [ for previous mismatch, ] for next mismatch
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '[') { e.preventDefault(); prevMismatch() }
      if (e.key === ']') { e.preventDefault(); nextMismatch() }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [prevMismatch, nextMismatch])

  /** Resolve a mismatch by accepting one side's base at the given column. */
  const resolveMismatch = useCallback((col: number, accept: 'read' | 'ref') => {
    const seqs = result.sequences
    const refBases = seqs[0].alignedBases.split('')
    const readBases = seqs[1].alignedBases.split('')

    if (accept === 'read') {
      // Accept read's base → edit the reference tab to match
      const readBase = readBases[col]
      refBases[col] = readBase

      // Compute ungapped reference position (0-based) for the edit
      let refPos = 0
      for (let i = 0; i < col; i++) {
        if (refBases[i] !== '-') refPos++ // count on original refBases before mutation
      }
      // Actually recount on original aligned bases (before our mutation above)
      refPos = 0
      for (let i = 0; i < col; i++) {
        if (seqs[0].alignedBases[i] !== '-') refPos++
      }

      // Apply edit to the reference tab
      const state = useEditorStore.getState()
      const tab = state.tabs.find(t => t.id === ra.tabId)
      if (tab) {
        const snap = undoSnapshot(tab.doc)
        const newDoc = replaceBasesInPlace(tab.doc, refPos, refPos + 1, readBase.toUpperCase())
        const updatedTabs = state.tabs.map(t =>
          t.id === ra.tabId
            ? { ...t, doc: newDoc, undoStack: [...t.undoStack.slice(-99), snap], redoStack: [] }
            : t
        )
        useEditorStore.setState({ tabs: updatedTabs })
      }
    } else {
      // Accept reference's base → apply BaseEdit to the sequencing read
      const refBase = refBases[col]
      readBases[col] = refBase

      // Compute the original base position in the read for the BaseEdit
      if (sequencingRead && readQualityMap) {
        // ungapped read position (0-based in trimmed+edited sequence)
        let readUngapped = 0
        for (let i = 0; i < col; i++) {
          if (seqs[1].alignedBases[i] !== '-') readUngapped++
        }
        const origIdx = readQualityMap[readUngapped]
        if (origIdx != null && origIdx >= 0) {
          const originalBase = sequencingRead.data.bases[origIdx]
          editSequencingBase(ra.readId, {
            type: 'substitute',
            pos: origIdx,
            original: originalBase,
            base: refBase.toUpperCase(),
          })
        }
      }
    }

    // Update the alignment result with the resolved bases
    const newAligned = [refBases.join(''), readBases.join('')]
    const newConsensus: string[] = []
    const newConservation: number[] = []
    for (let i = 0; i < newAligned[0].length; i++) {
      const a = newAligned[0][i].toUpperCase()
      const b = newAligned[1][i].toUpperCase()
      if (a === b) {
        newConsensus.push(a)
        newConservation.push(1.0)
      } else if (a === '-' || b === '-') {
        newConsensus.push(a === '-' ? b : a)
        newConservation.push(0.0)
      } else {
        newConsensus.push('X')
        newConservation.push(0.0)
      }
    }

    let matches = 0
    let compared = 0
    for (let i = 0; i < newAligned[0].length; i++) {
      if (newAligned[0][i] !== '-' && newAligned[1][i] !== '-') {
        compared++
        if (newAligned[0][i].toUpperCase() === newAligned[1][i].toUpperCase()) matches++
      }
    }

    const updatedResult = {
      ...result,
      sequences: [
        { ...seqs[0], alignedBases: newAligned[0] },
        { ...seqs[1], alignedBases: newAligned[1] },
      ],
      consensus: newConsensus.join(''),
      conservation: newConservation,
      identity: compared > 0 ? matches / compared : 1,
    }

    updateResult(ra.id, updatedResult)
    addResolvedCol(ra.id, col)
    setResolveTooltip(null)

    // Advance to next mismatch after resolution
    const currentIdx = mismatchList.indexOf(col)
    if (currentIdx >= 0 && mismatchList.length > 1) {
      // The mismatch we just resolved will disappear from the list on next render.
      // Advance index to the next one (which will shift down by 1 after removal).
      const nextIdx = currentIdx < mismatchList.length - 1 ? currentIdx : currentIdx - 1
      setCurrentMismatchIdx(nextIdx)
    } else {
      setCurrentMismatchIdx(-1)
    }
  }, [result, ra.id, ra.readId, ra.tabId, updateResult, addResolvedCol, sequencingRead, readQualityMap, editSequencingBase, mismatchList])

  /** Re-run alignment with current read/reference data. */
  const handleRealign = useCallback(() => {
    const state = useEditorStore.getState()
    const read = state.sequencingReads.find(r => r.id === ra.readId)
    const tab = state.tabs.find(t => t.id === ra.tabId)
    if (!read || !tab) return

    const data = read.data
    const edits = read.edits ?? []
    const { bases: editedBases, editMap } = applyEdits(data.bases, edits)
    const trimStart = read.trimStart ?? 0
    const trimEnd = read.trimEnd ?? data.bases.length
    let readBases = ''
    for (let i = trimStart; i < trimEnd && i < editedBases.length; i++) {
      if (editMap[i] !== 'delete') readBases += editedBases[i]
    }
    if (readBases.length === 0) return

    const refBases = tab.doc.sequence.bases
    if (refBases.length === 0) return

    setRealigning(true)
    const handle = runAlignment({
      sequences: [
        { name: tab.doc.name, bases: refBases },
        { name: data.name, bases: readBases },
      ],
      mode: 'global',
      seqType: 'dna',
      scoring: { ...DEFAULT_DNA_SCORING },
    })

    handle.promise
      .then(newResult => {
        updateResult(ra.id, newResult)
        setCurrentMismatchIdx(-1)
        clearResolvedCols(ra.id)
      })
      .catch(e => console.warn('Realignment failed:', e))
      .finally(() => setRealigning(false))
  }, [ra.id, ra.readId, ra.tabId, updateResult, clearResolvedCols])

  // Compute ungapped position for a given alignment column
  const ungappedPos = useCallback((alignedBases: string, col: number): number | null => {
    let pos = 0
    for (let i = 0; i < col && i < alignedBases.length; i++) {
      if (alignedBases[i] !== '-') pos++
    }
    return alignedBases[col] === '-' ? null : pos + 1
  }, [])

  /** Scroll the chromatogram to the read base corresponding to an alignment column. */
  const scrollChromToCol = useCallback((col: number) => {
    if (!showChromatogram || !chromRef.current || !readQualityMap) return
    const aligned = readSeq.alignedBases
    if (aligned[col] === '-') return
    // Count non-gap read bases up to this column
    let readPos = 0
    for (let i = 0; i < col; i++) {
      if (aligned[i] !== '-') readPos++
    }
    const origIdx = readQualityMap[readPos]
    if (origIdx != null && origIdx >= 0) {
      chromRef.current.scrollToBase(origIdx)
    }
  }, [showChromatogram, readQualityMap, readSeq])

  // Keep stable ref in sync for goToMismatch
  scrollChromToColRef.current = scrollChromToCol

  /** Handle click on any alignment cell – scroll chromatogram and show tooltip for mismatches. */
  const handleCellClick = useCallback((col: number, e: React.MouseEvent) => {
    scrollChromToCol(col)
    if (!mismatchCols.has(col)) return
    const rect = (e.target as HTMLElement).getBoundingClientRect()
    setResolveTooltip({
      col,
      x: rect.left + rect.width / 2,
      y: rect.bottom + 4,
    })
  }, [mismatchCols, scrollChromToCol])

  // Wrap into blocks
  const cols = wrapped ? dynamicCols : alnLen
  const blockCount = Math.ceil(alnLen / cols)

  const renderBlock = (blockIdx: number) => {
    const start = blockIdx * cols
    const end = Math.min(start + cols, alnLen)
    const blockLen = end - start

    return (
      <div key={blockIdx} className="align-block" style={{ marginBottom: 8 }}>
        {/* Ruler */}
        {showLetters && (
          <div className="align-row align-ruler-row">
            <div className="align-gutter" />
            <div className="align-cells">
              {Array.from({ length: blockLen }, (_, i) => {
                const col = start + i
                const show = col % 10 === 0 || col === 0
                return (
                  <span key={col} className="align-cell align-ruler-cell">
                    {show ? col + 1 : ''}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Reference row */}
        <div
          className={`align-row ${showLetters ? '' : 'block-mode'}`}
        >
          <div className="align-gutter" title={refSeq.name}>
            <span className="align-gutter-name">{refSeq.name}</span>
            {showLetters && wrapped && (
              <span className="align-row-pos">{ungappedPos(refSeq.alignedBases, start) ?? ''}</span>
            )}
          </div>
          <div className="align-cells">
            {Array.from({ length: blockLen }, (_, i) => {
              const col = start + i
              const ch = refSeq.alignedBases[col]
              const isMismatch = mismatchCols.has(col)
              const isGap = ch === '-'
              const isActive = col === activeMismatchCol
              const isResolved = resolvedCols.has(col)
              return (
                <span
                  key={col}
                  data-col={col}
                  className={`align-cell ${dnaClass(ch)} ${isMismatch ? 'mismatch' : ''} ${isGap ? 'gap-col' : ''} ${isActive ? 'active-mismatch' : ''} ${isResolved ? 'resolved' : ''} clickable`}
                  onClick={(e) => handleCellClick(col, e)}
                >
                  {showLetters ? ch : '\u00A0'}
                </span>
              )
            })}
          </div>
        </div>

        {/* Read row */}
        <div
          className={`align-row ${showLetters ? '' : 'block-mode'}`}
        >
          <div className="align-gutter" title={readSeq.name}>
            <span className="align-gutter-name">{readSeq.name}</span>
            {showLetters && wrapped && (
              <span className="align-row-pos">{ungappedPos(readSeq.alignedBases, start) ?? ''}</span>
            )}
          </div>
          <div className="align-cells">
            {Array.from({ length: blockLen }, (_, i) => {
              const col = start + i
              const ch = readSeq.alignedBases[col]
              const isMismatch = mismatchCols.has(col)
              const isGap = ch === '-'
              const isActive = col === activeMismatchCol
              const isResolved = resolvedCols.has(col)
              return (
                <span
                  key={col}
                  className={`align-cell ${dnaClass(ch)} ${isMismatch ? 'mismatch' : ''} ${isGap ? 'gap-col' : ''} ${isActive ? 'active-mismatch' : ''} ${isResolved ? 'resolved' : ''} clickable`}
                  onClick={(e) => handleCellClick(col, e)}
                >
                  {showLetters ? ch : '\u00A0'}
                </span>
              )
            })}
          </div>
        </div>

        {/* Match/mismatch indicator row */}
        {showLetters && (
          <div className="align-row align-consensus-row">
            <div className="align-gutter" />
            <div className="align-cells">
              {Array.from({ length: blockLen }, (_, i) => {
                const col = start + i
                const a = refSeq.alignedBases[col]
                const b = readSeq.alignedBases[col]
                const isResolved = resolvedCols.has(col)
                let indicator = ' '
                let cls = ''
                if (isResolved) {
                  indicator = '✓'
                  cls = 'resolved-indicator'
                } else if (a === '-' || b === '-') {
                  indicator = ' '
                } else if (a.toUpperCase() === b.toUpperCase()) {
                  indicator = '|'
                  cls = 'match-indicator'
                } else {
                  indicator = '×'
                  cls = 'mismatch-indicator'
                }
                return (
                  <span
                    key={col}
                    className={`align-cell ${cls}`}
                  >
                    {indicator}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="align-panel read-align-panel" ref={panelRef} style={zoomStyle}>
      {/* Header */}
      <div className="align-header">
        <div className="align-header-left">
          <span className="align-title">{ra.name}</span>
          <span className="align-algo-badge" title="Needleman-Wunsch (global pairwise)">NW</span>
          <span className="align-stat">
            Identity: {(identity * 100).toFixed(1)}%
          </span>
          <span className="align-stat">
            Mismatches: {mismatchCount}
          </span>
          <span className="align-stat">
            Gaps: {gapCount}
          </span>
          <span className="align-stat">
            Score: {score}
          </span>
          <span className="align-stat">
            Length: {alnLen}
          </span>
        </div>
        <div className="align-header-right">
          {mismatchCount > 0 && (
            <div className="mismatch-nav">
              <button
                className="align-hdr-btn"
                onClick={prevMismatch}
                title="Previous mismatch"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="mismatch-nav-label">
                {currentMismatchIdx >= 0
                  ? `${currentMismatchIdx + 1}/${mismatchCount}`
                  : `${mismatchCount} mismatches`}
              </span>
              <button
                className="align-hdr-btn"
                onClick={nextMismatch}
                title="Next mismatch"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          <button
            className="align-hdr-btn"
            onClick={handleRealign}
            disabled={realigning}
            title="Re-run alignment with current data"
          >
            <RotateCcw size={14} className={realigning ? 'spin' : ''} />
          </button>
          <button
            className={`align-hdr-btn ${showChromatogram ? 'active' : ''}`}
            onClick={() => toggleChromatogram(ra.id)}
            title="Toggle chromatogram"
          >
            <Activity size={14} />
          </button>
          <button
            className={`align-hdr-btn ${wrapped ? 'active' : ''}`}
            onClick={() => setWrapped(w => !w)}
            title="Toggle wrap"
          >
            <WrapText size={14} />
          </button>
        </div>
      </div>

      {/* Alignment grid */}
      <div className="align-viewer" ref={viewerRef}>
        {Array.from({ length: blockCount }, (_, i) => renderBlock(i))}
      </div>

      {/* Synced chromatogram */}
      {showChromatogram && (
        <div className="read-align-chromatogram">
          <ChromatogramView readId={ra.readId} forceHorizontal compact zoomRef={chromRef} />
        </div>
      )}

      {/* Mismatch resolution tooltip */}
      {resolveTooltip && showLetters && (() => {
        const col = resolveTooltip.col
        const refBase = refSeq.alignedBases[col]
        const readBase = readSeq.alignedBases[col]
        const refPos = ungappedPos(refSeq.alignedBases, col)
        const readPos = ungappedPos(readSeq.alignedBases, col)
        const qual = getQualityAtCol(col)
        return (
          <div
            ref={tooltipRef}
            className="resolve-tooltip"
            style={{ left: resolveTooltip.x, top: resolveTooltip.y }}
          >
            <div className="resolve-tooltip-header">
              Mismatch at column {col + 1}
            </div>
            <div className="resolve-tooltip-detail">
              <span>Ref {refPos ?? '–'}: <strong className={`dna-letter ${dnaClass(refBase)}`}>{refBase}</strong></span>
              <span>Read {readPos ?? '–'}: <strong className={`dna-letter ${dnaClass(readBase)}`}>{readBase}</strong>{qual != null && <span className="resolve-qual"> Q{qual}</span>}</span>
            </div>
            <div className="resolve-tooltip-actions">
              <button
                className="resolve-btn resolve-btn-ref"
                onClick={() => resolveMismatch(col, 'ref')}
              >
                Accept Reference ({refBase})
              </button>
              <button
                className="resolve-btn resolve-btn-read"
                onClick={() => resolveMismatch(col, 'read')}
              >
                Accept Read ({readBase})
              </button>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
