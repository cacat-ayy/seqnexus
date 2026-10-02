/**
 * A Sanger read as a workspace in the centre panel: the trace on the left,
 * a side panel with the read's QC, trim, run details and selection on the
 * right.
 *
 * Viewing is the default. "Edit" turns on editing: type a base (A C G T, N
 * or an IUPAC code) to replace the call at the caret, Insert switches to
 * inserting, Delete/Backspace delete. Edits never touch the trace or the
 * instrument's calls; each is a named undo step (Ctrl+Z / Ctrl+Y).
 *
 * "Reverse complement" shows a reverse-primer read the right way round:
 * traces mirrored, channels swapped, calls complemented. It is remembered
 * per read and changes nothing in the data.
 */

import '../alignment/AlignmentWorkspace.css'
import './ReadWorkspace.css'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  Activity, ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Download, FileOutput, Languages, Minus,
  PanelRightClose, PanelRightOpen, Pencil, Plus, Repeat, Scissors, Layers, Search, Undo2, Redo2, WrapText, X, Trash2,
  ChevronsUpDown,
} from 'lucide-react'
import { useEditorStore, type SequencingRead } from '../../store'
import { notify } from '../../toast'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import { reverseComplement } from '../../models/complement'
import { autoTrim } from '../../io/ab1'
import { buildLayout, KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE, forwardRange, trimForColumns } from '../../sanger/layout'
import { buildTraceModel, findProblems, forwardColumn, translateShown, type TraceModel } from '../../sanger/model'
import {
  deleteColumns, editedIn, editedRead, EDIT_BASE, findInColumns, insertBefore, revertColumns, substitute, toFasta, toFastq,
} from '../../sanger/edits'
import { readQc, VERDICT_LABEL } from '../../sanger/qc'
import {
  DEFAULT_TRACE_VIEW, getTraceView, HEIGHT_MAX, HEIGHT_MIN, subscribeTraceView, updateTraceView, ZOOM_WIDTHS, type TraceView,
} from '../../sanger/view'
import { isWidgetKeyTarget } from '../../utils/key-target'
import Minimap from '../minimap/Minimap'
import { createViewportSource } from '../minimap/viewport'
import ContextMenuPopup, { MenuItem, MenuSeparator } from '../ContextMenuPopup'
import { createSignal, useSignal, type Signal } from '../alignment/signal'
import TraceCanvas, { type TraceCanvasHandle, type TraceSelection } from './TraceCanvas'
import ReadInspector, { type ReadActions } from './ReadInspector'
import { overviewTracks } from './overview'
import TraceFigureDialog from './TraceFigureDialog'
import TrimCallDialog from './TrimCallDialog'
import AssembleDialog from '../contig/AssembleDialog'
import { clearMixedCalls, countMixedCalls } from '../../sanger/mixed'

interface Props {
  read: SequencingRead
  onClose: () => void
  /** Ask for a filename before writing an export. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
  /** Find was asked for from outside (Ctrl+F, the toolbar). */
  findRequested?: boolean
  onFindClosed?: () => void
}

