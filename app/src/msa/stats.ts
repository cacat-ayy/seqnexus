/**
 * Column statistics: residue counts per column (the profile), and everything
 * read off it — consensus, identity and similarity graphs, sequence logos,
 * Clustal conservation marks and the numbers for a selection.
 *
 * Mean pairwise identity is computed from counts rather than by comparing
 * every pair of rows: in a column with counts c_k, the identical pairs are
 * the sum of C(c_k, 2). That keeps a selection's statistics linear in its
 * size, so they can update on every edit.
 */

import { isSimilar } from '../alignment/matrices'
import { baseBits, codeForBits } from './iupac'
import { width, type AlnDoc, type AlnKind, type AlnRow } from './model'

/** Symbols: A–Z are 0–25, '*' is 26, the gap is 27. */
export const NSYM = 28
const STOP_SYM = 26
export const GAP_SYM = 27

const SYM = new Int8Array(128).fill(-1)
for (let i = 0; i < 26; i++) SYM[65 + i] = i
SYM[42] = STOP_SYM
SYM[45] = GAP_SYM

export function symOf(ch: string): number {
  const c = ch.charCodeAt(0)
  return c < 128 ? SYM[c] : -1
}

export function charOf(sym: number): string {
  if (sym === GAP_SYM) return '-'
  if (sym === STOP_SYM) return '*'
  return String.fromCharCode(65 + sym)
}

export interface Profile {
  /** Number of columns. */
  width: number
  /** Number of rows counted. */
  rows: number
  /** counts[col * NSYM + sym]. */
  counts: Uint32Array
}

function addRow(counts: Uint32Array, seq: string, c0: number, c1: number, sign: 1 | -1): void {
  for (let c = c0; c < c1; c++) {
    const code = seq.charCodeAt(c)
    const s = code < 128 ? SYM[code] : -1
    if (s >= 0) counts[(c - c0) * NSYM + s] += sign
  }
}

/** Profile of the given rows (default: all) over columns [c0, c1). Not cached. */
export function profileOf(rows: readonly AlnRow[], c0 = 0, c1?: number): Profile {
  const w = rows[0]?.seq.length ?? 0
  const end = Math.min(w, c1 ?? w)
  const start = Math.max(0, Math.min(c0, end))
  const counts = new Uint32Array((end - start) * NSYM)
  for (const r of rows) addRow(counts, r.seq, start, end, 1)
  return { width: end - start, rows: rows.length, counts }
}

// The whole-document profile, kept for the last document seen. An edit that
// replaces a handful of rows (typing, dragging gaps) updates it in place of
// a full recount.
let lastRows: readonly AlnRow[] | null = null
let lastProfile: Profile | null = null

/** The profile of the whole document, cached across small edits. */
export function docProfile(doc: AlnDoc): Profile {
  if (lastRows === doc.rows && lastProfile) return lastProfile
  const w = width(doc)
  let p: Profile | null = null
  if (lastRows && lastProfile && lastProfile.width === w && lastRows.length === doc.rows.length) {
    const prev = new Set(lastRows)
    const now = new Set(doc.rows)
    const gone = lastRows.filter(r => !now.has(r))
    const added = doc.rows.filter(r => !prev.has(r))
    if (added.length <= Math.max(4, doc.rows.length / 4)) {
      const counts = lastProfile.counts.slice()
      for (const r of gone) addRow(counts, r.seq, 0, w, -1)
      for (const r of added) addRow(counts, r.seq, 0, w, 1)
      p = { width: w, rows: doc.rows.length, counts }
    }
  }
  p ??= profileOf(doc.rows)
  lastRows = doc.rows
  lastProfile = p
  return p
}

