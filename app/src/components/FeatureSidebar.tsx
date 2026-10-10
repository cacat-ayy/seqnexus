/**
 * Right sidebar: the document's features, primers and CRISPR guides.
 *
 * The Features tab lists features grouped by type or sorted by position,
 * filtered by words and `key:value` terms (see utils/feature-filter.ts). The
 * list is a listbox the keyboard can run: the sequence editor leaves keys
 * aimed at it alone (utils/key-target.ts), so arrows, Delete and typing
 * here never reach the sequence. It follows the sequence too: rows under
 * the selection are marked, a feature clicked on the map or sequence is
 * scrolled into view, and hovering a row highlights the feature there.
 */

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, memo } from 'react'
import {
  useEditorStore, allSelectionsOf, joinedSegments, extraSelectionsOf, selectionSegments,
} from '../store'
import type { Annotation, Strand } from '../models/Annotation'
import { defaultColorForType } from '../models/Annotation'
import AnnotationTooltip from './AnnotationTooltip'
import FeatureBulkBar from './FeatureBulkBar'
import PrimerList from './primers/PrimerList'
import GuidePanel from './crispr/GuidePanel'
import PrimerWorkbench from './primers/PrimerWorkbench'
import ConfirmDialog from './ConfirmDialog'
import FeatureEditor from './features/FeatureEditor'
import FeatureRow from './features/FeatureRow'
import FeatureListOptions, { type FeatureListView } from './features/FeatureListOptions'
import { FeatureContextMenu, GroupContextMenu } from './features/FeatureMenus'
import { deleteFeaturesWithUndo, rowDomId, selectAndCenterFeature, selectFeature } from './features/feature-actions'
import { useListMultiSelect } from '../hooks/useListMultiSelect'
import {
  Plus, X, ChevronRight, ChevronDown, Eye, EyeOff, Search, PanelRightClose, ChevronsDownUp, ChevronsUpDown,
  SlidersHorizontal, MoreHorizontal, List, FlaskConical, Crosshair,
} from 'lucide-react'
import './FeatureSidebar.css'

import { defaultFeatureType, featureTypesFor, PRESET_COLORS } from '../utils/annotation-constants'
import { annotationBases, issueMessages, translationIssues, type IssueMessage } from '../utils/annotation-sequence'
import { isEmptyQuery, matchesFeatureQuery, parseFeatureQuery } from '../utils/feature-filter'
import { featureOverlaps } from '../utils/feature-location'
import { copyText } from '../utils/clipboard'
import { STORAGE_KEYS } from '../storage/keys'

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 500
const SIDEBAR_DEFAULT = 280
const STORAGE_KEY_WIDTH = STORAGE_KEYS.featureSidebarWidth

function loadView(): FeatureListView {
  try {
    return localStorage.getItem(STORAGE_KEYS.featureSidebarView) === 'position' ? 'position' : 'type'
  } catch {
    return 'type'
  }
}

/** Position order: by start, the longer of two that start together first. */
function byPosition(a: Annotation, b: Annotation): number {
  return a.start - b.start || (b.end - b.start) - (a.end - a.start) || a.name.localeCompare(b.name)
}

/**
 * The swatch of a type group: its one colour, or up to four of its colours
 * in slices when the features differ (the group used to show only its first
 * feature's colour, which said nothing about the rest).
 */
function groupSwatch(anns: readonly Annotation[]): React.CSSProperties {
  const colors = [...new Set(anns.map(a => a.color.toLowerCase()))].slice(0, 4)
  if (colors.length <= 1) return { backgroundColor: colors[0] }
  const step = 100 / colors.length
  return { background: `conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})` }
}

/**
 * Whether the tabs, at their natural width, overflow the header: if so they
 * show icons. Measured from a hidden copy laid out at full width, because
 * the real tabs, once they are icons, no longer say how wide the words were.
 */
