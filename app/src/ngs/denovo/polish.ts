/**
 * Polishing a draft contig: the reads aligned to it are counted base by
 * base, and the draft becomes what most of them say.
 *
 * Every position gets the reads' bases (A, C, G, T) and the reads deleting
 * it; every gap between two positions gets the reads inserting bases there,
 * with what they insert. The polished sequence takes at each position the
 * commonest base, leaves the position out where more reads delete it than
 * show any one base, and writes an insertion in where at least half the
 * reads across that gap insert something (the commonest length, and at each
 * place of it the commonest base). That is a simple majority consensus, as
 * samtools consensus makes in its simple mode; several rounds of it, each
 * with the reads aligned again, take a draft made of one read with a few
 * percent of errors to the accuracy of the reads' consensus.
 *
 * A draft treated as circular is aligned to with its start appended (as
 * mapper.ts does), and positions past its end are folded back, so reads
 * across the origin count like any other. If the draft has a few bases too
 * many at the origin (a read a little longer than the circle) the reads
 * across it delete them, and if it has a few too few they insert them, so
 * the circle closes itself in the first round.
 *
 * A genome's draft is millions of bases long, so its pileup is kept
 * compact: counts in 16 bits (saturating at 65,535, far past any depth a
 * genome is polished at), and insertions of one base, which are most of
 * them, counted by base in an array; only longer insertions are kept as
 * strings.
 */

import type { SamFields } from '../alignments'

/** Counts per position: A, C, G, T, deleted. */
const COLS = 5
const CODE: Record<string, number> = { A: 0, C: 1, G: 2, T: 3 }
const BASES = 'ACGT'

type Counts = Uint16Array | Uint32Array

export interface DraftPileup {
  /** Length of the draft. */
  length: number
  /** Positions past `length` fold back to the start. */
  circular: boolean
  counts: Counts
  /** The largest count the arrays hold. */
  max: number
  /** Single-base insertions after each position, by base (A, C, G, T). */
  ins1: Counts
  /** Longer insertions after each position, by what is inserted. */
  ins: Map<number, Map<string, number>>
  /** Reads inserting anything after each position. */
  insReads: Counts
  /** Alignments of lower mapping quality are not counted. */
  minMapq: number
  /** Primary alignments covering at least FULL_SPAN of the draft. */
  fullLength: number
  /** Primary alignments placed on the draft. */
  placed: number
  /** Alignments running across the origin of a circular draft, with a margin on both sides. */
  acrossOrigin: number
  /** Soft-clipped bases past the draft's ends, from primary alignments reaching the end (linear drafts). */
  clipsLeft: string[]
  clipsRight: string[]
  /** Primary alignments reaching each end. */
  reachLeft: number
  reachRight: number
}

/** Share of the draft an alignment must cover to count as a full-length read. */
export const FULL_SPAN = 0.9
/** How close to an end an alignment must stop to reach it. */
const END_REACH = 5

/** Drafts at least this long get 16-bit counts. */
export const COMPACT_LENGTH = 200_000

export function newPileup(length: number, circular: boolean, minMapq = 0): DraftPileup {
  const compact = length >= COMPACT_LENGTH
  const make = (n: number): Counts => (compact ? new Uint16Array(n) : new Uint32Array(n))
  return {
    length, circular, minMapq,
    counts: make(length * COLS),
    max: compact ? 0xffff : 0xffffffff,
    ins1: make(length * 4),
    ins: new Map(),
    insReads: make(length),
    fullLength: 0, placed: 0, acrossOrigin: 0,
    clipsLeft: [], clipsRight: [], reachLeft: 0, reachRight: 0,
  }
}

/** Bases needed on both sides of the origin for a read to count as running across it. */
export function originMargin(length: number): number {
  return Math.max(1, Math.min(100, Math.floor(length / 10)))
}

/**
 * Count one SAM record (its position as aligned, on the draft with its start
 * appended when circular). Unplaced and secondary records are skipped.
 */
