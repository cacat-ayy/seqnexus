/**
 * An alignment as a workspace in the centre panel: the alignment on the
 * left, an inspector on the right with live statistics for the selection.
 *
 * Viewing is the default. "Edit" turns on direct editing: type residues
 * (overwrite, or insert with the Insert key), Space or '-' to insert a gap,
 * Backspace/Delete to remove gaps or replace residues with gaps, and drag a
 * selected block sideways to slide it through the gaps beside it.
 *
 * Every change goes through `updateAlignment`, so it is a named undo step:
 * Ctrl+Z / Ctrl+Y work here as in the sequence editor.
 */

import './AlignmentWorkspace.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignLeft, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Crosshair, Download, Eraser, FileOutput,
  Languages, Minus, PanelRightClose, PanelRightOpen, Pencil, Plus, Search, Trash2, X, Combine, ArrowUpToLine,
  ArrowDownToLine, TextCursorInput, Columns3, Wand2, ListPlus,
} from 'lucide-react'
import { useEditorStore, type SavedAlignment } from '../../store'
import { notify } from '../../toast'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import { isWidgetKeyTarget } from '../../utils/key-target'
import { originLabel, residueNumberAt, width, type AlnDoc } from '../../msa/model'
import {
  deleteColumnRange, deleteColumns, deleteGaps, eraseBlock, extractRow, insertColumns, insertGaps, insertText,
  addRows,   joinRows, moveRows, orderRows, overwrite, removeBlock, removeRows, renameRow, replaceRegion, reverseComplementAll,
  setReference, slideBlock, type JoinConflict,
} from '../../msa/edit'
import { columnsMatching, pairIdentity, summarize, type StripRule } from '../../msa/stats'
import { findMotif } from '../../msa/search'
import { ALN_FORMATS, writeAlignment } from '../../msa/formats'
import { methodOf } from '../../msa/engines/catalog'
import { DNA_SCHEMES, PROTEIN_SCHEMES, ZOOM_LEVELS, schemeFor, type AlnView } from '../../msa/view'
import Minimap from '../minimap/Minimap'
import { createViewportSource } from '../minimap/viewport'
import ContextMenuPopup, { MenuItem, MenuSeparator, Submenu } from '../ContextMenuPopup'
import AlignmentGrid, { type GridContextTarget, type GridHandle, type HoverInfo } from './AlignmentGrid'
import AlignmentInspector, { HighlightControl, type InspectorActions } from './AlignmentInspector'
import { buildPaintModel, type PaintModel } from './layout'
import { differenceColumns, overviewTracks } from './overview'
import type { Caret, Selection } from './paint'
import { createSignal, useSignal, type Signal } from './signal'
import RealignPanel, { type RealignResult } from './RealignPanel'
import AddSequencesPanel, { type AddResult } from './AddSequencesPanel'
import FigureDialog from './FigureDialog'

interface Props {
  aln: SavedAlignment
  onClose: () => void
  /** Ask for a filename before writing an export. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
  /** Find was asked for from outside (Ctrl+F, the toolbar). */
  findRequested?: boolean
  onFindClosed?: () => void
}

const RESIDUE_KEY = /^[a-zA-Z*]$/

