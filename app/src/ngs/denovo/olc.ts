/**
 * Long reads of a genome to unitigs, by overlaps: a string graph as miniasm
 * builds one (Li 2016).
 *
 * The reads come with their all-against-all overlaps (minimap2 -x ava-ont,
 * read from PAF), and nothing else: no read is corrected first, so the
 * unitigs have the reads' own error rate until polishing (genome.ts).
 *
 * 1. Overlaps with fewer than MIN_MATCH matching bases, or shorter than the
 *    shortest overlap, are dropped.
 * 2. Trimming: each read keeps its longest stretch covered by at least
 *    MIN_DEPTH other reads. That cuts off low-quality ends and adapters the
 *    other reads do not share, and a chimeric read (two pieces of the genome
 *    joined) keeps only its longer piece, since few reads span the join.
 * 3. Each overlap is placed on the trimmed reads and classed, with the
 *    overhangs (the bases before and after the overlap that each read has
 *    and the other does not):
 *    - internal: an overhang longer than MAX_HANG, or the overlap under
 *      INT_FRAC of the stretch it would join. Two reads sharing a repeat but
 *      going on into different places. Dropped.
 *    - containment: one read lies inside the other. The read inside adds
 *      nothing to the layout and is set aside (it still polishes).
 *    - dovetail: the end of one read runs into the start of the other, an
 *      arc of the graph.
 * 4. The graph has two vertices a read, one for each strand; an arc v -> w
 *    of length l says that v's first l bases come before w starts. Every
 *    arc has its mirror (w's reverse complement -> v's).
 * 5. Cleaning, as miniasm does: transitive reduction (Myers 2005: an arc
 *    v -> x is dropped when v -> w -> x reaches x as far along, within FUZZ
 *    bases), tips (dead ends of up to MAX_TIP reads off a branch: chimeras
 *    and reads with bad ends), short overlaps (at a branch, an arc whose
 *    overlap is under a share of the longest one there: a repeat shared
 *    with another place), and small bubbles (two short paths between the
 *    same reads, a mixed site or a run of errors: the path through more
 *    reads stays).
 * 6. Unitigs: the paths without a branch, each read contributing the bases
 *    before the next read starts; a path that comes back to its start is a
 *    circle.
 */

export interface Overlap {
  /** Query and target read, by index. */
  q: number
  t: number
  /** Query start and end, on the query's forward strand. */
  qs: number
  qe: number
  /** True when the target is on the opposite strand. */
  rev: boolean
  ts: number
  te: number
  /** Matching bases and the alignment block's length, as minimap2 reports them. */
  matches: number
  block: number
}

/** Fewest matching bases (minimap2's 10th PAF column) an overlap needs. */
export const MIN_MATCH = 100
/** Least depth of other reads a read's kept stretch needs. */
export const MIN_DEPTH = 3
/** Longest overhang of an overlap that still counts as joining two reads. */
export const MAX_HANG = 1000
/** An overlap must be at least this share of the stretch it joins. */
export const INT_FRAC = 0.8
/** Transitive reduction tolerance, bases. */
export const FUZZ = 1000
/** A dead end of at most this many reads off a branch is a tip. */
export const MAX_TIP = 4
/** Bubbles are popped up to this many bases across. */
export const MAX_BUBBLE = 50_000
/** At a branch, arcs with an overlap under these shares of the longest are dropped (in turn). */
export const SHORT_OVERLAP_RATIOS = [0.7, 0.8]

/** Read names in minimap2's PAF are r<index>. */
const readIndex = (name: string) => Number(name.slice(1))

/** Parse PAF lines into overlaps (self overlaps skipped). */
export function parsePaf(paf: string, out: Overlap[] = []): Overlap[] {
  let from = 0
  while (from < paf.length) {
    let to = paf.indexOf('\n', from)
    if (to < 0) to = paf.length
    if (to > from) {
      const f = paf.slice(from, to).split('\t', 12)
      const q = readIndex(f[0])
      const t = readIndex(f[5])
      if (q !== t && f.length >= 11) {
        out.push({
          q, t, qs: Number(f[2]), qe: Number(f[3]), rev: f[4] === '-',
          ts: Number(f[7]), te: Number(f[8]), matches: Number(f[9]), block: Number(f[10]),
        })
      }
    }
    from = to + 1
  }
  return out
}

