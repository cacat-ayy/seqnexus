/**
 * A genome from long reads: overlap, layout, consensus.
 *
 * 1. Reads: the longest reads (of at least MIN_READ bases, leaving out the
 *    tenth with the lowest mean quality), up to TARGET_DEPTH times the
 *    expected genome length, or OLC_MAX_BASES when it is not given. Longer
 *    reads span longer repeats, and past about 40x more reads add overlaps to
 *    compute but no contiguity (Flye and Canu also start from the longest).
 * 2. Overlaps: minimap2 -x ava-ont (ava-pb for PacBio) aligns every read
 *    against every other in one run.
 * 3. Layout: the string graph of the overlaps, cleaned, and its unitigs
 *    (olc.ts). A unitig whose end comes back to its start is a circle; a
 *    linear one whose end repeats its start (the reads ran on past the
 *    origin of a circle the graph did not close) is cut to one turn and
 *    made circular.
 * 4. Consensus: the unitigs are raw read sequence, with the reads' errors.
 *    The same reads are aligned to them (minimap2 -x map-ont, in batches)
 *    and each becomes the reads' majority consensus (polish.ts), over a few
 *    rounds.
 * 5. Small replicons: plasmids of a few kilobases are a known weak point of
 *    overlap assembly (their reads lie inside one another and are set
 *    aside as contained). When the read lengths show peaks (whole plasmids
 *    opened once by a rapid library), those products are assembled by seed
 *    and polish (long.ts) and added, unless an overlap contig already has
 *    them.
 * 6. Short reads, optionally: an Illumina read set of the same sample
 *    polishes the contigs (hybrid polishing), changing a position only where
 *    most short reads clearly disagree, since short reads fix the
 *    homopolymer lengths long reads get wrong but are ambiguous in repeats.
 */

import { decodeChunk } from '../codec'
import { minimap2Args, parseSamLine, referenceFasta, type MapPreset, type ToolRunner } from '../mapper'
import { readDraw } from './spectrum'
import {
  buildGraph, cleanStringGraph, parsePaf, selfOverlapPeriod, trimReads, unitigLinks, unitigs as layoutUnitigs, unitigSequence,
  type CleanReport,
} from './olc'
import { addRecord, newPileup, polish, polishLinear, type DraftPileup, type PolishOptions } from './polish'
import { assembleLongReads, maxOf, type ReadScan } from './long'
import { lengthPeaks } from './clusters'
import { CONTAIN_K, kmerSet } from './kmers'
import { keptLinks, type GraphLink, type StoredGraph } from './graph'
import type { AssembledContig, DeNovoContigInfo, DeNovoReport, DeNovoSettings } from './types'

/** Reads shorter than this are not used for the layout. */
export const MIN_READ = 1000
/** Read depth used for the layout, of the expected genome length. */
export const TARGET_DEPTH = 40
/** Read bases used for the layout at most (minimap2's index of them must fit in WebAssembly's memory). */
export const OLC_MAX_BASES = 200_000_000
/** Read bases per minimap2 run when polishing. */
export const POLISH_BATCH_BASES = 40_000_000
/** Polishing stops when a round changes fewer positions than this share of the contigs. */
export const POLISH_SETTLED = 1e-5
/** Short-read polishing: a change needs more than half of the reads at the position, and at least 5 of them. */
export const SHORT_POLISH: PolishOptions = { minShare: 0.5, minDepth: 5 }
/** Short-read polishing uses about this depth of short reads. */
export const SHORT_POLISH_DEPTH = 80
/** Rounds of short-read polishing at most. */
export const SHORT_POLISH_ROUNDS = 3
/** A peak product's k-mers this share in an overlap contig is already assembled. */
const IN_CONTIG = 0.9

export interface ReadSource {
  chunks: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
}

