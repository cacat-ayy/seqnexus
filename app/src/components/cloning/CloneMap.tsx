/**
 * A part or a product drawn as the plasmid map the sequence view draws.
 *
 * Same scene, same renderer, same style preset as the map view, so a vector
 * looks here the way it looks when it is open: features in their colours and
 * rings, the ruler, the cut sites inside the backbone. What differs is what a
 * click means. The map view moves the caret; here a click on a site cuts
 * there, and a click anywhere else on the molecule chooses the piece of the
 * digest that point belongs to.
 *
 * It reads nothing from the open document. The workspace hands it the
 * sequence, the sites and the stretches to mark, which is what lets several
 * maps (one per part and one for the product) exist side by side.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Maximize2 } from 'lucide-react'
import { useEditorStore } from '../../store'
import { Annotation, type AnnotationData } from '../../models/Annotation'
import { buildPlasmidScene, type PlasmidScene, type PlasmidSceneInput, type SceneEnzymeGroup } from '../../plasmid/scene'
import { renderSceneToCanvas, type Viewport } from '../../plasmid/renderCanvas'
import { getPlasmidStyle, resolvePlasmidColors } from '../../plasmid/styles'
import { angleToPos, stackAnnotations } from '../../plasmid/geometry'
import { hitTestScene } from '../../plasmid/hit'
import { FIGURE_SIZE, figureSceneInput, type MapFigureOptions } from '../../plasmid/exportImage'
import MapFigureDialog from '../MapFigureDialog'
import { gcPercent } from '../../primers/thermodynamics'
import type { MapSite } from '../../cloning/sites'
import { measureText } from '../../utils/measure-text'

export interface MapRegion {
  start: number
  end: number
  color: string
}

interface Props {
  name: string
  bases: string
  topology: 'linear' | 'circular'
  annotations: readonly AnnotationData[]
  sites?: readonly MapSite[]
  /** Keys of the sites drawn as chosen. */
  picked?: ReadonlySet<string>
  regions?: readonly MapRegion[]
  /** A line in the middle under the length, e.g. what is being kept. */
  note?: string
  /** A click on a cut site; `additive` with Shift held. */
  onSite?: (site: MapSite, additive: boolean) => void
  /** A click on the molecule away from a site, as a base position. */
  onPosition?: (pos: number) => void
  /** What a click on a site does, for its hover card. */
  siteHint?: (site: MapSite) => string | null
  /** Offer PNG and SVG export under this file name. */
  exportName?: string
}

const MIN_ZOOM = 1
const MAX_ZOOM = 6
const FIT: Viewport = { scale: 1, tx: 0, ty: 0 }

interface Tip {
  x: number
  y: number
  lines: string[]
}

