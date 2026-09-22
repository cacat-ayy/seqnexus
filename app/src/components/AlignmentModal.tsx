import './AlignmentModal.css'
/**
 * Alignment modal: input → running → done (opens panel).
 *
 * Users pick sequences from open tabs, sequencing reads, or paste,
 * configure scoring, and run pairwise or multiple alignment.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Plus, Trash2, ChevronDown, ChevronRight, Loader2, FileText, AudioWaveform, ClipboardPaste, AlertTriangle, GripVertical, Scissors, Search, FolderOpen, Check } from 'lucide-react'
import { reverseComplement } from '../models/complement'
import { useEditorStore, applyEdits } from '../store'
import { runAlignment, resolveEngine, type AlignmentHandle } from '../workers/alignment'
import type { AlignmentRequest, AlignmentResult } from '../alignment/types'
import type { MsaEngine } from '../wasm/types'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface SeqEntry {
  id: string
  name: string
  bases: string
  source: 'tab' | 'read' | 'pasted'
  /** Original tab or read ID from the store. */
  sourceId?: string
  /** For reads: whether quality trimming is applied (default true). */
  trimmed?: boolean
  /** For reads: the trimmed bases. */
  trimmedBases?: string
  /** For reads: the full untrimmed bases. */
  untrimmedBases?: string
}

export interface AlignmentInitialEntry {
  id: string
  name: string
  bases: string
  source: 'tab' | 'read' | 'pasted'
  sourceId?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onResult: (result: AlignmentResult, seqType: 'dna' | 'protein') => void
  /** Called for each read→reference alignment result. Auto-detected when entries contain 1 tab + N reads. */
  onReadAlignResult?: (readId: string, refTabId: string, result: AlignmentResult, batchIndex: number, batchTotal: number) => void
  initialEntries?: AlignmentInitialEntry[]
}

let _pasteCounter = 0

type Phase = 'input' | 'running'

