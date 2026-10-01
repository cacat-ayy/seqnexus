/**
 * The alignment document: a stack of gapped rows that the user owns and edits.
 *
 * A row is a copy. It remembers where it came from, for display, but editing
 * it never reaches back into the source sequence (and the source changing
 * never reaches into the alignment). "Extract row as sequence" is the way out.
 *
 * Every row is the same length, its residues upper-case and its gaps '-'.
 * Documents are immutable: an edit builds a new document and reuses every row
 * it did not touch, which is what keeps undo snapshots cheap.
 */

import type { AlignmentResult } from '../alignment/types'
import { computeConsensus, computeConservation, pairwiseIdentityMatrix } from '../alignment/consensus'

export type AlnKind = 'dna' | 'protein'

/** How the alignment came to be. Read for display and for "realign". */
export type AlnMethod =
  | 'mafft' | 'clustalo' | 'muscle' | 'kalign'
  | 'global' | 'local' | 'progressive'
  | 'import' | 'manual'

export interface AlnOrigin {
  method: AlnMethod
  /** Strategy or settings in words, e.g. "L-INS-i" or "Clustal, 4 sequences". */
  detail?: string
  /** For imports: the file and the format it was read as. */
  file?: string
  format?: string
  at: number
}

export interface AlnSource {
  /** Explorer uid of the item the row was taken from, if any. */
  uid?: string
  name: string
  /** True when the row is the reverse complement of the source. */
  reversed?: boolean
}

export interface AlnRow {
  id: string
  name: string
  /** Gapped residues: upper-case letters, '*' for stops, '-' for gaps. */
  seq: string
  source?: AlnSource
  /**
   * Number of the row's first residue in its source, 1-based. Lets a row cut
   * from the middle of a gene keep that gene's numbering.
   */
  start?: number
}

export interface AlnDoc {
  kind: AlnKind
  rows: readonly AlnRow[]
  /** The row others are compared with, or null to compare with the consensus. */
  referenceId: string | null
  origin: AlnOrigin
}

export const GAP = '-'
const GAP_CODE = 45 // '-'

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

let rowCounter = 0
const ROW_ID_BASE = Math.random().toString(36).slice(2, 7)