function residueTotal(p: Profile, col: number): number {
  const o = col * NSYM
  let n = 0
  for (let s = 0; s < GAP_SYM; s++) n += p.counts[o + s]
  return n
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

export interface ConsensusOptions {
  /**
   * Fraction (0–1) of sequences a call must cover. 0 means "most common
   * residue". DNA builds the smallest ambiguity code that reaches it;
   * protein falls back to 'X'.
   */
  threshold: number
  /** Leave gaps out of the count, so a column is never called a gap while it has any residue. */
  ignoreGaps: boolean
}

export const DEFAULT_CONSENSUS: ConsensusOptions = { threshold: 0, ignoreGaps: false }

/** One consensus residue for a profile column. */
export function consensusAt(p: Profile, col: number, kind: AlnKind, opts: ConsensusOptions = DEFAULT_CONSENSUS): string {
  const o = col * NSYM
  const gapsN = p.counts[o + GAP_SYM]
  const residues = residueTotal(p, col)
  if (residues === 0) return '-'
  if (!opts.ignoreGaps && gapsN > residues) return '-'
  const total = opts.ignoreGaps ? residues : residues + gapsN
  // Residues by count, most common first; ties by letter.
  const order: number[] = []
  for (let s = 0; s < GAP_SYM; s++) if (p.counts[o + s] > 0) order.push(s)
  order.sort((a, b) => p.counts[o + b] - p.counts[o + a] || a - b)
  const top = order[0]
  if (opts.threshold <= 0) {
    // Ties for first: DNA reports them as an ambiguity code.
    if (kind === 'dna' && order.length > 1 && p.counts[o + order[1]] === p.counts[o + top]) {
      let bits = 0
      for (const s of order) if (p.counts[o + s] === p.counts[o + top]) bits |= baseBits(charOf(s))
      return bits ? codeForBits(bits) : charOf(top)
    }
    return charOf(top)
  }
  const need = opts.threshold * total
  if (p.counts[o + top] >= need - 1e-9) return charOf(top)
  if (kind !== 'dna') return 'X'
  let bits = 0
  let covered = 0
  for (const s of order) {
    const b = baseBits(charOf(s))
    if (!b) continue
    bits |= b
    covered += p.counts[o + s]
    if (covered >= need - 1e-9) return codeForBits(bits)
  }
  return 'N'
}

export function consensus(p: Profile, kind: AlnKind, opts: ConsensusOptions = DEFAULT_CONSENSUS): string {
  let out = ''
  for (let c = 0; c < p.width; c++) out += consensusAt(p, c, kind, opts)
  return out
}

// ---------------------------------------------------------------------------
// Identity and similarity per column
// ---------------------------------------------------------------------------

function pairs(n: number): number {
  return (n * (n - 1)) / 2
}

/** Identical and compared pairs in one column. Gap-gap pairs are not compared; gap-residue pairs count as different. */
function columnPairs(p: Profile, col: number): { identical: number; compared: number } {
  const o = col * NSYM
  let identical = 0
  for (let s = 0; s < GAP_SYM; s++) identical += pairs(p.counts[o + s])
  return { identical, compared: pairs(p.rows) - pairs(p.counts[o + GAP_SYM]) }
}

/**
 * Fraction of identical pairs in each column, 0–1. A column where every row
 * has the same residue scores 1; a gap against a residue counts as a
 * difference; an all-gap column scores 0.
 */
export function columnIdentity(p: Profile): Float32Array {
  const out = new Float32Array(p.width)
  for (let c = 0; c < p.width; c++) {
    if (p.rows < 2) { out[c] = residueTotal(p, c) > 0 ? 1 : 0; continue }
    const { identical, compared } = columnPairs(p, c)
    out[c] = compared > 0 ? identical / compared : 0
  }
  return out
}

// Similar residue pairs (BLOSUM62 > 0, not identical), as symbol index pairs.
const SIMILAR_PAIRS: [number, number][] = []
{
  const aa = 'ARNDCQEGHILKMFPSTWYV'
  for (let i = 0; i < aa.length; i++) {
    for (let j = i + 1; j < aa.length; j++) {
      if (isSimilar(aa[i], aa[j])) SIMILAR_PAIRS.push([aa.charCodeAt(i) - 65, aa.charCodeAt(j) - 65])
    }
  }
}

function similarPairsAt(p: Profile, col: number): number {
  const o = col * NSYM
  let n = 0
  for (const [a, b] of SIMILAR_PAIRS) n += p.counts[o + a] * p.counts[o + b]
  return n
}

/**
 * Fraction of pairs that are identical or similar (BLOSUM62 > 0) in each
 * column. For DNA this is the identity.
 */
export function columnSimilarity(p: Profile, kind: AlnKind): Float32Array {
  if (kind === 'dna') return columnIdentity(p)
  const out = new Float32Array(p.width)
  for (let c = 0; c < p.width; c++) {
    if (p.rows < 2) { out[c] = residueTotal(p, c) > 0 ? 1 : 0; continue }
    const { identical, compared } = columnPairs(p, c)
    out[c] = compared > 0 ? (identical + similarPairsAt(p, c)) / compared : 0
  }
  return out
}

/** Fraction of rows with a gap in each column. */
export function columnGaps(p: Profile): Float32Array {
  const out = new Float32Array(p.width)
  if (p.rows === 0) return out
  for (let c = 0; c < p.width; c++) out[c] = p.counts[c * NSYM + GAP_SYM] / p.rows
  return out
}

/** Sliding-window mean, for smoothing a graph. Window 1 returns the input. */
export function smooth(values: Float32Array, window: number): Float32Array {
  const w = Math.max(1, Math.floor(window))
  if (w === 1) return values
  const half = Math.floor(w / 2)
  const out = new Float32Array(values.length)
  const prefix = new Float64Array(values.length + 1)
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i] + values[i]
  for (let i = 0; i < values.length; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(values.length, i + half + 1)
    out[i] = (prefix[b] - prefix[a]) / (b - a)
  }
  return out
}

