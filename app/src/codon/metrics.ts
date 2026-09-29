/**
 * The numbers shown before and after a run.
 *
 * All of them are properties of a coding region, so they are computed from the
 * coding-strand bases and the same usage table the optimizer used. Showing a
 * CAI against one table and optimizing against another would be worse than
 * showing nothing.
 */

import { gcPercentOf } from './constraints'
import { synonymsFor, type GeneticCode } from './genetic-codes'
import { relativeAdaptiveness, rareCodons, type CodonUsageTable } from './usage-tables'

export interface CodonMetrics {
  /** Codon Adaptation Index, 0..1. Null when nothing could be scored. */
  cai: number | null
  gc: number
  /** GC at the third position, the one synonymous choice mostly moves. */
  gc3: number
  codons: number
  rareCodons: number
  longestRunAT: number
  longestRunGC: number
}

/** Longest run of bases from `set`, e.g. A/T or G/C. */
export function longestRun(seq: string, set: string): number {
  let best = 0
  let run = 0
  let last = ''
  for (const raw of seq) {
    const base = raw.toUpperCase()
    if (!set.includes(base)) { run = 0; last = ''; continue }
    run = base === last ? run + 1 : 1
    last = base
    if (run > best) best = run
  }
  return best
}

/**
 * Longest homopolymer, counted per base rather than per class.
 *
 * AATT is not a run of four: the limits people set are about polymerase
 * slippage on a single repeated base, so AAAA and TTTT are what matter.
 */
function longestHomopolymer(seq: string, bases: string): number {
  let best = 0
  for (const base of bases) {
    let run = 0
    for (const raw of seq) {
      if (raw.toUpperCase() === base) { run++; if (run > best) best = run }
      else run = 0
    }
  }
  return best
}

export function codonMetrics(
  codingBases: string, code: GeneticCode, table: CodonUsageTable, rareThreshold: number,
): CodonMetrics {
  const upper = codingBases.toUpperCase()
  const weights = relativeAdaptiveness(table, code)
  const rare = rareCodons(table, code, rareThreshold)

  let logSum = 0
  let scored = 0
  let rareCount = 0
  let codons = 0
  const thirdPositions: string[] = []

  for (let i = 0; i + 2 < upper.length; i += 3) {
    const codon = upper.slice(i, i + 3)
    const aa = code.table[codon]
    if (!aa) continue
    codons++
    thirdPositions.push(codon[2])
    if (rare.has(codon)) rareCount++
    // CAI leaves out families with a single codon: they carry no information
    // about adaptation, and including them would drag every score toward 1.
    if (synonymsFor(code, aa).length < 2) continue
    const w = weights[codon] ?? 0
    if (w <= 0) continue
    logSum += Math.log(w)
    scored++
  }

  return {
    cai: scored > 0 ? Math.exp(logSum / scored) : null,
    gc: gcPercentOf(upper),
    gc3: gcPercentOf(thirdPositions.join('')),
    codons,
    rareCodons: rareCount,
    longestRunAT: longestHomopolymer(upper, 'AT'),
    longestRunGC: longestHomopolymer(upper, 'GC'),
  }
}

/** Fraction of bases identical between two equal-length sequences. */
export function percentIdentity(a: string, b: string): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let same = 0
  for (let i = 0; i < a.length; i++) if (a[i].toUpperCase() === b[i].toUpperCase()) same++
  return (same / a.length) * 100
}
