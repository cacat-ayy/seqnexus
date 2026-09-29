/**
 * Circular plasmid map view.
 *
 * The drawing itself lives in `src/plasmid/`: this component gathers state,
 * builds a scene, and hands it to an emitter. It used to issue every canvas
 * call inline, which is why it could not be exported and why each of the four
 * pointer handlers recomputed the geometry by hand.
 */

import { useRef, useEffect, useCallback, useMemo, useState, memo } from 'react'
import { Download, Maximize2, Image as ImageIcon, FileCode2 } from 'lucide-react'
import { copyText } from '../utils/clipboard'
import { translate as translateSequenceStr } from '../utils/codon'
import { gcPercent } from '../primers/thermodynamics'
import { downloadBlob } from '../utils/download'
import { notify } from '../toast'
import {
  useEditorStore, selectionRange, isOriginSpanningSelection, selectionLength,
  selectionSegments,
} from '../store'
import { Annotation, type AnnotationData } from '../models/Annotation'

import { orfColor } from '../workers/orf-finder'
import {
  proposalsFrom, proposalAnnotations, isAutoAnnotationId, keyFromAutoId,
} from '../utils/auto-annotations'
import { orfIdFor, orfName, keyFromOrfId } from '../utils/orf-features'
import { reverseComplement as reverseComplementStr } from '../models/complement'
import AnnotationTooltip, { AnnotationTooltipContent } from './AnnotationTooltip'
import { annotationBases, annotationProtein, canTranslateAnnotation } from '../utils/annotation-sequence'
import { useDelayedHover, type HoverTarget } from '../hooks/useDelayedHover'
import EnzymeTooltip, { EnzymeGroupTooltipContent } from './EnzymeTooltip'
import { groupCutSites, enzymeGroupKey, type GroupedCutSite } from './SequenceView'
import ContextMenuPopup from './ContextMenuPopup'
import ConfirmDialog from './ConfirmDialog'

import {
  buildPlasmidScene, type PlasmidScene, type ScenePrimer, type SceneEnzymeGroup,
} from '../plasmid/scene'
import { renderSceneToCanvas, type Viewport } from '../plasmid/renderCanvas'
import { plasmidToPng, plasmidToSvgBlob } from '../plasmid/exportImage'
import { getPlasmidStyle, resolvePlasmidColors } from '../plasmid/styles'
import { stackAnnotations, angleToPos, normalizeAngle } from '../plasmid/geometry'
import { computeGcSeries, findMethylationSites } from '../plasmid/gc'

/**
 * One offscreen context for all text measurement.
 *
 * The layout pass needs to measure strings before anything is drawn, and the
 * SVG export has no canvas of its own. Sharing this one means both outputs
 * position every label identically.
 */
let _measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!_measureCtx) return text.length * 6
  _measureCtx.font = font
  return _measureCtx.measureText(text).width
}

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const FIT: Viewport = { scale: 1, tx: 0, ty: 0 }

