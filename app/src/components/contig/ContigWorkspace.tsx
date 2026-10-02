/**
 * A contig as a workspace: reference, consensus and coverage on top, every
 * read below with its trace lined up under its bases, and a side panel for
 * the contig and the column under the caret.
 *
 * Viewing is the default. "Edit" turns on editing the reads' bases in the
 * contig: type a base, '-' or Delete for a gap, Space to insert a gap
 * column. Edits change the contig's copies of the reads, never the reads,
 * and each is a named undo step (Ctrl+Z / Ctrl+Y).
 */

import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import '../sanger/ReadQcSummary.css'
import './ContigWorkspace.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown, ChevronLeft, ChevronRight, ClipboardCopy, Columns3, Download, FileOutput, Languages, Layers, Minus,
  PanelRightClose, PanelRightOpen, Pencil, Plus, Redo2, Search, Table2, Trash2, Undo2, X, Activity, ShieldCheck, Tags,
} from 'lucide-react'
import { useEditorStore, type Contig, type SequencingRead } from '../../store'
import { notify } from '../../toast'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import { isWidgetKeyTarget } from '../../utils/key-target'
import { translateCodon } from '../../utils/codon'
import { computeConsensus, consensusSequence } from '../../assembly/consensus'
import { deleteColumns, insertColumns, removeRows, setCell, setCells } from '../../assembly/edit'
import { contigToAlignment } from '../../assembly/export'
import { CONTIG_ZOOM, type ContigView } from '../../assembly/view'
import type { ContigRow } from '../../assembly/types'
import { writeAlignment } from '../../msa/formats'
import { findInColumns, toFasta } from '../../sanger/edits'
import { readQc } from '../../sanger/qc'
import Minimap from '../minimap/Minimap'
import { createViewportSource } from '../minimap/viewport'
import { profileTrack } from '../minimap/tracks/profile'
import { markerTrack } from '../minimap/tracks/markers'
import type { MinimapTrack } from '../minimap/types'
import ContextMenuPopup, { MenuItem, MenuSeparator } from '../ContextMenuPopup'
import { createSignal, useSignal, type Signal } from '../alignment/signal'
import ContigCanvas, { type ContigCanvasHandle, type HoverCell } from './ContigCanvas'
import ContigInspector, { type ContigActions } from './ContigInspector'
import VerifyDialog from './VerifyDialog'
import { callVariants, referenceBases, variantsCsv, type Variant } from '../../assembly/variants'
import { featuresInColumns, refFeatures, repeatAnnotations, variantAnnotations } from '../../assembly/features'
import { findTandemRepeats } from '../../assembly/repeats'
import type { AnnotationData } from '../../models/Annotation'
import { geometry, rowTrace, type ContigSelection, type PaintInput, type RowTrace } from './paint'

interface Props {
  contig: Contig
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
  findRequested?: boolean
  onFindClosed?: () => void
}

const nf = new Intl.NumberFormat()
const BASE_KEY = /^[ACGTNRYSWKMBDHV]$/

