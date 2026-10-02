/**
 * De novo assembly of Sanger reads (overlap, layout, consensus).
 *
 * 1. Overlaps: every pair of reads is seeded on both strands and aligned
 *    with free ends. A pair joins when the overlap is long and identical
 *    enough and reaches an end of each read (a real overlap, not a shared
 *    repeat in the middle).
 * 2. Groups of reads joined by overlaps become contigs. Orientation spreads
 *    out from one read; the whole contig is flipped if that leaves most reads
 *    reverse complemented against how the user shows them.
 * 3. Layout: reads are added one at a time, best-connected first, each
 *    aligned to the consensus of the reads already placed.
 *
 * Sanger projects are tens of reads, so the all-pairs step is cheap.
 */

import { alignBanded, bandAround, kmerIndex, OVERLAP, seedBothStrands, type PairAlignment } from './align'
import { computeConsensus } from './consensus'
import { addAligned, backboneColumns, orient, toDoc, type Pileup } from './pileup'
import type { AssemblyInput, AssemblyReport, AssemblySettings } from './types'

interface Edge {
  a: number
  b: number
  /** b must be flipped relative to a. */
  flip: boolean
  score: number
}

/** How far from a read's end an overlap may stop (low-quality ends often disagree). */
const END_SLACK = 20

export function assembleDeNovo(
  inputs: readonly AssemblyInput[],
  s: AssemblySettings,
  onProgress?: (done: number, total: number) => void,
): AssemblyReport {
  const unplaced: AssemblyReport['unplaced'] = []
  const reads: AssemblyInput[] = []
  for (const r of inputs) {
    if (r.seq.length < Math.max(20, s.minOverlap)) unplaced.push({ name: r.name, readId: r.readId, reason: 'Too short after trimming' })
    else reads.push(r)
  }
  const n = reads.length
  const total = n * (n - 1) / 2 + n

  // 1. Overlaps.
  const edges: Edge[] = []
  let done = 0
  for (let a = 0; a < n; a++) {
    const index = kmerIndex(reads[a].seq, s.k)
    for (let b = a + 1; b < n; b++) {
      onProgress?.(++done, total)
      const hit = seedBothStrands(reads[b].seq, index, s.k, 3)
      if (!hit) continue
      const qb = orient(reads[b], hit.reversed)
      const aln = alignBanded(qb.seq, reads[a].seq, OVERLAP, bandAround(hit.seed.diag, qb.seq.length))
      if (!aln || !isOverlap(aln, qb.seq.length, reads[a].seq.length, s)) continue
      edges.push({ a, b, flip: hit.reversed, score: aln.score })
    }
  }

  // 2. Groups and orientation.
  const parent = reads.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const e of edges) parent[find(e.a)] = find(e.b)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const g = find(i)
    const list = groups.get(g)
    if (list) list.push(i)
    else groups.set(g, [i])
  }
  const adj = reads.map(() => [] as Edge[])
  for (const e of edges) { adj[e.a].push(e); adj[e.b].push(e) }

  const contigs: AssemblyReport['contigs'] = []
  for (const members of groups.values()) {
    if (members.length < 2) {
      const r = reads[members[0]]
      unplaced.push({ name: r.name, readId: r.readId, reason: 'Overlaps no other read' })
      continue
    }
    // Root: the longest read; orientations follow the overlaps out from it.
    const root = members.reduce((x, y) => (reads[y].seq.length > reads[x].seq.length ? y : x))
    const flipped = new Map<number, boolean>([[root, false]])
    const queue = [root]
    while (queue.length) {
      const x = queue.shift()!
      for (const e of adj[x]) {
        const y = e.a === x ? e.b : e.a
        if (flipped.has(y)) continue
        flipped.set(y, flipped.get(x)! !== e.flip)
        queue.push(y)
      }
    }
    // Most reads should come out the way the user shows them.
    let against = 0
    for (const i of members) if (flipped.get(i) !== reads[i].preferReversed) against++
    if (against > members.length / 2) for (const i of members) flipped.set(i, !flipped.get(i))

    // 3. Layout, best-connected first.
    const pile: Pileup = { width: 0, rows: [], ref: null }
    const first = orient(reads[root], flipped.get(root)!)
    pile.rows.push({
      id: 'row1', readId: first.input.readId, name: first.input.name, reversed: first.reversed,
      start: 0, seq: first.seq, orig: first.seq, src: [...first.src], qual: [...first.qual],
    })
    pile.width = first.seq.length
    const placed = new Set([root])
    let pending = members.filter(i => i !== root)
    let progress = true
    while (pending.length && progress) {
      progress = false
      // The pending read with the strongest overlap to anything placed.
      pending.sort((x, y) => linkTo(y, placed, adj) - linkTo(x, placed, adj))
      for (const i of pending) {
        if (linkTo(i, placed, adj) <= 0) continue
        const read = orient(reads[i], flipped.get(i)!)
        const cons = computeConsensus({ method: 'de-novo', reference: null, width: pile.width, rows: pile.rows })
        const bb = backboneColumns([...cons.bases])
        const index = kmerIndex(bb.bases, s.k)
        const hit = seedBothStrands(read.seq, index, s.k, 3)
        if (!hit || hit.reversed) continue
        const aln = alignBanded(read.seq, bb.bases, OVERLAP, bandAround(hit.seed.diag, read.seq.length))
        if (!aln || aln.identity < s.minIdentity || aln.tEnd - aln.tStart < s.minOverlap) continue
        addAligned(pile, read, aln, bb.colOf, `row${pile.rows.length + 1}`)
        placed.add(i)
        progress = true
        break
      }
      pending = pending.filter(i => !placed.has(i))
    }
    for (const i of pending) unplaced.push({ name: reads[i].name, readId: reads[i].readId, reason: 'Overlap too weak to place in the contig' })
    if (pile.rows.length >= 2) {
      pile.rows.sort((x, y) => x.start - y.start)
      contigs.push({ name: '', doc: toDoc(pile, 'de-novo', null) })
    } else {
      unplaced.push({ name: first.input.name, readId: first.input.readId, reason: 'Overlaps no other read' })
    }
  }
  contigs.sort((x, y) => y.doc.rows.length - x.doc.rows.length || y.doc.width - x.doc.width)
  contigs.forEach((c, i) => { c.name = contigs.length === 1 ? 'Contig' : `Contig ${i + 1}` })
  onProgress?.(total, total)
  return { contigs, unplaced }
}

function isOverlap(aln: PairAlignment, qLen: number, tLen: number, s: AssemblySettings): boolean {
  const span = Math.min(aln.qEnd - aln.qStart, aln.tEnd - aln.tStart)
  if (span < s.minOverlap || aln.identity < s.minIdentity) return false
  // The aligned stretch has to reach the start of one read and the end of one read.
  const reachesStart = aln.qStart <= END_SLACK || aln.tStart <= END_SLACK
  const reachesEnd = qLen - aln.qEnd <= END_SLACK || tLen - aln.tEnd <= END_SLACK
  return reachesStart && reachesEnd
}

function linkTo(i: number, placed: Set<number>, adj: Edge[][]): number {
  let best = 0
  for (const e of adj[i]) {
    const other = e.a === i ? e.b : e.a
    if (placed.has(other) && e.score > best) best = e.score
  }
  return best
}
