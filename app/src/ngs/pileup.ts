/**
 * Candidate variant sites, found while a mapping is stored.
 *
 * Every aligned base is counted at its reference position by what the read
 * shows there (A, C, G, T, a deletion, or an insertion after it) and by
 * strand, as a pileup does. A position is kept as a candidate when something
 * other than the reference is seen in at least two reads and in at least 5%
 * of the reads there (10% for insertions and deletions, which sequencers,
 * Nanopore above all, get wrong far more often than single bases). Variant
 * calling (Phase 5) starts from these sites, so a genome's variant table
 * does not need every alignment read again; anything finer (a region at a
 * lower threshold) is recounted from the stored alignments.
 *
 * Bases below quality 13 are not counted, as samtools mpileup leaves them
 * out by default; deletions and insertions are counted whatever the
 * quality. The depth of a site is the bases counted there plus the
 * deletions. Counts are kept in blocks of 4096 positions, and a block is
 * written out once no alignment still to come can reach it (alignments
 * arrive sorted by start). On a circular reference, alignments across the
 * origin add to the first positions last, so those blocks stay open to the
 * end.
 */

import { deflateSync, inflateSync } from 'fflate'
import { refCodeAt, type RefBases, type StoredAlignment } from './alignments'

export const ALLELES = ['A', 'C', 'G', 'T', 'del', 'ins'] as const
export const MIN_BASE_QUALITY = 13
export const MIN_ALT_READS = 2
export const MIN_SNV_FRACTION = 0.05
export const MIN_INDEL_FRACTION = 0.1

/** A candidate site: `counts[allele * 2 + strand]`, strand 0 forward, 1 reverse, alleles as in ALLELES. */
export interface PileupSite {
  pos: number
  depth: number
  counts: Uint32Array
}

const BLOCK = 4096
const W = 12
const ALLELE = new Int8Array(128).fill(-1)
ALLELE[65] = 0; ALLELE[67] = 1; ALLELE[71] = 2; ALLELE[84] = 3
ALLELE[97] = 0; ALLELE[99] = 1; ALLELE[103] = 2; ALLELE[116] = 3

export class PileupCounter {
  private readonly blocks = new Map<number, Uint32Array>()
  private readonly sites: PileupSite[] = []
  private readonly ref: RefBases
  private readonly L: number
  private readonly keepHead: number

  /** `keepHead`: positions below it are written out only at the end (the stretch alignments across the origin reach). */
  constructor(ref: RefBases, keepHead = 0) {
    this.ref = ref
    this.L = ref.bases.length
    this.keepHead = keepHead
  }

  private inc(pos: number, allele: number, strand: number) {
    let p = pos
    if (p >= this.L) {
      if (!this.ref.circular) return
      p %= this.L
    }
    const b = p >> 12
    let arr = this.blocks.get(b)
    if (!arr) { arr = new Uint32Array(BLOCK * W); this.blocks.set(b, arr) }
    arr[(p & (BLOCK - 1)) * W + allele * 2 + strand]++
  }

  add(a: StoredAlignment) {
    const d = a.diff
    if (d === '*') return
    const strand = a.flag & 0x10 ? 1 : 0
    const q = a.qual
    const hasQ = q.length > 0
    let p = a.start
    let qp = a.clipL.length
    let i = 0
    while (i < d.length) {
      const op = d[i++]
      if (op === ':' || op === '~') {
        let n = 0
        while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) n = n * 10 + d.charCodeAt(i++) - 48
        if (op === ':') {
          for (let k = 0; k < n; k++) {
            const al = ALLELE[refCodeAt(this.ref, p + k)]
            if (al >= 0 && (!hasQ || q.charCodeAt(qp + k) - 33 >= MIN_BASE_QUALITY)) this.inc(p + k, al, strand)
          }
          qp += n
        }
        p += n
      } else if (op === '*') {
        const al = ALLELE[d.charCodeAt(i + 1)]
        if (al >= 0 && (!hasQ || q.charCodeAt(qp) - 33 >= MIN_BASE_QUALITY)) this.inc(p, al, strand)
        i += 2
        p++
        qp++
      } else {
        let j = i
        while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
        const n = j - i
        if (op === '+') {
          if (p > a.start) this.inc(p - 1, 5, strand)
          qp += n
        } else {
          for (let k = 0; k < n; k++) this.inc(p + k, 4, strand)
          p += n
        }
        i = j
      }
    }
  }

  private emit(b: number, arr: Uint32Array) {
    const base = b * BLOCK
    for (let i = 0; i < BLOCK; i++) {
      const pos = base + i
      if (pos >= this.L) break
      const o = i * W
      let depth = 0
      for (let k = 0; k < 10; k++) depth += arr[o + k]
      if (depth === 0 && arr[o + 10] + arr[o + 11] === 0) continue
      const refAllele = ALLELE[this.ref.bases.charCodeAt(pos)]
      let keep = false
      for (let al = 0; al < 6 && !keep; al++) {
        if (al === refAllele) continue
        const n = arr[o + al * 2] + arr[o + al * 2 + 1]
        keep = n >= MIN_ALT_READS && n >= depth * (al < 4 ? MIN_SNV_FRACTION : MIN_INDEL_FRACTION)
      }
      if (keep) this.sites.push({ pos, depth, counts: arr.slice(o, o + W) })
    }
  }

  /** Write out every block below `pos` that no alignment yet to come can reach. */
  finishBelow(pos: number) {
    for (const [b, arr] of this.blocks) {
      if ((b + 1) * BLOCK <= pos && b * BLOCK >= this.keepHead) {
        this.emit(b, arr)
        this.blocks.delete(b)
      }
    }
  }

  /** All sites, in order. */
  finish(): PileupSite[] {
    for (const [b, arr] of this.blocks) this.emit(b, arr)
    this.blocks.clear()
    return this.sites.sort((x, y) => x.pos - y.pos)
  }
}

export function encodeSites(sites: readonly PileupSite[]): Uint8Array {
  const out = new Uint32Array(sites.length * (W + 2))
  sites.forEach((s, i) => {
    out[i * (W + 2)] = s.pos
    out[i * (W + 2) + 1] = s.depth
    out.set(s.counts, i * (W + 2) + 2)
  })
  return deflateSync(new Uint8Array(out.buffer), { level: 4 })
}

export function decodeSites(data: Uint8Array): PileupSite[] {
  const raw = inflateSync(data)
  const a = new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  const out: PileupSite[] = []
  for (let i = 0; i + W + 2 <= a.length; i += W + 2) out.push({ pos: a[i], depth: a[i + 1], counts: a.slice(i + 2, i + 2 + W) })
  return out
}
