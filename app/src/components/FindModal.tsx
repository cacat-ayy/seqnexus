import './FindModal.css'
/**
 * Floating find/replace panel.
 *
 * Non-blocking - positioned at the top-right of the sequence view so the
 * user can still see and interact with the sequence underneath.
 *
 * Supports:
 * - Nucleotide search (default) with IUPAC ambiguity interpretation
 * - Protein translation search (searches all 3 reading frames)
 * - Reverse complement matching
 * - Regex mode
 * - Find & replace
 * - Draggable via header
 * - Entry/exit animations
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore, type SearchOptions, defaultSearchOptions } from '../store'
import { ChevronUp, ChevronDown, ChevronRight, X, Replace, ReplaceAll } from 'lucide-react'

interface FindModalProps {
  open: boolean
  onClose: () => void
}

export default function FindModal({ open, onClose }: FindModalProps) {
  const search = useEditorStore(s => s.search)
  const setSearch = useEditorStore(s => s.setSearch)
  const nextMatch = useEditorStore(s => s.nextMatch)
  const prevMatch = useEditorStore(s => s.prevMatch)
  const clearSearch = useEditorStore(s => s.clearSearch)
  const replaceCurrentMatch = useEditorStore(s => s.replaceCurrentMatch)
  const replaceAllMatches = useEditorStore(s => s.replaceAllMatches)
  const readOnly = useEditorStore(s => s.readOnly)

  const [query, setQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [options, setOptions] = useState<SearchOptions>({ ...defaultSearchOptions })
  const [showReplace, setShowReplace] = useState(false)

  // Animation state: keep mounted during exit animation
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)

  // Drag state – use refs for values read during pointermove to avoid stale closures
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const findInputRef = useRef<HTMLInputElement>(null)

  // Handle open/close transitions
  useEffect(() => {
    if (open) {
      setClosing(false)
      setVisible(true)
      setDragOffset({ x: 0, y: 0 }) // reset position on reopen
    }
  }, [open])

  // Focus input and re-run search when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        findInputRef.current?.focus()
        findInputRef.current?.select()
      }, 50)
      // Re-apply search with remembered query
      if (query) setSearch(query, options)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Run search whenever query or options change
  useEffect(() => {
    if (!open) return
    setSearch(query, options)
  }, [query, options, open, setSearch])

  const handleClose = useCallback(() => {
    clearSearch()
    setClosing(true)
  }, [clearSearch])

  const handleAnimationEnd = useCallback(() => {
    if (closing) {
      setVisible(false)
      setClosing(false)
      onClose()
    }
  }, [closing, onClose])

  const updateOption = useCallback(<K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) prevMatch()
      else nextMatch()
    }
  }, [handleClose, nextMatch, prevMatch])

  // Drag: use document-level listeners so dragging works even when pointer leaves the header
  useEffect(() => {
    if (!isDragging) return

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return

      let newX = d.origX + (e.clientX - d.startX)
      let newY = d.origY + (e.clientY - d.startY)

      // Clamp so the modal stays within its parent container
      const modal = modalRef.current
      const parent = modal?.parentElement
      if (modal && parent) {
        const mRect = modal.getBoundingClientRect()
        const pRect = parent.getBoundingClientRect()
        // The modal's CSS position is top:8 right:8, so its natural
        // top-left relative to parent is (parent.width - modal.width - 8, 8).
        // With margin offsets, the effective position becomes:
        //   left = (pRect.width - mRect.width - 8) + newX
        //   top  = 8 + newY
        const naturalLeft = pRect.width - mRect.width - 8
        const naturalTop = 8

        const effectiveLeft = naturalLeft + newX
        const effectiveTop = naturalTop + newY

        // Keep fully inside parent
        const minLeft = 0
        const minTop = 0
        const maxLeft = pRect.width - mRect.width
        const maxTop = pRect.height - mRect.height

        if (effectiveLeft < minLeft) newX = minLeft - naturalLeft
        if (effectiveLeft > maxLeft) newX = maxLeft - naturalLeft
        if (effectiveTop < minTop) newY = minTop - naturalTop
        if (effectiveTop > maxTop) newY = maxTop - naturalTop
      }

      setDragOffset({ x: newX, y: newY })
    }

    const onUp = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [isDragging])

  const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    // Don't initiate drag from buttons inside the header
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
    }
    setIsDragging(true)
  }, [dragOffset])

  if (!visible) return null

  const matchCount = search.matches.length
  const currentIdx = search.currentMatch

  const modalClasses = [
    'find-modal',
    closing ? 'closing' : '',
    isDragging ? 'dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      ref={modalRef}
      className={modalClasses}
      onKeyDown={handleKeyDown}
      onAnimationEnd={handleAnimationEnd}
      style={{
        marginTop: dragOffset.y,
        marginRight: -dragOffset.x,
      }}
    >
      <div
        className="find-modal-header"
        onPointerDown={handleHeaderPointerDown}
      >
        <span className="find-modal-title">Find & Replace</span>
        <button className="find-modal-close" onClick={handleClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>

      <div className="find-modal-body">
        {/* Search mode toggle */}
        <div className="toggle-group" style={{ width: '100%', marginBottom: 8 }}>
          <button
            className={`toggle-btn ${options.mode === 'nucleotide' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => updateOption('mode', 'nucleotide')}
          >
            Nucleotide
          </button>
          <button
            className={`toggle-btn ${options.mode === 'protein' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => updateOption('mode', 'protein')}
          >
            Protein
          </button>
        </div>

        {/* Find input */}
        <div className="find-input-row">
          <input
            ref={findInputRef}
            type="text"
            className="input find-modal-input"
            placeholder={options.mode === 'nucleotide' ? 'Sequence (e.g. ATGCN)…' : 'Amino acids (e.g. MKT)…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="find-nav-group">
            <button className="find-nav-btn" onClick={prevMatch} disabled={matchCount === 0} aria-label="Previous match">
              <ChevronUp size={14} />
            </button>
            <button className="find-nav-btn" onClick={nextMatch} disabled={matchCount === 0} aria-label="Next match">
              <ChevronDown size={14} />
            </button>
          </div>
        </div>

        {/* Match count */}
        {query && (
          <div className="find-match-count">
            {matchCount > 0
              ? `${currentIdx + 1} of ${matchCount} match${matchCount !== 1 ? 'es' : ''}`
              : 'No matches'}
          </div>
        )}

        {/* Options */}
        <div className="find-options">
          {options.mode === 'nucleotide' && (
            <>
              <label className="find-option" title="Also search the reverse complement strand">
                <input
                  type="checkbox"
                  checked={options.revComplement}
                  onChange={e => updateOption('revComplement', e.target.checked)}
                />
                <span>Include reverse complement</span>
              </label>
              <label className="find-option" title="Interpret IUPAC ambiguity codes (e.g. N = any base, R = A or G)">
                <input
                  type="checkbox"
                  checked={options.ambiguity}
                  onChange={e => updateOption('ambiguity', e.target.checked)}
                />
                <span>Include IUPAC ambiguities</span>
              </label>
              <label className="find-option" title="Use a regular expression pattern instead of a literal sequence">
                <input
                  type="checkbox"
                  checked={options.isRegex}
                  onChange={e => updateOption('isRegex', e.target.checked)}
                />
                <span>Regex</span>
              </label>
            </>
          )}
        </div>

        {/* Replace section */}
        <div className="find-replace-toggle">
          <button
            className={`find-replace-toggle-btn ${showReplace ? 'active' : ''}`}
            onClick={() => setShowReplace(!showReplace)}
          >
            {showReplace ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Replace
          </button>
        </div>

        {showReplace && (
          <div className="find-replace-section">
            <input
              type="text"
              className="input find-modal-input"
              placeholder="Replace with…"
              value={replaceText}
              onChange={e => setReplaceText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  replaceCurrentMatch(replaceText)
                }
              }}
            />
            <div className="find-replace-actions">
              <button
                className="find-replace-btn"
                onClick={() => replaceCurrentMatch(replaceText)}
                disabled={currentIdx < 0 || readOnly}
                title="Replace current match"
              >
                <Replace size={13} /> Replace
              </button>
              <button
                className="find-replace-btn"
                onClick={() => replaceAllMatches(replaceText)}
                disabled={matchCount === 0 || readOnly}
                title="Replace all matches"
              >
                <ReplaceAll size={13} /> All
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
