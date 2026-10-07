/**
 * De Bruijn graph assembly of short reads.
 *
 * The solid k-mers (seen at least `threshold` times) are the graph: two
 * k-mers are joined when the last k-1 bases of one are the first k-1 of the
 * other. Where the graph does not branch, k-mers chain into unitigs, the
 * longest stretches the k-mers alone settle. Sequencing errors that are
 * still solid leave short side branches: dead ends (tips) and short
 * detours that rejoin (bubbles). They are removed, the unitigs built again,
 * and so on until nothing changes:
 * - a short unitig (under 2k bases) with a dead end whose coverage is under
 *   TIP_RATIO of the unitigs it hangs from is a tip;
 * - of two short unitigs between the same neighbours (a bubble), the one
 *   with less coverage goes, whatever the ratio: the assembly takes the
 *   majority, and the minority shows up as a variant when the reads are
 *   mapped back;
 * - any short unitig under LOW_RATIO of its neighbours' coverage goes.
 * A unitig whose end leads back to its own start is a circle (a plasmid
 * resolved whole), and loses the k-1 bases it repeats.
 *
 * The graph is walked with k-mers rolled in both orientations, so the
 * neighbours of a k-mer take a shift and a table lookup each, no text.
 */

import { compareWords, kmerText, KmerTable, revcompWords, wordsFor } from './kmer'

/** A tip is removed when its coverage is under this share of its neighbours'. */
export const TIP_RATIO = 0.25
/** A short unitig is removed when its coverage is under this share of its neighbours'. */
export const LOW_RATIO = 0.1

export interface Unitig {
  /** The bases (for a circle, without the k-1 bases it repeats). */
  seq: string
  /** Mean count of its k-mers. */
  coverage: number
  circular: boolean
  /** Its k-mers' slots in the table. */
  slots: number[]
  /** First and last k-mer, oriented along the unitig. */
  first: Uint32Array
  last: Uint32Array
}

/** Walks the graph: the k-mers following an oriented k-mer. */
class Graph {
  readonly k: number
  readonly W: number
  readonly table: KmerTable
  private readonly topBits: number
  private readonly mask0: number
  // Up to four next k-mers: forward words, reverse-complement words, slot, base.
  readonly nf: Uint32Array[]
  readonly nr: Uint32Array[]
  readonly ns = new Int32Array(4)
  readonly nb = new Int8Array(4)

  constructor(table: KmerTable) {
    this.table = table
    this.k = table.k
    this.W = wordsFor(table.k)
    this.topBits = 2 * this.k - 32 * (this.W - 1)
    this.mask0 = this.topBits === 32 ? 0xffffffff : (1 << this.topBits) - 1
    this.nf = [0, 1, 2, 3].map(() => new Uint32Array(this.W))
    this.nr = [0, 1, 2, 3].map(() => new Uint32Array(this.W))
  }

  /** The next k-mers of (f, r) present in the table, into nf/nr/ns/nb; returns how many. */
  next(f: Uint32Array, r: Uint32Array): number {
    const W = this.W
    let n = 0
    for (let b = 0; b < 4; b++) {
      const of = this.nf[n]
      const or = this.nr[n]
      for (let i = 0; i < W - 1; i++) of[i] = ((f[i] << 2) | (f[i + 1] >>> 30)) >>> 0
      of[W - 1] = ((f[W - 1] << 2) | b) >>> 0
      of[0] = (of[0] & this.mask0) >>> 0
      for (let i = W - 1; i > 0; i--) or[i] = ((r[i] >>> 2) | ((r[i - 1] & 3) << 30)) >>> 0
      or[0] = ((r[0] >>> 2) | ((3 - b) << (this.topBits - 2))) >>> 0
      const canon = compareWords(of, or) <= 0 ? of : or
      const s = this.table.find(canon)
      if (s < 0 || this.table.removed[s]) continue
      this.ns[n] = s
      this.nb[n] = b
      n++
    }
    return n
  }

  /** How many k-mers lead into (f, r): the next k-mers of its reverse complement. */
  inDegree(f: Uint32Array, r: Uint32Array): number {
    // next() overwrites the scratch arrays; callers copy what they need first.
    return this.next(r, f)
  }
}

const COMP = 'TGCA'

