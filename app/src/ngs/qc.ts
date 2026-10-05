/**
 * A read set's QC verdict: good, check or fail, with the reasons.
 *
 * The thresholds are SeqNexus's own rules of thumb, set from what current
 * instruments deliver, not a standard (see the README):
 * - short reads by the share of bases at Q30 and above (good from 75%, check
 *   from 60%; current Illumina runs usually exceed 80%, long MiSeq runs sit
 *   lower);
 * - Nanopore by the median read quality (good from Q12, check from Q9), PacBio
 *   HiFi from Q20 (check from Q15), since HiFi reads are Q20 by definition;
 * - for all, too many N calls (check above 1%, fail above 5%) and too few reads.
 */

import { isLongRead, type QcResult, type ReadSetStats, type Technology } from './types'

export const QC_RULES = {
  shortQ30: { good: 0.75, check: 0.6 },
  nanoporeQ: { good: 12, check: 9 },
  pacbioQ: { good: 20, check: 15 },
  nFraction: { check: 0.01, fail: 0.05 },
  fewReads: 1000,
} as const

export const QC_LABEL: Record<QcResult['verdict'], string> = { good: 'Good', check: 'Check', fail: 'Failed' }

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`

export function readSetQc(s: ReadSetStats, tech: Technology): QcResult {
  const fails: string[] = []
  const checks: string[] = []
  if (s.reads === 0) return { verdict: 'fail', issues: ['No reads'] }
  if (s.qualityMissing) checks.push('No base qualities in the file')
  else if (isLongRead(tech)) {
    const rule = tech === 'pacbio' ? QC_RULES.pacbioQ : QC_RULES.nanoporeQ
    const q = s.medianReadQuality
    if (q < rule.check) fails.push(`Median read quality Q${q.toFixed(1)} (below Q${rule.check})`)
    else if (q < rule.good) checks.push(`Median read quality Q${q.toFixed(1)} (below Q${rule.good})`)
  } else {
    const rule = QC_RULES.shortQ30
    if (s.q30 < rule.check) fails.push(`${pct(s.q30)} of bases at Q30 or above (below ${pct(rule.check)})`)
    else if (s.q30 < rule.good) checks.push(`${pct(s.q30)} of bases at Q30 or above (below ${pct(rule.good)})`)
  }
  if (s.nFraction > QC_RULES.nFraction.fail) fails.push(`${pct(s.nFraction)} of bases are N`)
  else if (s.nFraction > QC_RULES.nFraction.check) checks.push(`${pct(s.nFraction)} of bases are N`)
  if (s.reads < QC_RULES.fewReads) checks.push(`Only ${s.reads} reads`)
  if (fails.length) return { verdict: 'fail', issues: [...fails, ...checks] }
  if (checks.length) return { verdict: 'check', issues: checks }
  return { verdict: 'good', issues: [] }
}
