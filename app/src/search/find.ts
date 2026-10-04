/**
 * Find in a DNA sequence: the matching engine behind the Find panel.
 *
 * Kept apart from the store so it can be tested on plain strings. The store
 * calls `findMatches` whenever the query, the options or the bases change.
 *
 * Coordinates are 0-based, end exclusive, on the forward strand. On a circular
 * sequence a match may run across the origin; it then keeps `end > length`
 * (unwrapped), so matches still sort by start and a consumer splits it into
 * [start, length) and [0, end - length) where it needs two pieces.
 */

import { reverseComplement } from '../models/complement'
import { translateWith, type GeneticCode } from '../codon/genetic-codes'

export type SearchMode = 'nucleotide' | 'protein'

export interface SearchOptions {
  mode: SearchMode
  isRegex: boolean
  /** Search both strands: the reverse complement in nucleotide mode, all six
   *  frames in protein mode. */
  revComplement: boolean
  /** Read IUPAC codes (nucleotide) or X, B, Z, J (protein) as sets. */
  ambiguity: boolean
  /** Positions allowed to differ. Nucleotide, non-regex only. */
  mismatches: number
}

export const defaultSearchOptions: SearchOptions = {
  mode: 'nucleotide',
  isRegex: false,
  revComplement: true,
  ambiguity: true,
  mismatches: 0,
}

export const MAX_MISMATCHES = 3

/**
 * Most hits a search keeps. A one-letter query on a genome has millions; past
 * this many the list, the highlights and the map say nothing more, and
 * holding them all costs hundreds of megabytes.
 */
export const MAX_MATCHES = 100_000

export interface SearchMatch {
  start: number
  /** May exceed the sequence length on a circular sequence (see above). */
  end: number
  /** 1 forward, -1 reverse, 0 for a hit that reads the same on both strands
   *  (a palindrome, or an ambiguous query whose two orientations both fit). */
  strand: 1 | -1 | 0
  /** Protein mode only: offset 0, 1 or 2 from the 5' end of its strand. */
  frame?: 0 | 1 | 2
  /** Positions that differ from the query. Always 0 without mismatches. */
  mismatches: number
}

export interface SearchResult {
  matches: SearchMatch[]
  /** More hits exist than MAX_MATCHES; `matches` is the first of them. */
  truncated: boolean
  /** Why the query cannot be searched, in a few words. Null when it can. */
  error: string | null
}

const EMPTY: SearchResult = { matches: [], truncated: false, error: null }

// ---- Query normalisation ----

const NUCLEOTIDE_CODES = /^[ACGTURYSWKMBDHVN]*$/i
const PROTEIN_CODES = /^[ACDEFGHIKLMNPQRSTVWYXBZJ*]*$/i

/**
 * Drop what a pasted sequence carries besides residues: spaces, line breaks
 * and the position numbers of a GenBank or FASTA listing. A regex is left as
 * typed, since there a space or a digit means something.
 */
export function cleanQuery(query: string, options: Pick<SearchOptions, 'isRegex'>): string {
  return options.isRegex ? query : query.replace(/[\s\d]+/g, '')
}

/** Name the characters that are not codes of the mode, or null if all are. */
function invalidCharsMessage(query: string, mode: SearchMode): string | null {
  const ok = mode === 'nucleotide' ? NUCLEOTIDE_CODES : PROTEIN_CODES
  if (ok.test(query)) return null
  const bad = [...new Set([...query].filter(c => !ok.test(c)))]
  const shown = bad.slice(0, 3).map(c => `“${c}”`).join(', ')
  const what = mode === 'nucleotide' ? 'a nucleotide code' : 'an amino acid code'
  return bad.length === 1 ? `${shown} is not ${what}` : `${shown} are not ${what}s`
}

/**
 * Check a replacement. It goes into the DNA in both modes, so it is bases.
 * A protein hit is codons, and most amino acid letters are also IUPAC codes
 * (MKA would pass as bases), so there only plain A, C, G and T are accepted:
 * typing a peptide by mistake is then an error, not degenerate DNA.
 */
export function cleanReplacement(text: string, mode: SearchMode = 'nucleotide'): { bases: string; error: string | null } {
  const bases = text.replace(/[\s\d]+/g, '').toUpperCase()
  if (mode === 'protein' && !/^[ACGTU]*$/.test(bases)) {
    return { bases, error: 'Replace a protein hit with bases (A, C, G, T): it is DNA codons' }
  }
  return { bases, error: invalidCharsMessage(bases, 'nucleotide') }
}

