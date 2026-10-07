/**
 * Storing a mapping: alignments in, sorted pages, coverage, summaries and
 * candidate sites out.
 *
 * Alignments arrive in the order the reads were in (from minimap2) or in
 * whatever order a SAM or BAM file has. Each is counted for the report and
 * the coverage, turned into its stored form (alignments.ts) and dropped into
 * a bucket by reference and position. Buckets are sized so each holds about
 * 20 million read bases at the depth the reads would give, and when the
 * buckets together hold more than about 64 MB they are written out to
 * storage as they are. Once every alignment is in, each bucket is read
 * back, sorted, counted into the pileup and written as pages of at most
 * 4000 alignments, in reference order. So a bacterial genome at depth is
 * sorted a bucket at a time, never whole in memory, and the viewer later
 * loads only the pages over what it shows.
 *
 * What is stored, under the mapping's storage id (see mappingStorageIds):
 * pages, a page index, per-base coverage, coverage summaries at 16, 256 and
 * 4096 bases per bin, candidate sites, and each reference's bases (the
 * stored bases are differences from them).
 */

import { deflateSync } from 'fflate'
import { decodePage, encodePage, storeAlignment, summarizeCoverage, encodeSummaries, type SamFields, type StoredAlignment } from './alignments'
import { encodeSites, PileupCounter } from './pileup'
import type { Histogram } from './types'
import type { MapPreset } from './mapper'
import { clipPrimer, type PrimerSite } from './primerClip'

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
  /** Candidate variant sites stored (see pileup.ts). */
  sites: number
}

export interface MappingReport {
  /** 2: stored in pages (this file). 1: stored by an earlier version without the reads' bases, so with nothing to view or export. */
  version: 1 | 2
  /** minimap2's preset; null for imported alignments. */
  preset: MapPreset | null
  /** The program that aligned the reads, for the SAM header. */
  program: { id: string; name: string; version: string; command: string }
  /** Imported alignments: the file they came from. */
  importedFrom?: string
  reads: number
  mapped: number
  /** Supplementary alignments (the other parts of a split read). */
  supplementary: number
  /** Share of mapped reads in a properly oriented pair at a plausible distance; null for single reads. */
  properlyPaired: number | null
  mapq: Histogram
  /** Fragment lengths of proper pairs; null for single reads. */
  insertSizes: Histogram | null
  references: ReferenceReport[]
  pages: number
  storedBytes: number
  /** Alignments left out: secondary ones, and (imports) ones on a reference that was not given. */
  skipped: { secondary: number; otherReference: number }
  /** Primer clipping (primerClip.ts), when asked for: primer sites on the references, alignments clipped, and those left with nothing aligned. */
  primers?: { sites: number; clipped: number; emptied: number }
}

export interface PageInfo {
  /** Page number in storage. */
  index: number
  /** Start of the first and of the last alignment. */
  first: number
  last: number
  /** Furthest end of any alignment in the page. */
  maxEnd: number
  count: number
}

export interface MappingIndex {
  version: 1
  refs: { pages: PageInfo[] }[]
}

/** Where a mapping's parts are stored (as read set ids in the chunk store). */
export function mappingStorageIds(storageId: string) {
  return {
    pages: `${storageId}-pg`,
    index: `${storageId}-idx`,
    coverage: `${storageId}-cov`,
    summary: `${storageId}-sum`,
    sites: `${storageId}-var`,
    reference: `${storageId}-ref`,
    // Recounted candidate sites, written when variants are first called (calls.ts).
    calls: `${storageId}-calls`,
    // Soft-clip junctions, written when they are first looked for (junctions.ts).
    junctions: `${storageId}-junc`,
    // A de novo assembly's graph (denovo/graph.ts), when the mapping is of reads to their own contigs.
    graph: `${storageId}-gfa`,
  }
}

/** Every id a mapping keeps, for cleaning up storage. */
export function mappingStorageList(storageId: string): string[] {
  return Object.values(mappingStorageIds(storageId))
}

export interface MappingStorage {
  put(id: string, index: number, data: Uint8Array): Promise<void>
  get(id: string, index: number): Promise<Uint8Array | undefined>
  remove(ids: string[]): Promise<void>
}

export const BUCKET_BASES = 20_000_000
export const SPILL_BYTES = 64_000_000
export const PAGE_ALIGNMENTS = 4000
export const PAGE_BASES = 2_000_000

interface Bucket {
  recs: StoredAlignment[]
  parts: number
}

export class MappingBuilder {
  private readonly refs: readonly MapReference[]
  private readonly upper: { bases: string; circular: boolean }[]
  private readonly storage: MappingStorage
  private readonly storageId: string
  private paired: boolean
  readonly coverage: Uint32Array[]
  private readonly forward: Uint32Array[]
  private readonly spans: number[]
  private readonly buckets: Bucket[][]
  private readonly overhang: number[]
  private readonly mappedPerRef: number[]
  private readonly mapq = new Uint32Array(61)
  private readonly inserts = new Map<number, number>()
  private readonly spillBytes: number
  private buffered = 0
  private readonly primerSites: readonly (readonly PrimerSite[])[] | null
  private readonly primerCounts = { clipped: 0, emptied: 0 }
  private stored = 0
  reads = 0
  mapped = 0
  proper = 0
  supplementary = 0
  secondary = 0
  otherReference = 0

