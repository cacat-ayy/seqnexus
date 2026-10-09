/**
 * What the mapping view reads and lays out.
 *
 * A mapping is stored in pages sorted by position (builder.ts). The view
 * loads only the pages over the stretch around what is on screen, and only
 * when that stretch holds few enough alignments to draw (READ_LOAD_LIMIT);
 * zoomed out further it shows coverage from the stored summaries instead.
 * Pages are kept in a small cache, so scrolling back and forth does not
 * read them again.
 *
 * Laying out the loaded reads:
 * - Downsampling, as IGV does it: at most `max` reads starting in each
 *   window of `window` bases are drawn (100 per 50 by default). Which reads
 *   are kept depends only on a hash of the read's name, so the choice is the
 *   same every time the stretch is drawn and the two mates of a pair are
 *   kept or dropped together. Coverage always counts every read.
 * - Lane packing: reads in order of start, each into the first row where it
 *   fits after the last read there plus a small gap. Rows are found with a
 *   segment tree over the rows' ends, so packing is O(n log rows).
 * - Sorting at a position reorders the rows by what their read shows there
 *   (base, strand, mapping quality, fragment length, start).
 *
 * On a circular reference, an alignment across the origin starts near the
 * end and its end runs past the reference's length. It is drawn there and
 * again from position 0 (shifted back by the length), so its two parts are
 * both on screen.
 */

import { inflateSync } from 'fflate'
import { decodePage, decodeSummaries, refCodeAt, type CoverageLevel, type RefBases, type StoredAlignment } from './alignments'
import { mappingStorageIds, type MappingIndex, type MappingStorage, type PageInfo } from './builder'
import { decodeSites, type PileupSite } from './pileup'
import { readMappingIndex, readReferenceBases } from './sam'
import type { Histogram } from './types'
import { decodeCalls, type SiteCall } from './calls'
import { decodeJunctions, type Junction } from './junctions'

export interface ViewReference {
  name: string
  length: number
  circular: boolean
}

/** Most alignments loaded at once; with more over a stretch, the view shows coverage only. */
export const READ_LOAD_LIMIT = 200_000
/** Widest stretch, in bases, drawn with its reads (IGV's default visibility window is 30 kb). */
export const READ_SPAN_LIMIT = 150_000
/** Decoded pages kept for scrolling back. */
const PAGE_CACHE = 24

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/** A loaded alignment as the view draws it. */
export interface ViewRead {
  a: StoredAlignment
  /** Added to the alignment's positions where it is drawn: 0, or minus the reference's length for the second copy of a read across a circular origin. */
  shift: number
  /** Drawn start and end (alignment, then with soft clips when they are shown). */
  start: number
  end: number
  x0: number
  x1: number
  /** Hash of the read's name, for downsampling. */
  hash: number
  row: number
  /** The differences from the reference, worked out when the read is first drawn. */
  diff: ReadDiff | null
}

function memo<K, V>(m: Map<K, Promise<V>>, k: K, make: () => Promise<V>): Promise<V> {
  let p = m.get(k)
  if (!p) {
    p = make()
    m.set(k, p)
    // A failed read can be tried again.
    p.catch(() => { if (m.get(k) === p) m.delete(k) })
  }
  return p
}

export function hashName(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return h >>> 0
}

export function viewRead(a: StoredAlignment, shift: number): ViewRead {
  const start = a.start + shift
  const end = a.end + shift
  return { a, shift, start, end, x0: start, x1: end, hash: hashName(a.name), row: -1, diff: null }
}

/** Pages of reference `r` with an alignment that may overlap [s, e). */
export function pagesIn(index: MappingIndex, r: number, s: number, e: number): PageInfo[] {
  return (index.refs[r]?.pages ?? []).filter(p => p.first < e && p.maxEnd > s)
}

export class MappingSource {
  private readonly storage: Pick<MappingStorage, 'get'>
  readonly storageId: string
  readonly refs: readonly ViewReference[]
  private indexP: Promise<MappingIndex> | null = null
  private readonly refP = new Map<number, Promise<string>>()
  private readonly sumP = new Map<number, Promise<CoverageLevel[]>>()
  private readonly covP = new Map<number, Promise<Uint32Array>>()
  private readonly sitesP = new Map<number, Promise<PileupSite[]>>()
  private readonly pageP = new Map<number, Promise<StoredAlignment[]>>()
  private readonly callsP = new Map<number, Promise<SiteCall[] | null>>()