/** Each read's kept stretch: [start, end), or end 0 when it is dropped. */
export interface Trim {
  start: Int32Array
  end: Int32Array
}

/**
 * Each read's longest stretch covered by at least `minDepth` overlaps.
 * Reads with no such stretch of `minSpan` bases are dropped (end 0).
 */
export function trimReads(lengths: ArrayLike<number>, overlaps: readonly Overlap[], minDepth = MIN_DEPTH, minSpan = 1000): Trim {
  const n = lengths.length
  // Interval ends on each read, as +1 at a start and -1 at an end.
  const events: number[][] = Array.from({ length: n }, () => [])
  for (const o of overlaps) {
    events[o.q].push(o.qs * 2 + 1, o.qe * 2)
    events[o.t].push(o.ts * 2 + 1, o.te * 2)
  }
  const start = new Int32Array(n)
  const end = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const ev = events[i]
    if (ev.length === 0) continue
    // Ends (even) sort before starts (odd) at the same place: touching intervals do not overlap.
    ev.sort((a, b) => a - b)
    let depth = 0
    let open = -1
    let bestS = 0
    let bestE = 0
    for (const e of ev) {
      const at = e >> 1
      if (e & 1) {
        depth++
        if (depth === minDepth) open = at
      } else {
        if (depth === minDepth && open >= 0 && at - open > bestE - bestS) { bestS = open; bestE = at }
        depth--
      }
    }
    if (bestE - bestS >= minSpan) { start[i] = bestS; end[i] = bestE }
    events[i] = []
  }
  return { start, end }
}

export const enum OverlapKind { Internal, QueryContained, TargetContained, Dovetail, Short }

export interface Arc {
  /** From vertex (read * 2 + strand), to vertex, and length (bases of `from` before `to` starts). */
  v: number
  w: number
  len: number
  /** Overlap length on `from`. */
  ol: number
  del: boolean
}

/**
 * Class an overlap on the trimmed reads, and for a dovetail give the arc
 * from the query's side (as miniasm's ma_hit2arc). Coordinates are moved
 * onto the kept stretches first; an overlap reaching outside a stretch is
 * cut to it.
 */
export function classify(o: Overlap, trim: Trim, minOverlap: number, maxHang = MAX_HANG, intFrac = INT_FRAC): { kind: OverlapKind; arc?: Arc } {
  const qS = trim.start[o.q]
  const qL = trim.end[o.q] - qS
  const tS = trim.start[o.t]
  const tL = trim.end[o.t] - tS
  let qs = o.qs - qS
  let qe = o.qe - qS
  let ts = o.ts - tS
  let te = o.te - tS
  // Cut to the kept stretches, keeping the two reads' parts in step (roughly, by the same number of bases).
  if (qs < 0) { if (o.rev) te += qs; else ts -= qs; qs = 0 }
  if (qe > qL) { if (o.rev) ts += qe - qL; else te -= qe - qL; qe = qL }
  if (ts < 0) { if (o.rev) qe += ts; else qs -= ts; ts = 0 }
  if (te > tL) { if (o.rev) qs += te - tL; else qe -= te - tL; te = tL }
  if (qe - qs <= 0 || te - ts <= 0) return { kind: OverlapKind.Internal }
  // The target's overhangs, seen along the query's strand.
  const tl5 = o.rev ? tL - te : ts
  const tl3 = o.rev ? ts : tL - te
  const ext5 = Math.min(qs, tl5)
  const ext3 = Math.min(qL - qe, tl3)
  if (ext5 > maxHang || ext3 > maxHang || qe - qs < (qe - qs + ext5 + ext3) * intFrac) return { kind: OverlapKind.Internal }
  if (qs <= tl5 && qL - qe <= tl3) return { kind: OverlapKind.QueryContained }
  if (qs >= tl5 && qL - qe >= tl3) return { kind: OverlapKind.TargetContained }
  if (qe - qs + ext5 + ext3 < minOverlap || te - ts + ext5 + ext3 < minOverlap) return { kind: OverlapKind.Short }
  let v: number
  let w: number
  let len: number
  if (qs > tl5) {
    // The query starts first: query forward, then the target on its strand.
    v = o.q * 2
    w = o.t * 2 + (o.rev ? 1 : 0)
    len = qs - tl5
  } else {
    // The target starts first: read backwards, the query comes first.
    v = o.q * 2 + 1
    w = o.t * 2 + (o.rev ? 0 : 1)
    len = qL - qe - tl3
  }
  return { kind: OverlapKind.Dovetail, arc: { v, w, len, ol: qL - len, del: false } }
}