/** Build the unitigs of the k-mers left in the table. */
export function buildUnitigs(table: KmerTable): Unitig[] {
  const g = new Graph(table)
  const { k, W } = g
  const visited = new Uint8Array(table.capacity)
  const out: Unitig[] = []
  const f = new Uint32Array(W)
  const r = new Uint32Array(W)
  const cf = new Uint32Array(W)
  const cr = new Uint32Array(W)
  const tf = new Uint32Array(W)
  const tr = new Uint32Array(W)

  /** Walk on from (cf, cr) while the path does not branch; returns the bases added and whether it closed on `start`. */
  const walk = (start: number, slots: number[]): { bases: string; closed: boolean } => {
    let bases = ''
    for (;;) {
      if (g.next(cf, cr) !== 1) return { bases, closed: false }
      const s = g.ns[0]
      const b = g.nb[0]
      tf.set(g.nf[0])
      tr.set(g.nr[0])
      if (g.inDegree(tf, tr) !== 1) return { bases, closed: false }
      if (s === start) {
        // Back at the start: a circle if in the same orientation (not a hairpin).
        return { bases, closed: compareWords(tf, f) === 0 }
      }
      if (visited[s]) return { bases, closed: false }
      visited[s] = 1
      slots.push(s)
      bases += 'ACGT'[b]
      cf.set(tf)
      cr.set(tr)
    }
  }

  for (let start = 0; start < table.capacity; start++) {
    if (table.counts[start] === 0 || table.removed[start] || visited[start]) continue
    visited[start] = 1
    for (let i = 0; i < W; i++) f[i] = table.keys[start * W + i]
    revcompWords(f, 0, k, r)
    const right: number[] = []
    cf.set(f)
    cr.set(r)
    const fw = walk(start, right)
    const last = Uint32Array.from(cf)
    let leftBases = ''
    const left: number[] = []
    let first = Uint32Array.from(f)
    if (!fw.closed) {
      cf.set(r)
      cr.set(f)
      const bw = walk(start, left)
      leftBases = bw.bases
      // The left end, turned to face along the unitig.
      first = Uint32Array.from(cr)
    }
    let leftSeq = ''
    for (let i = leftBases.length - 1; i >= 0; i--) leftSeq += COMP['ACGT'.indexOf(leftBases[i])]
    let seq = leftSeq + kmerText(f, 0, k) + fw.bases
    const slots = [...left.reverse(), start, ...right]
    let sum = 0
    for (const s of slots) sum += table.counts[s]
    if (fw.closed) seq = seq.slice(0, seq.length - (k - 1))
    out.push({ seq, coverage: sum / slots.length, circular: fw.closed, slots, first, last })
  }
  return out
}

interface Ends {
  left: Set<number>
  right: Set<number>
}

/** The unitigs next to each unitig's two ends. */
function neighbours(table: KmerTable, unitigs: readonly Unitig[]): Ends[] {
  const g = new Graph(table)
  const owner = new Int32Array(table.capacity).fill(-1)
  unitigs.forEach((u, i) => { for (const s of u.slots) owner[s] = i })
  const W = g.W
  const r = new Uint32Array(W)
  return unitigs.map((u, i) => {
    const left = new Set<number>()
    const right = new Set<number>()
    if (u.circular) return { left, right }
    revcompWords(u.last, 0, g.k, r)
    for (let n = g.next(u.last, r), j = 0; j < n; j++) if (owner[g.ns[j]] >= 0 && owner[g.ns[j]] !== i) right.add(owner[g.ns[j]])
    revcompWords(u.first, 0, g.k, r)
    for (let n = g.next(r, u.first), j = 0; j < n; j++) if (owner[g.ns[j]] >= 0 && owner[g.ns[j]] !== i) left.add(owner[g.ns[j]])
    return { left, right }
  })
}

/**
 * The joins between unitigs, with their orientation: [a, '+', b, '-'] says
 * the end of a leads into the end of b read backwards (b's reverse
 * complement). A circle is linked to itself. Both a join and its mirror
 * come out; graph.ts keeps one.
 */
