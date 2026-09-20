import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import { formatBp } from './utils/format'
import { gcPercent } from './primers/thermodynamics'
import './App.css'
import './components/StatusBar.css'
import SequenceView from './components/SequenceView'
import PlasmidMap from './components/PlasmidMap'
import EnzymePanel from './components/EnzymePanel'
import ORFPanel from './components/ORFPanel'
import FeatureSidebar from './components/FeatureSidebar'
import PrimerPanel from './components/PrimerPanel'
import FindModal from './components/FindModal'
const AnnotateModal = lazy(() => import('./components/AnnotateModal'))
import NewSequenceModal, { type NewSequenceResult } from './components/NewSequenceModal'
import FileExplorer from './components/FileExplorer'
import SequencePropertiesModal from './components/SequencePropertiesModal'
import SequenceStatsPopover from './components/SequenceStatsPopover'
const CloningModal = lazy(() => import('./components/CloningModal'))
const GelView = lazy(() => import('./components/GelView'))
import { useEditorStore, isOriginSpanningSelection, selectionSegments, applyEdits, type SequencingRead } from './store'
import { displayPosition, internalPosition } from './models/Document'
import { parseGenBankMulti, writeGenBank } from './io/genbank'
import { parseGenbankFile } from './workers/genbank-parser'
import { parseSnapGene, writeSnapGene } from './io/snapgene'
import { writeGff3 } from './io/gff3'
import { writeCsv } from './io/csv'
import { parseGeneious } from './io/geneious'
import { parseAb1, autoTrim } from './io/ab1'
import { parseScf } from './io/scf'
import { useToasts } from './hooks/useToasts'
import { useSessionPersistence } from './hooks/useSessionPersistence'
import { usePopoverDismiss } from './hooks/usePopoverDismiss'
import StorageToast from './components/StorageToast'
import StorageIndicator from './components/StorageIndicator'
import { getEnzyme, type RestrictionEnzyme } from './enzymes/db'
import { findEnzymeSitesAsync } from './workers/enzyme-finder'
import {
  File, Dna, FolderPlus, FileUp, FolderUp, ClipboardPaste, Save,
  Undo2, Redo2, Search, Scissors, FlaskConical, TestTube,
  BarChart3, ZoomOut, ZoomIn, PanelLeftClose, PanelLeftOpen,
  X, ChevronDown as ChevronDownSmall,
  SunMoon, Info, List, Lock, LockOpen, Tag, Globe, GalleryVertical, AlignLeft, ArrowLeft,
} from 'lucide-react'
const BlastModal = lazy(() => import('./components/BlastModal'))
import ExportModal, { type ExportFormat, type ExportItemKind, type ExportMode, defaultFormatForKind, formatsForKind } from './components/ExportModal'
import SessionExportModal from './components/SessionExportModal'
import SessionImportModal from './components/SessionImportModal'
import { exportSessionToJson, importSessionFromJson, remapSessionIds, type SessionExportOptions } from './persistence'
import FilenamePrompt from './components/ExportDialog'
import FetchModal from './components/FetchModal'
import ChromatogramView, { type ChromZoomHandle } from './components/ChromatogramView'
const AlignmentModal = lazy(() => import('./components/AlignmentModal'))
const AlignmentPanel = lazy(() => import('./components/AlignmentPanel'))

const ReadAlignmentView = lazy(() => import('./components/ReadAlignmentView'))
const ContigView = lazy(() => import('./components/ContigView'))

import { toAlignedFasta, toClustal, toPhylip, toNexus, generateDiffAnnotations } from './alignment/export'
import type { AlignmentResult } from './alignment/types'



const DEMO_SEQUENCE = 'ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCGGGTACCGAGCTCGAATTCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCATAGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTCTCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCAT'

export type ThemeName =
  | 'light' | 'dark' | 'midnight' | 'solarized' | 'nature'
  | 'rose' | 'lavender' | 'dracula' | 'nord' | 'catppuccin'

interface ThemeInfo {
  id: ThemeName
  label: string
  group: 'light' | 'dark'
  bg: string      // card background
  outer: string   // outer preview bg
  accent: string  // accent bar
  text: string    // text line
  muted: string   // muted line
}

const THEMES: ThemeInfo[] = [
  { id: 'light',      label: 'Light',      group: 'light', bg: '#ffffff', outer: '#f0f2f5', accent: '#6366f1', text: '#1e293b', muted: '#94a3b8' },
  { id: 'solarized',  label: 'Solarized',  group: 'light', bg: '#fdf6e3', outer: '#eee8d5', accent: '#268bd2', text: '#002b36', muted: '#93a1a1' },
  { id: 'nature',     label: 'Nature',     group: 'light', bg: '#f8fcf8', outer: '#ecf5ec', accent: '#16a34a', text: '#14532d', muted: '#86a892' },
  { id: 'rose',       label: 'Rosé',       group: 'light', bg: '#fffbfc', outer: '#f8f0f3', accent: '#e11d48', text: '#1c1017', muted: '#a8929c' },
  { id: 'lavender',   label: 'Lavender',   group: 'light', bg: '#faf8ff', outer: '#f0ecf9', accent: '#7c3aed', text: '#2e1065', muted: '#a393bf' },
  { id: 'dark',       label: 'Dark',       group: 'dark',  bg: '#1e293b', outer: '#0f172a', accent: '#818cf8', text: '#f1f5f9', muted: '#64748b' },
  { id: 'midnight',   label: 'Midnight',   group: 'dark',  bg: '#0c1222', outer: '#020617', accent: '#38bdf8', text: '#e0f2fe', muted: '#38bdf8' },
  { id: 'dracula',    label: 'Dracula',    group: 'dark',  bg: '#282a36', outer: '#1e1f29', accent: '#bd93f9', text: '#f8f8f2', muted: '#6272a4' },
  { id: 'nord',       label: 'Nord',       group: 'dark',  bg: '#2e3440', outer: '#242933', accent: '#88c0d0', text: '#eceff4', muted: '#7b88a1' },
  { id: 'catppuccin', label: 'Catppuccin', group: 'dark',  bg: '#1e1e2e', outer: '#11111b', accent: '#cba6f7', text: '#cdd6f4', muted: '#6c7086' },
]

/** Shared scrollbar for multi-read chromatogram stacking */
function MultiChromScrollbar({ scrollX, zoom, setScrollX, readIds }: { scrollX: number; zoom: number; setScrollX: (v: number) => void; readIds: string[] }) {
  // Stable selector: extract only the max trace length (a number, not a new array)
  const maxTraceLength = useEditorStore(useCallback((s) => {
    let max = 0
    for (const r of s.sequencingReads) {
      if (!readIds.includes(r.id)) continue
      const len = Math.max(r.data.traces.A.length, r.data.traces.C.length, r.data.traces.G.length, r.data.traces.T.length)
      if (len > max) max = len
    }
    return max || 1
  }, [readIds]))

  const barRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [barWidth, setBarWidth] = useState(300)
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null)

  // Track bar width via ResizeObserver to avoid layout reads during render
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBarWidth(el.clientWidth))
    ro.observe(el)
    setBarWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const visibleSamples = barWidth / zoom
  const visibleFraction = Math.min(1, visibleSamples / maxTraceLength)
  const scrollFraction = scrollX / maxTraceLength
  const thumbLeft = scrollFraction * barWidth
  const thumbWidth = Math.max(30, visibleFraction * barWidth)

  const clampRef = useRef((s: number) => s)
  clampRef.current = (s: number) => Math.max(0, Math.min(s, maxTraceLength - visibleSamples))

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const thumb = e.target as HTMLElement
    if (thumb.classList.contains('chrom-scrollbar-thumb')) {
      dragRef.current = { startX: e.clientX, startScroll: scrollX }
      setDragging(true)
      e.preventDefault()
    } else {
      const bar = barRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      const fraction = (e.clientX - rect.left) / rect.width
      setScrollX(clampRef.current(fraction * maxTraceLength))
    }
  }, [scrollX, maxTraceLength, setScrollX])

  useEffect(() => {
    if (!dragging) return
    const handleMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag || !barRef.current) return
      const dx = e.clientX - drag.startX
      const bw = barRef.current.clientWidth
      const scrollDelta = (dx / bw) * maxTraceLength
      setScrollX(clampRef.current(drag.startScroll + scrollDelta))
    }
    const handleUp = () => { dragRef.current = null; setDragging(false) }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [dragging, maxTraceLength, setScrollX])

  return (
    <div className="chrom-scrollbar chrom-scrollbar-shared" ref={barRef} onMouseDown={handleMouseDown}>
      <div className={`chrom-scrollbar-thumb ${dragging ? 'dragging' : ''}`} style={{ left: thumbLeft, width: thumbWidth }} />
    </div>
  )
}