export function newRowId(): string {
  rowCounter += 1
  return `row_${ROW_ID_BASE}${rowCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Residues
// ---------------------------------------------------------------------------

/**
 * Bring one row's text to the document's alphabet: upper case, every gap
 * spelling ('.', '~', ' ' inside a row) as '-', and '?' (missing data) as the
 * kind's unknown residue. Anything else that is not a letter or '*' is dropped.
 */
export function cleanResidues(raw: string, kind: AlnKind): string {
  const unknown = kind === 'dna' ? 'N' : 'X'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i)
    if (c >= 65 && c <= 90) out += raw[i]                          // A-Z
    else if (c >= 97 && c <= 122) out += String.fromCharCode(c - 32) // a-z
    else if (c === 45 || c === 46 || c === 126) out += GAP          // - . ~
    else if (c === 42) out += '*'
    else if (c === 63) out += unknown                               // ?
  }
  return out
}

const NUCLEOTIDE = new Set('ACGTUN')

/**
 * Guess DNA or protein from residues. Nucleotide letters dominate DNA even
 * with ambiguity codes about; a protein has plenty of letters outside ACGTUN.
 */
export function detectKind(seqs: readonly string[]): AlnKind {
  let nuc = 0
  let total = 0
  for (const s of seqs) {
    for (let i = 0; i < s.length && total < 200_000; i++) {
      const ch = s[i].toUpperCase()
      if (ch === GAP || ch === '.' || ch === '?' || ch === '*') continue
      total++
      if (NUCLEOTIDE.has(ch)) nuc++
    }
  }
  if (total === 0) return 'dna'
  return nuc / total >= 0.9 ? 'dna' : 'protein'
}

export function isGap(ch: string): boolean {
  return ch === GAP
}

/** The row without its gaps. */
export function ungapped(seq: string): string {
  return seq.indexOf(GAP) === -1 ? seq : seq.split(GAP).join('')
}

export function residueCount(seq: string): number {
  let n = 0
  for (let i = 0; i < seq.length; i++) if (seq.charCodeAt(i) !== GAP_CODE) n++
  return n
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export function width(doc: AlnDoc): number {
  return doc.rows[0]?.seq.length ?? 0
}

export function rowIndex(doc: AlnDoc, id: string): number {
  return doc.rows.findIndex(r => r.id === id)
}

export function rowById(doc: AlnDoc, id: string): AlnRow | undefined {
  return doc.rows.find(r => r.id === id)
}

/** The reference row, if it is set and still exists. */
export function referenceRow(doc: AlnDoc): AlnRow | undefined {
  return doc.referenceId ? rowById(doc, doc.referenceId) : undefined
}

/**
 * Pad every row with trailing gaps to the longest, then drop columns at the
 * right edge that are gaps all the way down: they carry nothing. Rows that
 * need no change are kept as they are.
 */
export function squareUp(rows: readonly AlnRow[]): AlnRow[] {
  let w = 0
  for (const r of rows) if (r.seq.length > w) w = r.seq.length
  // Trailing all-gap columns.
  let keep = w
  while (keep > 0) {
    const col = keep - 1
    let allGap = true
    for (const r of rows) {
      if (col < r.seq.length && r.seq.charCodeAt(col) !== GAP_CODE) { allGap = false; break }
    }
    if (!allGap) break
    keep--
  }
  return rows.map(r => {
    if (r.seq.length === keep) return r
    const seq = r.seq.length > keep ? r.seq.slice(0, keep) : r.seq + GAP.repeat(keep - r.seq.length)
    return { ...r, seq }
  })
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export interface RowInput {
  name: string
  seq: string
  source?: AlnSource
  start?: number
}

/**
 * A document from raw rows. Rows are cleaned and squared up; the kind is
 * guessed unless given. Names are kept as given, duplicates included: two
 * rows called "clone 1" are two rows.
 */
export function makeDoc(inputs: readonly RowInput[], origin: AlnOrigin, kind?: AlnKind): AlnDoc {
  const k = kind ?? detectKind(inputs.map(r => r.seq))
  const rows = inputs.map((r): AlnRow => {
    const row: AlnRow = { id: newRowId(), name: r.name.trim() || 'Unnamed', seq: cleanResidues(r.seq, k) }
    if (r.source) row.source = r.source
    if (r.start !== undefined && r.start !== 1) row.start = r.start
    return row
  })
  return { kind: k, rows: squareUp(rows), referenceId: null, origin }
}

const METHOD_FROM_ALGORITHM: Record<AlignmentResult['algorithm'], AlnMethod> = {
  nw: 'global', sw: 'local', msa: 'progressive', mafft: 'mafft',
}

/**
 * A document from an engine result or a pre-rebuild saved alignment. The
 * row order and names are kept; per-row sources are passed separately because
 * the result does not carry them.
 */
export function docFromResult(
  result: AlignmentResult,
  seqType: AlnKind,
  opts: { sources?: (AlnSource | undefined)[]; at?: number; detail?: string } = {},
): AlnDoc {
  const origin: AlnOrigin = { method: METHOD_FROM_ALGORITHM[result.algorithm] ?? 'progressive', at: opts.at ?? Date.now() }
  if (opts.detail) origin.detail = opts.detail
  return makeDoc(
    result.sequences.map((s, i) => ({ name: s.name, seq: s.alignedBases, source: opts.sources?.[i] })),
    origin,
    seqType,
  )
}

// ---------------------------------------------------------------------------
// Coordinates
// ---------------------------------------------------------------------------

const PREFIX_CACHE = new WeakMap<AlnRow, Int32Array>()

/**
 * For each column, how many residues come before it in the row. Cached per
 * row object, which is safe because rows never change in place.
 */
export function residuePrefix(row: AlnRow): Int32Array {
  let p = PREFIX_CACHE.get(row)
  if (p) return p
  const s = row.seq
  p = new Int32Array(s.length + 1)
  let n = 0
  for (let i = 0; i < s.length; i++) {
    p[i] = n
    if (s.charCodeAt(i) !== GAP_CODE) n++
  }
  p[s.length] = n
  PREFIX_CACHE.set(row, p)
  return p
}

/**
 * The residue number (in the row's own numbering, honouring `start`) at a
 * column, or null on a gap.
 */
export function residueNumberAt(row: AlnRow, col: number): number | null {
  if (col < 0 || col >= row.seq.length || row.seq.charCodeAt(col) === GAP_CODE) return null
  return residuePrefix(row)[col] + (row.start ?? 1)
}

/** The column holding residue `n` (0-based, ignoring `start`), or -1. */
export function columnOfResidue(row: AlnRow, n: number): number {
  if (n < 0) return -1
  const p = residuePrefix(row)
  if (n >= p[row.seq.length]) return -1
  // First column whose prefix is n and which is not a gap.
  let lo = 0
  let hi = row.seq.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (p[mid] + (row.seq.charCodeAt(mid) === GAP_CODE ? 0 : 1) <= n) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ---------------------------------------------------------------------------
// Legacy view adapter
// ---------------------------------------------------------------------------

const ALGORITHM_FROM_METHOD: Partial<Record<AlnMethod, AlignmentResult['algorithm']>> = {
  global: 'nw', local: 'sw', mafft: 'mafft',
}

const RESULT_CACHE = new WeakMap<AlnDoc, AlignmentResult>()

/**
 * The shape the previous viewer and exporters read. Kept only until the new
 * viewer replaces them. Cached per document.
 */
export function docToResult(doc: AlnDoc): AlignmentResult {
  let r = RESULT_CACHE.get(doc)
  if (!r) {
    r = buildResult(doc)
    RESULT_CACHE.set(doc, r)
  }
  return r
}

function buildResult(doc: AlnDoc): AlignmentResult {
  const aligned = doc.rows.map(r => r.seq)
  const consensus = computeConsensus(aligned)
  const conservation = computeConservation(aligned, consensus)
  const matrix = doc.rows.length > 1 && doc.rows.length <= 200 ? pairwiseIdentityMatrix(aligned) : undefined
  let idSum = 0
  let idCount = 0
  if (matrix) {
    for (let i = 0; i < matrix.length; i++) {
      for (let j = i + 1; j < matrix.length; j++) { idSum += matrix[i][j]; idCount++ }
    }
  }
  const w = width(doc)
  let gapCols = 0
  for (let c = 0; c < w; c++) {
    if (aligned.some(s => s.charCodeAt(c) === GAP_CODE)) gapCols++
  }
  const identity = idCount > 0 ? idSum / idCount : 0
  return {
    sequences: doc.rows.map(r => ({ name: r.name, alignedBases: r.seq, originalBases: ungapped(r.seq) })),
    consensus,
    conservation,
    score: 0,
    identity,
    similarity: identity,
    gaps: w > 0 ? gapCols / w : 0,
    alignmentLength: w,
    pairwiseIdentityMatrix: doc.rows.length > 2 ? matrix : undefined,
    algorithm: ALGORITHM_FROM_METHOD[doc.origin.method] ?? 'msa',
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const METHODS: ReadonlySet<string> = new Set<AlnMethod>([
  'mafft', 'clustalo', 'muscle', 'kalign', 'global', 'local', 'progressive', 'import', 'manual',
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * A stored document, repaired, or null if it is not one. Also accepts the
 * pre-rebuild `AlignmentResult` shape, so alignments saved before the rebuild
 * open as documents.
 */
export function sanitizeDoc(raw: unknown, legacy?: { seqType?: AlnKind; at?: number }): AlnDoc | null {
  if (!isRecord(raw)) return null
  if (Array.isArray(raw.sequences) && !Array.isArray(raw.rows)) {
    const res = raw as unknown as AlignmentResult
    if (!res.sequences.every(s => isRecord(s) && typeof s.alignedBases === 'string')) return null
    const kind = legacy?.seqType ?? detectKind(res.sequences.map(s => s.alignedBases))
    return docFromResult({ ...res, algorithm: res.algorithm ?? 'msa' }, kind, { at: legacy?.at })
  }
  if (!Array.isArray(raw.rows)) return null
  const kind: AlnKind = raw.kind === 'protein' ? 'protein' : 'dna'
  const seen = new Set<string>()
  const rows: AlnRow[] = []
  for (const r of raw.rows) {
    if (!isRecord(r) || typeof r.seq !== 'string') continue
    let id = typeof r.id === 'string' && r.id ? r.id : newRowId()
    if (seen.has(id)) id = newRowId()
    seen.add(id)
    const row: AlnRow = { id, name: typeof r.name === 'string' && r.name ? r.name : 'Unnamed', seq: cleanResidues(r.seq, kind) }
    if (isRecord(r.source) && typeof r.source.name === 'string') {
      const src: AlnSource = { name: r.source.name }
      if (typeof r.source.uid === 'string') src.uid = r.source.uid
      if (r.source.reversed === true) src.reversed = true
      row.source = src
    }
    if (typeof r.start === 'number' && Number.isFinite(r.start) && r.start !== 1) row.start = Math.round(r.start)
    rows.push(row)
  }
  const o = isRecord(raw.origin) ? raw.origin : {}
  const origin: AlnOrigin = {
    method: typeof o.method === 'string' && METHODS.has(o.method) ? o.method as AlnMethod : 'manual',
    at: typeof o.at === 'number' ? o.at : legacy?.at ?? Date.now(),
  }
  if (typeof o.detail === 'string') origin.detail = o.detail
  if (typeof o.file === 'string') origin.file = o.file
  if (typeof o.format === 'string') origin.format = o.format
  const squared = squareUp(rows)
  const referenceId = typeof raw.referenceId === 'string' && squared.some(r => r.id === raw.referenceId)
    ? raw.referenceId : null
  return { kind, rows: squared, referenceId, origin }
}

const METHOD_LABEL: Record<AlnMethod, string> = {
  mafft: 'MAFFT',
  clustalo: 'Clustal Omega',
  muscle: 'MUSCLE 5',
  kalign: 'Kalign 3',
  global: 'Global pairwise',
  local: 'Local pairwise',
  progressive: 'Progressive',
  import: 'Imported',
  manual: 'Assembled by hand',
}

/** How an alignment was made, in a few words: "MAFFT", "Clustal file". */
export function originLabel(origin: AlnOrigin): string {
  if (origin.method === 'import' && origin.format) return `${origin.format} file`
  // Engine runs record the exact engine and strategy ("MAFFT L-INS-i") as their detail.
  if (origin.detail && origin.method !== 'manual' && origin.method !== 'import') return origin.detail
  return METHOD_LABEL[origin.method]
}