  constructor(storage: Pick<MappingStorage, 'get'>, storageId: string, refs: readonly ViewReference[]) {
    this.storage = storage
    this.storageId = storageId
    this.refs = refs
  }

  private async need(id: string, i: number, what: string): Promise<Uint8Array> {
    const d = await this.storage.get(id, i)
    if (!d) throw new Error(`The mapping's ${what} are missing from this browser's storage`)
    return d
  }

  index(): Promise<MappingIndex> {
    if (!this.indexP) {
      const p = readMappingIndex(this.storage, this.storageId)
      this.indexP = p
      p.catch(() => { if (this.indexP === p) this.indexP = null })
    }
    return this.indexP
  }

  reference(r: number): Promise<string> {
    return memo(this.refP, r, () => readReferenceBases(this.storage, this.storageId, r))
  }

  summaries(r: number): Promise<CoverageLevel[]> {
    return memo(this.sumP, r, async () => decodeSummaries(await this.need(mappingStorageIds(this.storageId).summary, r, 'coverage summaries')))
  }

  /** Depth at every base of reference `r`. */
  coverage(r: number): Promise<Uint32Array> {
    return memo(this.covP, r, async () => {
      const raw = inflateSync(await this.need(mappingStorageIds(this.storageId).coverage, r, 'coverage figures'))
      return new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
    })
  }

  sites(r: number): Promise<PileupSite[]> {
    return memo(this.sitesP, r, async () => decodeSites(await this.need(mappingStorageIds(this.storageId).sites, r, 'candidate sites')))
  }

  /** The recounted candidate sites of reference `r` (calls.ts), or null when variants have not been called yet. */
  calls(r: number): Promise<SiteCall[] | null> {
    return memo(this.callsP, r, async () => {
      const d = await this.storage.get(mappingStorageIds(this.storageId).calls, r)
      return d ? decodeCalls(d) : null
    })
  }

  /** Forget loaded calls, after they were (re)computed. */
  forgetCalls(): void {
    this.callsP.clear()
  }

  /** The soft-clip junctions of reference `r` (junctions.ts), or null when they have not been looked for. Not cached. */
  async junctions(r: number): Promise<Junction[] | null> {
    const d = await this.storage.get(mappingStorageIds(this.storageId).junctions, r)
    return d ? decodeJunctions(d) : null
  }

  private page(i: number): Promise<StoredAlignment[]> {
    const hit = this.pageP.get(i)
    if (hit) {
      // Most recently used last.
      this.pageP.delete(i)
      this.pageP.set(i, hit)
      return hit
    }
    const p = memo(this.pageP, i, async () => decodePage(await this.need(mappingStorageIds(this.storageId).pages, i, 'alignments')))
    while (this.pageP.size > PAGE_CACHE) this.pageP.delete(this.pageP.keys().next().value!)
    return p
  }

  /** At most this many alignments overlap [s, e) of reference `r` (every alignment of each page that may). */
  async countIn(r: number, s: number, e: number): Promise<number> {
    const index = await this.index()
    let n = 0
    for (const p of pagesIn(index, r, s, e)) n += p.count
    const ref = this.refs[r]
    if (ref?.circular && s < ref.length) for (const p of pagesIn(index, r, s + ref.length, e + ref.length)) if (p.maxEnd > ref.length) n += p.count
    return n
  }

  /** The alignments over [s, e) of reference `r`, in order of start. */
  async load(r: number, s: number, e: number): Promise<ViewRead[]> {
    const index = await this.index()
    const ref = this.refs[r]
    const L = ref?.length ?? 0
    const main = pagesIn(index, r, s, e)
    const wrap = ref?.circular && s < L ? pagesIn(index, r, s + L, e + L).filter(p => p.maxEnd > L) : []
    const pages = await Promise.all([...new Set([...main, ...wrap].map(p => p.index))].map(i => this.page(i).then(alns => [i, alns] as const)))
    const byIndex = new Map(pages)
    const out: ViewRead[] = []
    // The second copies of reads across the origin come first: they start before 0.
    for (const p of wrap) {
      for (const a of byIndex.get(p.index) ?? []) if (a.end > L && a.end - L > s && a.start - L < e) out.push(viewRead(a, -L))
    }
    out.sort((x, y) => x.start - y.start)
    for (const p of main) {
      for (const a of byIndex.get(p.index) ?? []) if (a.start < e && a.end > s) out.push(viewRead(a, 0))
    }
    return out
  }
}