/** The overlap seen from the target's side. */
export function swapped(o: Overlap): Overlap {
  return { q: o.t, t: o.q, qs: o.ts, qe: o.te, rev: o.rev, ts: o.qs, te: o.qe, matches: o.matches, block: o.block }
}

/** The string graph: arcs out of each vertex, shortest first. */
export class StringGraph {
  readonly reads: number
  readonly arcs: Arc[][]
  /** Reads taken out (contained, or cut as tips and the like). */
  readonly gone: Uint8Array

  constructor(reads: number) {
    this.reads = reads
    this.arcs = Array.from({ length: reads * 2 }, () => [])
    this.gone = new Uint8Array(reads)
  }

  add(a: Arc): void { this.arcs[a.v].push(a) }

  out(v: number): Arc[] { return this.arcs[v] }

  /** Live arcs out of v. */
  live(v: number): Arc[] { return this.arcs[v].filter(a => !a.del) }

  outDegree(v: number): number {
    let n = 0
    for (const a of this.arcs[v]) if (!a.del) n++
    return n
  }

  /** Arcs into v are the mirrors of arcs out of v's reverse complement. */
  inDegree(v: number): number { return this.outDegree(v ^ 1) }

  /** Sort each vertex's arcs by length, and keep one arc per pair of vertices (the longest overlap). */
  tidy(): void {
    for (let v = 0; v < this.arcs.length; v++) {
      const list = this.arcs[v].filter(a => !a.del && !this.gone[a.w >> 1] && !this.gone[v >> 1])
      list.sort((a, b) => a.len - b.len || b.ol - a.ol)
      const seen = new Set<number>()
      this.arcs[v] = list.filter(a => (seen.has(a.w) ? false : (seen.add(a.w), true)))
    }
  }

  /** Drop arcs whose mirror is gone, so v -> w stands exactly when w' -> v' does. */
  symmetrize(): number {
    let n = 0
    for (let v = 0; v < this.arcs.length; v++) {
      for (const a of this.arcs[v]) {
        if (a.del) continue
        const mirror = this.arcs[a.w ^ 1].some(b => !b.del && b.w === (v ^ 1))
        if (!mirror) { a.del = true; n++ }
      }
    }
    return n
  }

  /** Take a read out of the graph with every arc touching it. */
  removeRead(r: number): void {
    this.gone[r] = 1
    for (const v of [r * 2, r * 2 + 1]) {
      for (const a of this.arcs[v]) {
        a.del = true
        for (const b of this.arcs[a.w ^ 1]) if (b.w === (v ^ 1)) b.del = true
      }
    }
  }
}

/** Build the graph from overlaps on trimmed reads; contained reads are taken out. */
export function buildGraph(n: number, overlaps: readonly Overlap[], trim: Trim, minOverlap: number): { graph: StringGraph; contained: Int32Array; containedIn: Int32Array } {
  const g = new StringGraph(n)
  for (let i = 0; i < n; i++) if (trim.end[i] === 0) g.gone[i] = 1
  // Reads inside each read (counted for depth), and the read each is inside (its longest container).
  const contained = new Int32Array(n)
  const containedIn = new Int32Array(n).fill(-1)
  const keptLength = (r: number) => trim.end[r] - trim.start[r]
  for (const o of overlaps) {
    if (g.gone[o.q] || g.gone[o.t]) continue
    const c = classify(o, trim, minOverlap)
    if (c.kind === OverlapKind.QueryContained || c.kind === OverlapKind.TargetContained) {
      const inner = c.kind === OverlapKind.QueryContained ? o.q : o.t
      const outer = inner === o.q ? o.t : o.q
      // Two reads inside each other (the same stretch): the shorter goes.
      if (containedIn[inner] < 0 || keptLength(outer) > keptLength(containedIn[inner])) containedIn[inner] = outer
    }
  }
  for (let r = 0; r < n; r++) {
    if (containedIn[r] < 0 || g.gone[r]) continue
    // The read it is inside may itself be inside another: count it at the top.
    let top = containedIn[r]
    for (let hops = 0; containedIn[top] >= 0 && hops < 50; hops++) top = containedIn[top]
    contained[top]++
    g.gone[r] = 1
  }
  for (const o of overlaps) {
    if (g.gone[o.q] || g.gone[o.t]) continue
    const a = classify(o, trim, minOverlap)
    const b = classify(swapped(o), trim, minOverlap)
    if (a.arc && b.arc) {
      g.add(a.arc)
      g.add(b.arc)
    }
  }
  g.tidy()
  g.symmetrize()
  return { graph: g, contained, containedIn }
}