function CloneMap({
  name, bases, topology, annotations, sites = [], picked, regions, note,
  onSite, onPosition, siteHint, exportName,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const styleId = useEditorStore(s => s.plasmidStyle)
  const layout = useEditorStore(s => s.plasmidLayout)
  const style = useMemo(() => getPlasmidStyle(styleId), [styleId])

  // The map fills the panel rather than the largest square inside it: the
  // circle is the same size either way, drawn from the shorter side, and the
  // width left over is where the names go instead of being cut short.
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState<Viewport>(FIT)
  const [hoveredSite, setHoveredSite] = useState<string | null>(null)
  const [hoveredFeature, setHoveredFeature] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const [figureOpen, setFigureOpen] = useState(false)
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  // A new molecule opens fitted.
  useEffect(() => { setViewport(FIT) }, [bases, topology])

  // The palette lives in CSS custom properties React cannot see; re-resolve
  // it when the theme attribute changes, as PlasmidMap does.
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => {
    const root = containerRef.current?.closest('.app-root')
    if (!root) return
    const mo = new MutationObserver(() => setThemeVersion(v => v + 1))
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setSize(prev => {
      const next = { width: Math.floor(el.clientWidth), height: Math.floor(el.clientHeight) }
      return prev.width === next.width && prev.height === next.height ? prev : next
    })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const features = useMemo(() => annotations.map(a => new Annotation(a)), [annotations])
  const rings = useMemo(() => stackAnnotations(features), [features])
  const featureById = useMemo(() => new Map(features.map(f => [f.id, f])), [features])
  const siteByKey = useMemo(() => new Map(sites.map(s => [s.key, s])), [sites])
  const gc = useMemo(() => (bases.length > 0 ? gcPercent(bases) : null), [bases])
  const enzymeGroups = useMemo((): SceneEnzymeGroup[] =>
    sites.map(s => ({ key: s.key, label: s.label, cutPos: s.cutPos, methEffect: s.methEffect })), [sites])

  const sceneInput = useMemo<PlasmidSceneInput | null>(() => {
    if (size.width <= 0 || size.height <= 0) return null
    return {
      size: size.width,
      height: size.height,
      seqLen: bases.length,
      name,
      topology,
      displayOrigin: 0,
      style,
      colors: resolvePlasmidColors(style, containerRef.current),
      measureText,
      rings,
      hoveredAnnotationId: hoveredFeature,
      proposalIds: new Set(),
      pickedIds: new Set(),
      enzymeGroups,
      hoveredEnzymeKey: hoveredSite,
      primers: [],
      selection: { anchor: 0, caret: 0 },
      selectionSpansOrigin: false,
      selectionLength: 0,
      methylation: { dam: [], dcm: [] },
      gc: null,
      gcPercent: gc,
      legend: null,
      ...(picked ? { pickedEnzymeKeys: picked } : {}),
      ...(regions ? { regions } : {}),
      ...(note ? { centreNote: note } : {}),
      showCaret: false,
      openEnds: true,
      layout,
    }
    // themeVersion re-resolves the colours on a theme switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, bases.length, name, topology, style, layout, rings, hoveredFeature, enzymeGroups, hoveredSite, gc, picked, regions, note, themeVersion])
  const scene = useMemo(() => (sceneInput ? buildPlasmidScene(sceneInput) : null), [sceneInput])

  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const dpr = window.devicePixelRatio || 1
    const sceneHeight = scene.height ?? scene.size
    const px = Math.round(scene.size * dpr)
    const py = Math.round(sceneHeight * dpr)
    if (canvas.width !== px || canvas.height !== py) {
      canvas.width = px
      canvas.height = py
      canvas.style.width = `${scene.size}px`
      canvas.style.height = `${sceneHeight}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderSceneToCanvas(ctx, scene, viewport)
  }, [scene, viewport])

  /** A pointer event in scene coordinates, undoing the zoom. */
  const toScene = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    const s = sceneRef.current
    if (!canvas || !s) return null
    const rect = canvas.getBoundingClientRect()
    const vp = viewportRef.current
    const halfX = s.size / 2
    const halfY = (s.height ?? s.size) / 2
    return {
      x: (clientX - rect.left - vp.tx - halfX) / vp.scale + halfX,
      y: (clientY - rect.top - vp.ty - halfY) / vp.scale + halfY,
      scene: s,
    }
  }, [])

  const hitTest = useCallback((x: number, y: number, s: PlasmidScene) => hitTestScene(s, x, y), [])

  /** The base under a point on or near the molecule, or null in the middle. */
  const positionAt = useCallback((x: number, y: number, s: PlasmidScene): number | null => {
    const cx = s.size / 2
    const cy = (s.height ?? s.size) / 2
    const dist = Math.hypot(x - cx, y - cy)
    if (dist < s.baseRadius * 0.6 || dist > s.baseRadius * 1.8 || bases.length === 0) return null
    return angleToPos(Math.atan2(y - cy, x - cx), bases.length)
  }, [bases.length])

  const onMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (panRef.current) {
      const p = panRef.current
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true
      setViewport(v => ({ ...v, tx: p.tx + dx, ty: p.ty + dy }))
      return
    }
    const pt = toScene(e.clientX, e.clientY)
    if (!pt) return
    const hit = hitTest(pt.x, pt.y, pt.scene)
    const box = containerRef.current!.getBoundingClientRect()
    // The card clips, so near its right or bottom edge the hover card goes
    // the other side of the pointer.
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    const at = {
      x: px + 280 > box.width ? Math.max(4, px - 274) : px + 14,
      y: py + 90 > box.height ? Math.max(4, py - 80) : py + 12,
    }

    if (hit?.type === 'enzyme') {
      const site = siteByKey.get(hit.id)
      setHoveredSite(hit.id)
      setHoveredFeature(null)
      if (site) {
        const hint = siteHint?.(site)
        setTip({
          ...at,
          lines: [
            site.label,
            `at ${(site.position + 1).toLocaleString('en-US')}${site.cuts > 1 ? `, one of ${site.cuts} sites` : ', its only site'}`,
            ...(site.methEffect ? [`blocked by methylation${site.methEffect === 'impaired' ? ' (in part)' : ''}`] : []),
            ...(hint ? [hint] : []),
          ],
        })
      }
      canvas.style.cursor = onSite ? 'pointer' : 'default'
      return
    }
    setHoveredSite(null)
    if (hit?.type === 'feature') {
      const f = featureById.get(hit.id)
      setHoveredFeature(hit.id)
      if (f) {
        setTip({
          ...at,
          lines: [f.name, `${f.type} · ${(f.start + 1).toLocaleString('en-US')}..${f.end.toLocaleString('en-US')}`],
        })
      }
    } else {
      setHoveredFeature(null)
      setTip(null)
    }
    const onMolecule = onPosition && positionAt(pt.x, pt.y, pt.scene) !== null
    canvas.style.cursor = onMolecule ? 'pointer' : viewportRef.current.scale > 1 ? 'grab' : 'default'
  }

  const onMouseLeave = () => {
    setHoveredSite(null)
    setHoveredFeature(null)
    setTip(null)
    panRef.current = null
  }

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || viewportRef.current.scale <= 1) return
    const pt = toScene(e.clientX, e.clientY)
    if (!pt || hitTest(pt.x, pt.y, pt.scene)) return
    panRef.current = { x: e.clientX, y: e.clientY, tx: viewportRef.current.tx, ty: viewportRef.current.ty, moved: false }
  }

  const onMouseUp = () => {
    // A drag that panned is not also a click on the molecule.
    if (panRef.current?.moved) suppressClick.current = true
    panRef.current = null
  }
  const suppressClick = useRef(false)

  const onClick = (e: React.MouseEvent) => {
    if (suppressClick.current) { suppressClick.current = false; return }
    const pt = toScene(e.clientX, e.clientY)
    if (!pt) return
    const hit = hitTest(pt.x, pt.y, pt.scene)
    if (hit?.type === 'enzyme') {
      const site = siteByKey.get(hit.id)
      if (site && onSite) onSite(site, e.shiftKey)
      return
    }
    const pos = positionAt(pt.x, pt.y, pt.scene)
    if (pos !== null && onPosition) onPosition(pos)
  }

  // Wheel zoom about the pointer. Attached by hand because React's wheel
  // listener is passive and cannot stop the panel scrolling.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const wheel = (e: WheelEvent) => {
      const s = sceneRef.current
      if (!s) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setViewport(v => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
        if (next === v.scale) return v
        if (next === MIN_ZOOM) return FIT
        const halfX = s.size / 2
        const halfY = (s.height ?? s.size) / 2
        const k = next / v.scale
        return { scale: next, tx: px - k * (px - v.tx - halfX) - halfX, ty: py - k * (py - v.ty - halfY) - halfY }
      })
    }
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => canvas.removeEventListener('wheel', wheel)
  }, [])

  // The whole map as a figure, drawn again for the file (see figureSceneInput).
  // The design's marked parts and picked sites are part of the map and stay.
  const sceneInputRef = useRef(sceneInput)
  sceneInputRef.current = sceneInput
  const buildFigure = useCallback((o: MapFigureOptions) => {
    const input = sceneInputRef.current
    return input ? buildPlasmidScene(figureSceneInput(input, o)) : null
  }, [])

  return (
    <div ref={containerRef} className="cm">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${name}, ${bases.length.toLocaleString('en-US')} bp ${topology}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onDoubleClick={() => setViewport(FIT)}
      />
      <div className="plasmid-tools">
        {viewport.scale > 1 && (
          <button className="plasmid-tool" onClick={() => setViewport(FIT)} title="Fit the map" aria-label="Fit the map">
            <Maximize2 size={13} />
          </button>
        )}
        {exportName && (
          <button
            className="plasmid-tool"
            onClick={() => setFigureOpen(true)}
            title="Export figure (SVG, PNG or PDF)"
            aria-label="Export figure"
          >
            <Download size={13} />
          </button>
        )}
      </div>
      {figureOpen && exportName && (
        <MapFigureDialog
          name={`${exportName}-map`}
          sizes={[480, FIGURE_SIZE, 1080]}
          defaultSize={FIGURE_SIZE}
          hasHighlights={false}
          build={buildFigure}
          onClose={() => setFigureOpen(false)}
        />
      )}
      {tip && (
        <div className="cm-tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.lines.map((line, i) => <div key={i} className={i === 0 ? 'cm-tip-title' : ''}>{line}</div>)}
        </div>
      )}
    </div>
  )
}

export default memo(CloneMap)
