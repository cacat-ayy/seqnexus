/**
 * Joining short-read contigs across repeats with the read pairs.
 *
 * A de Bruijn graph breaks wherever a repeat longer than k leaves it more
 * than one way on. A read pair is two reads from the ends of one fragment of
 * known size (the insert), so a pair with its mates on two contigs says the
 * contigs follow each other, on which strands, and about how far apart. When
 * exactly one path through the graph between those two contig ends has that
 * length, the path is the sequence between them, and the contigs are joined
 * through it. That resolves repeats shorter than the insert, as SPAdes's
 * repeat resolution and ABySS's paired-end stage do; longer ones stay
 * breaks.
 *
 * 1. Placing reads: every unitig's canonical 31-mers whose hash falls in
 *    one eighth of hashes are indexed (31-mers in two places are left out).
 *    A read is placed by the first of its own 31-mers that hits the index,
 *    which gives its unitig, strand and where its 5' end lies. Sampling by
 *    hash, not by position, means a read and a unitig sample the same
 *    k-mers, so the index is an eighth of the size and still places nearly
 *    every read. 31 rather than the graph's k: a mate lying mostly over a
 *    repeat is still placed by a short unique stretch, which lets pairs
 *    span longer repeats (with the graph's k of 99, a mate would need over
 *    100 unique bases, and a 350 bp insert would span repeats of about
 *    130 bp at most, against about 230 bp).
 * 2. Insert size: pairs with both mates on one unitig, facing each other,
 *    give the insert's median and spread (the median absolute deviation,
 *    scaled to a standard deviation).
 * 3. Links: a pair with its mates on two anchors (unitigs at least as long
 *    as the insert, so the mates can face out of them) links the end each
 *    mate faces. Each pair estimates the gap between the two ends as the
 *    insert less the bases from each mate's 5' end to its unitig's end.
 * 4. Joins: an anchor end whose strongest link (at least MIN_PAIRS pairs,
 *    and four times the next) is returned in kind by the other end is
 *    joined to it when exactly one path of short unitigs between them fits
 *    the gap. Chains of joins become contigs; a chain that comes back to its
 *    start is a circle.
 */

import { decodeChunk } from '../codec'
import { KmerRoller, hashWords } from './kmer'
import { NIBBLE_TO_CODE, readCodes, readDraw } from './spectrum'
import type { GraphLink, Strand } from './graph'
import type { PairJoinReport } from './types'

/** Pairs a link needs to be acted on. */
export const MIN_PAIRS = 5
/** The strongest link at an end must have this many times the pairs of the next. */
export const DOMINANCE = 4
/** One in this many k-mers (by hash) is indexed. */
export const SAMPLE = 8
/** k of the index that places reads. */
export const PLACE_K = 31
/** Paths searched between two ends at most, before giving up on them. */
const MAX_PATHS = 2000

export interface PairUnitig {
  seq: string
  circular: boolean
  coverage: number
}

export interface Placement {
  tig: number
  /** Unitig coordinate of the read's first base. */
  pos5: number
  /** True when the read runs toward higher coordinates. */
  forward: boolean
}

const flip = (s: Strand): Strand => (s === '+' ? '-' : '+')

/** The sparse k-mer index of the unitigs: hash -> entry (or -1 where the k-mer is in two places). */
export class SparseIndex {
  readonly k: number
  private readonly map = new Map<number, number>()
  private readonly tig: number[] = []
  private readonly off: number[] = []
  private readonly canonFwd: boolean[] = []

  constructor(tigs: readonly PairUnitig[], k: number) {
    this.k = k
    const roller = new KmerRoller(k)
    const BASE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }
    tigs.forEach((u, t) => {
      roller.reset()
      const s = u.seq
      for (let i = 0; i < s.length; i++) {
        if (!roller.push(BASE[s[i]] ?? -1)) continue
        const h = hashWords(roller.canonical(), 0, roller.W)
        if (h % SAMPLE !== 0) continue
        const had = this.map.get(h)
        if (had !== undefined) { this.map.set(h, -1); continue }
        this.map.set(h, this.tig.length)
        this.tig.push(t)
        this.off.push(i - k + 1)
        this.canonFwd.push(roller.forwardIsCanonical())
      }
    })
  }

  get size(): number { return this.map.size }

  /** Place a read (base codes 0-3, -1 for others). */
  place(codes: ArrayLike<number>, roller: KmerRoller): Placement | null {
    const k = this.k
    roller.reset()
    for (let p = 0; p < codes.length; p++) {
      if (!roller.push(codes[p])) continue
      const h = hashWords(roller.canonical(), 0, roller.W)
      if (h % SAMPLE !== 0) continue
      const e = this.map.get(h)
      if (e === undefined || e < 0) continue
      const start = p - k + 1
      const same = roller.forwardIsCanonical() === this.canonFwd[e]
      return same
        ? { tig: this.tig[e], pos5: this.off[e] - start, forward: true }
        : { tig: this.tig[e], pos5: this.off[e] + k - 1 + start, forward: false }
    }
    return null
  }
}

