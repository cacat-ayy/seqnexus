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
 * gets its codon and protein change (effects.ts); inside a short tandem repeat it is
 * flagged, since polymerase slippage there mimics indels, and an indel in a
 * run of one base (a homopolymer) is flagged with the run's length, since
 * that is where Nanopore reads miscount bases.
 *
 * Shared with NGS mappings (ngs/calls.ts): each caller gathers its
 * VariantEvidence (where, what, how many reads, how likely by error alone)
 * its own way, and describeVariant turns evidence into a Variant the same
 * way for both. Calling and judging are separate: evaluate* returns every
 * candidate, and variantFilters says which settings one fails, so a table
 * can change thresholds live and VCF can name the filters a variant failed.
 */

import { baseBits } from '../msa/iupac'
import type { ContigDoc } from './types'
import { findTandemRepeats, type TandemRepeat } from './repeats'
import { codingChanges, codingSummary, type CodingChange } from './effects'
import { csvCell } from '../utils/csv-cell'

export interface RefFeature {
  id: string
  name: string
  type: string
  start: number
  end: number
  strand: 1 | -1 | 0
  color?: string
  /** NCBI genetic code of a coding feature (its /transl_table), when it names one. */
  code?: number
  /** Bases before the first codon (/codon_start minus 1). */
  frame?: number
  /** Exons of a spliced feature in sequence order, as in Annotation.segments. */
  segments?: [number, number][]
}

export interface VariantSettings {
  minCoverage: number
  /** Share of covering reads that must carry the variant. */
  minFrequency: number
  /** Most a variant's P-value may be. */
  maxPValue: number
  codingOnly: boolean
  /** Drop variants whose strand-bias p is below STRAND_BIAS_P. */
  excludeStrandBias: boolean
  /** Fewest reads that must carry the variant. */
  minAltReads: number
  /** Drop insertions and deletions in a run of one base at least homopolymerLength long. */
  excludeHomopolymerIndels: boolean
  homopolymerLength: number
}

export const DEFAULT_VARIANT_SETTINGS: VariantSettings = {
  minCoverage: 1,
  minFrequency: 0.25,
  maxPValue: 1e-4,
  codingOnly: false,
  excludeStrandBias: false,
  minAltReads: 0,
  excludeHomopolymerIndels: false,
  homopolymerLength: 4,
}

/** A strand-bias p below this marks a variant seen (almost) only on one strand. */
export const STRAND_BIAS_P = 1e-5

export type VariantPreset = 'sanger' | 'illumina' | 'nanopore' | 'pacbio'

export const PRESET_NAME: Record<VariantPreset, string> = {
  sanger: 'Sanger',
  illumina: 'Illumina',
  nanopore: 'Nanopore',
  pacbio: 'PacBio HiFi',
}

/**
 * Starting thresholds for each kind of read. Deep NGS data can ask for more
 * reads and a lower P-value than a handful of Sanger reads. Illumina's
 * artefacts are often on one strand, so strand-biased calls are left out.
 * Nanopore reads miscount the bases of homopolymer runs, so insertions and
 * deletions in a run of four or more are left out, and a higher frequency
 * is asked for. HiFi reads are accurate enough for Illumina-like settings,
 * with strand bias kept (HiFi reads both strands of one molecule).
 */
export const VARIANT_PRESETS: Record<VariantPreset, VariantSettings> = {
  sanger: DEFAULT_VARIANT_SETTINGS,
  illumina: { minCoverage: 10, minFrequency: 0.2, maxPValue: 1e-6, codingOnly: false, excludeStrandBias: true, minAltReads: 3, excludeHomopolymerIndels: false, homopolymerLength: 6 },
  nanopore: { minCoverage: 10, minFrequency: 0.3, maxPValue: 1e-6, codingOnly: false, excludeStrandBias: false, minAltReads: 5, excludeHomopolymerIndels: true, homopolymerLength: 4 },
  pacbio: { minCoverage: 5, minFrequency: 0.2, maxPValue: 1e-6, codingOnly: false, excludeStrandBias: false, minAltReads: 3, excludeHomopolymerIndels: false, homopolymerLength: 6 },
}

export type VariantType = 'SNP' | 'Insertion' | 'Deletion'

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
  /** What it does to the coding feature it hurts most (effects.ts). */
  coding: CodingChange | null
  /** What it does to any other coding features it is in (overlapping genes, a CDS and an ORF), most severe first. */
  otherCoding: CodingChange[]
  /** The tandem repeat it falls in, e.g. "(CA)7". */
  repeat: string | null
  /** An insertion or deletion of one base kind next to or inside a run of it: the run's length in the reference. */
  homopolymer: number | null
  /** Variant against the consensus rather than a reference. */
  againstConsensus: boolean
  /** Every allele seen at the site (NGS), for the evidence card. */
  alleles?: AlleleCount[]
  /** NGS on a circular reference: reads counted here that reached the site across the origin. */
  acrossOrigin?: number
}