function compile(pattern: string): RegExp | string {
  try {
    return new RegExp(pattern, 'gi')
  } catch (e) {
    // "Invalid regular expression: /[/: Unterminated character class" ->
    // the part after the pattern is the useful bit.
    const msg = e instanceof Error ? e.message : String(e)
    return msg.slice(msg.lastIndexOf(': ') + 2) || 'Invalid pattern'
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** IUPAC nucleotide code -> regex character class. U and T are one base. */
const IUPAC_CLASS: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: '[TU]', U: '[TU]',
  R: '[AG]', Y: '[CTU]', S: '[GC]', W: '[ATU]',
  K: '[GTU]', M: '[AC]', B: '[CGTU]', D: '[AGTU]',
  H: '[ACTU]', V: '[ACG]', N: '[ACGTU]',
}

/** Protein ambiguity codes. X is any residue but a stop. */
const PROTEIN_CLASS: Record<string, string> = {
  X: '[^*]', B: '[DN]', Z: '[EQ]', J: '[IL]',
}

function nucleotidePattern(query: string, ambiguity: boolean): string {
  const q = query.toUpperCase()
  if (!ambiguity) return [...q].map(c => (c === 'T' || c === 'U' ? '[TU]' : escapeRegex(c))).join('')
  return [...q].map(c => IUPAC_CLASS[c] ?? escapeRegex(c)).join('')
}

function proteinPattern(query: string, ambiguity: boolean): string {
  const q = query.toUpperCase()
  return [...q].map(c => (ambiguity && PROTEIN_CLASS[c]) || escapeRegex(c)).join('')
}

// ---- Scanning ----

/**
 * Every match of `re` in `text` that starts before `limit`.
 *
 * `overlapping` restarts one past each hit's start rather than at its end, so
 * "AA" in "AAAA" is three sites, not two. That is the answer for a sequence
 * (each is a place a primer could sit); a regex keeps the usual semantics.
 * Stops after `cap` hits, which the caller reports as a truncated result.
 */
function scanRegex(
  re: RegExp, text: string, limit: number, overlapping: boolean, cap: number,
  push: (start: number, end: number) => void,
): boolean {
  re.lastIndex = 0
  let n = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index >= limit) break
    if (m[0].length === 0) { re.lastIndex = m.index + 1; continue }
    if (n === cap) return true
    push(m.index, m.index + m[0].length)
    n++
    if (overlapping) re.lastIndex = m.index + 1
  }
  return false
}

/** Base -> bit (A 1, C 2, G 4, T/U 8). Anything else is 0: no call to match. */
const BASE_BIT = new Uint8Array(128)
BASE_BIT[65] = BASE_BIT[97] = 1
BASE_BIT[67] = BASE_BIT[99] = 2
BASE_BIT[71] = BASE_BIT[103] = 4
BASE_BIT[84] = BASE_BIT[116] = BASE_BIT[85] = BASE_BIT[117] = 8

const IUPAC_MASK: Record<string, number> = {
  A: 1, C: 2, G: 4, T: 8, U: 8,
  R: 5, Y: 10, S: 6, W: 9, K: 12, M: 3,
  B: 14, D: 13, H: 11, V: 7, N: 15,
}

/**
 * Hits with up to `k` mismatches, by direct comparison at every offset.
 *
 * O(n * m) at worst, but a window is abandoned at its (k+1)th mismatch, so
 * on real sequence it costs a few comparisons per position. Exact ambiguity
 * semantics match the regex path: a query code matches the plain bases it
 * stands for, and a sequence N (or any non-ACGTU character) matches nothing.
 * Without ambiguity the query is literal, so its N matches only an N.
 */