/** Myers' transitive reduction; returns the arcs dropped. */
export function transitiveReduction(g: StringGraph, fuzz = FUZZ): number {
  const mark = new Uint8Array(g.arcs.length)
  let reduced = 0
  for (let v = 0; v < g.arcs.length; v++) {
    const av = g.out(v).filter(a => !a.del)
    if (av.length === 0) continue
    for (const a of av) mark[a.w] = 1
    const longest = av[av.length - 1].len + fuzz
    for (const a of av) {
      if (mark[a.w] !== 1) continue
      for (const b of g.out(a.w)) {
        if (b.del) continue
        if (a.len + b.len > longest) break
        if (mark[b.w]) mark[b.w] = 2
      }
    }
    for (const a of av) {
      if (mark[a.w] === 2) { a.del = true; reduced++ }
      mark[a.w] = 0
    }
  }
  if (reduced) g.symmetrize()
  return reduced
}

/**
 * Follow v forward while the path does not branch, up to `max` reads.
 * Returns the reads passed and how the path ended.
 */
function extend(g: StringGraph, v: number, max: number): { path: number[]; end: 'dead' | 'branch-out' | 'branch-in' | 'long' } {
  const path = [v]
  let x = v
  for (;;) {
    const out = g.live(x)
    if (out.length === 0) return { path, end: 'dead' }
    if (out.length > 1) return { path, end: 'branch-out' }
    const w = out[0].w
    if (g.inDegree(w) > 1) return { path, end: 'branch-in' }
    if (w === v || path.length >= max) return { path, end: 'long' }
    path.push(w)
    x = w
  }
}

/** Cut tips: short dead-end paths hanging off a branch. Returns the reads taken out. */
export function cutTips(g: StringGraph, maxTip = MAX_TIP): number {
  let cut = 0
  for (let v = 0; v < g.arcs.length; v++) {
    if (g.gone[v >> 1] || g.inDegree(v) !== 0 || g.outDegree(v) === 0) continue
    const { path, end } = extend(g, v, maxTip)
    // Only a dead end that runs into a branch is a tip; a short isolated piece stays.
    if (end === 'branch-in' && path.length <= maxTip) {
      for (const x of path) g.removeRead(x >> 1)
      cut += path.length
    }
  }
  return cut
}

/** At each branch, drop arcs whose overlap is under `ratio` of the longest one there. */
export function dropShortOverlaps(g: StringGraph, ratio: number): number {
  let dropped = 0
  for (let v = 0; v < g.arcs.length; v++) {
    const av = g.live(v)
    if (av.length < 2) continue
    const top = Math.max(...av.map(a => a.ol))
    for (const a of av) {
      if (a.ol >= top * ratio) continue
      a.del = true
      for (const b of g.out(a.w ^ 1)) if (b.w === (v ^ 1)) b.del = true
      dropped++
    }
  }
  return dropped
}

/**
 * Pop bubbles: from a vertex with several arcs out, follow every path up to
 * `maxDist` bases; when they all meet again at one vertex, keep the path
 * through the most reads and take out the reads only the others pass.
 */
