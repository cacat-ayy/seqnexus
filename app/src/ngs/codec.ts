/**
 * How reads are stored: in chunks of a few thousand, each one binary buffer,
 * deflated.
 *
 * A chunk holds, in order: a header (format, read count, whether there are
 * qualities), each read's length, the read IDs as one newline-joined text,
 * the bases two to a byte in BAM's 4-bit code (`=ACMGRSVTWYHKDBN`, so N and
 * the IUPAC ambiguity letters survive), and one byte of Phred quality per
 * base. Deflate then shrinks the IDs (which repeat their instrument and run
 * prefix) and the qualities (which take few values) several-fold.
 *
 * Only the read ID is kept from a header, not its comment: comments run to
 * dozens of bytes per read and nothing downstream reads them.
 */

import { deflateSync, inflateSync } from 'fflate'

export const BAM_NIBBLES = '=ACMGRSVTWYHKDBN'
const NIBBLE_ASCII = Uint8Array.from(BAM_NIBBLES, c => c.charCodeAt(0))
const latin1 = new TextDecoder('latin1')

/**
 * ASCII bytes as one flat string. Adding a character at a time leaves V8 a
 * chain of one-character pieces (about 30 bytes a base until something
 * flattens it): 160 Mb of long reads held 4.7 GB of heap that way.
 */
function asciiText(bytes: Uint8Array): string {
  return bytes.length <= 4096 ? String.fromCharCode.apply(null, bytes as unknown as number[]) : latin1.decode(bytes)
}
const N_CODE = 15
const CODE = new Uint8Array(128).fill(N_CODE)
for (let i = 0; i < BAM_NIBBLES.length; i++) {
  CODE[BAM_NIBBLES.charCodeAt(i)] = i
  CODE[BAM_NIBBLES.toLowerCase().charCodeAt(i)] = i
}
CODE['U'.charCodeAt(0)] = CODE['T'.charCodeAt(0)]
CODE['u'.charCodeAt(0)] = CODE['T'.charCodeAt(0)]

const MAGIC = 0x314b4352 // "RCK1"
const HEADER = 12

export interface ReadInput {
  id: string
  seq: string
  /** Phred+33 characters, or '' when the reads have no quality. */
  qual: string
}

/** A chunk read back. Bases stay coded; ask for what is needed. */
export class ReadChunk {
  readonly count: number
  readonly hasQuality: boolean
  readonly ids: string[]
  /** offsets[i] is where read i starts in the base and quality arrays. */
  readonly offsets: Uint32Array
  /** One 4-bit code per base, unpacked. */
  readonly codes: Uint8Array
  /** Phred scores (not +33); all zero without quality. */
  readonly qual: Uint8Array

  constructor(count: number, hasQuality: boolean, ids: string[], offsets: Uint32Array, codes: Uint8Array, qual: Uint8Array) {
    this.count = count
    this.hasQuality = hasQuality
    this.ids = ids
    this.offsets = offsets
    this.codes = codes
    this.qual = qual
  }

  length(i: number): number { return this.offsets[i + 1] - this.offsets[i] }

  seq(i: number): string {
    const from = this.offsets[i]
    const out = new Uint8Array(this.offsets[i + 1] - from)
    for (let k = 0; k < out.length; k++) out[k] = NIBBLE_ASCII[this.codes[from + k]]
    return asciiText(out)
  }

  /** Phred+33 text, as FASTQ writes it ('!' throughout without quality). */
  qualText(i: number): string {
    const from = this.offsets[i]
    const out = new Uint8Array(this.offsets[i + 1] - from)
    for (let k = 0; k < out.length; k++) out[k] = this.qual[from + k] + 33
    return asciiText(out)
  }
}

/** Pack reads into one deflated buffer. */
export function encodeChunk(reads: readonly ReadInput[], level: 1 | 4 | 6 = 4): Uint8Array {
  const n = reads.length
  let total = 0
  let hasQuality = false
  for (const r of reads) { total += r.seq.length; if (r.qual) hasQuality = true }
  const idText = new TextEncoder().encode(reads.map(r => r.id).join('\n'))
  const size = HEADER + 4 * n + 4 + idText.length + Math.ceil(total / 2) + (hasQuality ? total : 0)
  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, MAGIC, true)
  dv.setUint32(4, n, true)
  dv.setUint32(8, hasQuality ? 1 : 0, true)
  let o = HEADER
  for (const r of reads) { dv.setUint32(o, r.seq.length, true); o += 4 }
  dv.setUint32(o, idText.length, true); o += 4
  buf.set(idText, o); o += idText.length
  let k = 0
  for (const r of reads) {
    const s = r.seq
    for (let i = 0; i < s.length; i++, k++) {
      const c = s.charCodeAt(i)
      const code = c < 128 ? CODE[c] : N_CODE
      if (k & 1) buf[o + (k >> 1)] |= code
      else buf[o + (k >> 1)] = code << 4
    }
  }
  o += Math.ceil(total / 2)
  if (hasQuality) {
    for (const r of reads) {
      const q = r.qual
      for (let i = 0; i < r.seq.length; i++) buf[o++] = i < q.length ? Math.max(0, q.charCodeAt(i) - 33) : 0
    }
  }
  return deflateSync(buf, { level })
}

export function decodeChunk(packed: Uint8Array): ReadChunk {
  const buf = inflateSync(packed)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Stored reads are in an unknown format')
  const n = dv.getUint32(4, true)
  const hasQuality = dv.getUint32(8, true) === 1
  const offsets = new Uint32Array(n + 1)
  let o = HEADER
  for (let i = 0; i < n; i++) { offsets[i + 1] = offsets[i] + dv.getUint32(o, true); o += 4 }
  const idLen = dv.getUint32(o, true); o += 4
  const ids = n ? new TextDecoder().decode(buf.subarray(o, o + idLen)).split('\n') : []
  o += idLen
  const total = offsets[n]
  const codes = new Uint8Array(total)
  for (let k = 0; k < total; k++) {
    const byte = buf[o + (k >> 1)]
    codes[k] = k & 1 ? byte & 15 : byte >> 4
  }
  o += Math.ceil(total / 2)
  const qual = hasQuality ? buf.slice(o, o + total) : new Uint8Array(total)
  return new ReadChunk(n, hasQuality, ids, offsets, codes, qual)
}
