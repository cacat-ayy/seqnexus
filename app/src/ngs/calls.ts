/**
 * Variants in an NGS mapping.
 *
 * While a mapping is stored, every position where something other than the
 * reference shows up often enough is kept as a candidate site (pileup.ts).
 * Calling starts from those sites: the pages over them are read once, in
 * order, and at each site every read is counted again in full: its base and
 * the base's quality, a deletion that starts there (with its length), an
 * insertion after it (with its bases), its strand. Pages with no site in
 * their stretch are not read at all, so a clean genome calls quickly. The
 * counts are stored with the mapping, so the variant table opens at once
 * the next time; thresholds are applied live on top (assembly/variants.ts).
 *
 * As samtools mpileup counts: bases below Q13 are left out of the site
 * (alleles and depth); deletions and insertions count whatever the quality;
 * a read whose deletion runs across a site counts in its depth but for no
 * base there.
 *
 * Each site gives at most one variant of each kind: the strongest base other
 * than the reference's, the strongest deletion starting there, the strongest
 * insertion after it. Their P-value is the chance of seeing that many reads
 * with it by error alone, a Poisson tail (variants.ts): for a base, with as
 * many error reads expected as the base qualities say (their error chances
 * summed, a third of them for one particular wrong base); for an indel, with
 * a fixed per-read indel error rate for the technology, since base
 * qualities say little about indels.
 */

import { deflateSync, inflateSync } from 'fflate'
import { decodePage, type StoredAlignment } from './alignments'
import { mappingStorageIds, type MappingStorage } from './builder'
import { decodeSites, MIN_BASE_QUALITY } from './pileup'
import { readMappingIndex, readReferenceBases } from './sam'
import type { Technology } from './types'
import type { MapPreset } from './mapper'
import {
  describeVariant, poissonTail, type AlleleCount, type RefFeature, type Variant, type VariantEvidence, type VariantPreset,
} from '../assembly/variants'

/** One recounted site. */
export interface SiteCall {
  pos: number
  /** Reads counted at the site: bases of Q13 or better, and deletions across it. */
  depth: number
  /** Expected number of wrong base calls among the bases counted (their error chances summed). */
  errSum: number
  /** Alleles: "A".."T", "N", "-SEQ" (a deletion of SEQ starting here), "+SEQ" (inserted after this base). */
  alleles: { a: string; f: number; r: number; q: number }[]
}

/** Per-read chance of an indel at any one position, by technology. */
export const INDEL_ERROR: Record<Technology, number> = {
  illumina: 1e-4,
  nanopore: 0.03,
  pacbio: 1e-3,
  other: 0.01,
}

/** Error chance of a base with no quality (an imported file without qualities). */
const NO_QUALITY_ERROR = 0.01

export function technologyOfPreset(preset: MapPreset | null): Technology {
  return preset === 'sr' ? 'illumina' : preset === 'map-ont' ? 'nanopore' : preset === 'map-hifi' ? 'pacbio' : 'other'
}