// ---------------------------------------------------------------------------
// Clustal conservation marks
// ---------------------------------------------------------------------------

const STRONG = ['STA', 'NEQK', 'NHQK', 'NDEQ', 'QHRK', 'MILV', 'MILF', 'HY', 'FYW']
const WEAK = ['CSA', 'ATV', 'SAG', 'STNK', 'STPA', 'SGND', 'SNDEQK', 'NDEQHK', 'NEQHRK', 'FVLIM', 'HFY']

function groupMasks(groups: string[]): number[] {
  return groups.map(g => [...g].reduce((m, ch) => m | (1 << (ch.charCodeAt(0) - 65)), 0))
}
const STRONG_MASKS = groupMasks(STRONG)
const WEAK_MASKS = groupMasks(WEAK)

/**
 * Clustal's mark under a column: '*' when every row has the same residue,
 * ':' (protein) when all fall in one strongly similar group, '.' for a weakly
 * similar group, ' ' otherwise. Any gap rules out a mark.
 */
export function clustalMark(p: Profile, col: number, kind: AlnKind): string {
  const o = col * NSYM
  if (p.rows === 0 || p.counts[o + GAP_SYM] > 0) return ' '
  let mask = 0
  let kinds = 0
  for (let s = 0; s < 26; s++) {
    if (p.counts[o + s] > 0) { mask |= 1 << s; kinds++ }
  }
  if (p.counts[o + STOP_SYM] > 0) return ' '
  if (kinds === 1) return '*'
  if (kind !== 'protein') return ' '
  if (STRONG_MASKS.some(g => (mask & g) === mask)) return ':'
  if (WEAK_MASKS.some(g => (mask & g) === mask)) return '.'
  return ' '
}

// ---------------------------------------------------------------------------
// Sequence logo
// ---------------------------------------------------------------------------

export interface LogoColumn {
  /** Information content in bits, after small-sample correction. */
  bits: number
  /** Letter stack, smallest first (drawn bottom-up the other way round). */
  letters: { ch: string; height: number }[]
}

const DNA_LOGO = [0, 2, 6, 19] // A C G T (U is folded into T)
const AA_LOGO = [...'ACDEFGHIKLMNPQRSTVWY'].map(ch => ch.charCodeAt(0) - 65)

/** Maximum information per column: 2 bits for DNA, log2(20) for protein. */
export function maxBits(kind: AlnKind): number {
  return kind === 'dna' ? 2 : Math.log2(20)
}

/**
 * One column of a sequence logo (Schneider & Stephens), with the usual
 * small-sample correction. U counts as T. Heights are scaled by the fraction
 * of rows without a gap, so a column mostly made of gaps stays small.
 */
