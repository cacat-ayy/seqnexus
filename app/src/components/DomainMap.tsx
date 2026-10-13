/**
 * The linear domain map of a protein: the chain, its features in lanes,
 * sites as lollipops, disulfides as brackets. Drawn from the same display
 * list the plasmid map uses, in the plasmid map's style and palette, and
 * exported through the same PNG and SVG paths. Hover a feature for its
 * card, click it to select its residues.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { useEditorStore } from '../store'
import { buildDomainMapScene, type DomainMapInput } from '../protein/domain-map'
import type { PlasmidScene } from '../plasmid/scene'
import { renderSceneToCanvas } from '../plasmid/renderCanvas'
import { hitTestScene } from '../plasmid/hit'
import type { MapFigureOptions } from '../plasmid/exportImage'
import MapFigureDialog from './MapFigureDialog'
import { getPlasmidStyle, resolvePlasmidColors, type PlasmidColors } from '../plasmid/styles'
import { printPlasmidColors } from '../pdf/print-colors'
import { measureText } from '../utils/measure-text'
import { displayPosition } from '../models/Document'
import { useDelayedHover } from '../hooks/useDelayedHover'
import AnnotationTooltip from './AnnotationTooltip'

interface Props {
  /** Ask for a filename before writing an export. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
  /** Draw at the container's height as well as its width (the Map view); otherwise at the map's own height. */
  fill?: boolean
}

interface HoverTarget { x: number; y: number; key: string }

/** The default width of an exported domain map, in CSS pixels, whatever the panel's width. */
const DOMAIN_FIGURE_WIDTH = 960

export default function DomainMap({ onExportPrompt, fill }: Props) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const hoveredAnnotationId = useEditorStore(s => s.hoveredAnnotationId)
  const setHoveredAnnotation = useEditorStore(s => s.setHoveredAnnotation)
  const setSelection = useEditorStore(s => s.setSelection)
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds)
  const plasmidStyleId = useEditorStore(s => s.plasmidStyle)
  const style = useMemo(() => getPlasmidStyle(plasmidStyleId), [plasmidStyleId])

  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [figureOpen, setFigureOpen] = useState(false)
  const { target: tooltip, show: showTooltip, hide: hideTooltip } = useDelayedHover<HoverTarget>()

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Colours follow the theme; a theme switch is an attribute change on the root.
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => {
    const root = containerRef.current?.closest('.app-root')
    if (!root) return
    const mo = new MutationObserver(() => setThemeVersion(v => v + 1))
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  const [colors, setColors] = useState<PlasmidColors | null>(null)
  useEffect(() => { setColors(resolvePlasmidColors(style, containerRef.current)) }, [style, themeVersion])

  const features = useMemo(() => {
    const hidden = new Set(hiddenAnnotationIds)
    return doc.annotations.filter(a => !hidden.has(a.id))
  }, [doc.annotations, hiddenAnnotationIds])

  const sceneInput = useMemo<DomainMapInput | null>(() => {
    if (width <= 0 || !colors) return null
    const [s, e] = [Math.min(selection.anchor, selection.caret), Math.max(selection.anchor, selection.caret)]
    return {
      width,
      seqLen: doc.sequence.length,
      name: doc.name,
      description: doc.description,
      firstNumber: displayPosition(0, doc.metadata?.displayOrigin ?? 0, doc.sequence.length),
      features,
      style,
      colors,
      measureText,
      hoveredAnnotationId,
      selection: e > s ? [s, e] : null,
    }
  }, [width, colors, doc.sequence.length, doc.name, doc.description, doc.metadata, features, style, hoveredAnnotationId, selection])
  const scene = useMemo(() => (sceneInput ? buildDomainMapScene(sceneInput) : null), [sceneInput])

  const sceneRef = useRef<PlasmidScene | null>(null)
  sceneRef.current = scene
  const sceneInputRef = useRef(sceneInput)
  sceneInputRef.current = sceneInput

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !scene) return
    const dpr = window.devicePixelRatio || 1
    const h = scene.height ?? scene.size
    canvas.width = Math.round(scene.size * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${scene.size}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    renderSceneToCanvas(ctx, scene)
  }, [scene])

  const hitAt = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    const s = sceneRef.current
    if (!canvas || !s) return null
    const r = canvas.getBoundingClientRect()
    return hitTestScene(s, e.clientX - r.left, e.clientY - r.top)
  }, [])

  const handleMove = useCallback((e: React.MouseEvent) => {
    const hit = hitAt(e)
    const id = hit?.kind === 'box' ? hit.id : null
    if (id !== useEditorStore.getState().hoveredAnnotationId) setHoveredAnnotation(id)
    if (id) showTooltip({ x: e.clientX + 12, y: e.clientY - 10, key: id })
    else hideTooltip()
    if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'default'
  }, [hitAt, setHoveredAnnotation, showTooltip, hideTooltip])

  const handleLeave = useCallback(() => {
    if (useEditorStore.getState().hoveredAnnotationId) setHoveredAnnotation(null)
    hideTooltip()
  }, [setHoveredAnnotation, hideTooltip])

  const handleClick = useCallback((e: React.MouseEvent) => {
    const hit = hitAt(e)
    if (hit?.kind !== 'box') return
    const ann = doc.annotations.find(a => a.id === hit.id)
    if (ann) setSelection({ anchor: ann.start, caret: ann.end })
  }, [hitAt, doc.annotations, setSelection])

  // The map as a figure: drawn again at a fixed width, nothing hovered, the
  // selection only when asked for (see MapFigureDialog).
  const buildFigure = useCallback((o: MapFigureOptions): PlasmidScene | null => {
    const input = sceneInputRef.current
    if (!input) return null
    return buildDomainMapScene({
      ...input,
      width: o.size ?? DOMAIN_FIGURE_WIDTH,
      colors: o.print === false ? input.colors : printPlasmidColors(input.style),
      ...(o.measureText ? { measureText: o.measureText } : {}),
      hoveredAnnotationId: null,
      selection: o.highlights ? input.selection : null,
    })
  }, [])

  const hoveredAnn = tooltip ? doc.annotations.find(a => a.id === tooltip.key) ?? null : null

  return (
    <div ref={containerRef} className={`domain-map ${fill ? 'domain-map-fill' : ''}`}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        onClick={handleClick}
      />
      <div className="plasmid-tools">
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
          name={`${doc.name || 'protein'}-domains`}
          sizes={[720, DOMAIN_FIGURE_WIDTH, 1280]}
          defaultSize={DOMAIN_FIGURE_WIDTH}
          hasHighlights={selection.anchor !== selection.caret}
          build={buildFigure}
          onClose={() => setFigureOpen(false)}
          onExportPrompt={onExportPrompt}
        />
      )}
      {tooltip && hoveredAnn && (
        <AnnotationTooltip ann={hoveredAnn} sequence={doc.sequence} x={tooltip.x} y={tooltip.y} />
      )}
    </div>
  )
}