export function variantPresetOf(t: Technology): VariantPreset {
  return t === 'nanopore' ? 'nanopore' : t === 'pacbio' ? 'pacbio' : 'illumina'
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

interface Acc {
  depth: number
  errSum: number
  alleles: Map<string, { f: number; r: number; q: number }>
}

function bump(acc: Acc, a: string, rev: boolean, q: number) {
  let x = acc.alleles.get(a)
  if (!x) { x = { f: 0, r: 0, q: 0 }; acc.alleles.set(a, x) }
  if (rev) x.r++
  else x.f++
  x.q += q
}

/**
 * Count one alignment at the sites it covers. `sp` holds the site positions
 * in order, extended past the reference's end on a circular one (site + L),
 * so an alignment across the origin finds the sites at its start; `accs`
 * runs parallel to it.
 */
export function countAlignment(a: StoredAlignment, ref: string, sp: Int32Array, accs: readonly Acc[]): void {
  const d = a.diff
  if (d === '*') return
  // First site at or after the alignment's start (one before, for an insertion right at the start).
  let lo = 0
  let hi = sp.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sp[m] < a.start) lo = m + 1; else hi = m }
  if (lo >= sp.length || sp[lo] >= a.end) return
  const L = ref.length
  const rev = (a.flag & 0x10) !== 0
  const q = a.qual
  const qualAt = (i: number) => (q.length ? q.charCodeAt(i) - 33 : -1)
  const errOf = (qq: number) => (qq < 0 ? NO_QUALITY_ERROR : 10 ** (-qq / 10))
  const base = (k: number, b: string, qq: number) => {
    if (qq >= 0 && qq < MIN_BASE_QUALITY) return
    const acc = accs[k]
    acc.depth++
    acc.errSum += errOf(qq)
    bump(acc, b, rev, Math.max(0, qq))
  }
  let k = lo
  let p = a.start
  let qp = a.clipL.length
  let i = 0
  while (i < d.length) {
    // Past the last site only an insertion right after it can still count.
    if (k >= sp.length && d[i] !== '+') break
    const op = d[i++]
    if (op === ':' || op === '~') {
      let n = 0
      while (i < d.length && d.charCodeAt(i) >= 48 && d.charCodeAt(i) <= 57) n = n * 10 + d.charCodeAt(i++) - 48
      if (op === ':') {
        while (k < sp.length && sp[k] < p + n) {
          if (sp[k] >= p) base(k, ref[sp[k] % L].toUpperCase(), qualAt(qp + sp[k] - p))
          k++
        }
        qp += n
      } else while (k < sp.length && sp[k] < p + n) k++
      p += n
    } else if (op === '*') {
      while (k < sp.length && sp[k] < p) k++
      if (k < sp.length && sp[k] === p) { base(k, d[i + 1].toUpperCase(), qualAt(qp)); k++ }
      i += 2
      p++
      qp++
    } else {
      let j = i
      while (j < d.length && d.charCodeAt(j) >= 97 && d.charCodeAt(j) <= 122) j++
      const seq = d.slice(i, j).toUpperCase()
      if (op === '+') {
        // Inserted after base p - 1: the site just passed, if there is one.
        if (k > 0 && sp[k - 1] === p - 1 && p > a.start) {
          let lowQ = q.length ? 99 : -1
          for (let t = 0; t < seq.length && q.length; t++) lowQ = Math.min(lowQ, qualAt(qp + t))
          bump(accs[k - 1], '+' + seq, rev, Math.max(0, lowQ))
        }
        qp += seq.length
      } else {
        while (k < sp.length && sp[k] < p) k++
        if (k < sp.length && sp[k] === p) bump(accs[k], '-' + seq, rev, 0)
        while (k < sp.length && sp[k] < p + seq.length) { accs[k].depth++; k++ }
        p += seq.length
      }
      i = j
    }
  }
}

/** Sites in order, with their counts, as the caller and consensus read them. */
export function finishSites(sp: Int32Array, accs: readonly Acc[], L: number): SiteCall[] {
  // Fold the copies past a circular reference's end back onto their sites.
  const byPos = new Map<number, Acc>()
  for (let k = 0; k < sp.length; k++) {
    const pos = sp[k] % L
    const acc = accs[k]
    const into = byPos.get(pos)
    if (!into) { byPos.set(pos, acc); continue }
    into.depth += acc.depth
    into.errSum += acc.errSum
    for (const [a, x] of acc.alleles) {
      const y = into.alleles.get(a)
      if (y) { y.f += x.f; y.r += x.r; y.q += x.q } else into.alleles.set(a, { ...x })
    }
  }
  return [...byPos.entries()]
    .sort((x, y) => x[0] - y[0])
    .filter(([, acc]) => acc.depth > 0 || acc.alleles.size > 0)
    .map(([pos, acc]) => ({
      pos,
      depth: acc.depth,
      errSum: acc.errSum,
      alleles: [...acc.alleles.entries()].map(([a, x]) => ({ a, ...x })).sort((x, y) => y.f + y.r - (x.f + x.r)),
    }))
}

export function newAccs(n: number): Acc[] {
  return Array.from({ length: n }, () => ({ depth: 0, errSum: 0, alleles: new Map() }))
}

/** Site positions to look for, extended past the end of a circular reference by the longest overhang. */
export function sitePositions(sites: readonly number[], L: number, circular: boolean, overhang: number): Int32Array {
  const ext = circular ? sites.filter(p => p < overhang).map(p => p + L) : []
  return Int32Array.from([...sites, ...ext])
}

export function encodeCalls(calls: readonly SiteCall[]): Uint8Array {
  const compact = calls.map(c => [c.pos, c.depth, Number(c.errSum.toPrecision(5)), c.alleles.map(a => [a.a, a.f, a.r, a.q])])
  return deflateSync(new TextEncoder().encode(JSON.stringify(compact)), { level: 4 })
}