export function logoColumn(p: Profile, col: number, kind: AlnKind): LogoColumn {
  const o = col * NSYM
  const syms = kind === 'dna' ? DNA_LOGO : AA_LOGO
  const counts = syms.map(s => p.counts[o + s] + (kind === 'dna' && s === 19 ? p.counts[o + 20] : 0))
  const n = counts.reduce((a, b) => a + b, 0)
  if (n === 0 || p.rows === 0) return { bits: 0, letters: [] }
  const alphabet = syms.length
  let h = 0
  for (const c of counts) if (c > 0) { const f = c / n; h -= f * Math.log2(f) }
  const correction = (alphabet - 1) / (2 * Math.LN2 * n)
  const bits = Math.max(0, maxBits(kind) - (h + correction)) * (n / p.rows)
  const letters = syms
    .map((s, i) => ({ ch: charOf(s), height: (counts[i] / n) * bits }))
    .filter(l => l.height > 0)
    .sort((a, b) => a.height - b.height)
  return { bits, letters }
}

// ---------------------------------------------------------------------------
// Selection statistics
// ---------------------------------------------------------------------------

export interface SelectionStats {
  rows: number
  columns: number
  /** Residues (non-gap cells). */
  residues: number
  gapCells: number
  gapFraction: number
  /** Columns where every row has the same residue and none has a gap. */
  identicalSites: number
  /** Columns with more than one residue type among their residues. */
  variableSites: number
  /** Columns with at least two residue types that each occur at least twice. */
  informativeSites: number
  /** Mean pairwise identity over all pairs of rows; null with fewer than two rows. */
  pairwiseIdentity: number | null
  /** Protein only: identical or similar pairs; null otherwise. */
  pairwiseSimilarity: number | null
  /** DNA only: G+C over A, C, G, T/U (ambiguity codes excluded); null otherwise or when empty. */
  gc: number | null
  /** Residue counts, most common first. */
  composition: { ch: string; count: number }[]
  /** Ungapped lengths of the selected rows within the selected columns. */
  lengths: { min: number; max: number; mean: number }
}

/**
 * Statistics for rows × columns [c0, c1). With no rows given, all rows. The
 * whole-document case reuses the cached profile.
 */
export function selectionStats(doc: AlnDoc, rowIds?: Iterable<string> | null, c0 = 0, c1?: number): SelectionStats {
  const w = width(doc)
  const end = Math.min(w, c1 ?? w)
  const start = Math.max(0, Math.min(c0, end))
  const ids = rowIds ? new Set(rowIds) : null
  const rows = ids ? doc.rows.filter(r => ids.has(r.id)) : doc.rows
  const whole = !ids && start === 0 && end === w
  const p = whole ? docProfile(doc) : profileOf(rows, start, end)

  let residues = 0
  let gapCells = 0
  let identicalSites = 0
  let variableSites = 0
  let informativeSites = 0
  let identicalPairs = 0
  let similarPairs = 0
  let comparedPairs = 0
  const comp = new Float64Array(NSYM)

  for (let c = 0; c < p.width; c++) {
    const o = c * NSYM
    const g = p.counts[o + GAP_SYM]
    gapCells += g
    let types = 0
    let repeated = 0
    let colRes = 0
    for (let s = 0; s < GAP_SYM; s++) {
      const k = p.counts[o + s]
      if (k === 0) continue
      types++
      colRes += k
      comp[s] += k
      if (k >= 2) repeated++
      identicalPairs += pairs(k)
    }
    residues += colRes
    if (types === 1 && g === 0 && p.rows > 0) identicalSites++
    if (types > 1) variableSites++
    if (repeated >= 2) informativeSites++
    comparedPairs += pairs(p.rows) - pairs(g)
    if (doc.kind === 'protein') similarPairs += similarPairsAt(p, c)
  }

  const cells = p.rows * p.width
  let gc: number | null = null
  if (doc.kind === 'dna') {
    const at = comp[0] + comp[19] + comp[20]
    const cg = comp[2] + comp[6]
    gc = at + cg > 0 ? cg / (at + cg) : null
  }
  const composition: { ch: string; count: number }[] = []
  for (let s = 0; s < GAP_SYM; s++) if (comp[s] > 0) composition.push({ ch: charOf(s), count: comp[s] })
  composition.sort((a, b) => b.count - a.count || a.ch.localeCompare(b.ch))

  let min = Infinity
  let max = 0
  let sum = 0
  for (const r of rows) {
    let n = 0
    for (let c = start; c < end; c++) if (r.seq.charCodeAt(c) !== 45) n++
    min = Math.min(min, n)
    max = Math.max(max, n)
    sum += n
  }

  const multi = p.rows >= 2 && comparedPairs > 0
  return {
    rows: p.rows,
    columns: p.width,
    residues,
    gapCells,
    gapFraction: cells > 0 ? gapCells / cells : 0,
    identicalSites,
    variableSites,
    informativeSites,
    pairwiseIdentity: multi ? identicalPairs / comparedPairs : null,
    pairwiseSimilarity: multi && doc.kind === 'protein' ? (identicalPairs + similarPairs) / comparedPairs : null,
    gc,
    composition,
    lengths: { min: rows.length ? min : 0, max, mean: rows.length ? sum / rows.length : 0 },
  }
}

