/**
 * How a mapping stores its alignments.
 *
 * Each alignment keeps what a BAM record holds, so a mapping stands on its
 * own: the read's name, flag, mapping quality, CIGAR, mate, its qualities,
 * and its bases, the bases written as their differences from the reference
 * (in the style of minimap2's cs tag: `:n` for n matching bases, `*xy` for
 * reference base x read as y, `+bases` inserted, `-bases` deleted, `~n` for
 * n skipped) plus the soft-clipped bases at each end. Most reads match the
 * reference over most of their length, so `:148*ag:1` stands for 150 bases.
 * The bases are written back from the reference when they are needed
 * (SAM/BAM export), and the differences are what the viewer and the pileup
 * read directly.
 *
 * Alignments are kept in pages of a few thousand, sorted by position on one
 * reference. A page is three deflated sections: the fields as tab-separated
 * lines (positions as differences from the line before, which deflate
 * shrinks), the names, and the qualities, each kept apart because they
 * compress best among their own kind.
 */

import { deflateSync, inflateSync } from 'fflate'

/** One SAM record, as minimap2 writes it or as read from a SAM or BAM file. */
export interface SamFields {
  qname: string
  flag: number
  /** Reference index, -1 when the read is not placed. */
  ref: number
  /** 0-based leftmost position. */
  pos: number
  mapq: number
  cigar: string
  mateRef: number
  /** 0-based; -1 when there is no mate position. */
  matePos: number
  tlen: number
  /** Bases as SAM stores them (reverse complemented on the reverse strand), or '*'. */
  seq: string
  /** Phred+33 qualities in the same order, or '*'. */
  qual: string
}

/** An alignment as stored. */
export interface StoredAlignment {
  /** 0-based start, folded into the reference on a circular one. */
  start: number
  /** Exclusive end: start plus the reference bases covered. Past the reference's length when it runs across the origin. */
  end: number
  /** Index of the read in its read set, or -1 when not known (imported alignments). */
  read: number
  name: string
  flag: number
  mapq: number
  cigar: string
  mateRef: number
  matePos: number
  tlen: number
  /** Differences from the reference (see above); '*' when the record had no bases. */
  diff: string
  clipL: string
  clipR: string
  /** Phred+33 qualities in SAM order; '' when there are none. */
  qual: string
}

/** A reference as the alignments need it: upper-case bases. */
export interface RefBases {
  bases: string
  circular: boolean
}

const N = 78

/** Reference base code at position p, wrapping on a circular reference; N past the end of a linear one. */
export function refCodeAt(ref: RefBases, p: number): number {
  const L = ref.bases.length
  if (p < L) return ref.bases.charCodeAt(p)
  return ref.circular && L > 0 ? ref.bases.charCodeAt(p % L) : N
}

function refSlice(ref: RefBases, from: number, to: number): string {
  let s = ''
  for (let p = from; p < to; p++) s += String.fromCharCode(refCodeAt(ref, p))
  return s
}

/** Reference bases a CIGAR covers (M, =, X, D, N). */
export function cigarSpan(cigar: string): number {
  let span = 0
  let n = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
    const op = cigar[i]
    if (op === 'M' || op === '=' || op === 'X' || op === 'D' || op === 'N') span += n
    n = 0
  }
  return span
}

const lower = (c: number) => (c >= 65 && c <= 90 ? c + 32 : c)

/**
 * The differences between a read's aligned bases and the reference, and its
 * soft clips. `seq` is SAM's SEQ; '*' gives diff '*'.
 */
