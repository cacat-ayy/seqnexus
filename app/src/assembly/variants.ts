/**
 * Variants in a contig: where reads disagree with the reference (or, for a
 * de novo contig, with the consensus), how strongly, and what it does.
 *
 * For every column the reads' calls are counted as alleles (a gap is an
 * allele too; a mixed IUPAC call counts half for each base it stands for).
 * An allele other than the reference's is a variant when enough reads carry
 * it, it makes up enough of the coverage, and it is unlikely to be
 * sequencing error:
 *
 * - P-value: the chance that this many reads would show this allele by
 *   error alone, from each read's base quality (a Poisson-binomial tail).
 *   Lower is more certain.
 * - Strand bias: Fisher's exact test on forward and reverse reads. A
 *   variant seen only on one strand at a low p is often an artefact.
 *
 * Neighbouring gap columns carried by the same reads merge into one
 * insertion or deletion. Inside a coding feature of the reference a variant
 * gets its codon and protein change; inside a short tandem repeat it is
 * flagged, since polymerase slippage there mimics indels.
 */

import { baseBits } from '../msa/iupac'
import { complementBase } from '../models/complement'
import { translateCodon } from '../utils/codon'
import type { ContigDoc } from './types'
import { findTandemRepeats, type TandemRepeat } from './repeats'

export interface RefFeature {
  id: string
  name: string
  type: string
  start: number
  end: number
  strand: 1 | -1 | 0
  color?: string
}

export interface VariantSettings {
  minCoverage: number
  /** Share of covering reads that must carry the variant. */
  minFrequency: number
  /** Most a variant's P-value may be. */
  maxPValue: number
  codingOnly: boolean
  /** Drop variants whose strand-bias p is below 1e-5. */
  excludeStrandBias: boolean
}

export const DEFAULT_VARIANT_SETTINGS: VariantSettings = {
  minCoverage: 1,
  minFrequency: 0.25,
  maxPValue: 1e-4,
  codingOnly: false,
  excludeStrandBias: false,
}

export type VariantType = 'SNP' | 'Insertion' | 'Deletion'

export type Effect =
  | 'Synonymous' | 'Missense' | 'Nonsense' | 'Stop lost' | 'Start lost'
  | 'Frameshift' | 'In-frame insertion' | 'In-frame deletion'

export interface CodingChange {
  feature: string
  /** e.g. "c.134A>G" in the feature's own coordinates. */
  cdna: string
  /** e.g. "K45E", "K45fs", "K45_L46insQ". */
  protein: string
  effect: Effect
  codonFrom?: string
  codonTo?: string
}

export interface Variant {
  /** Columns spanned, half-open. */
  c0: number
  c1: number
  type: VariantType
  /** 1-based position in the reference (or consensus), the base before for an insertion. */
  position: number
  ref: string
  alt: string
  coverage: number
  /** Reads carrying the variant (mixed calls count half). */
  count: number
  frequency: number
  pValue: number
  strandBiasP: number
  forward: { ref: number; alt: number }
  reverse: { ref: number; alt: number }
  meanQuality: number
  features: string[]
  coding: CodingChange | null
  /** The tandem repeat it falls in, e.g. "(CA)7". */
  repeat: string | null
  /** Variant against the consensus rather than a reference. */
  againstConsensus: boolean
}

const PLAIN = ['A', 'C', 'G', 'T'] as const

interface Allele { count: number; fwd: number; rev: number; err: number[]; qual: number; rows: Set<string> }

/** Reference index (0-based, wrapped for a circular reference) of every column; -1 where the reference has a gap. */
export function referenceIndex(doc: ContigDoc): Int32Array {
  const out = new Int32Array(doc.width).fill(-1)
  if (!doc.reference) return out
  let n = 0
  for (let c = 0; c < doc.width; c++) if (doc.reference.seq[c] !== '-') out[c] = n++ % doc.reference.length
  return out
}

/** The reference bases themselves (without the circular extension). */
export function referenceBases(doc: ContigDoc): string {
  return doc.reference ? doc.reference.seq.replace(/-/g, '').slice(0, doc.reference.length) : ''
}