// ---------------------------------------------------------------------------
// Pairwise
// ---------------------------------------------------------------------------

/**
 * Identity between two gapped rows: identical columns over compared columns,
 * where a column is compared unless both rows have a gap there. Null when
 * there is nothing to compare.
 */
export function pairIdentity(a: string, b: string, c0 = 0, c1 = Math.min(a.length, b.length)): number | null {
  let same = 0
  let compared = 0
  for (let c = c0; c < c1; c++) {
    const x = a.charCodeAt(c)
    const y = b.charCodeAt(c)
    if (x === 45 && y === 45) continue
    compared++
    if (x === y) same++
  }
  return compared > 0 ? same / compared : null
}

/** n×n identity matrix (row-major) for the given rows; the diagonal is 1. */
export function identityMatrix(rows: readonly AlnRow[]): Float32Array {
  const n = rows.length
  const m = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    m[i * n + i] = 1
    for (let j = i + 1; j < n; j++) {
      const v = pairIdentity(rows[i].seq, rows[j].seq) ?? 0
      m[i * n + j] = v
      m[j * n + i] = v
    }
  }
  return m
}

// ---------------------------------------------------------------------------
// Columns to strip
// ---------------------------------------------------------------------------

export type StripRule =
  | { kind: 'gap-only' }
  /** Columns where at least this fraction of rows has a gap. */
  | { kind: 'gappy'; fraction: number }
  /** Columns whose pairwise identity is below this fraction. */
  | { kind: 'low-identity'; fraction: number }
  /** Columns where every row agrees (keeps only variable sites). */
  | { kind: 'invariant' }

/** A mask (1 = matches the rule) over the document's columns. */
export function columnsMatching(doc: AlnDoc, rule: StripRule): Uint8Array {
  const p = docProfile(doc)
  const mask = new Uint8Array(p.width)
  if (rule.kind === 'gap-only' || rule.kind === 'gappy') {
    const g = columnGaps(p)
    const t = rule.kind === 'gap-only' ? 1 : rule.fraction
    for (let c = 0; c < p.width; c++) if (g[c] >= t - 1e-9) mask[c] = 1
  } else if (rule.kind === 'low-identity') {
    const id = columnIdentity(p)
    for (let c = 0; c < p.width; c++) if (id[c] < rule.fraction - 1e-9) mask[c] = 1
  } else {
    for (let c = 0; c < p.width; c++) {
      const o = c * NSYM
      let types = 0
      for (let s = 0; s < GAP_SYM; s++) if (p.counts[o + s] > 0) types++
      if (types <= 1 && p.counts[o + GAP_SYM] === 0) mask[c] = 1
    }
  }
  return mask
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface AlnSummary {
  rows: number
  width: number
  /** Mean pairwise identity, or null with fewer than two rows. */
  identity: number | null
  /** The start of the consensus, for previews. */
  consensusHead: string
}

const SUMMARY_CACHE = new WeakMap<AlnDoc, AlnSummary>()

/** Headline numbers for lists and hover cards. Cached per document. */
export function summarize(doc: AlnDoc): AlnSummary {
  let s = SUMMARY_CACHE.get(doc)
  if (s) return s
  const p = profileOf(doc.rows)
  let identical = 0
  let compared = 0
  for (let c = 0; c < p.width; c++) {
    const cp = columnPairs(p, c)
    identical += cp.identical
    compared += cp.compared
  }
  s = {
    rows: doc.rows.length,
    width: p.width,
    identity: doc.rows.length >= 2 && compared > 0 ? identical / compared : null,
    consensusHead: consensus(profileOf(doc.rows, 0, 80), doc.kind),
  }
  SUMMARY_CACHE.set(doc, s)
  return s
}