/** Insert size of a pair with both mates on one unitig, facing each other; null otherwise. */
export function insertOf(a: Placement, b: Placement): number | null {
  if (a.tig !== b.tig || a.forward === b.forward) return null
  const [f, r] = a.forward ? [a, b] : [b, a]
  const ins = r.pos5 - f.pos5 + 1
  return ins > 0 ? ins : null
}

/** The end a mate faces out of, and the bases from its 5' end to that end. */
export function exitOf(m: Placement, length: number): { strand: Strand; dist: number } {
  return m.forward ? { strand: '+', dist: length - m.pos5 } : { strand: '-', dist: m.pos5 + 1 }
}

export interface Join {
  from: number
  fromStrand: Strand
  to: number
  toStrand: Strand
  /** Short unitigs between, oriented. */
  via: [number, Strand][]
}

export interface PairJoinResult {
  contigs: { seq: string; circular: boolean; coverage: number; parts: [number, Strand][] }[]
  /** Unitigs used inside a join (not contigs of their own any more). */
  used: Set<number>
  report: PairJoinReport
}

/** Oriented neighbours of each oriented unitig: out[t*2 + (s === '-' ? 1 : 0)]. */
function adjacency(n: number, links: readonly GraphLink[]): [number, Strand][][] {
  const out: [number, Strand][][] = Array.from({ length: n * 2 }, () => [])
  const at = (t: number, s: Strand) => t * 2 + (s === '-' ? 1 : 0)
  const seen = new Set<string>()
  const add = (a: number, as: Strand, b: number, bs: Strand) => {
    const key = `${a}${as}${b}${bs}`
    if (seen.has(key)) return
    seen.add(key)
    out[at(a, as)].push([b, bs])
  }
  for (const [a, as, b, bs] of links) {
    add(a, as, b, bs)
    add(b, flip(bs), a, flip(as))
  }
  return out
}

/**
 * Paths of short unitigs from the end of (a, as) to the start of (b, bs)
 * whose gap (bases between, the k-1 overlaps taken off) is within `tol` of
 * `gap`. Stops counting at 2: only a single path is of use.
 */
