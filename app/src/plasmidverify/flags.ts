/**
 * What a whole-plasmid result says beyond its differences: whether the
 * tube holds more than one plasmid, and which differences are where
 * nanopore sequencing is known to err.
 *
 * Mixed population. A prep from one colony gives reads that agree at every
 * position; two plasmids in the tube (a picked colony that was not single,
 * a recombined subpopulation) give positions where the reads split. With
 * the reads, a site is mixed when 20 to 80% of at least 20 reads carry the
 * other allele, and the call passes the nanopore thresholds otherwise
 * (P-value 1e-6 or less, 5 reads or more, an insertion or deletion not in a
 * homopolymer of 4 or more, where nanopore miscounts). 20x is where the
 * service itself says its consensus becomes accurate. Without the reads,
 * the service's chromatogram stands in: it is drawn from the reads' base
 * counts at each position, so a second peak at least a quarter the height
 * of the first (the 20% of the reads' rule, as heights) marks a mixed
 * position, found with the Sanger mixed-base caller (sanger/mixed.ts). A
 * second peak in a homopolymer of 5 or more, or at a methylation site, is
 * passed over there, being the error modes below rather than a population.
 *
 * Low confidence. Plasmidsaurus names two systematic nanopore error modes:
 * homopolymers longer than 9 bases, whose length is miscounted, and
 * methylation sites (Dam GATC, Dcm CCWGG in plasmids grown in E. coli),
 * where modified bases are miscalled. A difference in either is flagged
 * rather than dropped: it may be real, but it is worth a Sanger read across
 * it before a clone is thrown away for it.
 */

import { planMixedCalls } from '../sanger/mixed'
import { peakTable } from '../sanger/peaks'
import type { TraceData } from '../io/trace'
import { reverseComplement } from '../models/complement'
import { VARIANT_PRESETS, variantFilters, variantKey, variantLabel, type Variant } from '../assembly/variants'
import type { CircularComparison } from './compare'

/** Shares of the reads between which a site counts as mixed. */
export const MIXED_MIN = 0.2
export const MIXED_MAX = 0.8
/** Reads a site needs for a mixed call. */
export const MIXED_MIN_DEPTH = 20
/** A second peak at least this share of the first marks a mixed position in the service's chromatogram (20% of the reads against 80%). */
export const TRACE_MIXED_RATIO = 0.25
/** Homopolymers at least this long are miscounted by nanopore reads (the service's "longer than 9"). */
export const LONG_HOMOPOLYMER = 10
/** Second peaks in runs of one base this long are passed over in the chromatogram. */
const TRACE_RUN = 5

const CHANNELS = ['A', 'C', 'G', 'T'] as const

export interface MixedSite {
  /** 1-based construct position. */
  position: number
  /** "A>G" for the reads, "A/G" (the two peaks) for the chromatogram. */
  change: string
  /** Share of the reads (or of the two peak heights) that are the minor allele. */
  fraction: number
  /** Reads over the site; null from the chromatogram. */
  depth: number | null
  source: 'reads' | 'trace'
  /** It is at one of the differences from the construct. */
  atDifference: boolean
}

export interface LowConfidence {
  /** The difference (variantKey). */
  key: string
  position: number
  reason: string
}

const near = (d: Variant, p0: number) => p0 >= d.position - 2 && p0 <= d.position + Math.max(1, d.ref.length)

/** Mixed sites among a sample's candidate variants from its reads. */
export function readMixedSites(candidates: readonly Variant[], differences: readonly Variant[]): MixedSite[] {
  const s = { ...VARIANT_PRESETS.nanopore, minFrequency: MIXED_MIN, minCoverage: MIXED_MIN_DEPTH }
  return candidates
    .filter(v => v.frequency <= MIXED_MAX && variantFilters(v, s).length === 0)
    .map(v => ({
      position: v.position, change: variantLabel(v), fraction: v.frequency, depth: v.coverage, source: 'reads' as const,
      atDifference: differences.some(d => variantKey(d) === variantKey(v) || near(d, v.position)),
    }))
}