// ---------------------------------------------------------------------------
// One alignment's differences
// ---------------------------------------------------------------------------

export interface ReadDiff {
  /** Read bases that differ from the reference: position on the reference, base, Phred quality (-1 when there is none). */
  mismatches: { pos: number; base: string; qual: number }[]
  /** Bases inserted before reference position `pos`, with their lowest quality. */
  insertions: { pos: number; bases: string; qual: number }[]
  deletions: { pos: number; len: number }[]
  /** Skipped reference (CIGAR N). */
  skips: { pos: number; len: number }[]
  /** Stretches where the read matches the reference, with the offset of their first base in the read's qualities. */
  matches: { pos: number; len: number; qp: number }[]
}

/** Positions are the alignment's own (add the read's shift to draw them). */
export function readDiff(a: StoredAlignment): ReadDiff {
  const out: ReadDiff = { mismatches: [], insertions: [], deletions: [], skips: [], matches: [] }
  const d = a.diff
  if (d === '*') return out
  const q = a.qual
  const qualAt = (i: number) => (i < q.length ? q.charCodeAt(i) - 33 : -1)
  let p = a.start
  let qp = a.clipL.length
  let i = 0
  while (i < d.length) {
    const op = d[i++]
    if (op === ':' || op === '~') {
      let n = 0
      while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) n = n * 10 + d.charCodeAt(i++) - 48
      if (op === ':') {
        out.matches.push({ pos: p, len: n, qp })
        qp += n
      } else out.skips.push({ pos: p, len: n })
      p += n
    } else if (op === '*') {
      out.mismatches.push({ pos: p, base: d[i + 1].toUpperCase(), qual: qualAt(qp) })
      i += 2
      p++
      qp++
    } else {
      let j = i
      while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
      const n = j - i
      if (op === '+') {
        let lo = q.length ? 99 : -1
        for (let k = 0; k < n && q.length; k++) lo = Math.min(lo, qualAt(qp + k))
        out.insertions.push({ pos: p, bases: d.slice(i, j).toUpperCase(), qual: lo })
        qp += n
      } else {
        out.deletions.push({ pos: p, len: n })
        p += n
      }
      i = j
    }
  }
  return out
}

/** Bases in the read: aligned, inserted and soft-clipped. */
export function queryLength(a: StoredAlignment): number {
  if (a.qual) return a.qual.length
  if (a.diff === '*') return 0
  let n = a.clipL.length + a.clipR.length
  const d = a.diff
  let i = 0
  while (i < d.length) {
    const op = d[i++]
    if (op === ':' || op === '~') {
      let k = 0
      while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) k = k * 10 + d.charCodeAt(i++) - 48
      if (op === ':') n += k
    } else if (op === '*') { n++; i += 2 } else {
      let j = i
      while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
      if (op === '+') n += j - i
      i = j
    }
  }
  return n
}

export interface BaseAt {
  kind: 'match' | 'mismatch' | 'deletion' | 'skip'
  /** Read base ('' in a deletion or skip). */
  base: string
  qual: number
  /** 1-based position in the read as sequenced (counted from the read's own start on the reverse strand); 0 in a deletion. */
  readPos: number
}

/** What the read shows at reference position `pos` (the alignment's own coordinates); null outside it. */
export function baseAt(a: StoredAlignment, ref: RefBases, pos: number): BaseAt | null {
  if (pos < a.start || pos >= a.end || a.diff === '*') return null
  const d = a.diff
  const len = queryLength(a)
  const rev = (a.flag & 0x10) !== 0
  const readPos = (qp: number) => (rev ? len - qp : qp + 1)
  const qualAt = (qp: number) => (qp < a.qual.length ? a.qual.charCodeAt(qp) - 33 : -1)
  let p = a.start
  let qp = a.clipL.length
  let i = 0
  while (i < d.length) {
    const op = d[i++]
    if (op === ':' || op === '~') {
      let n = 0
      while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) n = n * 10 + d.charCodeAt(i++) - 48
      if (pos < p + n) {
        if (op === '~') return { kind: 'skip', base: '', qual: -1, readPos: 0 }
        const k = qp + pos - p
        return { kind: 'match', base: String.fromCharCode(refCodeAt(ref, pos)), qual: qualAt(k), readPos: readPos(k) }
      }
      if (op === ':') qp += n
      p += n
    } else if (op === '*') {
      if (pos === p) return { kind: 'mismatch', base: d[i + 1].toUpperCase(), qual: qualAt(qp), readPos: readPos(qp) }
      i += 2
      p++
      qp++
    } else {
      let j = i
      while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
      const n = j - i
      if (op === '+') qp += n
      else {
        if (pos < p + n) return { kind: 'deletion', base: '', qual: -1, readPos: 0 }
        p += n
      }
      i = j
    }
  }
  return null
}

