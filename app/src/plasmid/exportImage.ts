/**
 * Turning a PlasmidScene into a file.
 *
 * Every path renders the scene at fit scale and ignores whatever zoom the
 * user has on screen, so an exported figure is never silently cropped to the
 * viewport they happened to be looking at.
 */

import type { PlasmidScene, PlasmidSceneInput } from './scene'
import { renderSceneToCanvas } from './renderCanvas'
import { renderSceneToSvg } from './renderSvg'
import { printPlasmidColors } from '../pdf/print-colors'
import { PdfDocument } from '../pdf/document'
import { asCanvasContext } from '../pdf/canvas'
import { pdfMeasure } from '../pdf/fonts'
import { canvasScale, type FigureFile } from '../utils/figure-file'

/**
 * The width of an exported map, in CSS pixels, by default: the same figure
 * whatever the size of the panel it was exported from (19 cm across).
 */
export const FIGURE_SIZE = 720

/** One CSS pixel in PDF points. */
const PT_PER_PX = 0.75

export interface MapFigureOptions {
  /** Across, in CSS pixels. */
  size?: number
  /** The light theme's colours on white, as the PDF prints them (the default), or the app's theme. */
  print?: boolean
  /** Keep the selection, search hits and other highlights of the moment. */
  highlights?: boolean
  /** Text widths in the fonts the file will use (the PDF's own for a PDF). */
  measureText?: (text: string, font: string) => number
}

/**
 * A map's scene inputs as a figure: at a fixed size, in print colours by
 * default, never with what the pointer is over or the caret, and without
 * the moment's highlights (selection, search hits) unless asked for. What
 * the map shows by choice, features, enzymes, primers, guides, the legend
 * and marked regions, stays; the sequence's map drops its regions itself
 * unless highlights are kept, since there they are the BLAST hit pointed at.
 */
export function figureSceneInput(input: PlasmidSceneInput, o: MapFigureOptions = {}): PlasmidSceneInput {
  const { size = FIGURE_SIZE, print = true, highlights = false } = o
  return {
    ...input,
    size,
    height: undefined,
    colors: print ? printPlasmidColors(input.style) : input.colors,
    ...(o.measureText ? { measureText: o.measureText } : {}),
    hoveredAnnotationId: null,
    hoveredEnzymeKey: null,
    hoveredGuideKey: null,
    showCaret: false,
    ...(highlights ? {} : {
      selectedGuideKey: null,
      selection: { anchor: 0, caret: 0 },
      selectionSpansOrigin: false,
      selectionLength: 0,
      extraSelections: [],
      searchHits: [],
      currentSearchHit: undefined,
    }),
  }
}

/** Text widths in the PDF's standard fonts, in the scene builders' argument order. */
export const pdfMeasureText = (text: string, font: string) => pdfMeasure(font, text)

export function plasmidToPng(scene: PlasmidScene, scale: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(scene.size * scale)
  canvas.height = Math.round((scene.height ?? scene.size) * scale)

  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Could not create a drawing context'))
  ctx.scale(scale, scale)
  renderSceneToCanvas(ctx, scene)

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not encode the image'))
    }, 'image/png')
  })
}

/**
 * The scene as a one-page vector PDF at its own size, drawn by the same
 * canvas renderer through the PDF context, as the sequence PDF's map page
 * is. The SVG route (pdf/svg-pdf.ts) would draw the map's arcs as straight
 * lines.
 */
export function plasmidToPdf(scene: PlasmidScene, title: string): Blob {
  const width = scene.size
  const height = scene.height ?? scene.size
  const doc = new PdfDocument({ title, subject: 'Map exported from SeqNexus' })
  const page = doc.addPage(width * PT_PER_PX, height * PT_PER_PX)
  page.scale(PT_PER_PX, PT_PER_PX)
  renderSceneToCanvas(asCanvasContext(page), scene)
  return doc.toBlob()
}

/**
 * A map scene for the figure dialogs' Save section. The PDF is laid out
 * again by `pdfScene`, with label widths measured in the PDF's fonts.
 */
export function sceneFigureFile(scene: PlasmidScene, pdfScene: () => PlasmidScene, title: string): FigureFile {
  const width = scene.size
  const height = scene.height ?? scene.size
  return {
    width,
    height,
    svg: () => renderSceneToSvg(scene),
    png: async s => {
      const scale = canvasScale(width, height, s)
      return { blob: await plasmidToPng(scene, scale), scale }
    },
    pdf: () => plasmidToPdf(pdfScene(), title),
  }
}