export default function App() {
  const activeTabId = useEditorStore(s => s.activeTabId)
  const selectedExportableCount = useEditorStore(s => {
    const sel = s.explorerSelectedIds
    return s.tabs.filter(t => sel.has(t.id)).length
      + s.sequencingReads.filter(r => sel.has(`seq_${r.id}`)).length
      + s.alignments.filter(a => sel.has(a.id)).length
      + s.readAlignments.filter(r => sel.has(r.id)).length
      + s.contigs.filter(c => sel.has(c.id)).length
  })
  const openDocument = useEditorStore(s => s.openDocument)
  const openDocumentState = useEditorStore(s => s.openDocumentState)
  const addSequencingRead = useEditorStore(s => s.addSequencingRead)
  const setSequencingTrim = useEditorStore(s => s.setSequencingTrim)
  const activeSequencingReadIds = useEditorStore(s => s.activeSequencingReadIds)
  const alignments = useEditorStore(s => s.alignments)
  const activeAlignmentId = useEditorStore(s => s.activeAlignmentId)
  const setAlignmentZoom = useEditorStore(s => s.setAlignmentZoom)

  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const viewMode = useEditorStore(s => s.viewMode)
  const setViewMode = useEditorStore(s => s.setViewMode)
  const zoomLevel = useEditorStore(s => s.zoomLevel)
  const setZoom = useEditorStore(s => s.setZoom)
  const seqLength = useEditorStore(s => s.doc.sequence.length)
  const undo = useEditorStore(s => s.undo)
  const redo = useEditorStore(s => s.redo)
  const readOnly = useEditorStore(s => s.readOnly)
  const toggleReadOnly = useEditorStore(s => s.toggleReadOnly)
  const readOnlyBlockCount = useEditorStore(s => s.readOnlyBlockCount)
  const [lockFlash, setLockFlash] = useState(false)
  useEffect(() => {
    if (readOnlyBlockCount === 0) return
    setLockFlash(true)
    const t = setTimeout(() => setLockFlash(false), 600)
    return () => clearTimeout(t)
  }, [readOnlyBlockCount])
  const renameTab = useEditorStore(s => s.renameTab)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const showOrfs = useEditorStore(s => s.showOrfs)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const showPrimers = useEditorStore(s => s.showPrimers)
  const toggleOrfs = useEditorStore(s => s.toggleOrfs)
  const toggleEnzymes = useEditorStore(s => s.toggleEnzymes)
  const togglePrimers = useEditorStore(s => s.togglePrimers)
  const orfResults = useEditorStore(s => s.orfResults)
  const enzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const enzymeNames = useEditorStore(s => s.enzymeNames)
  const primerResults = useEditorStore(s => s.primerResults)
  const setEnzymeCutSites = useEditorStore(s => s.setEnzymeCutSites)
  // Inline name editing in view-info bar
  const [editingViewName, setEditingViewName] = useState(false)
  const [viewNameValue, setViewNameValue] = useState('')
  const viewNameInputRef = useRef<HTMLInputElement>(null)

  const chromZoomRef = useRef<ChromZoomHandle | null>(null)
  const [chromZoomPct, setChromZoomPct] = useState(50)

  // Synchronized scroll/zoom/traces for multi-read chromatogram stacking
  const [multiChromScrollX, setMultiChromScrollX] = useState(0)
  const [multiChromZoom, setMultiChromZoom] = useState(1)
  const [multiChromShowTraces, setMultiChromShowTraces] = useState({ A: true, C: true, G: true, T: true })
  const [multiChromShowQuality, setMultiChromShowQuality] = useState(true)
  const [multiChromShowCurves, setMultiChromShowCurves] = useState(true)
  // Track which read is actively selecting, and a trigger to clear others
  const [multiChromClearSel, setMultiChromClearSel] = useState<{ activeReadId: string; trigger: number }>({ activeReadId: '', trigger: 0 })
  const handleMultiSelectionStart = useCallback((readId: string) => {
    setMultiChromClearSel(prev => ({ activeReadId: readId, trigger: prev.trigger + 1 }))
  }, [])

  const [dragOver, setDragOver] = useState(false)
  const [dropError, setDropError] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  const [theme, setTheme] = useState<ThemeName>(() => {
    // Will be overridden by saved session if available
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  })

  /** Smooth theme switch - uses View Transition API when available, CSS fallback otherwise */
  const switchTheme = useCallback((next: ThemeName) => {
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) { setTheme(next); return }

    // View Transition API (Chrome 111+, Safari 18+)
    const doc = document as any
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => setTheme(next))
      return
    }

    // CSS fallback: temporarily enable transitions on all color/background properties
    const root = document.querySelector('.app-root') as HTMLElement | null
    if (root) {
      root.classList.add('theme-transitioning')
      setTheme(next)
      const onEnd = () => { root.classList.remove('theme-transitioning') }
      // Remove after transition completes
      setTimeout(onEnd, 350)
    } else {
      setTheme(next)
    }
  }, [])

  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900)

  // Auto-collapse sidebar when viewport shrinks below 900px
  useEffect(() => {
    let prev = window.innerWidth > 900
    const onResize = () => {
      const wide = window.innerWidth > 900
      if (wide !== prev) {
        prev = wide
        if (!wide) setSidebarOpen(false)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // File menu
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [newSeqModalOpen, setNewSeqModalOpen] = useState(false)
  const [primerModalOpen, setPrimerModalOpen] = useState(false)
  const [orfModalOpen, setOrfModalOpen] = useState(false)
  const [enzymeModalOpen, setEnzymeModalOpen] = useState(false)
  const [annotateModalOpen, setAnnotateModalOpen] = useState(false)
  const [propertiesModalOpen, setPropertiesModalOpen] = useState(false)
  const [cloningModalOpen, setCloningModalOpen] = useState(false)
  const [cloningInitialMethod, setCloningInitialMethod] = useState<import('./components/CloningModal').CloningMethod | undefined>(undefined)
  const [cloningDropdownOpen, setCloningDropdownOpen] = useState(false)
  const cloningBtnRef = useRef<HTMLDivElement>(null)
  const [blastModalOpen, setBlastModalOpen] = useState(false)
  const [blastPhase, setBlastPhase] = useState<'input' | 'polling' | 'results'>('input')
  const [alignModalOpen, setAlignModalOpen] = useState(false)
  const [alignInitialEntries, setAlignInitialEntries] = useState<import('./components/AlignmentModal').AlignmentInitialEntry[] | undefined>(undefined)

  const addAlignment = useEditorStore(s => s.addAlignment)
  const addReadAlignment = useEditorStore(s => s.addReadAlignment)
  const readAlignments = useEditorStore(s => s.readAlignments)
  const activeReadAlignmentId = useEditorStore(s => s.activeReadAlignmentId)
  const setReadAlignmentZoom = useEditorStore(s => s.setReadAlignmentZoom)
  const addContig = useEditorStore(s => s.addContig)
  const contigs = useEditorStore(s => s.contigs)
  const activeContigId = useEditorStore(s => s.activeContigId)
  const setActiveContig = useEditorStore(s => s.setActiveContig)
  const setContigZoom = useEditorStore(s => s.setContigZoom)

  // Collect read alignment IDs during a batch alignment for contig creation
  const batchReadAlignIdsRef = useRef<string[]>([])
  const batchRefTabIdRef = useRef<string | null>(null)

  // Track "came from contig" for back navigation from single-read view
  const [parentContigId, setParentContigId] = useState<string | null>(null)

  /** Extract trimmed, edited bases from a sequencing read. */
  const getReadBases = useCallback((read: SequencingRead): string => {
    const edits = read.edits ?? []
    const { bases: editedBases, editMap } = applyEdits(read.data.bases, edits)
    const trimStart = read.trimStart ?? 0
    const trimEnd = read.trimEnd ?? read.data.bases.length
    let readBases = ''
    for (let i = trimStart; i < trimEnd && i < editedBases.length; i++) {
      if (editMap[i] !== 'delete') readBases += editedBases[i]
    }
    return readBases
  }, [])

  /** Open alignment modal pre-populated with sequencing reads. */
  const openRefPicker = useCallback((readIds: string | string[]) => {
    const ids = Array.isArray(readIds) ? readIds : [readIds]
    const state = useEditorStore.getState()
    const entries: import('./components/AlignmentModal').AlignmentInitialEntry[] = []
    for (const rid of ids) {
      const read = state.sequencingReads.find(r => r.id === rid)
      if (read) {
        const bases = getReadBases(read)
        if (bases.length > 0) entries.push({ id: `read_${rid}_${Date.now()}`, name: read.data.name, bases, source: 'read', sourceId: rid })
      }
    }
    if (entries.length > 0) {
      setAlignInitialEntries(entries)
      setAlignModalOpen(true)
    }
  }, [getReadBases])

  const [gelModalOpen, setGelModalOpen] = useState(false)
  const [fetchModalOpen, setFetchModalOpen] = useState(false)
  const [sessionExportOpen, setSessionExportOpen] = useState(false)
  const [sessionImportOpen, setSessionImportOpen] = useState(false)
  const [sessionImportData, setSessionImportData] = useState<{ filename: string; json: string } | null>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const statsBtnRef = useRef<HTMLButtonElement>(null)
  const [gotoActive, setGotoActive] = useState(false)
  const [gotoValue, setGotoValue] = useState('')
  const gotoInputRef = useRef<HTMLInputElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const sessionImportInputRef = useRef<HTMLInputElement>(null)

  // Undo/redo flash feedback
  const lastUndoRedoAction = useEditorStore(s => s.lastUndoRedoAction)
  const clearUndoRedoAction = useEditorStore(s => s.clearUndoRedoAction)
  const [undoFlash, setUndoFlash] = useState<'undo' | 'redo' | null>(null)
  const undoFlashTimer = useRef<number>(0)

  useEffect(() => {
    if (!lastUndoRedoAction) return
    clearTimeout(undoFlashTimer.current)
    setUndoFlash(lastUndoRedoAction)
    clearUndoRedoAction()
    undoFlashTimer.current = window.setTimeout(() => setUndoFlash(null), 1500)
  }, [lastUndoRedoAction, clearUndoRedoAction])

  // Bottom panels
  const [featuresPanelOpen, setFeaturesPanelOpen] = useState(false)
  const editAnnotationId = useEditorStore(s => s.editAnnotationId)

  // Open Features panel when editAnnotationId is set (e.g. from context menu)
  useEffect(() => {
    if (editAnnotationId) {
      setFeaturesPanelOpen(true)
    }
  }, [editAnnotationId])

  // Re-scan enzyme cut sites when the sequence changes and enzymes are active.
  // Debounced to avoid expensive rescans on every keystroke.
  const enzymeScanGen = useRef(0)
  const enzymeScanTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (enzymeNames.length === 0 || seqLength === 0) return
    if (enzymeScanTimer.current) clearTimeout(enzymeScanTimer.current)
    enzymeScanTimer.current = setTimeout(() => {
      const gen = ++enzymeScanGen.current
      const enzymes = enzymeNames
        .map(name => getEnzyme(name))
        .filter((e): e is RestrictionEnzyme => e != null)
      if (enzymes.length === 0) return
      const bases = doc.sequence.bases
      const topology = doc.sequence.topology
      findEnzymeSitesAsync(bases, enzymes, topology).then(sites => {
        if (gen !== enzymeScanGen.current) return // stale
        setEnzymeCutSites(sites)
      }).catch(e => console.warn('Enzyme scan failed:', e))
    }, 300)
    return () => { if (enzymeScanTimer.current) clearTimeout(enzymeScanTimer.current) }
  }, [doc.sequence, enzymeNames, seqLength, setEnzymeCutSites]) // eslint-disable-line react-hooks/exhaustive-deps -- getEnzyme/findEnzymeSitesAsync are module-level imports

  // Ctrl+G to activate goto position input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault()
        setGotoValue('')
        setGotoActive(true)
        requestAnimationFrame(() => gotoInputRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ctrl+Shift+S to open export modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault()
        const s = useEditorStore.getState()
        if (s.activeTabId || s.activeSequencingReadIds.length > 0 || s.activeAlignmentId || s.activeReadAlignmentId || s.activeContigId) {
          setBulkExportItems({})
          setExportModalOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Ctrl+F to open find – dispatch to alignment/contig mode when active
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        const state = useEditorStore.getState()
        if (state.activeContigId) {
          e.preventDefault()
          setContigSearchOpen(true)
        } else if (state.activeAlignmentId) {
          e.preventDefault()
          setAlignSearchOpen(true)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Split view resizable divider
  const [splitFraction, setSplitFraction] = useState(() => {
    const saved = localStorage.getItem('seqnexus_split_fraction')
    return saved ? Math.max(0.15, Math.min(0.7, parseFloat(saved))) : 0.4
  })
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDraggingSplit = useRef(false)

  const handleSplitPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    isDraggingSplit.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handleSplitPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingSplit.current || !splitContainerRef.current) return
    const rect = splitContainerRef.current.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    setSplitFraction(Math.max(0.15, Math.min(0.7, frac)))
  }, [])

  const handleSplitPointerUp = useCallback(() => {
    isDraggingSplit.current = false
    localStorage.setItem('seqnexus_split_fraction', String(splitFraction))
  }, [splitFraction])

  // Theme & info popovers
  const [themeOpen, setThemeOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const themePopRef = useRef<HTMLDivElement>(null)
  const infoPopRef = useRef<HTMLDivElement>(null)
  const themeBtnRef = useRef<HTMLButtonElement>(null)
  const infoBtnRef = useRef<HTMLButtonElement>(null)

  // Find/replace
  const [showFind, setShowFind] = useState(false)
  const [chromSearchOpen, setChromSearchOpen] = useState(false)
  const [alignSearchOpen, setAlignSearchOpen] = useState(false)
  const [contigSearchOpen, setContigSearchOpen] = useState(false)
  const [contigSelInfo, setContigSelInfo] = useState<{ anchor: number; caret: number } | null>(null)

  // Session persistence (save/restore/beforeunload)
  const { storageRefreshKey } = useSessionPersistence(theme, setTheme as (t: string) => void, openDocument, DEMO_SEQUENCE)

  // Close popovers/dropdowns on outside click
  usePopoverDismiss(fileMenuOpen, () => setFileMenuOpen(false), fileMenuRef)
  usePopoverDismiss(themeOpen, () => setThemeOpen(false), themePopRef, themeBtnRef)
  usePopoverDismiss(infoOpen, () => setInfoOpen(false), infoPopRef, infoBtnRef)
  usePopoverDismiss(cloningDropdownOpen, () => setCloningDropdownOpen(false), cloningBtnRef)

  // --- Export dialog ---
  const [exportModalOpen, setExportModalOpen] = useState(false)
  /** Items selected for bulk export, grouped by kind. Empty = single (active item). */
  const [bulkExportItems, setBulkExportItems] = useState<Partial<Record<ExportItemKind, string[]>>>({})
  // Lightweight filename prompt for non-sequence exports (gel images, etc.)
  const [filenamePrompt, setFilenamePrompt] = useState<{ defaultName: string; onConfirm: (name: string) => void } | null>(null)

  // --- Toasts ---
  const {
    errorToast, errorToastClosing, dismissErrorToast, showError, handleErrorAnimationEnd,
    hintToast, hintToastClosing, dismissHintToast, showHint, handleHintAnimationEnd,
  } = useToasts()

  const showCopyHint = useCallback((msg: string) => showHint(msg, 2000), [showHint])

  // --- File handling ---
  const SUPPORTED_EXTENSIONS = /\.(gb|gbk|genbank|dna|geneious|fasta|fa|fna|faa|seq|txt|ab1|abi|abif|scf|json)$/i
  const DNA_CHARS = /^[ATGCNRYSWKMBDHVatgcnryswkmbdhv\s\n\r>;\-]+$/

  const [parseProgress, setParseProgress] = useState<{ bytesRead: number; totalBytes: number } | null>(null)

  const handleFileOpen = useCallback((file: File) => {
    // Validate file extension
    if (!SUPPORTED_EXTENSIONS.test(file.name)) {
      showError(`Unsupported file format: "${file.name.split('.').pop()}". Supported: GenBank (.gb), SnapGene (.dna), Geneious (.geneious), FASTA (.fasta/.fa), AB1 (.ab1), SCF (.scf), plain text (.txt)`)
      return
    }

    // Session file - route to session import flow
    if (file.name.match(/\.seqnexus\.json$/i) || (file.name.endsWith('.json') && file.size > 0)) {
      const reader = new FileReader()
      reader.onload = () => {
        const json = reader.result as string
        // Quick check if it's a session file (has the format marker)
        if (json.includes('"seqnexus-session"')) {
          handleSessionImportFile(new DataTransfer().files) // clear any pending
          try {
            const session = importSessionFromJson(json)
            setSessionImportData({ filename: file.name, json })
            sessionImportParsedRef.current = session
            setSessionImportOpen(true)
          } catch (e) {
            showError(`Failed to read session file: ${e instanceof Error ? e.message : 'Unknown error'}`)
          }
        } else {
          showError(`"${file.name}" is not a recognized SeqNexus session file`)
        }
      }
      reader.readAsText(file)
      return
    }

    if (file.name.match(/\.(gb|gbk|genbank)$/i)) {
      // GenBank - streaming parser for large files (supports multi-record)
      setParseProgress({ bytesRead: 0, totalBytes: file.size })
      parseGenbankFile(file, (p) => setParseProgress(p))
        .then((docs) => {
          const tabIds: string[] = []
          for (const d of docs) tabIds.push(openDocumentState(d))
          if (docs.length > 1) {
            const folderName = file.name.replace(/\.[^.]+$/, '')
            const folderId = useEditorStore.getState().createFolder(folderName)
            for (const id of tabIds) useEditorStore.getState().moveTabToFolder(id, folderId)
            showHint(`Opened ${docs.length} sequences from "${file.name}"`)
          }
          setParseProgress(null)
        })
        .catch((err) => {
          setParseProgress(null)
          showError(`Failed to parse GenBank file: ${err instanceof Error ? err.message : String(err)}`)
        })
    } else if (file.name.match(/\.dna$/i)) {
      // SnapGene binary format
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const doc = parseSnapGene(reader.result as ArrayBuffer)
          openDocumentState(doc)
        } catch (err) {
          showError(`Failed to parse SnapGene file: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      reader.onerror = () => showError(`Failed to read file: ${file.name}`)
      reader.readAsArrayBuffer(file)
    } else if (file.name.match(/\.geneious$/i)) {
      // Geneious ZIP+XML format
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const doc = parseGeneious(reader.result as ArrayBuffer)
          openDocumentState(doc)
        } catch (err) {
          showError(`Failed to parse Geneious file: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      reader.onerror = () => showError(`Failed to read file: ${file.name}`)
      reader.readAsArrayBuffer(file)
    } else if (file.name.match(/\.(ab1|abi|abif)$/i)) {
      // Sanger sequencing chromatogram (ABIF)
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const ab1 = parseAb1(reader.result as ArrayBuffer)
          ab1.name = file.name.replace(/\.[^.]+$/, '')
          const id = addSequencingRead(ab1)
          const [trimStart, trimEnd] = autoTrim(ab1.qualityScores)
          setSequencingTrim(id, trimStart, trimEnd)
        } catch (err) {
          showError(`Failed to parse AB1 file: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      reader.onerror = () => showError(`Failed to read file: ${file.name}`)
      reader.readAsArrayBuffer(file)
    } else if (file.name.match(/\.scf$/i)) {
      // Sanger sequencing chromatogram (SCF)
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const scf = parseScf(reader.result as ArrayBuffer)
          scf.name = file.name.replace(/\.[^.]+$/, '')
          const id = addSequencingRead(scf)
          const [trimStart, trimEnd] = autoTrim(scf.qualityScores)
          setSequencingTrim(id, trimStart, trimEnd)
        } catch (err) {
          showError(`Failed to parse SCF file: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      reader.onerror = () => showError(`Failed to read file: ${file.name}`)
      reader.readAsArrayBuffer(file)
    } else {
      // FASTA or plain text
      const reader = new FileReader()
      reader.onload = () => {
        const text = reader.result as string
        // Validate content looks like sequence data (skip for FASTA/GenBank)
        if (text.length > 0 && !DNA_CHARS.test(text) && !text.startsWith('LOCUS') && !text.startsWith('>')) {
          showError(`File "${file.name}" does not appear to contain valid DNA/RNA sequence data.`)
          return
        }

        // Parse multi-record FASTA: split on '>' headers
        const records: { name: string; bases: string }[] = []
        const defaultName = file.name.replace(/\.[^.]+$/, '')
        let currentName = defaultName
        let currentBases = ''

        for (const line of text.split(/\r?\n/)) {
          if (line.startsWith('>')) {
            // Flush previous record
            if (currentBases) {
              records.push({ name: currentName, bases: currentBases.toUpperCase() })
            }
            currentName = line.slice(1).trim().split(/\s+/)[0] || defaultName
            currentBases = ''
          } else if (!line.startsWith(';')) {
            currentBases += line.replace(/[\s\-]/g, '')
          }
        }
        // Flush last record
        if (currentBases) {
          records.push({ name: currentName, bases: currentBases.toUpperCase() })
        }

        if (records.length === 0) {
          showError(`No sequence data found in "${file.name}".`)
          return
        }

        const tabIds: string[] = []
        for (const rec of records) {
          tabIds.push(openDocument(rec.name, rec.bases))
        }
        if (records.length > 1) {
          const folderName = file.name.replace(/\.[^.]+$/, '')
          const folderId = useEditorStore.getState().createFolder(folderName)
          for (const id of tabIds) useEditorStore.getState().moveTabToFolder(id, folderId)
          showHint(`Opened ${records.length} sequences from "${file.name}"`)
        }
      }
      reader.onerror = () => showError(`Failed to read file: ${file.name}`)
      reader.readAsText(file)
    }
  }, [openDocument, openDocumentState, showError, showHint, addSequencingRead, setSequencingTrim])

  // --- File menu actions ---
  const handleNewSequence = useCallback(() => {
    setFileMenuOpen(false)
    setNewSeqModalOpen(true)
  }, [])

  const handleNewSequenceSubmit = useCallback((result: NewSequenceResult) => {
    openDocument(result.name, result.sequence, result.topology, result.description)
    setNewSeqModalOpen(false)
  }, [openDocument])

  const handleNewFolder = useCallback(() => {
    useEditorStore.getState().createFolder('New Folder')
    setFileMenuOpen(false)
  }, [])

  const handleMenuImportFiles = useCallback((files: FileList | null) => {
    if (!files) return
    for (const f of Array.from(files)) {
      handleFileOpen(f)
    }
    setFileMenuOpen(false)
  }, [handleFileOpen])

  const handleImportClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) return
      if (text.trimStart().startsWith('LOCUS')) {
        // Multi-record GenBank
        const docs = parseGenBankMulti(text)
        const tabIds: string[] = []
        for (const d of docs) tabIds.push(openDocumentState(d))
        if (docs.length > 1) {
          const folderId = useEditorStore.getState().createFolder('Pasted sequences')
          for (const id of tabIds) useEditorStore.getState().moveTabToFolder(id, folderId)
          showHint(`Pasted ${docs.length} sequences from clipboard`)
        }
      } else {
        // Multi-record FASTA or plain text
        const records: { name: string; bases: string }[] = []
        let currentName = 'Pasted'
        let currentBases = ''
        for (const line of text.split(/\r?\n/)) {
          if (line.startsWith('>')) {
            if (currentBases) records.push({ name: currentName, bases: currentBases.toUpperCase() })
            currentName = line.slice(1).trim().split(/\s+/)[0] || 'Pasted'
            currentBases = ''
          } else {
            currentBases += line.replace(/\s/g, '')
          }
        }
        if (currentBases) records.push({ name: currentName, bases: currentBases.toUpperCase() })
        const tabIds: string[] = []
        for (const rec of records) tabIds.push(openDocument(rec.name, rec.bases))
        if (records.length > 1) {
          const folderId = useEditorStore.getState().createFolder('Pasted sequences')
          for (const id of tabIds) useEditorStore.getState().moveTabToFolder(id, folderId)
          showHint(`Pasted ${records.length} sequences from clipboard`)
        }
      }
    } catch {
      // Clipboard API not available or permission denied
    }
    setFileMenuOpen(false)
  }, [openDocument, openDocumentState, showHint])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return // internal drag, ignore
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    const unsupported = files.filter(f => !SUPPORTED_EXTENSIONS.test(f.name))
    if (unsupported.length > 0 && unsupported.length === files.length) {
      // All files unsupported – show brief error on the overlay
      const exts = unsupported.map(f => `.${f.name.split('.').pop()}`).join(', ')
      setDropError(`Unsupported format: ${exts}`)
      setTimeout(() => { setDropError(null); setDragOver(false) }, 1500)
    } else {
      setDragOver(false)
      for (const file of files) handleFileOpen(file)
    }
  }, [handleFileOpen])

  /** Trigger a file download with the given name and blob. */
  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const a = document.createElement('a')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [])

  // --- Session export / import ---
  const handleSessionExport = useCallback((filename: string, opts: SessionExportOptions) => {
    const blob = exportSessionToJson(theme, opts)
    downloadBlob(blob, filename)
    showHint(`Exported session (${(blob.size / 1024).toFixed(0)} KB)`)
  }, [theme, downloadBlob, showHint])

  const handleSessionImportFile = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const reader = new FileReader()
    reader.onload = () => {
      const json = reader.result as string
      try {
        // Validate before showing the modal
        const session = importSessionFromJson(json)
        setSessionImportData({ filename: file.name, json })
        setSessionImportOpen(true)
        // Store parsed counts for the modal
        sessionImportParsedRef.current = session
      } catch (e) {
        showError(`Failed to read session file: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }
    reader.onerror = () => showError('Failed to read file')
    reader.readAsText(file)
  }, [showError])

  const sessionImportParsedRef = useRef<ReturnType<typeof importSessionFromJson> | null>(null)

  const handleSessionReplace = useCallback(() => {
    const session = sessionImportParsedRef.current
    if (!session) return
    const { restoreSession } = useEditorStore.getState()
    restoreSession(
      session.tabs, session.activeTabId, session.folders,
      session.sequencingReads, session.activeSequencingReadIds,
      session.alignments, session.readAlignments, session.contigs,
      session.activeAlignmentId, session.activeContigId, session.activeReadAlignmentId,
    )
    setSessionImportOpen(false)
    setSessionImportData(null)
    sessionImportParsedRef.current = null
    showHint(`Replaced session (${session.tabs.length} sequences)`)
  }, [showHint])

  const handleSessionMerge = useCallback(() => {
    let session = sessionImportParsedRef.current
    if (!session) return
    session = remapSessionIds(session)
    const { mergeSession } = useEditorStore.getState()
    mergeSession(
      session.tabs, session.folders,
      session.sequencingReads, session.alignments,
      session.readAlignments, session.contigs,
    )
    setSessionImportOpen(false)
    setSessionImportData(null)
    sessionImportParsedRef.current = null
    showHint(`Merged ${session.tabs.length} sequences into session`)
  }, [showHint])

  /** Determine the kind of the currently active/viewed item. */
  const getActiveItemKind = (s: ReturnType<typeof useEditorStore.getState>): ExportItemKind => {
    if (s.activeContigId) return 'contig'
    if (s.activeReadAlignmentId) return 'read-alignment'
    if (s.activeAlignmentId) return 'alignment'
    if (s.activeSequencingReadIds.length > 0) return 'read'
    return 'sequence'
  }

  const handleExport = useCallback((format: ExportFormat, filename: string, mode: ExportMode) => {
    const state = useEditorStore.getState()
    const hasBulk = Object.values(bulkExportItems).some(ids => ids && ids.length > 0)

    // --- helpers per kind ---

    const exportSequenceText = (d: typeof doc, fmt: ExportFormat): string => {
      if (fmt === 'gb') return writeGenBank(d)
      if (fmt === 'fasta') {
        const lines = [`>${d.name}\n`]
        const bases = d.sequence.bases
        for (let i = 0; i < bases.length; i += 80) lines.push(bases.slice(i, i + 80) + '\n')
        return lines.join('')
      }
      if (fmt === 'gff3') return writeGff3(d)
      if (fmt === 'csv') return writeCsv(d)
      return ''
    }

    const exportReadText = (read: SequencingRead, fmt: ExportFormat): string => {
      const { bases: editedBases, editMap } = applyEdits(read.data.bases, read.edits)
      let seq = ''
      for (let i = read.trimStart; i < read.trimEnd && i < editedBases.length; i++) {
        if (editMap[i] !== 'delete') seq += editedBases[i]
      }
      const name = read.data.name.replace(/\s+/g, '_')
      if (fmt === 'fastq') {
        const quals: number[] = []
        for (let i = read.trimStart; i < read.trimEnd && i < editedBases.length; i++) {
          if (editMap[i] !== 'delete') {
            quals.push(editMap[i] === 'insert' ? 0 : (read.data.qualityScores[i] ?? 0))
          }
        }
        const qualStr = quals.map(q => String.fromCharCode(Math.min(q, 93) + 33)).join('')
        return `@${name}\n${seq}\n+\n${qualStr}\n`
      }
      return `>${name}\n${seq}\n`
    }

    const exportAlignmentText = (result: AlignmentResult, seqType: 'dna' | 'protein', fmt: ExportFormat): string => {
      if (fmt === 'aligned-fasta') return toAlignedFasta(result)
      if (fmt === 'clustal') return toClustal(result)
      if (fmt === 'phylip') return toPhylip(result)
      if (fmt === 'nexus') return toNexus(result, seqType)
      return toAlignedFasta(result)
    }

    const EXT_MAP: Record<string, string> = {
      gb: '.gb', fasta: '.fasta', dna: '.dna', gff3: '.gff', csv: '.csv',
      fastq: '.fastq', 'aligned-fasta': '.fasta', clustal: '.aln', phylip: '.phy', nexus: '.nex',
    }

    const downloadItem = (text: string, name: string, ext: string, mime = 'text/plain') => {
      downloadBlob(new Blob([text], { type: mime }), `${name}${ext}`)
    }

    // --- Determine what to export ---

    // Compute the item kind for the modal (needed for mixed detection)
    const kinds = Object.keys(bulkExportItems).filter(k => (bulkExportItems[k as ExportItemKind] ?? []).length > 0) as ExportItemKind[]
    const isMixed = kinds.length > 1

    if (isMixed) {
      // Mixed export: each item in its default format, always separate
      let fileCount = 0
      for (const kind of kinds) {
        const ids = bulkExportItems[kind] ?? []
        const defFmt = defaultFormatForKind(kind)
        const ext = formatsForKind(kind)[0]?.ext ?? '.txt'
        for (const id of ids) {
          if (kind === 'sequence') {
            const tab = state.tabs.find(t => t.id === id)
            if (!tab) continue
            if (defFmt === 'dna') {
              const buf = writeSnapGene(tab.doc)
              downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), `${tab.doc.name}.dna`)
            } else {
              downloadItem(exportSequenceText(tab.doc, defFmt), tab.doc.name, ext)
            }
          } else if (kind === 'read') {
            const readId = id.startsWith('seq_') ? id.slice(4) : id
            const read = state.sequencingReads.find(r => r.id === readId)
            if (!read) continue
            downloadItem(exportReadText(read, defFmt), read.data.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'alignment') {
            const align = state.alignments.find(a => a.id === id)
            if (!align) continue
            downloadItem(exportAlignmentText(align.result, align.seqType, defFmt), align.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'read-alignment') {
            const ra = state.readAlignments.find(r => r.id === id)
            if (!ra) continue
            downloadItem(exportAlignmentText(ra.result, 'dna', defFmt), ra.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'contig') {
            const contig = state.contigs.find(c => c.id === id)
            if (!contig) continue
            const raResults = contig.readAlignmentIds
              .map(raId => state.readAlignments.find(r => r.id === raId))
              .filter(Boolean) as typeof state.readAlignments
            if (raResults.length > 0) {
              downloadItem(exportAlignmentText(raResults[0].result, 'dna', defFmt), contig.name.replace(/\s+/g, '_'), ext)
            }
          }
          fileCount++
        }
      }
      showHint(`Exported ${fileCount} file${fileCount > 1 ? 's' : ''}`)
    } else if (!hasBulk) {
      // Single item export (active item)
      const activeKind = getActiveItemKind(state)
      if (activeKind === 'sequence') {
        if (format === 'dna') {
          downloadBlob(new Blob([writeSnapGene(doc)], { type: 'application/octet-stream' }), filename)
        } else {
          const text = exportSequenceText(doc, format)
          const mime = format === 'csv' ? 'text/csv' : 'text/plain'
          downloadBlob(new Blob([text], { type: mime }), filename)
        }
      } else if (activeKind === 'read') {
        const read = state.sequencingReads.find(r => state.activeSequencingReadIds.includes(r.id))
        if (read) {
          const text = exportReadText(read, format)
          downloadBlob(new Blob([text], { type: 'text/plain' }), filename)
        }
      } else if (activeKind === 'alignment') {
        const align = state.alignments.find(a => a.id === state.activeAlignmentId)
        if (align) {
          const text = exportAlignmentText(align.result, align.seqType, format)
          downloadBlob(new Blob([text], { type: 'text/plain' }), filename)
        }
      } else if (activeKind === 'read-alignment') {
        const ra = state.readAlignments.find(r => r.id === state.activeReadAlignmentId)
        if (ra) {
          const text = exportAlignmentText(ra.result, 'dna', format)
          downloadBlob(new Blob([text], { type: 'text/plain' }), filename)
        }
      } else if (activeKind === 'contig') {
        const contig = state.contigs.find(c => c.id === state.activeContigId)
        if (contig) {
          const raResults = contig.readAlignmentIds
            .map(raId => state.readAlignments.find(r => r.id === raId))
            .filter(Boolean) as typeof state.readAlignments
          if (raResults.length > 0) {
            const text = exportAlignmentText(raResults[0].result, 'dna', format)
            downloadBlob(new Blob([text], { type: 'text/plain' }), filename)
          }
        }
      }
      showHint(`Exported ${filename}`)
    } else {
      // Bulk export of a single kind
      const kind = kinds[0]
      const ids = bulkExportItems[kind] ?? []
      const ext = EXT_MAP[format] ?? '.txt'

      if (mode === 'separate') {
        for (const id of ids) {
          if (kind === 'sequence') {
            const tab = state.tabs.find(t => t.id === id)
            if (!tab) continue
            if (format === 'dna') {
              downloadBlob(new Blob([writeSnapGene(tab.doc)], { type: 'application/octet-stream' }), `${tab.doc.name}.dna`)
            } else {
              const text = exportSequenceText(tab.doc, format)
              const mime = format === 'csv' ? 'text/csv' : 'text/plain'
              downloadBlob(new Blob([text], { type: mime }), `${tab.doc.name}${ext}`)
            }
          } else if (kind === 'read') {
            const readId = id.startsWith('seq_') ? id.slice(4) : id
            const read = state.sequencingReads.find(r => r.id === readId)
            if (!read) continue
            downloadItem(exportReadText(read, format), read.data.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'alignment') {
            const align = state.alignments.find(a => a.id === id)
            if (!align) continue
            downloadItem(exportAlignmentText(align.result, align.seqType, format), align.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'read-alignment') {
            const ra = state.readAlignments.find(r => r.id === id)
            if (!ra) continue
            downloadItem(exportAlignmentText(ra.result, 'dna', format), ra.name.replace(/\s+/g, '_'), ext)
          } else if (kind === 'contig') {
            const contig = state.contigs.find(c => c.id === id)
            if (!contig) continue
            const raResults = contig.readAlignmentIds
              .map(raId => state.readAlignments.find(r => r.id === raId))
              .filter(Boolean) as typeof state.readAlignments
            if (raResults.length > 0) {
              downloadItem(exportAlignmentText(raResults[0].result, 'dna', format), contig.name.replace(/\s+/g, '_'), ext)
            }
          }
        }
        showHint(`Exported ${ids.length} file${ids.length > 1 ? 's' : ''}`)
      } else {
        // Combined into one file
        const parts: string[] = []
        for (const id of ids) {
          if (kind === 'sequence') {
            const tab = state.tabs.find(t => t.id === id)
            if (tab) parts.push(exportSequenceText(tab.doc, format))
          } else if (kind === 'read') {
            const readId = id.startsWith('seq_') ? id.slice(4) : id
            const read = state.sequencingReads.find(r => r.id === readId)
            if (read) parts.push(exportReadText(read, format))
          } else if (kind === 'alignment') {
            const align = state.alignments.find(a => a.id === id)
            if (align) parts.push(exportAlignmentText(align.result, align.seqType, format))
          } else if (kind === 'read-alignment') {
            const ra = state.readAlignments.find(r => r.id === id)
            if (ra) parts.push(exportAlignmentText(ra.result, 'dna', format))
          } else if (kind === 'contig') {
            const contig = state.contigs.find(c => c.id === id)
            if (contig) {
              const raResults = contig.readAlignmentIds
                .map(raId => state.readAlignments.find(r => r.id === raId))
                .filter(Boolean) as typeof state.readAlignments
              if (raResults.length > 0) parts.push(exportAlignmentText(raResults[0].result, 'dna', format))
            }
          }
        }
        const mime = format === 'csv' ? 'text/csv' : 'text/plain'
        const sep = format === 'gb' ? '\n' : ''
        downloadBlob(new Blob([parts.join(sep)], { type: mime }), filename)
        showHint(`Exported ${filename}`)
      }
    }

    setExportModalOpen(false)
    setBulkExportItems({})
  }, [doc, bulkExportItems, downloadBlob, showHint])

  // Find
  const handleOpenFind = useCallback(() => {
    const state = useEditorStore.getState()
    if (state.activeSequencingReadIds.length > 0) {
      setChromSearchOpen(true)
    } else if (state.activeContigId) {
      setContigSearchOpen(true)
    } else if (state.activeAlignmentId) {
      setAlignSearchOpen(true)
    } else {
      setShowFind(true)
    }
  }, [])

  const handleCloseFind = useCallback(() => {
    setShowFind(false)
  }, [])

  return (
    <div
      className="app-root"
      data-theme={theme}
      onDrop={e => {
        dragCounterRef.current = 0
        handleDrop(e)
      }}
      onDragEnter={e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          dragCounterRef.current++
          setDragOver(true)
        }
      }}
      onDragOver={e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
        }
      }}
      onDragLeave={e => {
        if (e.dataTransfer.types.includes('Files')) {
          dragCounterRef.current--
          if (dragCounterRef.current <= 0) {
            dragCounterRef.current = 0
            setDragOver(false)
          }
        }
      }}
    >
      {/* === Top Toolbar === */}
      <div className="toolbar">
        <a href="index.html" className="tb toolbar-icon-btn toolbar-back" title="Back to homepage">
          <ArrowLeft size={16} />
        </a>
        <div className="toolbar-group file-menu-wrap" ref={fileMenuRef}>
          <button className="tb" onClick={() => setFileMenuOpen(v => !v)} title="File menu">
            <span className="tb-icon"><File size={14} /></span><span className="tb-text">File</span> <ChevronDownSmall size={10} />
          </button>
          {fileMenuOpen && (
            <div className="file-menu">
              <button className="file-menu-item" onClick={handleNewSequence}>
                <span className="file-menu-icon"><Dna size={14} /></span>
                New Sequence…
              </button>
              <button className="file-menu-item" onClick={handleNewFolder}>
                <span className="file-menu-icon"><FolderPlus size={14} /></span>
                New Folder
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { fileInputRef.current?.click() }}>
                <span className="file-menu-icon"><FileUp size={14} /></span>
                Import Files…
              </button>
              <button className="file-menu-item" onClick={() => { folderInputRef.current?.click() }}>
                <span className="file-menu-icon"><FolderUp size={14} /></span>
                Import Folder…
              </button>
              <button className="file-menu-item" onClick={handleImportClipboard}>
                <span className="file-menu-icon"><ClipboardPaste size={14} /></span>
                Import from Clipboard
              </button>
              <button className="file-menu-item" onClick={() => { setFetchModalOpen(true); setFileMenuOpen(false) }}>
                <span className="file-menu-icon"><Globe size={14} /></span>
                Import from NCBI / Addgene…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => {
                setBulkExportItems({})
                setExportModalOpen(true)
                setFileMenuOpen(false)
              }} disabled={!activeTabId && activeSequencingReadIds.length === 0 && !activeAlignmentId && !activeReadAlignmentId && !activeContigId}>
                <span className="file-menu-icon"><Save size={14} /></span>
                Export…
              </button>
              <button className="file-menu-item" onClick={() => {
                const s = useEditorStore.getState()
                const sel = s.explorerSelectedIds
                const items: Partial<Record<ExportItemKind, string[]>> = {}
                const seqIds = s.tabs.filter(t => sel.has(t.id)).map(t => t.id)
                if (seqIds.length > 0) items.sequence = seqIds
                const readIds = s.sequencingReads.filter(r => sel.has(`seq_${r.id}`)).map(r => `seq_${r.id}`)
                if (readIds.length > 0) items.read = readIds
                const alignIds = s.alignments.filter(a => sel.has(a.id)).map(a => a.id)
                if (alignIds.length > 0) items.alignment = alignIds
                const raIds = s.readAlignments.filter(r => sel.has(r.id)).map(r => r.id)
                if (raIds.length > 0) items['read-alignment'] = raIds
                const contigIds = s.contigs.filter(c => sel.has(c.id)).map(c => c.id)
                if (contigIds.length > 0) items.contig = contigIds
                setBulkExportItems(items)
                setExportModalOpen(true)
                setFileMenuOpen(false)
              }} disabled={selectedExportableCount < 2}>
                <span className="file-menu-icon"><Save size={14} /></span>
                Export Selected…
              </button>
              <div className="file-menu-sep" />
              <button className="file-menu-item" onClick={() => { setSessionExportOpen(true); setFileMenuOpen(false) }}>
                <span className="file-menu-icon"><Save size={14} /></span>
                Export Session…
              </button>
              <button className="file-menu-item" onClick={() => { sessionImportInputRef.current?.click(); setFileMenuOpen(false) }}>
                <span className="file-menu-icon"><FileUp size={14} /></span>
                Import Session…
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".gb,.gbk,.genbank,.fasta,.fa,.fna,.faa,.seq,.txt,.dna,.geneious,.ab1,.abi,.abif,.scf"
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleMenuImportFiles(e.target.files); e.target.value = '' }}
          />
          <input
            ref={sessionImportInputRef}
            type="file"
            accept=".json,.seqnexus.json"
            style={{ display: 'none' }}
            onChange={e => { handleSessionImportFile(e.target.files); e.target.value = '' }}
          />
          <input
            ref={folderInputRef}
            type="file"
            /* @ts-expect-error webkitdirectory is non-standard but widely supported */
            webkitdirectory=""
            multiple
            style={{ display: 'none' }}
            onChange={e => { handleMenuImportFiles(e.target.files); e.target.value = '' }}
          />
        </div>

        <div className="toolbar-group">
          <button className="tb" onClick={undo} disabled={!activeTabId || readOnly} title="Undo (Ctrl+Z)">
            <Undo2 size={14} />
          </button>
          <button className="tb" onClick={redo} disabled={!activeTabId || readOnly} title="Redo (Ctrl+Y)">
            <Redo2 size={14} />
          </button>
        </div>

        <div className="toolbar-group">
          <button className="tb" onClick={handleOpenFind} disabled={!activeTabId && activeSequencingReadIds.length === 0 && !activeAlignmentId && !activeContigId} title="Find & Replace (Ctrl+F)">
            <span className="tb-icon"><Search size={14} /></span><span className="tb-text">Find</span>
          </button>
        </div>

        <div className="toolbar-group">
          <button className="tb" onClick={() => setAnnotateModalOpen(true)} disabled={!activeTabId} title="Annotate sequence features">
            <span className="tb-icon"><Tag size={14} /></span><span className="tb-text">Annotate</span>
          </button>
          <button className="tb" onClick={() => setOrfModalOpen(true)} disabled={!activeTabId} title="Open reading frame finder">
            <span className="tb-icon"><Dna size={14} /></span><span className="tb-text">ORFs</span>
          </button>
          <button className="tb" onClick={() => setEnzymeModalOpen(true)} disabled={!activeTabId} title="Restriction enzyme analysis">
            <span className="tb-icon"><Scissors size={14} /></span><span className="tb-text">Enzymes</span>
          </button>
          <button className="tb" onClick={() => setPrimerModalOpen(true)} disabled={!activeTabId} title="Primer design & search">
            <span className="tb-icon"><FlaskConical size={14} /></span><span className="tb-text">Primers</span>
          </button>
          <div className="tb-split" ref={cloningBtnRef}>
            <button className="tb" onClick={() => { setCloningInitialMethod(undefined); setCloningModalOpen(true) }} disabled={!activeTabId} title="In-silico cloning">
              <span className="tb-icon"><TestTube size={14} /></span><span className="tb-text">Cloning</span>
            </button>
            <button
              className="tb tb-split-caret"
              disabled={!activeTabId}
              onClick={() => setCloningDropdownOpen(v => !v)}
            >
              <ChevronDownSmall size={12} />
            </button>
            {cloningDropdownOpen && activeTabId && (
              <div className="tb-dropdown">
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('digest'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  Digest + Ligation
                </button>
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('gibson'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  Gibson Assembly
                </button>
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('golden-gate'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  Golden Gate
                </button>
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('infusion'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  In-Fusion
                </button>
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('gateway'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  Gateway
                </button>
                <button className="tb-dropdown-item" onClick={() => { setCloningInitialMethod('topo'); setCloningModalOpen(true); setCloningDropdownOpen(false) }}>
                  TOPO
                </button>
              </div>
            )}
          </div>
          <button className="tb" onClick={() => setBlastModalOpen(true)} disabled={!activeTabId} title={blastPhase === 'polling' ? 'BLAST search running...' : blastPhase === 'results' ? 'BLAST results ready' : 'NCBI BLAST search'}>
            <span className="tb-icon"><Globe size={14} /></span><span className="tb-text">BLAST</span>
            {blastPhase === 'polling' && <span className="tb-badge tb-badge-pulse" />}
            {blastPhase === 'results' && <span className="tb-badge tb-badge-done" />}
          </button>
          <button className="tb" onClick={() => setAlignModalOpen(true)} title="Sequence alignment">
            <span className="tb-icon"><AlignLeft size={14} /></span><span className="tb-text">Align</span>
          </button>
          <button className="tb" onClick={() => setGelModalOpen(true)} disabled={!activeTabId} title="Virtual gel electrophoresis">
            <span className="tb-icon"><GalleryVertical size={14} /></span><span className="tb-text">Gel</span>
          </button>
        </div>

        <div className="toolbar-group">
          {(() => {
            const activeContig = activeContigId ? contigs.find(c => c.id === activeContigId) : null
            if (activeContig) {
              const cz = activeContig.zoomLevel
              return (
                <>
                  <button className="tb" onClick={() => setContigZoom(activeContig.id, cz - 1)} disabled={cz <= 0} title="Zoom out">
                    <span className="tb-icon"><ZoomOut size={14} /></span>
                  </button>
                  <span className="tb zoom-label" title={`Zoom level ${cz}`}>{Math.round(cz / 9 * 100)}%</span>
                  <button className="tb" onClick={() => setContigZoom(activeContig.id, cz + 1)} disabled={cz >= 9} title="Zoom in">
                    <span className="tb-icon"><ZoomIn size={14} /></span>
                  </button>
                </>
              )
            }
            const activeRA = activeReadAlignmentId ? readAlignments.find(ra => ra.id === activeReadAlignmentId) : null
            if (activeRA) {
              const rz = activeRA.zoomLevel
              return (
                <>
                  <button className="tb" onClick={() => setReadAlignmentZoom(activeRA.id, rz - 1)} disabled={rz <= 0} title="Zoom out">
                    <span className="tb-icon"><ZoomOut size={14} /></span>
                  </button>
                  <span className="tb zoom-label" title={`Zoom level ${rz}`}>{Math.round(rz / 9 * 100)}%</span>
                  <button className="tb" onClick={() => setReadAlignmentZoom(activeRA.id, rz + 1)} disabled={rz >= 9} title="Zoom in">
                    <span className="tb-icon"><ZoomIn size={14} /></span>
                  </button>
                </>
              )
            }
            const activeAlign = activeAlignmentId ? alignments.find(a => a.id === activeAlignmentId) : null
            if (activeAlign) {
              const az = activeAlign.zoomLevel
              return (
                <>
                  <button className="tb" onClick={() => setAlignmentZoom(activeAlign.id, az - 1)} disabled={az <= 0} title="Zoom out">
                    <span className="tb-icon"><ZoomOut size={14} /></span>
                  </button>
                  <span className="tb zoom-label" title={`Zoom level ${az}`}>{Math.round(az / 9 * 100)}%</span>
                  <button className="tb" onClick={() => setAlignmentZoom(activeAlign.id, az + 1)} disabled={az >= 9} title="Zoom in">
                    <span className="tb-icon"><ZoomIn size={14} /></span>
                  </button>
                </>
              )
            }
            if (activeSequencingReadIds.length > 0) {
              return (
                <>
                  <button className="tb" onClick={() => chromZoomRef.current?.zoomOut()} disabled={chromZoomPct <= 0} title="Zoom out">
                    <span className="tb-icon"><ZoomOut size={14} /></span>
                  </button>
                  <span className="tb zoom-label">{chromZoomPct}%</span>
                  <button className="tb" onClick={() => chromZoomRef.current?.zoomIn()} disabled={chromZoomPct >= 100} title="Zoom in">
                    <span className="tb-icon"><ZoomIn size={14} /></span>
                  </button>
                </>
              )
            }
            return (
              <>
                <button className="tb" onClick={() => setZoom(zoomLevel - 1)} disabled={!activeTabId || zoomLevel <= 0} title="Zoom out">
                  <span className="tb-icon"><ZoomOut size={14} /></span>
                </button>
                <span className="tb zoom-label" title={`Zoom level ${zoomLevel}`}>{Math.round(zoomLevel / 20 * 100)}%</span>
                <button className="tb" onClick={() => setZoom(zoomLevel + 1)} disabled={!activeTabId || zoomLevel >= 20} title="Zoom in">
                  <span className="tb-icon"><ZoomIn size={14} /></span>
                </button>
              </>
            )
          })()}
        </div>

        <div className="toolbar-spacer" />
        <button
          ref={themeBtnRef}
          className="tb toolbar-icon-btn"
          onClick={() => { setThemeOpen(v => !v); setInfoOpen(false) }}
          title="Theme"
        >
          <SunMoon size={16} />
        </button>
        <button
          ref={infoBtnRef}
          className="tb toolbar-icon-btn"
          onClick={() => { setInfoOpen(v => !v); setThemeOpen(false) }}
          title="About SeqNexus"
        >
          <Info size={16} />
        </button>
      </div>

      {/* Theme popover - rendered outside toolbar to avoid overflow clipping */}
      {themeOpen && (() => {
        const r = themeBtnRef.current?.getBoundingClientRect()
        const top = r ? r.bottom + 10 : 46
        const right = r ? window.innerWidth - r.right : 14
        return (
          <div className="theme-popover" ref={themePopRef} style={{ top, right }}>
            <div className="popover-header">
              <span>Theme</span>
              <button className="popover-close" onClick={() => setThemeOpen(false)}><X size={14} /></button>
            </div>
            <div className="theme-popover-body">
              <div className="theme-group-label">Light</div>
              {THEMES.filter(t => t.group === 'light').map(t => (
                <button
                  key={t.id}
                  className={`theme-option ${theme === t.id ? 'active' : ''}`}
                  onClick={() => { switchTheme(t.id); setThemeOpen(false) }}
                >
                  <span className="theme-preview" style={{ background: t.outer }}>
                    <span className="tp-card" style={{ background: t.bg }}>
                      <span className="tp-accent" style={{ background: t.accent }} />
                      <span className="tp-line" style={{ background: t.text }} />
                      <span className="tp-line short" style={{ background: t.muted }} />
                    </span>
                  </span>
                  <span className="theme-label">{t.label}</span>
                </button>
              ))}
              <div className="theme-group-label">Dark</div>
              {THEMES.filter(t => t.group === 'dark').map(t => (
                <button
                  key={t.id}
                  className={`theme-option ${theme === t.id ? 'active' : ''}`}
                  onClick={() => { switchTheme(t.id); setThemeOpen(false) }}
                >
                  <span className="theme-preview" style={{ background: t.outer }}>
                    <span className="tp-card" style={{ background: t.bg }}>
                      <span className="tp-accent" style={{ background: t.accent }} />
                      <span className="tp-line" style={{ background: t.text }} />
                      <span className="tp-line short" style={{ background: t.muted }} />
                    </span>
                  </span>
                  <span className="theme-label">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Info popover - rendered outside toolbar */}
      {infoOpen && (() => {
        const r = infoBtnRef.current?.getBoundingClientRect()
        const top = r ? r.bottom + 10 : 46
        const right = r ? window.innerWidth - r.right : 14
        return (
          <div className="info-popover" ref={infoPopRef} style={{ top, right }}>
            <div className="popover-header">
              <span>About</span>
              <button className="popover-close" onClick={() => setInfoOpen(false)}><X size={14} /></button>
            </div>
            <div className="info-body">
              <div className="info-logo"><Dna size={28} /></div>
              <div className="info-title">SeqNexus</div>
              <div className="info-version">v1.0.0</div>
              <div className="info-desc">
                Browser-based molecular biology sequence editor. View, edit, and annotate DNA sequences with plasmid maps, restriction analysis, ORF finding, primer design, sequence alignment, Sanger trace viewing, and in-silico cloning.
              </div>
              <hr />
              <div className="info-row"><span className="info-label">Author</span><span><a href="mailto:contact@seqnexus.app">Christopher Acatay</a></span></div>
              <div className="info-row"><span className="info-label">License</span><span>MIT – free for any use</span></div>
              <hr />
              <div className="info-notice">
                <strong>Free to use.</strong> SeqNexus is open-source under the MIT license. All generated figures may be used freely in publications, presentations, theses, and commercial work.
              </div>
              <hr />
              <div className="info-section-title">How to Cite</div>
              <div className="info-cite">
                Acatay, C. (2026). SeqNexus: a browser-based molecular biology sequence editor. Available at <a href="https://seqnexus.app" target="_blank" rel="noopener noreferrer">seqnexus.app</a>
              </div>
              <button
                className="info-copy-cite"
                onClick={(e) => {
                  const btn = e.currentTarget
                  navigator.clipboard.writeText('Acatay, C. (2026). SeqNexus: a browser-based molecular biology sequence editor. Available at https://seqnexus.app').then(() => {
                    btn.textContent = 'Copied!'
                    setTimeout(() => { btn.textContent = 'Copy citation' }, 1500)
                  })
                }}
              >
                Copy citation
              </button>
              <hr />
              <div
                className={`info-section-title info-collapsible${shortcutsOpen ? '' : ' collapsed'}`}
                onClick={() => setShortcutsOpen(v => !v)}
              >
                Keyboard Shortcuts
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className={`info-shortcuts-body${shortcutsOpen ? '' : ' collapsed'}`}>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Z</kbd></span><span className="shortcut-desc">Undo</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></span><span className="shortcut-desc">Redo</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>C</kbd></span><span className="shortcut-desc">Copy selection</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>X</kbd></span><span className="shortcut-desc">Cut selection</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>V</kbd></span><span className="shortcut-desc">Paste</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>A</kbd></span><span className="shortcut-desc">Select all</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>F</kbd></span><span className="shortcut-desc">Find / Replace</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>G</kbd></span><span className="shortcut-desc">Go to position</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></span><span className="shortcut-desc">Export sequence</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Shift</kbd>+<kbd>Arrow</kbd></span><span className="shortcut-desc">Extend selection</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Home</kbd> / <kbd>End</kbd></span><span className="shortcut-desc">Jump to start / end</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Delete</kbd> / <kbd>Backspace</kbd></span><span className="shortcut-desc">Delete base(s)</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>A</kbd><kbd>T</kbd><kbd>G</kbd><kbd>C</kbd></span><span className="shortcut-desc">Type / insert base</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Ctrl</kbd>+<kbd>Scroll</kbd></span><span className="shortcut-desc">Zoom in / out</span></div>
                <div className="info-shortcut"><span className="shortcut-keys"><kbd>Esc</kbd></span><span className="shortcut-desc">Clear selection</span></div>
              </div>
              <hr />
              <div className="info-legal">
                <a href="impressum.html" target="_blank" rel="noopener noreferrer">Impressum</a>
                <span className="info-legal-sep">&middot;</span>
                <a href="datenschutz.html" target="_blank" rel="noopener noreferrer">Datenschutz</a>
              </div>
            </div>
          </div>
        )
      })()}

      {/* === Main Area === */}
      <div className="main-area">
        {/* Left Sidebar - File Explorer */}
        <aside className={`left-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <div className="ls-header">
            <span>Explorer</span>
            <button
              className="ls-toggle"
              onClick={() => setSidebarOpen(false)}
              title="Hide sidebar"
            >
              <PanelLeftClose size={14} />
            </button>
          </div>
          <FileExplorer onImportFile={handleFileOpen} onOpenProperties={() => setPropertiesModalOpen(true)} onOpenInfo={() => setInfoOpen(true)} onAlignToRef={openRefPicker} onExportItems={(items) => { setBulkExportItems(items); setExportModalOpen(true) }} onQuickAlign={(tabIds, readIds) => {
            const state = useEditorStore.getState()
            const entries: import('./components/AlignmentModal').AlignmentInitialEntry[] = []
            for (const id of tabIds) {
              const tab = state.tabs.find(t => t.id === id)
              if (tab) entries.push({ id: `tab_${id}_${Date.now()}`, name: tab.doc.name, bases: tab.doc.sequence.bases, source: 'tab', sourceId: id })
            }
            if (readIds) {
              for (const rid of readIds) {
                const read = state.sequencingReads.find(r => r.id === rid)
                if (read) {
                  const bases = getReadBases(read)
                  if (bases.length > 0) entries.push({ id: `read_${rid}_${Date.now()}`, name: read.data.name, bases, source: 'read', sourceId: rid })
                }
              }
            }
            if (entries.length >= 2) {
              setAlignInitialEntries(entries)
              setAlignModalOpen(true)
            }
          }} />
        </aside>
        {!sidebarOpen && (
          <button
            className="sidebar-show-btn"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
          >
            <PanelLeftOpen size={14} />
          </button>
        )}

        {/* Center Panel */}
        <div className="center-panel">
          {activeContigId && contigs.find(c => c.id === activeContigId) ? (
            (() => {
              const activeContig = contigs.find(c => c.id === activeContigId)!
              return (
                <>
                  <Suspense fallback={null}>
                    <ContigView
                      contig={activeContig}
                      onZoomChange={(level) => setContigZoom(activeContig.id, level)}
                      onViewReadAlignment={(raId) => {
                        setParentContigId(activeContig.id)
                        useEditorStore.getState().setActiveReadAlignment(raId)
                      }}
                      externalSearchOpen={contigSearchOpen}
                      onSearchClose={() => setContigSearchOpen(false)}
                      onSelectionChange={setContigSelInfo}
                    />
                  </Suspense>
                  <div className="status-bar">
                    <span style={{ flex: 1 }} />
                    <span className="status-bar-right">
                      {contigSelInfo && (
                        <>
                          <span className="status-goto-btn" style={{ cursor: 'default' }}>
                            {contigSelInfo.anchor !== contigSelInfo.caret
                              ? `${Math.min(contigSelInfo.anchor, contigSelInfo.caret) + 1}..${Math.max(contigSelInfo.anchor, contigSelInfo.caret)} (${Math.abs(contigSelInfo.caret - contigSelInfo.anchor)} bp)`
                              : `Pos ${contigSelInfo.caret + 1}`
                            }
                          </span>
                          <span className="status-sep" />
                        </>
                      )}
                      <StorageIndicator refreshKey={storageRefreshKey} />
                    </span>
                  </div>
                </>
              )
            })()
          ) : activeReadAlignmentId && readAlignments.find(ra => ra.id === activeReadAlignmentId) ? (
            (() => {
              const activeRA = readAlignments.find(ra => ra.id === activeReadAlignmentId)!
              return (
                <>
                  {parentContigId && (
                    <div className="contig-back-bar">
                      <button className="contig-back-btn" onClick={() => {
                        setActiveContig(parentContigId)
                        setParentContigId(null)
                      }}>
                        ← Back to Contig
                      </button>
                    </div>
                  )}
                  <Suspense fallback={null}>
                    <ReadAlignmentView
                      ra={activeRA}
                      onZoomChange={(level) => setReadAlignmentZoom(activeRA.id, level)}
                    />
                  </Suspense>
                  <div className="status-bar">
                    <span style={{ flex: 1 }} />
                    <span className="status-bar-right">
                      <StorageIndicator refreshKey={storageRefreshKey} />
                    </span>
                  </div>
                </>
              )
            })()
          ) : activeSequencingReadIds.length > 0 ? (
            <>
              <div className="chrom-stack">
                {activeSequencingReadIds.length > 1 && (
                  <div className="chrom-multi-toolbar">
                    <button className={`chrom-tb ${multiChromShowCurves ? 'active' : ''}`} onClick={() => setMultiChromShowCurves(v => !v)} title="Show/hide trace curves">Traces</button>
                    {multiChromShowCurves && <>
                      {(['A', 'C', 'G', 'T'] as const).map(base => (
                        <button key={base} className={`chrom-trace-toggle chrom-trace-${base} ${multiChromShowTraces[base] ? '' : 'off'}`} onClick={() => setMultiChromShowTraces(prev => ({ ...prev, [base]: !prev[base] }))}>{base}</button>
                      ))}
                      <button className={`chrom-tb ${multiChromShowQuality ? 'active' : ''}`} onClick={() => setMultiChromShowQuality(v => !v)} title="Toggle quality">Q</button>
                    </>}
                  </div>
                )}
                {activeSequencingReadIds.map((rid, idx) => {
                  const isMulti = activeSequencingReadIds.length > 1
                  return (
                    <ChromatogramView key={rid} readId={rid} compact={isMulti} zoomRef={idx === 0 ? chromZoomRef : undefined} onZoomChange={idx === 0 ? setChromZoomPct : undefined} externalSearchOpen={chromSearchOpen} onSearchClose={() => setChromSearchOpen(false)}
                      syncScrollX={isMulti ? multiChromScrollX : undefined}
                      onSyncScroll={isMulti ? setMultiChromScrollX : undefined}
                      syncZoom={isMulti ? multiChromZoom : undefined}
                      onSyncZoom={isMulti ? setMultiChromZoom : undefined}
                      syncShowTraces={isMulti ? multiChromShowTraces : undefined}
                      syncShowQuality={isMulti ? multiChromShowQuality : undefined}
                      hideCurves={isMulti ? !multiChromShowCurves : undefined}
                      onSelectionStart={isMulti ? handleMultiSelectionStart : undefined}
                      clearSelectionTrigger={isMulti && multiChromClearSel.activeReadId !== rid ? multiChromClearSel.trigger : undefined}
                      onCopyFeedback={showCopyHint}
                    />
                  )
                })}
                {activeSequencingReadIds.length > 1 && <MultiChromScrollbar scrollX={multiChromScrollX} zoom={multiChromZoom} setScrollX={setMultiChromScrollX} readIds={activeSequencingReadIds} />}
              </div>
              <div className="status-bar">
                <span style={{ flex: 1 }} />
                <span className="status-bar-right">
                  <StorageIndicator refreshKey={storageRefreshKey} />
                </span>
              </div>
            </>
          ) : activeAlignmentId && alignments.find(a => a.id === activeAlignmentId) ? (
            (() => {
              const activeAlign = alignments.find(a => a.id === activeAlignmentId)!
              return (
                <Suspense fallback={null}>
                  <AlignmentPanel
                    result={activeAlign.result}
                    seqType={activeAlign.seqType}
                    algorithm={activeAlign.algorithm}
                    zoomLevel={activeAlign.zoomLevel}
                    alignmentId={activeAlign.id}
                    onZoomChange={(level) => setAlignmentZoom(activeAlign.id, level)}
                    onCopy={(format) => {
                      const text = format === 'fasta'
                        ? toAlignedFasta(activeAlign.result)
                        : toClustal(activeAlign.result)
                      navigator.clipboard.writeText(text).then(() => {
                        showCopyHint(`Copied alignment as ${format === 'fasta' ? 'FASTA' : 'Clustal'}`)
                      })
                    }}
                    onAnnotateDiffs={() => {
                      const anns = generateDiffAnnotations(activeAlign.result)
                      for (const ann of anns) addAnnotation(ann)
                    }}
                    onJumpToSource={(seqName, ungappedPos) => {
                      const store = useEditorStore.getState()
                      const tab = store.tabs.find(t => t.doc.name === seqName || seqName.startsWith(t.doc.name))
                      if (tab) {
                        store.setActiveTab(tab.id)
                        const pos = Math.max(0, ungappedPos - 1)
                        store.smoothScrollRequested = true
                        store.setSelection({ anchor: pos, caret: pos })
                      }
                    }}
                    externalSearchOpen={alignSearchOpen}
                    onSearchClose={() => setAlignSearchOpen(false)}
                  />
                  <div className="status-bar">
                    <span style={{ flex: 1 }} />
                    <span className="status-bar-right">
                      <StorageIndicator refreshKey={storageRefreshKey} />
                    </span>
                  </div>
                </Suspense>
              )
            })()
          ) : !activeTabId ? (
            <div className="empty-state">
              <div className="empty-state-icon"><Dna size={48} /></div>
              <div className="empty-state-text">No sequence open</div>
              <div className="empty-state-hint">Use + in the sidebar to import files, or drag & drop</div>
            </div>
          ) : (
            <>
              {/* View mode tabs */}
              <div className="view-tabs">
                <button
                  className={`view-tab ${viewMode === 'linear' ? 'active' : ''}`}
                  onClick={() => setViewMode('linear')}
                >
                  Linear
                </button>
                <button
                  className={`view-tab ${viewMode === 'circular' ? 'active' : ''}`}
                  onClick={() => setViewMode('circular')}
                >
                  Circular
                </button>
                <button
                  className={`view-tab ${viewMode === 'split' ? 'active' : ''}`}
                  onClick={() => setViewMode('split')}
                >
                  Split
                </button>
                <span className="view-info">
                  {editingViewName ? (
                    <input
                      ref={viewNameInputRef}
                      className="view-info-input"
                      value={viewNameValue}
                      onChange={e => setViewNameValue(e.target.value)}
                      onBlur={() => {
                        const trimmed = viewNameValue.trim()
                        if (trimmed && activeTabId) renameTab(activeTabId, trimmed)
                        setEditingViewName(false)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const trimmed = viewNameValue.trim()
                          if (trimmed && activeTabId) renameTab(activeTabId, trimmed)
                          setEditingViewName(false)
                        }
                        if (e.key === 'Escape') setEditingViewName(false)
                      }}
                      spellCheck={false}
                    />
                  ) : (
                    <span
                      className="view-info-name"
                      onDoubleClick={() => {
                        setViewNameValue(doc.name)
                        setEditingViewName(true)
                        setTimeout(() => {
                          viewNameInputRef.current?.focus()
                          viewNameInputRef.current?.select()
                        }, 30)
                      }}
                      title="Double-click to rename"
                    >
                      {doc.name}
                    </span>
                  )}
                </span>
              </div>

              {/* Panel bar */}
              <div className="panel-bar">
                <button
                  className={`panel-bar-btn ${featuresPanelOpen ? 'active' : ''}`}
                  onClick={() => setFeaturesPanelOpen(v => !v)}
                  title="Toggle feature sidebar"
                >
                  <List size={13} /> Features
                  <span className="panel-bar-count">{doc.annotations.length}</span>
                </button>
                <div className="panel-bar-sep" />
                <button
                  className={`panel-bar-btn ${showOrfs ? 'active' : ''}`}
                  onClick={() => toggleOrfs()}
                  title="Toggle ORF display"
                >
                  <Dna size={13} /> ORFs
                  {showOrfs && orfResults.length > 0 && (
                    <span className="panel-bar-count">{orfResults.length}</span>
                  )}
                </button>
                <button
                  className={`panel-bar-btn ${showEnzymes ? 'active' : ''}`}
                  onClick={() => toggleEnzymes()}
                  title="Toggle restriction enzyme display"
                >
                  <Scissors size={13} /> REs
                  {showEnzymes && enzymeCutSites.length > 0 && (
                    <span className="panel-bar-count">{enzymeCutSites.length}</span>
                  )}
                </button>
                <button
                  className={`panel-bar-btn ${showPrimers ? 'active' : ''}`}
                  onClick={() => togglePrimers()}
                  title="Toggle primer display"
                >
                  <FlaskConical size={13} /> Primers
                </button>

              </div>

              {/* View area */}
                <div className="view-and-panels">
                  <div className="view-area">
                    <FindModal open={showFind} onClose={handleCloseFind} />
                    {/* Empty state hints for active panels with no results */}
                    <div className="panel-hints">
                      {showOrfs && orfResults.length === 0 && (
                        <div className="panel-hint">
                          <Dna size={12} />
                          No ORFs found – <button className="panel-hint-link" onClick={() => setOrfModalOpen(true)}>adjust parameters</button>
                        </div>
                      )}
                      {showEnzymes && enzymeCutSites.length === 0 && (
                        <div className="panel-hint">
                          <Scissors size={12} />
                          No enzyme sites – <button className="panel-hint-link" onClick={() => setEnzymeModalOpen(true)}>select enzymes</button>
                        </div>
                      )}
                      {showPrimers && primerResults.length === 0 && (
                        <div className="panel-hint">
                          <FlaskConical size={12} />
                          No primers found – <button className="panel-hint-link" onClick={() => setPrimerModalOpen(true)}>configure search</button>
                        </div>
                      )}
                    </div>
                    {parseProgress && (
                      <div className="parse-progress-overlay">
                        <div className="parse-progress-box">
                          <div className="parse-progress-label">
                            Parsing GenBank file…
                          </div>
                          <div className="parse-progress-bar-track">
                            <div
                              className="parse-progress-bar-fill"
                              style={{ width: `${parseProgress.totalBytes > 0 ? Math.round((parseProgress.bytesRead / parseProgress.totalBytes) * 100) : 0}%` }}
                            />
                          </div>
                          <div className="parse-progress-detail">
                            {(parseProgress.bytesRead / 1024 / 1024).toFixed(1)} / {(parseProgress.totalBytes / 1024 / 1024).toFixed(1)} MB
                          </div>
                        </div>
                      </div>
                    )}
                    {viewMode === 'linear' && <SequenceView onFindRequest={handleOpenFind} onAnnotateRequest={() => { useEditorStore.getState().setRequestAddAnnotation(true); setFeaturesPanelOpen(true) }} onEditFeature={() => setFeaturesPanelOpen(true)} onCopyFeedback={showCopyHint} />}
                    {viewMode === 'circular' && <PlasmidMap onFindRequest={handleOpenFind} onEditFeature={() => setFeaturesPanelOpen(true)} onCopyFeedback={showCopyHint} />}
                    {viewMode === 'split' && (
                      <div
                        ref={splitContainerRef}
                        className="split-container"
                        onPointerMove={handleSplitPointerMove}
                        onPointerUp={handleSplitPointerUp}
                      >
                        <div className="split-pane" style={{ flex: `0 0 ${splitFraction * 100}%` }}>
                          <PlasmidMap onEditFeature={() => setFeaturesPanelOpen(true)} onCopyFeedback={showCopyHint} />
                        </div>
                        <div
                          className="split-divider"
                          onPointerDown={handleSplitPointerDown}
                        />
                        <div className="split-pane" style={{ flex: 1 }}>
                          <SequenceView onFindRequest={handleOpenFind} onAnnotateRequest={() => { useEditorStore.getState().setRequestAddAnnotation(true); setFeaturesPanelOpen(true) }} onEditFeature={() => setFeaturesPanelOpen(true)} onCopyFeedback={showCopyHint} />
                        </div>
                      </div>
                    )}
                  </div>

                </div>

              {/* Status bar */}
              <div className="status-bar">
                <button
                  className="status-props-btn"
                  onClick={() => setPropertiesModalOpen(true)}
                  title="Edit sequence properties"
                >
                  {doc.sequence.topology}
                  {doc.metadata?.strandedness === 'single' ? ' | ss' : ' | ds'}
                  {' | '}{formatBp(seqLength)}
                  {doc.metadata?.damMethylated && ' | Dam'}
                  {doc.metadata?.dcmMethylated && ' | Dcm'}
                  {doc.metadata?.ecoKIMethylated && ' | EcoKI'}
                </button>
                {undoFlash && (
                  <span key={Date.now()} className="status-undo-flash">
                    {undoFlash === 'undo' ? 'Undo' : 'Redo'}
                  </span>
                )}
                <span className="status-bar-right">
                  <button
                    ref={statsBtnRef}
                    className={`status-lock ${statsOpen ? 'active' : ''}`}
                    onClick={() => setStatsOpen(v => !v)}
                    title="Sequence statistics"
                  >
                    <BarChart3 size={12} />
                    Stats
                  </button>
                  <span className="status-sep" />
                  <button
                    className={`status-lock ${readOnly ? 'locked' : ''}${lockFlash ? ' flash' : ''}`}
                    onClick={toggleReadOnly}
                    title={readOnly ? 'Editing disabled - click to enable' : 'Editing enabled - click to lock'}
                  >
                    {readOnly ? <Lock size={12} /> : <LockOpen size={12} />}
                    {readOnly ? 'Read-only' : 'Editable'}
                  </button>
                  <span className="status-sep" />
                  {(() => {
                    const dispOrigin = (doc.sequence.topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
                    const dp = (pos: number) => displayPosition(pos, dispOrigin, seqLength)
                    return gotoActive ? (
                      <input
                        ref={gotoInputRef}
                        className="status-goto-input"
                        type="text"
                        value={gotoValue}
                        placeholder={`1–${seqLength.toLocaleString()}`}
                        onChange={e => setGotoValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const pos = parseInt(gotoValue.replace(/,/g, ''))
                            if (pos >= 1 && pos <= seqLength) {
                              const store = useEditorStore.getState()
                              store.smoothScrollRequested = true
                              store.setCaret(internalPosition(pos, dispOrigin, seqLength))
                            }
                            setGotoActive(false)
                          } else if (e.key === 'Escape') {
                            setGotoActive(false)
                          }
                        }}
                        onBlur={() => setGotoActive(false)}
                      />
                    ) : (
                      <button
                        className="status-goto-btn"
                        onClick={() => {
                          setGotoValue('')
                          setGotoActive(true)
                          requestAnimationFrame(() => gotoInputRef.current?.focus())
                        }}
                        title="Click to go to position (Ctrl+G)"
                      >
                        {selection.anchor !== selection.caret
                          ? (() => {
                              const segs = selectionSegments(selection, doc.sequence.topology, seqLength)
                              let selBases = ''
                              for (const [s, e] of segs) selBases += doc.sequence.basesIn(s, e)
                              const gc = Math.round(gcPercent(selBases))
                              const range = isOriginSpanningSelection(selection, doc.sequence.topology)
                                ? `${dp(selection.anchor)}..${dp(selection.caret - 1)}`
                                : `${dp(Math.min(selection.anchor, selection.caret))}..${dp(Math.max(selection.anchor, selection.caret) - 1)}`
                              return `${range} (${formatBp(selBases.length)}, ${gc}% GC)`
                            })()
                          : `Pos ${dp(selection.caret)}`}
                      </button>
                    )
                  })()}
                  <span className="status-sep" />
                  <StorageIndicator refreshKey={storageRefreshKey} />
                </span>
              </div>
            </>
          )}
        </div>
        <FeatureSidebar open={featuresPanelOpen} onClose={() => setFeaturesPanelOpen(false)} />
      </div>

      {errorToast && (
        <div
          className={errorToastClosing ? 'error-toast closing' : 'error-toast'}
          onClick={dismissErrorToast}
          onAnimationEnd={handleErrorAnimationEnd}
        >
          <span>{errorToast}</span>
          <button className="error-toast-close">&times;</button>
        </div>
      )}
      {hintToast && (
        <div
          className={hintToastClosing ? 'hint-toast closing' : 'hint-toast'}
          onClick={dismissHintToast}
          onAnimationEnd={handleHintAnimationEnd}
        >
          <span>{hintToast}</span>
          <button className="hint-toast-close">&times;</button>
        </div>
      )}
      <StorageToast />
      {dragOver && <div className={`drop-overlay${dropError ? ' drop-error' : ''}`}>{dropError ?? 'Drop files to open'}</div>}

      <NewSequenceModal
        open={newSeqModalOpen}
        onClose={() => setNewSeqModalOpen(false)}
        onSubmit={handleNewSequenceSubmit}
      />

      <ORFPanel
        open={orfModalOpen}
        onClose={() => {
          setOrfModalOpen(false)
          if (!useEditorStore.getState().showOrfs) {
            useEditorStore.getState().toggleOrfs()
          }
        }}
      />

      <EnzymePanel
        open={enzymeModalOpen}
        onClose={() => setEnzymeModalOpen(false)}
      />

      <PrimerPanel
        open={primerModalOpen}
        onClose={() => {
          setPrimerModalOpen(false)
          const s = useEditorStore.getState()
          if (s.selectedPrimerIndices.size > 0 && !s.showPrimers) {
            s.togglePrimers()
          }
        }}
      />

      <Suspense fallback={null}>
      <AnnotateModal
        open={annotateModalOpen}
        onClose={() => setAnnotateModalOpen(false)}
      />
      <SequencePropertiesModal
        open={propertiesModalOpen}
        onClose={() => setPropertiesModalOpen(false)}
      />
      <CloningModal
        open={cloningModalOpen}
        onClose={() => setCloningModalOpen(false)}
        initialMethod={cloningInitialMethod}
      />
      <BlastModal
        open={blastModalOpen}
        onClose={() => setBlastModalOpen(false)}
        onPhaseChange={setBlastPhase}
      />
      <AlignmentModal
        open={alignModalOpen}
        onClose={() => { setAlignModalOpen(false); setAlignInitialEntries(undefined) }}
        initialEntries={alignInitialEntries}
        onResult={(result, seqType) => {
          addAlignment(result, seqType, result.algorithm)
          if (result.warning) showHint(result.warning, 5000)
          setAlignModalOpen(false)
          setAlignInitialEntries(undefined)
        }}
        onReadAlignResult={(readId, refTabId, result, batchIndex, batchTotal) => {
          if (batchIndex === 0) {
            batchReadAlignIdsRef.current = []
            batchRefTabIdRef.current = refTabId
          }
          const raId = addReadAlignment(readId, refTabId, result)
          batchReadAlignIdsRef.current.push(raId)
          // When all reads in the batch are done, create a contig if 2+
          if (batchReadAlignIdsRef.current.length === batchTotal && batchTotal >= 2) {
            addContig(batchRefTabIdRef.current!, batchReadAlignIdsRef.current)
            batchReadAlignIdsRef.current = []
            batchRefTabIdRef.current = null
          }
        }}
      />
      <FetchModal
        open={fetchModalOpen}
        onClose={() => setFetchModalOpen(false)}
        onFetched={(doc) => { openDocumentState(doc); setFetchModalOpen(false) }}
      />
      <SessionExportModal
        open={sessionExportOpen}
        onClose={() => setSessionExportOpen(false)}
        onExport={handleSessionExport}
      />
      <SessionImportModal
        open={sessionImportOpen}
        filename={sessionImportData?.filename ?? ''}
        tabCount={sessionImportParsedRef.current?.tabs.length ?? 0}
        readCount={sessionImportParsedRef.current?.sequencingReads.length ?? 0}
        alignmentCount={(sessionImportParsedRef.current?.alignments.length ?? 0) + (sessionImportParsedRef.current?.readAlignments.length ?? 0)}
        onClose={() => { setSessionImportOpen(false); setSessionImportData(null); sessionImportParsedRef.current = null }}
        onReplace={handleSessionReplace}
        onMerge={handleSessionMerge}
      />
      <GelView
        open={gelModalOpen}
        onClose={() => setGelModalOpen(false)}
        onExportPrompt={(defaultName, onConfirm) => setFilenamePrompt({ defaultName, onConfirm: (name) => { onConfirm(name); setFilenamePrompt(null) } })}
      />
      </Suspense>
      {statsOpen && activeTabId && (
        <SequenceStatsPopover
          anchorRef={statsBtnRef}
          onClose={() => setStatsOpen(false)}
        />
      )}
      {(() => {
        const s = useEditorStore.getState()
        const kinds = Object.keys(bulkExportItems).filter(k => (bulkExportItems[k as ExportItemKind] ?? []).length > 0) as ExportItemKind[]
        const totalCount = Object.values(bulkExportItems).reduce((sum, ids) => sum + (ids?.length ?? 0), 0)
        const hasBulk = totalCount > 0
        const isMixed = kinds.length > 1
        const singleKind: ExportItemKind | 'mixed' = isMixed ? 'mixed' : (kinds[0] ?? getActiveItemKind(s))

        // Compute item names for file preview
        const itemNames: string[] = []
        for (const kind of kinds) {
          const ids = bulkExportItems[kind] ?? []
          const ext = formatsForKind(kind)[0]?.ext ?? ''
          for (const id of ids) {
            if (kind === 'sequence') {
              const tab = s.tabs.find(t => t.id === id)
              if (tab) itemNames.push(`${tab.doc.name}${ext}`)
            } else if (kind === 'read') {
              const readId = id.startsWith('seq_') ? id.slice(4) : id
              const read = s.sequencingReads.find(r => r.id === readId)
              if (read) itemNames.push(`${read.data.name.replace(/\s+/g, '_')}${ext}`)
            } else if (kind === 'alignment') {
              const align = s.alignments.find(a => a.id === id)
              if (align) itemNames.push(`${align.name.replace(/\s+/g, '_')}${ext}`)
            } else if (kind === 'read-alignment') {
              const ra = s.readAlignments.find(r => r.id === id)
              if (ra) itemNames.push(`${ra.name.replace(/\s+/g, '_')}${ext}`)
            } else if (kind === 'contig') {
              const contig = s.contigs.find(c => c.id === id)
              if (contig) itemNames.push(`${contig.name.replace(/\s+/g, '_')}${ext}`)
            }
          }
        }

        // Default name for single/combined export
        let defaultName: string
        if (hasBulk && totalCount > 1) {
          defaultName = `export_${totalCount}_items`
        } else if (hasBulk && totalCount === 1) {
          // Single item via context menu export
          defaultName = itemNames[0]?.replace(/\.[^.]+$/, '') ?? doc.name
        } else if (!hasBulk) {
          // Single active item
          const ak = getActiveItemKind(s)
          if (ak === 'read') {
            const read = s.sequencingReads.find(r => s.activeSequencingReadIds.includes(r.id))
            defaultName = read?.data.name.replace(/\s+/g, '_') ?? 'read'
          } else if (ak === 'alignment') {
            const align = s.alignments.find(a => a.id === s.activeAlignmentId)
            defaultName = align?.name.replace(/\s+/g, '_') ?? 'alignment'
          } else if (ak === 'read-alignment') {
            const ra = s.readAlignments.find(r => r.id === s.activeReadAlignmentId)
            defaultName = ra?.name.replace(/\s+/g, '_') ?? 'read_alignment'
          } else if (ak === 'contig') {
            const contig = s.contigs.find(c => c.id === s.activeContigId)
            defaultName = contig?.name.replace(/\s+/g, '_') ?? 'contig'
          } else {
            defaultName = doc.name
          }
        } else {
          defaultName = doc.name
        }

        // Kind counts for mixed summary
        const kindCounts: Partial<Record<ExportItemKind, number>> = {}
        for (const kind of kinds) {
          kindCounts[kind] = (bulkExportItems[kind] ?? []).length
        }

        return (
          <ExportModal
            open={exportModalOpen}
            defaultName={defaultName}
            annotationCount={singleKind === 'sequence' ? doc.annotations.length : 0}
            itemKind={hasBulk ? singleKind : getActiveItemKind(s)}
            kindCounts={isMixed ? kindCounts : undefined}
            count={hasBulk ? totalCount : 1}
            itemNames={hasBulk ? itemNames : undefined}
            onExport={handleExport}
            onClose={() => { setExportModalOpen(false); setBulkExportItems({}) }}
          />
        )
      })()}
      {filenamePrompt && (
        <FilenamePrompt
          defaultName={filenamePrompt.defaultName}
          onConfirm={filenamePrompt.onConfirm}
          onCancel={() => setFilenamePrompt(null)}
        />
      )}
    </div>
  )
}