/** Mismatches, inserted and deleted bases against the reference (the NM tag). */
export function editDistance(d: ReadDiff): number {
  let n = d.mismatches.length
  for (const x of d.insertions) n += x.bases.length
  for (const x of d.deletions) n += x.len
  return n
}

// ---------------------------------------------------------------------------
// Pairs
// ---------------------------------------------------------------------------

/**
 * What a read's pair says, for colouring by pair:
 * - single: not paired; proper: mates facing each other at an expected distance;
 * - larger / smaller: facing each other, further apart or closer than expected
 *   (a deletion or insertion in the sample, between the mates);
 * - orientation: mates on the same strand, or facing away from each other
 *   (an inversion, a rearrangement, or a circular template read across a junction);
 * - otherRef: the mate is on another reference; mateUnmapped: it did not map.
 */
export type PairClass = 'single' | 'proper' | 'larger' | 'smaller' | 'orientation' | 'otherRef' | 'mateUnmapped'

/** Distance from a read's start to its mate's, the short way round a circular reference. */
function mateOffset(a: StoredAlignment, L: number, circular: boolean): number {
  let d = a.matePos - a.start
  if (circular && L > 0 && Math.abs(d) > L / 2) d -= Math.sign(d) * L
  return d
}

/** The fragment's length, or null when the read is not in a pair on this reference. */
export function fragmentLength(a: StoredAlignment, refIndex: number, L: number, circular: boolean): number | null {
  if (!(a.flag & 0x1) || a.flag & 0x8 || a.mateRef !== refIndex || a.matePos < 0) return null
  let t = Math.abs(a.tlen)
  // minimap2 measures across the origin on the extended reference; anything over half the length is the long way round.
  if (circular && L > 0 && t > L / 2) t = L - (t % L)
  return t || null
}

export function pairClass(a: StoredAlignment, refIndex: number, L: number, circular: boolean, expected: readonly [number, number] | null): PairClass {
  const f = a.flag
  if (!(f & 0x1)) return 'single'
  if (f & 0x8) return 'mateUnmapped'
  if (a.mateRef !== refIndex) return 'otherRef'
  const rev = (f & 0x10) !== 0
  const mateRev = (f & 0x20) !== 0
  if (rev === mateRev) return 'orientation'
  // Facing each other: the forward mate on the left.
  const d = mateOffset(a, L, circular)
  if (d !== 0 && (rev ? d > 0 : d < 0)) return 'orientation'
  const t = fragmentLength(a, refIndex, L, circular)
  if (expected && t !== null) {
    if (t > expected[1]) return 'larger'
    if (t < expected[0]) return 'smaller'
  }
  return 'proper'
}