  constructor(o: {
    storageId: string
    refs: readonly MapReference[]
    paired: boolean
    storage: MappingStorage
    /** Read bases expected, for sizing the buckets. */
    expectedBases: number
    /** Primer sites per reference, sorted: each alignment's primer is clipped (primerClip.ts). */
    primerSites?: readonly (readonly PrimerSite[])[]
    /** Tests: smaller buckets and spills. */
    bucketBases?: number
    spillBytes?: number
  }) {
    this.spillBytes = o.spillBytes ?? SPILL_BYTES
    this.primerSites = o.primerSites ?? null
    this.refs = o.refs
    this.upper = o.refs.map(r => ({ bases: r.bases.toUpperCase(), circular: r.circular }))
    this.storage = o.storage
    this.storageId = o.storageId
    this.paired = o.paired
    this.coverage = o.refs.map(r => new Uint32Array(r.bases.length))
    this.forward = o.refs.map(r => new Uint32Array(r.bases.length))
    const total = o.refs.reduce((n, r) => n + r.bases.length, 0)
    const depth = total ? o.expectedBases / total : 1
    this.spans = o.refs.map(r => Math.max(1, Math.min(r.bases.length, Math.max(o.bucketBases ? 1 : 1024, Math.ceil((o.bucketBases ?? BUCKET_BASES) / Math.max(depth, 1e-6))))))
    this.buckets = o.refs.map((r, i) => Array.from({ length: Math.max(1, Math.ceil(r.bases.length / this.spans[i])) }, () => ({ recs: [], parts: 0 })))
    this.overhang = o.refs.map(() => 0)
    this.mappedPerRef = o.refs.map(() => 0)
  }

  /** Buckets to sort when finishing, for progress. */
  get bucketCount(): number {
    return this.buckets.reduce((n, b) => n + b.length, 0)
  }

  private tempId(ref: number, bucket: number) {
    return `${this.storageId}-t${ref}.${bucket}`
  }

  private async put(id: string, index: number, data: Uint8Array) {
    await this.storage.put(id, index, data)
    this.stored += data.length
  }

  /** Add one SAM record. `read` is the read's index in its read set, -1 when not known. */
  async add(f: SamFields, read: number): Promise<void> {
    if (f.flag & 0x100) { this.secondary++; return }
    // Imported files say whether reads are paired only in their flags.
    if (f.flag & 0x1) this.paired = true
    const primary = (f.flag & 0x800) === 0
    if (primary) this.reads++
    const sites = this.primerSites && f.ref >= 0 && f.ref < this.refs.length ? this.primerSites[f.ref] : null
    if (sites?.length) {
      const up = this.upper[f.ref]
      const r = clipPrimer(f, sites, up.circular ? up.bases.length : 0)
      if (r !== 'kept') this.primerCounts[r]++
    }
    if (f.flag & 0x4 || f.ref < 0 || f.cigar === '*') return
    if (f.ref >= this.refs.length) { this.otherReference++; return }
    const ref = f.ref
    const L = this.coverage[ref].length
    if (L === 0) { this.otherReference++; return }
    const mq = Math.min(60, Math.max(0, f.mapq === 255 ? 0 : f.mapq))
    if (primary) {
      this.mapped++
      this.mappedPerRef[ref]++
      this.mapq[mq]++
      if (f.flag & 0x2) {
        this.proper++
        const tlen = Math.abs(f.tlen)
        if (this.paired && f.flag & 0x40 && tlen > 0) this.inserts.set(tlen, (this.inserts.get(tlen) ?? 0) + 1)
      }
    } else this.supplementary++

    // Coverage: aligned bases (M, =, X), not deletions, as samtools depth counts.
    const circular = this.upper[ref].circular
    const cov = this.coverage[ref]
    const fwd = this.forward[ref]
    const forward = (f.flag & 0x10) === 0
    let pos = f.pos
    let n = 0
    const cigar = f.cigar
    for (let i = 0; i < cigar.length; i++) {
      const c = cigar.charCodeAt(i)
      if (c >= 48 && c <= 57) { n = n * 10 + c - 48; continue }
      const op = cigar[i]
      if (op === 'M' || op === '=' || op === 'X') {
        for (let k = 0; k < n; k++) {
          let p = pos + k
          if (p >= L) { if (!circular) break; p %= L }
          cov[p]++
          if (forward) fwd[p]++
        }
        pos += n
      } else if (op === 'D' || op === 'N') pos += n
      n = 0
    }

    const a = storeAlignment(this.upper[ref], f, read)
    if (a.mateRef >= 0 && a.mateRef < this.refs.length && a.matePos >= 0 && this.upper[a.mateRef].circular) {
      a.matePos %= this.coverage[a.mateRef].length || 1
    }
    if (a.end > L) this.overhang[ref] = Math.max(this.overhang[ref], a.end - L)
    const b = Math.min(this.buckets[ref].length - 1, Math.floor(a.start / this.spans[ref]))
    this.buckets[ref][b].recs.push(a)
    this.buffered += a.qual.length + a.diff.length + a.clipL.length + a.clipR.length + a.name.length + a.cigar.length + 64
    if (this.buffered >= this.spillBytes) await this.spill()
  }

