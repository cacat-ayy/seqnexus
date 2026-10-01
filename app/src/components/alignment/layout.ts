/**
 * Everything the alignment canvases need that follows from the document, the
 * view settings and the theme: sizes, the header track stack, consensus,
 * identity graph, the row to compare with, and the colouring function.
 *
 * Built once per change of those inputs (not per frame), so drawing a frame
 * is lookups and fills.
 */

import { referenceRow, width, type AlnDoc, type AlnRow } from '../../msa/model'
import { cellColorer, type CellColorer } from '../../msa/colors'
import {
  columnIdentity, columnSimilarity, consensus, docProfile, maxBits, smooth, type Profile,
} from '../../msa/stats'
import { translateRow, type RowTranslation } from '../../msa/translate'
import { ZOOM_LEVELS, schemeFor, type AlnSchemeId, type AlnView } from '../../msa/view'

export interface Metrics {
  cellW: number
  /** Letter size; 0 draws colour blocks only. */
  font: number
  /** Height of a row's residue band. */
  rowH: number
  /** Height of its translation strip (0 when not translating). */
  aaH: number
  /** rowH + aaH. */
  pitch: number
}

export function metrics(view: AlnView, translating: boolean): Metrics {
  const z = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, view.zoom))]
  const rowH = z.font ? Math.max(15, Math.round(z.font * 1.5)) : 12
  const aaH = translating ? Math.max(10, Math.round(rowH * 0.8)) : 0
  return { cellW: z.cell, font: z.font, rowH, aaH, pitch: rowH + aaH }
}

export type HeadTrackId = 'ruler' | 'logo' | 'identity' | 'consensus' | 'reference'

export interface HeadTrack {
  id: HeadTrackId
  y: number
  h: number
  label: string
}

export const RULER_H = 20

export interface PaintModel {
  doc: AlnDoc
  view: AlnView
  m: Metrics
  width: number
  scheme: AlnSchemeId
  /** Rows in the scrolling body (the pinned reference is drawn in the header instead). */
  bodyRows: readonly AlnRow[]
  reference: AlnRow | null
  pinned: AlnRow | null
  profile: Profile
  consensus: string
  /** What each column is compared with for highlighting and dots: the reference or the consensus. */
  compare: string
  /** Identity (similarity for protein) per column, smoothed. */
  graph: Float32Array
  /** Raw identity per column, for readouts. */
  identity: Float32Array
  colorer: CellColorer
  translating: boolean
  translation: (row: AlnRow) => RowTranslation | null
  head: HeadTrack[]
  headH: number
  /** The logo's full height in bits. */
  logoBits: number
}

export function buildPaintModel(doc: AlnDoc, view: AlnView): PaintModel {
  const translating = doc.kind === 'dna' && view.translate
  const m = metrics(view, translating)
  const w = width(doc)
  const profile = docProfile(doc)
  const cons = consensus(profile, doc.kind, { threshold: view.consensusThreshold, ignoreGaps: view.consensusIgnoreGaps })
  const reference = referenceRow(doc) ?? null
  const pinned = reference && view.pinReference && doc.rows.length > 1 ? reference : null
  const bodyRows = pinned ? doc.rows.filter(r => r !== pinned) : doc.rows
  const identity = columnIdentity(profile)
  const graph = smooth(doc.kind === 'protein' ? columnSimilarity(profile, 'protein') : identity, view.graphWindow)
  const scheme = schemeFor(view, doc.kind)
  const compare = view.compareTo === 'reference' && reference ? reference.seq : cons
  const colorer = cellColorer(scheme, doc.kind, profile, col => cons[col] ?? '-')
  const needTranslation = translating || (doc.kind === 'dna' && scheme === 'translation')
  const translation = (row: AlnRow) => (needTranslation ? translateRow(row, view.frame, view.geneticCode) : null)

  const head: HeadTrack[] = []
  let y = 0
  const push = (id: HeadTrackId, h: number, label: string) => { head.push({ id, y, h, label }); y += h }
  push('ruler', RULER_H, '')
  if (view.tracks.logo) push('logo', m.font ? 46 : 30, 'Logo')
  if (view.tracks.identity) push('identity', 26, doc.kind === 'protein' ? 'Similarity' : 'Identity')
  if (view.tracks.consensus) push('consensus', m.rowH, 'Consensus')
  if (pinned) push('reference', m.pitch + 3, pinned.name)

  return {
    doc, view, m, width: w, scheme, bodyRows, reference, pinned, profile,
    consensus: cons, compare, graph, identity, colorer, translating, translation,
    head, headH: y, logoBits: maxBits(doc.kind),
  }
}

/** A tick interval for column numbers that keeps labels at least `minPx` apart. */
export function rulerStep(cellW: number, minPx = 56): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000]
  return steps.find(s => s * cellW >= minPx) ?? 100000
}