export function popBubbles(g: StringGraph, maxDist = MAX_BUBBLE): number {
  let popped = 0
  for (let v = 0; v < g.arcs.length; v++) {
    if (g.gone[v >> 1] || g.outDegree(v) < 2) continue
    // Best distance and read count to each vertex reached, with the arc taken.
    const dist = new Map<number, number>([[v, 0]])
    const reads = new Map<number, number>([[v, 0]])
    const from = new Map<number, number>()
    const pending = new Map<number, number>()
    const order: number[] = [v]
    let frontier = [v]
    let sink = -1
    let ok = true
    // Walk in rounds; a vertex is expanded once all its arcs in have been seen.
    for (let round = 0; frontier.length && ok && round < 200; round++) {
      const next: number[] = []
      for (const x of frontier) {
        for (const a of g.live(x)) {
          const w = a.w
          if (w === v || (w ^ 1) === v) { ok = false; break }
          const d = dist.get(x)! + a.len
          if (d > maxDist) { ok = false; break }
          const r = reads.get(x)! + 1
          if (!dist.has(w)) {
            dist.set(w, d)
            reads.set(w, r)
            from.set(w, x)
            pending.set(w, g.inDegree(w))
            order.push(w)
          } else if (r > reads.get(w)!) {
            reads.set(w, r)
            from.set(w, x)
          }
          const left = pending.get(w)! - 1
          pending.set(w, left)
          if (left === 0) next.push(w)
        }
        if (!ok) break
      }
      if (!ok) break
      // Converged: one vertex left in play, nothing else waiting.
      const waiting = [...pending.entries()].filter(([, n]) => n > 0)
      if (next.length === 1 && waiting.length === 0 && order.length > 2) { sink = next[0]; break }
      frontier = next
    }
    if (!ok || sink < 0) continue
    // The kept path, back from the sink.
    const keep = new Set<number>()
    for (let x = sink; x !== v; x = from.get(x)!) keep.add(x >> 1)
    keep.add(v >> 1)
    for (const x of order) {
      if (keep.has(x >> 1)) continue
      g.removeRead(x >> 1)
      popped++
    }
  }
  return popped
}

export interface Unitig {
  /** Vertices in order. */
  path: number[]
  /** For each vertex, the bases it contributes (the arc length to the next, or its whole length at the end). */
  lengths: number[]
  circular: boolean
  /** Overlap with the next vertex on the arc out of each vertex (the last, for a circle, back to the first). */
  overlaps: number[]
}

/**
 * The unitigs: maximal paths without a branch. `readLength` gives each
 * read's kept length. Each unitig appears once (not also as its reverse
 * complement).
 */
export function unitigs(g: StringGraph, readLength: (r: number) => number): Unitig[] {
  const used = new Uint8Array(g.reads)
  const out: Unitig[] = []
  const startsHere = (v: number) => {
    if (g.inDegree(v) !== 1) return true
    // The single vertex before v (the mirror of v's reverse complement's arc).
    const back = g.live(v ^ 1)[0].w ^ 1
    return g.outDegree(back) !== 1
  }
  const walk = (v: number): Unitig => {
    const path = [v]
    const lengths: number[] = []
    const overlaps: number[] = []
    used[v >> 1] = 1
    let x = v
    let circular = false
    for (;;) {
      const outs = g.live(x)
      if (outs.length !== 1) break
      const a = outs[0]
      if (g.inDegree(a.w) !== 1) break
      if (a.w === v) {
        circular = true
        lengths.push(a.len)
        overlaps.push(a.ol)
        break
      }
      if (used[a.w >> 1]) break
      lengths.push(a.len)
      overlaps.push(a.ol)
      path.push(a.w)
      used[a.w >> 1] = 1
      x = a.w
    }
    if (!circular) lengths.push(readLength(x >> 1))
    return { path, lengths, circular, overlaps }
  }
  for (let v = 0; v < g.arcs.length; v++) {
    if (g.gone[v >> 1] || used[v >> 1]) continue
    if (!startsHere(v)) continue
    // A read with no arcs at all starts its own unitig on its forward strand only.
    if (g.outDegree(v) === 0 && g.inDegree(v) === 0 && (v & 1)) continue
    out.push(walk(v))
  }
  // What is left lies on circles.
  for (let v = 0; v < g.arcs.length; v += 2) {
    if (g.gone[v >> 1] || used[v >> 1]) continue
    out.push(walk(v))
  }
  return out
}

/** Links between unitigs: the end of one leads into the start of another (either strand). */
export function unitigLinks(g: StringGraph, tigs: readonly Unitig[]): { from: number; fromStrand: '+' | '-'; to: number; toStrand: '+' | '-'; overlap: number }[] {
  // Where each vertex starts or ends a unitig, as (unitig, strand).
  const startOf = new Map<number, [number, '+' | '-']>()
  tigs.forEach((u, i) => {
    startOf.set(u.path[0], [i, '+'])
    // The unitig read backwards starts at its last vertex's reverse complement.
    startOf.set(u.path[u.path.length - 1] ^ 1, [i, '-'])
  })
  const out: { from: number; fromStrand: '+' | '-'; to: number; toStrand: '+' | '-'; overlap: number }[] = []
  tigs.forEach((u, i) => {
    if (u.circular) { out.push({ from: i, fromStrand: '+', to: i, toStrand: '+', overlap: 0 }); return }
    const ends: [number, '+' | '-'][] = [[u.path[u.path.length - 1], '+'], [u.path[0] ^ 1, '-']]
    for (const [v, strand] of ends) {
      for (const a of g.live(v)) {
        const s = startOf.get(a.w)
        if (s) out.push({ from: i, fromStrand: strand, to: s[0], toStrand: s[1], overlap: a.ol })
      }
    }
  })
  return out
}