/** The fragment lengths expected: from the 0.5th to the 99.5th percentile of the proper pairs (IGV's default). */
export function expectedInsert(h: Histogram | null): [number, number] | null {
  if (!h || h.counts.length === 0) return null
  const total = h.counts.reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const at = (q: number) => {
    let acc = 0
    for (let i = 0; i < h.counts.length; i++) {
      const c = h.counts[i]
      if (acc + c >= q * total) {
        const t = c ? (q * total - acc) / c : 0
        return h.edges[i] + t * (h.edges[i + 1] - h.edges[i])
      }
      acc += c
    }
    return h.edges[h.edges.length - 1]
  }
  return [Math.floor(at(0.005)), Math.ceil(at(0.995))]
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface LayoutOptions {
  /** Draw soft-clipped bases past the alignment's ends. */
  softClips: boolean
  /** At most `max` reads starting in each `window` bases; null draws every read. */
  downsample: { window: number; max: number } | null
  /** Reads below this mapping quality are left out. */
  minMapq: number
  /** Least space between two reads in a row, in bases. */
  gap: number
  maxRows: number
}

export const DEFAULT_DOWNSAMPLE = { window: 50, max: 100 }
export const MAX_ROWS = 3000

export interface ReadLayout {
  rows: ViewRead[][]
  /** Reads in the stretch that passed the filter. */
  total: number
  /** Left out by the mapping quality filter. */
  filtered: number
  /** Left out by downsampling, and the stretches (merged, in bases) where some were. */
  sampledOut: number
  sampled: [number, number][]
  /** Not drawn because every row was full. */
  overflow: number
}

/** First-fit rows: a segment tree of each row's end, -Infinity for rows not used yet. */
class RowFinder {
  private readonly n: number
  private readonly t: Float64Array
  constructor(rows: number) {
    let n = 1
    while (n < rows) n <<= 1
    this.n = n
    this.t = new Float64Array(2 * n).fill(-Infinity)
    // Rows past the limit never fit.
    for (let i = rows; i < n; i++) this.t[n + i] = Infinity
    for (let i = n - 1; i >= 1; i--) this.t[i] = Math.min(this.t[2 * i], this.t[2 * i + 1])
  }
  /** The first row whose end is at most `x`, or -1. */
  first(x: number): number {
    if (this.t[1] > x) return -1
    let i = 1
    while (i < this.n) i = this.t[2 * i] <= x ? 2 * i : 2 * i + 1
    return i - this.n
  }
  set(row: number, end: number) {
    let i = row + this.n
    this.t[i] = end
    for (i >>= 1; i >= 1; i >>= 1) this.t[i] = Math.min(this.t[2 * i], this.t[2 * i + 1])
  }
}

export function layoutReads(reads: readonly ViewRead[], o: LayoutOptions): ReadLayout {
  let filtered = 0
  const pass: ViewRead[] = []
  for (const r of reads) {
    r.row = -1
    if (r.a.mapq < o.minMapq) { filtered++; continue }
    r.x0 = o.softClips ? r.start - r.a.clipL.length : r.start
    r.x1 = o.softClips ? r.end + r.a.clipR.length : r.end
    pass.push(r)
  }
  pass.sort((x, y) => x.start - y.start || x.x0 - y.x0)

  let kept = pass
  let sampledOut = 0
  const sampled: [number, number][] = []
  if (o.downsample) {
    const { window, max } = o.downsample
    kept = []
    let i = 0
    while (i < pass.length) {
      const w = Math.floor(pass[i].start / window)
      let j = i
      while (j < pass.length && Math.floor(pass[j].start / window) === w) j++
      if (j - i <= max) for (let k = i; k < j; k++) kept.push(pass[k])
      else {
        const keep = new Set(pass.slice(i, j).sort((x, y) => x.hash - y.hash || x.start - y.start).slice(0, max))
        for (let k = i; k < j; k++) if (keep.has(pass[k])) kept.push(pass[k])
        sampledOut += j - i - max
        const s = w * window
        const last = sampled[sampled.length - 1]
        if (last && last[1] === s) last[1] = s + window
        else sampled.push([s, s + window])
      }
      i = j
    }
  }

  kept.sort((x, y) => x.x0 - y.x0)
  const finder = new RowFinder(o.maxRows)
  const rows: ViewRead[][] = []
  let overflow = 0
  for (const r of kept) {
    const row = finder.first(r.x0 - o.gap)
    if (row < 0) { overflow++; continue }
    finder.set(row, r.x1)
    r.row = row
    while (rows.length <= row) rows.push([])
    rows[row].push(r)
  }
  return { rows, total: pass.length, filtered, sampledOut, sampled, overflow }
}

/** The read in a row over position `pos`, by binary search (a row's reads do not overlap). */
export function readInRow(row: readonly ViewRead[], pos: number): ViewRead | null {
  let lo = 0
  let hi = row.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (row[mid].x1 <= pos) lo = mid + 1
    else hi = mid
  }
  const r = row[lo]
  return r && r.x0 <= pos && pos < r.x1 ? r : null
}

/** Index of the first read in a row ending after `pos`. */
export function firstInRow(row: readonly ViewRead[], pos: number): number {
  let lo = 0
  let hi = row.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (row[mid].x1 <= pos) lo = mid + 1
    else hi = mid
  }
  return lo
}

export type SortBy = 'base' | 'strand' | 'mapq' | 'insert' | 'start'

export const SORT_LABEL: Record<SortBy, string> = {
  base: 'Base',
  strand: 'Strand',
  mapq: 'Mapping quality',
  insert: 'Fragment length',
  start: 'Start',
}

const BASE_ORDER: Record<string, number> = { A: 0, C: 1, G: 2, T: 3, N: 4 }

/**
 * Rows reordered by their read at `pos` (shown coordinates). By base: reads
 * that differ from the reference first (grouped A, C, G, T, other, then
 * deletions), then the ones that match, best quality first in each group.
 * Rows with no read there keep their order, last.
 */