const nf = new Intl.NumberFormat()
const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)} ${n === 1 ? one : many}`

export default function ReadWorkspace({ read, onClose, onExportPrompt, findRequested, onFindClosed }: Props) {
  const { data, edits, trimStart, trimEnd } = read
  const reversed = !!read.reversed
  const change = useEditorStore(s => s.changeSequencingRead)
  const canvasRef = useRef<TraceCanvasHandle>(null)

  // ---- View ----
  const view = useSyncExternalStore(subscribeTraceView, getTraceView, getTraceView)
  const onView = useCallback((patch: Partial<TraceView>) => updateTraceView(patch), [])

  // ---- Model ----
  const layout = useMemo(() => buildLayout(data, edits), [data, edits])
  const baseModel = useMemo(
    () => buildTraceModel(data, edits, trimStart, trimEnd, reversed, layout),
    [data, edits, trimStart, trimEnd, reversed, layout],
  )
  const [trimPreview, setTrimPreview] = useState<[number, number] | null>(null)
  const model: TraceModel = useMemo(() => (trimPreview ? { ...baseModel, trim: trimPreview } : baseModel), [baseModel, trimPreview])
  const n = model.n
  const codons = useMemo(() => (view.translate ? translateShown(model, view.frame) : null), [model, view.translate, view.frame])

  // ---- Selection ----
  const [selection, setSelection] = useState<TraceSelection | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [insertMode, setInsertMode] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [tab, setTab] = useState<'read' | 'selection'>('read')
  const [menu, setMenu] = useState<{ x: number; y: number; col: number } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [figureOpen, setFigureOpen] = useState(false)
  const [trimOpen, setTrimOpen] = useState(false)
  const [assembleOpen, setAssembleOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const hover = useMemo(() => createSignal<number | null>(null), [])
  const viewport = useMemo(() => createViewportSource(), [])
  const exportRef = useRef<HTMLDivElement>(null)

  // Edits can shorten the read under the selection.
  useEffect(() => {
    setSelection(s => (s && s.d0 < n ? (s.d1 > n ? { ...s, d1: n } : s) : null))
    setCaret(c => (c === null ? c : Math.min(c, n)))
  }, [n])

  const select = useCallback((sel: TraceSelection | null, c: number | null) => {
    setSelection(sel)
    if (c !== null) setCaret(c)
    if (sel && sel.d1 - sel.d0 > 1) setTab('selection')
  }, [])

  /** The selection, or the base at the caret. */
  const target = (): TraceSelection | null =>
    selection ?? (caret !== null && caret < n ? { d0: caret, d1: caret + 1 } : null)

  // ---- Edits ----
  const current = () => useEditorStore.getState().sequencingReads.find(r => r.id === read.id) ?? read
  const commitEdits = useCallback((next: SequencingRead['edits'], label: string) => {
    change(read.id, { edits: next }, label)
  }, [change, read.id])
  const undoAction = { label: 'Undo', onClick: () => useEditorStore.getState().undoSequencing(read.id) }
  const fwdBase = (b: string) => (reversed ? reverseComplement(b) : b)

  const typeBase = (raw: string) => {
    if (caret === null) return
    const b = raw.toUpperCase()
    const r = current()
    const L = buildLayout(r.data, r.edits)
    if (insertMode || caret >= n) {
      // Inserting before display column d is inserting before forward column n-d when reversed.
      const fwd = reversed ? L.n - caret : caret
      commitEdits(insertBefore(r.data, r.edits, L, fwd, fwdBase(b)), `Insert ${b}`)
    } else {
      const fwd = forwardColumn(model, caret)
      if (L.kind[fwd] === KIND_DELETE) {
        notify.info('That base is deleted; revert it before changing it')
        return
      }
      commitEdits(substitute(r.data, r.edits, L, fwd, fwdBase(b)), `Change to ${b}`)
    }
    setSelection(null)
    setCaret(caret + 1)
    canvasRef.current?.reveal(caret + 1)
  }

  const deleteRange = (d0: number, d1: number) => {
    const r = current()
    const L = buildLayout(r.data, r.edits)
    const [c0, c1] = forwardRange(L, d0, d1, reversed)
    const next = deleteColumns(r.data, r.edits, L, c0, c1)
    commitEdits(next, d1 - d0 === 1 ? 'Delete base' : `Delete ${plural(d1 - d0, 'base')}`)
  }

  const revertRange = (d0: number, d1: number) => {
    const r = current()
    const L = buildLayout(r.data, r.edits)
    const [c0, c1] = forwardRange(L, d0, d1, reversed)
    const k = editedIn(L, c0, c1)
    if (k === 0) return
    commitEdits(revertColumns(r.edits, L, c0, c1), k === 1 ? 'Revert an edit' : `Revert ${k} edits`)
  }

  const setTrimColumns = useCallback((d0: number, d1: number, label = 'Trim') => {
    const r = current()
    const L = buildLayout(r.data, r.edits)
    const [ts, te] = trimForColumns(L, d0, d1, reversed, r.data.bases.length)
    change(read.id, { trimStart: ts, trimEnd: te }, label)
  }, [change, read.id, reversed]) // eslint-disable-line react-hooks/exhaustive-deps

  const onTrim = useCallback((d0: number, d1: number, commit: boolean) => {
    if (!commit) { setTrimPreview([d0, d1]); return }
    setTrimPreview(null)
    setTrimColumns(d0, d1)
  }, [setTrimColumns])

  // ---- Copy / export ----
  const shownRange = (d0: number, d1: number) => {
    let s = ''
    for (let d = d0; d < d1; d++) if (model.kind[d] !== KIND_DELETE) s += model.shown[d]
    return s
  }
  const fileBase = data.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const keptRead = () => editedRead(data, edits, trimStart, trimEnd, { reversed, layout })

  const copySelection = () => {
    const t = target()
    if (t) copyText(shownRange(t.d0, t.d1), `Copied ${plural(shownRange(t.d0, t.d1).length, 'base')}`)
    else copyText(keptRead().bases, 'Copied the trimmed read')
  }
  const copyRevComp = () => {
    const t = target()
    const s = t ? shownRange(t.d0, t.d1) : keptRead().bases
    copyText(reverseComplement(s), 'Copied the reverse complement')
  }
  const extract = () => {
    const t = target()
    const bases = t ? shownRange(t.d0, t.d1) : keptRead().bases
    if (!bases) { notify.info('Nothing to extract: the selection holds only deleted bases'); return }
    const name = t ? `${data.name} ${t.d0 + 1}-${t.d1}` : data.name
    openAsSequence(name, bases, t ? `Bases ${t.d0 + 1}–${t.d1} of the read "${data.name}"` : undefined)
  }
  const openAsSequence = (name: string, bases: string, description?: string) => {
    const store = useEditorStore.getState()
    const id = store.openDocument(name, bases, 'linear', description ?? `Trimmed and edited from the read "${data.name}"`, 'consensus')
    store.setActiveSequencingRead(read.id)
    notify.success('Opened a new sequence', { action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveTab(id) } })
  }
  const exportFile = (fmt: 'fasta' | 'fastq') => {
    const r = keptRead()
    const text = fmt === 'fastq' ? toFastq(fileBase, r) : toFasta(fileBase, r.bases)
    const def = `${fileBase}.${fmt}`
    const run = (name: string) => downloadText(text, name)
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }

  // ---- Find ----
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  const findInput = useRef<HTMLInputElement>(null)
  const hits = useMemo(
    () => (findOpen && query.trim() ? findInColumns(model.shown, d => model.kind[d] === KIND_DELETE, query) : []),
    [findOpen, query, model],
  )
  useEffect(() => {
    if (findRequested) {
      setFindOpen(true)
      requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select() })
    }
  }, [findRequested])
  const closeFind = () => { setFindOpen(false); onFindClosed?.(); canvasRef.current?.focus() }
  const gotoHit = useCallback((i: number) => {
    if (hits.length === 0) return
    const k = ((i % hits.length) + hits.length) % hits.length
    setHitIndex(k)
    canvasRef.current?.reveal(hits[k][0], hits[k][1])
  }, [hits])
  useEffect(() => { setHitIndex(0); if (hits.length) canvasRef.current?.reveal(hits[0][0], hits[0][1]) }, [hits])

  // ---- Problems ----
  const problems = useMemo(
    () => findProblems(model, { mixedRatio: view.mixedRatio, qualityCutoff: view.qualityCutoff }),
    [model, view.mixedRatio, view.qualityCutoff],
  )
  const gotoProblem = (dir: 1 | -1) => {
    if (problems.length === 0) return
    const from = caret ?? (dir > 0 ? -1 : n)
    const p = dir > 0
      ? problems.find(x => x.d0 > from) ?? problems[0]
      : [...problems].reverse().find(x => x.d1 <= from) ?? problems[problems.length - 1]
    setSelection(p.d1 - p.d0 > 1 ? { d0: p.d0, d1: p.d1 } : null)
    setCaret(p.d0)
    canvasRef.current?.reveal(p.d0, p.d1)
    canvasRef.current?.focus()
  }

  // ---- Zoom ----
  const zoomTo = useCallback((z: number) => onView({ zoom: Math.max(0, Math.min(ZOOM_WIDTHS.length - 1, z)) }), [onView])
  const zoomRef = useRef(view.zoom)
  zoomRef.current = view.zoom
  const heightRef = useRef(view.height)
  heightRef.current = view.height
  const onZoomStep = useCallback((step: number) => zoomTo(zoomRef.current + step), [zoomTo])
  const onHeightStep = useCallback((step: number) => {
    const h = heightRef.current * (step > 0 ? 1.25 : 0.8)
    onView({ height: Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(h * 100) / 100)) })
  }, [onView])

  const toggleReversed = () => {
    useEditorStore.getState().setSequencingReversed(read.id, !reversed)
    // Keep the same bases selected in the mirrored view.
    setSelection(s => (s ? { d0: n - s.d1, d1: n - s.d0 } : s))
    setCaret(c => (c === null ? c : Math.max(0, Math.min(n - 1, n - 1 - c))))
  }

  // ---- Keyboard ----
  const hinted = useRef(false)
  const hintEdit = () => {
    if (hinted.current) return
    hinted.current = true
    notify.info('Turn on Edit to change base calls', { action: { label: 'Edit', onClick: () => setEditing(true) } })
  }
  const [gotoOpen, setGotoOpen] = useState(false)

  const onCanvasKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key
    if (mod && !e.altKey) {
      const k = key.toLowerCase()
      if (k === 'a') { e.preventDefault(); setSelection({ d0: 0, d1: n }); return }
      if (k === 'c') { e.preventDefault(); copySelection(); return }
      if (k === 'g') { e.preventDefault(); setGotoOpen(true); return }
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        e.stopPropagation()
        const s = useEditorStore.getState()
        if (k === 'z' && !e.shiftKey) s.undoSequencing(read.id)
        else s.redoSequencing(read.id)
        return
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') { e.preventDefault(); gotoProblem(key === 'ArrowRight' ? 1 : -1); return }
    }
    if (key === 'Escape') { setSelection(null); return }
    if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
      e.preventDefault()
      const from = caret ?? (canvasRef.current ? Math.floor(canvasRef.current.visibleRange()[0]) : 0)
      const max = editing ? n : n - 1
      const to = key === 'Home' ? 0 : key === 'End' ? max : Math.max(0, Math.min(max, from + (key === 'ArrowLeft' ? -1 : 1)))
      if (e.shiftKey) {
        const anchor = selection ? (caret === selection.d0 ? selection.d1 - 1 : selection.d0) : from
        setSelection({ d0: Math.min(anchor, to), d1: Math.min(n, Math.max(anchor, to) + 1) })
      } else {
        setSelection(null)
      }
      setCaret(to)
      canvasRef.current?.reveal(to)
      return
    }
    if (key === 'Insert') { setInsertMode(m => !m); return }

    const isBase = key.length === 1 && EDIT_BASE.test(key.toUpperCase()) && !mod && !e.altKey
    const isDelete = key === 'Delete' || key === 'Backspace'
    if (!isBase && !isDelete) return
    e.preventDefault()
    if (!editing) { hintEdit(); return }
    if (isBase) { typeBase(key); return }
    if (selection) {
      deleteRange(selection.d0, selection.d1)
      setCaret(selection.d0)
      setSelection(null)
      return
    }
    if (caret === null) return
    const d = key === 'Backspace' ? caret - 1 : caret
    if (d < 0 || d >= n) return
    const wasInsert = model.kind[d] === KIND_INSERT
    deleteRange(d, d + 1)
    // A deleted call keeps its column; an inserted base disappears.
    if (key === 'Backspace') setCaret(d)
    else if (!wasInsert) setCaret(Math.min(n - 1, d + 1))
  }

  // Undo/redo when focus is elsewhere in the workspace (the canvas handles its own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isWidgetKeyTarget(e.target)) return
      if ((e.target as HTMLElement | null)?.closest?.('.tw-canvas-scroller')) return
      const k = e.key.toLowerCase()
      const s = useEditorStore.getState()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.undoSequencing(read.id) }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); s.redoSequencing(read.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [read.id])

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [exportOpen])

  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== data.name) useEditorStore.getState().renameSequencingRead(read.id, name)
    setNameDraft(null)
  }

  const actions: ReadActions = {
    copy: copySelection,
    copyReverseComplement: copyRevComp,
    extract,
    trimToSelection: () => { const t = target(); if (t) setTrimColumns(t.d0, t.d1, 'Trim to selection') },
    autoTrim: () => {
      const [s, e] = autoTrim(data.qualityScores)
      if (e <= s) { notify.info('No stretch of this read reaches Q20'); return }
      change(read.id, { trimStart: s, trimEnd: e }, 'Trim by quality')
    },
    clearTrim: () => change(read.id, { trimStart: 0, trimEnd: data.bases.length }, 'Keep the whole read'),
    revertSelection: () => { const t = target(); if (t) revertRange(t.d0, t.d1) },
    openTrim: () => setTrimOpen(true),
    clearMixed: () => {
      const k = countMixedCalls(edits)
      if (k === 0) return
      change(read.id, { edits: clearMixedCalls(edits) }, 'Clear mixed-base calls')
      notify.success(`Cleared ${plural(k, 'mixed-base call')}`, { action: undoAction })
    },
    revertAll: () => {
      if (edits.length === 0) return
      change(read.id, { edits: [] }, 'Revert all edits')
      notify.success('Reverted every edit', { action: undoAction })
    },
  }

  const qc = readQc(data)
  const tracks = useMemo(() => overviewTracks(model, view, hits), [model, view, hits])
  const undoTop = read.undoStack[read.undoStack.length - 1]
  const redoTop = read.redoStack[read.redoStack.length - 1]
  let kept = 0
  for (let d = model.trim[0]; d < model.trim[1]; d++) if (model.kind[d] !== KIND_DELETE) kept++

  return (
    <div className="aw tw">
      <div className="aw-header">
        <Activity size={14} className="aw-header-icon" />
        <input
          className="aw-title-input"
          value={nameDraft ?? data.name}
          aria-label="Read name"
          title="Rename the read"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? data.name).length)}
        />
        <span className={`read-qc-verdict ${qc.verdict}`} title={qc.issues.join('\n') || 'Passes QC'}>{VERDICT_LABEL[qc.verdict]}</span>
        <span className="aw-muted">
          {plural(data.bases.length, 'base')} · keeping {nf.format(kept)}
          {model.layout.edited > 0 && <> · {plural(model.layout.edited, 'edit')}</>}
        </span>
        <span className="aw-spacer" />
        <button className="aw-icon-btn" onClick={() => useEditorStore.getState().undoSequencing(read.id)} disabled={!undoTop} title={undoTop ? `Undo ${undoTop.label ?? 'the last change'} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo">
          <Undo2 size={14} />
        </button>
        <button className="aw-icon-btn" onClick={() => useEditorStore.getState().redoSequencing(read.id)} disabled={!redoTop} title={redoTop ? `Redo ${redoTop.label ?? 'the change'} (Ctrl+Y)` : 'Nothing to redo'} aria-label="Redo">
          <Redo2 size={14} />
        </button>
        <button
          className={`aw-btn ${editing ? 'active' : ''}`}
          aria-pressed={editing}
          onClick={() => { setEditing(e => !e); canvasRef.current?.focus() }}
          title={editing ? 'Stop editing' : 'Edit base calls: type a base to replace the call, Insert to insert, Delete to delete'}
        >
          <Pencil size={13} /> {editing ? 'Editing' : 'Edit'}
        </button>
        <button
          className={`aw-btn ${reversed ? 'active' : ''}`}
          aria-pressed={reversed}
          onClick={toggleReversed}
          title="Show the read reverse complemented, as for a reverse-primer read. Exports and copies follow what is shown."
        >
          <Repeat size={13} /> Reverse complement
        </button>
        <button className={`aw-btn ${trimOpen ? 'active' : ''}`} onClick={() => setTrimOpen(true)} title="Trim by error rate, quality, primers or vector, and call mixed bases from second peaks">
          <Scissors size={13} /> Trim &amp; call
        </button>
        <button className="aw-btn" onClick={() => setAssembleOpen(true)} title="Map this read to a reference sequence">
          <Layers size={13} /> Map to reference
        </button>
        <button className={`aw-btn ${findOpen ? 'active' : ''}`} onClick={() => { setFindOpen(true); requestAnimationFrame(() => findInput.current?.focus()) }} title="Find a motif (Ctrl+F)">
          <Search size={13} /> Find
        </button>
        <div className="aw-export" ref={exportRef}>
          <button className="aw-btn" onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen}>
            <Download size={13} /> Export <ChevronDown size={12} />
          </button>
          {exportOpen && (
            <div className="aw-menu" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={() => { setExportOpen(false); const r = keptRead(); if (r.bases) openAsSequence(data.name, r.bases) }}>
                <span className="aw-menu-label">Open as a sequence</span>
                <span className="aw-menu-desc">The trimmed, edited read as a new sequence to annotate, align or clone with</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { setFigureOpen(true); setExportOpen(false) }}>
                <span className="aw-menu-label">Figure…</span>
                <span className="aw-menu-desc">SVG, PNG or PDF of the trace, for papers and slides</span>
              </button>
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => { exportFile('fasta'); setExportOpen(false) }}>
                <span className="aw-menu-label">FASTA</span>
                <span className="aw-menu-desc">.fasta · the trimmed, edited bases</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { exportFile('fastq'); setExportOpen(false) }}>
                <span className="aw-menu-label">FASTQ</span>
                <span className="aw-menu-desc">.fastq · bases with qualities; typed bases count as Q40</span>
              </button>
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => { copyText(toFasta(fileBase, keptRead().bases), 'Copied the read as FASTA'); setExportOpen(false) }}>
                <span className="aw-menu-label">Copy as FASTA</span>
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
        <button className="aw-icon-btn" onClick={onClose} title="Close the read" aria-label="Close the read">
          <X size={15} />
        </button>
      </div>

      <div className="aw-toolbar">
        <span className="tw-channels" role="group" aria-label="Trace channels">
          {(['A', 'C', 'G', 'T'] as const).map(b => (
            <button
              key={b}
              className={`tw-channel tw-ch-${b} ${view.channels[b] ? 'on' : ''}`}
              aria-pressed={view.channels[b]}
              onClick={() => onView({ channels: { ...view.channels, [b]: !view.channels[b] } })}
              title={`${view.channels[b] ? 'Hide' : 'Show'} the ${b} trace`}
            >
              {b}
            </button>
          ))}
        </span>
        <span className="aw-tool-sep" />
        <button className={`aw-tool-btn ${view.quality ? 'active' : ''}`} aria-pressed={view.quality} onClick={() => onView({ quality: !view.quality })} title="Show quality bars under the calls">
          Quality
        </button>
        <button className={`aw-tool-btn ${view.mixed ? 'active' : ''}`} aria-pressed={view.mixed} onClick={() => onView({ mixed: !view.mixed })} title={`Mark calls with a second peak of at least ${Math.round(view.mixedRatio * 100)}% and show its base`}>
          Second peaks
        </button>
        <button className={`aw-tool-btn ${view.normalize ? 'active' : ''}`} aria-pressed={view.normalize} onClick={() => onView({ normalize: !view.normalize })} title="Scale peaks to their local height, so the weak end of a read is as readable as the start">
          Even heights
        </button>
        <button className={`aw-tool-btn ${view.translate ? 'active' : ''}`} aria-pressed={view.translate} onClick={() => onView({ translate: !view.translate })} title="Show the translation of the calls as shown">
          <Languages size={13} /> Translate
        </button>
        {view.translate && (
          <select className="select aw-select" value={view.frame} aria-label="Reading frame" onChange={e => onView({ frame: Number(e.target.value) as 0 | 1 | 2 })}>
            <option value={0}>Frame 1</option>
            <option value={1}>Frame 2</option>
            <option value={2}>Frame 3</option>
          </select>
        )}
        <button className={`aw-tool-btn ${view.wrap ? 'active' : ''}`} aria-pressed={view.wrap} onClick={() => onView({ wrap: !view.wrap })} title="Wrap the read into rows that fit the window">
          <WrapText size={13} /> Wrap
        </button>
        <span className="aw-tool-sep" />
        <span className="aw-diff-nav">
          <button className="aw-tool-icon" onClick={() => gotoProblem(-1)} disabled={problems.length === 0} title="Previous place to check (Ctrl+←)" aria-label="Previous place to check"><ChevronLeft size={14} /></button>
          <span className="aw-muted" title="Ambiguous calls, second peaks, low quality and edits in the kept part of the read">{problems.length ? `${nf.format(problems.length)} to check` : 'Nothing to check'}</span>
          <button className="aw-tool-icon" onClick={() => gotoProblem(1)} disabled={problems.length === 0} title="Next place to check (Ctrl+→)" aria-label="Next place to check"><ChevronRight size={14} /></button>
        </span>
        <span className="aw-spacer" />
        <ChevronsUpDown size={13} className="tw-tool-icon" aria-hidden />
        <input
          type="range"
          className="aw-zoom tw-height"
          min={Math.log(HEIGHT_MIN)}
          max={Math.log(HEIGHT_MAX)}
          step={0.01}
          value={Math.log(view.height)}
          aria-label="Peak height"
          title="Peak height (Alt+wheel)"
          onChange={e => onView({ height: Math.round(Math.exp(Number(e.target.value)) * 100) / 100 })}
          onDoubleClick={() => onView({ height: DEFAULT_TRACE_VIEW.height })}
        />
        <span className="aw-tool-sep" />
        <button className="aw-tool-icon" onClick={() => onZoomStep(-1)} disabled={view.zoom <= 0} title="Zoom out (Ctrl+wheel)" aria-label="Zoom out"><Minus size={14} /></button>
        <input type="range" className="aw-zoom" min={0} max={ZOOM_WIDTHS.length - 1} value={view.zoom} aria-label="Zoom" onChange={e => zoomTo(Number(e.target.value))} />
        <button className="aw-tool-icon" onClick={() => onZoomStep(1)} disabled={view.zoom >= ZOOM_WIDTHS.length - 1} title="Zoom in (Ctrl+wheel)" aria-label="Zoom in"><Plus size={14} /></button>
      </div>

      {findOpen && (
        <div className="aw-find">
          <Search size={13} className="aw-find-icon" />
          <input
            ref={findInput}
            className="aw-find-input"
            value={query}
            placeholder="Find a motif in the read as shown (IUPAC codes allowed)"
            aria-label="Find a motif"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') gotoHit(hitIndex + (e.shiftKey ? -1 : 1))
              else if (e.key === 'Escape') closeFind()
            }}
          />
          <span className="aw-muted aw-find-count">
            {query.trim() ? (hits.length ? `${hitIndex + 1} of ${nf.format(hits.length)}` : 'No matches') : ''}
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
              kind="chromatogram"
              length={n}
              tracks={tracks}
              viewport={viewport}
              onNavigate={start => canvasRef.current?.scrollToColumn(start, 'start')}
              selection={selection ? [[selection.d0, selection.d1]] : undefined}
              positionLabel="Base"
              ariaLabel="Read overview"
            />
          </div>
          <TraceCanvas
            ref={canvasRef}
            model={model}
            view={view}
            codons={codons}
            selection={selection}
            caret={caret}
            editing={editing}
            insertMode={insertMode}
            hits={hits}
            currentHit={hitIndex}
            hover={hover}
            onSelect={select}
            onTrim={onTrim}
            onZoom={onZoomStep}
            onHeight={onHeightStep}
            onViewport={(start, end) => viewport.set({ start, end })}
            onContextMenu={setMenu}
            onKeyDown={onCanvasKey}
          />
          <StatusBar
            model={model}
            hover={hover}
            caret={caret}
            selection={selection}
            editing={editing}
            insertMode={insertMode}
            onToggleInsert={() => setInsertMode(m => !m)}
            gotoOpen={gotoOpen}
            onGoto={d => {
              setGotoOpen(false)
              if (d === null) return
              const c = Math.max(0, Math.min(n - 1, d))
              setSelection(null)
              setCaret(c)
              canvasRef.current?.scrollToColumn(c)
              canvasRef.current?.focus()
            }}
            onOpenGoto={() => setGotoOpen(true)}
          />
        </div>
        {inspectorOpen && (
          <ReadInspector
            model={model}
            view={view}
            selection={selection}
            caret={caret}
            tab={tab}
            onTab={setTab}
            actions={actions}
          />
        )}
      </div>

      {trimOpen && <TrimCallDialog readIds={[read.id]} onClose={() => setTrimOpen(false)} />}
      {assembleOpen && <AssembleDialog readIds={[read.id]} onClose={() => setAssembleOpen(false)} />}

      {figureOpen && (
        <TraceFigureDialog model={model} view={view} selection={selection} name={data.name} onClose={() => setFigureOpen(false)} onExportPrompt={onExportPrompt} />
      )}

      {menu && (
        <ContextMenuPopup x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Read actions">
          <div onClick={() => setMenu(null)}>
            <div className="ctx-menu-header">
              {selection && selection.d1 - selection.d0 > 1 ? `Bases ${nf.format(selection.d0 + 1)}–${nf.format(selection.d1)}` : `Base ${nf.format(menu.col + 1)}`}
            </div>
            <MenuItem icon={<ClipboardCopy size={13} />} onSelect={copySelection} shortcut="Ctrl+C">Copy</MenuItem>
            <MenuItem icon={<Repeat size={13} />} onSelect={copyRevComp}>Copy reverse complement</MenuItem>
            <MenuItem icon={<FileOutput size={13} />} onSelect={extract}>Extract as sequence</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Scissors size={13} />} onSelect={() => setTrimColumns(menu.col, model.trim[1], 'Trim the start')}>Trim everything before this</MenuItem>
            <MenuItem icon={<Scissors size={13} />} onSelect={() => setTrimColumns(model.trim[0], menu.col + 1, 'Trim the end')}>Trim everything after this</MenuItem>
            {selection && selection.d1 - selection.d0 > 1 && (
              <MenuItem icon={<Scissors size={13} />} onSelect={actions.trimToSelection}>Trim to the selection</MenuItem>
            )}
            <MenuSeparator />
            {(() => {
              const t = target()
              if (!t) return null
              const [c0, c1] = forwardRange(layout, t.d0, t.d1, reversed)
              const k = editedIn(layout, c0, c1)
              return (
                <>
                  {k > 0 && <MenuItem icon={<Undo2 size={13} />} onSelect={() => revertRange(t.d0, t.d1)}>{k === 1 ? 'Revert the edit' : `Revert ${k} edits`}</MenuItem>}
                  {editing
                    ? <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => deleteRange(t.d0, t.d1)} shortcut="Del">{t.d1 - t.d0 === 1 ? 'Delete base' : `Delete ${plural(t.d1 - t.d0, 'base')}`}</MenuItem>
                    : <MenuItem icon={<Pencil size={13} />} onSelect={() => setEditing(true)}>Turn on editing</MenuItem>}
                </>
              )
            })()}
          </div>
        </ContextMenuPopup>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function StatusBar({ model: m, hover, caret, selection, editing, insertMode, onToggleInsert, gotoOpen, onGoto, onOpenGoto }: {
  model: TraceModel
  hover: Signal<number | null>
  caret: number | null
  selection: TraceSelection | null
  editing: boolean
  insertMode: boolean
  onToggleInsert: () => void
  gotoOpen: boolean
  onGoto: (d: number | null) => void
  onOpenGoto: () => void
}) {
  const h = useSignal(hover)
  const [draft, setDraft] = useState('')
  let readout: React.ReactNode = (
    <span className="aw-muted">
      {editing
        ? `Type a base to ${insertMode ? 'insert it' : 'replace the call'} · Delete removes · Insert switches mode · Ctrl+→ next place to check`
        : 'Drag to select · drag the ruler handles to trim · Ctrl+wheel zoom · Alt+wheel peak height · right-click for actions'}
    </span>
  )
  if (h !== null && h >= 0 && h < m.n) readout = <HoverReadout m={m} d={h} />

  const where = selection && selection.d1 - selection.d0 > 1
    ? `${nf.format(selection.d0 + 1)}–${nf.format(selection.d1)} (${nf.format(selection.d1 - selection.d0)} bp)`
    : caret !== null ? `Base ${nf.format(Math.min(caret, m.n - 1) + 1)}` : 'Go to…'

  return (
    <div className="aw-status">
      <div className="aw-status-readout">{readout}</div>
      {gotoOpen ? (
        <input
          className="tw-goto"
          autoFocus
          value={draft}
          placeholder={`1–${nf.format(m.n)}`}
          aria-label="Go to base"
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { setDraft(''); onGoto(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const v = parseInt(draft.replace(/[^\d]/g, ''), 10)
              setDraft('')
              onGoto(Number.isFinite(v) ? v - 1 : null)
            } else if (e.key === 'Escape') { setDraft(''); onGoto(null) }
          }}
        />
      ) : (
        <button className="aw-status-mode" onClick={onOpenGoto} title="Go to a base (Ctrl+G)">{where}</button>
      )}
      {editing && (
        <button className="aw-status-mode" onClick={onToggleInsert} title="Insert key switches between replacing and inserting">
          Editing · {insertMode ? 'Insert' : 'Replace'}
        </button>
      )}
    </div>
  )
}

