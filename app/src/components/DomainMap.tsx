/**
 * The linear domain map of a protein: the chain, its features in lanes,
 * sites as lollipops, disulfides as brackets. Drawn from the same display
 * list the plasmid map uses, in the plasmid map's style and palette, and
 * exported through the same PNG and SVG paths. Hover a feature for its
 * card, click it to select its residues.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Image as ImageIcon, FileCode2 } from 'lucide-react'
import { useEditorStore } from '../store'
import { buildDomainMapScene } from '../protein/domain-map'
import type { PlasmidScene } from '../plasmid/scene'
import { renderSceneToCanvas } from '../plasmid/renderCanvas'
import { hitTestScene } from '../plasmid/hit'
import { plasmidToPng, plasmidToSvgBlob } from '../plasmid/exportImage'
import { getPlasmidStyle, resolvePlasmidColors, type PlasmidColors } from '../plasmid/styles'
import { measureText } from '../utils/measure-text'
import { downloadBlob } from '../utils/download'
import { notify } from '../toast'
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
  const [exportOpen, setExportOpen] = useState(false)
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

  const scene = useMemo<PlasmidScene | null>(() => {
    if (width <= 0 || !colors) return null
    const [s, e] = [Math.min(selection.anchor, selection.caret), Math.max(selection.anchor, selection.caret)]
    return buildDomainMapScene({
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
    })
  }, [width, colors, doc.sequence.length, doc.name, doc.description, doc.metadata, features, style, hoveredAnnotationId, selection])

  const sceneRef = useRef<PlasmidScene | null>(null)
  sceneRef.current = scene

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

  const runExport = useCallback((kind: 'png' | 'svg') => {
    setExportOpen(false)
    const s = sceneRef.current
    if (!s) return
    const base = (doc.name || 'protein').replace(/[^\w.-]+/g, '_')
    const defaultName = `${base}-domains.${kind}`
    const write = async (filename: string) => {
      try {
        const blob = kind === 'png' ? await plasmidToPng(s) : plasmidToSvgBlob(s)
        downloadBlob(blob, filename)
        notify.success(`Exported ${filename}`)
      } catch (err) {
        notify.error('Could not export the map', { detail: err instanceof Error ? err.message : undefined })
      }
    }
    if (onExportPrompt) onExportPrompt(defaultName, name => { void write(name) })
    else void write(defaultName)
  }, [doc.name, onExportPrompt])

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
      {tooltip && hoveredAnn && (
        <AnnotationTooltip ann={hoveredAnn} sequence={doc.sequence} x={tooltip.x} y={tooltip.y} />
      )}
    </div>
  )
}
