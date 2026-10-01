/**
 * How an alignment is shown: zoom, colours, highlighting, tracks and
 * translation. Kept per alignment, outside its undo history (changing the
 * colours is not an edit), and saved with it.
 */

import type { AlnKind } from './model'

export type DnaSchemeId = 'nucleotide' | 'clustal-dna' | 'purine-pyrimidine' | 'gc-at' | 'translation'
export type ProteinSchemeId = 'clustalx' | 'zappo' | 'taylor' | 'hydrophobicity' | 'blosum62'
/** Schemes that work for either kind. */
export type SharedSchemeId = 'identity' | 'none'
export type AlnSchemeId = DnaSchemeId | ProteinSchemeId | SharedSchemeId

/** Which residues carry colour. */
export type HighlightMode = 'all' | 'differences' | 'matches'
/** What residues are compared with when highlighting or drawing dots. */
export type CompareTo = 'consensus' | 'reference'

export interface AlnTracks {
  consensus: boolean
  identity: boolean
  logo: boolean
}

export interface AlnView {
  /** Index into ZOOM_LEVELS. */
  zoom: number
  dnaScheme: DnaSchemeId | SharedSchemeId
  proteinScheme: ProteinSchemeId | SharedSchemeId
  /** Colour the cell behind the letter, or the letter itself. */
  colorTarget: 'background' | 'letters'
  highlight: HighlightMode
  compareTo: CompareTo
  /** Draw residues identical to the comparison as dots. */
  dots: boolean
  tracks: AlnTracks
  /** Consensus threshold, 0 (most common residue) to 1. */
  consensusThreshold: number
  consensusIgnoreGaps: boolean
  /** Smoothing window (columns) for the identity graph. */
  graphWindow: number
  /** DNA: a translation strip under each row. */
  translate: boolean
  /** Reading frame, counted from each row's first residue. */
  frame: 0 | 1 | 2
  geneticCode: number
  /** Keep the reference row in view above the others. */
  pinReference: boolean
  /** Width of the name column, px. */
  nameWidth: number
}

export interface ZoomLevel {
  /** Cell width, px. */
  cell: number
  /** Letter size, px; 0 draws colour blocks only. */
  font: number
}

export const ZOOM_LEVELS: readonly ZoomLevel[] = [
  { cell: 1, font: 0 },
  { cell: 2, font: 0 },
  { cell: 3, font: 0 },
  { cell: 5, font: 0 },
  { cell: 7, font: 8 },
  { cell: 9, font: 10 },
  { cell: 11, font: 12 },
  { cell: 13, font: 13 },
  { cell: 16, font: 15 },
  { cell: 20, font: 17 },
]

export const DEFAULT_ZOOM = 6

export const DEFAULT_VIEW: AlnView = {
  zoom: DEFAULT_ZOOM,
  dnaScheme: 'nucleotide',
  proteinScheme: 'clustalx',
  colorTarget: 'background',
  highlight: 'all',
  compareTo: 'consensus',
  dots: false,
  tracks: { consensus: true, identity: true, logo: false },
  consensusThreshold: 0,
  consensusIgnoreGaps: false,
  graphWindow: 1,
  translate: false,
  frame: 0,
  geneticCode: 1,
  pinReference: true,
  nameWidth: 160,
}

export const CONSENSUS_THRESHOLDS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'Most common' },
  { value: 0.5, label: '50%' },
  { value: 0.75, label: '75%' },
  { value: 0.95, label: '95%' },
  { value: 1, label: '100%' },
]

export const MIN_NAME_WIDTH = 80
export const MAX_NAME_WIDTH = 420

export function schemeFor(view: AlnView, kind: AlnKind): AlnSchemeId {
  return kind === 'dna' ? view.dnaScheme : view.proteinScheme
}

export interface SchemeOption {
  id: AlnSchemeId
  label: string
  description: string
}

export const DNA_SCHEMES: readonly SchemeOption[] = [
  { id: 'nucleotide', label: 'Nucleotide', description: 'A green, C amber, G blue, T red' },
  { id: 'clustal-dna', label: 'Clustal', description: 'Clustal X nucleotide colours' },
  { id: 'purine-pyrimidine', label: 'Purine / pyrimidine', description: 'A and G against C and T' },
  { id: 'gc-at', label: 'GC / AT', description: 'Strong against weak base pairs' },
  { id: 'translation', label: 'By translation', description: 'Each base takes the colour of the amino acid its codon encodes' },
  { id: 'identity', label: 'Percent identity', description: 'Darker where more sequences share the residue' },
  { id: 'none', label: 'None', description: 'No colour' },
]

export const PROTEIN_SCHEMES: readonly SchemeOption[] = [
  { id: 'clustalx', label: 'Clustal X', description: 'By property, where the column is conserved enough' },
  { id: 'zappo', label: 'Zappo', description: 'By physicochemical property' },
  { id: 'taylor', label: 'Taylor', description: 'A colour per amino acid' },
  { id: 'hydrophobicity', label: 'Hydrophobicity', description: 'Kyte–Doolittle: red hydrophobic, blue hydrophilic' },
  { id: 'blosum62', label: 'BLOSUM62', description: 'By substitution score against the consensus' },
  { id: 'identity', label: 'Percent identity', description: 'Darker where more sequences share the residue' },
  { id: 'none', label: 'None', description: 'No colour' },
]

function pick<T extends string>(v: unknown, allowed: readonly { id: string }[], fallback: T): T {
  return typeof v === 'string' && allowed.some(o => o.id === v) ? v as T : fallback
}

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback
}

/** Stored settings, repaired; anything missing takes its default. */
export function sanitizeView(raw: unknown, legacyZoom?: number): AlnView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const t = (typeof r.tracks === 'object' && r.tracks !== null ? r.tracks : {}) as Record<string, unknown>
  const d = DEFAULT_VIEW
  return {
    zoom: Math.round(num(r.zoom, 0, ZOOM_LEVELS.length - 1, legacyZoom ?? d.zoom)),
    dnaScheme: pick(r.dnaScheme, DNA_SCHEMES, d.dnaScheme),
    proteinScheme: pick(r.proteinScheme, PROTEIN_SCHEMES, d.proteinScheme),
    colorTarget: r.colorTarget === 'letters' ? 'letters' : 'background',
    highlight: r.highlight === 'differences' || r.highlight === 'matches' ? r.highlight : 'all',
    compareTo: r.compareTo === 'reference' ? 'reference' : 'consensus',
    dots: r.dots === true,
    tracks: {
      consensus: typeof t.consensus === 'boolean' ? t.consensus : d.tracks.consensus,
      identity: typeof t.identity === 'boolean' ? t.identity : d.tracks.identity,
      logo: typeof t.logo === 'boolean' ? t.logo : d.tracks.logo,
    },
    consensusThreshold: num(r.consensusThreshold, 0, 1, d.consensusThreshold),
    consensusIgnoreGaps: r.consensusIgnoreGaps === true,
    graphWindow: Math.round(num(r.graphWindow, 1, 51, d.graphWindow)),
    translate: r.translate === true,
    frame: r.frame === 1 || r.frame === 2 ? r.frame : 0,
    geneticCode: Math.round(num(r.geneticCode, 1, 40, d.geneticCode)),
    pinReference: typeof r.pinReference === 'boolean' ? r.pinReference : d.pinReference,
    nameWidth: Math.round(num(r.nameWidth, MIN_NAME_WIDTH, MAX_NAME_WIDTH, d.nameWidth)),
  }
}