function scanMismatches(
  text: string, limit: number, query: string, k: number, ambiguity: boolean, cap: number,
  push: (start: number, end: number, mismatches: number) => void,
): boolean {
  const m = query.length
  const q = query.toUpperCase()
  const masks = new Uint8Array(m)
  for (let j = 0; j < m; j++) masks[j] = ambiguity ? (IUPAC_MASK[q[j]] ?? 0) : 0
  const literal = [...q].map(c => (c === 'U' ? 'T' : c))
  let n = 0
  const last = Math.min(limit, text.length - m + 1)
  for (let i = 0; i < last; i++) {
    let mm = 0
    for (let j = 0; j < m; j++) {
      const code = text.charCodeAt(i + j)
      let same: boolean
      if (ambiguity) {
        const bit = code < 128 ? BASE_BIT[code] : 0
        same = bit !== 0 && (bit & masks[j]) !== 0
      } else {
        let c = String.fromCharCode(code).toUpperCase()
        if (c === 'U') c = 'T'
        same = c === literal[j]
      }
      if (!same && ++mm > k) break
    }
    if (mm <= k) {
      if (n === cap) return true
      push(i, i + m, mm)
      n++
    }
  }
  return false
}

// ---- Translation cache ----

/**
 * The last six-frame translation. Typing a protein query re-searches on each
 * key, and translating a genome six times per key is most of the cost, so the
 * frames are kept until the bases or the code change. Keyed by the bases
 * string itself: the Sequence hands back the same string until it is edited.
 */
let frameCache: { text: string; code: GeneticCode; fwd: string[]; rev: string[] } | null = null

function framesOf(text: string, code: GeneticCode, needRev: boolean): { fwd: string[]; rev: string[] } {
  if (!frameCache || frameCache.text !== text || frameCache.code !== code) {
    frameCache = { text, code, fwd: [0, 1, 2].map(f => translateWith(code, text.slice(f))), rev: [] }
  }
  if (needRev && frameCache.rev.length === 0) {
    const rc = reverseComplement(text)
    frameCache.rev = [0, 1, 2].map(f => translateWith(code, rc.slice(f)))
  }
  return frameCache
}

// ---- Entry point ----

/** How far past the origin a circular search reads, so hits can span it. */
function wrapLength(seqLen: number, queryLen: number, isRegex: boolean, perResidue: number): number {
  // A regex has no fixed length; 1 kb covers any motif a person types.
  const want = isRegex ? 1000 : queryLen * perResidue - 1
  return Math.max(0, Math.min(seqLen - 1, want))
}

/**
 * Merge hits from the two strands into one list sorted by position.
 *
 * A window found on both strands is one hit (strand 0), not two: a
 * palindrome, or an ambiguous query such as AN whose reverse complement NT
 * fits the same two bases. If either strand stopped at the cap, the list is
 * cut where that strand's hits end, so what is kept is every hit up to some
 * position rather than an uneven sample of both.
 */
function mergeStrands(fwd: SearchMatch[], rev: SearchMatch[], fwdCut: boolean, revCut: boolean): SearchResult {
  const all = fwd.concat(rev)
  all.sort((a, b) => a.start - b.start || a.end - b.end || b.strand - a.strand)
  const out: SearchMatch[] = []
  for (const m of all) {
    const prev = out[out.length - 1]
    if (prev && prev.start === m.start && prev.end === m.end && prev.frame === m.frame && prev.strand !== m.strand) {
      prev.strand = 0
      prev.mismatches = Math.min(prev.mismatches, m.mismatches)
      continue
    }
    out.push(m)
  }
  let limit = Infinity
  if (fwdCut && fwd.length) limit = Math.min(limit, fwd[fwd.length - 1].start)
  if (revCut && rev.length) limit = Math.min(limit, rev[rev.length - 1].start)
  let kept = limit === Infinity ? out : out.filter(m => m.start <= limit)
  const truncated = fwdCut || revCut || kept.length > MAX_MATCHES
  if (kept.length > MAX_MATCHES) kept = kept.slice(0, MAX_MATCHES)
  return { matches: kept, truncated, error: null }
}

export function findMatches(
  rawQuery: string,
  options: SearchOptions,
  bases: string,
  circular: boolean,
  code: GeneticCode,
): SearchResult {
  const query = cleanQuery(rawQuery, options)
  const L = bases.length
  if (!query || L === 0) return EMPTY

  if (!options.isRegex) {
    const err = invalidCharsMessage(query, options.mode)
    if (err) return { ...EMPTY, error: err }
  }

  return options.mode === 'protein'
    ? findProtein(query, options, bases, circular, code)
    : findNucleotide(query, options, bases, circular)
}