export function decodeCalls(data: Uint8Array): SiteCall[] {
  const raw = JSON.parse(new TextDecoder().decode(inflateSync(data))) as [number, number, number, [string, number, number, number][]][]
  return raw.map(([pos, depth, errSum, al]) => ({ pos, depth, errSum, alleles: al.map(([a, f, r, q]) => ({ a, f, r, q })) }))
}

/**
 * Recount every candidate site of a stored mapping and store the counts
 * (under the mapping's `calls` id, one entry per reference).
 */
export async function callMapping(o: {
  storageId: string
  storage: Pick<MappingStorage, 'get' | 'put'>
  references: readonly { name: string; length: number; circular: boolean }[]
  onProgress?: (done: number, total: number) => void
}): Promise<{ sites: number }> {
  const ids = mappingStorageIds(o.storageId)
  const index = await readMappingIndex(o.storage, o.storageId)
  const plan = await Promise.all(o.references.map(async (ref, r) => {
    const data = await o.storage.get(ids.sites, r)
    const sites = data ? decodeSites(data).map(s => s.pos) : []
    const pages = index.refs[r]?.pages ?? []
    let overhang = 0
    for (const pg of pages) overhang = Math.max(overhang, pg.maxEnd - ref.length)
    // In order: the sites, then their copies past the end (all at L or more).
    const sp = sitePositions(sites, ref.length, ref.circular, overhang)
    // Only the pages with a site in their stretch.
    const has = (s: number, e: number) => {
      let lo = 0
      let hi = sp.length
      while (lo < hi) { const m = (lo + hi) >> 1; if (sp[m] < s) lo = m + 1; else hi = m }
      return lo < sp.length && sp[lo] < e
    }
    return { r, sp, pages: pages.filter(pg => has(pg.first, pg.maxEnd)) }
  }))
  const total = plan.reduce((n, p) => n + p.pages.length, 0)
  let done = 0
  let count = 0
  o.onProgress?.(0, total)
  for (const { r, sp, pages } of plan) {
    const ref = (await readReferenceBases(o.storage, o.storageId, r)).toUpperCase()
    const accs = newAccs(sp.length)
    for (const pg of pages) {
      const data = await o.storage.get(ids.pages, pg.index)
      if (!data) throw new Error('Part of the mapping is missing from this browser\'s storage')
      for (const a of decodePage(data)) countAlignment(a, ref, sp, accs)
      o.onProgress?.(++done, total)
    }
    const calls = finishSites(sp, accs, ref.length || 1)
    count += calls.length
    await o.storage.put(ids.calls, r, encodeCalls(calls))
  }
  return { sites: count }
}

// ---------------------------------------------------------------------------
// Variants and consensus
// ---------------------------------------------------------------------------

const PLAIN = new Set(['A', 'C', 'G', 'T'])

/** Every candidate variant at the recounted sites of one reference. */
export function siteVariants(calls: readonly SiteCall[], refSeq: string, features: readonly RefFeature[], technology: Technology): Variant[] {
  const ctx = { refSeq, features, againstConsensus: false }
  const out: Variant[] = []
  const indelRate = INDEL_ERROR[technology]
  for (const site of calls) {
    const refB = refSeq[site.pos]?.toUpperCase() ?? 'N'
    const refA = site.alleles.find(a => a.a === refB)
    const alleles: AlleleCount[] = site.alleles.map(a => ({
      allele: a.a, forward: a.f, reverse: a.r,
      meanQuality: a.a[0] === '-' ? -1 : (a.f + a.r ? a.q / (a.f + a.r) : 0),
      isRef: a.a === refB,
    }))
    const strongest = (test: (a: string) => boolean) => site.alleles.find(a => test(a.a))
    const base = (x: SiteCall['alleles'][number], ev: Omit<VariantEvidence, 'coverage' | 'count' | 'forward' | 'reverse' | 'meanQuality' | 'alleles'>, meanQuality: number) => {
      const n = x.f + x.r
      out.push(describeVariant({
        ...ev,
        coverage: site.depth,
        count: n,
        forward: { ref: refA?.f ?? 0, alt: x.f },
        reverse: { ref: refA?.r ?? 0, alt: x.r },
        meanQuality,
        alleles,
      }, ctx))
    }
    const snv = strongest(a => PLAIN.has(a) && a !== refB)
    if (snv) {
      const n = snv.f + snv.r
      base(snv, { c0: site.pos, c1: site.pos + 1, type: 'SNP', pos: site.pos, ref: refB, alt: snv.a, pValue: poissonTail(site.errSum / 3, n) }, n ? snv.q / n : 0)
    }
    const del = strongest(a => a[0] === '-')
    if (del) {
      const seq = del.a.slice(1)
      base(del, { c0: site.pos, c1: site.pos + seq.length, type: 'Deletion', pos: site.pos, ref: seq, alt: '', pValue: poissonTail(site.depth * indelRate, del.f + del.r) }, -1)
    }
    const ins = strongest(a => a[0] === '+')
    if (ins) {
      const n = ins.f + ins.r
      base(ins, { c0: site.pos, c1: site.pos + 1, type: 'Insertion', pos: site.pos, ref: '', alt: ins.a.slice(1), pValue: poissonTail(site.depth * indelRate, n) }, n ? ins.q / n : 0)
    }
  }
  return out
}

