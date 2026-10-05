/**
 * Mapping a read set to reference sequences with minimap2 (WebAssembly).
 *
 * Reads go to minimap2 in batches (by bases, so long and short reads both
 * keep memory bounded), with the references written as one FASTA each run;
 * indexing a few megabases takes a moment against minutes of mapping. Each
 * batch's SAM output is read once: coverage is added up per reference base,
 * figures for the report are gathered, and the alignments are stored without
 * their bases (a record names its read by index; the bases stay in the read
 * set, which is kept).
 *
 * A circular reference gets its start appended (as long as the longest read
 * could need, at most its own length), so reads across the origin map in one
 * piece; positions past the end are folded back. In the appended stretch the
 * same sequence is there twice, so minimap2 gives reads there mapping quality
 * 0; coverage counts every alignment whatever its mapping quality, so the
 * origin is not left uncovered.
 */

import { deflateSync } from 'fflate'
import { decodeChunk } from './codec'
import type { Histogram, Technology } from './types'

export type MapPreset = 'sr' | 'map-ont' | 'map-hifi'

export const PRESET_LABEL: Record<MapPreset, string> = {
  'sr': 'Short reads (sr)',
  'map-ont': 'Nanopore (map-ont)',
  'map-hifi': 'PacBio HiFi (map-hifi)',
}

export function presetFor(t: Technology): MapPreset {
  return t === 'nanopore' ? 'map-ont' : t === 'pacbio' ? 'map-hifi' : 'sr'
}

export interface MapReference {
  name: string
  tabId: string | null
  bases: string
  circular: boolean
}

export interface ReferenceReport {
  name: string
  tabId: string | null
  length: number
  circular: boolean
  /** Reads whose primary alignment is on this reference. */
  mappedReads: number
  meanDepth: number
  /** Share of bases covered at least once, and at least ten times. */
  breadth1: number
  breadth10: number
  /** Mean depth in bins of `binSize` bases, for the coverage chart. */
  binSize: number
  coverageBins: number[]
}

export interface MappingReport {
  preset: MapPreset
  reads: number
  mapped: number
  /** Share of mapped reads in a properly oriented pair at a plausible distance; null for single reads. */
  properlyPaired: number | null
  mapq: Histogram
  /** Fragment lengths of proper pairs; null for single reads. */
  insertSizes: Histogram | null
  references: ReferenceReport[]
  alignmentChunks: number
  storedBytes: number
}

export type ToolRunner = (
  args: string[],
  files: Record<string, string>,
  outputs: string[],
) => Promise<{ exitCode: number; stderr: string; files: Record<string, string | null> }>

/** Bases per minimap2 run. */
export const MAP_BATCH_BASES = 40_000_000

export function minimap2Args(preset: MapPreset, paired: boolean): string[] {
  return ['-a', '-x', preset, '--secondary=no', '-t', '1', '-o', 'out.sam', 'ref.fa', 'r1.fq', ...(paired ? ['r2.fq'] : [])]
}

/** The references as FASTA, circular ones extended past their end by `extend` bases (at most their length). */
export function referenceFasta(refs: readonly MapReference[], extend: number): string {
  return refs.map((r, i) => {
    const b = r.bases.toUpperCase()
    const seq = r.circular ? b + b.slice(0, Math.min(b.length, extend)) : b
    return `>ref${i}\n${seq}\n`
  }).join('')
}


/** Gathers coverage and report figures from SAM text, batch after batch. */
export class SamAccumulator {
  readonly coverage: Uint32Array[]
  private readonly lengths: number[]
  private readonly mappedPerRef: number[]
  reads = 0
  mapped = 0
  proper = 0
  private readonly mapq = new Uint32Array(61)
  private readonly inserts = new Map<number, number>()
  private readonly paired: boolean

  constructor(lengths: readonly number[], paired: boolean) {
    this.lengths = [...lengths]
    this.coverage = lengths.map(l => new Uint32Array(l))
    this.mappedPerRef = lengths.map(() => 0)
    this.paired = paired
  }