export function pathsBetween(
  adj: [number, Strand][][], lengths: readonly number[], k: number, a: number, as: Strand, b: number, bs: Strand,
  gap: number, tol: number, passable: (t: number) => boolean,
): [number, Strand][][] {
  const found: [number, Strand][][] = []
  const path: [number, Strand][] = []
  let explored = 0
  const walk = (t: number, s: Strand, sum: number) => {
    if (found.length > 1 || ++explored > MAX_PATHS) return
    const n = path.length
    for (const [x, xs] of adj[t * 2 + (s === '-' ? 1 : 0)]) {
      const g = sum - (n + 1) * (k - 1)
      if (x === b && xs === bs) {
        if (Math.abs(g - gap) <= tol) found.push([...path])
        continue
      }
      if (!passable(x) || path.some(([y]) => y === x)) continue
      // The gap only grows from here (each unitig is longer than the overlap it costs).
      if (sum + lengths[x] - (n + 2) * (k - 1) > gap + tol) continue
      path.push([x, xs])
      walk(x, xs, sum + lengths[x])
      path.pop()
    }
  }
  walk(a, as, 0)
  if (explored > MAX_PATHS) return [[], []]
  return found
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A' }
const oriented = (s: string, st: Strand) => {
  if (st === '+') return s
  let o = ''
  for (let i = s.length - 1; i >= 0; i--) o += COMP[s[i]] ?? 'N'
  return o
}

/** Bases of a chain of oriented unitigs overlapping by k-1. */
export function chainSequence(tigs: readonly PairUnitig[], parts: readonly [number, Strand][], k: number): string {
  const out: string[] = []
  parts.forEach(([t, s], i) => out.push(i === 0 ? oriented(tigs[t].seq, s) : oriented(tigs[t].seq, s).slice(k - 1)))
  return out.join('')
}

export async function joinWithPairs(o: {
  unitigs: readonly PairUnitig[]
  links: readonly GraphLink[]
  k: number
  /** Unitigs at least this long are contigs. */
  minContig: number
  chunks: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  /** Share of the pairs to look at. */
  pairShare: number
  onProgress?: (done: number, total: number) => void
}): Promise<PairJoinResult> {
  const { unitigs: tigs, k } = o
  const lengths = tigs.map(u => u.seq.length)
  const placeK = Math.min(PLACE_K, k)
  const index = new SparseIndex(tigs, placeK)
  const roller = new KmerRoller(placeK)

  // 1. Place the pairs.
  const placed: [Placement, Placement][] = []
  let g = 0
  let mate: Placement | null | undefined
  for (let c = 0; c < o.chunks; c++) {
    const packed = await o.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const ch = decodeChunk(packed)
    for (let i = 0; i < ch.count; i++, g++) {
      const pair = g >> 1
      if (readDraw(pair) >= o.pairShare) continue
      const codes = Array.from(readCodes(ch, i), x => NIBBLE_TO_CODE[x])
      const p = index.place(codes, roller)
      if ((g & 1) === 0) { mate = p; continue }
      if (mate && p) placed.push([mate, p])
      mate = undefined
    }
    o.onProgress?.(c + 1, o.chunks)
  }

  // 2. Insert size.
  const inserts: number[] = []
  for (const [a, b] of placed) {
    const ins = insertOf(a, b)
    if (ins !== null && ins < 5000) inserts.push(ins)
  }
  inserts.sort((x, y) => x - y)
  const report: PairJoinReport = { placed: inserts.length, insert: 0, insertSd: 0, linking: 0, joins: 0, unresolved: 0 }
  const isContig = (t: number) => lengths[t] >= o.minContig
  const plain = (): PairJoinResult => ({
    contigs: tigs.map((u, t) => ({ u, t })).filter(x => isContig(x.t)).map(({ u, t }) => ({ seq: u.seq, circular: u.circular, coverage: u.coverage, parts: [[t, '+']] })),
    used: new Set(),
    report,
  })
  if (inserts.length < 100) return plain()
  const median = inserts[inserts.length >> 1]
  const dev = inserts.map(x => Math.abs(x - median)).sort((x, y) => x - y)
  const sd = Math.max(5, 1.4826 * dev[dev.length >> 1])
  report.insert = median
  report.insertSd = Math.round(sd * 10) / 10

  // 3. Links between anchor ends.
  const anchorLength = Math.max(o.minContig, median)
  const anchor = (t: number) => lengths[t] >= anchorLength && !tigs[t].circular
  const endKey = (t: number, s: Strand) => t * 2 + (s === '-' ? 1 : 0)
  // links[end] = map of the other end (as the path enters it) -> gaps.
  const linkGaps = new Map<number, Map<number, number[]>>()
  const addLink = (fromEnd: number, toEnd: number, gap: number) => {
    let m = linkGaps.get(fromEnd)
    if (!m) { m = new Map(); linkGaps.set(fromEnd, m) }
    const list = m.get(toEnd)
    if (list) list.push(gap)
    else m.set(toEnd, [gap])
  }
  for (const [a, b] of placed) {
    if (a.tig === b.tig || !anchor(a.tig) || !anchor(b.tig)) continue
    const ea = exitOf(a, lengths[a.tig])
    const eb = exitOf(b, lengths[b.tig])
    const gap = median - ea.dist - eb.dist
    // Leaving a through ea, entering b on the strand facing back at its mate.
    addLink(endKey(a.tig, ea.strand), endKey(b.tig, flip(eb.strand)), gap)
    addLink(endKey(b.tig, eb.strand), endKey(a.tig, flip(ea.strand)), gap)
    report.linking++
  }

  // 4. Joins: mutual strongest links with a single path that fits.
  const best = new Map<number, { to: number; gap: number; pairs: number }>()
  for (const [from, m] of linkGaps) {
    const ranked = [...m.entries()].sort((x, y) => y[1].length - x[1].length)
    const [to, gaps] = ranked[0]
    const second = ranked[1]?.[1].length ?? 0
    if (gaps.length < MIN_PAIRS || gaps.length < DOMINANCE * second) continue
    const sorted = [...gaps].sort((x, y) => x - y)
    best.set(from, { to, gap: sorted[sorted.length >> 1], pairs: gaps.length })
  }
  const adj = adjacency(tigs.length, o.links)
  // A path may pass through short unitigs only (repeats and pieces the pairs can span).
  const passable = (t: number) => lengths[t] < anchorLength
  const tol = Math.max(30, 1.5 * sd)
  const joins: Join[] = []
  const done = new Set<number>()
  for (const [from, b] of best) {
    if (done.has(from)) continue
    // The other end's strongest link must come back here: entering `to` is leaving its mirror end.
    const toT = b.to >> 1
    const toS: Strand = b.to & 1 ? '-' : '+'
    const back = best.get(endKey(toT, flip(toS)))
    const fromT = from >> 1
    const fromS: Strand = from & 1 ? '-' : '+'
    if (!back || back.to !== endKey(fromT, flip(fromS))) { report.unresolved++; continue }
    done.add(from)
    done.add(endKey(toT, flip(toS)))
    const paths = pathsBetween(adj, lengths, k, fromT, fromS, toT, toS, b.gap, tol, passable)
    if (paths.length !== 1) { report.unresolved++; continue }
    joins.push({ from: fromT, fromStrand: fromS, to: toT, toStrand: toS, via: paths[0] })
  }

  // Chains: each anchor end takes part in one join at most.
  const next = new Map<number, Join>()
  for (const j of joins) {
    next.set(endKey(j.from, j.fromStrand), j)
    // The mirror: leaving `to` backwards leads back into `from` backwards.
    next.set(endKey(j.to, flip(j.toStrand)), {
      from: j.to, fromStrand: flip(j.toStrand), to: j.from, toStrand: flip(j.fromStrand),
      via: [...j.via].reverse().map(([t, s]) => [t, flip(s)] as [number, Strand]),
    })
  }
  report.joins = joins.length
  const used = new Set<number>()
  for (const j of joins) for (const [t] of j.via) used.add(t)
  const inChain = new Set<number>()
  const contigs: PairJoinResult['contigs'] = []
  const chainFrom = (t: number, s: Strand): { parts: [number, Strand][]; circular: boolean } => {
    const parts: [number, Strand][] = [[t, s]]
    inChain.add(t)
    let cur = t
    let st = s
    for (;;) {
      const j = next.get(endKey(cur, st))
      if (!j) return { parts, circular: false }
      if (j.to === t) {
        parts.push(...j.via)
        return { parts, circular: true }
      }
      if (inChain.has(j.to)) return { parts, circular: false }
      parts.push(...j.via, [j.to, j.toStrand])
      inChain.add(j.to)
      cur = j.to
      st = j.toStrand
    }
  }
  for (let t = 0; t < tigs.length; t++) {
    if (inChain.has(t) || used.has(t)) continue
    if (!isContig(t) && !anchor(t)) continue
    if (!anchor(t)) {
      contigs.push({ seq: tigs[t].seq, circular: tigs[t].circular, coverage: tigs[t].coverage, parts: [[t, '+']] })
      inChain.add(t)
      continue
    }
    // Start a chain at an end with nothing before it (or anywhere on a circle).
    const before = next.get(endKey(t, '-'))
    let start: [number, Strand] = [t, '+']
    if (before) {
      // Walk back to the chain's first anchor.
      let cur: [number, Strand] = [t, '-']
      const seen = new Set<number>([t])
      for (;;) {
        const j = next.get(endKey(cur[0], cur[1]))
        if (!j || seen.has(j.to)) break
        seen.add(j.to)
        cur = [j.to, j.toStrand]
      }
      start = [cur[0], flip(cur[1])]
    }
    const chain = chainFrom(start[0], start[1])
    let seq = chainSequence(tigs, chain.parts, k)
    if (chain.circular) seq = seq.slice(0, seq.length - (k - 1))
    let cov = 0
    let bases = 0
    for (const [p] of chain.parts) { cov += tigs[p].coverage * lengths[p]; bases += lengths[p] }
    contigs.push({ seq, circular: chain.circular, coverage: bases ? cov / bases : 0, parts: chain.parts })
  }
  return { contigs, used, report }
}