export function describeAlignment(ref: RefBases, pos: number, cigar: string, seq: string): { diff: string; clipL: string; clipR: string } {
  if (seq === '*' || cigar === '*') return { diff: '*', clipL: '', clipR: '' }
  const q = seq.toUpperCase()
  let out = ''
  let run = 0
  const flush = () => { if (run) { out += ':' + run; run = 0 } }
  let p = pos
  let qp = 0
  let clipL = ''
  let clipR = ''
  let aligned = false
  let n = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
    const op = cigar[i]
    if (op === 'M' || op === '=' || op === 'X') {
      aligned = true
      for (let k = 0; k < n; k++) {
        const r = refCodeAt(ref, p)
        const b = q.charCodeAt(qp)
        if (b === r || b === 61 /* '=' */) run++
        else { flush(); out += '*' + String.fromCharCode(lower(r), lower(b)) }
        p++
        qp++
      }
    } else if (op === 'I') {
      aligned = true
      flush()
      out += '+' + q.slice(qp, qp + n).toLowerCase()
      qp += n
    } else if (op === 'D') {
      aligned = true
      flush()
      out += '-' + refSlice(ref, p, p + n).toLowerCase()
      p += n
    } else if (op === 'N') {
      aligned = true
      flush()
      out += '~' + n
      p += n
    } else if (op === 'S') {
      if (aligned) clipR = q.slice(qp, qp + n)
      else clipL = q.slice(qp, qp + n)
      qp += n
    }
    n = 0
  }
  flush()
  return { diff: out, clipL, clipR }
}

/** The read's bases as SAM stores them, written back from the reference; '*' when they were not stored. */
export function sequenceOf(ref: RefBases, a: Pick<StoredAlignment, 'start' | 'diff' | 'clipL' | 'clipR'>): string {
  if (a.diff === '*') return '*'
  const parts: string[] = [a.clipL]
  let p = a.start
  const d = a.diff
  let i = 0
  while (i < d.length) {
    const op = d[i++]
    if (op === ':' || op === '~') {
      let n = 0
      while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) n = n * 10 + d.charCodeAt(i++) - 48
      if (op === ':') parts.push(refSlice(ref, p, p + n))
      p += n
    } else if (op === '*') {
      parts.push(d[i + 1].toUpperCase())
      i += 2
      p++
    } else {
      let j = i
      while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
      if (op === '+') parts.push(d.slice(i, j).toUpperCase())
      else p += j - i
      i = j
    }
  }
  parts.push(a.clipR)
  return parts.join('')
}

/** Turn a SAM record on reference `ref` into its stored form. */
export function storeAlignment(ref: RefBases, f: SamFields, read: number): StoredAlignment {
  const L = ref.bases.length
  const start = ref.circular && L > 0 ? f.pos % L : f.pos
  const { diff, clipL, clipR } = describeAlignment(ref, f.pos, f.cigar, f.seq)
  return {
    start,
    end: start + cigarSpan(f.cigar),
    read,
    name: f.qname,
    flag: f.flag,
    mapq: f.mapq,
    cigar: f.cigar,
    mateRef: f.mateRef,
    matePos: f.matePos,
    tlen: f.tlen,
    diff,
    clipL,
    clipR,
    qual: f.qual === '*' ? '' : f.qual,
  }
}

// ---- Pages ----

const PAGE_MAGIC = 0x31504c41 // "ALP1"
const enc = new TextEncoder()
const dec = new TextDecoder()

/** Pack alignments of one reference, sorted by start. */
export function encodePage(alns: readonly StoredAlignment[]): Uint8Array {
  const meta: string[] = []
  let prev = 0
  for (const a of alns) {
    meta.push(`${a.start - prev}\t${a.end - a.start}\t${a.read}\t${a.flag}\t${a.mapq}\t${a.cigar}\t${a.mateRef}\t${a.matePos}\t${a.tlen}\t${a.diff}\t${a.clipL}\t${a.clipR}`)
    prev = a.start
  }
  const sections = [
    meta.join('\n'),
    alns.map(a => a.name).join('\n'),
    alns.map(a => a.qual).join('\n'),
  ].map(s => deflateSync(enc.encode(s), { level: 4 }))
  const head = new Uint32Array([PAGE_MAGIC, alns.length, ...sections.map(s => s.length)])
  const out = new Uint8Array(head.byteLength + sections.reduce((n, s) => n + s.length, 0))
  out.set(new Uint8Array(head.buffer), 0)
  let at = head.byteLength
  for (const s of sections) { out.set(s, at); at += s.length }
  return out
}