export interface LongGenomeReport {
  readsUsed: number
  basesUsed: number
  /** Shortest overlap joining two reads. */
  minOverlap: number
  overlaps: number
  /** Reads dropped by trimming (too little covered by others) and set aside as contained. */
  trimmedAway: number
  contained: number
  unitigs: number
  cleaned: CleanReport
  /** Linear unitigs cut to one turn of a circle. */
  circularized: number
  /** Unitigs dropped after the first polishing round as copies of another (a small plasmid laid out more than once). */
  duplicates?: number
  /** Positions changed by each polishing round, all contigs together. */
  polishChanges: number[]
  /** Contigs added from length peaks (small plasmids). */
  fromPeaks: number
  /** Short-read polishing, when a read set was given. */
  hybrid?: { readSet: string; reads: number; changes: number[] }
}

export interface LongGenomeOptions {
  readSet: ReadSource & { technology: string }
  settings: DeNovoSettings
  preset: MapPreset
  minimap2: ToolRunner
  scan: ReadScan
  /** Short reads to polish with. */
  shortReads?: ReadSource & { name: string; paired: boolean; bases: number }
  onProgress?: (done: number, total: number) => void
}

const chunkOf = async (src: ReadSource, c: number) => {
  const packed = await src.getChunk(c)
  if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
  return decodeChunk(packed)
}

/** The reads used for the layout: indices in read set order. */
export function selectReads(scan: ReadScan, genomeSize: number | null | undefined): number[] {
  const { lengths, quality } = scan
  const long = lengths.map((_, i) => i).filter(i => lengths[i] >= MIN_READ)
  // The tenth of lowest quality goes, when qualities are known.
  const qs = long.map(i => quality[i]).sort((a, b) => a - b)
  const floor = qs.length && qs[qs.length - 1] > 0 ? qs[Math.floor(qs.length * 0.1)] : -Infinity
  const pool = long.filter(i => quality[i] >= floor).sort((a, b) => lengths[b] - lengths[a])
  const budget = Math.min(OLC_MAX_BASES, genomeSize ? genomeSize * TARGET_DEPTH : OLC_MAX_BASES)
  const out: number[] = []
  let bases = 0
  for (const i of pool) {
    if (bases >= budget) break
    out.push(i)
    bases += lengths[i]
  }
  return out.sort((a, b) => a - b)
}

/** N50 of read lengths. */
function n50(lengths: readonly number[]): number {
  const s = [...lengths].sort((a, b) => b - a)
  const half = s.reduce((a, b) => a + b, 0) / 2
  let acc = 0
  for (const l of s) { acc += l; if (acc >= half) return l }
  return 0
}

/** The shortest overlap for reads of this N50: 2 kb as miniasm, less for short reads. */
export function minOverlapFor(readN50: number): number {
  return Math.max(500, Math.min(2000, Math.round(readN50 * 0.2)))
}

/**
 * Read batches as FASTA (paired: r1 and r2), the reads `take` picks, cut
 * at about `batchBases`. Read names are r<index in the read set>.
 */
async function* readBatches(src: ReadSource, take: (g: number) => boolean, batchBases: number, paired = false): AsyncGenerator<{ r1: string; r2?: string }> {
  let r1: string[] = []
  let r2: string[] = []
  let bases = 0
  let g = 0
  for (let c = 0; c < src.chunks; c++) {
    const ch = await chunkOf(src, c)
    for (let i = 0; i < ch.count; i++, g++) {
      // Pairs are taken or left together, by the first mate's index.
      const pick = paired ? take(g - (g & 1)) : take(g)
      if (!pick) continue
      const rec = `>r${g}\n${ch.seq(i)}\n`
      if (paired && g & 1) r2.push(rec)
      else r1.push(rec)
      bases += ch.length(i)
    }
    if (bases >= batchBases && (!paired || r1.length === r2.length)) {
      yield paired ? { r1: r1.join(''), r2: r2.join('') } : { r1: r1.join('') }
      r1 = []
      r2 = []
      bases = 0
    }
  }
  if (r1.length) yield paired ? { r1: r1.join(''), r2: r2.join('') } : { r1: r1.join('') }
}