export default function AlignmentWorkspace({ aln, onClose, onExportPrompt, findRequested, onFindClosed }: Props) {
  const { doc, view } = aln
  const updateAlignment = useEditorStore(s => s.updateAlignment)
  const setAlignmentView = useEditorStore(s => s.setAlignmentView)
  const gridRef = useRef<GridHandle>(null)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [caret, setCaret] = useState<Caret | null>(null)
  const [editing, setEditing] = useState(false)
  const [insertMode, setInsertMode] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [tab, setTab] = useState<'selection' | 'display'>('selection')
  const [menu, setMenu] = useState<GridContextTarget | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [realignOpen, setRealignOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [figureOpen, setFigureOpen] = useState(false)
  // A realign is running: edits wait, so the result still fits what it was computed from.
  const [busy, setBusy] = useState(false)
  const hover = useMemo(() => createSignal<HoverInfo | null>(null, (a, b) => a?.rowId === b?.rowId && a?.col === b?.col), [])
  const viewport = useMemo(() => createViewportSource(), [])
  const exportRef = useRef<HTMLDivElement>(null)

  const pm = useMemo(() => buildPaintModel(doc, view), [doc, view])
  const w = pm.width

  // ---- Edits ----
  const busyRef = useRef(false)
  busyRef.current = busy
  const edit = useCallback((fn: (d: AlnDoc) => AlnDoc, label: string, coalesceKey?: string) => {
    if (busyRef.current) { notify.info('Wait for the realignment to finish, or cancel it'); return }
    updateAlignment(aln.id, fn, label, coalesceKey)
  }, [updateAlignment, aln.id])
  const current = () => useEditorStore.getState().alignments.find(a => a.id === aln.id)?.doc ?? doc
  const onView = useCallback((patch: Partial<AlnView>) => setAlignmentView(aln.id, patch), [setAlignmentView, aln.id])

  // Undo can remove rows or columns from under the selection.
  useEffect(() => {
    const ids = new Set(doc.rows.map(r => r.id))
    setSelection(s => {
      if (!s) return s
      const rowIds = s.rowIds.filter(id => ids.has(id))
      const c1 = Math.min(s.c1, w)
      if (rowIds.length === 0 || c1 <= s.c0) return null
      return rowIds.length === s.rowIds.length && c1 === s.c1 ? s : { ...s, rowIds, c1 }
    })
    setCaret(c => (c && ids.has(c.rowId) ? (c.col > w ? { ...c, col: w } : c) : null))
  }, [doc, w])

  const select = useCallback((sel: Selection | null, c: Caret | null) => {
    setSelection(sel)
    if (c) setCaret(c)
  }, [])

  // ---- Find ----
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  const findInput = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (findOpen && query.trim() ? findMotif(doc, query) : []), [findOpen, query, doc])
  useEffect(() => {
    if (findRequested) {
      setFindOpen(true)
      requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select() })
    }
  }, [findRequested])
  const closeFind = () => { setFindOpen(false); onFindClosed?.(); gridRef.current?.focus() }
  const gotoHit = useCallback((i: number) => {
    if (hits.length === 0) return
    const k = ((i % hits.length) + hits.length) % hits.length
    setHitIndex(k)
    const h = hits[k]
    gridRef.current?.reveal(h.rowId, h.c0, h.c1)
  }, [hits])
  useEffect(() => { setHitIndex(0); if (hits.length) gridRef.current?.reveal(hits[0].rowId, hits[0].c0, hits[0].c1) }, [hits])

  // ---- Differences ----
  const diffs = useMemo(() => differenceColumns(pm), [pm])
  const gotoDiff = (dir: 1 | -1) => {
    if (diffs.length === 0) return
    const from = selection ? (dir > 0 ? selection.c1 - 1 : selection.c0) : dir > 0 ? (gridRef.current?.visibleColumns()[0] ?? 0) - 1 : (gridRef.current?.visibleColumns()[1] ?? w)
    let col: number | undefined
    if (dir > 0) col = diffs.find(c => c > from) ?? diffs[0]
    else col = [...diffs].reverse().find(c => c < from) ?? diffs[diffs.length - 1]
    setSelection({ rowIds: doc.rows.map(r => r.id), c0: col, c1: col + 1 })
    gridRef.current?.reveal(null, col)
  }

  // ---- Selection helpers ----
  const allIds = () => doc.rows.map(r => r.id)
  /** Rows an action applies to: the selection's, or the caret's row. */
  const targetRows = (): string[] => selection?.rowIds.length ? [...selection.rowIds] : caret ? [caret.rowId] : []
  const selectionFasta = () => {
    const d = current()
    const ids = new Set(targetRows().length ? targetRows() : allIds())
    const c0 = selection?.c0 ?? 0
    const c1 = selection?.c1 ?? width(d)
    return d.rows.filter(r => ids.has(r.id)).map(r => `>${r.name}\n${r.seq.slice(c0, c1)}`).join('\n') + '\n'
  }

  // ---- Actions ----
  const copySelection = () => {
    copyText(selectionFasta(), selection ? 'Copied the selection as FASTA' : 'Copied the alignment as FASTA')
  }

  const extract = () => {
    const d = current()
    const ids = targetRows().length ? targetRows() : allIds()
    const c0 = selection?.c0 ?? 0
    const c1 = selection?.c1 ?? width(d)
    const store = useEditorStore.getState()
    let last: string | null = null
    let count = 0
    for (const id of ids) {
      const row = d.rows.find(r => r.id === id)
      const bases = extractRow(d, id, c0, c1)
      if (!row || !bases) continue
      last = store.openDocument(row.name, bases, 'linear', `Extracted from the alignment "${aln.name}"`)
      count++
    }
    store.setActiveAlignment(aln.id)
    if (count === 0) { notify.info('Nothing to extract: the selection holds only gaps'); return }
    notify.success(count === 1 ? 'Extracted a new sequence' : `Extracted ${count} new sequences`, {
      action: last ? { label: 'Open', onClick: () => useEditorStore.getState().setActiveTab(last!) } : undefined,
    })
  }

  const undoAction = { label: 'Undo', onClick: () => useEditorStore.getState().undoAlignment(aln.id) }

  const join = (conflict: JoinConflict) => {
    let result: ReturnType<typeof joinRows> | null = null
    edit(d => { result = joinRows(d, targetRows(), { conflict }); return result.doc }, 'Join rows')
    const r = result as ReturnType<typeof joinRows> | null
    if (!r?.rowId) return
    setSelection({ rowIds: [r.rowId], c0: 0, c1: width(current()) })
    notify.success(r.conflicts.length
      ? `Joined rows; ${r.conflicts.length} column${r.conflicts.length === 1 ? '' : 's'} disagreed`
      : 'Joined rows', { action: undoAction })
  }

  const makeReference = (rowId: string | null) => {
    edit(d => setReference(d, rowId), rowId ? 'Set reference row' : 'Clear reference row')
    if (rowId && view.compareTo !== 'reference') onView({ compareTo: 'reference' })
  }

  const removeColumns = () => {
    if (!selection) return
    const n = selection.c1 - selection.c0
    edit(d => deleteColumnRange(d, selection.c0, selection.c1), n === 1 ? 'Delete column' : `Delete ${n} columns`)
    setSelection(null)
  }

  const erase = () => {
    if (!selection) return
    edit(d => eraseBlock(d, selection.rowIds, selection.c0, selection.c1), 'Replace with gaps')
  }

  const removeResidues = () => {
    if (!selection) return
    edit(d => removeBlock(d, selection.rowIds, selection.c0, selection.c1), 'Delete residues')
    setSelection(null)
  }

  const strip = (rule: StripRule) => {
    const mask = columnsMatching(current(), rule)
    let n = 0
    for (let i = 0; i < mask.length; i++) n += mask[i]
    if (n === 0) return
    edit(d => deleteColumns(d, columnsMatching(d, rule)), `Strip ${n} column${n === 1 ? '' : 's'}`)
    setSelection(null)
    notify.success(`Stripped ${n.toLocaleString()} column${n === 1 ? '' : 's'}`, { action: undoAction })
  }

  const sortRows = (by: 'name' | 'identity') => {
    const d = current()
    let ids: string[]
    if (by === 'name') {
      ids = [...d.rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(r => r.id)
    } else {
      const against = d.rows.find(r => r.id === d.referenceId)?.seq ?? pm.consensus
      const score = new Map(d.rows.map(r => [r.id, r.id === d.referenceId ? 2 : pairIdentity(r.seq, against) ?? 0]))
      ids = [...d.rows].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0)).map(r => r.id)
    }
    edit(x => orderRows(x, ids), by === 'name' ? 'Sort rows by name' : 'Sort rows by identity')
  }

  const reverseComplement = () => {
    edit(d => reverseComplementAll(d), 'Reverse complement')
    setSelection(null)
  }

  const moveRowsTo = useCallback((ids: readonly string[], before: number) => {
    edit(d => moveRows(d, ids, before), ids.length === 1 ? 'Move row' : `Move ${ids.length} rows`)
  }, [edit])

  const removeSelectedRows = () => {
    const ids = targetRows()
    if (ids.length === 0 || ids.length >= doc.rows.length) {
      notify.info('An alignment needs at least one row')
      return
    }
    edit(d => removeRows(d, ids), ids.length === 1 ? 'Remove row' : `Remove ${ids.length} rows`)
    setSelection(null)
    notify.success(ids.length === 1 ? 'Removed a row' : `Removed ${ids.length} rows`, { action: undoAction })
  }

  const rename = useCallback((id: string, name: string) => edit(d => renameRow(d, id, name), 'Rename row'), [edit])

  const onSlide = useCallback((rowIds: readonly string[], c0: number, c1: number, delta: number, dragId: number) => {
    if (busyRef.current) return 0
    let moved = 0
    updateAlignment(aln.id, d => {
      const r = slideBlock(d, rowIds, c0, c1, delta, true)
      moved = r.moved
      return r.doc
    }, 'Move residues', `slide:${dragId}`)
    if (moved) {
      setSelection(s => (s ? { ...s, c0: s.c0 + moved, c1: s.c1 + moved } : s))
      setCaret(c => (c ? { ...c, col: c.col + moved } : c))
    }
    return moved
  }, [updateAlignment, aln.id])

  const applyRealign = (r: RealignResult) => {
    if (current() !== r.from) {
      notify.error('The alignment changed while it was being realigned, so the result was not applied')
      return
    }
    updateAlignment(aln.id, d => {
      const next = replaceRegion(d, r.rowIds, r.c0, r.c1, r.rows)
      return r.whole ? { ...next, origin: { method: methodOf(r.engine), detail: r.label, at: Date.now() } } : next
    }, `Realign with ${r.label}`)
    if (!r.whole) {
      const w2 = width(current())
      setSelection(s => (s ? { ...s, c1: Math.min(w2, s.c0 + Math.max(r.rows[0]?.length ?? 0, r.c1 - r.c0)) } : s))
    }
    notify.success(r.whole ? `Realigned with ${r.label}` : `Realigned the selection with ${r.label}`, { action: undoAction })
  }

  const applyAdd = (r: AddResult) => {
    if (current() !== r.from) {
      notify.error('The alignment changed while the sequences were being added, so nothing was added')
      return
    }
    if (r.kind === 'fit') {
      updateAlignment(aln.id, () => r.doc, r.count === 1 ? 'Add a sequence' : `Add ${r.count} sequences`)
      setSelection({ rowIds: r.ids, c0: 0, c1: width(r.doc) })
      requestAnimationFrame(() => gridRef.current?.reveal(r.ids[0], 0))
      notify.success(r.count === 1 ? 'Added a sequence' : `Added ${r.count} sequences`, { action: undoAction })
      return
    }
    updateAlignment(aln.id, d => {
      const grown = addRows(d, r.inputs).doc
      const next = replaceRegion(grown, grown.rows.map(x => x.id), 0, width(grown), r.rows)
      return { ...next, origin: { method: methodOf(r.engine), detail: r.label, at: Date.now() } }
    }, `Add ${r.inputs.length} and realign with ${r.label}`)
    notify.success(`Added ${r.inputs.length === 1 ? 'a sequence' : `${r.inputs.length} sequences`} and realigned with ${r.label}`, { action: undoAction })
  }

  const zoomTo = useCallback((z: number) => onView({ zoom: Math.max(0, Math.min(ZOOM_LEVELS.length - 1, z)) }), [onView])
  const onZoomStep = useCallback((step: number) => zoomTo(view.zoom + step), [zoomTo, view.zoom])

  const actions: InspectorActions = {
    copy: copySelection, extract, join, setReference: makeReference, deleteColumns: removeColumns,
    erase, strip, sortRows, reverseComplement,
  }

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isWidgetKeyTarget(e.target)) return
      const k = e.key.toLowerCase()
      const s = useEditorStore.getState()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.undoAlignment(aln.id) }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); s.redoAlignment(aln.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aln.id])

  const hintedEdit = useRef(false)

  const onGridKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key
    const rows = pm.bodyRows
    const caretIdx = caret ? rows.findIndex(r => r.id === caret.rowId) : -1

    if (mod && key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelection({ rowIds: allIds(), c0: 0, c1: w })
      return
    }
    if (mod && key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return }
    // The window listener skips grids (they own their keys), so undo is handled here too.
    if (mod && !e.altKey && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
      e.preventDefault()
      e.stopPropagation()
      const s = useEditorStore.getState()
      if (key.toLowerCase() === 'z' && !e.shiftKey) s.undoAlignment(aln.id)
      else s.redoAlignment(aln.id)
      return
    }
    if (key === 'Escape') { setSelection(null); return }

    // Movement.
    const arrows: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    if (key in arrows && !mod) {
      e.preventDefault()
      const [dr, dc] = arrows[key]
      if (e.altKey && dc !== 0) {
        if (!editing) { hintEdit(); return }
        const ids = targetRows()
        const c0 = selection?.c0 ?? caret?.col ?? 0
        const c1 = selection?.c1 ?? c0 + 1
        // Shift moves a whole codon, for fixing reading frames.
        if (ids.length) onSlide(ids, c0, c1, dc * (e.shiftKey ? 3 : 1), -Date.now())
        return
      }
      const from = caret && caretIdx >= 0
        ? { r: caretIdx, c: caret.col }
        : { r: gridRef.current?.firstVisibleRow() ?? 0, c: gridRef.current?.visibleColumns()[0] ?? 0 }
      const r = Math.max(0, Math.min(rows.length - 1, from.r + dr))
      const c = Math.max(0, Math.min(editing ? w : w - 1, from.c + dc))
      const row = rows[r]
      if (!row) return
      if (e.shiftKey) {
        const anchor = selection && caret ? { r: rows.findIndex(x => x.id === caret.rowId), c: caret.col } : from
        const a = Math.min(anchor.r, r)
        const b = Math.max(anchor.r, r)
        setSelection({
          rowIds: rows.slice(a, b + 1).map(x => x.id),
          c0: Math.min(anchor.c, c),
          c1: Math.max(anchor.c, c) + 1,
        })
        if (!selection) setCaret({ rowId: rows[from.r].id, col: from.c })
        gridRef.current?.reveal(row.id, c)
        return
      }
      setSelection(null)
      setCaret({ rowId: row.id, col: c })
      gridRef.current?.reveal(row.id, c)
      return
    }
    if (key === 'Home' || key === 'End') {
      e.preventDefault()
      const row = caret ? rows[caretIdx] : rows[0]
      if (!row) return
      const col = key === 'Home' ? 0 : w - 1
      setCaret({ rowId: row.id, col })
      gridRef.current?.reveal(row.id, col)
      return
    }
    if (key === 'Insert') { setInsertMode(m => !m); return }

    // Editing.
    const isType = RESIDUE_KEY.test(key) && !mod && !e.altKey
    const isGap = (key === '-' || key === '.' || key === ' ') && !mod
    const isDelete = key === 'Delete' || key === 'Backspace'
    if (!isType && !isGap && !isDelete) return
    e.preventDefault()
    if (!editing) { hintEdit(); return }

    if (isDelete && selection) {
      if (selection.rowIds.length >= doc.rows.length) removeColumns()
      else if (e.shiftKey) removeResidues()
      else erase()
      return
    }
    if (!caret) return
    const row = current().rows.find(r => r.id === caret.rowId)
    if (!row) return

    if (isType) {
      const ch = key.toUpperCase()
      if (insertMode) edit(d => insertText(d, row.id, caret.col, ch), 'Type residues', `type:${row.id}`)
      else edit(d => overwrite(d, row.id, caret.col, ch), 'Type residues', `type:${row.id}`)
      setSelection(null)
      setCaret({ rowId: row.id, col: caret.col + 1 })
      gridRef.current?.reveal(row.id, caret.col + 1)
      return
    }
    if (isGap) {
      const ids = selection ? selection.rowIds : [row.id]
      const col = selection ? selection.c0 : caret.col
      edit(d => insertGaps(d, ids, col, 1), 'Insert gap', `gap:${ids.join(',')}`)
      if (selection) setSelection({ ...selection, c0: selection.c0 + 1, c1: selection.c1 + 1 })
      setCaret({ rowId: row.id, col: caret.col + 1 })
      return
    }
    // Backspace / Delete at the caret: a gap is removed (pulling the rest
    // left); a residue becomes a gap, so nothing else moves.
    const col = key === 'Backspace' ? caret.col - 1 : caret.col
    if (col < 0 || col >= row.seq.length) return
    if (row.seq[col] === '-') edit(d => deleteGaps(d, [row.id], col, col + 1), 'Delete gap', `del:${row.id}`)
    else edit(d => eraseBlock(d, [row.id], col, col + 1), 'Replace with gaps', `del:${row.id}`)
    if (key === 'Backspace') setCaret({ rowId: row.id, col })
  }

  const hintEdit = () => {
    if (hintedEdit.current) return
    hintedEdit.current = true
    notify.info('Turn on Edit to change residues and gaps', {
      action: { label: 'Edit', onClick: () => setEditing(true) },
    })
  }

  // ---- Header ----
  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== aln.name) useEditorStore.getState().renameAlignment(aln.id, name)
    setNameDraft(null)
  }

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [exportOpen])

  const exportAs = (id: (typeof ALN_FORMATS)[number]['id']) => {
    const f = ALN_FORMATS.find(x => x.id === id)!
    const base = aln.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
    const run = (name: string) => downloadText(writeAlignment(current(), id, { title: aln.name }), name)
    const def = `${base}${f.extensions[0]}`
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }

  const summary = summarize(doc)
  const scheme = schemeFor(view, doc.kind)
  const schemes = doc.kind === 'dna' ? DNA_SCHEMES : PROTEIN_SCHEMES
  const tracks = useMemo(() => overviewTracks(pm, hits), [pm, hits])

  // ---- Context menu ----
  const menuRow = menu?.rowId ? doc.rows.find(r => r.id === menu.rowId) : undefined
  const selRows = targetRows()
  const sourceTab = menuRow?.source?.uid?.startsWith('sequence:')
    ? useEditorStore.getState().tabs.find(t => `sequence:${t.id}` === menuRow.source!.uid)
    : undefined

  return (
    <div className="aw">
      <div className="aw-header">
        <AlignLeft size={14} className="aw-header-icon" />
        <input
          className="aw-title-input"
          value={nameDraft ?? aln.name}
          aria-label="Alignment name"
          title="Rename the alignment"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? aln.name).length)}
        />
        <span className="aw-chip" title={doc.origin.file ? `Read from ${doc.origin.file}` : doc.origin.detail}>{originLabel(doc.origin)}</span>
        <span className="aw-muted">
          {summary.rows.toLocaleString()} {doc.kind === 'protein' ? 'proteins' : 'sequences'} · {summary.width.toLocaleString()} columns
          {summary.identity !== null && <> · {(summary.identity * 100).toFixed(1)}% identity</>}
        </span>
        <span className="aw-spacer" />
        <button
          className={`aw-btn ${editing ? 'active' : ''}`}
          aria-pressed={editing}
          onClick={() => { setEditing(e => !e); gridRef.current?.focus() }}
          title={editing ? 'Stop editing' : 'Edit residues and gaps: type, Space for a gap, drag a selection sideways to move it through gaps'}
        >
          <Pencil size={13} /> {editing ? 'Editing' : 'Edit'}
        </button>
        <div className="aw-export">
          <button
            className={`aw-btn ${addOpen ? 'active' : ''}`}
            onClick={() => setAddOpen(o => !o)}
            aria-expanded={addOpen}
            title="Add open sequences, reads or pasted sequences to this alignment"
          >
            <ListPlus size={13} /> Add
          </button>
          {addOpen && <AddSequencesPanel doc={doc} onApply={applyAdd} onClose={() => setAddOpen(false)} onBusy={setBusy} />}
        </div>
        <div className="aw-export">
          <button
            className={`aw-btn ${realignOpen ? 'active' : ''}`}
            onClick={() => setRealignOpen(o => !o)}
            aria-expanded={realignOpen}
            title="Realign the selection or the whole alignment with MAFFT, MUSCLE or Kalign"
          >
            <Wand2 size={13} /> Realign
          </button>
          {realignOpen && (
            <RealignPanel
              doc={doc}
              selection={selection}
              onApply={applyRealign}
              onClose={() => setRealignOpen(false)}
              onBusy={setBusy}
            />
          )}
        </div>
        <button className={`aw-btn ${findOpen ? 'active' : ''}`} onClick={() => { setFindOpen(true); requestAnimationFrame(() => findInput.current?.focus()) }} title="Find a motif (Ctrl+F)">
          <Search size={13} /> Find
        </button>
        <div className="aw-export" ref={exportRef}>
          <button className="aw-btn" onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen}>
            <Download size={13} /> Export <ChevronDown size={12} />
          </button>
          {exportOpen && (
            <div className="aw-menu" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={() => { setFigureOpen(true); setExportOpen(false) }}>
                <span className="aw-menu-label">Figure…</span>
                <span className="aw-menu-desc">SVG, PNG or PDF of the alignment as shown, for papers and slides</span>
              </button>
              <div className="aw-menu-sep" />
              {ALN_FORMATS.map(f => (
                <button key={f.id} role="menuitem" className="aw-menu-item" onClick={() => { exportAs(f.id); setExportOpen(false) }}>
                  <span className="aw-menu-label">{f.label}</span>
                  <span className="aw-menu-desc">{f.extensions[0]} · {f.description}</span>
                </button>
              ))}
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => { copyText(writeAlignment(current(), 'fasta'), 'Copied the alignment as FASTA'); setExportOpen(false) }}>
                <span className="aw-menu-label">Copy as FASTA</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { copyText(writeAlignment(current(), 'clustal'), 'Copied the alignment as Clustal'); setExportOpen(false) }}>
                <span className="aw-menu-label">Copy as Clustal</span>
              </button>
            </div>
          )}
        </div>
        <button
          className="aw-icon-btn"
          onClick={() => setInspectorOpen(o => !o)}
          title={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'}
          aria-label={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'}
        >
          {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button className="aw-icon-btn" onClick={onClose} title="Close the alignment" aria-label="Close the alignment">
          <X size={15} />
        </button>
      </div>

      <div className="aw-toolbar">
        <label className="aw-tool-label" htmlFor={`aw-scheme-${aln.id}`}>Colour</label>
        <select
          id={`aw-scheme-${aln.id}`}
          className="select aw-select"
          value={scheme}
          title={schemes.find(s => s.id === scheme)?.description}
          onChange={e => onView(doc.kind === 'dna' ? { dnaScheme: e.target.value as AlnView['dnaScheme'] } : { proteinScheme: e.target.value as AlnView['proteinScheme'] })}
        >
          {schemes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <span className="aw-tool-sep" />
        <HighlightControl view={view} hasReference={!!doc.referenceId} onView={onView} />
        <button
          className={`aw-tool-btn ${view.dots ? 'active' : ''}`}
          aria-pressed={view.dots}
          onClick={() => onView({ dots: !view.dots })}
          title="Show residues that match as dots"
        >
          ·&nbsp;Dots
        </button>
        <span className="aw-diff-nav">
          <button className="aw-tool-icon" onClick={() => gotoDiff(-1)} disabled={diffs.length === 0} title="Previous difference" aria-label="Previous difference"><ChevronLeft size={14} /></button>
          <span className="aw-muted" title="Columns where some row differs from the comparison">{diffs.length.toLocaleString()} differing</span>
          <button className="aw-tool-icon" onClick={() => gotoDiff(1)} disabled={diffs.length === 0} title="Next difference" aria-label="Next difference"><ChevronRight size={14} /></button>
        </span>
        {doc.kind === 'dna' && (
          <>
            <span className="aw-tool-sep" />
            <button
              className={`aw-tool-btn ${view.translate ? 'active' : ''}`}
              aria-pressed={view.translate}
              onClick={() => onView({ translate: !view.translate })}
              title="Show the translation under each row"
            >
              <Languages size={13} /> Translate
            </button>
            {view.translate && (
              <select className="select aw-select" value={view.frame} aria-label="Reading frame" onChange={e => onView({ frame: Number(e.target.value) as 0 | 1 | 2 })}>
                <option value={0}>Frame 1</option>
                <option value={1}>Frame 2</option>
                <option value={2}>Frame 3</option>
              </select>
            )}
          </>
        )}
        <span className="aw-spacer" />
        <button className="aw-tool-icon" onClick={() => onZoomStep(-1)} disabled={view.zoom <= 0} title="Zoom out (Ctrl+wheel)" aria-label="Zoom out"><Minus size={14} /></button>
        <input
          type="range"
          className="aw-zoom"
          min={0}
          max={ZOOM_LEVELS.length - 1}
          value={view.zoom}
          aria-label="Zoom"
          onChange={e => zoomTo(Number(e.target.value))}
        />
        <button className="aw-tool-icon" onClick={() => onZoomStep(1)} disabled={view.zoom >= ZOOM_LEVELS.length - 1} title="Zoom in (Ctrl+wheel)" aria-label="Zoom in"><Plus size={14} /></button>
      </div>

      {findOpen && (
        <div className="aw-find">
          <Search size={13} className="aw-find-icon" />
          <input
            ref={findInput}
            className="aw-find-input"
            value={query}
            placeholder={doc.kind === 'dna' ? 'Find a motif (IUPAC codes allowed), gaps ignored' : 'Find a motif (X matches anything), gaps ignored'}
            aria-label="Find a motif"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') gotoHit(hitIndex + (e.shiftKey ? -1 : 1))
              else if (e.key === 'Escape') closeFind()
            }}
          />
          <span className="aw-muted aw-find-count">
            {query.trim() ? (hits.length ? `${hitIndex + 1} of ${hits.length.toLocaleString()}` : 'No matches') : ''}
          </span>
          <button className="aw-tool-icon" onClick={() => gotoHit(hitIndex - 1)} disabled={!hits.length} aria-label="Previous match"><ChevronLeft size={14} /></button>
          <button className="aw-tool-icon" onClick={() => gotoHit(hitIndex + 1)} disabled={!hits.length} aria-label="Next match"><ChevronRight size={14} /></button>
          <button className="aw-tool-icon" onClick={closeFind} aria-label="Close find"><X size={14} /></button>
        </div>
      )}

      <div className="aw-body-row">
        <div className="aw-main">
          <div className="aw-minimap">
            <Minimap
              kind="alignment"
              length={w}
              tracks={tracks}
              viewport={viewport}
              onNavigate={start => gridRef.current?.scrollToColumn(start)}
              selection={selection ? [[selection.c0, selection.c1]] : undefined}
              positionLabel="Column"
              ariaLabel="Alignment overview"
            />
          </div>
          <AlignmentGrid
            ref={gridRef}
            pm={pm}
            selection={selection}
            caret={caret}
            editing={editing}
            insertMode={insertMode}
            hits={hits}
            currentHit={hitIndex}
            hover={hover}
            onViewport={(start, end) => viewport.set({ start, end })}
            onSelect={select}
            onSlide={onSlide}
            onMoveRows={moveRowsTo}
            onRenameRow={rename}
            onContextMenu={setMenu}
            onZoom={onZoomStep}
            onNameWidth={nameWidth => onView({ nameWidth })}
            onKeyDown={onGridKey}
          />
          <StatusBar pm={pm} hover={hover} editing={editing} insertMode={insertMode} onToggleInsert={() => setInsertMode(m => !m)} />
        </div>
        {inspectorOpen && (
          <AlignmentInspector
            doc={doc}
            view={view}
            selection={selection}
            editing={editing}
            tab={tab}
            onTab={setTab}
            onView={onView}
            actions={actions}
          />
        )}
      </div>

      {figureOpen && (
        <FigureDialog pm={pm} selection={selection} name={aln.name} onClose={() => setFigureOpen(false)} onExportPrompt={onExportPrompt} />
      )}

      {menu && (
        <ContextMenuPopup x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Alignment actions">
          {/* Any item closes the menu; a submenu's trigger only opens its flyout. */}
          <div onClick={e => { if (!(e.target as HTMLElement).closest('[aria-haspopup]')) setMenu(null) }}>
            {menu.area === 'name' && menuRow && (
              <>
                <div className="ctx-menu-header">{selRows.length > 1 ? `${selRows.length} rows` : menuRow.name}</div>
                {selRows.length <= 1 && (
                  doc.referenceId === menuRow.id
                    ? <MenuItem icon={<Crosshair size={13} />} onSelect={() => makeReference(null)}>Clear reference</MenuItem>
                    : <MenuItem icon={<Crosshair size={13} />} onSelect={() => makeReference(menuRow.id)}>Set as reference</MenuItem>
                )}
                {selRows.length >= 2 && <MenuItem icon={<Combine size={13} />} onSelect={() => join('ambiguity')}>Join rows</MenuItem>}
                <MenuItem icon={<FileOutput size={13} />} onSelect={extract}>{selRows.length > 1 ? `Extract ${selRows.length} sequences` : 'Extract as sequence'}</MenuItem>
                {sourceTab && (
                  <MenuItem icon={<TextCursorInput size={13} />} onSelect={() => useEditorStore.getState().setActiveTab(sourceTab.id)}>Open {sourceTab.doc.name}</MenuItem>
                )}
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={copySelection} shortcut="Ctrl+C">Copy as FASTA</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<ArrowUpToLine size={13} />} onSelect={() => moveRowsTo(selRows, 0)}>Move to top</MenuItem>
                <MenuItem icon={<ArrowDownToLine size={13} />} onSelect={() => moveRowsTo(selRows, doc.rows.length)}>Move to bottom</MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 size={13} />} danger onSelect={removeSelectedRows}>{selRows.length > 1 ? `Remove ${selRows.length} rows` : 'Remove row'}</MenuItem>
              </>
            )}
            {menu.area === 'cell' && (
              <>
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={copySelection} shortcut="Ctrl+C">{selection ? 'Copy selection' : 'Copy alignment'}</MenuItem>
                <MenuItem icon={<FileOutput size={13} />} onSelect={extract}>{selRows.length > 1 ? `Extract ${selRows.length} sequences` : 'Extract as sequence'}</MenuItem>
                {selRows.length >= 2 && <MenuItem icon={<Combine size={13} />} onSelect={() => join('ambiguity')}>Join rows</MenuItem>}
                {menuRow && doc.referenceId !== menuRow.id && (
                  <MenuItem icon={<Crosshair size={13} />} onSelect={() => makeReference(menuRow.id)}>Set {menuRow.name} as reference</MenuItem>
                )}
                <MenuSeparator />
                {editing ? (
                  <Submenu icon={<Pencil size={13} />} label="Edit">
                    <MenuItem onSelect={() => { const ids = targetRows(); const col = selection?.c0 ?? menu.col ?? 0; edit(d => insertGaps(d, ids, col, 1), 'Insert gap') }} shortcut="Space">Insert gap</MenuItem>
                    {selection && <MenuItem icon={<Eraser size={13} />} onSelect={erase} shortcut="Del">Replace with gaps</MenuItem>}
                    {selection && <MenuItem onSelect={() => edit(d => deleteGaps(d, selection.rowIds, selection.c0, selection.c1), 'Delete gaps')}>Delete gaps in selection</MenuItem>}
                    {selection && <MenuItem danger onSelect={removeResidues} shortcut="Shift+Del">Delete residues</MenuItem>}
                  </Submenu>
                ) : (
                  <MenuItem icon={<Pencil size={13} />} onSelect={() => setEditing(true)}>Turn on editing</MenuItem>
                )}
                <MenuItem icon={<Columns3 size={13} />} onSelect={() => edit(d => insertColumns(d, selection?.c0 ?? menu.col ?? 0, 1), 'Insert gap column')}>Insert gap column</MenuItem>
                {selection && (
                  <MenuItem icon={<Trash2 size={13} />} danger onSelect={removeColumns}>
                    Delete {selection.c1 - selection.c0 === 1 ? 'column' : `${selection.c1 - selection.c0} columns`}
                  </MenuItem>
                )}
              </>
            )}
            {menu.area === 'ruler' && (
              <>
                <MenuItem icon={<ClipboardCopy size={13} />} onSelect={copySelection}>Copy columns</MenuItem>
                <MenuItem icon={<Columns3 size={13} />} onSelect={() => edit(d => insertColumns(d, menu.col ?? 0, 1), 'Insert gap column')}>Insert gap column</MenuItem>
                {selection && (
                  <MenuItem icon={<Trash2 size={13} />} danger onSelect={removeColumns}>
                    Delete {selection.c1 - selection.c0 === 1 ? 'column' : `${selection.c1 - selection.c0} columns`}
                  </MenuItem>
                )}
              </>
            )}
          </div>
        </ContextMenuPopup>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function StatusBar({ pm, hover, editing, insertMode, onToggleInsert }: {
  pm: PaintModel
  hover: Signal<HoverInfo | null>
  editing: boolean
  insertMode: boolean
  onToggleInsert: () => void
}) {
  const h = useSignal(hover)
  let readout: React.ReactNode = (
    <span className="aw-muted">
      {editing
        ? 'Type to change residues · Space inserts a gap · drag a selection, or Alt+←/→, to slide it (Alt+Shift: a codon)'
        : 'Drag to select · click names to select rows · Ctrl+wheel to zoom · right-click for actions'}
    </span>
  )
  if (h && h.col >= 0 && h.col < pm.width) {
    const row = pm.doc.rows.find(r => r.id === h.rowId)
    const ch = row?.seq[h.col]
    const num = row ? residueNumberAt(row, h.col) : null
    const ref = pm.reference && pm.reference !== row ? residueNumberAt(pm.reference, h.col) : null
    readout = (
      <>
        <span>Column <b>{(h.col + 1).toLocaleString()}</b></span>
        {row && (
          <span>
            {row.name}: {ch === '-' ? <i>gap</i> : <><b>{ch}</b> {num !== null && <>#{num.toLocaleString()}</>}</>}
          </span>
        )}
        {ref !== null && <span>reference #{ref.toLocaleString()}</span>}
        <span>consensus <b>{pm.consensus[h.col]}</b></span>
        <span>{Math.round((pm.identity[h.col] ?? 0) * 100)}% identity</span>
      </>
    )
  }
  return (
    <div className="aw-status">
      <div className="aw-status-readout">{readout}</div>
      {editing && (
        <button className="aw-status-mode" onClick={onToggleInsert} title="Insert key switches between overwrite and insert">
          Editing · {insertMode ? 'Insert' : 'Overwrite'}
        </button>
      )}
    </div>
  )
}