  private async spill() {
    for (let r = 0; r < this.buckets.length; r++) {
      for (let b = 0; b < this.buckets[r].length; b++) {
        const bucket = this.buckets[r][b]
        if (bucket.recs.length === 0) continue
        await this.storage.put(this.tempId(r, b), bucket.parts++, encodePage(bucket.recs))
        bucket.recs = []
      }
    }
    this.buffered = 0
  }

  /** Sort and store everything; returns the report. */
  async finish(meta: Pick<MappingReport, 'preset' | 'program' | 'importedFrom'>, onProgress?: (done: number, total: number) => void): Promise<MappingReport> {
    const ids = mappingStorageIds(this.storageId)
    const index: MappingIndex = { version: 1, refs: [] }
    const total = this.bucketCount
    let done = 0
    let pageNo = 0
    const siteCounts: number[] = []
    for (let r = 0; r < this.refs.length; r++) {
      const ref = this.upper[r]
      const L = ref.bases.length
      const pileup = new PileupCounter(ref, ref.circular ? Math.min(L, this.overhang[r]) : 0)
      const pages: PageInfo[] = []
      let page: StoredAlignment[] = []
      let pageBases = 0
      const writePage = async () => {
        if (page.length === 0) return
        let maxEnd = 0
        for (const a of page) if (a.end > maxEnd) maxEnd = a.end
        pages.push({ index: pageNo, first: page[0].start, last: page[page.length - 1].start, maxEnd, count: page.length })
        await this.put(ids.pages, pageNo++, encodePage(page))
        page = []
        pageBases = 0
      }
      for (let b = 0; b < this.buckets[r].length; b++) {
        const bucket = this.buckets[r][b]
        let recs = bucket.recs
        bucket.recs = []
        if (bucket.parts > 0) {
          const all: StoredAlignment[] = []
          for (let p = 0; p < bucket.parts; p++) {
            const data = await this.storage.get(this.tempId(r, b), p)
            if (!data) throw new Error('Part of the alignments went missing from storage while they were sorted')
            for (const a of decodePage(data)) all.push(a)
          }
          for (const a of recs) all.push(a)
          recs = all
          await this.storage.remove([this.tempId(r, b)])
        }
        recs.sort((x, y) => x.start - y.start || x.end - y.end)
        for (const a of recs) {
          pileup.add(a)
          page.push(a)
          pageBases += a.qual.length || a.end - a.start
          if (page.length >= PAGE_ALIGNMENTS || pageBases >= PAGE_BASES) await writePage()
        }
        pileup.finishBelow((b + 1) * this.spans[r])
        onProgress?.(++done, total)
      }
      await writePage()
      index.refs.push({ pages })
      const sites = pileup.finish()
      siteCounts.push(sites.length)
      await this.put(ids.sites, r, encodeSites(sites))
      const cov = this.coverage[r]
      await this.put(ids.coverage, r, deflateSync(new Uint8Array(cov.buffer, cov.byteOffset, cov.byteLength), { level: 4 }))
      await this.put(ids.summary, r, encodeSummaries(summarizeCoverage(cov, this.forward[r])))
      await this.put(ids.reference, r, deflateSync(new TextEncoder().encode(ref.bases), { level: 4 }))
    }
    await this.put(ids.index, 0, deflateSync(new TextEncoder().encode(JSON.stringify(index)), { level: 4 }))
    return this.report(meta, pageNo, siteCounts)
  }

  /** Remove whatever was stored, after a failure or cancel. */
  async discard(): Promise<void> {
    const temp: string[] = []
    for (let r = 0; r < this.buckets.length; r++) for (let b = 0; b < this.buckets[r].length; b++) temp.push(this.tempId(r, b))
    await this.storage.remove([...temp, ...mappingStorageList(this.storageId)])
  }

  private report(meta: Pick<MappingReport, 'preset' | 'program' | 'importedFrom'>, pages: number, siteCounts: number[]): MappingReport {
    const references = this.refs.map((r, i): ReferenceReport => {
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
        binSize, coverageBins, sites: siteCounts[i] ?? 0,
      }
    })
    const paired = this.paired
    return {
      version: 2,
      ...meta,
      reads: this.reads,
      mapped: this.mapped,
      supplementary: this.supplementary,
      properlyPaired: paired ? (this.mapped ? this.proper / this.mapped : 0) : null,
      mapq: { edges: Array.from({ length: this.mapq.length + 1 }, (_, i) => i), counts: [...this.mapq] },
      insertSizes: paired ? insertHistogram(this.inserts) : null,
      references,
      pages,
      storedBytes: this.stored,
      skipped: { secondary: this.secondary, otherReference: this.otherReference },
      ...(this.primerSites ? { primers: { sites: this.primerSites.reduce((n, x) => n + x.length, 0), ...this.primerCounts } } : {}),
    }
  }
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