/** Length of the run of one base the 0-based position p of a circle lies in. */
export function runAt(bases: string, p: number): number {
  const L = bases.length
  if (L === 0) return 0
  const b = bases[p]
  let n = 1
  for (let i = 1; i < L && bases[(p - i + L) % L] === b; i++) n++
  for (let i = 1; i < L && bases[(p + i) % L] === b; i++) n++
  return Math.min(n, L)
}

const METHYL = [
  { name: 'Dam', re: /GATC/g, len: 4 },
  { name: 'Dcm', re: /CC[AT]GG/g, len: 5 },
]

/** The methylation site (Dam or Dcm) the 0-based position p of a circle lies in, or null. */
export function methylationAt(bases: string, p: number): { name: string; site: string } | null {
  const L = bases.length
  const from = (p - 6 + L) % L
  const window = Array.from({ length: 13 }, (_, i) => bases[(from + i) % L]).join('')
  for (const m of METHYL) {
    m.re.lastIndex = 0
    for (let hit = m.re.exec(window); hit; hit = m.re.exec(window)) {
      if (hit.index <= 6 && 6 < hit.index + m.len) return { name: m.name, site: hit[0] }
    }
  }
  return null
}

/**
 * Mixed positions in the service's chromatogram, on the construct. `cmp`
 * lines the chromatogram's calls up with the construct (compareCircular of
 * the trace's bases).
 */
export function traceMixedSites(
  trace: TraceData,
  cmp: CircularComparison,
  refBases: string,
  differences: readonly Variant[],
): MixedSite[] {
  const ref = refBases.toUpperCase()
  const plan = planMixedCalls(trace, [], 0, trace.bases.length, { ratio: TRACE_MIXED_RATIO, keepUserEdits: true })
  const t = peakTable(trace)
  const out: MixedSite[] = []
  for (const e of plan.edits) {
    if (e.type !== 'substitute') continue
    const i = e.pos
    const p0 = cmp.constructPosition[i]
    if (p0 < 0 || p0 >= ref.length) continue
    if (runAt(ref, p0) >= TRACE_RUN || methylationAt(ref, p0)) continue
    const pri = t.primary[i]
    const sec = t.secondary[i]
    let a: string = CHANNELS[t.primaryBase[i]]
    let b: string = CHANNELS[t.secondaryBase[i]]
    if (cmp.reversed) { a = reverseComplement(a); b = reverseComplement(b) }
    const position = p0 + 1
    out.push({
      position, change: `${a}/${b}`, fraction: pri + sec > 0 ? sec / (pri + sec) : 0, depth: null, source: 'trace',
      atDifference: differences.some(d => near(d, position)),
    })
  }
  return out.sort((x, y) => x.position - y.position)
}

/** Differences in a long homopolymer or at a methylation site, with why. */
export function lowConfidence(differences: readonly Variant[], refBases: string): LowConfidence[] {
  const ref = refBases.toUpperCase()
  const L = ref.length
  const out: LowConfidence[] = []
  for (const d of differences) {
    const p0 = Math.max(0, Math.min(L - 1, d.position - 1))
    const reasons: string[] = []
    // The run the change is in or beside: an insertion sits between its base and the next.
    const around = d.type === 'SNP' ? [p0 - 1, p0, p0 + 1] : d.type === 'Insertion' ? [p0, p0 + 1] : [p0]
    let run = d.homopolymer ?? 0
    let at = p0
    for (const x of around) {
      const i = (x + L) % L
      const r = runAt(ref, i)
      if (r > run) { run = r; at = i }
    }
    if (run >= LONG_HOMOPOLYMER) reasons.push(`in a run of ${run} ${ref[at]}, longer than nanopore reads count reliably`)
    const m = methylationAt(ref, p0)
    if (m) reasons.push(`at a ${m.name} methylation site (${m.site}), where nanopore reads miscall modified bases`)
    if (reasons.length) out.push({ key: variantKey(d), position: d.position, reason: reasons.join('; ') })
  }
  return out
}
