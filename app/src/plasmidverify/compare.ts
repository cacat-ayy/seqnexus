/**
 * A whole-plasmid consensus held against the construct it was meant to be.
 *
 * Both are circles, and the service starts its consensus wherever it
 * chooses (often a feature it recognises, sometimes the reverse strand), so
 * nothing can be compared until the consensus is turned to the construct's
 * strand and origin.
 *
 * 1. Strand and rough rotation. The consensus is seeded (k-mers of 12, as
 *    for mapping) on both strands against the construct written twice, so
 *    that every rotation of it lies on a single diagonal; the strand with
 *    more votes wins. The same votes choose the construct among the open
 *    sequences (chooseConstruct).
 * 2. A cut both circles share. Every 16-mer found exactly once in the
 *    construct and once in the consensus is an anchor; anchors on
 *    consecutive positions of both make a run. Both circles are cut at the
 *    start of the longest run, so both linear sequences begin with the same
 *    bases and, going round, end where they began. A global alignment of
 *    the two then needs no special case at the junction: its ends are
 *    anchored in identical sequence. Writing the construct out twice and
 *    aligning the consensus into it would work too, but costs an alignment
 *    twice the size and still leaves the ends to guess.
 * 3. The alignment, chained. The runs are chained (the heaviest chain in
 *    which each run starts after the one before on both sequences, overlaps
 *    trimmed), and only the gaps between runs are aligned, globally, with
 *    the assembly scoring (match 2, mismatch 4, gap open 6, extend 2). A
 *    point mutation leaves a gap of about 31 bases on each side, a 1 kb
 *    insertion a 1 kb by few-base strip, so a 20 kb plasmid aligns in
 *    milliseconds where a full dynamic program would fill 400 million
 *    cells. A gap too big to fill (more than 4 million cells even within a
 *    band around its diagonal) is taken as a block replaced: its construct
 *    bases deleted, its consensus bases inserted.
 * 4. Back to the construct's numbering. The aligned columns are turned so
 *    that the construct's first base is the first column; consensus bases
 *    inserted between the construct's last base and its first come last.
 *    The rotation is the consensus base lined up with the construct's
 *    first base.
 *
 * The result is a contig of one row (the consensus) on the construct, so
 * the variant caller, the coding effects and the clone verdict of Sanger
 * contigs (assembly/variants.ts, effects.ts, verify.ts) read it unchanged.
 * A difference that straddles the origin comes out of the caller as two
 * pieces (the end of the construct and its start) and is joined here.
 */

import { alignBanded, kmerIndex, seedBothStrands, type AlignEnds } from '../assembly/align'
import { CLOSE_VOTES } from '../assembly/batch'
import type { ContigDoc } from '../assembly/types'
import { callVariants, DEFAULT_VARIANT_SETTINGS, describeVariant, type RefFeature, type Variant } from '../assembly/variants'
import { reverseComplement } from '../models/complement'

/** k-mer length of the seeds that choose the strand and the construct. */
const SEED_K = 12
/** Seed votes a consensus needs on a construct to count as matching it: a stretch of about 30 matching bases, as when guessing references for reads. */
export const MATCH_VOTES = 20
/** Longest open sequence held against a consensus. */
export const CONSTRUCT_MAX_LENGTH = 200_000
/** Anchor length: long enough to be unique in a plasmid. */
const ANCHOR_K = 16
/** Most cells filled to align one gap between anchors. */
const MAX_CELLS = 4_000_000
/** Most runs chained (the longest are kept): the chain is quadratic in them. */
const MAX_RUNS = 3000
/** Quality given to every base of the consensus (the services quote Q50 to Q60 for it). */
export const CONSENSUS_QUALITY = 40
/** Below this share of the construct anchored, where the consensus starts on it is not certain. */
const MIN_ANCHORED = 0.5

const GLOBAL: AlignEnds = { freeTargetStart: false, freeTargetEnd: false, freeQueryStart: false, freeQueryEnd: false }

const clean = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '')

/** Bases written twice, so every rotation of the circle is one diagonal of it. */
function seedIndex(bases: string) {
  return kmerIndex(bases + bases, SEED_K)
}