export function callVariants(
  doc: ContigDoc,
  consensus: string,
  features: readonly RefFeature[],
  s: VariantSettings,
): Variant[] {
  const W = doc.width
  const refIdx = referenceIndex(doc)
  const against = doc.reference ? doc.reference.seq : consensus
  const againstConsensus = !doc.reference
  const refSeq = doc.reference ? referenceBases(doc) : consensus.replace(/[- ]/g, '')
  const L = refSeq.length
  // Positions along what we compare against: reference index, or consensus base number.
  const posOf = new Int32Array(W).fill(-1)
  if (doc.reference) posOf.set(refIdx)
  else { let n = 0; for (let c = 0; c < W; c++) if (consensus[c] !== '-' && consensus[c] !== ' ') posOf[c] = n++ }

  const repeats = findTandemRepeats(refSeq)
  const repeatAt = (p: number): TandemRepeat | null => repeats.find(r => p >= r.start && p < r.end) ?? null

  // Per-column candidate (one alt allele per column: the strongest).
  interface Cand { col: number; ref: string; alt: string; allele: Allele; coverage: number; refAllele: Allele | null }
  const cands: Cand[] = []
  const rowsAt: { rowId: string; reversed: boolean; ch: string; q: number }[][] = Array.from({ length: W }, () => [])
  for (const r of doc.rows) {
    for (let k = 0; k < r.seq.length; k++) {
      const c = r.start + k
      if (c < 0 || c >= W) continue
      const ch = r.seq[k]
      const edited = ch !== r.orig[k]
      let q = edited ? 40 : r.qual[k]
      if (ch === '-') q = gapQuality(r.seq, r.qual, k)
      rowsAt[c].push({ rowId: r.id, reversed: r.reversed, ch, q: Math.max(1, q) })
    }
  }
  for (let c = 0; c < W; c++) {
    const reads = rowsAt[c]
    const refCh = against[c] ?? ' '
    if (reads.length === 0 || refCh === ' ') continue
    const alleles = new Map<string, Allele>()
    const add = (a: string, w: number, rd: (typeof reads)[number]) => {
      let x = alleles.get(a)
      if (!x) { x = { count: 0, fwd: 0, rev: 0, err: [], qual: 0, rows: new Set() }; alleles.set(a, x) }
      x.count += w
      if (rd.reversed) x.rev += w
      else x.fwd += w
      x.qual += rd.q * w
      x.err.push(Math.pow(10, -rd.q / 10))
      x.rows.add(rd.rowId)
    }
    for (const rd of reads) {
      if (rd.ch === '-') { add('-', 1, rd); continue }
      const bits = baseBits(rd.ch)
      const bases = PLAIN.filter((_, i) => bits & (1 << i))
      if (bases.length === 0) continue
      // N says nothing; a two-base code is a heterozygous call.
      if (bases.length > 2) continue
      for (const b of bases) add(b, 1 / bases.length, rd)
    }
    let best: [string, Allele] | null = null
    for (const [a, x] of alleles) {
      if (matchesRef(a, refCh)) continue
      if (!best || x.count > best[1].count) best = [a, x]
    }
    if (!best) continue
    cands.push({ col: c, ref: refCh, alt: best[0], allele: best[1], coverage: reads.length, refAllele: alleles.get(refCh) ?? null })
  }

  // Merge neighbouring gap columns carried by the same reads into one indel.
  const groups: Cand[][] = []
  for (const cand of cands) {
    const last = groups[groups.length - 1]
    const prev = last?.[last.length - 1]
    const kind = (x: Cand) => (x.ref === '-' ? 'ins' : x.alt === '-' ? 'del' : 'snp')
    if (prev && kind(prev) !== 'snp' && kind(prev) === kind(cand) && adjacent(prev.col, cand.col, against, kind(cand)) && sameRows(prev.allele.rows, cand.allele.rows)) last.push(cand)
    else groups.push([cand])
  }

  const out: Variant[] = []
  for (const g of groups) {
    const first = g[0]
    const last = g[g.length - 1]
    const type: VariantType = first.ref === '-' ? 'Insertion' : first.alt === '-' ? 'Deletion' : 'SNP'
    const coverage = Math.max(...g.map(x => x.coverage))
    const count = Math.min(...g.map(x => x.allele.count))
    const frequency = coverage ? count / coverage : 0
    const a = first.allele
    const pValue = poissonBinomialTail(a.err.map(e => (type === 'SNP' ? e / 3 : e)), Math.round(count))
    const refA = first.refAllele
    const forward = { ref: Math.round(refA?.fwd ?? 0), alt: Math.round(a.fwd) }
    const reverse = { ref: Math.round(refA?.rev ?? 0), alt: Math.round(a.rev) }
    const strandBiasP = fisherExact(forward.ref, forward.alt, reverse.ref, reverse.alt)
    // Position along the reference: an insertion is placed after the base before it.
    let p = posOf[first.col]
    if (type === 'Insertion') {
      let c = first.col
      while (c >= 0 && posOf[c] < 0) c--
      p = c >= 0 ? posOf[c] : -1
    }
    const ref = type === 'Insertion' ? '' : g.map(x => x.ref).join('')
    const alt = type === 'Deletion' ? '' : g.map(x => x.alt).join('')
    const refStart = type === 'Insertion' ? p + 1 : p
    const feats = features.filter(f => f.type !== 'source' && (type === 'Insertion' ? inFeature(f, Math.max(0, p), L) && inFeature(f, Math.min(L - 1, p + 1), L) : inFeature(f, p, L)))
    const coding = !againstConsensus ? codingChange(type, refStart, ref, alt, feats, refSeq) : null
    const rp = repeatAt(Math.max(0, type === 'Insertion' ? p : refStart)) ?? (type === 'Insertion' ? repeatAt(p + 1) : null)
    const v: Variant = {
      c0: first.col, c1: last.col + 1, type,
      position: p + 1, ref, alt, coverage, count, frequency, pValue, strandBiasP, forward, reverse,
      meanQuality: a.count ? a.qual / a.count : 0,
      features: feats.map(f => f.name),
      coding,
      repeat: rp ? `(${rp.unit})${rp.copies}` : null,
      againstConsensus,
    }
    if (coverage < s.minCoverage || frequency < s.minFrequency || pValue > s.maxPValue) continue
    if (s.codingOnly && !coding) continue
    if (s.excludeStrandBias && strandBiasP < 1e-5) continue
    out.push(v)
  }
  return out
}

