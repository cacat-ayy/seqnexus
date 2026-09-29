/**
 * Thumbnails for the hover card.
 *
 * The plasmid one is cheap because the scene layer is already decoupled from
 * PlasmidMap: `buildPlasmidScene` produces a list of draw commands and
 * `renderSceneToCanvas` paints them, neither of which knows anything about
 * the component. A thumbnail is the same call with the overlays switched off.
 *
 * The read one is drawn here rather than reusing InlineChromatogram, which
 * needs a `ReadMapping` from a contig and so is not usable standalone.
 */

import { memo, useEffect, useRef } from 'react'
import type { DocumentState } from '../../models/Document'
import type { Ab1Data } from '../../io/ab1'
import { buildPlasmidScene } from '../../plasmid/scene'
import { renderSceneToCanvas } from '../../plasmid/renderCanvas'
import { getPlasmidStyle, resolvePlasmidColors } from '../../plasmid/styles'
import { stackAnnotations } from '../../plasmid/geometry'
import { LOW_QUALITY_THRESHOLD } from '../../explorer/kinds'

const SIZE = 132

/** Shared text measurer, matching PlasmidMap's. */
let measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

export const PlasmidThumbnail = memo(function PlasmidThumbnail({ doc }: { doc: DocumentState }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const style = getPlasmidStyle(undefined)
    const scene = buildPlasmidScene({
      size: SIZE,
      seqLen: doc.sequence.length,
      name: doc.name,
      topology: doc.sequence.topology,
      displayOrigin: (doc.sequence.topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0,
      style,
      colors: resolvePlasmidColors(style, canvas),
      measureText,
      rings: stackAnnotations(doc.annotations),
      // Everything optional is off: at 132px the overlays are noise, and
      // leaving them out keeps the build cheap enough to do on hover.
      hoveredAnnotationId: null,
      proposalIds: new Set(),
      pickedIds: new Set(),
      enzymeGroups: [],
      hoveredEnzymeKey: null,
      primers: [],
      selection: { anchor: 0, caret: 0 },
      selectionSpansOrigin: false,
      selectionLength: 0,
      methylation: { dam: [], dcm: [] },
      gc: null,
      gcPercent: null,
      legend: null,
    })
    renderSceneToCanvas(ctx, scene)
  }, [doc])

  return <canvas ref={ref} className="ex-preview-canvas" style={{ width: SIZE, height: SIZE }} />
})

/**
 * Quality track for a read, with the trimmed-away ends shaded.
 *
 * More useful at this size than a trace: the question a thumbnail answers is
 * "is this read any good and did the trim catch the bad part", and the trace
 * cannot show either at 30px tall.
 */
export const QualitySparkline = memo(function QualitySparkline({
  data, trimStart, trimEnd,
}: { data: Ab1Data; trimStart: number; trimEnd: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const width = SIZE
  const height = 34

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const scores = data.qualityScores
    if (scores.length === 0) return
    const maxQ = 60
    const xOf = (i: number) => (i / (scores.length - 1 || 1)) * width

    // Trimmed ends first, behind the curve.
    ctx.fillStyle = 'rgba(128,128,128,0.18)'
    if (trimStart > 0) ctx.fillRect(0, 0, xOf(trimStart), height)
    if (trimEnd < scores.length) ctx.fillRect(xOf(trimEnd), 0, width - xOf(trimEnd), height)

    // The Q20 line, so the curve has something to be read against.
    ctx.strokeStyle = 'rgba(128,128,128,0.4)'
    ctx.setLineDash([2, 2])
    ctx.beginPath()
    const q20y = height - (LOW_QUALITY_THRESHOLD / maxQ) * height
    ctx.moveTo(0, q20y)
    ctx.lineTo(width, q20y)
    ctx.stroke()
    ctx.setLineDash([])

    // One sample per pixel column: a 900 base read into 132px otherwise
    // draws nine hundred line segments for no visible gain.
    ctx.strokeStyle = 'var(--accent)'
    ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('color') || '#6366f1'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let px = 0; px < width; px++) {
      const i = Math.floor((px / width) * scores.length)
      const y = height - (Math.min(scores[i], maxQ) / maxQ) * height
      if (px === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()
  }, [data, trimStart, trimEnd, width, height])

  return <canvas ref={ref} className="ex-preview-canvas" style={{ width, height }} />
})