export function decodePage(data: Uint8Array): StoredAlignment[] {
  const head = new DataView(data.buffer, data.byteOffset, 20)
  if (head.getUint32(0, true) !== PAGE_MAGIC) throw new Error('Not a page of alignments')
  const count = head.getUint32(4, true)
  if (count === 0) return []
  let at = 20
  const text = [8, 12, 16].map(o => {
    const len = head.getUint32(o, true)
    const s = dec.decode(inflateSync(data.subarray(at, at + len)))
    at += len
    return s
  })
  const meta = text[0].split('\n')
  const names = text[1].split('\n')
  const quals = text[2].split('\n')
  const out: StoredAlignment[] = new Array(count)
  let prev = 0
  for (let i = 0; i < count; i++) {
    const f = meta[i].split('\t')
    const start = prev + Number(f[0])
    prev = start
    out[i] = {
      start, end: start + Number(f[1]), read: Number(f[2]), name: names[i],
      flag: Number(f[3]), mapq: Number(f[4]), cigar: f[5],
      mateRef: Number(f[6]), matePos: Number(f[7]), tlen: Number(f[8]),
      diff: f[9], clipL: f[10], clipR: f[11], qual: quals[i],
    }
  }
  return out
}

// ---- Coverage summaries ----

/** Bin sizes of the coverage summaries, each 16 times the one before. */
export const SUMMARY_BINS = [16, 256, 4096] as const

/** Coverage at one resolution: per bin of `binSize` bases, the mean and highest depth, and the mean depth on the forward strand. */
export interface CoverageLevel {
  binSize: number
  mean: Float32Array
  max: Float32Array
  forward: Float32Array
}

export function summarizeCoverage(cov: Uint32Array, fwd: Uint32Array): CoverageLevel[] {
  const L = cov.length
  return SUMMARY_BINS.map(binSize => {
    const n = Math.ceil(L / binSize)
    const mean = new Float32Array(n)
    const max = new Float32Array(n)
    const forward = new Float32Array(n)
    for (let b = 0; b < n; b++) {
      const s = b * binSize
      const e = Math.min(L, s + binSize)
      let t = 0
      let f = 0
      let m = 0
      for (let p = s; p < e; p++) { const d = cov[p]; t += d; f += fwd[p]; if (d > m) m = d }
      mean[b] = t / (e - s)
      forward[b] = f / (e - s)
      max[b] = m
    }
    return { binSize, mean, max, forward }
  })
}

export function encodeSummaries(levels: readonly CoverageLevel[]): Uint8Array {
  const head = new Uint32Array([levels.length, ...levels.flatMap(l => [l.binSize, l.mean.length])])
  const total = head.byteLength + levels.reduce((n, l) => n + l.mean.length * 12, 0)
  const out = new Uint8Array(total)
  out.set(new Uint8Array(head.buffer), 0)
  let at = head.byteLength
  for (const l of levels) {
    for (const a of [l.mean, l.max, l.forward]) {
      out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at)
      at += a.byteLength
    }
  }
  return deflateSync(out, { level: 4 })
}

export function decodeSummaries(data: Uint8Array): CoverageLevel[] {
  const raw = inflateSync(data)
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const count = new Uint32Array(buf, 0, 1)[0]
  const head = new Uint32Array(buf, 0, 1 + count * 2)
  let at = head.byteLength
  const levels: CoverageLevel[] = []
  for (let i = 0; i < count; i++) {
    const binSize = head[1 + i * 2]
    const n = head[2 + i * 2]
    const take = () => { const a = new Float32Array(buf, at, n); at += n * 4; return a }
    levels.push({ binSize, mean: take(), max: take(), forward: take() })
  }
  return levels
}