/** One allele at a site: "A", "-CA" (those bases deleted), "+TT" (inserted after the base). */
export interface AlleleCount {
  allele: string
  forward: number
  reverse: number
  /** Mean base quality of the reads showing it; -1 when there is none (deletions). */
  meanQuality: number
  isRef: boolean
}

/** What a caller found at one variant, before it is described and judged. */
export interface VariantEvidence {
  /** Columns (Sanger) or reference positions (NGS) it spans, half-open, for marking it. */
  c0: number
  c1: number
  type: VariantType
  /** 0-based: the first reference base changed, or for an insertion the base before it (-1 before the first). */
  pos: number
  ref: string
  alt: string
  coverage: number
  count: number
  pValue: number
  forward: { ref: number; alt: number }
  reverse: { ref: number; alt: number }
  meanQuality: number
  alleles?: AlleleCount[]
  acrossOrigin?: number
}

export interface VariantContext {
  /** What positions are counted along: the reference's bases, or the consensus. */
  refSeq: string
  features: readonly RefFeature[]
  againstConsensus: boolean
  /** A circular reference: a coding feature reads on across its origin. */
  circular?: boolean
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

/** Every candidate variant in a contig, before the settings are applied. */
export function evaluateVariants(
  doc: ContigDoc,
  consensus: string,
  features: readonly RefFeature[],
): Variant[] {
  const W = doc.width
  const refIdx = referenceIndex(doc)
  const against = doc.reference ? doc.reference.seq : consensus
  const againstConsensus = !doc.reference
  const refSeq = doc.reference ? referenceBases(doc) : consensus.replace(/[- ]/g, '')
  // Positions along what we compare against: reference index, or consensus base number.
  const posOf = new Int32Array(W).fill(-1)
  if (doc.reference) posOf.set(refIdx)
  else { let n = 0; for (let c = 0; c < W; c++) if (consensus[c] !== '-' && consensus[c] !== ' ') posOf[c] = n++ }

  const ctx: VariantContext = { refSeq, features, againstConsensus, circular: doc.reference?.circular ?? false }

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
    const a = first.allele
    const pValue = poissonBinomialTail(a.err.map(e => (type === 'SNP' ? e / 3 : e)), Math.round(count))
    const refA = first.refAllele
    // Position along the reference: an insertion is placed after the base before it.
    let p = posOf[first.col]
    if (type === 'Insertion') {
      let c = first.col
      while (c >= 0 && posOf[c] < 0) c--
      p = c >= 0 ? posOf[c] : -1
    }
    // A mixed call counts half for each base. The whole-read counts VCF
    // needs (DP4, AD) are rounded so that they add up: the variant reads
    // first, the reference reads within what is left of the coverage, each
    // split by strand so the strands add up to the total. Two reads calling
    // Y are one reference read and one variant read, not two of each.
    const altTotal = Math.min(coverage, Math.round(a.count))
    const refTotal = Math.min(coverage - altTotal, Math.round(refA?.count ?? 0))
    const altFwd = Math.min(altTotal, Math.round(a.fwd))
    const refFwd = Math.min(refTotal, Math.round(refA?.fwd ?? 0))
    out.push(describeVariant({
      c0: first.col, c1: last.col + 1, type, pos: p,
      ref: type === 'Insertion' ? '' : g.map(x => x.ref).join(''),
      alt: type === 'Deletion' ? '' : g.map(x => x.alt).join(''),
      coverage, count, pValue,
      forward: { ref: refFwd, alt: altFwd },
      reverse: { ref: refTotal - refFwd, alt: altTotal - altFwd },
      meanQuality: a.count ? a.qual / a.count : 0,
    }, ctx))
  }
  return out
}

/** Variants that pass the settings. */
export function callVariants(doc: ContigDoc, consensus: string, features: readonly RefFeature[], s: VariantSettings): Variant[] {
  return evaluateVariants(doc, consensus, features).filter(v => variantFilters(v, s).length === 0)
}

/**
 * A variant from its evidence: its position, the features it is in, its
 * codon and protein change, strand bias, and the repeat or homopolymer it
 * sits in.
 */