  /**
   * Read one batch of SAM. Primary records come in input order, one per read,
   * so the n-th primary record is read `firstRead + n`; minimap2 writes a
   * read's supplementary alignments straight after its primary one, so they
   * take the same read. Returns the stored form of the batch's alignments
   * (tab-separated: reference, position, read index, flag, mapping quality,
   * CIGAR, mate's reference or -1, mate's position, template length).
   */
  addSam(sam: string, firstRead: number): string {
    const out: string[] = []
    let readIndex = firstRead - 1
    for (const line of sam.split('\n')) {
      if (!line || line[0] === '@') continue
      const f = line.split('\t', 9)
      const flag = Number(f[1])
      const primary = (flag & 0x900) === 0
      if (primary) { readIndex++; this.reads++ }
      if (flag & 0x4) continue
      const ref = Number(f[2].slice(3))
      const L = this.lengths[ref]
      if (L === undefined) continue
      let pos = Number(f[3]) - 1
      const mq = Math.min(60, Number(f[4]))
      if (primary) {
        this.mapped++
        this.mappedPerRef[ref]++
        this.mapq[mq]++
        if (flag & 0x2) {
          this.proper++
          const tlen = Math.abs(Number(f[8]))
          if (this.paired && flag & 0x40 && tlen > 0) this.inserts.set(tlen, (this.inserts.get(tlen) ?? 0) + 1)
        }
      }
      // Coverage: aligned bases (M, =, X), not deletions, as samtools depth counts.
      const cov = this.coverage[ref]
      const cigar = f[5]
      let n = 0
      for (let i = 0; i < cigar.length; i++) {
        const c = cigar.charCodeAt(i)
        if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
        const op = cigar[i]
        if (op === 'M' || op === '=' || op === 'X') {
          for (let k = 0; k < n; k++) cov[(pos + k) % L]++
          pos += n
        } else if (op === 'D' || op === 'N') pos += n
        n = 0
      }
      const start = (Number(f[3]) - 1) % L
      const mateRef = f[6] === '=' ? ref : f[6] === '*' ? -1 : Number(f[6].slice(3))
      const mateL = this.lengths[mateRef]
      const matePos = mateL ? (Number(f[7]) - 1) % mateL : -1
      out.push(`${ref}\t${start}\t${readIndex}\t${flag}\t${mq}\t${cigar}\t${mateRef}\t${matePos}\t${f[8]}`)
    }
    return out.join('\n')
  }

  report(refs: readonly MapReference[], preset: MapPreset, chunks: number, storedBytes: number): MappingReport {
    const references = refs.map((r, i): ReferenceReport => {
      const cov = this.coverage[i]
      const L = cov.length
      let sum = 0
      let one = 0
      let ten = 0
      for (let p = 0; p < L; p++) { const d = cov[p]; sum += d; if (d >= 1) { one++; if (d >= 10) ten++ } }
      const binSize = Math.max(1, Math.ceil(L / 400))
      const coverageBins: number[] = []
      for (let s = 0; s < L; s += binSize) {
        let t = 0
        const e = Math.min(L, s + binSize)
        for (let p = s; p < e; p++) t += cov[p]
        coverageBins.push(t / (e - s))
      }
      return {
        name: r.name, tabId: r.tabId, length: L, circular: r.circular,
        mappedReads: this.mappedPerRef[i],
        meanDepth: L ? sum / L : 0, breadth1: L ? one / L : 0, breadth10: L ? ten / L : 0,
        binSize, coverageBins,
      }
    })
    return {
      preset,
      reads: this.reads,
      mapped: this.mapped,
      properlyPaired: this.paired ? (this.mapped ? this.proper / this.mapped : 0) : null,
      mapq: histogram(this.mapq),
      insertSizes: this.paired ? insertHistogram(this.inserts) : null,
      references,
      alignmentChunks: chunks,
      storedBytes,
    }
  }
}