function adjacent(prev: number, next: number, against: string, kind: string): boolean {
  if (next === prev + 1) return true
  // Deletions may be split by insertion columns of other reads.
  if (kind === 'del') { for (let c = prev + 1; c < next; c++) if (against[c] !== '-') return false; return true }
  return false
}

function sameRows(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

function gapQuality(seq: string, qual: readonly number[], k: number): number {
  let l = k - 1
  while (l >= 0 && seq[l] === '-') l--
  let r = k + 1
  while (r < seq.length && seq[r] === '-') r++
  const ql = l >= 0 ? qual[l] : 0
  const qr = r < seq.length ? qual[r] : 0
  return Math.min(ql || qr, qr || ql)
}

/** An allele the reference (or an ambiguous consensus) already stands for. */
function matchesRef(a: string, refCh: string): boolean {
  if (a === refCh) return true
  if (a === '-' || refCh === '-') return false
  const ab = baseBits(a)
  return ab !== 0 && (ab & baseBits(refCh)) === ab
}

export function inFeature(f: RefFeature, p: number, L: number): boolean {
  if (p < 0) return false
  void L
  return f.start <= f.end ? p >= f.start && p < f.end : p >= f.start || p < f.end
}

const CODING = new Set(['CDS', 'ORF'])

function featureLength(f: RefFeature, L: number): number {
  return f.start <= f.end ? f.end - f.start : L - f.start + f.end
}

/** The codon and protein change of a variant inside a coding feature. */
export function codingChange(type: VariantType, refStart: number, ref: string, alt: string, feats: readonly RefFeature[], refSeq: string): CodingChange | null {
  const f = feats.find(x => CODING.has(x.type) && x.strand !== 0)
  if (!f || refStart < 0) return null
  const L = refSeq.length
  const len = featureLength(f, L)
  const at = (i: number) => refSeq[((i % L) + L) % L]
  // Offset of the variant within the feature, 5'→3' on the feature's strand.
  const offsetOf = (p: number) => (f.strand === 1 ? ((p - f.start) % L + L) % L : ((f.end - 1 - p) % L + L) % L)
  // The feature's coding sequence, 5'→3'.
  const cds = (i: number) => (f.strand === 1 ? at(f.start + i) : complementBase(at(f.end - 1 - i)))
  const aaAt = (codon: number) => translateCodon(cds(codon * 3) + cds(codon * 3 + 1) + cds(codon * 3 + 2))
  const strandBase = (b: string) => (f.strand === 1 ? b : complementBase(b))

  if (type === 'SNP') {
    const off = offsetOf(refStart)
    if (off >= len) return null
    const codon = Math.floor(off / 3)
    const j = off % 3
    const from = cds(codon * 3) + cds(codon * 3 + 1) + cds(codon * 3 + 2)
    const to = from.slice(0, j) + strandBase(alt) + from.slice(j + 1)
    const aaFrom = translateCodon(from)
    const aaTo = translateCodon(to)
    const effect: Effect = aaFrom === aaTo ? 'Synonymous'
      : aaTo === '*' ? 'Nonsense'
      : aaFrom === '*' ? 'Stop lost'
      : codon === 0 && aaFrom === 'M' ? 'Start lost'
      : 'Missense'
    return {
      feature: f.name,
      cdna: `c.${off + 1}${strandBase(ref)}>${strandBase(alt)}`,
      protein: `${aaFrom}${codon + 1}${aaTo}`,
      effect, codonFrom: from, codonTo: to,
    }
  }
  // Indels: the codon where the change starts.
  const n = type === 'Insertion' ? alt.length : ref.length
  const startOff = type === 'Insertion'
    ? (f.strand === 1 ? offsetOf(refStart - 1) + 1 : offsetOf(refStart))
    : (f.strand === 1 ? offsetOf(refStart) : offsetOf(refStart + n - 1))
  if (startOff < 0 || startOff > len) return null
  const codon = Math.floor(startOff / 3)
  const aa = codon * 3 + 2 < len ? aaAt(codon) : '?'
  const frame = n % 3 !== 0
  const effect: Effect = frame ? 'Frameshift' : type === 'Insertion' ? 'In-frame insertion' : 'In-frame deletion'
  const seq = type === 'Insertion' ? (f.strand === 1 ? alt : [...alt].reverse().map(complementBase).join('')) : ''
  return {
    feature: f.name,
    cdna: type === 'Insertion' ? `c.${startOff}_${startOff + 1}ins${seq}` : `c.${startOff + 1}${n > 1 ? `_${startOff + n}` : ''}del`,
    protein: frame ? `${aa}${codon + 1}fs` : type === 'Insertion' ? `${aa}${codon + 1}ins${n / 3}` : `${aa}${codon + 1}del${n / 3}`,
    effect,
  }
}

/** P(at least k of the events happen) for independent events with probabilities p. */
export function poissonBinomialTail(p: readonly number[], k: number): number {
  if (k <= 0) return 1
  if (k > p.length) return 0
  let dist = new Float64Array(p.length + 1)
  dist[0] = 1
  for (let i = 0; i < p.length; i++) {
    const next = new Float64Array(p.length + 1)
    for (let j = 0; j <= i; j++) {
      next[j] += dist[j] * (1 - p[i])
      next[j + 1] += dist[j] * p[i]
    }
    dist = next
  }
  let tail = 0
  for (let j = k; j <= p.length; j++) tail += dist[j]
  return Math.min(1, Math.max(0, tail))
}

const logFact = (() => {
  const t = [0]
  for (let i = 1; i <= 2000; i++) t.push(t[i - 1] + Math.log(i))
  return (n: number) => (n <= 2000 ? t[n] : n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n))
})()