function HoverReadout({ m, d }: { m: TraceModel; d: number }) {
  const c = forwardColumn(m, d)
  const k = m.kind[d]
  const o = m.layout.origin[c]
  const b = m.shown[d]
  const parts: React.ReactNode[] = [<span key="pos">Base <b>{nf.format(d + 1)}</b></span>]
  if (k === KIND_INSERT) {
    parts.push(<span key="call"><b className="tw-call">{b}</b> inserted by hand</span>)
  } else {
    const q = m.quality[d]
    parts.push(
      <span key="call">
        <b className="tw-call">{b}</b>
        {!m.data.metadata.qualityMissing && <> Q{q}</>}
        {k === KIND_SUBSTITUTE && <> · was {m.original[d]}</>}
        {k === KIND_DELETE && <> · deleted</>}
      </span>,
    )
    if (o < m.peaks.length) {
      const hs = (['A', 'C', 'G', 'T'] as const).map((ch, i) => {
        // In a reversed view the A row shows the forward T channel.
        const fi = m.reversed ? 3 - i : i
        return <span key={ch} className={`tw-ch-${ch}`}>{ch} {nf.format(Math.round(m.peaks.heights[o * 4 + fi]))}</span>
      })
      parts.push(<span key="peaks" className="tw-peaks">{hs}</span>)
      const r = m.secondRatio[d]
      if (r >= 0.15) parts.push(<span key="ratio">second peak {m.secondBase[d]} {Math.round(r * 100)}%</span>)
    }
    if (m.reversed || m.layout.edited > 0) parts.push(<span key="orig" className="aw-muted">read position {nf.format(o + 1)}</span>)
  }
  if (d < m.trim[0] || d >= m.trim[1]) parts.push(<span key="trim" className="aw-muted">trimmed</span>)
  return <>{parts}</>
}
