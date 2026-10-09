/**
 * The sequence as a PDF: the text view's rows laid out on A4 pages, with an
 * optional plasmid map page and feature and enzyme tables.
 *
 * Planning and drawing are separate. planSequencePdf works out the layout
 * (which rows, how tall, which page each lands on) without drawing anything,
 * so the dialog can show the page count and redraw a preview page cheaply.
 * renderPdfPage draws one planned page into any 2D context: a canvas for the
 * preview, a PdfCanvas for the file. Both use the same painter as the screen.
 *
 * Units: the page is in points. The rows are laid out in the view's own
 * pixel units at a chosen width and scaled down to the page width, so the
 * letters, labels and bars keep the proportions they have on screen.
 */

import type { DocumentState } from '../models/Document'
import { displayPosition } from '../models/Document'
import type { Annotation } from '../models/Annotation'
import type { IntervalTree } from '../models/IntervalTree'
import type { Selection, SearchState } from '../store'
import { selectionSegments, selectionIsReverse } from '../store'
import { getLayout, getRenderMode, letterCellWidth, RowLayoutMap, type ZoomLayout } from '../components/zoom-layout'
import {
  paintSequenceRows, stackAnnotations, measureSiteRows, ENZYME_LABEL_SPEC, GRAPH_TRACK_H,
  type RowStack, type SequenceColors, type GraphTrack,
  type SelectionTranslation,
} from '../components/sequence-paint'
import type { GroupedCutSite } from '../enzymes/grouping'
import type { PrimerItem } from '../primers/display'
import type { GeneticCode } from '../codon/genetic-codes'
import type { AminoAcidStyleId, ReadingFrame } from '../codon/translation-display'
import type { PlasmidScene } from '../plasmid/scene'
import { renderSceneToCanvas } from '../plasmid/renderCanvas'
import { A4, PdfDocument } from './document'
import { asCanvasContext } from './canvas'
import { pdfMeasure } from './fonts'

/** CSS families the painters are given; fonts.ts maps them to Courier and Helvetica. */
export const PDF_FAMILIES = { mono: 'Courier, "Courier New", monospace', sans: 'Helvetica, Arial, sans-serif' }

/** Page margin, points. */
const MARGIN = 40
/** Header and footer bands, points. */
const HEADER_H = 24
const FOOTER_H = 18
/**
 * Feature lanes per printed line. The screen stops at four and says "+N
 * more", which a reader can hover; paper cannot, so print shows them all up
 * to a limit no real map reaches.
 */
const PRINT_MAX_LANES = 16
/**
 * Below letters zoom the view has no letter size to keep, so the row is laid
 * out at the width that prints its 10-11px labels at about 7 pt.
 */
const OVERVIEW_SCALE = 0.7
/** Tables. */
const TABLE_FONT = 8
const TABLE_LINE = 11
const TABLE_ROW_PAD = 3
/** More pages than this is a book, not a figure; the dialog asks for a smaller range. */
export const MAX_PDF_PAGES = 1500

/** Everything about the sequence and the view that the export reads. */
export interface SequencePdfSource {
  doc: DocumentState
  /** What the view lays out in its feature lanes: features, ORFs, primers, suggestions. */
  annTree: IntervalTree
  /** The document's own features (hidden ones left out), for the table. */
  features: readonly Annotation[]
  groupedSites: GroupedCutSite[]
  primerItemById: ReadonlyMap<string, PrimerItem>
  autoPicks: ReadonlySet<string>
  orfPicks: ReadonlySet<string>
  motifPicks: ReadonlySet<string>
  /** A protein's graph track as the view draws it; null when none is chosen. */
  graph: GraphTrack | null
  translationFrames: readonly ReadingFrame[]
  /** Translation rows the view reserves; 0 when the translation is off. */
  translationRows: number
  /** The view translates the selection (the automatic mode). */
  translateSelection: boolean
  translationCode: GeneticCode
  aminoAcidStyle: AminoAcidStyleId
  threeLetter: boolean
  basePalette: Record<string, string>
  paintBackground: boolean
  showComplement: boolean
  showAnnotations: boolean
  colors: SequenceColors
  selection: Selection
  search: SearchState
  zoomLevel: number
  /** Bases per row on screen right now; 0 when the view has not drawn. */
  screenBasesPerRow: number
  /** Builds the plasmid map at a size, in print colours; null when there is none. */
  plasmidScene: ((size: number) => PlasmidScene) | null
}