export function sortRows(layout: ReadLayout, pos: number, by: SortBy, ref: RefBases, refIndex: number): ReadLayout {
  const L = ref.bases.length
  const keyed = layout.rows.map((row, i) => {
    const r = readInRow(row, pos)
    if (!r || pos < r.start || pos >= r.end) return { row, i, k1: 9, k2: 0 }
    const a = r.a
    switch (by) {
      case 'base': {
        const b = baseAt(a, ref, pos - r.shift)
        if (!b) return { row, i, k1: 8, k2: 0 }
        const k1 = b.kind === 'mismatch' ? BASE_ORDER[b.base] ?? 4 : b.kind === 'deletion' ? 5 : b.kind === 'match' ? 6 : 7
        return { row, i, k1, k2: -b.qual }
      }
      case 'strand': return { row, i, k1: a.flag & 0x10 ? 1 : 0, k2: r.start }
      case 'mapq': return { row, i, k1: 0, k2: -a.mapq }
      case 'insert': {
        const t = fragmentLength(a, refIndex, L, ref.circular)
        return t === null ? { row, i, k1: 1, k2: 0 } : { row, i, k1: 0, k2: -t }
      }
      default: return { row, i, k1: 0, k2: r.start }
    }
  })
  keyed.sort((x, y) => x.k1 - y.k1 || x.k2 - y.k2 || x.i - y.i)
  const rows = keyed.map(k => k.row)
  rows.forEach((row, i) => { for (const r of row) r.row = i })
  return { ...layout, rows }
}

// ---------------------------------------------------------------------------
// Pileup of the loaded stretch
// ---------------------------------------------------------------------------

/**
 * Every loaded read counted at each position of [from, to): depth (aligned
 * bases, as the stored coverage counts them), depth on the forward strand,
 * and A, C, G, T, deletions and insertions after the base. Every read counts,
 * whatever downsampling leaves out of the drawing and whatever its quality,
 * as IGV's coverage track does.
 */
export interface WindowPileup {
  from: number
  to: number
  depth: Uint32Array
  forward: Uint32Array
  /** counts[(p - from) * 6 + allele]. */
  counts: Uint32Array
}

const ALLELE = new Int8Array(128).fill(-1)
ALLELE[65] = 0; ALLELE[67] = 1; ALLELE[71] = 2; ALLELE[84] = 3

export function windowPileup(reads: readonly ViewRead[], ref: RefBases, from: number, to: number): WindowPileup {
  const n = Math.max(0, to - from)
  const depth = new Uint32Array(n)
  const forward = new Uint32Array(n)
  const counts = new Uint32Array(n * 6)
  for (const r of reads) {
    const a = r.a
    if (a.diff === '*' || r.end <= from || r.start >= to) continue
    const fwd = (a.flag & 0x10) === 0
    const shift = r.shift
    const d = a.diff
    let p = a.start
    let i = 0
    const at = (pos: number, allele: number) => {
      const k = pos + shift - from
      if (k < 0 || k >= n) return
      if (allele < 4 || allele === -1) {
        depth[k]++
        if (fwd) forward[k]++
      }
      if (allele >= 0) counts[k * 6 + allele]++
    }
    while (i < d.length) {
      const op = d[i++]
      if (op === ':' || op === '~') {
        let m = 0
        while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) m = m * 10 + d.charCodeAt(i++) - 48
        if (op === ':') {
          const lo = Math.max(p, from - shift)
          const hi = Math.min(p + m, to - shift)
          for (let q = lo; q < hi; q++) at(q, ALLELE[refCodeAt(ref, q)])
        }
        p += m
      } else if (op === '*') {
        at(p, ALLELE[d.charCodeAt(i + 1) - 32])
        i += 2
        p++
      } else {
        let j = i
        while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
        if (op === '+') { if (p > a.start) at(p - 1, 5) } else for (let q = p; q < p + j - i; q++) at(q, 4)
        if (op === '-') p += j - i
        i = j
      }
    }
  }
  return { from, to, depth, forward, counts }
}

/** The coverage level to draw at `basesPerPx`: the coarsest whose bins are no wider than a pixel, or per base (null). */
export function summaryLevel(levels: readonly CoverageLevel[], basesPerPx: number): CoverageLevel | null {
  let best: CoverageLevel | null = null
  for (const l of levels) if (l.binSize <= basesPerPx && (!best || l.binSize > best.binSize)) best = l
  return best
}