export function addRecord(p: DraftPileup, f: SamFields): void {
  if (f.flag & 0x104 || f.ref < 0 || f.seq === '*' || f.cigar === '*' || f.mapq < p.minMapq) return
  const L = p.length
  const max = p.max
  const counts = p.counts
  const fold = (x: number) => (x >= L && p.circular ? x - L : x)
  const primary = (f.flag & 0x800) === 0
  let rp = f.pos
  let qp = 0
  const ops = f.cigar.match(/\d+[MIDNSHP=X]/g) ?? []
  let clipL = ''
  let clipR = ''
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    const n = parseInt(op, 10)
    const c = op[op.length - 1]
    if (c === 'M' || c === '=' || c === 'X') {
      for (let i = 0; i < n; i++) {
        const pos = fold(rp + i)
        if (pos >= L) continue
        const code = CODE[f.seq[qp + i]]
        if (code !== undefined && counts[pos * COLS + code] < max) counts[pos * COLS + code]++
      }
      rp += n
      qp += n
    } else if (c === 'D' || c === 'N') {
      for (let i = 0; i < n; i++) {
        const pos = fold(rp + i)
        if (pos < L && counts[pos * COLS + 4] < max) counts[pos * COLS + 4]++
      }
      rp += n
    } else if (c === 'I') {
      const after = rp - 1
      if (after >= 0) {
        const pos = fold(after)
        if (pos < L && p.insReads[pos] < max) {
          if (n === 1) {
            const code = CODE[f.seq[qp].toUpperCase()]
            if (code !== undefined) p.ins1[pos * 4 + code]++
          } else {
            const s = f.seq.slice(qp, qp + n).toUpperCase()
            let m = p.ins.get(pos)
            if (!m) { m = new Map(); p.ins.set(pos, m) }
            m.set(s, (m.get(s) ?? 0) + 1)
          }
          p.insReads[pos]++
        }
      }
      qp += n
    } else if (c === 'S') {
      const s = f.seq.slice(qp, qp + n).toUpperCase()
      if (k === 0) clipL = s
      else clipR = s
      qp += n
    }
  }
  if (!primary) return
  p.placed++
  const span = rp - f.pos
  if (span >= FULL_SPAN * L) p.fullLength++
  if (p.circular) {
    const m = originMargin(L)
    if (f.pos <= L - m && rp >= L + m) p.acrossOrigin++
  } else {
    if (f.pos <= END_REACH) { p.reachLeft++; if (clipL) p.clipsLeft.push(clipL) }
    if (rp >= L - END_REACH) { p.reachRight++; if (clipR) p.clipsRight.push(clipR) }
  }
}

/** Reads covering a position: its bases and its deletions. */
export function depthAt(p: DraftPileup, pos: number): number {
  const o = pos * COLS
  const c = p.counts
  return c[o] + c[o + 1] + c[o + 2] + c[o + 3] + c[o + 4]
}

/** Median depth over the draft's positions. */
export function medianDepth(p: DraftPileup): number {
  const d = new Uint32Array(p.length)
  for (let i = 0; i < p.length; i++) d[i] = depthAt(p, i)
  d.sort()
  return d.length ? d[d.length >> 1] : 0
}

/**
 * The commonest string among several of the same length, column by column;
 * the share of the strings agreeing at each column comes back too.
 */
export function columnMajority(strings: readonly string[], length: number): { seq: string; agreement: number[] } {
  let seq = ''
  const agreement: number[] = []
  for (let i = 0; i < length; i++) {
    const n = [0, 0, 0, 0]
    let total = 0
    for (const s of strings) {
      const code = CODE[s[i]]
      if (code === undefined) continue
      n[code]++
      total++
    }
    let best = 0
    for (let b = 1; b < 4; b++) if (n[b] > n[best]) best = b
    seq += BASES[best]
    agreement.push(total ? n[best] / total : 0)
  }
  return { seq, agreement }
}

/**
 * What most reads insert after a position, or '' when fewer than `share` of
 * the reads there (half, for a majority) insert anything.
 */
function insertionAt(p: DraftPileup, pos: number, depth: number, share = 0.5): string {
  const reads = p.insReads[pos]
  if (!reads || reads < depth * share) return ''
  const m = p.ins.get(pos)
  const o = pos * 4
  const ones = p.ins1[o] + p.ins1[o + 1] + p.ins1[o + 2] + p.ins1[o + 3]
  // The commonest length, then the commonest base at each place of it.
  const byLength = new Map<number, number>()
  if (ones) byLength.set(1, ones)
  if (m) for (const [s, n] of m) byLength.set(s.length, (byLength.get(s.length) ?? 0) + n)
  let len = 0
  let best = -1
  for (const [l, n] of byLength) if (n > best || (n === best && l < len)) { best = n; len = l }
  if (len === 0) return ''
  if (len === 1) {
    let b = 0
    for (let x = 1; x < 4; x++) if (p.ins1[o + x] > p.ins1[o + b]) b = x
    return BASES[b]
  }
  const strings: string[] = []
  for (const [s, n] of m!) if (s.length === len) for (let i = 0; i < n; i++) strings.push(s)
  return columnMajority(strings, len).seq
}