function histogram(counts: Uint32Array): Histogram {
  return { edges: Array.from({ length: counts.length + 1 }, (_, i) => i), counts: [...counts] }
}

/** Fragment lengths in 60 bins up to the 99th percentile (longer ones go in the last bin). */
function insertHistogram(m: Map<number, number>): Histogram {
  const keys = [...m.keys()].sort((a, b) => a - b)
  if (keys.length === 0) return { edges: [], counts: [] }
  let total = 0
  for (const c of m.values()) total += c
  let acc = 0
  let hi = keys[keys.length - 1]
  for (const k of keys) { acc += m.get(k)!; if (acc >= total * 0.99) { hi = k; break } }
  const lo = keys[0]
  const width = Math.max(1, Math.ceil((hi - lo + 1) / 60))
  const bins = Math.ceil((hi - lo + 1) / width)
  const counts = new Array<number>(bins).fill(0)
  for (const [k, c] of m) counts[Math.min(bins - 1, Math.floor((k - lo) / width))] += c
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * width), counts }
}

export interface MapOptions {
  readSet: { id: string; chunks: number; paired: boolean; technology: Technology; maxLength: number }
  refs: readonly MapReference[]
  preset: MapPreset
  minimap2: ToolRunner
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  /** Store one batch of alignments (deflated text) and one reference's coverage. */
  putAlignments: (index: number, data: Uint8Array) => Promise<void>
  putCoverage: (refIndex: number, data: Uint8Array) => Promise<void>
  batchBases?: number
  onProgress?: (done: number, total: number) => void
}

export async function mapReads(o: MapOptions): Promise<MappingReport> {
  const { readSet: rs, refs, preset } = o
  if (refs.length === 0) throw new Error('Choose a reference to map to')
  const extend = Math.max(1000, rs.maxLength + 100)
  const refText = referenceFasta(refs, extend)
  const acc = new SamAccumulator(refs.map(r => r.bases.length), rs.paired)
  const enc = new TextEncoder()
  let r1: string[] = []
  let r2: string[] = []
  let bases = 0
  let firstRead = 0
  let pending = 0
  let chunks = 0
  let storedBytes = 0
  const runBatch = async () => {
    if (pending === 0) return
    const files: Record<string, string> = { 'ref.fa': refText, 'r1.fq': r1.join('') }
    if (rs.paired) files['r2.fq'] = r2.join('')
    r1 = []
    r2 = []
    bases = 0
    const res = await o.minimap2(minimap2Args(preset, rs.paired), files, ['out.sam'])
    const sam = res.files['out.sam']
    if (res.exitCode !== 0 || sam === null) {
      throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    // minimap2 writes the two mates of a pair one after the other, so read
    // indices follow the read set's own interleaved order.
    const stored = acc.addSam(sam, firstRead)
    firstRead += pending
    pending = 0
    const data = deflateSync(enc.encode(stored), { level: 4 })
    await o.putAlignments(chunks++, data)
    storedBytes += data.length
  }

  for (let c = 0; c < rs.chunks; c++) {
    const packed = await o.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const chunk = decodeChunk(packed)
    for (let i = 0; i < chunk.count; i++) {
      const rec = `@${chunk.ids[i]}\n${chunk.seq(i)}\n+\n${chunk.hasQuality ? chunk.qualText(i) : 'I'.repeat(chunk.length(i))}\n`
      if (rs.paired && i & 1) r2.push(rec)
      else r1.push(rec)
      bases += chunk.length(i)
      pending++
    }
    if (bases >= (o.batchBases ?? MAP_BATCH_BASES) && (!rs.paired || pending % 2 === 0)) await runBatch()
    o.onProgress?.(c + 1, rs.chunks)
  }
  await runBatch()

  for (let i = 0; i < refs.length; i++) {
    const cov = acc.coverage[i]
    await o.putCoverage(i, deflateSync(new Uint8Array(cov.buffer, cov.byteOffset, cov.byteLength), { level: 4 }))
  }
  return acc.report(refs, preset, chunks, storedBytes)
}