interface PlasmidMapProps {
  onFindRequest?: () => void
  onEditFeature?: (annId: string) => void
  /** Ask App for a filename before writing a file, as the gel view does. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

function PlasmidMap(_props: PlasmidMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const setSelection = useEditorStore(s => s.setSelection)
  const setCaret = useEditorStore(s => s.setCaret)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const removeAnnotation = useEditorStore(s => s.removeAnnotation)
  const renameTab = useEditorStore(s => s.renameTab)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const readOnly = useEditorStore(s => s.readOnly)

  // Inline name editing
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const setViewMode = useEditorStore(s => s.setViewMode)

  const { target: annTooltip, show: showAnnTooltip, hide: hideAnnTooltip } = useDelayedHover<HoverTarget>()
  const { target: enzymeTooltip, show: showEnzymeTooltip, hide: hideEnzymeTooltip } =
    useDelayedHover<HoverTarget & { group: GroupedCutSite }>()
  const [hoveredEnzymeKey, setHoveredEnzymeKey] = useState<string | null>(null)

  const showOrfs = useEditorStore(s => s.showOrfs)
  const showEnzymes = useEditorStore(s => s.showEnzymes)
  const showPrimers = useEditorStore(s => s.showPrimers)
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const allEnzymeCutSites = useEditorStore(s => s.enzymeCutSites)
  const allOrfResults = useEditorStore(s => s.orfResults)
  const allPrimerResults = useEditorStore(s => s.primerResults)
  const selectedPrimerIndices = useEditorStore(s => s.selectedPrimerIndices)
  const allAutoAnnotations = useEditorStore(s => s.autoAnnotations)
  const autoAnnotationPicks = useEditorStore(s => s.autoAnnotationPicks)
  const orfPicks = useEditorStore(s => s.orfPicks)
  const autoOverlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)

  // Global display preferences
  const plasmidStyleId = useEditorStore(s => s.plasmidStyle)
  const showGcRing = useEditorStore(s => s.showGcRing)
  const showPlasmidLegend = useEditorStore(s => s.showPlasmidLegend)
  const style = useMemo(() => getPlasmidStyle(plasmidStyleId), [plasmidStyleId])

  const enzymeCutSites = showEnzymes ? allEnzymeCutSites : []
  const damMeth = doc.metadata?.damMethylated || false
  const dcmMeth = doc.metadata?.dcmMethylated || false
  const groupedEnzymeSites = useMemo(
    () => groupCutSites(enzymeCutSites, damMeth, dcmMeth),
    [enzymeCutSites, damMeth, dcmMeth],
  )
  const orfResults = showOrfs ? allOrfResults : []

  // Context menu
  interface ContextMenuState {
    x: number
    y: number
    annId: string | null
    enzymeGroup: GroupedCutSite | null
  }
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ annId: string; annName: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  // --- Viewport ---
  // Local, not the tab's `zoomLevel`, which the store defines as bases per row
  // for the linear view. Resets when the document changes so a new tab always
  // opens fitted.
  const [viewport, setViewport] = useState<Viewport>(FIT)
  useEffect(() => { setViewport(FIT) }, [activeTabId])
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // --- Derived data ---
  const orfAnnotations = useMemo(() => orfResults.map(orf => new Annotation({
    id: orfIdFor(orf),
    name: orfName(orf),
    type: 'CDS',
    start: orf.start,
    end: orf.end,
    strand: orf.strand,
    color: orfColor(orf.strand, orf.frame),
  } as AnnotationData)), [orfResults])

  const hiddenSet = useMemo(() => new Set(hiddenAnnotationIds), [hiddenAnnotationIds])
  const visibleAnnotations = useMemo(() =>
    hiddenSet.size === 0 ? doc.annotations : doc.annotations.filter(a => !hiddenSet.has(a.id)),
    [doc.annotations, hiddenSet],
  )

  const autoAnnotations = useMemo(() => {
    if (!showAutoAnnotations || allAutoAnnotations.length === 0) return []
    return proposalAnnotations(
      proposalsFrom(allAutoAnnotations, doc.annotations, autoOverlapThreshold),
    )
  }, [showAutoAnnotations, allAutoAnnotations, doc.annotations, autoOverlapThreshold])

  const allAnnotations = useMemo(() => {
    const extra = [...orfAnnotations, ...autoAnnotations]
    return extra.length === 0 ? visibleAnnotations : [...visibleAnnotations, ...extra]
  }, [visibleAnnotations, orfAnnotations, autoAnnotations])

  /** Stacked once. Previously recomputed in the draw and in all four handlers,
   *  including on every pointer move. */
  const rings = useMemo(() => stackAnnotations(allAnnotations), [allAnnotations])

  const annById = useMemo(() => {
    const m = new Map<string, Annotation>()
    for (const a of allAnnotations) m.set(a.id, a)
    return m
  }, [allAnnotations])