function findNucleotide(query: string, options: SearchOptions, bases: string, circular: boolean): SearchResult {
  const L = bases.length
  const ext = circular ? wrapLength(L, query.length, options.isRegex, 1) : 0
  // One pass over the sequence plus its head covers the hits that span the
  // origin; hits starting in the copied head are the ones already found.
  const text = ext > 0 ? bases + bases.slice(0, ext) : bases
  const k = options.isRegex ? 0 : Math.max(0, Math.min(MAX_MISMATCHES, options.mismatches | 0))

  const fwd: SearchMatch[] = []
  const rev: SearchMatch[] = []
  let fwdCut = false
  let revCut = false
  // Both strands only when the reverse complement is a different query. A
  // regex has no reverse complement, so it reads the forward strand only.
  const rcQuery = options.revComplement && !options.isRegex ? reverseComplement(query.toUpperCase()) : null
  const searchRev = rcQuery !== null && rcQuery !== query.toUpperCase()

  if (k > 0) {
    fwdCut = scanMismatches(text, L, query, k, options.ambiguity, MAX_MATCHES,
      (start, end, mismatches) => fwd.push({ start, end, strand: 1, mismatches }))
    if (searchRev) {
      revCut = scanMismatches(text, L, rcQuery!, k, options.ambiguity, MAX_MATCHES,
        (start, end, mismatches) => rev.push({ start, end, strand: -1, mismatches }))
    }
  } else {
    const fwdRe = compile(options.isRegex ? query : nucleotidePattern(query, options.ambiguity))
    if (typeof fwdRe === 'string') return { ...EMPTY, error: fwdRe }
    const overlapping = !options.isRegex
    fwdCut = scanRegex(fwdRe, text, L, overlapping, MAX_MATCHES,
      (start, end) => fwd.push({ start, end, strand: 1, mismatches: 0 }))
    if (searchRev) {
      const revRe = compile(nucleotidePattern(rcQuery!, options.ambiguity)) as RegExp
      revCut = scanRegex(revRe, text, L, overlapping, MAX_MATCHES,
        (start, end) => rev.push({ start, end, strand: -1, mismatches: 0 }))
    }
  }
  // A palindrome reads the same on both strands: every hit is on both.
  if (rcQuery !== null && !searchRev) for (const m of fwd) m.strand = 0
  return mergeStrands(fwd, rev, fwdCut, revCut)
}

function findProtein(
  query: string, options: SearchOptions, bases: string, circular: boolean, code: GeneticCode,
): SearchResult {
  const L = bases.length
  const re = compile(options.isRegex ? query : proteinPattern(query, options.ambiguity))
  if (typeof re === 'string') return { ...EMPTY, error: re }
  // Reading past the origin needs whole codons, plus up to two bases for the
  // frame offset.
  const ext = circular ? Math.min(L - 1, wrapLength(L, query.length, options.isRegex, 3) + 3) : 0
  const overlapping = !options.isRegex

  const fwd: SearchMatch[] = []
  const rev: SearchMatch[] = []
  let fwdCut = false
  let revCut = false

  if (ext > 0) {
    // Frames depend on the extension, so circular searches are not cached.
    const text = bases + bases.slice(0, ext)
    const rc = options.revComplement ? reverseComplement(bases) : ''
    const rcText = rc + rc.slice(0, ext)
    for (let f = 0 as 0 | 1 | 2; f < 3; f = (f + 1) as 0 | 1 | 2) {
      fwdCut = scanFrame(translateWith(code, text.slice(f)), f, 1, fwd) || fwdCut
      if (options.revComplement) revCut = scanFrame(translateWith(code, rcText.slice(f)), f, -1, rev) || revCut
    }
  } else {
    const frames = framesOf(bases, code, options.revComplement)
    for (let f = 0 as 0 | 1 | 2; f < 3; f = (f + 1) as 0 | 1 | 2) {
      fwdCut = scanFrame(frames.fwd[f], f, 1, fwd) || fwdCut
      if (options.revComplement) revCut = scanFrame(frames.rev[f], f, -1, rev) || revCut
    }
  }

  // Frames were scanned one after another, so each strand is sorted here.
  fwd.sort((a, b) => a.start - b.start)
  rev.sort((a, b) => a.start - b.start)
  return mergeStrands(fwd, rev, fwdCut, revCut)

  /** Hits in one frame's translation, mapped back to forward-strand bases. */
  function scanFrame(protein: string, f: 0 | 1 | 2, strand: 1 | -1, out: SearchMatch[]): boolean {
    // Codons starting at or past the origin repeat ones already read.
    const limit = Math.ceil((L - f) / 3)
    return scanRegex(re as RegExp, protein, limit, overlapping, MAX_MATCHES, (a, b) => {
      const s = f + a * 3
      const e = f + b * 3
      if (strand === 1) {
        out.push({ start: s, end: e, strand, frame: f, mismatches: 0 })
      } else {
        // [s, e) on the reverse strand is [L - e, L - s) on the forward one;
        // a hit that ran past the reverse strand's origin comes back negative,
        // so shift it up a turn to keep end > start.
        let start = L - e
        let end = L - s
        if (start < 0) { start += L; end += L }
        out.push({ start, end, strand, frame: f, mismatches: 0 })
      }
    })
  }
}