export interface PolishOptions {
  /**
   * A change (another base, a deletion, an insertion) needs at least this
   * share of the reads at the position; 0 is the commonest call. Short reads
   * polishing a long-read contig use 0.5, an absolute majority, with a
   * least depth, as Polypolish does. A higher bar was tried and fails where
   * two nearby errors (a missing base and an extra one a few bases on) are
   * aligned by some reads as two gaps and by others as a run of mismatches:
   * both are right, each has about half the reads, and a majority takes
   * one of them whole.
   */
  minShare?: number
  /** Positions with fewer reads keep the draft's base. */
  minDepth?: number
}

export interface Polished {
  bases: string
  /** Positions changed, left out or inserted after (each counts once). */
  changed: number
}

/**
 * The draft as the reads have it, from position `from` to `to` (the whole
 * draft by default). Positions no read covers keep the draft's base.
 */
export function polish(draft: string, p: DraftPileup, from = 0, to = draft.length, opts: PolishOptions = {}): Polished {
  const out: string[] = []
  let changed = 0
  const c = p.counts
  const share = opts.minShare ?? 0
  const minDepth = Math.max(1, opts.minDepth ?? 1)
  for (let pos = from; pos < to; pos++) {
    const o = pos * COLS
    const depth = c[o] + c[o + 1] + c[o + 2] + c[o + 3] + c[o + 4]
    const own = draft[pos].toUpperCase()
    if (depth < minDepth) { out.push(own); continue }
    let best = CODE[own] ?? 0
    for (let b = 0; b < 4; b++) if (c[o + b] > c[o + best]) best = b
    if (c[o + 4] > c[o + best] && c[o + 4] >= share * depth) {
      changed++
    } else {
      const base = BASES[best]
      if (c[o + best] === 0 || (base !== own && c[o + best] < share * depth)) out.push(own)
      else {
        if (base !== own) changed++
        out.push(base)
      }
    }
    // An insertion after the last position of a linear draft is past its end, which extension handles.
    if (pos < to - 1 || p.circular) {
      const ins = insertionAt(p, pos, depth, Math.max(0.5, share))
      if (ins) { out.push(ins); changed++ }
    }
  }
  return { bases: out.join(''), changed }
}

/** Bases at an end of a linear draft covered by fewer reads than this share of the median are trimmed off. */
export const END_TRIM_SHARE = 0.1
/** A linear draft is extended where reads go on past its end and agree on what follows. */
export const EXTEND_MIN_AGREEMENT = 0.7
/** At most this many bases are added at each end per round. */
export const EXTEND_STEP = 200

/** How far reads go on past an end and what they agree is there, or '' (`clips` read outward from the end). */
export function extension(clips: readonly string[], reach: number): string {
  if (reach < 3) return ''
  const long = clips.filter(s => s.length >= 10)
  if (long.length * 2 < reach) return ''
  // As far as at least half of the reads reaching the end go on.
  const lens = clips.map(s => s.length).sort((a, b) => b - a)
  const len = Math.min(EXTEND_STEP, lens[Math.floor(reach / 2) - 1] ?? 0)
  if (len < 10) return ''
  const { seq, agreement } = columnMajority(clips, len)
  // Stop where the reads stop agreeing (a window of 10 bases).
  let end = 0
  for (let i = 0; i + 10 <= len; i++) {
    let sum = 0
    for (let k = i; k < i + 10; k++) sum += agreement[k]
    if (sum / 10 < EXTEND_MIN_AGREEMENT) break
    end = i + 10
  }
  return end >= 10 ? seq.slice(0, end) : ''
}

export interface PolishedLinear extends Polished {
  trimmedLeft: number
  trimmedRight: number
  extendedLeft: number
  extendedRight: number
}

/**
 * A linear draft polished, its ends trimmed back to where the reads cover
 * them and extended where the reads go on past them.
 */
export function polishLinear(draft: string, p: DraftPileup): PolishedLinear {
  const L = draft.length
  const floor = Math.max(3, END_TRIM_SHARE * medianDepth(p))
  let from = 0
  while (from < L && depthAt(p, from) < floor) from++
  let to = L
  while (to > from && depthAt(p, to - 1) < floor) to--
  if (to - from < 1) return { bases: draft, changed: 0, trimmedLeft: 0, trimmedRight: 0, extendedLeft: 0, extendedRight: 0 }
  const mid = polish(draft, p, from, to)
  // Reads past an end are only looked at when the end was not trimmed (they reached the old end).
  const right = to === L ? extension(p.clipsRight, p.reachRight) : ''
  const leftOut = from === 0 ? extension(p.clipsLeft.map(s => [...s].reverse().join('')), p.reachLeft) : ''
  const left = [...leftOut].reverse().join('')
  return {
    bases: left + mid.bases + right,
    changed: mid.changed + from + (L - to) + left.length + right.length,
    trimmedLeft: from, trimmedRight: L - to, extendedLeft: left.length, extendedRight: right.length,
  }
}