export function describeVariant(ev: VariantEvidence, ctx: VariantContext): Variant {
  const { type, pos: p, ref, alt } = ev
  const refSeq = ctx.refSeq
  const L = refSeq.length
  const refStart = type === 'Insertion' ? p + 1 : p
  // Not the whole-sequence source feature, nor variation features (variants
  // saved to the reference earlier). A deletion is in every feature it
  // touches, so one that takes out a start codon from before it counts.
  const touches = (f: RefFeature) => {
    if (type === 'Insertion') return inFeature(f, Math.max(0, p), L) && inFeature(f, Math.min(L - 1, p + 1), L)
    for (let k = 0; k < Math.max(1, ref.length); k++) if (inFeature(f, ctx.circular ? (p + k) % L : p + k, L)) return true
    return false
  }
  const feats = ctx.features.filter(f => f.type !== 'source' && f.type !== 'variation' && touches(f))
  const [coding = null, ...otherCoding] = ctx.againstConsensus ? [] : codingChanges(type, refStart, ref, alt, feats, refSeq, ctx.circular)
  const rp = repeatAround(refSeq, Math.max(0, type === 'Insertion' ? p : refStart)) ?? (type === 'Insertion' ? repeatAround(refSeq, p + 1) : null)
  return {
    c0: ev.c0, c1: ev.c1, type,
    position: p + 1, ref, alt,
    coverage: ev.coverage, count: ev.count, frequency: ev.coverage ? ev.count / ev.coverage : 0,
    pValue: ev.pValue,
    strandBiasP: fisherExact(ev.forward.ref, ev.forward.alt, ev.reverse.ref, ev.reverse.alt),
    forward: ev.forward, reverse: ev.reverse,
    meanQuality: ev.meanQuality,
    features: feats.map(f => f.name),
    coding,
    otherCoding,
    repeat: rp ? `(${rp.unit})${rp.copies}` : null,
    homopolymer: type === 'SNP' ? null : homopolymerRun(refSeq, type, p, type === 'Insertion' ? alt : ref),
    againstConsensus: ctx.againstConsensus,
    ...(ev.alleles ? { alleles: ev.alleles } : {}),
    ...(ev.acrossOrigin ? { acrossOrigin: ev.acrossOrigin } : {}),
  }
}

/**
 * The tandem repeat around reference position p, looked for in 200 bases
 * around it (enough for any repeat that matters to an indel call), so a
 * genome need not be scanned whole for a few thousand variants.
 */
export function repeatAround(refSeq: string, p: number): TandemRepeat | null {
  if (p < 0 || p >= refSeq.length) return null
  const from = Math.max(0, p - 100)
  const hit = findTandemRepeats(refSeq.slice(from, p + 100)).find(r => p >= r.start + from && p < r.end + from)
  return hit ? { ...hit, start: hit.start + from, end: hit.end + from } : null
}

/**
 * The homopolymer an insertion or deletion of one base kind touches: the
 * length of the reference's run of that base at the event (before an
 * insertion grows it, including what a deletion removes). Null when the
 * indel mixes bases or no run of two or more is there.
 */
export function homopolymerRun(refSeq: string, type: VariantType, p: number, bases: string): number | null {
  if (!bases || type === 'SNP') return null
  const b = bases[0].toUpperCase()
  for (const c of bases) if (c.toUpperCase() !== b) return null
  const s = refSeq
  const at = (i: number) => (s[i] ?? '').toUpperCase()
  // An insertion sits between bases p and p + 1; a deletion starts at p.
  let lo = type === 'Insertion' ? p : p - 1
  while (lo >= 0 && at(lo) === b) lo--
  let hi = type === 'Insertion' ? p + 1 : p
  while (hi < s.length && at(hi) === b) hi++
  const run = hi - lo - 1
  return run >= 2 ? run : null
}

export type FilterId = 'depth' | 'frequency' | 'reads' | 'quality' | 'strandBias' | 'homopolymer' | 'coding'

/** Each filter: its VCF FILTER name and what it means. */
export const FILTERS: Record<FilterId, { vcf: string; label: string }> = {
  depth: { vcf: 'LowDepth', label: 'Too few reads cover it' },
  frequency: { vcf: 'LowFreq', label: 'Too small a share of the reads carry it' },
  reads: { vcf: 'FewReads', label: 'Too few reads carry it' },
  quality: { vcf: 'LowQual', label: 'Too likely to be sequencing error' },
  strandBias: { vcf: 'StrandBias', label: 'Seen (almost) only on one strand' },
  homopolymer: { vcf: 'Homopolymer', label: 'An insertion or deletion in a homopolymer run' },
  coding: { vcf: 'NonCoding', label: 'Not in a coding feature' },
}

/** The settings a variant fails; empty when it passes. */
export function variantFilters(v: Variant, s: VariantSettings): FilterId[] {
  const out: FilterId[] = []
  if (v.coverage < s.minCoverage) out.push('depth')
  if (v.frequency < s.minFrequency) out.push('frequency')
  if (v.count < s.minAltReads) out.push('reads')
  if (v.pValue > s.maxPValue) out.push('quality')
  if (s.excludeStrandBias && v.strandBiasP < STRAND_BIAS_P) out.push('strandBias')
  if (s.excludeHomopolymerIndels && v.homopolymer !== null && v.homopolymer >= s.homopolymerLength) out.push('homopolymer')
  if (s.codingOnly && !v.coding) out.push('coding')
  return out
}