/**
 * Seed votes of a consensus on each candidate: its best diagonal against
 * the candidate written twice, on either strand. 0 for candidates too long
 * or too short to look at.
 */
export function constructVotes(consensus: string, candidates: readonly string[]): number[] {
  const c = clean(consensus)
  return candidates.map(b => {
    const bases = clean(b)
    if (bases.length > CONSTRUCT_MAX_LENGTH || bases.length < SEED_K || c.length < SEED_K) return 0
    return seedBothStrands(c, seedIndex(bases), SEED_K, 3)?.seed.votes ?? 0
  })
}

export interface ConstructChoice {
  /** The candidate chosen, or null when none matches. */
  index: number | null
  votes: number[]
  /** Other candidates within CLOSE_VOTES of the best: the choice was close, and was made by aligning to each. */
  close: number[]
}

/**
 * The candidate a consensus is: the one it seeds on best. When others come
 * within CLOSE_VOTES of it (point mutants of one design do), the consensus
 * is aligned to each and the one it agrees with best is kept, as for a
 * plate of clones (assembly/batch.ts): a matching base counts one, a
 * mismatch or a gapped base costs two.
 */
export function chooseConstruct(consensus: string, candidates: readonly string[]): ConstructChoice {
  const votes = constructVotes(consensus, candidates)
  const top = Math.max(0, ...votes)
  if (top < MATCH_VOTES) return { index: null, votes, close: [] }
  const near = votes.flatMap((v, i) => (v >= top * CLOSE_VOTES ? [i] : []))
  if (near.length === 1) return { index: near[0], votes, close: [] }
  let best = near[0]
  let bestScore = -Infinity
  for (const i of near) {
    const cmp = compareCircular(candidates[i], consensus)
    const score = cmp ? cmp.matches - 2 * (cmp.mismatches + cmp.gapBases) : -Infinity
    if (score > bestScore || (score === bestScore && votes[i] > votes[best])) { best = i; bestScore = score }
  }
  return { index: best, votes, close: near.filter(i => i !== best) }
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** Start of every k-mer found once in a circle (k-mers across its end included); repeated ones map to -1. */
function uniqueKmers(bases: string, k: number): Map<string, number> {
  const out = new Map<string, number>()
  const n = bases.length
  if (n < k) return out
  const wrapped = bases + bases.slice(0, k - 1)
  for (let i = 0; i < n; i++) {
    const w = wrapped.slice(i, i + k)
    if (/[^ACGT]/.test(w)) continue
    out.set(w, out.has(w) ? -1 : i)
  }
  return out
}

/** Anchors on consecutive positions of both circles: consensus position q, construct position j, `len` k-mers long. */
interface Run { q: number; j: number; len: number }

function anchorRuns(cons: string, ref: string, k: number): Run[] {
  const inRef = uniqueKmers(ref, k)
  const inCons = uniqueKmers(cons, k)
  const L = ref.length
  const wrapped = cons + cons.slice(0, k - 1)
  const runs: Run[] = []
  let cur: Run | null = null
  for (let q = 0; q < cons.length; q++) {
    const w = wrapped.slice(q, q + k)
    const j = inCons.get(w) === q ? inRef.get(w) ?? -1 : -1
    if (j < 0) { cur = null; continue }
    if (cur && q === cur.q + cur.len && j === (cur.j + cur.len) % L) cur.len++
    else { cur = { q, j, len: 1 }; runs.push(cur) }
  }
  // A run across the consensus's end continues the first one.
  if (runs.length > 1) {
    const last = runs[runs.length - 1]
    const first = runs[0]
    if (first.q === 0 && last.q + last.len === cons.length && first.j === (last.j + last.len) % L) {
      last.len += first.len
      runs.shift()
    }
  }
  return runs
}

/** A matched block of bases, [q, q + n) of one sequence on [j, j + n) of the other. */
interface Block { q: number; j: number; n: number }

/**
 * The heaviest chain of blocks that follow each other on both sequences,
 * the first block (the cut) always in it. A block overlapping the one
 * before it is trimmed at its start.
 */
function chainBlocks(blocks: Block[]): Block[] {
  const [head, ...rest] = blocks
  const sorted = rest.sort((a, b) => a.q - b.q || a.j - b.j)
  const nodes = [head, ...sorted]
  const score = new Float64Array(nodes.length)
  const prev = new Int32Array(nodes.length).fill(-1)
  const trim = new Int32Array(nodes.length)
  score[0] = head.n
  for (let i = 1; i < nodes.length; i++) {
    score[i] = -Infinity
    const b = nodes[i]
    for (let p = 0; p < i; p++) {
      if (score[p] === -Infinity) continue
      const a = nodes[p]
      const t = Math.max(0, a.q + a.n - b.q, a.j + a.n - b.j)
      if (t >= b.n) continue
      const s = score[p] + b.n - t
      if (s > score[i]) { score[i] = s; prev[i] = p; trim[i] = t }
    }
  }
  let end = 0
  for (let i = 1; i < nodes.length; i++) if (score[i] > score[end]) end = i
  const chain: Block[] = []
  for (let i = end; i >= 0; i = prev[i]) {
    const b = nodes[i]
    chain.push({ q: b.q + trim[i], j: b.j + trim[i], n: b.n - trim[i] })
    if (i === 0) break
  }
  return chain.reverse()
}

/** Columns of a stretch between anchors: M, I (consensus base, construct gap), D (construct base, consensus gap). */
function alignGap(cons: string, ref: string): { ops: string; block: boolean } {
  const n = cons.length
  const m = ref.length
  if (n === 0) return { ops: 'D'.repeat(m), block: false }
  if (m === 0) return { ops: 'I'.repeat(n), block: false }
  let aln = null
  if (n * m <= MAX_CELLS) aln = alignBanded(cons, ref, GLOBAL)
  else {
    const band = { lo: Math.min(0, m - n) - 100, hi: Math.max(0, m - n) + 100 }
    if (n * (band.hi - band.lo + 1) <= MAX_CELLS) aln = alignBanded(cons, ref, GLOBAL, band)
  }
  if (!aln || aln.qStart !== 0 || aln.tStart !== 0 || aln.qEnd !== n || aln.tEnd !== m) {
    return { ops: 'D'.repeat(m) + 'I'.repeat(n), block: true }
  }
  return { ops: aln.ops, block: false }
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

export interface CircularComparison {
  /** The consensus is the construct's reverse complement, as written. */
  reversed: boolean
  /**
   * The base of the consensus file (1-based, as written) lined up with the
   * construct's first base, or the first one after it when that base is
   * deleted. On the reverse strand, counted on the file's own strand.
   */
  startInFile: number
  /** Where the consensus starts on the construct is not certain: too little of the construct anchored, or its first base in a stretch that could not be aligned. */
  ambiguous: boolean
  /** Share of the construct in anchored runs. */
  anchored: number
  /** The consensus turned to the construct's strand and origin. */
  rotated: string
  /** For each base of the consensus as written: the 0-based construct base it lines up with, or for an inserted base the construct base before it (-1 before the first). */
  constructPosition: Int32Array
  columns: number
  matches: number
  mismatches: number
  /** Bases against a gap, on either side. */
  gapBases: number
  /** Matches over columns. */
  identity: number
  /** Construct bases in stretches that could not be aligned (replaced blocks). */
  unaligned: number
  /** Aligned columns in the construct's numbering. */
  refRow: string
  consRow: string
  /** For each column: the index of the base in the consensus as written, or -1 for a gap. */
  consIndex: Int32Array
}

/**
 * Line a circular consensus up with a circular construct. Null when the
 * consensus does not seed on the construct, or no 16 bases of the two are
 * shared.
 */
export function compareCircular(construct: string, consensus: string): CircularComparison | null {
  const R = clean(construct)
  const C0 = clean(consensus)
  const L = R.length
  const Lc = C0.length
  if (L < ANCHOR_K || Lc < ANCHOR_K) return null
  const hit = seedBothStrands(C0, seedIndex(R), SEED_K, 3)
  if (!hit) return null
  const reversed = hit.reversed
  const C = reversed ? reverseComplement(C0) : C0

  const runs = anchorRuns(C, R, ANCHOR_K)
  if (runs.length === 0) return null
  // Cut both circles at the start of the longest run.
  let cut = runs[0]
  for (const r of runs) if (r.len > cut.len) cut = r
  const qc = cut.q
  const jc = cut.j
  const Cr = C.slice(qc) + C.slice(0, qc)
  const Rr = R.slice(jc) + R.slice(0, jc)
  const kept = runs.length > MAX_RUNS ? [...runs].sort((a, b) => b.len - a.len).slice(0, MAX_RUNS) : runs
  const blocks: Block[] = [{ q: 0, j: 0, n: Math.min(cut.len + ANCHOR_K - 1, Lc, L) }]
  for (const r of kept) {
    if (r === cut) continue
    const q = (r.q - qc + Lc) % Lc
    const j = (r.j - jc + L) % L
    const n = Math.min(r.len + ANCHOR_K - 1, Lc - q, L - j)
    if (n > 0) blocks.push({ q, j, n })
  }
  const chain = chainBlocks(blocks)
  let anchoredBases = 0
  for (const b of chain) anchoredBases += b.n

  // Columns along the cut circles.
  const ops: string[] = []
  const blockCols: [number, number][] = []
  let q = 0
  let j = 0
  const fill = (q1: number, j1: number) => {
    const g = alignGap(Cr.slice(q, q1), Rr.slice(j, j1))
    const at = ops.length
    for (const o of g.ops) ops.push(o)
    if (g.block) blockCols.push([at, ops.length])
    q = q1
    j = j1
  }
  for (const b of chain) {
    if (b.q > q || b.j > j) fill(b.q, b.j)
    for (let k = 0; k < b.n; k++) ops.push('M')
    q = b.q + b.n
    j = b.j + b.n
  }
  if (q < Lc || j < L) fill(Lc, L)

  // Rows, then turned to start at the construct's first base.
  const W = ops.length
  const refCh: string[] = new Array(W)
  const consCh: string[] = new Array(W)
  const consAt = new Int32Array(W)
  const refAt = new Int32Array(W)
  const inBlock = new Uint8Array(W)
  for (const [a, b] of blockCols) inBlock.fill(1, a, b)
  q = 0
  j = 0
  for (let c = 0; c < W; c++) {
    const o = ops[c]
    if (o === 'M' || o === 'D') { refCh[c] = Rr[j]; refAt[c] = (j + jc) % L; j++ } else { refCh[c] = '-'; refAt[c] = -1 }
    if (o === 'M' || o === 'I') { consCh[c] = Cr[q]; consAt[c] = (q + qc) % Lc; q++ } else { consCh[c] = '-'; consAt[c] = -1 }
  }
  let c0 = 0
  while (c0 < W && refAt[c0] !== 0) c0++
  const order = (c: number) => (c + c0) % W
  let refRow = ''
  let consRow = ''
  const consIndex = new Int32Array(W)
  let matches = 0
  let mismatches = 0
  let gapBases = 0
  let unaligned = 0
  // Construct position of every consensus base (oriented), and the file's own numbering.
  const posOriented = new Int32Array(Lc).fill(-1)
  let lastRef = -1
  let rotated = ''
  for (let k = 0; k < W; k++) {
    const c = order(k)
    refRow += refCh[c]
    consRow += consCh[c]
    const oi = consAt[c]
    const fileIndex = oi < 0 ? -1 : reversed ? Lc - 1 - oi : oi
    consIndex[k] = fileIndex
    if (refAt[c] >= 0) lastRef = refAt[c]
    if (oi >= 0) { posOriented[oi] = refAt[c] >= 0 ? refAt[c] : lastRef; rotated += consCh[c] }
    if (refCh[c] === '-' || consCh[c] === '-') gapBases++
    else if (refCh[c] === consCh[c]) matches++
    else mismatches++
    if (inBlock[c] && refCh[c] !== '-') unaligned++
  }
  const constructPosition = new Int32Array(Lc)
  for (let i = 0; i < Lc; i++) constructPosition[i] = reversed ? posOriented[Lc - 1 - i] : posOriented[i]

  // The consensus base at (or after) the construct's first base.
  let firstOriented = -1
  for (let k = 0; k < W && firstOriented < 0; k++) firstOriented = consAt[order(k)]
  if (firstOriented < 0) firstOriented = 0
  const startInFile = reversed ? Lc - firstOriented : firstOriented + 1
  const anchored = Math.min(1, anchoredBases / L)
  return {
    reversed, startInFile,
    ambiguous: anchored < MIN_ANCHORED || inBlock[c0] === 1,
    anchored, rotated,
    constructPosition,
    columns: W, matches, mismatches, gapBases,
    identity: W ? matches / W : 0,
    unaligned,
    refRow, consRow, consIndex,
  }
}

// ---------------------------------------------------------------------------
// As a contig, and its differences
// ---------------------------------------------------------------------------

/** The comparison as a contig of one row, the consensus, on the construct (circular). */
export function comparisonContig(
  cmp: CircularComparison,
  construct: { name: string; tabId: string | null; length: number; features?: RefFeature[] },
  sampleName: string,
): ContigDoc {
  const W = cmp.columns
  const src: number[] = new Array(W)
  const qual: number[] = new Array(W)
  for (let c = 0; c < W; c++) {
    const gap = cmp.consRow[c] === '-'
    src[c] = gap ? -1 : -2
    qual[c] = gap ? 0 : CONSENSUS_QUALITY
  }
  return {
    method: 'reference',
    reference: {
      name: construct.name, tabId: construct.tabId, length: construct.length, circular: true, seq: cmp.refRow,
      ...(construct.features?.length ? { features: construct.features } : {}),
    },
    width: W,
    rows: [{ id: 'row1', readId: null, name: sampleName, reversed: cmp.reversed, start: 0, seq: cmp.consRow, orig: cmp.consRow, src, qual }],
  }
}

/**
 * Every difference of the consensus from the construct, as the variant
 * caller describes it (features, codon and protein change, repeats), with a
 * deletion or insertion across the construct's origin joined into one.
 */
export function consensusDifferences(doc: ContigDoc, refBases: string, features: readonly RefFeature[]): Variant[] {
  const all = callVariants(doc, '', features, { ...DEFAULT_VARIANT_SETTINGS, minFrequency: 0.5, maxPValue: 1 })
  return joinAcrossOrigin(all, refBases, features)
}

/**
 * A deletion that takes the construct's last bases and its first comes out
 * of a contig in the construct's numbering as two deletions, one ending at
 * its last base and one starting at its first. They are one event, and its
 * effect on a feature across the origin is that of the whole: joined, from
 * the first base deleted before the origin.
 */
export function joinAcrossOrigin(vs: readonly Variant[], refBases: string, features: readonly RefFeature[]): Variant[] {
  const L = refBases.length
  if (vs.length < 2) return [...vs]
  const first = vs.reduce((a, b) => (b.position < a.position ? b : a))
  const last = vs.reduce((a, b) => (b.position > a.position ? b : a))
  if (first === last || first.type !== 'Deletion' || last.type !== 'Deletion') return [...vs]
  if (first.position !== 1 || last.position + last.ref.length - 1 !== L) return [...vs]
  const joined = describeVariant({
    c0: last.c0, c1: last.c1 + (first.c1 - first.c0), type: 'Deletion', pos: last.position - 1,
    ref: last.ref + first.ref, alt: '',
    coverage: Math.min(first.coverage, last.coverage), count: Math.min(first.count, last.count),
    pValue: Math.max(first.pValue, last.pValue),
    forward: last.forward, reverse: last.reverse, meanQuality: last.meanQuality,
  }, { refSeq: refBases, features, againstConsensus: false, circular: true })
  return [...vs.filter(v => v !== first && v !== last), joined].sort((a, b) => a.position - b.position)
}