/**
 * The bases a match covers, read in its own orientation (so a reverse-strand
 * hit reads as the query does), with `flank` bases of context either side.
 * Positions outside a linear sequence come back as ''.
 */
export function matchContext(
  m: SearchMatch, flank: number, seqLen: number, circular: boolean,
  basesIn: (start: number, end: number) => string,
): { before: string; hit: string; after: string } {
  const read = (s: number, e: number): string => {
    if (!circular) return basesIn(Math.max(0, s), Math.min(seqLen, e))
    // Circular: read in pieces that each lie inside one turn.
    let out = ''
    for (let p = s; p < e;) {
      const w = ((p % seqLen) + seqLen) % seqLen
      const take = Math.min(e - p, seqLen - w)
      out += basesIn(w, w + take)
      p += take
    }
    return out
  }
  const before = read(m.start - flank, m.start)
  const hit = read(m.start, m.end)
  const after = read(m.end, m.end + flank)
  if (m.strand !== -1) return { before, hit, after }
  return { before: reverseComplement(after), hit: reverseComplement(hit), after: reverseComplement(before) }
}

/**
 * Which positions of a hit differ from the query, for marking them in the
 * results. Uses the same rules as the mismatch scan.
 */
export function mismatchPositions(hit: string, query: string, ambiguity: boolean): number[] {
  const q = query.toUpperCase()
  const out: number[] = []
  for (let j = 0; j < hit.length && j < q.length; j++) {
    const code = hit.charCodeAt(j)
    let same: boolean
    if (ambiguity) {
      const bit = code < 128 ? BASE_BIT[code] : 0
      same = bit !== 0 && (bit & (IUPAC_MASK[q[j]] ?? 0)) !== 0
    } else {
      const c = hit[j].toUpperCase()
      same = (c === 'U' ? 'T' : c) === (q[j] === 'U' ? 'T' : q[j])
    }
    if (!same) out.push(j)
  }
  return out
}

/**
 * The feature a hit is in, for the results list: the smallest one containing
 * it, else the smallest it overlaps. Source features cover the whole record
 * and would always win, so they are left out. Feature ranges are half-open and
 * wrap the origin when start > end, as everywhere in the app.
 */
export function featureForHit<T extends { start: number; end: number; type: string }>(
  m: SearchMatch, features: readonly T[], seqLen: number,
): T | null {
  // Unwrap both into turns of the circle so one comparison covers the origin.
  const spans = (s: number, e: number): [number, number][] => {
    if (e > s) return [[s, e], [s + seqLen, e + seqLen]]
    return [[s, e + seqLen]]
  }
  const hit: [number, number] = [m.start, m.end]
  const hitAlt: [number, number] = [m.start - seqLen, m.end - seqLen]
  let best: T | null = null
  let bestScore = Infinity
  for (const f of features) {
    if (f.type === 'source') continue
    const len = f.end > f.start ? f.end - f.start : f.end + seqLen - f.start
    let contains = false
    let overlaps = false
    for (const [s, e] of spans(f.start, f.end)) {
      for (const [hs, he] of [hit, hitAlt]) {
        if (s <= hs && he <= e) contains = true
        if (s < he && hs < e) overlaps = true
      }
    }
    if (!overlaps) continue
    // Any containing feature beats every merely overlapping one.
    const score = (contains ? 0 : 1e12) + len
    if (score < bestScore) { bestScore = score; best = f }
  }
  return best
}