function useCompactTabs(
  tabsRef: React.RefObject<HTMLElement | null>,
  measureRef: React.RefObject<HTMLElement | null>,
  contentKey: string,
): boolean {
  const [compact, setCompact] = useState(false)
  useLayoutEffect(() => {
    const tabs = tabsRef.current
    const measure = measureRef.current
    if (!tabs || !measure) return
    const check = () => setCompact(measure.scrollWidth > tabs.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(check)
    ro.observe(tabs)
    return () => ro.disconnect()
  }, [tabsRef, measureRef, contentKey])
  return compact
}

interface FeatureSidebarProps {
  open: boolean
  onClose: () => void
}

function FeatureSidebar({ open, onClose }: FeatureSidebarProps) {
  const doc = useEditorStore(s => s.doc)
  const annotations = doc.annotations
  const sequence = doc.sequence
  const seqLen = sequence.length
  const alphabet = sequence.alphabet
  const readOnly = useEditorStore(s => s.readOnly)
  const selection = useEditorStore(s => s.selection)
  const extraSelections = useEditorStore(extraSelectionsOf)
  const updateAnnotations = useEditorStore(s => s.updateAnnotations)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const editAnnotationId = useEditorStore(s => s.editAnnotationId)
  const setEditAnnotation = useEditorStore(s => s.setEditAnnotation)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const toggleAnnotationVisibility = useEditorStore(s => s.toggleAnnotationVisibility)
  const setTypeVisibility = useEditorStore(s => s.setTypeVisibility)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  /** A rename asked for (F2, the menu): the editor opens with its name selected. */
  const [renameRequest, setRenameRequest] = useState<{ id: string; n: number } | null>(null)
  const openEditor = useCallback((id: string | null, rename = false) => {
    setExpandedId(id)
    setRenameRequest(id && rename ? { id, n: Date.now() } : null)
  }, [])

  const [filter, setFilter] = useState('')
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set())
  const [view, setViewState] = useState<FeatureListView>(loadView)
  const setView = useCallback((v: FeatureListView) => {
    setViewState(v)
    try { localStorage.setItem(STORAGE_KEYS.featureSidebarView, v) } catch { /* private mode */ }
  }, [])
  const [inSelection, setInSelection] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsBtnRef = useRef<HTMLButtonElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /** The keyboard's row in the list. */
  const [activeId, setActiveId] = useState<string | null>(null)
  /** The last move was a key, so the active row shows its ring. */
  const [kbd, setKbd] = useState(false)

  /**
   * Coalescing key for the group colour pickers.
   *
   * Minted fresh each time a picker is grabbed or focused, so one drag folds
   * into a single undo entry while two consecutive drags stay independently
   * undoable.
   */
  const colorDragKey = useRef<string | null>(null)
  const beginColorDrag = useCallback((scope: string) => {
    colorDragKey.current = `color:${scope}:${Date.now()}`
  }, [])
  const groupColorInputs = useRef(new Map<string, HTMLInputElement>())

  // Sidebar width with persistence
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH)
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, parseInt(saved, 10) || SIDEBAR_DEFAULT)) : SIDEBAR_DEFAULT
  })

  // Resize drag state
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    resizing.current = true
    startX.current = e.clientX
    startWidth.current = width
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [width])

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    // Dragging left increases width (sidebar is on the right)
    const delta = startX.current - e.clientX
    const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth.current + delta))
    setWidth(newWidth)
  }, [])

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return
    resizing.current = false
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    const delta = startX.current - e.clientX
    const finalWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth.current + delta))
    localStorage.setItem(STORAGE_KEY_WIDTH, String(finalWidth))
  }, [])

  // Features, Primers and Guides share the sidebar as tabs; the Primers tab
  // has a list view and the design workbench. Both live in the store so the
  // toolbar, panel bar and canvas can send the user to either.
  const tab = useEditorStore(s => s.sidebarTab)
  const switchTab = useEditorStore(s => s.setSidebarTab)
  const primerView = useEditorStore(s => s.primerView)
  const setPrimerView = useEditorStore(s => s.setPrimerView)
  const [addingPrimer, setAddingPrimer] = useState(false)
  const primerCount = useEditorStore(s => s.doc.primers?.length ?? 0)
  const isProteinDoc = alphabet === 'protein'
  const guideCount = useEditorStore(s => s.guideResults.length)
  const activeTabId = useEditorStore(s => s.activeTabId)

  // When editAnnotationId is set from outside, expand that annotation
  useEffect(() => {
    if (editAnnotationId) {
      switchTab('features')
      openEditor(editAnnotationId)
      setActiveId(editAnnotationId)
      setEditAnnotation(null)
      requestAnimationFrame(() => document.getElementById(rowDomId(editAnnotationId))?.scrollIntoView?.({ block: 'nearest' }))
    }
  }, [editAnnotationId, setEditAnnotation, switchTab, openEditor])

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ ann: Annotation; x: number; y: number } | null>(null)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Hovering a row shows its card here and highlights it on the map and sequence. */
  const handleHover = useCallback((e: React.MouseEvent | null, ann: Annotation | null) => {
    if (tooltipTimer.current) { clearTimeout(tooltipTimer.current); tooltipTimer.current = null }
    setHoveredAnnotation(ann?.id ?? null)
    if (!e || !ann) { setTooltip(null); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    tooltipTimer.current = setTimeout(() => {
      setTooltip({ ann, x: rect.left, y: rect.bottom + 4 })
    }, 400)
  }, [setHoveredAnnotation])
  // Leave nothing highlighted on the canvas when the sidebar goes away.
  useEffect(() => {
    if (open) return
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setTooltip(null)
    if (useEditorStore.getState().hoveredAnnotationId) setHoveredAnnotation(null)
  }, [open, setHoveredAnnotation])

  // Add new annotation state
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('New Feature')
  const [newType, setNewType] = useState('misc_feature')
  const [newStart, setNewStart] = useState(1)
  const [newEnd, setNewEnd] = useState(100)
  // The parts of a joined feature, from a selection of several ranges; null
  // for a feature in one piece, which the Range inputs describe.
  const [newParts, setNewParts] = useState<[number, number][] | null>(null)
  const [newStrand, setNewStrand] = useState<Strand>(1)
  const [newColor, setNewColor] = useState(() => defaultColorForType('misc_feature'))
  // The types on offer follow the document: a protein's features are regions
  // and sites, not promoters. The form's type follows along when the open
  // document changes alphabet, so a DNA type is never offered on a protein.
  const FEATURE_TYPES = featureTypesFor(alphabet)
  useEffect(() => {
    if (!FEATURE_TYPES.includes(newType)) {
      const t = defaultFeatureType(alphabet)
      setNewType(t)
      setNewColor(defaultColorForType(t))
    }
  }, [alphabet, FEATURE_TYPES, newType])
  // Update color when type changes (only if user hasn't manually picked a color)
  const [colorManuallySet, setColorManuallySet] = useState(false)
  const handleNewTypeChange = useCallback((type: string) => {
    setNewType(type)
    if (!colorManuallySet) setNewColor(defaultColorForType(type))
  }, [colorManuallySet])

  // Watch for external "add annotation" requests (e.g. from context menu).
  // The form lives on the Features tab, so a request made while the Primers
  // tab is showing switches back to Features, as an edit request does.
  const requestAddAnnotation = useEditorStore(s => s.requestAddAnnotation)
  const setRequestAddAnnotation = useEditorStore(s => s.setRequestAddAnnotation)
  useEffect(() => {
    if (requestAddAnnotation && open) {
      switchTab('features')
      const state = useEditorStore.getState()
      const sel = state.selection
      const a = Math.min(sel.anchor, sel.caret)
      const b = Math.max(sel.anchor, sel.caret)
      // Several ranges make one joined feature, its parts in the order the
      // selection reads them: the same order a GenBank join() is written.
      const ranges = allSelectionsOf(state)
      const seq = state.doc.sequence
      const parts = ranges.length > 1 ? joinedSegments(ranges, seq.topology, seq.length) : null
      setNewParts(parts)
      if (parts) {
        setNewStart(parts[0][0] + 1)
        setNewEnd(parts[parts.length - 1][1])
      } else if (b > a) {
        setNewStart(a + 1)
        setNewEnd(b)
      }
      setAdding(true)
      setRequestAddAnnotation(false)
    }
  }, [requestAddAnnotation, open, setRequestAddAnnotation, switchTab])

  // Menus
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; ann: Annotation } | null>(null)
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; type: string } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, ann: Annotation) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveId(ann.id)
    // The menu replaces the hover card: one pending or showing would sit
    // under the menu, saying the same thing.
    if (tooltipTimer.current) { clearTimeout(tooltipTimer.current); tooltipTimer.current = null }
    setTooltip(null)
    setCtxMenu({ x: e.clientX, y: e.clientY, ann })
  }, [])

  const handleAdd = useCallback(() => {
    const id = `ann_${Date.now()}`
    const start = newParts ? newParts[0][0] : Math.max(0, Math.min(newStart - 1, seqLen - 1))
    const end = newParts ? newParts[newParts.length - 1][1] : Math.max(1, Math.min(newEnd, seqLen))
    addAnnotation({
      id,
      name: newName.trim() || 'Untitled',
      type: newType,
      start,
      end,
      strand: newStrand,
      color: newColor,
      ...(newParts ? { segments: newParts } : {}),
    })
    setAdding(false)
    setNewParts(null)
    setColorManuallySet(false)
    openEditor(id)
    setActiveId(id)
  }, [newName, newType, newStart, newEnd, newParts, newStrand, newColor, seqLen, addAnnotation, openEditor])

  const toggleTypeCollapse = useCallback((type: string) => {
    setCollapsedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  // Features of the document (not ORF or primer display overlays)
  const userAnnotations = useMemo(() =>
    annotations.filter(a => !a.id.startsWith('_orf_')),
    [annotations]
  )

  // What the selection covers: its ranges, or the base after the caret.
  const hereRanges = useMemo(() => {
    const ranges = [selection, ...extraSelections].flatMap(s => selectionSegments(s, sequence.topology, seqLen))
    if (ranges.length > 0 || seqLen === 0) return ranges
    const c = Math.min(selection.caret, seqLen - 1)
    return [[c, c + 1] as [number, number]]
  }, [selection, extraSelections, sequence.topology, seqLen])
  const hereIds = useMemo(
    () => new Set(userAnnotations.filter(a => featureOverlaps(a, hereRanges, seqLen)).map(a => a.id)),
    [userAnnotations, hereRanges, seqLen],
  )

  // What a CDS gets wrong, for the warning on its row. Keyed on the document:
  // base edits change the sequence in place.
  const issuesById = useMemo(() => {
    const map = new Map<string, IssueMessage[]>()
    if (alphabet === 'protein') return map
    for (const a of userAnnotations) {
      if (a.type !== 'CDS') continue
      const msgs = issueMessages(translationIssues(a, doc.sequence))
      if (msgs.length > 0) map.set(a.id, msgs)
    }
    return map
  }, [userAnnotations, doc, alphabet])

  const query = useMemo(() => parseFeatureQuery(filter), [filter])
  const filteredAnnotations = useMemo(() => {
    const all = isEmptyQuery(query) ? userAnnotations : userAnnotations.filter(a => matchesFeatureQuery(a, query, seqLen))
    return inSelection ? all.filter(a => hereIds.has(a.id)) : all
  }, [userAnnotations, query, seqLen, inSelection, hereIds])

  // Group by type: larger groups first, then by name; within a group by position.
  const grouped = useMemo(() => {
    const map = new Map<string, Annotation[]>()
    for (const a of filteredAnnotations) {
      const list = map.get(a.type)
      if (list) list.push(a)
      else map.set(a.type, [a])
    }
    for (const list of map.values()) list.sort(byPosition)
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  }, [filteredAnnotations])

  const sorted = useMemo(() => [...filteredAnnotations].sort(byPosition), [filteredAnnotations])

  const allCollapsed = grouped.length > 0 && grouped.every(([t]) => collapsedTypes.has(t))

  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])

  // Multi-selection. The order given to the hook must match the rendered order,
  // or Shift-ranges would select a different run than the one highlighted.
  const orderedIds = useMemo(
    () => (view === 'position' ? sorted.map(a => a.id) : grouped.flatMap(([, anns]) => anns.map(a => a.id))),
    [view, sorted, grouped],
  )
  /** The rows on screen, in order: what the arrow keys walk. */
  const visibleAnns = useMemo(
    () => (view === 'position' ? sorted : grouped.flatMap(([type, anns]) => (collapsedTypes.has(type) ? [] : anns))),
    [view, sorted, grouped, collapsedTypes],
  )
  const { selectedIds, handleItemClick, clear: clearSelection, selectAll } =
    useListMultiSelect(orderedIds)

  const selectedAnnotations = useMemo(
    () => filteredAnnotations.filter(a => selectedIds.has(a.id)),
    [filteredAnnotations, selectedIds],
  )

  /** Features waiting for the confirm dialog before they are deleted. */
  const [pendingDelete, setPendingDelete] = useState<Annotation[] | null>(null)

  const deleteNow = useCallback((anns: Annotation[]) => {
    if (anns.length === 0) return
    // Keep the keyboard on the row after the last one deleted.
    const gone = new Set(anns.map(a => a.id))
    if (activeId && gone.has(activeId)) {
      const idx = visibleAnns.findIndex(a => a.id === activeId)
      const next = visibleAnns.slice(idx + 1).find(a => !gone.has(a.id))
        ?? visibleAnns.slice(0, idx).reverse().find(a => !gone.has(a.id))
      setActiveId(next?.id ?? null)
    }
    if (expandedId && gone.has(expandedId)) openEditor(null)
    deleteFeaturesWithUndo(anns)
    clearSelection()
  }, [activeId, visibleAnns, expandedId, openEditor, clearSelection])

  const scrollToRow = useCallback((id: string) => {
    requestAnimationFrame(() => document.getElementById(rowDomId(id))?.scrollIntoView?.({ block: 'nearest' }))
  }, [])

  // A feature clicked on the map or in the sequence selects exactly its span:
  // bring its row into view and make it the keyboard's row.
  useEffect(() => {
    if (selection.anchor === selection.caret) return
    const lo = Math.min(selection.anchor, selection.caret)
    const hi = Math.max(selection.anchor, selection.caret)
    const match = useEditorStore.getState().doc.annotations.find(a => !a.id.startsWith('_') && (
      a.start <= a.end ? a.start === lo && a.end === hi : a.start === selection.anchor && a.end === selection.caret
    ))
    if (!match) return
    setActiveId(match.id)
    scrollToRow(match.id)
  }, [selection, scrollToRow])

  const handleRowClick = useCallback((e: React.MouseEvent, ann: Annotation) => {
    setActiveId(ann.id)
    setKbd(false)
    handleItemClick(e, ann.id, () => selectFeature(ann))
  }, [handleItemClick])

  const handleRowDoubleClick = useCallback((ann: Annotation) => {
    setExpandedId(prev => (prev === ann.id ? null : ann.id))
    setRenameRequest(null)
    selectAndCenterFeature(ann)
  }, [])

  const handleToggleHidden = useCallback((ann: Annotation) => toggleAnnotationVisibility(ann.id), [toggleAnnotationVisibility])

  /** Open the context menu of the keyboard's row, beside it. */
  const openMenuForActive = useCallback((ann: Annotation) => {
    const el = document.getElementById(rowDomId(ann.id))
    const rect = el?.getBoundingClientRect()
    setCtxMenu({ x: rect ? rect.left + 24 : 0, y: rect ? rect.bottom : 0, ann })
  }, [])

  // --- Keyboard ---
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // Inside an open editor the fields keep their keys. Escape (and Enter in
    // the name) closes it and hands the keyboard back to the list.
    if (target.closest('.ft-editor')) {
      const commitOnEnter = e.key === 'Enter' && target.dataset.commitOnEnter !== undefined
      if (e.key === 'Escape' || commitOnEnter) {
        e.preventDefault()
        e.stopPropagation()
        openEditor(null)
        listRef.current?.focus()
      }
      return
    }
    // A button in a row or group header runs its own Enter and Space.
    if (target !== e.currentTarget && (e.key === 'Enter' || e.key === ' ')) return

    const ctrl = e.ctrlKey || e.metaKey
    const ids = visibleAnns.map(a => a.id)
    const idx = activeId ? ids.indexOf(activeId) : -1
    const active = idx >= 0 ? visibleAnns[idx] : null
    const store = useEditorStore.getState()

    const moveTo = (i: number) => {
      if (ids.length === 0) return
      const next = visibleAnns[Math.max(0, Math.min(ids.length - 1, i))]
      setActiveId(next.id)
      if (e.shiftKey) handleItemClick({ ctrlKey: false, metaKey: false, shiftKey: true }, next.id)
      else handleItemClick({ ctrlKey: false, metaKey: false, shiftKey: false }, next.id, () => selectFeature(next))
      scrollToRow(next.id)
    }

    let handled = true
    if (e.key === 'ArrowDown' && !ctrl) moveTo(idx < 0 ? 0 : idx + 1)
    else if (e.key === 'ArrowUp' && !ctrl) moveTo(idx < 0 ? 0 : idx - 1)
    else if (e.key === 'PageDown') moveTo(idx + 10)
    else if (e.key === 'PageUp') moveTo(idx - 10)
    else if (e.key === 'Home') moveTo(0)
    else if (e.key === 'End') moveTo(ids.length - 1)
    else if (e.key === 'Enter' && active) openEditor(expandedId === active.id ? null : active.id)
    else if (e.key === 'F2' && active && !readOnly) openEditor(active.id, true)
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
      const targets = selectedAnnotations.length > 0 ? selectedAnnotations : active ? [active] : []
      if (targets.length > 1) setPendingDelete(targets)
      else deleteNow(targets)
    } else if (e.key === 'Escape') {
      if (expandedId) openEditor(null)
      else if (selectedIds.size > 0) clearSelection()
      else handled = false
    } else if (e.key === ' ' && active) {
      handleItemClick({ ctrlKey: true, metaKey: false, shiftKey: false }, active.id)
    } else if (ctrl && (e.key === 'a' || e.key === 'A')) {
      selectAll()
    } else if (ctrl && (e.key === 'c' || e.key === 'C') && active) {
      const b = annotationBases(active, store.doc.sequence)
      copyText(b, `Copied ${b.length} ${isProteinDoc ? 'aa' : 'bp'} from "${active.name}"`)
    } else if (ctrl && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      store.undo()
    } else if (ctrl && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      store.redo()
    } else if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && active) {
      openMenuForActive(active)
    } else if (e.key.length === 1 && !ctrl && !e.altKey && e.key !== ' ') {
      // Typing in the list types into the filter.
      filterRef.current?.focus()
      setFilter(f => f + e.key)
    } else {
      handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
      setKbd(true)
    }
  }

  // --- Header tabs: words while they fit, icons when they do not ---
  const tabsRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const tabDefs = [
    { id: 'features' as const, label: 'Features', Icon: List, count: userAnnotations.length as number | null },
    { id: 'primers' as const, label: 'Primers', Icon: FlaskConical, count: primerCount as number | null },
    ...(isProteinDoc ? [] : [{ id: 'guides' as const, label: 'Guides', Icon: Crosshair, count: guideCount > 0 ? guideCount : null }]),
  ]
  const compactTabs = useCompactTabs(tabsRef, measureRef, tabDefs.map(t => `${t.label}${t.count}`).join('|') + `|${width}`)

  if (!open) return null

  const featureIssues = (id: string) => issuesById.get(id)
  const groupMenuAnns = groupMenu ? grouped.find(([t]) => t === groupMenu.type)?.[1] ?? [] : []
  const nonDefaultOptions = view !== 'type' || inSelection

  const renderRow = (a: Annotation) => (
    <FeatureRow
      key={a.id}
      ann={a}
      seqLen={seqLen}
      alphabet={alphabet}
      issues={featureIssues(a.id)}
      expanded={expandedId === a.id}
      hidden={hiddenSet.has(a.id)}
      picked={selectedIds.has(a.id)}
      active={activeId === a.id}
      here={hereIds.has(a.id)}
      hovered={hoveredAnnotationId === a.id}
      showLocation={view === 'position'}
      onClick={handleRowClick}
      onDoubleClick={handleRowDoubleClick}
      onContextMenu={handleContextMenu}
      onToggleHidden={handleToggleHidden}
      onHover={handleHover}
    >
      {expandedId === a.id && (
        <FeatureEditor
          annotation={a}
          featureTypes={FEATURE_TYPES}
          readOnly={readOnly}
          focusName={renameRequest?.id === a.id ? renameRequest.n : 0}
          onDone={() => { openEditor(null); listRef.current?.focus() }}
          onDelete={() => deleteNow([a])}
        />
      )}
    </FeatureRow>
  )

  return (
    <>
      {/* Resize handle */}
      <div
        className="fs-resize-handle"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
      />
      <aside className="feature-sidebar" style={{ width }}>
        {/* Header */}
        <div className="fs-header">
          <div ref={tabsRef} className={`fs-tabs ${compactTabs ? 'compact' : ''}`} role="tablist" aria-label="Sidebar">
            {tabDefs.map(({ id, label, Icon, count }) => (
              <button
                key={id}
                className={`fs-tab ${tab === id ? 'active' : ''}`}
                role="tab"
                aria-selected={tab === id}
                aria-label={compactTabs ? label : undefined}
                title={compactTabs ? label : undefined}
                onClick={() => switchTab(id)}
              >
                {compactTabs && <Icon size={14} className="fs-tab-icon" />}
                {!compactTabs && <span className="fs-title">{label}</span>}
                {count !== null && <span className="fs-count">{count}</span>}
              </button>
            ))}
          </div>
          {/* The tabs as words, laid out unseen, to know whether they fit. */}
          <div ref={measureRef} className="fs-tabs fs-tabs-measure" aria-hidden>
            {tabDefs.map(({ id, label, count }) => (
              <span key={id} className="fs-tab">
                <span className="fs-title">{label}</span>
                {count !== null && <span className="fs-count">{count}</span>}
              </span>
            ))}
          </div>
          {/* Only the close button lives up here. Each tab's own actions sit
              in that tab's filter row, so three tabs and their counts never
              push a button off the edge of a narrow sidebar. */}
          <div className="fs-header-actions">
            <button
              className="fs-icon-btn"
              onClick={onClose}
              title="Close sidebar"
            >
              <PanelRightClose size={14} />
            </button>
          </div>
        </div>

        {tab === 'guides' ? (
          <GuidePanel />
        ) : tab === 'primers' ? (
          <>
            <div className="fs-segmented" role="tablist" aria-label="Primers view">
              <button
                role="tab"
                aria-selected={primerView === 'list'}
                className={primerView === 'list' ? 'active' : ''}
                onClick={() => setPrimerView('list')}
              >
                Saved
              </button>
              <button
                role="tab"
                aria-selected={primerView === 'design'}
                className={primerView === 'design' ? 'active' : ''}
                onClick={() => setPrimerView('design')}
              >
                Design
              </button>
            </div>
            {primerView === 'design'
              // Keyed by tab: a target or excluded region from another
              // sequence means nothing here.
              ? <PrimerWorkbench key={activeTabId ?? 'none'} />
              : <PrimerList adding={addingPrimer} onAddingChange={setAddingPrimer} />}
          </>
        ) : (
        <>
        {selectedAnnotations.length > 0 && (
          <FeatureBulkBar
            selected={selectedAnnotations}
            onClear={clearSelection}
            onRequestDelete={() => setPendingDelete(selectedAnnotations)}
          />
        )}

        <ConfirmDialog
          open={pendingDelete !== null}
          title="Delete features"
          message={`Delete ${pendingDelete?.length ?? 0} feature${pendingDelete?.length === 1 ? '' : 's'}? This can be undone.`}
          buttons={[
            { label: 'Cancel', value: 'cancel' },
            { label: 'Delete', value: 'delete', variant: 'danger' },
          ]}
          onResult={value => {
            if (value === 'delete' && pendingDelete) deleteNow(pendingDelete)
            setPendingDelete(null)
          }}
        />

        {/* Filter, and this tab's actions */}
        <div className="fs-search">
          <Search size={12} className="fs-search-icon" />
          <input
            ref={filterRef}
            className="fs-search-input"
            placeholder="Filter features…"
            aria-label="Filter features"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => {
              // Down or Enter goes on into the list; Escape empties the filter.
              if ((e.key === 'ArrowDown' || e.key === 'Enter') && visibleAnns.length > 0) {
                e.preventDefault()
                if (!activeId || !visibleAnns.some(a => a.id === activeId)) setActiveId(visibleAnns[0].id)
                setKbd(true)
                listRef.current?.focus()
              } else if (e.key === 'Escape' && filter) {
                e.preventDefault()
                setFilter('')
              }
            }}
            spellCheck={false}
          />
          {filter && (
            <button className="fs-search-clear" onClick={() => setFilter('')} title="Clear filter">
              <X size={11} />
            </button>
          )}
          <button
            ref={optionsBtnRef}
            className={`fs-icon-btn ${optionsOpen ? 'active' : ''} ${nonDefaultOptions ? 'flagged' : ''}`}
            onClick={() => setOptionsOpen(v => !v)}
            title="Layout and filter options"
            aria-expanded={optionsOpen}
            aria-haspopup="dialog"
          >
            <SlidersHorizontal size={13} />
          </button>
          {view === 'type' && (
            <button
              className="fs-icon-btn"
              onClick={() => setCollapsedTypes(allCollapsed ? new Set() : new Set(grouped.map(([type]) => type)))}
              title={allCollapsed ? 'Expand all groups' : 'Collapse all groups'}
              disabled={grouped.length === 0}
            >
              {allCollapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
            </button>
          )}
          <button
            className={`fs-icon-btn ${adding ? 'active' : ''}`}
            onClick={() => { setNewParts(null); setAdding(v => !v) }}
            title={adding ? 'Cancel new feature' : 'Add feature'}
            disabled={readOnly}
          >
            {adding ? <X size={14} /> : <Plus size={14} />}
          </button>
          {optionsOpen && (
            <FeatureListOptions
              view={view}
              onViewChange={setView}
              inSelection={inSelection}
              onInSelectionChange={setInSelection}
              onInsertTerm={term => setFilter(f => (f.trim() ? `${f.trim()} ${term}` : term))}
              onClose={() => setOptionsOpen(false)}
              triggerRef={optionsBtnRef}
            />
          )}
        </div>

        {/* Add new annotation form */}
        {adding && (
          <div className="ft-editor ft-add-form fs-add-form">
            <div className="ft-row">
              <label>Name</label>
              <input
                className="input ft-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
              />
            </div>
            <div className="ft-row">
              <label>Type</label>
              <select className="select ft-select" value={newType} onChange={e => handleNewTypeChange(e.target.value)}>
                {FEATURE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {newParts ? (
              <div className="ft-row">
                <label>Parts</label>
                <div className="ft-join">
                  <span className="ft-join-text" title="Joined parts, in reading order">
                    {newParts.map(([s, e]) => `${s + 1}..${e}`).join(', ')}
                  </span>
                  <button
                    className="btn btn-sm"
                    title="Annotate the whole span instead, from the first part to the last"
                    onClick={() => setNewParts(null)}
                  >One Span</button>
                </div>
              </div>
            ) : (
            <div className="ft-row">
              <label>Range</label>
              <div className="ft-range-inputs">
                <input
                  className="input ft-input ft-num"
                  type="number"
                  min={1}
                  max={seqLen}
                  value={newStart}
                  onChange={e => setNewStart(parseInt(e.target.value) || 1)}
                />
                <span>..</span>
                <input
                  className="input ft-input ft-num"
                  type="number"
                  min={1}
                  max={seqLen}
                  value={newEnd}
                  onChange={e => setNewEnd(parseInt(e.target.value) || 1)}
                />
              </div>
            </div>
            )}
            <div className="ft-row">
              <label>Strand</label>
              <select
                className="select ft-select"
                value={newStrand}
                onChange={e => setNewStrand(parseInt(e.target.value) as Strand)}
              >
                <option value={1}>Forward (+)</option>
                <option value={-1}>Reverse (−)</option>
                <option value={0}>None</option>
              </select>
            </div>
            <div className="ft-row">
              <label>Color</label>
              <div className="ft-color-row">
                <div className="ft-color-presets">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      className={`ft-color-dot ${c === newColor ? 'active' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => { setNewColor(c); setColorManuallySet(true) }}
                    />
                  ))}
                  <label className="ft-color-dot ft-color-custom" style={{ backgroundColor: newColor }} title="Custom color">
                    <input
                      type="color"
                      value={newColor}
                      onChange={e => { setNewColor(e.target.value); setColorManuallySet(true) }}
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="ft-actions">
              <button className="btn btn-primary btn-sm" onClick={handleAdd}>Add Feature</button>
              <button className="btn btn-sm" onClick={() => { setAdding(false); setNewParts(null) }}>Cancel</button>
            </div>
          </div>
        )}

        {/* The list */}
        <div
          ref={listRef}
          className={`fs-list ${kbd ? 'kbd' : ''}`}
          role="listbox"
          aria-label="Features"
          aria-multiselectable
          tabIndex={0}
          aria-activedescendant={activeId && visibleAnns.some(a => a.id === activeId) ? rowDomId(activeId) : undefined}
          onKeyDown={handleListKeyDown}
          onMouseDown={() => setKbd(false)}
        >
          {view === 'position' ? sorted.map(renderRow) : grouped.map(([type, anns]) => {
            const isCollapsed = collapsedTypes.has(type)
            const allHidden = anns.every(a => hiddenSet.has(a.id))
            const someHidden = anns.some(a => hiddenSet.has(a.id))
            const groupColor = anns[0]?.color ?? defaultColorForType(type)

            return (
              <div key={type} className="fs-group" role="group" aria-label={type}>
                <div
                  className="fs-group-header"
                  onContextMenu={e => {
                    e.preventDefault()
                    setGroupMenu({ x: e.clientX, y: e.clientY, type })
                  }}
                >
                  <span className="fs-group-swatch" style={groupSwatch(anns)} aria-hidden />
                  {/* Opened from the group's menu ("Recolor All"). A colour
                      input fires on every frame of a drag; the key minted per
                      interaction makes the whole drag one undo step. */}
                  <input
                    type="color"
                    className="fs-group-color-input"
                    tabIndex={-1}
                    aria-label={`Color for all ${type}`}
                    ref={el => {
                      if (el) groupColorInputs.current.set(type, el)
                      else groupColorInputs.current.delete(type)
                    }}
                    value={groupColor}
                    onFocus={() => beginColorDrag(type)}
                    onChange={e => {
                      updateAnnotations(
                        anns.map(a => a.id),
                        { color: e.target.value },
                        { coalesceKey: colorDragKey.current ?? undefined },
                      )
                    }}
                  />
                  <button
                    className="fs-group-toggle"
                    tabIndex={-1}
                    onClick={() => toggleTypeCollapse(type)}
                    aria-expanded={!isCollapsed}
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    <span className="fs-group-name">{type}</span>
                    <span className="fs-group-count">{anns.length}</span>
                  </button>
                  <button
                    className="fs-eye-btn fs-group-more"
                    tabIndex={-1}
                    title={`Actions for all ${type}`}
                    aria-haspopup="menu"
                    onClick={e => {
                      const r = e.currentTarget.getBoundingClientRect()
                      setGroupMenu({ x: r.left, y: r.bottom + 2, type })
                    }}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                  <button
                    className={`fs-eye-btn ${allHidden ? 'hidden' : someHidden ? 'partial' : ''}`}
                    tabIndex={-1}
                    onClick={() => setTypeVisibility(type, allHidden)}
                    title={allHidden ? `Show all ${type}` : `Hide all ${type}`}
                  >
                    {allHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>

                {!isCollapsed && anns.map(renderRow)}
              </div>
            )
          })}

          {filteredAnnotations.length === 0 && !adding && (
            <div className="ft-empty">
              {userAnnotations.length === 0
                ? 'No features yet. Click + above to add one.'
                : inSelection && isEmptyQuery(query)
                  ? 'No features where the selection is.'
                  : 'No matching features.'}
            </div>
          )}
        </div>
        </>
        )}

        {/* Hover tooltip, never while a menu is open over the rows */}
        {tooltip && !ctxMenu && !groupMenu && (
          <AnnotationTooltip
            ann={tooltip.ann}
            sequence={sequence}
            x={tooltip.x}
            y={tooltip.y}
          />
        )}

        {ctxMenu && (
          <FeatureContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            ann={ctxMenu.ann}
            hidden={hiddenSet.has(ctxMenu.ann.id)}
            readOnly={readOnly}
            onClose={() => { setCtxMenu(null); setTooltip(null) }}
            onEdit={() => openEditor(ctxMenu.ann.id)}
            onRename={() => openEditor(ctxMenu.ann.id, true)}
            onDelete={() => deleteNow([ctxMenu.ann])}
            onDuplicated={id => { setActiveId(id); scrollToRow(id) }}
          />
        )}

        {groupMenu && (
          <GroupContextMenu
            x={groupMenu.x}
            y={groupMenu.y}
            type={groupMenu.type}
            anns={groupMenuAnns}
            allHidden={groupMenuAnns.length > 0 && groupMenuAnns.every(a => hiddenSet.has(a.id))}
            readOnly={readOnly}
            onClose={() => { setGroupMenu(null); setTooltip(null) }}
            onRecolor={() => {
              const input = groupColorInputs.current.get(groupMenu.type)
              if (!input) return
              beginColorDrag(groupMenu.type)
              try { input.showPicker() } catch { input.click() }
            }}
            onPickAll={() => {
              for (const a of groupMenuAnns) {
                if (!selectedIds.has(a.id)) handleItemClick({ ctrlKey: true, metaKey: false, shiftKey: false }, a.id)
              }
            }}
            onDeleteAll={() => setPendingDelete([...groupMenuAnns])}
          />
        )}
      </aside>
    </>
  )
}

/** Memoised: re-rendered on every App state change despite stable props. */
export default memo(FeatureSidebar)
