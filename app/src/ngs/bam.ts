/**
 * BAM, written and read in plain JavaScript.
 *
 * BAM is SAM in binary records, compressed in BGZF blocks: gzip members of
 * at most 64 KB that say their own size, so a reader can jump to any block.
 * A position in the file is a virtual offset, the block's place in the
 * compressed file times 65536 plus the place in the block's uncompressed
 * data, and the BAI index lists, for each bin of the reference, the
 * stretches of the file holding alignments in it, with a linear index of the
 * first alignment in each 16 kb window (SAMv1 spec, sections 4 and 5).
 *
 * samtools, compiled to WebAssembly, could do this, but a page opened from
 * disk cannot load WebAssembly, and the format is simple enough to write
 * directly, as each page of stored alignments is read.
 */

import { deflateSync, inflateSync } from 'fflate'
import { BAM_NIBBLES } from './codec'
import type { SamFields } from './alignments'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(d: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Uncompressed bytes per block, below the 64 KB limit so even incompressible data fits. */
const BLOCK = 0xff00

/** The empty block that ends every BGZF file. */
export const BGZF_EOF = new Uint8Array([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 27, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])

function bgzfBlock(raw: Uint8Array): Uint8Array {
  const c = deflateSync(raw, { level: 6 })
  const out = new Uint8Array(18 + c.length + 8)
  out.set([31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0], 0)
  const dv = new DataView(out.buffer)
  dv.setUint16(16, out.length - 1, true)
  out.set(c, 18)
  dv.setUint32(18 + c.length, crc32(raw), true)
  dv.setUint32(22 + c.length, raw.length, true)
  return out
}

/** Writes BGZF blocks, gathering them into Blobs so a large file need not stay in memory as arrays. */
export class BgzfWriter {
  private readonly buf = new Uint8Array(BLOCK)
  private len = 0
  private coffset = 0
  private blocks: Uint8Array[] = []
  private blockBytes = 0
  private readonly blobs: Blob[] = []

  /** Virtual offset of the next byte written. */
  get voffset(): number {
    return this.coffset * 65536 + this.len
  }

  write(data: Uint8Array) {
    let i = 0
    while (i < data.length) {
      const n = Math.min(data.length - i, BLOCK - this.len)
      this.buf.set(data.subarray(i, i + n), this.len)
      this.len += n
      i += n
      if (this.len === BLOCK) this.flush()
    }
  }

  flush() {
    if (this.len === 0) return
    const block = bgzfBlock(this.buf.subarray(0, this.len))
    this.blocks.push(block)
    this.coffset += block.length
    this.blockBytes += block.length
    this.len = 0
    if (this.blockBytes > 16_000_000) {
      this.blobs.push(new Blob(this.blocks as BlobPart[]))
      this.blocks = []
      this.blockBytes = 0
    }
  }

  finish(): Blob {
    this.flush()
    return new Blob([...this.blobs, ...(this.blocks as BlobPart[]), BGZF_EOF as BlobPart], { type: 'application/octet-stream' })
  }
}

/** The smallest bin holding [beg, end) (SAMv1 spec 5.3). */
export function reg2bin(beg: number, end: number): number {
  const e = end - 1
  if (beg >> 14 === e >> 14) return ((1 << 15) - 1) / 7 + (beg >> 14)
  if (beg >> 17 === e >> 17) return ((1 << 12) - 1) / 7 + (beg >> 17)
  if (beg >> 20 === e >> 20) return ((1 << 9) - 1) / 7 + (beg >> 20)
  if (beg >> 23 === e >> 23) return ((1 << 6) - 1) / 7 + (beg >> 23)
  if (beg >> 26 === e >> 26) return ((1 << 3) - 1) / 7 + (beg >> 26)
  return 0
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function bamHeader(text: string, refs: readonly { name: string; length: number }[]): Uint8Array {
  const t = enc.encode(text)
  const names = refs.map(r => enc.encode(r.name))
  const out = new Uint8Array(12 + t.length + names.reduce((n, x) => n + 9 + x.length, 0))
  const dv = new DataView(out.buffer)
  out.set([66, 65, 77, 1], 0)
  dv.setInt32(4, t.length, true)
  out.set(t, 8)
  let at = 8 + t.length
  dv.setInt32(at, refs.length, true)
  at += 4
  refs.forEach((r, i) => {
    dv.setInt32(at, names[i].length + 1, true)
    out.set(names[i], at + 4)
    at += 4 + names[i].length + 1
    dv.setInt32(at, r.length, true)
    at += 4
  })
  return out
}

const CIGAR_OPS = 'MIDNSHP=X'
const NIBBLE = new Uint8Array(128).fill(15)
for (let i = 0; i < BAM_NIBBLES.length; i++) {
  NIBBLE[BAM_NIBBLES.charCodeAt(i)] = i
  NIBBLE[BAM_NIBBLES.toLowerCase().charCodeAt(i)] = i
}

function cigarOps(cigar: string): number[] {
  const ops: number[] = []
  if (cigar === '*') return ops
  let n = 0
  for (let i = 0; i < cigar.length; i++) {
    const c = cigar.charCodeAt(i)
    if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
    ops.push(n * 16 + CIGAR_OPS.indexOf(cigar[i]))
    n = 0
  }
  return ops
}

/** One BAM record. `end` is the exclusive end on the reference, for the bin. */
export function bamRecord(f: SamFields, end: number): Uint8Array {
  const name = enc.encode(f.qname.slice(0, 254))
  let ops = cigarOps(f.cigar)
  const seq = f.seq === '*' ? '' : f.seq
  const l = seq.length
  // More than 65535 operations do not fit: the CIGAR goes in a CG tag and
  // the record gets the placeholder "<read length>S<span>N" (SAMv1 4.2.2).
  let cg: number[] | null = null
  if (ops.length > 0xffff) {
    cg = ops
    ops = [l * 16 + 4, Math.max(0, end - f.pos) * 16 + 3]
  }
  const size = 32 + name.length + 1 + ops.length * 4 + ((l + 1) >> 1) + l + (cg ? 3 + 1 + 4 + cg.length * 4 : 0)
  const out = new Uint8Array(4 + size)
  const dv = new DataView(out.buffer)
  dv.setInt32(0, size, true)
  dv.setInt32(4, f.ref, true)
  dv.setInt32(8, f.pos, true)
  out[12] = name.length + 1
  out[13] = Math.min(255, Math.max(0, f.mapq))
  dv.setUint16(14, f.ref < 0 ? 4680 : reg2bin(f.pos, Math.max(end, f.pos + 1)), true)
  dv.setUint16(16, ops.length, true)
  dv.setUint16(18, f.flag, true)
  dv.setUint32(20, l, true)
  dv.setInt32(24, f.mateRef, true)
  dv.setInt32(28, f.mateRef < 0 ? -1 : f.matePos, true)
  dv.setInt32(32, f.tlen, true)
  let at = 36
  out.set(name, at)
  at += name.length + 1
  for (const op of ops) { dv.setUint32(at, op, true); at += 4 }
  for (let i = 0; i < l; i += 2) {
    out[at++] = (NIBBLE[seq.charCodeAt(i)] << 4) | (i + 1 < l ? NIBBLE[seq.charCodeAt(i + 1)] : 0)
  }
  if (f.qual === '*' || f.qual.length !== l) out.fill(0xff, at, at + l)
  else for (let i = 0; i < l; i++) out[at + i] = f.qual.charCodeAt(i) - 33
  at += l
  if (cg) {
    out.set([67, 71, 66, 73], at) // "CG", type B, subtype I
    dv.setUint32(at + 4, cg.length, true)
    at += 8
    for (const op of cg) { dv.setUint32(at, op, true); at += 4 }
  }
  return out
}

/** Builds a BAI index as records are written, in order. */
export class BaiBuilder {
  private readonly refs: {
    bins: Map<number, number[]>
    linear: number[]
    beg: number
    end: number
    mapped: number
  }[]

  constructor(refCount: number) {
    this.refs = Array.from({ length: refCount }, () => ({ bins: new Map(), linear: [], beg: -1, end: 0, mapped: 0 }))
  }

  add(ref: number, beg: number, end: number, vbeg: number, vend: number) {
    const r = this.refs[ref]
    const e = Math.max(end, beg + 1)
    const bin = reg2bin(beg, e)
    let chunks = r.bins.get(bin)
    if (!chunks) { chunks = []; r.bins.set(bin, chunks) }
    if (chunks.length > 0 && chunks[chunks.length - 1] === vbeg) chunks[chunks.length - 1] = vend
    else chunks.push(vbeg, vend)
    for (let w = beg >> 14; w <= (e - 1) >> 14; w++) if (r.linear[w] === undefined) r.linear[w] = vbeg
    if (r.beg < 0) r.beg = vbeg
    r.end = vend
    r.mapped++
  }

  finish(): Uint8Array {
    const parts: number[] = []
    const u32 = (v: number) => parts.push(v >>> 0)
    const u64 = (v: number) => { parts.push(v % 4294967296, Math.floor(v / 4294967296)) }
    u32(0x01494142) // "BAI\1"
    u32(this.refs.length)
    for (const r of this.refs) {
      const bins = [...r.bins.entries()].sort((a, b) => a[0] - b[0])
      u32(bins.length + (r.mapped ? 1 : 0))
      for (const [bin, chunks] of bins) {
        u32(bin)
        u32(chunks.length / 2)
        for (const v of chunks) u64(v)
      }
      if (r.mapped) {
        // The pseudo-bin samtools writes: where the reference's records are, and how many.
        u32(37450)
        u32(2)
        u64(r.beg)
        u64(r.end)
        u64(r.mapped)
        u64(0)
      }
      const lin: number[] = []
      for (let w = 0; w < r.linear.length; w++) lin.push(r.linear[w] ?? (w > 0 ? lin[w - 1] : 0))
      u32(lin.length)
      for (const v of lin) u64(v)
    }
    u64(0)
    return new Uint8Array(new Uint32Array(parts).buffer)
  }
}

// ---- Reading ----

/** Decompressed bytes of a BGZF (or any multi-member gzip) stream, block by block. */
export async function* inflateBgzf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let buf = new Uint8Array(0)
  for await (const c of chunks) {
    const n = new Uint8Array(buf.length + c.length)
    n.set(buf, 0)
    n.set(c, buf.length)
    buf = n
    let at = 0
    while (buf.length - at >= 18) {
      if (buf[at] !== 31 || buf[at + 1] !== 139) throw new Error('Not a BAM file: a block does not start as gzip')
      const dv = new DataView(buf.buffer, buf.byteOffset + at)
      const xlen = dv.getUint16(10, true)
      if (buf.length - at < 12 + xlen) break
      let bsize = -1
      for (let x = 12; x < 12 + xlen;) {
        const si1 = buf[at + x]
        const si2 = buf[at + x + 1]
        const slen = dv.getUint16(x + 2, true)
        if (si1 === 66 && si2 === 67) bsize = dv.getUint16(x + 4, true) + 1
        x += 4 + slen
      }
      if (bsize < 0) throw new Error('Not a BAM file: a block has no BGZF size')
      if (buf.length - at < bsize) break
      const cdata = buf.subarray(at + 12 + xlen, at + bsize - 8)
      const isize = dv.getUint32(bsize - 4, true)
      if (isize > 0) yield inflateSync(cdata, { out: new Uint8Array(isize) })
      at += bsize
    }
    buf = buf.slice(at)
  }
  if (buf.length > 0) throw new Error('The BAM file ends partway through a block')
}

export interface AlignmentHeader {
  refs: { name: string; length: number }[]
  /** The first @PG line's ID, name, version and command line. */
  program: { id: string; name: string; version: string; command: string } | null
  sortOrder: string | null
}

/** Read @SQ, @PG and @HD from SAM header text. */
export function parseHeaderText(text: string, refs?: { name: string; length: number }[]): AlignmentHeader {
  const sq: { name: string; length: number }[] = []
  let program: AlignmentHeader['program'] = null
  let sortOrder: string | null = null
  for (const line of text.split('\n')) {
    const f = line.replace(/\r$/, '').split('\t')
    const tag = (k: string) => f.find(x => x.startsWith(k + ':'))?.slice(k.length + 1) ?? ''
    if (f[0] === '@SQ') sq.push({ name: tag('SN'), length: Number(tag('LN')) || 0 })
    else if (f[0] === '@PG' && !program) program = { id: tag('ID'), name: tag('PN') || tag('ID'), version: tag('VN'), command: tag('CL') }
    else if (f[0] === '@HD') sortOrder = tag('SO') || null
  }
  return { refs: refs && refs.length ? refs : sq, program, sortOrder }
}

/** Reads BAM records from decompressed bytes. */
export class BamParser {
  private buf = new Uint8Array(0)
  private at = 0
  header: AlignmentHeader | null = null

  push(data: Uint8Array) {
    const rest = this.buf.length - this.at
    const n = new Uint8Array(rest + data.length)
    n.set(this.buf.subarray(this.at), 0)
    n.set(data, rest)
    this.buf = n
    this.at = 0
  }

  /** Parse the header once enough bytes are in; true when done. */
  readHeader(): boolean {
    if (this.header) return true
    const b = this.buf
    const dv = new DataView(b.buffer, b.byteOffset)
    let at = this.at
    if (b.length - at < 12) return false
    if (b[at] !== 66 || b[at + 1] !== 65 || b[at + 2] !== 77 || b[at + 3] !== 1) throw new Error('Not a BAM file')
    const lText = dv.getInt32(at + 4, true)
    if (b.length - at < 12 + lText) return false
    const text = dec.decode(b.subarray(at + 8, at + 8 + lText)).replace(/\0+$/, '')
    at += 8 + lText
    const nRef = dv.getInt32(at, true)
    at += 4
    const refs: { name: string; length: number }[] = []
    for (let i = 0; i < nRef; i++) {
      if (b.length - at < 4) return false
      const lName = dv.getInt32(at, true)
      if (b.length - at < 8 + lName) return false
      refs.push({ name: dec.decode(b.subarray(at + 4, at + 4 + lName - 1)), length: dv.getInt32(at + 4 + lName, true) })
      at += 8 + lName
    }
    this.header = parseHeaderText(text, refs)
    this.at = at
    return true
  }

  /** The next whole record, or null when more bytes are needed. */
  next(): SamFields | null {
    const b = this.buf
    const at = this.at
    if (b.length - at < 4) return null
    const dv = new DataView(b.buffer, b.byteOffset + at)
    const size = dv.getInt32(0, true)
    if (b.length - at < 4 + size) return null
    this.at = at + 4 + size
    const lName = b[at + 12]
    const nCigar = dv.getUint16(16, true)
    const l = dv.getUint32(20, true)
    let p = at + 36
    const qname = dec.decode(b.subarray(p, p + lName - 1))
    p += lName
    const ops: number[] = []
    for (let i = 0; i < nCigar; i++) ops.push(dv.getUint32(p - at + i * 4, true))
    p += nCigar * 4
    let seq = ''
    for (let i = 0; i < l; i++) seq += BAM_NIBBLES[(b[p + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15]
    p += (l + 1) >> 1
    let qual = '*'
    if (l > 0 && b[p] !== 0xff) {
      let q = ''
      for (let i = 0; i < l; i++) q += String.fromCharCode(b[p + i] + 33)
      qual = q
    }
    p += l
    // A placeholder CIGAR "kSmN": the real one is in the CG tag.
    let cigarOpsList = ops
    if (ops.length === 2 && (ops[0] & 15) === 4 && (ops[0] >>> 4) === l && (ops[1] & 15) === 3) {
      const cg = findCg(b, p, at + 4 + size)
      if (cg) cigarOpsList = cg
    }
    const cigar = cigarOpsList.length ? cigarOpsList.map(op => `${op >>> 4}${CIGAR_OPS[op & 15]}`).join('') : '*'
    return {
      qname, flag: dv.getUint16(18, true), ref: dv.getInt32(4, true), pos: dv.getInt32(8, true), mapq: b[at + 13],
      cigar, mateRef: dv.getInt32(24, true), matePos: dv.getInt32(28, true), tlen: dv.getInt32(32, true),
      seq: l ? seq : '*', qual,
    }
  }
}

function findCg(b: Uint8Array, from: number, to: number): number[] | null {
  const dv = new DataView(b.buffer, b.byteOffset)
  let p = from
  const size: Record<string, number> = { A: 1, c: 1, C: 1, s: 2, S: 2, i: 4, I: 4, f: 4 }
  while (p + 3 <= to) {
    const tag = String.fromCharCode(b[p], b[p + 1])
    const type = String.fromCharCode(b[p + 2])
    p += 3
    if (type === 'Z' || type === 'H') { while (p < to && b[p] !== 0) p++; p++; continue }
    if (type === 'B') {
      const sub = String.fromCharCode(b[p])
      const n = dv.getUint32(p + 1, true)
      if (tag === 'CG' && sub === 'I') {
        const out: number[] = []
        for (let i = 0; i < n; i++) out.push(dv.getUint32(p + 5 + i * 4, true))
        return out
      }
      p += 5 + n * (size[sub] ?? 1)
      continue
    }
    p += size[type] ?? 1
  }
  return null
}