export interface CleanReport {
  transitive: number
  tips: number
  shortOverlaps: number
  bubbles: number
}

/** The cleaning rounds, in miniasm's order. */
export function cleanStringGraph(g: StringGraph): CleanReport {
  const r: CleanReport = { transitive: 0, tips: 0, shortOverlaps: 0, bubbles: 0 }
  r.transitive += transitiveReduction(g)
  for (let i = 0; i < 3; i++) r.tips += cutTips(g)
  for (const ratio of SHORT_OVERLAP_RATIOS) {
    r.shortOverlaps += dropShortOverlaps(g, ratio)
    g.symmetrize()
    r.tips += cutTips(g)
    r.bubbles += popBubbles(g)
  }
  for (let i = 0; i < 2; i++) r.tips += cutTips(g)
  return r
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' }
export function revcomp(s: string): string {
  let out = ''
  for (let i = s.length - 1; i >= 0; i--) out += COMP[s[i]] ?? 'N'
  return out
}

/** A unitig's bases from its reads' kept stretches (`read(r)`, forward strand). */
export function unitigSequence(u: Unitig, read: (r: number) => string): string {
  const parts: string[] = []
  u.path.forEach((v, i) => {
    const s = read(v >> 1)
    const oriented = v & 1 ? revcomp(s) : s
    parts.push(oriented.slice(0, Math.max(0, Math.min(oriented.length, u.lengths[i]))))
  })
  return parts.join('')
}

/**
 * The period of a sequence whose end repeats its start (a circle read on
 * past its origin): the offset at which the first `probe` bases' 15-mers
 * vote most, when the match runs to the end; else null. The bases may have
 * a read's errors, so it counts exact 15-mers, of which enough survive.
 */
export function selfOverlapPeriod(seq: string, minVotes = 20): number | null {
  const L = seq.length
  if (L < 2000) return null
  const k = 15
  const probe = Math.min(5000, Math.floor(L / 3))
  const index = new Map<string, number>()
  for (let i = 0; i + k <= probe; i++) {
    const w = seq.slice(i, i + k)
    // Only k-mers seen once in the probe.
    index.set(w, index.has(w) ? -1 : i)
  }
  const votes = new Map<number, number>()
  // Look only in the last part: a circle's start repeats at its end.
  for (let j = Math.floor(L / 2); j + k <= L; j++) {
    const i = index.get(seq.slice(j, j + k))
    if (i === undefined || i < 0) continue
    const d = Math.round((j - i) / 10) * 10
    votes.set(d, (votes.get(d) ?? 0) + 1)
  }
  let best = -1
  let bestVotes = 0
  for (const [d, n] of votes) if (n > bestVotes) { best = d; bestVotes = n }
  if (best < 0 || bestVotes < minVotes) return null
  // The repeat must reach the end: the last bases are the ones a period earlier
  // again (the overlap can be as long as a read, far past the probe).
  if (L - best > L / 2) return null
  if (L - best > probe + 1000) {
    const tail = new Map<string, number>()
    const from = L - best - probe
    for (let i = from; i + k <= L - best; i++) {
      const w = seq.slice(i, i + k)
      tail.set(w, tail.has(w) ? -1 : i)
    }
    let agree = 0
    for (let j = L - probe; j + k <= L; j++) {
      const i = tail.get(seq.slice(j, j + k))
      if (i !== undefined && i >= 0 && Math.abs(j - i - best) <= 20) agree++
    }
    if (agree < minVotes) return null
  }
  // Refine within the bin: the commonest exact offset.
  const exact = new Map<number, number>()
  for (let j = Math.floor(L / 2); j + k <= L; j++) {
    const i = index.get(seq.slice(j, j + k))
    if (i === undefined || i < 0) continue
    const d = j - i
    if (Math.abs(d - best) <= 10) exact.set(d, (exact.get(d) ?? 0) + 1)
  }
  let period = best
  let top = 0
  for (const [d, n] of exact) if (n > top) { period = d; top = n }
  return period
}