  const proposalIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of allAnnotations) if (keyFromAutoId(a.id) !== null) s.add(a.id)
    return s
  }, [allAnnotations])

  const pickedIds = useMemo(() => {
    const s = new Set<string>()
    for (const a of allAnnotations) {
      const autoKey = keyFromAutoId(a.id)
      if (autoKey !== null && autoAnnotationPicks.has(autoKey)) { s.add(a.id); continue }
      const orfK = keyFromOrfId(a.id)
      if (orfK !== null && orfPicks.has(orfK)) s.add(a.id)
    }
    return s
  }, [allAnnotations, autoAnnotationPicks, orfPicks])

  const sceneEnzymes: SceneEnzymeGroup[] = useMemo(
    () => groupedEnzymeSites.map(g => ({
      key: enzymeGroupKey(g),
      label: g.label,
      cutPos: g.fwdCut,
      methEffect: g.methEffect,
    })),
    [groupedEnzymeSites],
  )

  const enzymeByKey = useMemo(() => {
    const m = new Map<string, GroupedCutSite>()
    for (const g of groupedEnzymeSites) m.set(enzymeGroupKey(g), g)
    return m
  }, [groupedEnzymeSites])

  const scenePrimers: ScenePrimer[] = useMemo(() => {
    if (!showPrimers || allPrimerResults.length === 0) return []
    const out: ScenePrimer[] = []
    allPrimerResults.forEach((pair, i) => {
      const selected = selectedPrimerIndices.has(i)
      out.push({
        id: `primer_${i}_f`, name: `Primer ${i + 1} F`,
        start: pair.forward.start, end: pair.forward.end, strand: 1, selected,
      })
      out.push({
        id: `primer_${i}_r`, name: `Primer ${i + 1} R`,
        start: pair.reverse.start, end: pair.reverse.end, strand: -1, selected,
      })
    })
    return out
  }, [showPrimers, allPrimerResults, selectedPrimerIndices])

  /** Scanned once per sequence rather than once per redraw. */
  const methylation = useMemo(
    () => findMethylationSites(doc.sequence.bases, damMeth, dcmMeth),
    [doc.sequence.bases, damMeth, dcmMeth],
  )

  const gcSeries = useMemo(
    () => (showGcRing ? computeGcSeries(doc.sequence.bases) : null),
    [showGcRing, doc.sequence.bases],
  )

  const gcOverall = useMemo(
    () => (doc.sequence.length > 0 ? gcPercent(doc.sequence.bases) : null),
    [doc.sequence.bases, doc.sequence.length],
  )

  const legend = useMemo(() => {
    if (!showPlasmidLegend) return null
    const seen = new Map<string, string>()
    for (const a of allAnnotations) if (!seen.has(a.type)) seen.set(a.type, a.color)
    return [...seen].slice(0, 12).map(([label, color]) => ({ label, color }))
  }, [showPlasmidLegend, allAnnotations])

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

  const scene = useMemo<PlasmidScene | null>(() => {
    if (canvasSize <= 0) return null
    const colors = resolvePlasmidColors(style, containerRef.current)
    return buildPlasmidScene({
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
      primers: scenePrimers,
      selection,
      selectionSpansOrigin: isOriginSpanningSelection(selection, 'circular'),
      selectionLength: selectionLength(selection, 'circular', doc.sequence.length),
      methylation,
      gc: gcSeries,
      gcPercent: gcOverall,
      legend,
    })
  }, [
    canvasSize, doc.sequence.length, doc.sequence.topology, doc.name, doc.metadata,
    style, rings, hoveredAnnotationId, proposalIds, pickedIds, sceneEnzymes,
    hoveredEnzymeKey, scenePrimers, selection, methylation, gcSeries, gcOverall, legend,
    themeVersion,
  ])

  const sceneRef = useRef<PlasmidScene | null>(null)
  sceneRef.current = scene
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

  /** Topmost hit region under a scene point, searched newest first so the
   *  outer rings win over the ones they are drawn on top of. */
  const hitTest = useCallback((x: number, y: number, scn: PlasmidScene) => {
    const cx = scn.size / 2
    const cy = scn.size / 2
    const dx = x - cx
    const dy = y - cy
    const dist = Math.hypot(dx, dy)
    const angle = Math.atan2(dy, dx)

    // Points (enzymes) take precedence: they are small and deliberate.
    for (const r of scn.hitRegions) {
      if (r.kind !== 'point') continue
      if ((x - r.x) ** 2 + (y - r.y) ** 2 < r.r * r.r) return r
    }
    for (let i = scn.hitRegions.length - 1; i >= 0; i--) {
      const r = scn.hitRegions[i]
      if (r.kind !== 'arc') continue
      if (dist < r.radius - r.halfWidth || dist > r.radius + r.halfWidth) continue
      if (normalizeAngle(angle - r.startAngle) <= r.span) return r
    }
    return null
  }, [])

  // --- Pointer handlers ---

  const handleClick = useCallback((e: MouseEvent) => {
    setCtxMenu(null)
    setExportOpen(false)
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
    if (hit?.type === 'enzyme') {
      const group = enzymeByKey.get(hit.id)
      if (group) {
        setSelection({ anchor: group.recognitionStart, caret: group.recognitionEnd })
        if (useEditorStore.getState().viewMode === 'circular') setViewMode('linear')
      }
      return
    }
    if (hit?.type === 'primer') {
      const p2 = scenePrimers.find(sp => sp.id === hit.id)
      if (p2) setSelection({ anchor: p2.start, caret: p2.end })
      return
    }
    if (hit?.type === 'feature') {
      const ann = annById.get(hit.id)
      if (!ann) return
      if (e.ctrlKey || e.metaKey) {
        const autoKey = keyFromAutoId(ann.id)
        if (autoKey !== null) { useEditorStore.getState().toggleAutoAnnotationPick(autoKey); return }
        const orfK = keyFromOrfId(ann.id)
        if (orfK !== null) { useEditorStore.getState().toggleOrfPick(orfK); return }
      }
      setSelection({ anchor: ann.start, caret: ann.end })
      return
    }

    // Backbone: place the caret.
    const dist = Math.hypot(x - cx, y - cy)
    if (dist < scn.baseRadius * 0.5 || dist > scn.baseRadius * 1.8) return
    const pos = angleToPos(Math.atan2(y - cy, x - cx), seqLen)
    if (e.shiftKey) setSelection({ anchor: selection.anchor, caret: pos })
    else setCaret(pos)
  }, [
    doc.sequence.length, doc.name, toSceneXY, hitTest, enzymeByKey, annById,
    scenePrimers, selection.anchor, setSelection, setCaret, setViewMode,
  ])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (panRef.current) {
      const p = panRef.current
      setViewport(v => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }))
      return
    }

    const pt = toSceneXY(e.clientX, e.clientY)
    if (!pt || doc.sequence.length === 0) return
    const hit = hitTest(pt.x, pt.y, pt.scene)

    const store = useEditorStore.getState()
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

    const featureId = hit?.type === 'feature' ? hit.id : null
    if (featureId !== store.hoveredAnnotationId) setHoveredAnnotation(featureId)
    if (featureId) showAnnTooltip({ x: e.clientX + 12, y: e.clientY - 10, key: featureId })
    else hideAnnTooltip()
    canvas.style.cursor = hit ? 'pointer' : viewportRef.current.scale > 1 ? 'grab' : 'crosshair'
  }, [
    doc.sequence.length, toSceneXY, hitTest, enzymeByKey, hoveredEnzymeKey,
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
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      annId: hit?.type === 'feature' ? hit.id : null,
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
    // Empty space returns the view to fit, which is the escape hatch from a
    // zoom the user cannot otherwise undo with the pointer.
    if (!hit) setViewport(FIT)
  }, [doc.sequence.length, toSceneXY, hitTest, _props])

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
    if (e.button !== 0 || viewportRef.current.scale <= 1) return
    const p = toSceneXY(e.clientX, e.clientY)
    if (!p) return
    // Dragging pans only on empty space, so dragging across a feature still
    // behaves like a click on it.
    if (hitTest(p.x, p.y, p.scene)) return
    panRef.current = { x: e.clientX, y: e.clientY, tx: viewportRef.current.tx, ty: viewportRef.current.ty }
  }, [toSceneXY, hitTest])

  const handleMouseUp = useCallback(() => { panRef.current = null }, [])

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

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!ctxMenu) return
    let downOutside = false
    const handleDown = () => { downOutside = true }
    const handleUp = () => {
      if (downOutside) setCtxMenu(null)
      downOutside = false
    }
    const closeScroll = () => setCtxMenu(null)
    window.addEventListener('mousedown', handleDown)
    window.addEventListener('mouseup', handleUp)
    window.addEventListener('scroll', closeScroll, true)
    return () => {
      window.removeEventListener('mousedown', handleDown)
      window.removeEventListener('mouseup', handleUp)
      window.removeEventListener('scroll', closeScroll, true)
    }
  }, [ctxMenu])

  // --- Export ---
  // Always rendered at fit scale: an exported figure should be the whole map,
  // not whatever corner the user had zoomed into.
  const exportScene = useCallback((): PlasmidScene | null => sceneRef.current, [])

  const runExport = useCallback((kind: 'png' | 'svg') => {
    setExportOpen(false)
    const s = exportScene()
    if (!s) return
    const base = (doc.name || 'plasmid').replace(/[^\w.-]+/g, '_')
    const defaultName = `${base}-map.${kind}`
    const write = async (filename: string) => {
      try {
        const blob = kind === 'png' ? await plasmidToPng(s) : plasmidToSvgBlob(s)
        downloadBlob(blob, filename)
        notify.success(`Exported ${filename}`)
      } catch (err) {
        notify.error('Could not export the map', {
          detail: err instanceof Error ? err.message : undefined,
        })
      }
    }
    if (_props.onExportPrompt) _props.onExportPrompt(defaultName, name => { void write(name) })
    else void write(defaultName)
  }, [doc.name, exportScene, _props])

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
        <div className="plasmid-tool-menu">
          <button
            className={`plasmid-tool ${exportOpen ? 'open' : ''}`}
            onClick={() => setExportOpen(v => !v)}
            title="Export map image"
            aria-label="Export map image"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
          >
            <Download size={13} />
          </button>
          {exportOpen && (
            <div className="plasmid-export-menu" role="menu">
              <button className="plasmid-export-item" role="menuitem" onClick={() => runExport('png')}>
                <ImageIcon size={13} /> PNG image
              </button>
              <button className="plasmid-export-item" role="menuitem" onClick={() => runExport('svg')}>
                <FileCode2 size={13} /> SVG vector
              </button>
            </div>
          )}
        </div>
      </div>
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

      {!ctxMenu && enzymeTooltip && (
        <EnzymeTooltip
          x={enzymeTooltip.x}
          y={enzymeTooltip.y}
          group={enzymeTooltip.group}
        />
      )}

      {/* Context menu with embedded tooltip */}
      {ctxMenu && (() => {
        const ctxSegs = selectionSegments(selection, doc.sequence.topology, doc.sequence.length)
        const hasSelection = ctxSegs.length > 0
        const ctxAnn = ctxMenu.annId
          ? allAnnotations.find(a => a.id === ctxMenu.annId) ?? null
          : null
        const isUserAnn = ctxAnn && !ctxAnn.id.startsWith('_orf_') && !ctxAnn.id.startsWith('_primer_')
          && !isAutoAnnotationId(ctxAnn.id)
        const ctxEnzymeGroup = ctxMenu.enzymeGroup
        // Use first site for single-enzyme actions (copy recognition, lookup)
        const ctxEnzymeSite = ctxEnzymeGroup?.sites[0] ?? null

        const getCtxSelectedBases = () => {
          let text = ''
          for (const [s, e] of ctxSegs) text += doc.sequence.basesIn(s, e)
          return text
        }

        const handleCopy = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          copyText(bases, `Copied ${bases.length} bp`)
          setCtxMenu(null)
        }
        const handleCopyRevComp = () => {
          if (!hasSelection) return
          const text = reverseComplementStr(getCtxSelectedBases())
          copyText(text, `Copied reverse complement (${text.length} bp)`)
          setCtxMenu(null)
        }
        const handleCopyProtein = () => {
          if (!hasSelection) return
          const bases = getCtxSelectedBases()
          const protein = translateSequenceStr(bases)
          copyText(protein, `Copied protein (${protein.length} aa)`)
          setCtxMenu(null)
        }
        const handleSelectAnnotation = () => {
          if (!ctxAnn) return
          setSelection({ anchor: ctxAnn.start, caret: ctxAnn.end })
          setCtxMenu(null)
        }
        const handleCopyAnnotationBases = () => {
          if (!ctxAnn) return
          const bases = annotationBases(ctxAnn, doc.sequence)
          copyText(bases, `Copied ${bases.length} bp from "${ctxAnn!.name}"`)
          setCtxMenu(null)
        }
        const handleCopyAnnotationProtein = () => {
          if (!ctxAnn) return
          const protein = annotationProtein(ctxAnn, doc.sequence)
          copyText(protein, `Copied ${protein.length} aa from "${ctxAnn!.name}"`)
          setCtxMenu(null)
        }
        const handleEditAnnotation = () => {
          if (!ctxAnn) return
          useEditorStore.getState().setEditAnnotation(ctxAnn.id)
          _props.onEditFeature?.(ctxAnn.id)
          setCtxMenu(null)
        }
        const handleDeleteAnnotation = () => {
          if (!ctxAnn) return
          setDeleteConfirm({ annId: ctxAnn.id, annName: ctxAnn.name })
          setCtxMenu(null)
        }
        const handleAddAnnotation = () => {
          if (!hasSelection) return
          const selR = selectionRange(selection)
          if (!selR) return
          const id = `ann_${Date.now()}`
          addAnnotation({
            id,
            name: 'New Feature',
            type: 'misc_feature',
            start: selR[0],
            end: selR[1],
            strand: 1,
            color: '#4dabf7',
          })
          setCtxMenu(null)
        }
        const handleCopyRecognition = () => {
          if (!ctxEnzymeSite) return
          copyText(ctxEnzymeSite.enzyme.recognition, `Copied ${ctxEnzymeSite!.enzyme.recognition}`)
          setCtxMenu(null)
        }
        const handleSelectRecognition = () => {
          if (!ctxEnzymeGroup) return
          setSelection({ anchor: ctxEnzymeGroup.recognitionStart, caret: ctxEnzymeGroup.recognitionEnd })
          setCtxMenu(null)
        }
        const handleLookupEnzyme = () => {
          if (!ctxEnzymeSite) return
          window.open(`https://www.google.com/search?q=${encodeURIComponent(ctxEnzymeSite.enzyme.name + ' restriction enzyme')}`, '_blank')
          setCtxMenu(null)
        }

        return (
          <ContextMenuPopup x={ctxMenu.x} y={ctxMenu.y}>
            {/* Embedded tooltip content */}
            {ctxAnn && (
              <div className="ctx-menu-tooltip-embed">
                <AnnotationTooltipContent ann={ctxAnn} sequence={doc.sequence} />
              </div>
            )}
            {ctxEnzymeGroup && (
              <div className="ctx-menu-tooltip-embed ctx-menu-tooltip-enzyme">
                <EnzymeGroupTooltipContent group={ctxEnzymeGroup} />
              </div>
            )}

            {/* Annotation actions */}
            {ctxAnn && (
              <>
                <button className="ctx-menu-item" onClick={handleSelectAnnotation}>
                  Select Annotation
                </button>
                <button className="ctx-menu-item" onClick={handleCopyAnnotationBases}>
                  Copy Annotation Bases
                </button>
                {/* Shown on exactly the features whose translation the popover
                    above is already displaying. */}
                {canTranslateAnnotation(ctxAnn, doc.sequence) && (
                  <button className="ctx-menu-item" onClick={handleCopyAnnotationProtein}>
                    Copy Amino Acid Sequence
                  </button>
                )}
                {isUserAnn && !readOnly && (
                  <button className="ctx-menu-item" onClick={handleEditAnnotation}>
                    Edit Annotation
                  </button>
                )}
                {isUserAnn && !readOnly && (
                  <button className="ctx-menu-item ctx-menu-danger" onClick={handleDeleteAnnotation}>
                    Delete Annotation
                  </button>
                )}
                <div className="ctx-menu-sep" />
              </>
            )}

            {/* Enzyme actions */}
            {ctxEnzymeGroup && (
              <>
                <button className="ctx-menu-item" onClick={handleCopyRecognition}>
                  Copy Recognition Sequence
                </button>
                <button className="ctx-menu-item" onClick={handleSelectRecognition}>
                  Select Recognition Site
                </button>
                <button className="ctx-menu-item" onClick={handleLookupEnzyme}>
                  Look Up Enzyme…
                </button>
                <div className="ctx-menu-sep" />
              </>
            )}

            {/* Selection actions */}
            {hasSelection && (
              <>
                <button className="ctx-menu-item" onClick={handleCopy}>
                  Copy Selection
                </button>
                <button className="ctx-menu-item" onClick={handleCopyRevComp}>
                  Copy Reverse Complement
                </button>
                <button className="ctx-menu-item" onClick={handleCopyProtein}>
                  Copy Protein Translation
                </button>
                <div className="ctx-menu-sep" />
              </>
            )}
            {!readOnly && hasSelection && (
              <button className="ctx-menu-item" onClick={handleAddAnnotation}>
                Add Annotation to Selection
              </button>
            )}
          </ContextMenuPopup>
        )
      })()}

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

/** Memoised for the same reason as SequenceView — see the note there. */
export default memo(PlasmidMap)