/** Phred-scaled quality of a variant from its P-value (VCF QUAL), at most 999. */
export function variantQual(v: Pick<Variant, 'pValue'>): number {
  if (!(v.pValue > 0)) return 999
  return Math.min(999, Math.max(0, -10 * Math.log10(v.pValue)))
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

/**
 * P(X >= k) for X Poisson with mean lambda: the chance of k or more error
 * reads when lambda are expected. Used for deep NGS sites, where the exact
 * Poisson-binomial over thousands of reads would cost O(n^2); by Le Cam's
 * theorem the Poisson is close when each read's error chance is small.
 * Summed from k upward term by term, each term in log space.
 */
export function poissonTail(lambda: number, k: number): number {
  if (k <= 0) return 1
  if (!(lambda > 0)) return 0
  const lnL = Math.log(lambda)
  let sum = 0
  for (let i = k; i < k + 5000; i++) {
    const t = Math.exp(-lambda + i * lnL - logFact(i))
    sum += t
    if (i > lambda && t <= sum * 1e-12) break
  }
  return Math.min(1, sum)
}

const logFact = (() => {
  const t = [0]
  for (let i = 1; i <= 2000; i++) t.push(t[i - 1] + Math.log(i))
  // Stirling's series past the table.
  return (n: number) => (n <= 2000 ? t[n] : n * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI * n) + 1 / (12 * n))
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
  const head = ['Position', 'Type', 'Substitution', 'Reference', 'Variant', 'Frequency', 'Reference frequency', 'Coverage', 'Reads with variant', 'P-value', 'Strand bias P', 'Forward ref/alt', 'Reverse ref/alt', 'Mean quality', 'Features', 'Coding feature', 'cDNA change', 'Protein change', 'HGVS protein', 'Effect', 'Other coding changes', 'Tandem repeat', 'Homopolymer']
  const q = csvCell
  const rows = vs.map(v => [
    String(v.position), v.type, substitutionKind(v) ?? '', v.ref || '-', v.alt || '-', v.frequency.toFixed(3), referenceFrequency(v).toFixed(3), String(v.coverage), v.count.toFixed(1).replace(/\.0$/, ''),
    v.pValue.toExponential(2), v.strandBiasP.toPrecision(3), `${v.forward.ref}/${v.forward.alt}`, `${v.reverse.ref}/${v.reverse.alt}`,
    v.meanQuality.toFixed(1), v.features.join('; '),
    v.coding?.feature ?? '', v.coding?.cdna ?? '', v.coding?.protein ?? '', v.coding?.hgvsp ?? '', v.coding?.effect ?? '', v.otherCoding.map(codingSummary).join('; '),
    v.repeat ?? '', v.homopolymer ? String(v.homopolymer) : '',
  ].map(q).join(','))
  return [head.join(','), ...rows].join('\n') + '\n'
}

/**
 * A single-base change as a transition (purine to purine, A and G, or
 * pyrimidine to pyrimidine, C and T) or a transversion (one to the other).
 * Transitions are about twice as common in nature, so a Ts/Tv ratio far
 * from that in a call set hints at sequencing errors. Null for indels and
 * IUPAC calls.
 */
export function substitutionKind(v: Pick<Variant, 'type' | 'ref' | 'alt'>): 'Transition' | 'Transversion' | null {
  if (v.type !== 'SNP' || v.ref.length !== 1 || v.alt.length !== 1) return null
  const purine = (b: string) => (b === 'A' || b === 'G' ? 1 : b === 'C' || b === 'T' ? 0 : -1)
  const a = purine(v.ref.toUpperCase())
  const b = purine(v.alt.toUpperCase())
  if (a < 0 || b < 0 || v.ref.toUpperCase() === v.alt.toUpperCase()) return null
  return a === b ? 'Transition' : 'Transversion'
}

/** Share of the covering reads that show the reference here. */
export function referenceFrequency(v: Pick<Variant, 'forward' | 'reverse' | 'coverage'>): number {
  return v.coverage > 0 ? Math.min(1, (v.forward.ref + v.reverse.ref) / v.coverage) : 0
}

/** Identifies a variant across recomputations: type, position and alleles. */
export const variantKey = (v: Pick<Variant, 'type' | 'position' | 'ref' | 'alt'>) => `${v.type}:${v.position}:${v.ref}:${v.alt}`

/** A short label for a variant: "A>G", "insT", "delCA". */
export function variantLabel(v: Variant): string {
  if (v.type === 'SNP') return `${v.ref}>${v.alt}`
  return v.type === 'Insertion' ? `ins${v.alt}` : `del${v.ref}`
}