export function unitigLinks(table: KmerTable, unitigs: readonly Unitig[]): [number, '+' | '-', number, '+' | '-'][] {
  const g = new Graph(table)
  const { k, W } = g
  const owner = new Int32Array(table.capacity).fill(-1)
  unitigs.forEach((u, i) => { for (const s of u.slots) owner[s] = i })
  const rcFirst = unitigs.map(u => revcompWords(u.first, 0, k, new Uint32Array(W)))
  const rcLast = unitigs.map(u => revcompWords(u.last, 0, k, new Uint32Array(W)))
  const out: [number, '+' | '-', number, '+' | '-'][] = []
  const target = (kmer: Uint32Array, slot: number): [number, '+' | '-'] | null => {
    const v = owner[slot]
    if (v < 0) return null
    if (compareWords(kmer, unitigs[v].first) === 0) return [v, '+']
    if (compareWords(kmer, rcLast[v]) === 0) return [v, '-']
    return null
  }
  unitigs.forEach((u, i) => {
    if (u.circular) { out.push([i, '+', i, '+']); return }
    // Out of the end of u (u read forwards), and out of its start (u read backwards).
    for (const [from, rc, strand] of [[u.last, rcLast[i], '+'], [rcFirst[i], u.first, '-']] as const) {
      const n = g.next(from, rc)
      const found: [number, '+' | '-'][] = []
      for (let j = 0; j < n; j++) {
        const t = target(g.nf[j], g.ns[j])
        if (t) found.push(t)
      }
      for (const [v, vs] of found) out.push([i, strand, v, vs])
    }
  })
  return out
}

const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every(x => b.has(x))

/**
 * Remove tips, bubbles and low-coverage short unitigs until none are left
 * (or `rounds` passes); returns the final unitigs.
 */
export function cleanGraph(table: KmerTable, rounds = 10): { unitigs: Unitig[]; removed: number } {
  const k = table.k
  let unitigs = buildUnitigs(table)
  let removed = 0
  for (let round = 0; round < rounds; round++) {
    const ends = neighbours(table, unitigs)
    const drop = new Set<number>()
    const short = (i: number) => unitigs[i].seq.length < 2 * k && !unitigs[i].circular
    const around = (i: number) => {
      let m = 0
      for (const j of ends[i].left) m = Math.max(m, unitigs[j].coverage)
      for (const j of ends[i].right) m = Math.max(m, unitigs[j].coverage)
      return m
    }
    for (let i = 0; i < unitigs.length; i++) {
      if (!short(i)) continue
      const e = ends[i]
      const near = around(i)
      if (near === 0) continue
      const cov = unitigs[i].coverage
      const tip = (e.left.size === 0) !== (e.right.size === 0)
      if ((tip && cov < TIP_RATIO * near) || cov < LOW_RATIO * near) drop.add(i)
    }
    // Bubbles: short unitigs between the same neighbours; keep the best covered.
    const groups = new Map<string, number[]>()
    for (let i = 0; i < unitigs.length; i++) {
      if (!short(i) || drop.has(i)) continue
      const e = ends[i]
      if (e.left.size === 0 || e.right.size === 0) continue
      const a = [...e.left].sort((x, y) => x - y).join(',')
      const b = [...e.right].sort((x, y) => x - y).join(',')
      // The same pair of neighbours whichever way round the unitig runs.
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const list = groups.get(key)
      if (list) list.push(i)
      else groups.set(key, [i])
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue
      // Only true parallels: same neighbours on matching sides.
      const best = list.reduce((x, y) => (unitigs[y].coverage > unitigs[x].coverage ? y : x))
      for (const i of list) {
        if (i === best) continue
        const a = ends[i]
        const b = ends[best]
        if ((sameSet(a.left, b.left) && sameSet(a.right, b.right)) || (sameSet(a.left, b.right) && sameSet(a.right, b.left))) drop.add(i)
      }
    }
    if (drop.size === 0) break
    for (const i of drop) for (const s of unitigs[i].slots) table.remove(s)
    removed += drop.size
    unitigs = buildUnitigs(table)
  }
  return { unitigs, removed }
}

/** Mark k-mers seen fewer than `threshold` times as removed. */
export function applyThreshold(table: KmerTable, threshold: number): number {
  let solid = 0
  for (let s = 0; s < table.capacity; s++) {
    if (table.counts[s] === 0) continue
    if (table.counts[s] < threshold) table.removed[s] = 1
    else solid++
  }
  return solid
}

/** N50 of a list of lengths: half the bases are in pieces at least this long. */
export function n50(lengths: readonly number[]): number {
  const s = [...lengths].sort((a, b) => b - a)
  const half = s.reduce((a, b) => a + b, 0) / 2
  let acc = 0
  for (const l of s) { acc += l; if (acc >= half) return l }
  return 0
}