export interface ConsensusSettings {
  /** Share of the reads the called alleles must reach together (ivar's -t). */
  threshold: number
  /** Positions covered by fewer reads become N (ivar's -m). */
  minDepth: number
  /** Where no single base reaches the threshold, write the IUPAC code of the bases needed; else the commonest base. */
  iupac: boolean
}

export const DEFAULT_CONSENSUS_SETTINGS: ConsensusSettings = { threshold: 0.5, minDepth: 10, iupac: true }

const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', AG: 'R', CT: 'Y', CG: 'S', AT: 'W', GT: 'K', AC: 'M',
  CGT: 'B', AGT: 'D', ACT: 'H', ACG: 'V', ACGT: 'N',
}

/**
 * The sample's sequence, as ivar consensus builds it: the reference where
 * the reads agree with it, the reads' alleles at the recounted sites, and N
 * where fewer than minDepth reads cover. At a site the alleles are taken in
 * order of how many reads show them until together they reach the
 * threshold: one base is written as itself, several as their IUPAC code;
 * when the commonest is a deletion the bases are left out, and an insertion
 * shown by at least the threshold share of the reads is written in. Away
 * from the sites at least 95% of the counted reads match the reference (the
 * sites are where 5% did not), so the reference base stands there for any
 * threshold up to 0.95.
 */
export function siteConsensus(refSeq: string, coverage: ArrayLike<number> | null, calls: readonly SiteCall[], s: ConsensusSettings): { bases: string; masked: number; changed: number } {
  const L = refSeq.length
  const out: string[] = new Array(L)
  let masked = 0
  // Per-base coverage counts aligned bases only; at a site the depth counts the reads deleting it too,
  // so a base most reads delete is not mistaken for one few reads cover.
  const siteDepth = new Map<number, number>()
  for (const c of calls) siteDepth.set(c.pos, c.depth)
  for (let p = 0; p < L; p++) {
    const low = coverage ? Math.max(coverage[p], siteDepth.get(p) ?? 0) < s.minDepth : false
    out[p] = low ? 'N' : refSeq[p].toUpperCase()
    if (low) masked++
  }
  let changed = 0
  let deletedUntil = -1
  for (const site of calls) {
    const p = site.pos
    if (p <= deletedUntil || out[p] === 'N') continue
    const total = site.depth
    if (total <= 0) continue
    const opts = site.alleles.filter(a => PLAIN.has(a.a) || a.a[0] === '-').map(a => ({ a: a.a, n: a.f + a.r })).sort((x, y) => y.n - x.n)
    const picked: string[] = []
    let cum = 0
    for (const o of opts) {
      picked.push(o.a)
      cum += o.n
      if (cum >= s.threshold * total) break
    }
    if (cum < s.threshold * total) continue
    const before = out[p]
    if (picked[0][0] === '-') {
      const n = picked[0].length - 1
      for (let k = 0; k < n && p + k < L; k++) out[p + k] = ''
      deletedUntil = p + n - 1
      changed++
      continue
    }
    const bases = picked.filter(a => a[0] !== '-')
    const key = [...new Set(bases)].sort().join('')
    out[p] = bases.length === 1 ? bases[0] : s.iupac ? IUPAC[key] ?? 'N' : bases[0]
    const ins = site.alleles.find(a => a.a[0] === '+')
    if (ins && (ins.f + ins.r) >= s.threshold * total) out[p] += ins.a.slice(1)
    if (out[p] !== before) changed++
  }
  return { bases: out.join(''), masked, changed }
}