const draftRef = (name: string) => (name.startsWith('ref') ? Number(name.slice(3)) : -1)

/** Align read batches to drafts and count them into one pileup per draft. */
export async function pileUp(o: {
  drafts: readonly { bases: string; circular: boolean }[]
  batches: AsyncIterable<{ r1: string; r2?: string }>
  preset: MapPreset
  minimap2: ToolRunner
  /** Bases a circular draft is extended by (reads up to this long cross its origin in one piece). */
  extend: number
  minMapq?: number
  onBatch?: () => void
}): Promise<DraftPileup[]> {
  const refs = o.drafts.map((d, i) => ({ name: `ref${i}`, tabId: null, bases: d.bases, circular: d.circular }))
  const fasta = referenceFasta(refs, o.extend)
  const piles = o.drafts.map(d => newPileup(d.bases.length, d.circular, o.minMapq ?? 0))
  for await (const b of o.batches) {
    const files: Record<string, string> = { 'ref.fa': fasta, 'r1.fq': b.r1 }
    if (b.r2 !== undefined) files['r2.fq'] = b.r2
    const res = await o.minimap2(minimap2Args(o.preset, b.r2 !== undefined), files, ['out.sam'])
    const sam = res.files['out.sam']
    if (res.exitCode !== 0 || sam === null) {
      throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    let from = 0
    while (from < sam.length) {
      let to = sam.indexOf('\n', from)
      if (to < 0) to = sam.length
      if (sam[from] !== '@' && to > from) {
        const f = parseSamLine(sam.slice(from, to), draftRef)
        if (f.ref >= 0 && f.ref < piles.length) addRecord(piles[f.ref], f)
      }
      from = to + 1
    }
    o.onBatch?.()
  }
  return piles
}

/** How many of `small`'s k-mers occur in `big` (rolled, so a genome needs no set of its own). */
export function sharedKmers(small: Set<number>, big: string, circular: boolean): number {
  const k = CONTAIN_K
  const s = circular && big.length >= k ? big + big.slice(0, k - 1) : big
  const mask = (1 << (2 * k)) - 1
  const shift = 2 * (k - 1)
  const seen = new Set<number>()
  let fwd = 0
  let rev = 0
  let valid = 0
  for (let i = 0; i < s.length; i++) {
    const c = 'ACGT'.indexOf(s[i])
    if (c < 0) { valid = 0; fwd = 0; rev = 0; continue }
    fwd = ((fwd << 2) | c) & mask
    rev = (rev >>> 2) | ((3 - c) << shift)
    if (++valid >= k) {
      const x = Math.min(fwd >>> 0, rev >>> 0)
      if (small.has(x)) seen.add(x)
    }
  }
  return seen.size
}

/** A draft at least this share of which aligns to another is a copy of it. */
export const DUPLICATE_COVER = 0.9

/**
 * Drafts that are copies of another: a high-copy plasmid's reads lie in and
 * across each other every way round, and the graph can lay it out several
 * times. Each draft is aligned to the others (minimap2 -x asm20, which
 * tolerates the errors a first round leaves); one covered over 90% of its
 * length by one it gives way to (see `preferred`) is dropped.
 */
export async function redundantDrafts(drafts: readonly { bases: string; circular: boolean }[], placed: readonly number[], minimap2: ToolRunner): Promise<Set<number>> {
  const refs = drafts.map((d, i) => ({ name: `ref${i}`, tabId: null, bases: d.bases, circular: d.circular }))
  const queries = drafts.map((d, i) => (d.bases.length <= 2_000_000 ? `>${i}\n${d.bases}\n` : '')).join('')
  // -c: base-level alignment, so the match count is exact. -p 0.1: each draft's best hit is
  // itself, and by default minimap2 drops secondary hits under 80% of the best one's score,
  // which a copy with a few percent of errors is.
  const res = await minimap2(['-x', 'asm20', '-c', '-p', '0.1', '-N', '50', '-t', '1', '-o', 'out.paf', 'ref.fa', 'q.fa'], { 'ref.fa': referenceFasta(refs, 50_000), 'q.fa': queries }, ['out.paf'])
  const paf = res.files['out.paf']
  if (res.exitCode !== 0 || paf === null) return new Set()
  // Bases of each query covered by each other draft.
  const cover = new Map<string, [number, number][]>()
  for (const line of paf.split('\n')) {
    const f = line.split('\t')
    if (f.length < 11) continue
    const q = Number(f[0])
    const t = Number(f[5].slice(3))
    if (q === t || Number(f[9]) < 0.7 * Number(f[10])) continue
    const key = `${q} ${t}`
    const list = cover.get(key) ?? []
    list.push([Number(f[2]), Number(f[3])])
    cover.set(key, list)
  }
  const len = drafts.map(d => d.bases.length)
  // Which of two drafts to keep when one holds the other: a circle over a linear copy of about its
  // length (whose extra bases are the overlap left at its ends); a linear draft holds a circle only
  // when more than twice as long; else the longer, then the one more reads went to.
  const preferred = (t: number, q: number) => {
    if (drafts[t].circular !== drafts[q].circular) return drafts[t].circular ? len[t] >= len[q] / 1.1 : len[t] > 2 * len[q]
    return len[t] > 1.1 * len[q] || (len[t] >= len[q] / 1.1 && (placed[t] > placed[q] || (placed[t] === placed[q] && t < q)))
  }
  const gone = new Set<number>()
  for (const [key, list] of cover) {
    const [q, t] = key.split(' ').map(Number)
    if (!preferred(t, q)) continue
    list.sort((a, b) => a[0] - b[0])
    let covered = 0
    let end = 0
    for (const [a, b] of list) {
      if (b <= end) continue
      covered += b - Math.max(a, end)
      end = b
    }
    if (covered >= DUPLICATE_COVER * len[q]) gone.add(q)
  }
  return gone
}

interface Draft {
  bases: string
  circular: boolean
  reads: number
  changes: number[]
  fromPeak: boolean
  hybrid: number[]
}

export async function assembleLongGenome(o: LongGenomeOptions): Promise<{ contigs: AssembledContig[]; report: DeNovoReport; graph: StoredGraph }> {
  const s = o.settings
  const rounds = Math.max(1, Math.round(s.rounds))
  const minReads = Math.max(2, Math.round(s.minReads))
  const { lengths } = o.scan
  // Progress: overlaps 40%, layout 5%, polishing 35%, peaks 10%, short reads 10%.
  const report = (from: number, width: number) => (d: number, t: number) => o.onProgress?.(Math.round(1000 * (from + (t ? Math.min(1, d / t) * width : 0))), 1000)

  // 1. Reads.
  const chosen = selectReads(o.scan, s.genomeSize)
  if (chosen.length < minReads) {
    throw new Error(`Too few reads of ${MIN_READ.toLocaleString('en-US')} bases or more to assemble a genome (${chosen.length}).`)
  }
  const index = new Map(chosen.map((g, i) => [g, i]))
  const chosenSet = new Uint8Array(lengths.length)
  for (const g of chosen) chosenSet[g] = 1
  const chosenLengths = chosen.map(g => lengths[g])
  const basesUsed = chosenLengths.reduce((a, b) => a + b, 0)
  const minOverlap = minOverlapFor(n50(chosenLengths))

  // 2. Overlaps, in one minimap2 run over the chosen reads (named by their place among them).
  const parts: string[] = []
  for (let c = 0, g = 0; c < o.readSet.chunks; c++) {
    const ch = await chunkOf(o.readSet, c)
    for (let i = 0; i < ch.count; i++, g++) {
      const k = index.get(g)
      if (k !== undefined) parts.push(`>r${k}\n${ch.seq(i)}\n`)
    }
    report(0, 0.05)(c + 1, o.readSet.chunks)
  }
  const fasta = parts.join('')
  parts.length = 0
  const ava = o.preset === 'map-hifi' ? 'ava-pb' : 'ava-ont'
  const res = await o.minimap2(['-x', ava, '-t', '1', '-o', 'out.paf', 'reads.fa', 'reads.fa'], { 'reads.fa': fasta }, ['out.paf'])
  const paf = res.files['out.paf']
  if (res.exitCode !== 0 || paf === null) {
    throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
  }
  report(0, 0.4)(1, 1)
  const overlaps = parsePaf(paf).filter(x => x.matches >= 100 && x.qe - x.qs >= minOverlap / 2)

  // 3. Layout.
  const trim = trimReads(chosenLengths, overlaps)
  const { graph, contained } = buildGraph(chosen.length, overlaps, trim, minOverlap)
  let trimmedAway = 0
  for (let i = 0; i < chosen.length; i++) if (trim.end[i] === 0) trimmedAway++
  const containedReads = contained.reduce((a, b) => a + b, 0)
  const cleaned = cleanStringGraph(graph)
  const tigs = layoutUnitigs(graph, r => trim.end[r] - trim.start[r])
  // The bases of the reads the unitigs are made of.
  const needed = new Map<number, string>()
  for (const u of tigs) for (const v of u.path) needed.set(v >> 1, '')
  for (let c = 0, g = 0; c < o.readSet.chunks; c++) {
    const ch = await chunkOf(o.readSet, c)
    for (let i = 0; i < ch.count; i++, g++) {
      const k = index.get(g)
      if (k !== undefined && needed.has(k)) needed.set(k, ch.seq(i).slice(trim.start[k], trim.end[k]).toUpperCase().replace(/[^ACGT]/g, 'N'))
    }
  }
  report(0, 0.45)(1, 1)
  const support = tigs.map(u => u.path.reduce((n, v) => n + 1 + contained[v >> 1], 0))
  const depthOf = tigs.map((u, i) => {
    let b = 0
    for (const v of u.path) b += trim.end[v >> 1] - trim.start[v >> 1]
    const len = u.lengths.reduce((a, x) => a + x, 0)
    return len ? (b / len) * (support[i] / u.path.length) : 0
  })
  const tigSeq = tigs.map(u => unitigSequence(u, r => needed.get(r) ?? ''))
  needed.clear()
  let circularized = 0
  const drafts: (Draft & { tig: number })[] = []
  tigs.forEach((u, i) => {
    if (support[i] < minReads || tigSeq[i].length < MIN_READ) return
    let bases = tigSeq[i]
    let circular = u.circular
    if (!circular) {
      const period = selfOverlapPeriod(bases)
      if (period) { bases = bases.slice(0, period); circular = true; circularized++ }
    }
    drafts.push({ tig: i, bases, circular, reads: support[i], changes: [], fromPeak: false, hybrid: [] })
  })
  if (drafts.length === 0) {
    throw new Error(`The reads did not assemble: ${overlaps.length.toLocaleString('en-US')} overlaps of ${minOverlap.toLocaleString('en-US')} bases or more among ${chosen.length.toLocaleString('en-US')} reads, too few to lay out a contig. The genome may need more coverage or longer reads.`)
  }

  // 4. Consensus rounds.
  const extend = Math.max(1000, maxOf(chosenLengths) + 100)
  const polishChanges: number[] = []
  let duplicates = 0
  let lastPlaced: number[] = []
  // Drop the drafts another one already holds.
  const dropCopies = async () => {
    if (drafts.length < 2) return
    const gone = await redundantDrafts(drafts, lastPlaced, o.minimap2)
    for (let i = drafts.length - 1; i >= 0; i--) if (gone.has(i)) drafts.splice(i, 1)
    lastPlaced = lastPlaced.filter((_, i) => !gone.has(i))
    duplicates += gone.size
  }
  const batches = Math.max(1, Math.ceil(basesUsed / POLISH_BATCH_BASES))
  for (let round = 0; round < rounds; round++) {
    let b = 0
    const piles = await pileUp({
      drafts, preset: o.preset, minimap2: o.minimap2, extend,
      batches: readBatches(o.readSet, g => chosenSet[g] === 1, POLISH_BATCH_BASES),
      onBatch: () => report(0.45 + (0.35 * round) / rounds, 0.35 / rounds)(++b, batches),
    })
    let changed = 0
    drafts.forEach((d, k) => {
      const p = piles[k]
      const r = d.circular ? polish(d.bases, p) : polishLinear(d.bases, p)
      d.bases = r.bases
      d.changes.push(r.changed)
      changed += r.changed
    })
    polishChanges.push(changed)
    lastPlaced = piles.map(p => p.placed)
    if (round === 0) await dropCopies()
    const total = drafts.reduce((n, d) => n + d.bases.length, 0)
    if (changed <= total * POLISH_SETTLED) break
  }
  report(0.8, 0)(1, 1)

  // 5. Small replicons from length peaks.
  let fromPeaks = 0
  const peaks = lengthPeaks(lengths, { minReads })
  if (peaks.length) {
    try {
      const r = await assembleLongReads({
        readSet: { chunks: o.readSet.chunks }, settings: { ...s, method: 'long-seed' }, preset: o.preset,
        minimap2: o.minimap2, getChunk: o.readSet.getChunk, scan: o.scan, onProgress: report(0.8, 0.1),
      })
      r.contigs.forEach(c => {
        const kmers = kmerSet(c.bases, c.circular)
        const home = drafts.findIndex(d => sharedKmers(kmers, d.bases, d.circular) >= IN_CONTIG * kmers.size)
        if (home >= 0) {
          const d = drafts[home]
          // The overlap contig is this replicon, unclosed: the closed product replaces it.
          if (!d.circular && c.circular && d.bases.length <= 1.6 * c.bases.length) {
            drafts[home] = { ...d, bases: c.bases, circular: true, fromPeak: true }
          }
          return
        }
        drafts.push({ tig: -1, bases: c.bases, circular: c.circular, reads: 0, changes: [], fromPeak: true, hybrid: [] })
        fromPeaks++
      })
    } catch {
      // No product came out of the peaks: nothing to add.
    }
  }
  // Again, now polished and with the closed products in: copies too rough to align after the
  // first round align now, and linear copies of a plasmid lie inside its closed circle.
  lastPlaced = drafts.map((_, i) => lastPlaced[i] ?? 0)
  await dropCopies()
  report(0.9, 0)(1, 1)

  // 6. Short reads.
  let hybrid: LongGenomeReport['hybrid']
  if (o.shortReads) {
    const sr = o.shortReads
    const total = drafts.reduce((n, d) => n + d.bases.length, 0)
    const share = Math.min(1, (SHORT_POLISH_DEPTH * total) / Math.max(1, sr.bases))
    const changes: number[] = []
    let reads = 0
    for (let round = 0; round < SHORT_POLISH_ROUNDS; round++) {
      let b = 0
      reads = 0
      const piles = await pileUp({
        drafts, preset: 'sr', minimap2: o.minimap2, extend: 1000,
        batches: readBatches(sr, g => { const t = readDraw(g) < share; if (t) reads++; return t }, POLISH_BATCH_BASES, sr.paired),
        onBatch: () => report(0.9 + (0.1 * round) / SHORT_POLISH_ROUNDS, 0.1 / SHORT_POLISH_ROUNDS)(++b, Math.max(1, Math.ceil((sr.bases * share) / POLISH_BATCH_BASES))),
      })
      let changed = 0
      drafts.forEach((d, k) => {
        // Linear ends stay as the long reads have them: short reads would trim them back.
        const r = polish(d.bases, piles[k], 0, d.bases.length, SHORT_POLISH)
        d.bases = r.bases
        d.hybrid.push(r.changed)
        changed += r.changed
      })
      changes.push(changed)
      if (changed === 0) break
    }
    hybrid = { readSet: sr.name, reads, changes }
  }
  o.onProgress?.(1000, 1000)

  // Contigs, longest first.
  const order = drafts.map((_, i) => i).sort((a, b) => drafts[b].bases.length - drafts[a].bases.length)
  const contigs: AssembledContig[] = order.map((k, i) => ({ name: `Contig ${i + 1}`, bases: drafts[k].bases, circular: drafts[k].circular }))
  const info: DeNovoContigInfo[] = order.map((k, i) => {
    const d = drafts[k]
    return {
      name: `Contig ${i + 1}`, length: d.bases.length, circular: d.circular,
      ...(d.fromPeak ? { fromPeak: true } : { layoutReads: d.reads }),
      changes: d.changes,
      ...(d.hybrid.length ? { hybridChanges: d.hybrid } : {}),
    }
  })

  // The graph: every unitig, the contigs first.
  const contigOfTig = new Map<number, number>()
  order.forEach((k, i) => { if (drafts[k].tig >= 0) contigOfTig.set(drafts[k].tig, i) })
  const rest = tigs.map((_, i) => i).filter(i => !contigOfTig.has(i)).sort((a, b) => tigSeq[b].length - tigSeq[a].length)
  const segOrder: { tig: number; contig: number | null }[] = [
    ...order.map((k, i) => ({ tig: drafts[k].tig, contig: i })),
    ...rest.map(t => ({ tig: t, contig: null })),
  ]
  const segOfTig = new Map<number, number>()
  segOrder.forEach((x, i) => { if (x.tig >= 0) segOfTig.set(x.tig, i) })
  const rawLinks = unitigLinks(graph, tigs).filter(l => segOfTig.has(l.from) && segOfTig.has(l.to))
  const allLinks = rawLinks.map((l): GraphLink => [segOfTig.get(l.from)!, l.fromStrand, segOfTig.get(l.to)!, l.toStrand])
  const kept = keptLinks(allLinks)
  const links = kept.map(i => allLinks[i])
  const linkOverlaps = kept.map(i => rawLinks[i].overlap)
  // A circle the reads closed by self-overlap or peak, but not the graph, links to itself too.
  segOrder.forEach((x, i) => {
    if (x.contig === null || !contigs[x.contig].circular) return
    if (links.some(([a, as, b, bs]) => a === i && b === i && as === bs)) return
    links.push([i, '+', i, '+'])
    linkOverlaps.push(0)
  })
  const graphOut: StoredGraph = {
    version: 1,
    overlap: 0,
    linkOverlaps,
    coverageUnit: 'depth',
    segments: segOrder.map((x, i) => {
      const seq = x.contig !== null ? contigs[x.contig].bases : tigSeq[x.tig]
      return {
        name: x.contig !== null ? `Contig ${x.contig + 1}` : `Unitig ${i - contigs.length + 1}`,
        length: seq.length,
        coverage: x.tig >= 0 ? Math.round(depthOf[x.tig] * 10) / 10 : 0,
        circular: x.contig !== null ? contigs[x.contig].circular : tigs[x.tig].circular,
        contig: x.contig,
      }
    }),
    links,
    sequences: segOrder.map(x => (x.contig !== null ? contigs[x.contig].bases : tigSeq[x.tig])),
  }

  const genome: LongGenomeReport = {
    readsUsed: chosen.length, basesUsed, minOverlap, overlaps: overlaps.length, trimmedAway, contained: containedReads,
    unitigs: tigs.length, cleaned, circularized, duplicates, polishChanges, fromPeaks, ...(hybrid ? { hybrid } : {}),
  }
  return {
    contigs,
    graph: graphOut,
    report: { version: 1, settings: { ...s, method: 'long-olc', minReads, rounds }, reads: lengths.length, contigs: info, genome },
  }
}