/** Two-sided Fisher's exact test for the table [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d
  if (n === 0) return 1
  const r1 = a + b
  const c1 = a + c
  const pOf = (x: number) => Math.exp(
    logFact(r1) + logFact(n - r1) + logFact(c1) + logFact(n - c1)
    - logFact(n) - logFact(x) - logFact(r1 - x) - logFact(c1 - x) - logFact(n - r1 - c1 + x),
  )
  const observed = pOf(a)
  let p = 0
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) {
    const px = pOf(x)
    if (px <= observed * (1 + 1e-9)) p += px
  }
  return Math.min(1, p)
}

/** Variants as CSV, one row each. */
export function variantsCsv(vs: readonly Variant[]): string {
  const head = ['Position', 'Type', 'Reference', 'Variant', 'Frequency', 'Coverage', 'Reads with variant', 'P-value', 'Strand bias P', 'Forward ref/alt', 'Reverse ref/alt', 'Mean quality', 'Features', 'cDNA change', 'Protein change', 'Effect', 'Tandem repeat']
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const rows = vs.map(v => [
    String(v.position), v.type, v.ref || '-', v.alt || '-', v.frequency.toFixed(3), String(v.coverage), v.count.toFixed(1).replace(/\.0$/, ''),
    v.pValue.toExponential(2), v.strandBiasP.toPrecision(3), `${v.forward.ref}/${v.forward.alt}`, `${v.reverse.ref}/${v.reverse.alt}`,
    v.meanQuality.toFixed(1), v.features.join('; '), v.coding?.cdna ?? '', v.coding?.protein ?? '', v.coding?.effect ?? '', v.repeat ?? '',
  ].map(q).join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}

/** A short label for a variant: "A>G", "insT", "delCA". */
export function variantLabel(v: Variant): string {
  if (v.type === 'SNP') return `${v.ref}>${v.alt}`
  return v.type === 'Insertion' ? `ins${v.alt}` : `del${v.ref}`
}