export default function ContigWorkspace({ contig, onClose, onExportPrompt, findRequested, onFindClosed }: Props) {
  const { doc, view } = contig
  const update = useEditorStore(s => s.updateContig)
  const setContigView = useEditorStore(s => s.setContigView)
  const allReads = useEditorStore(s => s.sequencingReads)
  const canvasRef = useRef<ContigCanvasHandle>(null)
  const onView = useCallback((patch: Partial<ContigView>) => setContigView(contig.id, patch), [setContigView, contig.id])

  const [selection, setSelection] = useState<ContigSelection | null>(null)
  const [caret, setCaret] = useState<{ row: number; col: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [tab, setTab] = useState<'contig' | 'column' | 'variants'>('contig')
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number; gutter: boolean } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const exportRef = useRef<HTMLDivElement>(null)
  const hover = useMemo(() => createSignal<HoverCell | null>(null, (a, b) => a?.row === b?.row && a?.col === b?.col), [])
  const viewport = useMemo(() => createViewportSource(), [])

  // ---- Derived ----
  const reads = useMemo(() => new Map(allReads.map(r => [r.id, r])), [allReads])
  const cons = useMemo(() => computeConsensus(doc, view.consensus), [doc, view.consensus])
  const refPos = useMemo(() => {
    const out = new Int32Array(doc.width)
    if (!doc.reference) return out
    let n = 0
    const L = doc.reference.length
    for (let c = 0; c < doc.width; c++) if (doc.reference.seq[c] !== '-') out[c] = (n++ % L) + 1
    return out
  }, [doc])
  const traceCache = useMemo(() => new Map<string, RowTrace | null>(), [doc, reads]) // eslint-disable-line react-hooks/exhaustive-deps
  const traces = useCallback((row: ContigRow) => {
    if (!traceCache.has(row.id)) traceCache.set(row.id, rowTrace(row, row.readId ? reads.get(row.readId)?.data : undefined))
    return traceCache.get(row.id) ?? null
  }, [traceCache, reads])
  const codons = useMemo(() => {
    if (!view.translate) return null
    const cols: number[] = []
    for (let c = 0; c < doc.width; c++) if (cons.bases[c] !== '-' && cons.bases[c] !== ' ') cols.push(c)
    const out: { c0: number; c1: number; aa: string }[] = []
    for (let i = view.frame; i + 3 <= cols.length; i += 3) {
      out.push({ c0: cols[i], c1: cols[i + 2] + 1, aa: translateCodon(cons.bases[cols[i]] + cons.bases[cols[i + 1]] + cons.bases[cols[i + 2]]) })
    }
    return out
  }, [view.translate, view.frame, cons, doc.width])
  const refTabId = doc.reference?.tabId ?? null
  const refTab = useEditorStore(s => (refTabId ? s.tabs.find(t => t.id === refTabId) : undefined))
  const features = useMemo(() => (refTab ? refFeatures(refTab.doc.annotations.map(a => a.toData())) : []), [refTab])
  const colFeatures = useMemo(() => featuresInColumns(doc, features), [doc, features])
  const variants = useMemo(() => callVariants(doc, cons.bases, features, view.variants), [doc, cons, features, view.variants])
  const variantCols = useMemo(() => variants.map(v => [v.c0, v.c1] as [number, number]), [variants])
  const repeats = useMemo(() => (doc.reference ? findTandemRepeats(referenceBases(doc)) : []), [doc])
  const cellW = CONTIG_ZOOM[view.zoom] ?? 12
  const geo = useMemo(() => geometry(doc, view, cellW, colFeatures.length > 0), [doc, view, cellW, colFeatures.length])
  const readNames = useCallback((row: ContigRow) => {
    const read = row.readId ? reads.get(row.readId) : undefined
    return { name: row.name, verdict: read ? readQc(read.data).verdict : undefined }
  }, [reads])
  const input: PaintInput = useMemo(
    () => ({ doc, cons, view, geo, refPos, traces, codons, readNames, features: view.features ? colFeatures : [], variants: variantCols }),
    [doc, cons, view, geo, refPos, traces, codons, readNames, colFeatures, variantCols],
  )

  // Edits can remove rows or columns under the selection.
  useEffect(() => {
    setSelection(s => {
      if (!s) return s
      const c1 = Math.min(s.c1, doc.width)
      const r1 = s.r0 < 0 ? s.r1 : Math.min(s.r1, doc.rows.length)
      if (c1 <= s.c0 || (s.r0 >= 0 && r1 <= s.r0)) return null
      return c1 === s.c1 && r1 === s.r1 ? s : { ...s, c1, r1 }
    })
    setCaret(c => (c && c.row < doc.rows.length && c.col < doc.width ? c : null))
  }, [doc])

  const select = useCallback((sel: ContigSelection | null, c: { row: number; col: number } | null) => {
    setSelection(sel)
    if (c) { setCaret(c); setTab('column') }
  }, [])

  // ---- Edits ----
  const edit = useCallback((fn: Parameters<typeof update>[1], label: string) => update(contig.id, fn, label), [update, contig.id])
  const undoAction = { label: 'Undo', onClick: () => useEditorStore.getState().undoContig(contig.id) }
  const hinted = useRef(false)
  const hintEdit = () => {
    if (hinted.current) return
    hinted.current = true
    notify.info('Turn on Edit to change bases in the contig', { action: { label: 'Edit', onClick: () => setEditing(true) } })
  }

  const resolveColumn = (col: number, base: string) => {
    const cells = doc.rows.filter(r => col >= r.start && col < r.start + r.seq.length).map(r => ({ rowId: r.id, col, ch: base }))
    edit(d => setCells(d, cells), `Set column ${col + 1} to ${base === '-' ? 'a gap' : base}`)
  }

  const removeReads = (ids: string[]) => {
    if (ids.length >= doc.rows.length) { notify.info('A contig needs at least one read'); return }
    edit(d => removeRows(d, ids), ids.length === 1 ? 'Remove a read' : `Remove ${ids.length} reads`)
    setSelection(null)
    notify.success(ids.length === 1 ? 'Removed the read from the contig' : `Removed ${ids.length} reads from the contig`, { action: undoAction })
  }

  // ---- Export ----
  const fileBase = contig.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const consensusBases = () => consensusSequence(cons)
  const openConsensus = () => {
    const bases = consensusBases()
    if (!bases) { notify.info('The contig has no consensus yet'); return }
    const store = useEditorStore.getState()
    const id = store.openDocument(`${contig.name} consensus`, bases, 'linear', `Consensus of ${doc.rows.length} reads${doc.reference ? ` mapped to ${doc.reference.name}` : ''}`, 'consensus')
    store.setActiveContig(contig.id)
    notify.success('Opened the consensus as a new sequence', { action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveTab(id) } })
  }
  const openAlignment = () => {
    const store = useEditorStore.getState()
    const id = store.addAlignment(contigToAlignment(doc, contig.name, view.consensus), { name: `${contig.name} (alignment)` })
    store.setActiveContig(contig.id)
    notify.success('Opened the contig as an alignment', { action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveAlignment(id) } })
  }
  const download = (text: string, def: string) => {
    const run = (name: string) => downloadText(text, name)
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }

  const selectionText = () => {
    const s = selection
    if (!s || s.r0 < 0) {
      const c0 = s?.c0 ?? 0
      const c1 = s?.c1 ?? doc.width
      return { text: cons.bases.slice(c0, c1).replace(/[- ]/g, ''), what: 'consensus' }
    }
    const lines = doc.rows.slice(s.r0, s.r1).map(r => {
      const a = Math.max(s.c0, r.start) - r.start
      const b = Math.min(s.c1, r.start + r.seq.length) - r.start
      return `>${r.name}\n${b > a ? r.seq.slice(a, b) : ''}`
    })
    return { text: lines.join('\n') + '\n', what: s.r1 - s.r0 === 1 ? 'the read' : `${s.r1 - s.r0} reads` }
  }
  const copySelection = () => {
    const { text, what } = selectionText()
    copyText(text, `Copied ${what}`)
  }

  // ---- Find (in the consensus) ----
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitIndex, setHitIndex] = useState(0)
  const findInput = useRef<HTMLInputElement>(null)
  const hits = useMemo(
    () => (findOpen && query.trim() ? findInColumns(cons.bases, c => cons.bases[c] === '-' || cons.bases[c] === ' ', query) : []),
    [findOpen, query, cons],
  )
  useEffect(() => {
    if (findRequested) { setFindOpen(true); requestAnimationFrame(() => { findInput.current?.focus(); findInput.current?.select() }) }
  }, [findRequested])
  const closeFind = () => { setFindOpen(false); onFindClosed?.(); canvasRef.current?.focus() }
  const gotoHit = useCallback((i: number) => {
    if (!hits.length) return
    const k = ((i % hits.length) + hits.length) % hits.length
    setHitIndex(k)
    canvasRef.current?.revealColumn(hits[k][0])
  }, [hits])
  useEffect(() => { setHitIndex(0); if (hits.length) canvasRef.current?.revealColumn(hits[0][0]) }, [hits])

  // ---- Disagreements ----
  const gotoDiff = (dir: 1 | -1) => {
    const list = cons.disagreements
    if (!list.length) return
    const from = caret?.col ?? (dir > 0 ? -1 : doc.width)
    const col = dir > 0 ? list.find(c => c > from) ?? list[0] : [...list].reverse().find(c => c < from) ?? list[list.length - 1]
    // The first read that disagrees there.
    const row = doc.rows.findIndex(r => {
      const k = col - r.start
      return k >= 0 && k < r.seq.length && r.seq[k] !== cons.bases[col]
    })
    setSelection(null)
    setCaret({ row: Math.max(0, row), col })
    setTab('column')
    canvasRef.current?.revealColumn(col, row)
    canvasRef.current?.focus()
  }

  // ---- Zoom ----
  const zoomRef = useRef(view.zoom)
  zoomRef.current = view.zoom
  const zoomTo = useCallback((z: number) => onView({ zoom: Math.max(0, Math.min(CONTIG_ZOOM.length - 1, z)) }), [onView])
  const onZoomStep = useCallback((step: number) => zoomTo(zoomRef.current + step), [zoomTo])

  // ---- Keyboard ----
  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key
    if (mod && !e.altKey) {
      const k = key.toLowerCase()
      if (k === 'a') { e.preventDefault(); setSelection({ r0: 0, r1: doc.rows.length, c0: 0, c1: doc.width }); return }
      if (k === 'c') { e.preventDefault(); copySelection(); return }
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        e.stopPropagation()
        const s = useEditorStore.getState()
        if (k === 'z' && !e.shiftKey) s.undoContig(contig.id)
        else s.redoContig(contig.id)
        return
      }
      if (key === 'ArrowRight' || key === 'ArrowLeft') { e.preventDefault(); gotoDiff(key === 'ArrowRight' ? 1 : -1); return }
    }
    if (key === 'Escape') { setSelection(null); return }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }
    if (key in arrows && !mod) {
      e.preventDefault()
      const [dr, dc] = arrows[key]
      const from = caret ?? { row: 0, col: Math.floor(canvasRef.current?.visibleColumns()[0] ?? 0) }
      const to = {
        row: Math.max(0, Math.min(doc.rows.length - 1, from.row + dr)),
        col: Math.max(0, Math.min(doc.width - 1, from.col + dc)),
      }
      if (e.shiftKey) {
        const a = selection && caret ? caret : from
        setSelection({ r0: Math.min(a.row, to.row), r1: Math.max(a.row, to.row) + 1, c0: Math.min(a.col, to.col), c1: Math.max(a.col, to.col) + 1 })
        if (!selection) setCaret(from)
      } else {
        setSelection(null)
        setCaret(to)
      }
      canvasRef.current?.revealColumn(to.col, to.row)
      return
    }
    const ch = key.length === 1 ? key.toUpperCase() : ''
    const isBase = BASE_KEY.test(ch) && !mod && !e.altKey
    const isGap = (key === '-' || key === 'Delete' || key === 'Backspace') && !mod
    const isSpace = key === ' ' && !mod
    if (!isBase && !isGap && !isSpace) return
    e.preventDefault()
    if (!editing) { hintEdit(); return }
    if (isSpace) {
      const col = selection?.c0 ?? caret?.col ?? 0
      edit(d => insertColumns(d, col, 1), 'Insert a gap column')
      return
    }
    if (isGap && selection) {
      if (selection.r0 < 0) {
        const n = selection.c1 - selection.c0
        edit(d => deleteColumns(d, selection.c0, selection.c1), n === 1 ? 'Delete a column' : `Delete ${n} columns`)
        setSelection(null)
        return
      }
      const cells: { rowId: string; col: number; ch: string }[] = []
      for (const r of doc.rows.slice(selection.r0, selection.r1)) {
        for (let c = Math.max(selection.c0, r.start); c < Math.min(selection.c1, r.start + r.seq.length); c++) cells.push({ rowId: r.id, col: c, ch: '-' })
      }
      edit(d => setCells(d, cells), 'Replace with gaps')
      return
    }
    if (!caret || caret.row < 0) return
    const row = doc.rows[caret.row]
    if (!row) return
    const col = key === 'Backspace' ? caret.col - 1 : caret.col
    if (col < row.start || col >= row.start + row.seq.length) { notify.info('That column is outside this read'); return }
    edit(d => setCell(d, row.id, col, isBase ? ch : '-'), isBase ? `Change to ${ch}` : 'Replace with a gap')
    const next = key === 'Backspace' ? col : Math.min(doc.width - 1, caret.col + 1)
    setCaret({ row: caret.row, col: next })
    canvasRef.current?.revealColumn(next, caret.row)
  }

  useEffect(() => {
    const onWin = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isWidgetKeyTarget(e.target)) return
      if ((e.target as HTMLElement | null)?.closest?.('.cw-scroller')) return
      const k = e.key.toLowerCase()
      const s = useEditorStore.getState()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.undoContig(contig.id) }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); s.redoContig(contig.id) }
    }
    window.addEventListener('keydown', onWin)
    return () => window.removeEventListener('keydown', onWin)
  }, [contig.id])

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [exportOpen])

  const openRow = (i: number) => {
    const r = doc.rows[i]
    if (r?.readId && reads.has(r.readId)) useEditorStore.getState().setActiveSequencingRead(r.readId)
    else notify.info('The read this row came from is no longer in the session')
  }

  /** Add features to the reference sequence (one undo step there), then come back. */
  const annotateReference = (list: AnnotationData[], what: string) => {
    if (!refTab || list.length === 0) return
    const store = useEditorStore.getState()
    if (store.tabs.find(t => t.id === refTab.id)?.readOnly) { notify.info(`${refTab.doc.name} is read-only; unlock it to annotate`); return }
    store.setActiveTab(refTab.id)
    store.addAnnotations(list)
    store.setActiveContig(contig.id)
    notify.success(`Added ${list.length} ${what} to ${refTab.doc.name}`, { action: { label: 'Show', onClick: () => useEditorStore.getState().setActiveTab(refTab.id) } })
  }
  const gotoVariant = (v: Variant) => {
    const row = doc.rows.findIndex(r => {
      const k = v.c0 - r.start
      return k >= 0 && k < r.seq.length && r.seq[k] !== cons.bases[v.c0]
    })
    setSelection(null)
    setCaret({ row: Math.max(0, row), col: v.c0 })
    canvasRef.current?.revealColumn(v.c0, row)
    canvasRef.current?.focus()
  }

  const actions: ContigActions = {
    openConsensus, openAlignment,
    gotoVariant,
    annotateVariants: () => annotateReference(variantAnnotations(variants, doc.reference?.length ?? 0), variants.length === 1 ? 'variant' : 'variants'),
    annotateRepeats: () => annotateReference(repeatAnnotations(repeats), repeats.length === 1 ? 'tandem repeat' : 'tandem repeats'),
    exportVariants: () => download(variantsCsv(variants), `${fileBase}_variants.csv`),
    removeRows: removeReads,
    selectRow: i => { setSelection({ r0: i, r1: i + 1, c0: 0, c1: doc.width }); canvasRef.current?.revealColumn(doc.rows[i].start, i) },
    openRow,
    resolveColumn,
  }

  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== contig.name) useEditorStore.getState().renameContig(contig.id, name)
    setNameDraft(null)
  }

  const tracks = useMemo((): MinimapTrack[] => {
    let max = 1
    for (let c = 0; c < doc.width; c++) if (cons.coverage[c] > max) max = cons.coverage[c]
    return [
      profileTrack({
        id: 'coverage', values: cons.coverage, max, height: 18, caption: 'Coverage',
        color: (t, v) => (v >= 2 ? t.good : v >= 1 ? t.fair : t.bad),
        describe: (c, v) => ({ label: `${v} ${v === 1 ? 'read' : 'reads'}`, detail: `consensus ${cons.bases[c] === ' ' ? '—' : cons.bases[c]} · Q${cons.quality[c]}` }),
      }),
      markerTrack('contig-markers', [
        { label: 'Disagreement', positions: cons.disagreements, color: t => t.danger },
        { label: 'Variant', positions: variantCols.map(v => v[0]), color: t => t.warning },
        ...(hits.length ? [{ label: 'Find hit', positions: hits.map(h => h[0]), width: Math.max(1, hits[0][1] - hits[0][0]), color: (t: { accent: string }) => t.accent }] : []),
      ]),
    ]
  }, [doc.width, cons, hits, variantCols])

  const undoTop = contig.undoStack[contig.undoStack.length - 1]
  const redoTop = contig.redoStack[contig.redoStack.length - 1]
  const menuRows = selection && selection.r0 >= 0 ? doc.rows.slice(selection.r0, selection.r1) : menu && menu.row >= 0 ? [doc.rows[menu.row]] : []

  return (
    <div className="aw cw">
      <div className="aw-header">
        <Layers size={14} className="aw-header-icon" />
        <input
          className="aw-title-input"
          value={nameDraft ?? contig.name}
          aria-label="Contig name"
          title="Rename the contig"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? contig.name).length)}
        />
        <span className="aw-chip">{doc.method === 'reference' ? `Mapped to ${doc.reference?.name ?? 'reference'}` : 'De novo'}</span>
        <span className="aw-muted">
          {nf.format(doc.rows.length)} reads · {nf.format(consensusBases().length)} bp consensus · {nf.format(cons.disagreements.length)} disagreements
        </span>
        <span className="aw-spacer" />
        <button className="aw-icon-btn" onClick={() => useEditorStore.getState().undoContig(contig.id)} disabled={!undoTop} title={undoTop ? `Undo ${undoTop.label} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo"><Undo2 size={14} /></button>
        <button className="aw-icon-btn" onClick={() => useEditorStore.getState().redoContig(contig.id)} disabled={!redoTop} title={redoTop ? `Redo ${redoTop.label} (Ctrl+Y)` : 'Nothing to redo'} aria-label="Redo"><Redo2 size={14} /></button>
        <button className={`aw-btn ${editing ? 'active' : ''}`} aria-pressed={editing} onClick={() => { setEditing(e => !e); canvasRef.current?.focus() }}
          title={editing ? 'Stop editing' : 'Edit bases in the contig: type a base, - or Delete for a gap, Space to insert a gap column'}>
          <Pencil size={13} /> {editing ? 'Editing' : 'Edit'}
        </button>
        {doc.reference && (
          <button className={`aw-btn ${verifyOpen ? 'active' : ''}`} onClick={() => setVerifyOpen(true)} title="Check the construct: coverage of every feature and every difference from the design">
            <ShieldCheck size={13} /> Verify clone
          </button>
        )}
        <button className={`aw-btn ${findOpen ? 'active' : ''}`} onClick={() => { setFindOpen(true); requestAnimationFrame(() => findInput.current?.focus()) }} title="Find a motif in the consensus (Ctrl+F)">
          <Search size={13} /> Find
        </button>
        <div className="aw-export" ref={exportRef}>
          <button className="aw-btn" onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen}><Download size={13} /> Export <ChevronDown size={12} /></button>
          {exportOpen && (
            <div className="aw-menu" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={() => { openConsensus(); setExportOpen(false) }}>
                <span className="aw-menu-label">Open consensus as a sequence</span>
                <span className="aw-menu-desc">To annotate, align, clone with or verify</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { openAlignment(); setExportOpen(false) }}>
                <span className="aw-menu-label">Open as an alignment</span>
                <span className="aw-menu-desc">Reference, consensus and reads in the alignment workspace</span>
              </button>
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => { download(toFasta(`${fileBase}_consensus`, consensusBases()), `${fileBase}_consensus.fasta`); setExportOpen(false) }}>
                <span className="aw-menu-label">Consensus FASTA</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { download(writeAlignment(contigToAlignment(doc, contig.name, view.consensus), 'fasta'), `${fileBase}_aligned.fasta`); setExportOpen(false) }}>
                <span className="aw-menu-label">Aligned FASTA</span>
                <span className="aw-menu-desc">Reference, consensus and reads, gapped to one width</span>
              </button>
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => { copyText(consensusBases(), 'Copied the consensus'); setExportOpen(false) }}>
                <span className="aw-menu-label">Copy the consensus</span>
              </button>
            </div>
          )}
        </div>
        <button className="aw-icon-btn" onClick={() => setInspectorOpen(o => !o)} title={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'} aria-label={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'}>
          {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
        <button className="aw-icon-btn" onClick={onClose} title="Close the contig" aria-label="Close the contig"><X size={15} /></button>
      </div>

      <div className="aw-toolbar">
        <button className={`aw-tool-btn ${view.traces ? 'active' : ''}`} aria-pressed={view.traces} onClick={() => onView({ traces: !view.traces })} title="Show each read's trace under its row">
          <Activity size={13} /> Traces
        </button>
        {view.traces && (
          <input type="range" className="aw-zoom tw-height" min={30} max={160} step={2} value={view.traceHeight} aria-label="Trace height" title="Trace height" onChange={e => onView({ traceHeight: Number(e.target.value) })} />
        )}
        {colFeatures.length > 0 && (
          <button className={`aw-tool-btn ${view.features ? 'active' : ''}`} aria-pressed={view.features} onClick={() => onView({ features: !view.features })} title="Show the reference's features under it">
            <Tags size={13} /> Features
          </button>
        )}
        <span className="aw-tool-sep" />
        <label className="aw-tool-label" htmlFor={`cw-hl-${contig.id}`}>Highlight</label>
        <select id={`cw-hl-${contig.id}`} className="select aw-select" value={view.highlight} onChange={e => onView({ highlight: e.target.value as ContigView['highlight'] })}>
          <option value="consensus">Differences from the consensus</option>
          {doc.reference && <option value="reference">Differences from the reference</option>}
          <option value="none">Nothing</option>
        </select>
        <button className={`aw-tool-btn ${view.quality ? 'active' : ''}`} aria-pressed={view.quality} onClick={() => onView({ quality: !view.quality })} title="Fade bases below Q20">
          Quality
        </button>
        <button className={`aw-tool-btn ${view.translate ? 'active' : ''}`} aria-pressed={view.translate} onClick={() => onView({ translate: !view.translate })} title="Translate the consensus">
          <Languages size={13} /> Translate
        </button>
        {view.translate && (
          <select className="select aw-select" value={view.frame} aria-label="Reading frame" onChange={e => onView({ frame: Number(e.target.value) as 0 | 1 | 2 })}>
            <option value={0}>Frame 1</option><option value={1}>Frame 2</option><option value={2}>Frame 3</option>
          </select>
        )}
        <span className="aw-tool-sep" />
        <span className="aw-diff-nav">
          <button className="aw-tool-icon" onClick={() => gotoDiff(-1)} disabled={!cons.disagreements.length} title="Previous disagreement (Ctrl+←)" aria-label="Previous disagreement"><ChevronLeft size={14} /></button>
          <span className="aw-muted">{cons.disagreements.length ? `${nf.format(cons.disagreements.length)} disagreements` : 'No disagreements'}</span>
          <button className="aw-tool-icon" onClick={() => gotoDiff(1)} disabled={!cons.disagreements.length} title="Next disagreement (Ctrl+→)" aria-label="Next disagreement"><ChevronRight size={14} /></button>
        </span>
        <span className="aw-spacer" />
        <button className="aw-tool-icon" onClick={() => onZoomStep(-1)} disabled={view.zoom <= 0} title="Zoom out (Ctrl+wheel)" aria-label="Zoom out"><Minus size={14} /></button>
        <input type="range" className="aw-zoom" min={0} max={CONTIG_ZOOM.length - 1} value={view.zoom} aria-label="Zoom" onChange={e => zoomTo(Number(e.target.value))} />
        <button className="aw-tool-icon" onClick={() => onZoomStep(1)} disabled={view.zoom >= CONTIG_ZOOM.length - 1} title="Zoom in (Ctrl+wheel)" aria-label="Zoom in"><Plus size={14} /></button>
      </div>

      {findOpen && (
        <div className="aw-find">
          <Search size={13} className="aw-find-icon" />
          <input ref={findInput} className="aw-find-input" value={query} placeholder="Find a motif in the consensus (IUPAC codes allowed)" aria-label="Find a motif"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') gotoHit(hitIndex + (e.shiftKey ? -1 : 1)); else if (e.key === 'Escape') closeFind() }} />
          <span className="aw-muted aw-find-count">{query.trim() ? (hits.length ? `${hitIndex + 1} of ${nf.format(hits.length)}` : 'No matches') : ''}</span>
          <button className="aw-tool-icon" onClick={() => gotoHit(hitIndex - 1)} disabled={!hits.length} aria-label="Previous match"><ChevronLeft size={14} /></button>
          <button className="aw-tool-icon" onClick={() => gotoHit(hitIndex + 1)} disabled={!hits.length} aria-label="Next match"><ChevronRight size={14} /></button>
          <button className="aw-tool-icon" onClick={closeFind} aria-label="Close find"><X size={14} /></button>
        </div>
      )}

      <div className="aw-body-row">
        <div className="aw-main">
          <div className="aw-minimap">
            <Minimap kind="alignment" length={doc.width} tracks={tracks} viewport={viewport}
              onNavigate={start => canvasRef.current?.scrollToColumn(start)}
              selection={selection ? [[selection.c0, selection.c1]] : undefined}
              positionLabel="Column" ariaLabel="Contig overview" />
          </div>
          <ContigCanvas
            ref={canvasRef}
            input={input}
            selection={selection}
            caret={caret}
            editing={editing}
            hits={hits}
            currentHit={hitIndex}
            hover={hover}
            onSelect={select}
            onOpenRow={openRow}
            onZoom={onZoomStep}
            onViewport={(start, end) => viewport.set({ start, end })}
            onContextMenu={setMenu}
            onKeyDown={onKey}
          />
          <StatusBar doc={doc} cons={cons} refPos={refPos} hover={hover} reads={reads} editing={editing} />
        </div>
        {inspectorOpen && (
          <ContigInspector doc={doc} cons={cons} view={view} refPos={refPos} reads={reads} selection={selection} caret={caret}
            editing={editing} tab={tab} onTab={setTab} onView={onView} actions={actions}
            variants={variants} canAnnotate={!!refTab} repeatCount={repeats.length} />
        )}
      </div>

      {verifyOpen && (
        <VerifyDialog
          doc={doc}
          name={contig.name}
          consensus={cons.bases}
          features={features}
          canAnnotate={!!refTab}
          onAnnotate={vs => annotateReference(variantAnnotations(vs, doc.reference?.length ?? 0), vs.length === 1 ? 'difference' : 'differences')}
          onGoto={v => { setVerifyOpen(false); gotoVariant(v) }}
          onClose={() => setVerifyOpen(false)}
          onExportPrompt={onExportPrompt}
        />
      )}

      {menu && (
        <ContextMenuPopup x={menu.x} y={menu.y} onClose={() => setMenu(null)} label="Contig actions">
          <div onClick={() => setMenu(null)}>
            {menuRows.length === 1 && menuRows[0] && (
              <>
                <div className="ctx-menu-header">{menuRows[0].name}</div>
                <MenuItem icon={<Activity size={13} />} onSelect={() => openRow(doc.rows.indexOf(menuRows[0]))}>Open the read</MenuItem>
              </>
            )}
            <MenuItem icon={<ClipboardCopy size={13} />} onSelect={copySelection} shortcut="Ctrl+C">{selection && selection.r0 >= 0 ? 'Copy the selected bases' : 'Copy the consensus'}</MenuItem>
            <MenuItem icon={<FileOutput size={13} />} onSelect={openConsensus}>Open consensus as a sequence</MenuItem>
            <MenuItem icon={<Table2 size={13} />} onSelect={openAlignment}>Open as an alignment</MenuItem>
            <MenuSeparator />
            {editing ? (
              <MenuItem icon={<Columns3 size={13} />} onSelect={() => edit(d => insertColumns(d, menu.col, 1), 'Insert a gap column')} shortcut="Space">Insert a gap column</MenuItem>
            ) : (
              <MenuItem icon={<Pencil size={13} />} onSelect={() => setEditing(true)}>Turn on editing</MenuItem>
            )}
            {editing && selection && selection.r0 < 0 && (
              <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => edit(d => deleteColumns(d, selection.c0, selection.c1), 'Delete columns')}>Delete the selected columns</MenuItem>
            )}
            {menuRows.length > 0 && menuRows.length < doc.rows.length && (
              <MenuItem icon={<Trash2 size={13} />} danger onSelect={() => removeReads(menuRows.map(r => r.id))}>
                {menuRows.length === 1 ? 'Remove the read from the contig' : `Remove ${menuRows.length} reads from the contig`}
              </MenuItem>
            )}
          </div>
        </ContextMenuPopup>
      )}
    </div>
  )
}

function StatusBar({ doc, cons, refPos, hover, reads, editing }: {
  doc: Contig['doc']
  cons: ReturnType<typeof computeConsensus>
  refPos: Int32Array
  hover: Signal<HoverCell | null>
  reads: Map<string, SequencingRead>
  editing: boolean
}) {
  const h = useSignal(hover)
  let readout: React.ReactNode = (
    <span className="aw-muted">
      {editing
        ? 'Type a base to change it · - or Delete for a gap · Space inserts a gap column · Ctrl+→ next disagreement'
        : 'Drag to select · click a name to select a read, double-click to open it · Ctrl+wheel zoom · right-click for actions'}
    </span>
  )
  if (h && h.col >= 0 && h.col < doc.width) {
    const parts: React.ReactNode[] = [<span key="c">Column <b>{nf.format(h.col + 1)}</b></span>]
    if (doc.reference) parts.push(<span key="r">{refPos[h.col] ? <>reference {nf.format(refPos[h.col])} <b>{doc.reference.seq[h.col]}</b></> : 'inserted'}</span>)
    const c = cons.bases[h.col]
    parts.push(<span key="cs">consensus <b>{c === ' ' ? '—' : c}</b>{c !== ' ' && <> Q{cons.quality[h.col]}</>}</span>)
    parts.push(<span key="cv">{cons.coverage[h.col]}× coverage</span>)
    const row = h.row >= 0 ? doc.rows[h.row] : undefined
    if (row) {
      const k = h.col - row.start
      if (k >= 0 && k < row.seq.length) {
        const read = row.readId ? reads.get(row.readId) : undefined
        parts.push(<span key="rd">{row.name}: <b>{row.seq[k] === '-' ? 'gap' : row.seq[k]}</b>{row.seq[k] !== '-' && <> Q{row.qual[k]}</>}{read && row.src[k] >= 0 && <span className="aw-muted"> · read base {nf.format(row.src[k] + 1)}</span>}</span>)
      }
    }
    readout = <>{parts}</>
  }
  return (
    <div className="aw-status">
      <div className="aw-status-readout">{readout}</div>
      {editing && <span className="aw-status-mode">Editing</span>}
    </div>
  )
}
