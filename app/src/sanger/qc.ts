/**
 * Quality summary of a Sanger read, in the terms sequencing cores report.
 *
 * - QV20+: bases called at Phred 20 or better.
 * - CRL (contiguous read length): the longest stretch in which every 20-base
 *   window averages Q20 or better.
 * - Trace score: mean quality of the read after quality trimming.
 * - Mixed peaks: calls inside the CRL whose second-tallest channel reaches a
 *   third of the called one. A few are normal; many mean a mixed template,
 *   a double priming site or a heterozygous indel.
 *
 * The verdict thresholds are this app's, chosen to agree with what a core's
 * report would call a failed, weak or good read. They are not an instrument
 * vendor's.
 */

import type { TraceData } from '../io/trace'
import { autoTrim } from '../io/ab1'
import { peakTable, secondaryRatio } from './peaks'

export type QcVerdict = 'good' | 'check' | 'fail'

export interface ReadQc {
  length: number
  /** Bases with quality ≥ 20. */
  qv20: number
  /** Longest high-quality stretch, half-open. Zero length when there is none. */
  crl: { start: number; end: number; length: number }
  /** Mean quality after quality trimming; null when the file has no qualities. */
  traceScore: number | null
  /** Mean quality over the whole read; null when the file has no qualities. */
  meanQuality: number | null
  /** Calls inside the CRL with a secondary peak ≥ MIXED_RATIO of the primary. */
  mixedPeaks: number
  /** N and IUPAC calls. */
  ambiguous: number
  /** Median height of the called peaks inside the CRL (or the whole read). */
  medianPeak: number
  verdict: QcVerdict
  /** Why the verdict is not "good", most serious first. */
  issues: string[]
}

export const QC_WINDOW = 20
export const QC_MIN_QUALITY = 20
export const MIXED_RATIO = 1 / 3

const cache = new WeakMap<TraceData, ReadQc>()

export function readQc(data: TraceData): ReadQc {
  let qc = cache.get(data)
  if (!qc) {
    qc = computeReadQc(data)
    cache.set(data, qc)
  }
  return qc
}

export function computeReadQc(data: TraceData): ReadQc {
  const q = data.qualityScores
  const n = data.bases.length
  const noQuality = data.metadata.qualityMissing === true || q.length === 0 || n === 0

  let qv20 = 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const qi = q[i] ?? 0
    if (qi >= QC_MIN_QUALITY) qv20++
    sum += qi
  }

  const crl = noQuality ? { start: 0, end: n, length: n } : contiguousReadLength(q)

  let traceScore: number | null = null
  if (!noQuality) {
    const [ts, te] = autoTrim(q, QC_MIN_QUALITY)
    if (te > ts) {
      let s = 0
      for (let i = ts; i < te; i++) s += q[i]
      traceScore = s / (te - ts)
    } else {
      traceScore = 0
    }
  }

  const peaks = peakTable(data)
  let mixedPeaks = 0
  const heights: number[] = []
  const from = crl.length > 0 ? crl.start : 0
  const to = crl.length > 0 ? crl.end : Math.min(n, peaks.length)
  for (let i = from; i < to && i < peaks.length; i++) {
    heights.push(peaks.primary[i])
    if (secondaryRatio(peaks, i) >= MIXED_RATIO) mixedPeaks++
  }
  heights.sort((a, b) => a - b)
  const medianPeak = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 0

  let ambiguous = 0
  for (let i = 0; i < n; i++) {
    const b = data.bases[i]
    if (b !== 'A' && b !== 'C' && b !== 'G' && b !== 'T') ambiguous++
  }

  const qc: ReadQc = {
    length: n,
    qv20: noQuality ? 0 : qv20,
    crl,
    traceScore,
    meanQuality: noQuality ? null : sum / n,
    mixedPeaks,
    ambiguous,
    medianPeak,
    verdict: 'good',
    issues: [],
  }
  judge(qc, noQuality)
  return qc
}

/**
 * Longest run in which every QC_WINDOW-base window averages at least
 * QC_MIN_QUALITY. Reads shorter than one window count when their mean does.
 */
export function contiguousReadLength(q: number[]): { start: number; end: number; length: number } {
  const n = q.length
  const w = QC_WINDOW
  if (n === 0) return { start: 0, end: 0, length: 0 }
  if (n < w) {
    const mean = q.reduce((a, b) => a + b, 0) / n
    return mean >= QC_MIN_QUALITY ? { start: 0, end: n, length: n } : { start: 0, end: 0, length: 0 }
  }
  const need = QC_MIN_QUALITY * w
  let windowSum = 0
  for (let i = 0; i < w; i++) windowSum += q[i]
  let best = { start: 0, end: 0, length: 0 }
  let runStart = -1
  for (let s = 0; s + w <= n; s++) {
    if (s > 0) windowSum += q[s + w - 1] - q[s - 1]
    if (windowSum >= need) {
      if (runStart < 0) runStart = s
      const end = s + w
      if (end - runStart > best.length) best = { start: runStart, end, length: end - runStart }
    } else {
      runStart = -1
    }
  }
  return best
}

function judge(qc: ReadQc, noQuality: boolean): void {
  const fail: string[] = []
  const check: string[] = []

  if (qc.length < 50) fail.push(`Only ${qc.length} bases called`)
  if (noQuality) {
    check.push('No quality values in the file')
  } else {
    if (qc.crl.length < 100) fail.push(`Contiguous read length ${qc.crl.length} (under 100)`)
    else if (qc.crl.length < 400) check.push(`Contiguous read length ${qc.crl.length} (under 400)`)
    const ts = qc.traceScore ?? 0
    if (ts < 15) fail.push(`Trace score ${Math.round(ts)} (under 15)`)
    else if (ts < 30) check.push(`Trace score ${Math.round(ts)} (under 30)`)
  }
  const span = Math.max(1, qc.crl.length)
  if (qc.mixedPeaks / span > 0.05 && qc.mixedPeaks >= 5) {
    const where = noQuality ? 'in the read' : 'in the high-quality region'
    check.push(`${qc.mixedPeaks} mixed peaks ${where} (mixed template or heterozygous indel?)`)
  }
  if (qc.medianPeak > 0 && qc.medianPeak < 100) check.push(`Weak signal (median peak ${Math.round(qc.medianPeak)})`)

  qc.verdict = fail.length > 0 ? 'fail' : check.length > 0 ? 'check' : 'good'
  qc.issues = [...fail, ...check]
}

export const VERDICT_LABEL: Record<QcVerdict, string> = {
  good: 'Good',
  check: 'Check',
  fail: 'Failed',
}