/** Bases to export, [start, end); start > end wraps through the origin. */
export interface PdfRange {
  start: number
  end: number
}

export interface SequencePdfOptions {
  range: PdfRange
  /** Bases per line at letters zoom; 0 keeps the screen's. */
  basesPerRow: number
  landscape: boolean
  /** Title, sequence facts and page numbers on every page. */
  header: boolean
  /** Draw the selection and search matches as the view shows them. */
  highlights: boolean
  /** Draw the selection's translation, when the view shows one. */
  selectionTranslation: boolean
  map: boolean
  features: boolean
  enzymes: boolean
  title: string
}

type TableId = 'features' | 'enzymes'

interface TableRow {
  cells: string[]
  /** Swatch colour before the first cell. */
  swatch?: string
  /** Lines of the last cell after wrapping. */
  lines: string[]
  height: number
}

type PageItem =
  | { kind: 'row'; row: number; y: number }
  | { kind: 'map'; x: number; y: number; size: number }
  | { kind: 'heading'; text: string; y: number }
  | { kind: 'tableHead'; table: TableId; y: number }
  | { kind: 'tableRow'; table: TableId; index: number; y: number }

export interface PdfPlan {
  source: SequencePdfSource
  options: SequencePdfOptions
  pageWidth: number
  pageHeight: number
  /** Export rows: the bases each shows. */
  rows: [number, number][]
  L: ZoomLayout
  rl: RowLayoutMap
  stacks: RowStack[]
  selTranslation: SelectionTranslation | null
  /** Layout px to points. */
  scale: number
  /** Width the rows are laid out at, layout px. */
  layoutWidth: number
  /** Size the sequence letters print at, points; 0 below letters zoom. */
  letterPt: number
  tables: Record<TableId, { columns: TableColumn[]; rows: TableRow[] }>
  pages: PageItem[][]
}

interface TableColumn {
  title: string
  /** Share of the table width. */
  weight: number
  align?: 'left' | 'right'
}

/** The range as non-wrapping [start, end) segments. */
export function rangeSegments(range: PdfRange, seqLen: number): [number, number][] {
  const s = Math.max(0, Math.min(range.start, seqLen))
  const e = Math.max(0, Math.min(range.end, seqLen))
  if (s < e) return [[s, e]]
  if (s === e) return []
  return e > 0 ? [[s, seqLen], [0, e]] : [[s, seqLen]]
}

