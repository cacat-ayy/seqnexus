/**
 * Circular plasmid map view.
 *
 * The drawing itself lives in `src/plasmid/`: this component gathers state,
 * builds a scene, and hands it to an emitter. It used to issue every canvas
 * call inline, which is why it could not be exported and why each of the four
 * pointer handlers recomputed the geometry by hand.
 */

import { useRef, useEffect, useCallback, useMemo, useState, memo } from 'react'
import { Download, Maximize2 } from 'lucide-react'
import {
  useEditorStore, isOriginSpanningSelection, selectionLength, extraSelectionsOf, selectedRanges,
  selectionSegments, type Selection,
} from '../store'
import { keyFromAutoId } from '../utils/auto-annotations'
import { keyFromOrfId } from '../utils/orf-features'
import AnnotationTooltip from './AnnotationTooltip'
import { useDelayedHover, type HoverTarget } from '../hooks/useDelayedHover'
import EnzymeTooltip from './EnzymeTooltip'
import { cutCountsByEnzyme, type GroupedCutSite } from '../enzymes/grouping'
import { methylationContextOf } from '../enzymes/methylation'
import SequenceContextMenu from './SequenceContextMenu'
import ConfirmDialog from './ConfirmDialog'
import PrimerTooltip from './primers/PrimerTooltip'
import { isPrimerItemId } from '../primers/display'

import { buildPlasmidScene, type PlasmidScene, type PlasmidSceneInput } from '../plasmid/scene'
import { guideKey } from '../utils/guide-features'
import { renderSceneToCanvas, type Viewport } from '../plasmid/renderCanvas'
import { FIGURE_SIZE, figureSceneInput, type MapFigureOptions } from '../plasmid/exportImage'
import MapFigureDialog from './MapFigureDialog'
import { resolvePlasmidColors, type PlasmidColors } from '../plasmid/styles'
import { angleToPos, normalizeAngle, arcSelection } from '../plasmid/geometry'
import { hitTestScene } from '../plasmid/hit'
import { usePlasmidSceneData } from '../plasmid/usePlasmidSceneData'
import { measureText } from '../utils/measure-text'

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const FIT: Viewport = { scale: 1, tx: 0, ty: 0 }

/** Where a position sits on the map, in radians clockwise from the top. */
const siteAngle = (pos: number, length: number) => (pos / Math.max(1, length)) * 2 * Math.PI

interface PlasmidMapProps {
  onFindRequest?: () => void
  onEditFeature?: (annId: string) => void
  /** Open the add-annotation form for the current selection. */
  onAnnotateRequest?: () => void
  /** Ask App for a filename before writing a file, as the gel view does. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

function PlasmidMap(_props: PlasmidMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const doc = useEditorStore(s => s.doc)
  const allEnzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const selection = useEditorStore(s => s.selection)
  const extraSelections = useEditorStore(extraSelectionsOf)
  const search = useEditorStore(s => s.search)
  const setSelection = useEditorStore(s => s.setSelection)
  const setCaret = useEditorStore(s => s.setCaret)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const highlightRanges = useEditorStore(s => s.highlightRanges)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)
  const removeAnnotation = useEditorStore(s => s.removeAnnotation)
  const renameTab = useEditorStore(s => s.renameTab)
  const activeTabId = useEditorStore(s => s.activeTabId)

  // Inline name editing
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const setViewMode = useEditorStore(s => s.setViewMode)

  const { target: annTooltip, show: showAnnTooltip, hide: hideAnnTooltip } = useDelayedHover<HoverTarget>()
  const { target: enzymeTooltip, show: showEnzymeTooltip, hide: hideEnzymeTooltip } =
    useDelayedHover<HoverTarget & { group: GroupedCutSite }>()
  const [hoveredEnzymeKey, setHoveredEnzymeKey] = useState<string | null>(null)
  const [hoveredGuideKey, setHoveredGuideKey] = useState<string | null>(null)
  const selectedGuideKey = useEditorStore(s => s.selectedGuideKey)
  const setSelectedGuideKey = useEditorStore(s => s.setSelectedGuideKey)
  const guideResults = useEditorStore(s => s.guideResults)

  const {
    style, layout, allAnnotations, rings, annById, proposalIds, pickedIds, sceneEnzymes, enzymeByKey, sceneGuides,
    allPrimerItems, primerItemById, siteCountOf, scenePrimers, methylation, gcSeries, gcOverall, legend,
  } = usePlasmidSceneData(doc)

  /** A guide cut on the map selects its protospacer, as a site click does. */
  const selectGuide = useCallback((key: string) => {
    const found = guideResults.find(c => guideKey(c.site) === key)
    if (!found) return
    setSelectedGuideKey(key)
    useEditorStore.getState().setSelection({ anchor: found.site.start, caret: found.site.end })
  }, [guideResults, setSelectedGuideKey])