export default function AlignmentModal({ open, onClose, onResult, onReadAlignResult, initialEntries }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const seqReads = useEditorStore(s => s.sequencingReads)
  const folders = useEditorStore(s => s.folders)

  const [phase, setPhase] = useState<Phase>('input')
  const [mode, setMode] = useState<'global' | 'local'>('global')
  const [seqType, setSeqType] = useState<'dna' | 'protein'>('dna')
  const [entries, setEntries] = useState<SeqEntry[]>([])

  // MSA engine
  const [engine, setEngine] = useState<MsaEngine>('auto')
  const [resolvedEngine, setResolvedEngine] = useState<'mafft' | 'builtin'>('builtin')
  const [mafftProgress, setMafftProgress] = useState<number | null>(null)

  // Resolve which engine will actually be used
  useEffect(() => {
    if (entries.length >= 3) {
      resolveEngine(engine, entries.length).then(setResolvedEngine)
    }
  }, [engine, entries.length])

  // Scoring
  const [match, setMatch] = useState('1')
  const [mismatch, setMismatch] = useState('-1')
  const [gapOpen, setGapOpen] = useState('-10')
  const [gapExtend, setGapExtend] = useState('-0.5')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Add menus
  const [tabMenuOpen, setTabMenuOpen] = useState(false)
  const [readMenuOpen, setReadMenuOpen] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  // Tab multi-select state
  const [tabFilter, setTabFilter] = useState('')
  const [pendingTabIds, setPendingTabIds] = useState<Set<string>>(new Set())
  const tabFilterRef = useRef<HTMLInputElement>(null)

  // Error
  const [error, setError] = useState<string | null>(null)

  // Menu positioning
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const tabBtnRef = useRef<HTMLButtonElement>(null)
  const readBtnRef = useRef<HTMLButtonElement>(null)

  // Worker handle
  const handleRef = useRef<AlignmentHandle | null>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Reset on open
  useEffect(() => {
    if (open) {
      setPhase('input')
      // Enrich read entries with trim data for the trim toggle
      const enriched: SeqEntry[] = (initialEntries ?? []).map(e => {
        if (e.source === 'read' && e.sourceId) {
          const read = seqReads.find(r => r.id === e.sourceId)
          if (read) {
            const { bases } = applyEdits(read.data.bases, read.edits)
            const trimmedBases = bases.slice(read.trimStart, read.trimEnd || bases.length)
            return { ...e, trimmed: true, trimmedBases, untrimmedBases: bases }
          }
        }
        return e
      })
      setEntries(enriched)
      setError(null)
      setTabMenuOpen(false)
      setReadMenuOpen(false)
      setPasteOpen(false)
      setPasteText('')
      setTabFilter('')
      setPendingTabIds(new Set())
      _pasteCounter = 0
      prevEntryCount.current = 0
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- reset state only on open/close; initialEntries read once

  // Cleanup worker on unmount
  useEffect(() => {
    return () => { handleRef.current?.cancel() }
  }, [])

  // Auto-detect sequence type only when entry count changes
  const prevEntryCount = useRef(0)
  useEffect(() => {
    if (entries.length === 0 || entries.length === prevEntryCount.current) return
    prevEntryCount.current = entries.length
    const allBases = entries.map(e => e.bases).join('')
    const isDna = /^[ACGTURYSWKMBDHVNacguryswkmbdhvn\s\-]*$/.test(allBases)
    setSeqType(isDna ? 'dna' : 'protein')
  }, [entries])

  // Force global when ≥3 sequences
  useEffect(() => {
    if (entries.length >= 3) setMode('global')
  }, [entries.length])

  // Derived algorithm label
  const algorithmInfo = useMemo(() => {
    if (entries.length >= 3) {
      if (resolvedEngine === 'mafft') return { short: 'MAFFT', full: 'MAFFT FFT-NS-2 multiple sequence alignment' }
      return { short: 'Built-in MSA', full: 'Progressive multiple sequence alignment (built-in)' }
    }
    if (mode === 'local') return { short: 'Smith-Waterman', full: 'Local pairwise alignment (Smith-Waterman)' }
    return { short: 'Needleman-Wunsch', full: 'Global pairwise alignment (Needleman-Wunsch)' }
  }, [entries.length, mode, resolvedEngine])

  // Warnings
  const totalBases = useMemo(() => entries.reduce((s, e) => s + e.bases.length, 0), [entries])
  const showWarning = entries.length > 20 || totalBases > 50_000

  // IDs already selected – used to prevent duplicate entries
  const selectedTabIds = useMemo(() => new Set(entries.filter(e => e.source === 'tab' && e.sourceId).map(e => e.sourceId!)), [entries])
  const selectedReadIds = useMemo(() => new Set(entries.filter(e => e.source === 'read' && e.sourceId).map(e => e.sourceId!)), [entries])

  // ── Batch add from tabs (multi-select) ──
  const addTabsBatch = useCallback((tabIds: Set<string>) => {
    if (tabIds.size === 0) return
    const newEntries: SeqEntry[] = []
    for (const tabId of tabIds) {
      if (selectedTabIds.has(tabId)) continue
      const tab = tabs.find(t => t.id === tabId)
      if (!tab) continue
      newEntries.push({
        id: `tab_${tabId}_${Date.now()}_${newEntries.length}`,
        name: tab.doc.name,
        bases: tab.doc.sequence.bases,
        source: 'tab',
        sourceId: tabId,
      })
    }
    if (newEntries.length > 0) {
      setEntries(prev => [...prev, ...newEntries])
    }
    setPendingTabIds(new Set())
    setTabFilter('')
    setTabMenuOpen(false)
  }, [tabs, selectedTabIds])

  // ── Toggle a tab in the pending multi-select ──
  const togglePendingTab = useCallback((tabId: string) => {
    setPendingTabIds(prev => {
      const next = new Set(prev)
      if (next.has(tabId)) next.delete(tabId)
      else next.add(tabId)
      return next
    })
  }, [])

  // ── Toggle all tabs in a folder ──
  const toggleFolderTabs = useCallback((folderTabIds: string[]) => {
    setPendingTabIds(prev => {
      const next = new Set(prev)
      const addable = folderTabIds.filter(id => !selectedTabIds.has(id))
      const allSelected = addable.every(id => next.has(id))
      if (allSelected) {
        for (const id of addable) next.delete(id)
      } else {
        for (const id of addable) next.add(id)
      }
      return next
    })
  }, [selectedTabIds])

  // ── Toggle all visible (filtered) tabs ──
  const toggleAllFiltered = useCallback((filteredTabIds: string[]) => {
    setPendingTabIds(prev => {
      const next = new Set(prev)
      const addable = filteredTabIds.filter(id => !selectedTabIds.has(id))
      const allSelected = addable.every(id => next.has(id))
      if (allSelected) {
        for (const id of addable) next.delete(id)
      } else {
        for (const id of addable) next.add(id)
      }
      return next
    })
  }, [selectedTabIds])

  // ── Add from sequencing read ──
  const addFromRead = useCallback((readId: string) => {
    if (selectedReadIds.has(readId)) return
    const read = seqReads.find(r => r.id === readId)
    if (!read) return
    const { bases } = applyEdits(read.data.bases, read.edits)
    const fullBases = bases
    const trimmedBases = bases.slice(read.trimStart, read.trimEnd || bases.length)
    setEntries(prev => [...prev, {
      id: `read_${readId}_${Date.now()}`,
      name: read.data.name,
      bases: trimmedBases,
      source: 'read',
      sourceId: readId,
      trimmed: true,
      trimmedBases,
      untrimmedBases: fullBases,
    }])
    setReadMenuOpen(false)
  }, [seqReads, selectedReadIds])

  // ── Add from paste ──
  const addFromPaste = useCallback(() => {
    const text = pasteText.trim()
    if (!text) return

    // Parse FASTA or raw
    if (text.startsWith('>')) {
      const seqs: SeqEntry[] = []
      const blocks = text.split(/^(?=>)/m)
      for (const block of blocks) {
        const lines = block.split('\n')
        const header = lines[0].replace(/^>\s*/, '').trim() || `Pasted ${++_pasteCounter}`
        const bases = lines.slice(1).join('').replace(/[^A-Za-z-]/g, '')
        if (bases.length > 0) {
          seqs.push({ id: `paste_${Date.now()}_${_pasteCounter}`, name: header, bases, source: 'pasted' })
        }
      }
      setEntries(prev => [...prev, ...seqs])
    } else {
      const bases = text.replace(/[^A-Za-z]/g, '')
      if (bases.length > 0) {
        setEntries(prev => [...prev, {
          id: `paste_${Date.now()}_${++_pasteCounter}`,
          name: `Pasted ${_pasteCounter}`,
          bases,
          source: 'pasted',
        }])
      }
    }
    setPasteText('')
    setPasteOpen(false)
  }, [pasteText])

  // ── Remove entry ──
  const removeEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  // ── Detect read→reference pattern: exactly 1 tab entry + ≥1 read entries ──
  const readAlignPattern = useMemo(() => {
    const tabEntries = entries.filter(e => e.source === 'tab' && e.sourceId)
    const readEntries = entries.filter(e => e.source === 'read' && e.sourceId)
    if (tabEntries.length === 1 && readEntries.length >= 1 && tabEntries.length + readEntries.length === entries.length) {
      return { refEntry: tabEntries[0], readEntries }
    }
    return null
  }, [entries])

  // ── Run alignment ──
  const handleAlign = useCallback(() => {
    if (entries.length < 2) return
    setError(null)
    setPhase('running')

    const scoring = {
      match: seqType === 'dna' ? parseFloat(match) || 1 : undefined,
      mismatch: seqType === 'dna' ? parseFloat(mismatch) || -1 : undefined,
      matrix: seqType === 'protein' ? 'BLOSUM62' : undefined,
      gapOpen: parseFloat(gapOpen) || -10,
      gapExtend: parseFloat(gapExtend) || -0.5,
    }

    // Read→reference: run N separate pairwise alignments, auto-detect orientation
    if (readAlignPattern && onReadAlignResult) {
      const { refEntry, readEntries } = readAlignPattern
      let completed = 0
      const total = readEntries.length
      let batchIdx = 0
      const refBases = refEntry.bases
      const refName = refEntry.name

      for (const readEntry of readEntries) {
        const myIdx = batchIdx++
        const readBases = readEntry.bases
        const readBasesRC = reverseComplement(readBases)
        const scoringOpts = { match: parseFloat(match) || 1, mismatch: parseFloat(mismatch) || -1, gapOpen: parseFloat(gapOpen) || -10, gapExtend: parseFloat(gapExtend) || -0.5 }

        // Run both orientations in parallel, keep the better score
        const fwdHandle = runAlignment({
          sequences: [
            { name: refName, bases: refBases },
            { name: readEntry.name, bases: readBases },
          ],
          mode: 'global', seqType: 'dna', scoring: scoringOpts,
        })
        const rcHandle = runAlignment({
          sequences: [
            { name: refName, bases: refBases },
            { name: `${readEntry.name} (RC)`, bases: readBasesRC },
          ],
          mode: 'global', seqType: 'dna', scoring: scoringOpts,
        })
        if (total === 1) handleRef.current = fwdHandle

        Promise.all([fwdHandle.promise, rcHandle.promise])
          .then(([fwdResult, rcResult]) => {
            const best = rcResult.score > fwdResult.score ? rcResult : fwdResult
            onReadAlignResult(readEntry.sourceId!, refEntry.sourceId!, best, myIdx, total)
          })
          .catch(err => { setError(`Failed for ${readEntry.name}: ${err instanceof Error ? err.message : String(err)}`) })
          .finally(() => {
            completed++
            if (completed === total) {
              onClose()
              setPhase('input')
              handleRef.current = null
            }
          })
      }
      return
    }

    // Normal alignment (pairwise or MSA)
    const request: AlignmentRequest = {
      sequences: entries.map(e => ({
        name: e.name,
        bases: e.bases,
      })),
      mode: entries.length >= 3 ? 'global' : mode,
      seqType,
      scoring,
      engine: entries.length >= 3 ? engine : undefined,
    }

    setMafftProgress(null)
    const handle = runAlignment(request, (frac) => setMafftProgress(frac))
    handleRef.current = handle

    handle.promise
      .then(result => {
        onResult(result, seqType)
        onClose()
      })
      .catch((err) => {
        setError(err instanceof Error && err.message ? err.message : 'Alignment failed or was cancelled.')
        setPhase('input')
      })
  }, [entries, mode, seqType, match, mismatch, gapOpen, gapExtend, onResult, onReadAlignResult, onClose, readAlignPattern])

  // ── Cancel ──
  const handleCancel = useCallback(() => {
    handleRef.current?.cancel()
    handleRef.current = null
    setPhase('input')
  }, [])

  // ── Backdrop / Escape ──
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (phase === 'running') handleCancel()
      else onClose()
    }
  }, [phase, handleCancel, onClose])

  // Close menus on outside click
  useEffect(() => {
    if (!tabMenuOpen && !readMenuOpen) return
    const handler = () => {
      setTabMenuOpen(false)
      setReadMenuOpen(false)
    }
    const timer = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', handler) }
  }, [tabMenuOpen, readMenuOpen])

  // Drag-and-drop reordering
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(idx))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, toIdx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOverIdx(null); return }
    setEntries(prev => {
      const next = [...prev]
      const [item] = next.splice(dragIdx, 1)
      next.splice(toIdx, 0, item)
      return next
    })
    setDragIdx(null)
    setDragOverIdx(null)
  }, [dragIdx])

  const handleDragEnd = useCallback(() => {
    setDragIdx(null)
    setDragOverIdx(null)
  }, [])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const sourceIcon = (source: SeqEntry['source']) => {
    if (source === 'tab') return <FileText size={13} />
    if (source === 'read') return <AudioWaveform size={13} />
    return <ClipboardPaste size={13} />
  }

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog align-modal" role="dialog" aria-modal="true" aria-labelledby="alignment-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="alignment-modal-title">Sequence Alignment</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {phase === 'input' && (
          <div className="modal-body align-body">
            {/* Mode selector */}
            <div className="align-mode-row">
              <label>Mode</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${mode === 'global' ? 'active' : ''}`}
                  onClick={() => setMode('global')}
                >
                  Global
                </button>
                <button
                  className={`toggle-btn ${mode === 'local' ? 'active' : ''}`}
                  onClick={() => setMode('local')}
                  disabled={entries.length >= 3}
                  title={entries.length >= 3 ? 'Local mode only available for pairwise alignment' : undefined}
                >
                  Local
                </button>
              </div>

              <label style={{ marginLeft: 'auto' }}>Type</label>
              <div className="toggle-group">
                <button
                  className={`toggle-btn ${seqType === 'dna' ? 'active' : ''}`}
                  onClick={() => setSeqType('dna')}
                >
                  DNA
                </button>
                <button
                  className={`toggle-btn ${seqType === 'protein' ? 'active' : ''}`}
                  onClick={() => setSeqType('protein')}
                >
                  Protein
                </button>
              </div>
            </div>

            {/* Algorithm info */}
            {entries.length >= 2 && (
              <div className="align-algo-label" title={readAlignPattern ? 'Each read aligned pairwise against the reference' : algorithmInfo.full}>
                {readAlignPattern
                  ? <>Mode: <strong>Read → Reference</strong> ({readAlignPattern.readEntries.length} read{readAlignPattern.readEntries.length > 1 ? 's' : ''} → {readAlignPattern.refEntry.name})</>
                  : <>Algorithm: <strong>{algorithmInfo.short}</strong>
                    {entries.length >= 3 && (
                      <select
                        className="align-engine-select"
                        value={engine}
                        onChange={e => setEngine(e.target.value as MsaEngine)}
                        title="MSA engine"
                      >
                        <option value="auto">Auto</option>
                        <option value="mafft">MAFFT</option>
                        <option value="builtin">Built-in</option>
                      </select>
                    )}
                  </>
                }
              </div>
            )}

            {/* Sequence list */}
            <div className="align-seq-section">
              <label>Sequences ({entries.length})</label>
              {entries.length > 0 && (
                <div className="align-seq-list">
                  {entries.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className={`align-seq-item${dragIdx === idx ? ' dragging' : ''}${dragOverIdx === idx ? ' drag-over' : ''}`}
                      draggable
                      onDragStart={e => handleDragStart(e, idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={e => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="align-seq-grip" title="Drag to reorder"><GripVertical size={13} /></span>
                      <span className="align-seq-icon">{sourceIcon(entry.source)}</span>
                      <span className="align-seq-name" title={entry.name}>{entry.name}</span>
                      <span className="align-seq-len">{entry.bases.length.toLocaleString()} bp</span>
                      {entry.source === 'read' && entry.untrimmedBases != null && entry.trimmedBases != null && (
                        <button
                          className={`align-seq-trim ${entry.trimmed !== false ? 'active' : ''}`}
                          onClick={() => setEntries(prev => prev.map(e => {
                            if (e.id !== entry.id || !e.untrimmedBases || !e.trimmedBases) return e
                            const nowTrimmed = !e.trimmed
                            return { ...e, trimmed: nowTrimmed, bases: nowTrimmed ? e.trimmedBases : e.untrimmedBases }
                          }))}
                          title={entry.trimmed !== false ? 'Trimmed (click to use full read)' : 'Full read (click to trim)'}
                        >
                          <Scissors size={13} />
                        </button>
                      )}

                      <button className="align-seq-remove" onClick={() => removeEntry(entry.id)} aria-label="Remove">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add buttons */}
              <div className="align-add-row">
                <div className="align-add-dropdown">
                  <button
                    ref={tabBtnRef}
                    className="btn-add"
                    onClick={(e) => {
                      e.stopPropagation()
                      const rect = tabBtnRef.current?.getBoundingClientRect()
                      if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left })
                      setTabMenuOpen(v => {
                        if (!v) { setPendingTabIds(new Set()); setTabFilter('') }
                        return !v
                      })
                      setReadMenuOpen(false)
                    }}
                  >
                    <Plus size={12} /> From tab
                  </button>
                  {tabMenuOpen && (() => {
                    const lowerFilter = tabFilter.toLowerCase()
                    const filteredTabs = (lowerFilter
                      ? tabs.filter(t => t.doc.name.toLowerCase().includes(lowerFilter))
                      : [...tabs]
                    ).sort((a, b) => a.doc.name.localeCompare(b.doc.name))

                    // Group tabs by folder
                    const tabFolderMap = new Map<string, string>()
                    for (const f of folders) {
                      for (const tid of f.tabIds) tabFolderMap.set(tid, f.id)
                    }

                    type FolderGroup = { folder: { id: string; name: string } | null; tabs: typeof filteredTabs }
                    const groups: FolderGroup[] = []
                    const folderGroups = new Map<string, typeof filteredTabs>()
                    const ungrouped: typeof filteredTabs = []

                    for (const t of filteredTabs) {
                      const fid = tabFolderMap.get(t.id)
                      if (fid) {
                        if (!folderGroups.has(fid)) folderGroups.set(fid, [])
                        folderGroups.get(fid)!.push(t)
                      } else {
                        ungrouped.push(t)
                      }
                    }
                    for (const f of folders) {
                      const fTabs = folderGroups.get(f.id)
                      if (fTabs && fTabs.length > 0) {
                        groups.push({ folder: { id: f.id, name: f.name }, tabs: fTabs })
                      }
                    }
                    if (ungrouped.length > 0) {
                      groups.push({ folder: null, tabs: ungrouped })
                    }

                    const filteredIds = filteredTabs.map(t => t.id)
                    const addableFilteredIds = filteredIds.filter(id => !selectedTabIds.has(id))
                    const allFilteredSelected = addableFilteredIds.length > 0 && addableFilteredIds.every(id => pendingTabIds.has(id))
                    const newPendingCount = [...pendingTabIds].filter(id => !selectedTabIds.has(id)).length

                    return (
                      <div
                        className="align-add-menu align-tab-picker"
                        style={{ top: menuPos.top, left: menuPos.left }}
                        onClick={e => e.stopPropagation()}
                      >
                        {/* Search */}
                        <div className="align-tab-search">
                          <Search size={13} />
                          <input
                            ref={tabFilterRef}
                            type="text"
                            placeholder="Filter sequences…"
                            value={tabFilter}
                            onChange={e => setTabFilter(e.target.value)}
                            autoFocus
                          />
                          {tabFilter && (
                            <button className="align-tab-search-clear" onClick={() => setTabFilter('')}>
                              <X size={11} />
                            </button>
                          )}
                        </div>

                        {/* Select all toggle */}
                        {addableFilteredIds.length > 1 && (
                          <button
                            className="align-add-menu-item align-select-all"
                            onClick={() => toggleAllFiltered(addableFilteredIds)}
                          >
                            <span className={`align-checkbox${allFilteredSelected ? ' checked' : ''}`}>
                              {allFilteredSelected && <Check size={10} />}
                            </span>
                            <span style={{ flex: 1 }}>Select all{tabFilter ? ' filtered' : ''}</span>
                            <span className="align-add-menu-item-sub">{addableFilteredIds.length}</span>
                          </button>
                        )}

                        {/* Grouped tab list */}
                        <div className="align-tab-list">
                          {tabs.length === 0 ? (
                            <div className="align-add-menu-empty">No open sequences</div>
                          ) : filteredTabs.length === 0 ? (
                            <div className="align-add-menu-empty">No matches</div>
                          ) : groups.map((group, gi) => {
                            const groupTabIds = group.tabs.map(t => t.id)
                            const addableGroupIds = groupTabIds.filter(id => !selectedTabIds.has(id))
                            const allGroupSelected = addableGroupIds.length > 0 && addableGroupIds.every(id => pendingTabIds.has(id))

                            return (
                              <div key={group.folder?.id ?? '_ungrouped'}>
                                {/* Folder header */}
                                {group.folder && (
                                  <button
                                    className="align-add-menu-item align-folder-header"
                                    onClick={() => toggleFolderTabs(addableGroupIds)}
                                  >
                                    <span className={`align-checkbox${allGroupSelected ? ' checked' : ''}`}>
                                      {allGroupSelected && <Check size={10} />}
                                    </span>
                                    <FolderOpen size={13} />
                                    <span style={{ flex: 1, fontWeight: 500 }}>{group.folder.name}</span>
                                    <span className="align-add-menu-item-sub">{addableGroupIds.length}</span>
                                  </button>
                                )}
                                {!group.folder && groups.length > 1 && gi > 0 && (
                                  <div className="align-folder-divider" />
                                )}

                                {/* Tabs in this group */}
                                {group.tabs.map(t => {
                                  const alreadyAdded = selectedTabIds.has(t.id)
                                  const isPending = pendingTabIds.has(t.id)
                                  return (
                                    <button
                                      key={t.id}
                                      className={`align-add-menu-item${group.folder ? ' align-folder-child' : ''}`}
                                      disabled={alreadyAdded}
                                      onClick={() => togglePendingTab(t.id)}
                                    >
                                      <span className={`align-checkbox${alreadyAdded || isPending ? ' checked' : ''}`}>
                                        {(alreadyAdded || isPending) && <Check size={10} />}
                                      </span>
                                      <FileText size={13} />
                                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.doc.name}</span>
                                      <span className="align-add-menu-item-sub">{alreadyAdded ? 'added' : `${t.doc.sequence.length.toLocaleString()} bp`}</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>

                        {/* Confirm button */}
                        <div className="align-tab-picker-footer">
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={newPendingCount === 0}
                            onClick={() => addTabsBatch(pendingTabIds)}
                          >
                            Add {newPendingCount > 0 ? `${newPendingCount} sequence${newPendingCount > 1 ? 's' : ''}` : 'selected'}
                          </button>
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {seqReads.length > 0 && (
                  <div className="align-add-dropdown">
                    <button
                      ref={readBtnRef}
                      className="btn-add"
                      onClick={(e) => {
                        e.stopPropagation()
                        const rect = readBtnRef.current?.getBoundingClientRect()
                        if (rect) setMenuPos({ top: rect.bottom + 4, left: rect.left })
                        setReadMenuOpen(v => !v)
                        setTabMenuOpen(false)
                      }}
                    >
                      <Plus size={12} /> From read
                    </button>
                    {readMenuOpen && (
                      <div
                        className="align-add-menu"
                        style={{ top: menuPos.top, left: menuPos.left }}
                        onClick={e => e.stopPropagation()}
                      >
                        {seqReads.map(r => {
                          const alreadyAdded = selectedReadIds.has(r.id)
                          return (
                            <button
                              key={r.id}
                              className="align-add-menu-item"
                              disabled={alreadyAdded}
                              onClick={() => addFromRead(r.id)}
                            >
                              <AudioWaveform size={13} />
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.data.name}</span>
                              <span className="align-add-menu-item-sub">{alreadyAdded ? 'added' : `${r.data.bases.length} bp`}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                <button className="btn-add" onClick={() => setPasteOpen(v => !v)}>
                  <Plus size={12} /> Paste
                </button>
              </div>

              {/* Paste area */}
              {pasteOpen && (
                <div className="align-paste-area">
                  <textarea
                    className="input align-paste-textarea"
                    placeholder="Paste raw sequence or FASTA..."
                    value={pasteText}
                    onChange={e => setPasteText(e.target.value)}
                    autoFocus
                  />
                  <div className="align-paste-actions">
                    <button className="btn btn-primary" onClick={addFromPaste} disabled={!pasteText.trim()}>
                      Add
                    </button>
                    <button className="btn" onClick={() => { setPasteOpen(false); setPasteText('') }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Warning */}
            {showWarning && (
              <div className="align-warning">
                <AlertTriangle size={14} />
                Large alignment ({entries.length} sequences, {(totalBases / 1000).toFixed(1)} kb) – may take a while.
              </div>
            )}

            {/* Advanced scoring */}
            <button className="align-advanced-toggle" onClick={() => setAdvancedOpen(v => !v)}>
              {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Scoring parameters
            </button>
            {advancedOpen && (
              <div className="align-advanced-body">
                {seqType === 'dna' && (
                  <div className="align-param" style={{ gridColumn: 'span 2' }}>
                    <label>Preset</label>
                    <select
                      className="select"
                      value={
                        match === '1' && mismatch === '-1' && gapOpen === '-10' && gapExtend === '-0.5' ? 'default' :
                        match === '2' && mismatch === '-3' && gapOpen === '-12' && gapExtend === '-1' ? 'strict' :
                        match === '1' && mismatch === '-0.5' && gapOpen === '-6' && gapExtend === '-0.25' ? 'relaxed' :
                        match === '2' && mismatch === '-3' && gapOpen === '-5' && gapExtend === '-2' ? 'blast' :
                        'custom'
                      }
                      onChange={e => {
                        const v = e.target.value
                        if (v === 'default')   { setMatch('1');  setMismatch('-1');  setGapOpen('-10');  setGapExtend('-0.5') }
                        if (v === 'strict')    { setMatch('2');  setMismatch('-3');  setGapOpen('-12');  setGapExtend('-1') }
                        if (v === 'relaxed')   { setMatch('1');  setMismatch('-0.5'); setGapOpen('-6');  setGapExtend('-0.25') }
                        if (v === 'blast')     { setMatch('2');  setMismatch('-3');  setGapOpen('-5');   setGapExtend('-2') }
                      }}
                    >
                      <option value="custom">Custom</option>
                      <option value="default">Default (1 / -1 / -10 / -0.5)</option>
                      <option value="strict">Strict (2 / -3 / -12 / -1)</option>
                      <option value="relaxed">Relaxed (1 / -0.5 / -6 / -0.25)</option>
                      <option value="blast">BLAST-like (2 / -3 / -5 / -2)</option>
                    </select>
                  </div>
                )}
                {seqType === 'dna' ? (
                  <>
                    <div className="align-param">
                      <label>Match</label>
                      <input type="number" value={match} onChange={e => setMatch(e.target.value)} step="1" />
                    </div>
                    <div className="align-param">
                      <label>Mismatch</label>
                      <input type="number" value={mismatch} onChange={e => setMismatch(e.target.value)} step="1" />
                    </div>
                  </>
                ) : (
                  <div className="align-param" style={{ gridColumn: 'span 2' }}>
                    <label>Matrix</label>
                    <input type="text" value="BLOSUM62" disabled />
                  </div>
                )}
                <div className="align-param">
                  <label>Gap open</label>
                  <input type="number" value={gapOpen} onChange={e => setGapOpen(e.target.value)} step="1" />
                </div>
                <div className="align-param">
                  <label>Gap extend</label>
                  <input type="number" value={gapExtend} onChange={e => setGapExtend(e.target.value)} step="0.5" />
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="align-warning align-error">
                <AlertTriangle size={14} />
                {error}
              </div>
            )}

            {/* Footer */}
            <div className="modal-footer align-footer">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAlign}
                disabled={entries.length < 2}
              >
                {readAlignPattern
                  ? `Align ${readAlignPattern.readEntries.length} read${readAlignPattern.readEntries.length > 1 ? 's' : ''}`
                  : `Align${entries.length >= 3 ? ` (${entries.length} seqs)` : ''}`
                }
              </button>
            </div>
          </div>
        )}

        {phase === 'running' && (
          <div className="modal-body align-body">
            <div className="align-running">
              <Loader2 size={28} className="ann-spin" style={{ color: 'var(--accent)' }} />
              <span className="align-running-text">
                {readAlignPattern
                  ? `Aligning ${readAlignPattern.readEntries.length} read${readAlignPattern.readEntries.length > 1 ? 's' : ''} to reference…`
                  : mafftProgress !== null && mafftProgress < 1
                    ? `Downloading MAFFT (${Math.round(mafftProgress * 100)}%)…`
                    : `Aligning ${entries.length} sequences${resolvedEngine === 'mafft' ? ' (MAFFT)' : ''}…`
                }
              </span>
              <button className="align-cancel-btn" onClick={handleCancel}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