/** Bases in a range. */
export function rangeLength(range: PdfRange, seqLen: number): number {
  return rangeSegments(range, seqLen).reduce((n, [s, e]) => n + e - s, 0)
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1

/** Whether a feature covers any base of the segments. */
function annotationInRange(ann: Annotation, segs: [number, number][], seqLen: number): boolean {
  const parts: [number, number][] = ann.start < ann.end ? [[ann.start, ann.end]] : [[ann.start, seqLen], [0, ann.end]]
  return parts.some(([a, b]) => segs.some(([s, e]) => overlaps(a, b, s, e)))
}

/** The bases the selection's translation reads and which way; null without any. */
function selectionTranslationOf(sel: Selection, topology: string, seqLen: number): SelectionTranslation | null {
  const segments = selectionSegments(sel, topology, seqLen)
  if (segments.length === 0) return null
  return { segments, reverse: selectionIsReverse(sel, topology) }
}

function selectionTouches(t: SelectionTranslation, rs: number, re: number): boolean {
  return t.segments.some(([s, e]) => overlaps(s, e, rs, re))
}

/** "1..120" in display positions, joined for split features. */
function locationText(ann: Annotation, seqLen: number, origin: number): string {
  const dp = (p: number) => displayPosition(p, origin, seqLen).toLocaleString()
  const parts = ann.segments ?? [[ann.start, ann.end]]
  return parts.map(([s, e]) => `${dp(s)}..${dp((e - 1 + seqLen) % seqLen)}`).join(', ')
}

/** Truncate text to a width with an ellipsis. */
function fit(text: string, font: string, width: number): string {
  if (pdfMeasure(font, text) <= width) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pdfMeasure(font, `${text.slice(0, mid)}…`) <= width) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo)}…`
}

/** Comma-separated items wrapped to a width. */
function wrapList(items: string[], font: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const item of items) {
    const next = line ? `${line}, ${item}` : item
    if (line && pdfMeasure(font, `${next},`) > width) {
      lines.push(`${line},`)
      line = item
    } else line = next
  }
  if (line) lines.push(line)
  return lines.length > 0 ? lines : ['']
}

const tableFont = (bold = false) => `${bold ? '700 ' : ''}${TABLE_FONT}px ${PDF_FAMILIES.sans}`

function columnXs(columns: TableColumn[], x0: number, width: number): { x: number; w: number }[] {
  const total = columns.reduce((n, c) => n + c.weight, 0)
  let x = x0
  return columns.map(c => {
    const w = (c.weight / total) * width
    const out = { x, w }
    x += w
    return out
  })
}

function buildTables(src: SequencePdfSource, segs: [number, number][], contentW: number): PdfPlan['tables'] {
  const seqLen = src.doc.sequence.length
  const origin = (src.doc.sequence.topology === 'circular' ? src.doc.metadata?.displayOrigin : 0) || 0
  const dp = (p: number) => displayPosition(p, origin, seqLen).toLocaleString()
  const CELL_PAD = 4

  const featureColumns: TableColumn[] = [
    { title: 'Feature', weight: 30 }, { title: 'Type', weight: 16 },
    { title: 'Location', weight: 30 }, { title: 'Length', weight: 12, align: 'right' },
    { title: 'Strand', weight: 12 },
  ]
  const fx = columnXs(featureColumns, 0, contentW)
  const featureRows: TableRow[] = src.features
    .filter(a => annotationInRange(a, segs, seqLen))
    .map(a => {
      const cells = [
        a.name || '(unnamed)', a.type, locationText(a, seqLen, origin),
        `${a.span(seqLen).toLocaleString()} bp`,
        a.strand === 1 ? 'forward' : a.strand === -1 ? 'reverse' : '',
      ].map((t, i) => fit(t, tableFont(), fx[i].w - CELL_PAD * 2 - (i === 0 ? 10 : 0)))
      return { cells, swatch: a.color, lines: [cells[cells.length - 1]], height: TABLE_LINE + TABLE_ROW_PAD }
    })

  const enzymeColumns: TableColumn[] = [
    { title: 'Enzyme', weight: 18 }, { title: 'Site', weight: 18 },
    { title: 'Cuts', weight: 8, align: 'right' }, { title: 'Cuts after base', weight: 56 },
  ]
  const ex = columnXs(enzymeColumns, 0, contentW)
  const byLabel = new Map<string, GroupedCutSite[]>()
  for (const g of src.groupedSites) {
    if (!segs.some(([s, e]) => g.fwdCut >= s && g.fwdCut < e)) continue
    const list = byLabel.get(g.label)
    if (list) list.push(g)
    else byLabel.set(g.label, [g])
  }
  const enzymeRows: TableRow[] = [...byLabel]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groups]) => {
      const positions = groups
        .sort((a, b) => a.fwdCut - b.fwdCut)
        .map(g => {
          // A cut at 0 is the origin of a circular sequence: after its last base.
          const after = dp((g.fwdCut - 1 + seqLen) % seqLen)
          return g.methEffect ? `${after} (${g.methEffect})` : after
        })
      const site = groups[0].sites[0]?.enzyme.recognition ?? ''
      const lines = wrapList(positions, tableFont(), ex[3].w - CELL_PAD * 2)
      return {
        cells: [fit(label, tableFont(), ex[0].w - CELL_PAD * 2), fit(site, tableFont(), ex[1].w - CELL_PAD * 2), String(groups.length), lines[0]],
        lines,
        height: lines.length * TABLE_LINE + TABLE_ROW_PAD,
      }
    })

  return {
    features: { columns: featureColumns, rows: featureRows },
    enzymes: { columns: enzymeColumns, rows: enzymeRows },
  }
}

/** Lay out the export. Cheap enough to rerun on every option change. */
export function planSequencePdf(src: SequencePdfSource, opts: SequencePdfOptions): PdfPlan {
  const pageWidth = opts.landscape ? A4.height : A4.width
  const pageHeight = opts.landscape ? A4.width : A4.height
  const contentW = pageWidth - MARGIN * 2
  const top = MARGIN + (opts.header ? HEADER_H : 0)
  const bottom = pageHeight - MARGIN - (opts.header ? FOOTER_H : 0)
  const seqLen = src.doc.sequence.length
  const segs = rangeSegments(opts.range, seqLen)

  // --- Layout, in the view's pixel units ---
  const z = src.zoomLevel
  const mode = getRenderMode(z)
  const showEnzymes = src.groupedSites.length > 0
  const toggles = {
    showComplement: src.showComplement,
    showAnnotations: src.showAnnotations,
    translationRows: src.translationRows,
    graphHeight: src.graph ? GRAPH_TRACK_H : 0,
  }
  let layoutWidth: number
  let L: ZoomLayout
  if (mode === 'letters') {
    const bpr = Math.max(10, opts.basesPerRow || src.screenBasesPerRow || 60)
    // The screen's cell width at this zoom, so letters keep their spacing.
    const probe = getLayout(z, 1000, showEnzymes, seqLen, toggles)
    layoutWidth = probe.leftMargin + bpr * letterCellWidth(z) + 20
    L = getLayout(z, layoutWidth, showEnzymes, seqLen, { ...toggles, basesPerRow: bpr })
  } else {
    layoutWidth = contentW / OVERVIEW_SCALE
    L = getLayout(z, layoutWidth, showEnzymes, seqLen, toggles)
  }
  if (L.maxAnnotationRows > 0) L = { ...L, maxAnnotationRows: PRINT_MAX_LANES }
  // Never enlarge past the screen size: a short line fills part of the width.
  const scale = Math.min(1, contentW / layoutWidth)

  // --- Rows ---
  const rows: [number, number][] = []
  for (const [s, e] of segs) {
    for (let r = s; r < e; r += L.basesPerRow) rows.push([r, Math.min(r + L.basesPerRow, e)])
  }
  const selTranslation = opts.selectionTranslation && src.translateSelection && L.maxTranslationRows > 0
    ? selectionTranslationOf(src.selection, src.doc.sequence.topology, seqLen)
    : null
  const perRowTranslations = src.translationFrames.length === 0
  const rl = new RowLayoutMap(rows.length)
  const stacks: RowStack[] = rows.map(([rs, re], i) => {
    const stack = stackAnnotations(src.annTree.queryRange(rs, re), rs, re, L)
    rl.lanes[i] = Math.min(stack.rows.length, L.maxAnnotationRows)
    if (perRowTranslations) {
      // One translation row per coding feature in a lane, as the view does,
      // plus the selection's where it reaches this line.
      const cds = L.maxAnnotationRows > 0
        ? stack.rows.reduce((n, lane) => n + lane.filter(a => a.type === 'CDS' && a.strand !== 0).length, 0)
        : 0
      const sel = selTranslation && selectionTouches(selTranslation, rs, re) ? 1 : 0
      rl.translations[i] = Math.min(cds + sel, 6)
    }
    return stack
  })
  rl.perRowTranslations = perRowTranslations
  // Each line gets the rows of cut-site names and lanes of site bars it
  // needs, measured in the PDF's own font, exactly as the painter lays them out.
  measureSiteRows(rl, src.groupedSites, i => rows[i], L, t => pdfMeasure(`${ENZYME_LABEL_SPEC} ${PDF_FAMILIES.sans}`, t))
  rl.build(L)

  // --- Pages ---
  const pages: PageItem[][] = []
  let page: PageItem[] = []
  let y = top
  const newPage = () => {
    if (page.length > 0) pages.push(page)
    page = []
    y = top
  }

  if (opts.map && src.plasmidScene) {
    const size = Math.min(contentW, bottom - top)
    page.push({ kind: 'map', x: MARGIN + (contentW - size) / 2, y: top, size })
    newPage()
  }

  for (let i = 0; i < rows.length; i++) {
    const h = rl.rowH(i) * scale
    if (y + h > bottom && page.length > 0) newPage()
    page.push({ kind: 'row', row: i, y })
    y += h
    if (pages.length > MAX_PDF_PAGES) break
  }

  const tables = buildTables(src, segs, contentW)
  const placeTable = (id: TableId, title: string) => {
    const { rows: trs } = tables[id]
    if (trs.length === 0) return
    const headH = TABLE_LINE + TABLE_ROW_PAD
    const gap = page.length > 0 ? 18 : 0
    // Heading, header and the first row stay together.
    if (y + gap + 16 + headH + trs[0].height > bottom) newPage()
    else y += gap
    page.push({ kind: 'heading', text: title, y })
    y += 16
    page.push({ kind: 'tableHead', table: id, y })
    y += headH
    trs.forEach((r, index) => {
      if (y + r.height > bottom) {
        newPage()
        page.push({ kind: 'tableHead', table: id, y })
        y += headH
      }
      page.push({ kind: 'tableRow', table: id, index, y })
      y += r.height
    })
  }
  if (opts.features) placeTable('features', 'Features')
  if (opts.enzymes) placeTable('enzymes', 'Restriction sites')
  if (page.length > 0 || pages.length === 0) pages.push(page)

  const letterPt = L.mode === 'letters' ? 14 * scale : 0
  return {
    source: src, options: opts, pageWidth, pageHeight, rows, L, rl, stacks, selTranslation,
    scale, layoutWidth, letterPt, tables, pages,
  }
}

// Print ink for the page furniture (header, footer, tables). These are part
// of a fixed output that must look the same whatever theme the app is in,
// so they are literal colours rather than theme tokens.
const INK = '#1e293b'
const INK_MUTED = '#64748b'
const RULE = '#cbd5e1'
const ROW_TINT = '#f1f5f9'

/** Draw one planned page, in points, onto a context with its origin at the page's top left. */
export function renderPdfPage(ctx: CanvasRenderingContext2D, plan: PdfPlan, pageIndex: number): void {
  const { source: src, options: opts, pageWidth, pageHeight } = plan
  const items = plan.pages[pageIndex] ?? []
  const contentW = pageWidth - MARGIN * 2
  const doc = src.doc
  const seqLen = doc.sequence.length

  const scene = {
    doc,
    L: plan.L,
    rl: plan.rl,
    rowSpan: (i: number) => plan.rows[i],
    stacksAt: (i: number) => plan.stacks[i],
    groupedSites: src.groupedSites,
    colors: src.colors,
    basePalette: src.basePalette,
    paintBackground: src.paintBackground,
    fonts: PDF_FAMILIES,
    measure: pdfMeasure,
    selection: opts.highlights ? src.selection : null,
    selectionHandles: false,
    search: opts.highlights ? src.search : null,
    selTranslation: plan.selTranslation,
    hoveredAnnotationId: null,
    hoveredEnzymeGroup: null,
    annEdgeDrag: null,
    autoPicks: src.autoPicks,
    orfPicks: src.orfPicks,
    motifPicks: src.motifPicks,
    graph: src.graph,
    primerItemById: src.primerItemById,
    translationFrames: src.translationFrames,
    translationCode: src.translationCode,
    aminoAcidStyle: src.aminoAcidStyle,
    threeLetter: src.threeLetter,
    width: plan.layoutWidth,
  }

  for (const item of items) {
    switch (item.kind) {
      case 'row': {
        ctx.save()
        ctx.translate(MARGIN, item.y)
        ctx.scale(plan.scale, plan.scale)
        ctx.translate(0, -plan.rl.rowY(item.row))
        paintSequenceRows(ctx, scene, item.row, item.row)
        ctx.restore()
        break
      }
      case 'map': {
        if (!src.plasmidScene) break
        const mapScene = src.plasmidScene(item.size)
        ctx.save()
        ctx.translate(item.x, item.y)
        renderSceneToCanvas(ctx, mapScene)
        ctx.restore()
        break
      }
      case 'heading': {
        ctx.fillStyle = INK
        ctx.font = `700 10px ${PDF_FAMILIES.sans}`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(item.text, MARGIN, item.y)
        break
      }
      case 'tableHead':
      case 'tableRow': {
        const table = plan.tables[item.table]
        const xs = columnXs(table.columns, MARGIN, contentW)
        const head = item.kind === 'tableHead'
        const row = item.kind === 'tableRow' ? table.rows[item.index] : null
        const h = row ? row.height : TABLE_LINE + TABLE_ROW_PAD
        if (item.kind === 'tableRow' && item.index % 2 === 1) {
          ctx.fillStyle = ROW_TINT
          ctx.fillRect(MARGIN, item.y, contentW, h)
        }
        if (head) {
          ctx.strokeStyle = RULE
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(MARGIN, item.y + h - 0.5)
          ctx.lineTo(MARGIN + contentW, item.y + h - 0.5)
          ctx.stroke()
        }
        ctx.font = tableFont(head)
        ctx.textBaseline = 'top'
        table.columns.forEach((col, i) => {
          const { x, w } = xs[i]
          let tx = x + 4
          if (row && i === 0 && row.swatch) {
            ctx.fillStyle = row.swatch
            ctx.fillRect(tx, item.y + 3, 7, 7)
            tx += 10
          }
          ctx.fillStyle = head ? INK_MUTED : INK
          ctx.textAlign = col.align === 'right' ? 'right' : 'left'
          const ax = col.align === 'right' ? x + w - 4 : tx
          if (head) ctx.fillText(col.title, ax, item.y + 2)
          else if (row && i === table.columns.length - 1) {
            row.lines.forEach((line, li) => ctx.fillText(line, ax, item.y + 2 + li * TABLE_LINE))
          } else if (row) ctx.fillText(row.cells[i], ax, item.y + 2)
        })
        ctx.textAlign = 'left'
        break
      }
    }
  }

  if (opts.header) {
    const title = opts.title.trim() || doc.name || 'Untitled'
    const whole = rangeLength(opts.range, seqLen) === seqLen
    const segs = rangeSegments(opts.range, seqLen)
    const origin = (doc.sequence.topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
    const dp = (p: number) => displayPosition(p, origin, seqLen).toLocaleString()
    const facts = [
      `${seqLen.toLocaleString()} bp`,
      doc.sequence.topology,
      whole || segs.length === 0 ? '' : `bases ${dp(segs[0][0])}-${dp(segs[segs.length - 1][1] - 1)}`,
    ].filter(Boolean).join(' · ')
    const factsFont = `9px ${PDF_FAMILIES.sans}`
    const factsW = pdfMeasure(factsFont, facts)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = INK
    ctx.font = `700 11px ${PDF_FAMILIES.sans}`
    ctx.fillText(fit(title, ctx.font, contentW - factsW - 16), MARGIN, MARGIN + 11)
    ctx.fillStyle = INK_MUTED
    ctx.font = factsFont
    ctx.textAlign = 'right'
    ctx.fillText(facts, MARGIN + contentW, MARGIN + 11)
    ctx.strokeStyle = RULE
    ctx.lineWidth = 0.75
    ctx.beginPath()
    ctx.moveTo(MARGIN, MARGIN + 17)
    ctx.lineTo(MARGIN + contentW, MARGIN + 17)
    ctx.stroke()

    const footY = pageHeight - MARGIN
    ctx.font = `8px ${PDF_FAMILIES.sans}`
    ctx.fillStyle = INK_MUTED
    ctx.textAlign = 'left'
    ctx.fillText(`SeqNexus · ${new Date().toLocaleDateString()}`, MARGIN, footY)
    ctx.textAlign = 'right'
    ctx.fillText(`Page ${pageIndex + 1} of ${plan.pages.length}`, MARGIN + contentW, footY)
    ctx.textAlign = 'left'
  }
}

/**
 * Write the planned pages to PDF bytes. Yields to the browser between batches
 * of pages so a long export keeps the dialog responsive and can report
 * progress; `signal` stops it.
 */
export async function writeSequencePdf(
  plan: PdfPlan,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const pdf = new PdfDocument({
    title: plan.options.title.trim() || plan.source.doc.name,
    subject: 'Sequence exported from SeqNexus',
  })
  const total = plan.pages.length
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
    const page = pdf.addPage(plan.pageWidth, plan.pageHeight)
    renderPdfPage(asCanvasContext(page), plan, i)
    if (i % 8 === 7) {
      onProgress?.(i + 1, total)
      await new Promise(r => setTimeout(r, 0))
    }
  }
  onProgress?.(total, total)
  return pdf.toBytes()
}