  // Context menu
  interface ContextMenuState {
    x: number
    y: number
    /** Position at the pointer's angle; null near the centre, where there is none. */
    seqPos: number | null
    /** Feature or primer stand-in under the pointer. */
    annId: string | null
    enzymeGroup: GroupedCutSite | null
  }
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ annId: string; annName: string } | null>(null)
  const [figureOpen, setFigureOpen] = useState(false)

  // --- Viewport ---
  // Local, not the tab's `zoomLevel`, which the store defines as bases per row
  // for the linear view. Resets when the document changes so a new tab always
  // opens fitted.
  const [viewport, setViewport] = useState<Viewport>(FIT)
  useEffect(() => { setViewport(FIT) }, [activeTabId])
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  // A Ctrl+drag along the backbone: the base it began at, the angle the
  // pointer last had and how far it has turned (clockwise positive), and the
  // ranges selected when it began, which the new one merges with.
  const selDragRef = useRef<{
    from: number; lastAngle: number; turned: number; moved: boolean; others: Selection[]
  } | null>(null)
  // The click event that follows a Ctrl+drag's mouseup is not a click.
  const suppressClickRef = useRef(false)


  // --- Scene ---
  const [canvasSize, setCanvasSize] = useState(0)

  /**
   * Bumped when the app theme changes, so the scene re-resolves its colours.
   *
   * The palette comes from CSS custom properties on `.app-root`, which React
   * cannot see. The old renderer had the same blind spot and simply kept
   * drawing in the previous theme's colours until some unrelated redraw came
   * along, usually the next hover. Watching the attribute is cheap because it
   * only fires on an actual theme switch.
   */
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => {
    const root = containerRef.current?.closest('.app-root')
    if (!root) return
    const mo = new MutationObserver(() => setThemeVersion(v => v + 1))
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  const [colors, setColors] = useState<PlasmidColors | null>(null)
  useEffect(() => {
    setColors(resolvePlasmidColors(style, containerRef.current))
  }, [style, themeVersion])

  const sceneInput = useMemo<PlasmidSceneInput | null>(() => {
    if (canvasSize <= 0 || !colors) return null
    return {
      size: canvasSize,
      seqLen: doc.sequence.length,
      name: doc.name,
      topology: doc.sequence.topology,
      displayOrigin: (doc.sequence.topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0,
      style,
      colors,
      measureText,
      rings,
      hoveredAnnotationId,
      proposalIds,
      pickedIds,
      enzymeGroups: sceneEnzymes,
      hoveredEnzymeKey,
      guides: sceneGuides,
      hoveredGuideKey,
      selectedGuideKey,
      primers: scenePrimers,
      selection,
      selectionSpansOrigin: isOriginSpanningSelection(selection, 'circular'),
      selectionLength: selectedRanges(selection, extraSelections, doc.sequence.topology)
        .reduce((n, r) => n + selectionLength(r, 'circular', doc.sequence.length), 0),
      extraSelections,
      searchHits: search.matches,
      // A BLAST hit pointed at in the drawer, on the backbone like a marked stretch.
      regions: highlightRanges.map(r => ({ start: r.start, end: r.end, color: colors.accent })),
      currentSearchHit: search.currentMatch,
      methylation,
      gc: gcSeries,
      gcPercent: gcOverall,
      legend,
      layout,
    }
  }, [
    canvasSize, doc.sequence.length, doc.sequence.topology, doc.name, doc.metadata,
    style, layout, colors, rings, hoveredAnnotationId, proposalIds, pickedIds, sceneEnzymes,
    hoveredEnzymeKey, sceneGuides, hoveredGuideKey, selectedGuideKey, scenePrimers, selection, extraSelections, search, methylation, gcSeries, gcOverall, legend,
    highlightRanges,
  ])
  const scene = useMemo(() => (sceneInput ? buildPlasmidScene(sceneInput) : null), [sceneInput])

  const sceneRef = useRef<PlasmidScene | null>(null)
  sceneRef.current = scene
  const sceneInputRef = useRef(sceneInput)
  sceneInputRef.current = sceneInput
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  // --- Painting, coalesced into one frame ---
  const rafRef = useRef(0)
  const paint = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const canvas = canvasRef.current
      const s = sceneRef.current
      if (!canvas || !s) return
      const dpr = window.devicePixelRatio || 1
      const px = Math.round(s.size * dpr)
      // Assigning width/height reallocates the backing store, so only do it
      // when the size has actually changed.
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px
        canvas.height = px
        canvas.style.width = `${s.size}px`
        canvas.style.height = `${s.size}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderSceneToCanvas(ctx, s, viewportRef.current)
    })
  }, [])

  useEffect(() => { paint() }, [scene, viewport, paint])
  useEffect(() => () => {
    // Clearing the handle matters as much as cancelling it. Refs survive
    // StrictMode's mount, unmount, remount cycle in development, so a handle
    // left behind here reads as "a frame is already scheduled" forever after,
    // and every later paint returns early: a map that hit-tests correctly and
    // draws nothing, with no error anywhere.
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  // One observer for the component's life, rather than a new one per redraw.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      setCanvasSize(Math.min(container.clientWidth, container.clientHeight))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // --- Coordinate conversion ---

  /** Client point to scene coordinates, undoing the viewport transform. */
  const toSceneXY = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    const s = sceneRef.current
    if (!canvas || !s) return null
    const rect = canvas.getBoundingClientRect()
    const vp = viewportRef.current
    const half = s.size / 2
    return {
      x: (clientX - rect.left - vp.tx - half) / vp.scale + half,
      y: (clientY - rect.top - vp.ty - half) / vp.scale + half,
      scene: s,
    }
  }, [])

  /** What is under a scene point; see plasmid/hit for the order. */
  const hitTest = useCallback((x: number, y: number, scn: PlasmidScene) => hitTestScene(scn, x, y), [])

  // --- Pointer handlers ---

  /**
   * Select a range, beside what is selected with Ctrl (Cmd), in its place
   * without, as the sequence view does.
   */
  const pickRange = useCallback((r: Selection, ctrl: boolean) => {
    const store = useEditorStore.getState()
    if (!ctrl) { store.setSelection(r); return }
    store.setSelections(r, selectedRanges(store.selection, extraSelectionsOf(store), store.doc.sequence.topology))
  }, [])

  const handleClick = useCallback((e: MouseEvent) => {
    // The click that ends a Ctrl+drag (or Ctrl+click) on the backbone has
    // been handled by the drag.
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    setCtxMenu(null)
    const ctrl = e.ctrlKey || e.metaKey
    const p = toSceneXY(e.clientX, e.clientY)
    if (!p) return
    const seqLen = doc.sequence.length
    if (seqLen === 0) return
    const { x, y, scene: scn } = p
    const cx = scn.size / 2
    const cy = scn.size / 2

    // Centre name opens the inline editor.
    if (Math.abs(x - cx) < 70 && Math.abs(y - (cy - 12)) < 14) {
      setNameValue(doc.name)
      setEditingName(true)
      setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 30)
      return
    }

    const hit = hitTest(x, y, scn)
    if (hit?.type === 'guide') {
      selectGuide(hit.id)
      return
    }
    if (hit?.type === 'enzyme') {
      const group = enzymeByKey.get(hit.id)
      if (group) {
        pickRange({ anchor: group.recognitionStart, caret: group.recognitionEnd }, ctrl)
        if (!ctrl && useEditorStore.getState().viewMode === 'circular') setViewMode('linear')
      }
      return
    }
    if (hit?.type === 'primer') {
      const p2 = scenePrimers.find(sp => sp.id === hit.id)
      if (p2) pickRange({ anchor: p2.start, caret: p2.end }, ctrl)
      return
    }
    if (hit?.type === 'feature') {
      const ann = annById.get(hit.id)
      if (!ann) return
      if (ctrl) {
        const autoKey = keyFromAutoId(ann.id)
        if (autoKey !== null) { useEditorStore.getState().toggleAutoAnnotationPick(autoKey); return }
        const orfK = keyFromOrfId(ann.id)
        if (orfK !== null) { useEditorStore.getState().toggleOrfPick(orfK); return }
      }
      pickRange({ anchor: ann.start, caret: ann.end }, ctrl)
      return
    }

    // Backbone: place the caret.
    const dist = Math.hypot(x - cx, y - cy)
    if (dist < scn.baseRadius * 0.5 || dist > scn.baseRadius * 1.8) return
    const pos = angleToPos(Math.atan2(y - cy, x - cx), seqLen)
    if (e.shiftKey) setSelection({ anchor: selection.anchor, caret: pos })
    else setCaret(pos)
  }, [
    doc.sequence.length, doc.name, toSceneXY, hitTest, enzymeByKey, annById, selectGuide,
    scenePrimers, selection.anchor, setSelection, setCaret, setViewMode, pickRange,
  ])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (panRef.current) {
      const p = panRef.current
      setViewport(v => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }))
      return
    }

    const drag = selDragRef.current
    if (drag) {
      const pt = toSceneXY(e.clientX, e.clientY)
      const seq = doc.sequence
      if (!pt || seq.length === 0) return
      const c = pt.scene.size / 2
      const angle = Math.atan2(pt.y - c, pt.x - c)
      // The signed step since the last move, the short way round.
      let step = normalizeAngle(angle - drag.lastAngle)
      if (step > Math.PI) step -= Math.PI * 2
      drag.turned += step
      drag.lastAngle = angle
      const pos = angleToPos(angle, seq.length)
      if (pos === drag.from && Math.abs(drag.turned) < Math.PI) {
        if (drag.moved) useEditorStore.getState().setSelections({ anchor: pos, caret: pos }, drag.others)
        return
      }
      drag.moved = true
      const r = arcSelection(drag.from, pos, drag.turned, seq.topology === 'circular', seq.length)
      useEditorStore.getState().setSelections(r, drag.others)
      return
    }

    const pt = toSceneXY(e.clientX, e.clientY)
    if (!pt || doc.sequence.length === 0) return
    const hit = hitTest(pt.x, pt.y, pt.scene)

    const store = useEditorStore.getState()
    if (hit?.type === 'guide') {
      if (hoveredGuideKey !== hit.id) setHoveredGuideKey(hit.id)
    } else if (hoveredGuideKey !== null) {
      setHoveredGuideKey(null)
    }
    if (hit?.type === 'enzyme') {
      const group = enzymeByKey.get(hit.id)
      if (group) {
        if (hoveredEnzymeKey !== hit.id) setHoveredEnzymeKey(hit.id)
        showEnzymeTooltip({ x: e.clientX, y: e.clientY, key: hit.id, group })
        hideAnnTooltip()
        canvas.style.cursor = 'pointer'
        if (store.hoveredAnnotationId) setHoveredAnnotation(null)
        return
      }
    }
    if (hoveredEnzymeKey) {
      setHoveredEnzymeKey(null)
      hideEnzymeTooltip()
    }

    // Saved primers hover like features, so the sequence view in split mode
    // highlights the same site.
    const featureId = hit?.type === 'feature' || (hit?.type === 'primer' && isPrimerItemId(hit.id))
      ? hit.id
      : null
    if (featureId !== store.hoveredAnnotationId) setHoveredAnnotation(featureId)
    if (featureId) showAnnTooltip({ x: e.clientX + 12, y: e.clientY - 10, key: featureId })
    else hideAnnTooltip()
    canvas.style.cursor = hit ? 'pointer' : viewportRef.current.scale > 1 ? 'grab' : 'crosshair'
  }, [
    doc.sequence, toSceneXY, hitTest, enzymeByKey, hoveredEnzymeKey, hoveredGuideKey,
    setHoveredAnnotation, showAnnTooltip, hideAnnTooltip, showEnzymeTooltip, hideEnzymeTooltip,
  ])

  const handleMouseLeave = useCallback(() => {
    if (useEditorStore.getState().hoveredAnnotationId) setHoveredAnnotation(null)
    setHoveredEnzymeKey(null)
    hideEnzymeTooltip()
    hideAnnTooltip()
    panRef.current = null
  }, [setHoveredAnnotation, hideAnnTooltip, hideEnzymeTooltip])

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault()
    const p = toSceneXY(e.clientX, e.clientY)
    if (!p || doc.sequence.length === 0) return
    const hit = hitTest(p.x, p.y, p.scene)
    hideAnnTooltip()
    hideEnzymeTooltip()
    const c = p.scene.size / 2
    const nearCentre = Math.hypot(p.x - c, p.y - c) < p.scene.baseRadius * 0.3
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      seqPos: nearCentre ? null : angleToPos(Math.atan2(p.y - c, p.x - c), doc.sequence.length),
      annId: hit?.type === 'feature' || hit?.type === 'primer' ? hit.id : null,
      enzymeGroup: hit?.type === 'enzyme' ? enzymeByKey.get(hit.id) ?? null : null,
    })
  }, [doc.sequence.length, toSceneXY, hitTest, enzymeByKey, hideAnnTooltip, hideEnzymeTooltip])

  const handleDblClick = useCallback((e: MouseEvent) => {
    const p = toSceneXY(e.clientX, e.clientY)
    if (!p || doc.sequence.length === 0) return
    const hit = hitTest(p.x, p.y, p.scene)
    if (hit?.type === 'feature') {
      useEditorStore.getState().setEditAnnotation(hit.id)
      _props.onEditFeature?.(hit.id)
      return
    }
    if (hit?.type === 'primer') {
      const item = primerItemById.get(hit.id)
      if (item?.preview) useEditorStore.getState().openSidebar('primers', 'design')
      else if (item) useEditorStore.getState().setFocusedPrimer(item.primer.id)
      return
    }
    // Empty space returns the view to fit, which is the escape hatch from a
    // zoom the user cannot otherwise undo with the pointer.
    if (!hit) setViewport(FIT)
  }, [doc.sequence.length, toSceneXY, hitTest, _props, primerItemById])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return
    e.preventDefault()
    const canvas = canvasRef.current
    const s = sceneRef.current
    if (!canvas || !s) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top

    setViewport(v => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
      if (next === v.scale) return v
      if (next === MIN_ZOOM) return FIT
      // Keep the point under the cursor fixed while the scale changes.
      const half = s.size / 2
      const k = next / v.scale
      return {
        scale: next,
        tx: px - k * (px - v.tx - half) - half,
        ty: py - k * (py - v.ty - half) - half,
      }
    })
  }, [])

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button !== 0) return
    // A release outside the canvas never sent its click: forget it.
    suppressClickRef.current = false
    const p = toSceneXY(e.clientX, e.clientY)
    if (!p) return
    const hit = hitTest(p.x, p.y, p.scene)
    // Ctrl+drag along the backbone selects a range beside the others, as
    // Ctrl+drag over the bases does in the sequence view. On a feature the
    // Ctrl+click is the click handler's.
    const seqLen = doc.sequence.length
    if ((e.ctrlKey || e.metaKey) && !hit && seqLen > 0) {
      const c = p.scene.size / 2
      const dist = Math.hypot(p.x - c, p.y - c)
      if (dist >= p.scene.baseRadius * 0.5 && dist <= p.scene.baseRadius * 1.8) {
        const angle = Math.atan2(p.y - c, p.x - c)
        const store = useEditorStore.getState()
        selDragRef.current = {
          from: angleToPos(angle, seqLen), lastAngle: angle, turned: 0, moved: false,
          others: selectedRanges(store.selection, extraSelectionsOf(store), doc.sequence.topology),
        }
        e.preventDefault()
        return
      }
    }
    if (viewportRef.current.scale <= 1) return
    // Dragging pans only on empty space, so dragging across a feature still
    // behaves like a click on it.
    if (hit) return
    panRef.current = { x: e.clientX, y: e.clientY, tx: viewportRef.current.tx, ty: viewportRef.current.ty }
  }, [toSceneXY, hitTest, doc.sequence])

  const handleMouseUp = useCallback(() => {
    panRef.current = null
    const drag = selDragRef.current
    if (!drag) return
    selDragRef.current = null
    suppressClickRef.current = true
    const store = useEditorStore.getState()
    const seq = store.doc.sequence
    if (!drag.moved) {
      // A Ctrl+click on a selected range takes it out; elsewhere it changes
      // nothing. The last range left becomes the active one.
      const at = drag.from
      const hit = drag.others.find(r =>
        selectionSegments(r, seq.topology, seq.length).some(([s, e]) => s <= at && at <= e))
      if (!hit) return
      const left = drag.others.filter(r => r !== hit)
      if (left.length === 0) store.setCaret(at)
      else store.setSelections(left[left.length - 1], left.slice(0, -1))
      return
    }
    // Dragged back to where it began: no range of its own.
    const extras = extraSelectionsOf(store)
    if (extras.length > 0 && store.selection.anchor === store.selection.caret) {
      store.setSelections(extras[extras.length - 1], extras.slice(0, -1))
    }
  }, [])

  // Listeners attached once. They used to be removed and re-added on every
  // hover, because the draw callback was in this effect's dependency list.
  const handlers = useRef({
    handleClick, handleDblClick, handleMouseMove, handleMouseLeave,
    handleContextMenu, handleWheel, handleMouseDown, handleMouseUp,
  })
  handlers.current = {
    handleClick, handleDblClick, handleMouseMove, handleMouseLeave,
    handleContextMenu, handleWheel, handleMouseDown, handleMouseUp,
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const click = (e: MouseEvent) => handlers.current.handleClick(e)
    const dbl = (e: MouseEvent) => handlers.current.handleDblClick(e)
    const move = (e: MouseEvent) => handlers.current.handleMouseMove(e)
    const leave = () => handlers.current.handleMouseLeave()
    const ctx = (e: MouseEvent) => handlers.current.handleContextMenu(e)
    const wheel = (e: WheelEvent) => handlers.current.handleWheel(e)
    const down = (e: MouseEvent) => handlers.current.handleMouseDown(e)
    const up = () => handlers.current.handleMouseUp()

    canvas.addEventListener('click', click)
    canvas.addEventListener('dblclick', dbl)
    canvas.addEventListener('mousemove', move)
    canvas.addEventListener('mouseleave', leave)
    canvas.addEventListener('contextmenu', ctx)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('mousedown', down)
    window.addEventListener('mouseup', up)
    return () => {
      canvas.removeEventListener('click', click)
      canvas.removeEventListener('dblclick', dbl)
      canvas.removeEventListener('mousemove', move)
      canvas.removeEventListener('mouseleave', leave)
      canvas.removeEventListener('contextmenu', ctx)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('mousedown', down)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // The menu closes itself on outside clicks, scrolling and Escape.
  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  // --- Export ---
  // The whole map as a figure, whatever the zoom, drawn again for the file
  // (see figureSceneInput). The BLAST hit pointed at in the drawer is a
  // highlight of the moment, so it goes with the selection.
  const buildFigure = useCallback((o: MapFigureOptions): PlasmidScene | null => {
    const input = sceneInputRef.current
    if (!input) return null
    const fig = figureSceneInput(input, o)
    return buildPlasmidScene(o.highlights ? fig : { ...fig, regions: [] })
  }, [])
  const hasHighlights = selection.anchor !== selection.caret || extraSelections.length > 0
    || search.matches.length > 0 || highlightRanges.length > 0

  const zoomed = viewport.scale > 1

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        // The scene paints only its own square, so the pane around it takes
        // the same colour; otherwise a dark theme shows the map as a box.
        background: 'var(--canvas-bg)',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ cursor: 'crosshair' }}
      />

      {/* Map controls. Kept out of the panel bar because they act on this
          view only, and the reset needs to be visible: zoom is otherwise a
          state the pointer cannot easily get you out of. */}
      <div className="plasmid-tools">
        {zoomed && (
          <button
            className="plasmid-tool"
            onClick={() => setViewport(FIT)}
            title="Reset zoom to fit"
            aria-label="Reset zoom to fit"
          >
            <Maximize2 size={13} />
          </button>
        )}
        <button
          className="plasmid-tool"
          onClick={() => setFigureOpen(true)}
          title="Export figure (SVG, PNG or PDF)"
          aria-label="Export figure"
        >
          <Download size={13} />
        </button>
      </div>
      {figureOpen && (
        <MapFigureDialog
          name={`${doc.name || 'plasmid'}-map`}
          sizes={[480, FIGURE_SIZE, 1080]}
          defaultSize={FIGURE_SIZE}
          hasHighlights={hasHighlights}
          build={buildFigure}
          onClose={() => setFigureOpen(false)}
          onExportPrompt={_props.onExportPrompt}
        />
      )}
      {editingName && (() => {
        // Position the input at the center of the canvas
        const container = containerRef.current
        const canvas = canvasRef.current
        if (!container || !canvas) return null
        const size = Math.min(container.clientWidth, container.clientHeight)
        const canvasLeft = (container.clientWidth - size) / 2
        const canvasTop = (container.clientHeight - size) / 2
        const cx = canvasLeft + size / 2
        const cy = canvasTop + size / 2
        const handleSubmit = () => {
          const trimmed = nameValue.trim()
          if (trimmed && activeTabId) renameTab(activeTabId, trimmed)
          setEditingName(false)
        }
        return (
          <input
            ref={nameInputRef}
            className="plasmid-name-input"
            style={{
              position: 'absolute',
              left: cx - 70,
              top: cy - 20,
              width: 140,
            }}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleSubmit}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') setEditingName(false)
            }}
            spellCheck={false}
          />
        )
      })()}
      {/* Hover tooltips - hidden when context menu is open */}
      {!ctxMenu && annTooltip && (() => {
        const primerItem = primerItemById.get(annTooltip.key)
        if (primerItem) {
          return (
            <PrimerTooltip
              item={primerItem}
              siteCount={siteCountOf(primerItem)}
              items={allPrimerItems}
              x={annTooltip.x}
              y={annTooltip.y}
            />
          )
        }
        const ann = allAnnotations.find(a => a.id === annTooltip.key)
        if (!ann) return null
        return (
          <AnnotationTooltip
            ann={ann}
            sequence={doc.sequence}
            x={annTooltip.x}
            y={annTooltip.y}
          />
        )
      })()}

      {/* A site card opens diagonally outward from its site, away from the
          circle: the names of a busy stretch stack along the circle, so
          heading outward keeps it off the site and off them. */}
      {!ctxMenu && enzymeTooltip && (
        <EnzymeTooltip
          x={enzymeTooltip.x}
          y={enzymeTooltip.y}
          above={Math.cos(siteAngle(enzymeTooltip.group.labelPos, doc.sequence.length)) > 0}
          placement={{
            flip: true,
            gap: { x: 16, y: 8 },
            before: Math.sin(siteAngle(enzymeTooltip.group.labelPos, doc.sequence.length)) < 0,
          }}
          group={enzymeTooltip.group}
          ctx={{ methylation: methylationContextOf(doc), cutCounts: cutCountsByEnzyme(allEnzymeCutSites) }}
        />
      )}

      {ctxMenu && (
        <SequenceContextMenu
          target={ctxMenu}
          annotations={allAnnotations}
          primerItemById={primerItemById}
          siteCountOf={siteCountOf}
          onClose={closeCtxMenu}
          onEditFeature={_props.onEditFeature}
          onAnnotateRequest={_props.onAnnotateRequest}
          onDeleteAnnotation={a => setDeleteConfirm({ annId: a.id, annName: a.name })}
        />
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete Annotation"
        message={`Delete "${deleteConfirm?.annName}"? This cannot be undone.`}
        buttons={[
          { label: 'Cancel', value: 'cancel' },
          { label: 'Delete', value: 'delete', variant: 'danger' },
        ]}
        onResult={(v) => {
          if (v === 'delete' && deleteConfirm) {
            removeAnnotation(deleteConfirm.annId)
          }
          setDeleteConfirm(null)
        }}
      />
    </div>
  )
}

/** Memoised for the same reason as SequenceView; see the note there. */
export default memo(PlasmidMap)
