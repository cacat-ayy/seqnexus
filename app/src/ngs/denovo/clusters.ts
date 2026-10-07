/**
 * Products in a long-read set, found by read length.
 *
 * When a plasmid or an amplicon is sequenced whole, many reads are its full
 * length: a plasmid opened at a random place by the library preparation
 * (transposase or a cut), an amplicon end to end. They make a sharp peak in
 * the read lengths, standing out from the broad spread of broken molecules
 * and stray DNA. Each peak is a product: the plasmid, a second plasmid in
 * the same sample, a dimer, a shorter PCR product.
 *
 * A peak is the length with the most reads within `tolerance` of it, of the
 * lengths whose window stands out from its surroundings. The flanks (the
 * next two window widths on either side) say how many reads the window
 * would hold if nothing were there; the window must hold `minReads` more
 * than that, and so many that chance alone would put them there less than
 * once in a million times (a Poisson tail). Many windows are looked at, so
 * a test at the usual 5% would find peaks in any broad spread of broken
 * molecules. The peak's reads are set aside and the next peak is looked
 * for, up to `maxPeaks`.
 */

import { poissonTail } from '../../assembly/variants'

export interface LengthPeak {
  /** Median length of the reads in the peak. */
  length: number
  /** Indices of the reads in it. */
  members: number[]
}

export interface PeakOptions {
  minReads: number
  /** Half-width of the window, as a share of the length. */
  tolerance?: number
  maxPeaks?: number
  /** Reads shorter than this are not looked at. */
  minLength?: number
}

export const PEAK_TOLERANCE = 0.02
/** Chance of the window's reads by chance alone a peak must be below. */
export const PEAK_P = 1e-6

/** Index of the first value at least `x` in a sorted array. */
function below(sorted: readonly number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m }
  return lo
}

export function lengthPeaks(lengths: ArrayLike<number>, o: PeakOptions): LengthPeak[] {
  const w = o.tolerance ?? PEAK_TOLERANCE
  const minLength = o.minLength ?? 100
  let order: number[] = []
  for (let i = 0; i < lengths.length; i++) if (lengths[i] >= minLength) order.push(i)
  order.sort((a, b) => lengths[a] - lengths[b])
  // The flanks are always counted on every read, so the gap a peak leaves when
  // its reads are taken out does not make its neighbours look like peaks.
  const all = order.map(i => lengths[i])
  const count = (sorted: readonly number[], from: number, to: number) => below(sorted, to + 1e-9) - below(sorted, from)
  const peaks: LengthPeak[] = []
  while (peaks.length < (o.maxPeaks ?? 8) && order.length >= o.minReads) {
    const len = order.map(i => lengths[i])
    let best = -1
    let bestCount = 0
    let a = 0
    let j = 0
    // Window [x(1-w), x(1+w)] around each read length x, by two pointers.
    for (let i = 0; i < len.length; i++) {
      const x = len[i]
      while (a < len.length && len[a] < x * (1 - w)) a++
      if (j < a) j = a
      while (j < len.length && len[j] <= x * (1 + w)) j++
      const n = j - a
      if (n <= bestCount || n < o.minReads) continue
      // The reads the flanks would put in the window (they are four times its width).
      const background = (count(all, x * (1 - 5 * w), x * (1 + 5 * w)) - count(all, x * (1 - w), x * (1 + w))) / 4
      if (n - background >= o.minReads && poissonTail(Math.max(1, background), n) < PEAK_P) { bestCount = n; best = i }
    }
    if (best < 0) break
    const x = len[best]
    const lo = below(len, x * (1 - w))
    const hi = below(len, x * (1 + w) + 1e-9)
    const window = order.slice(lo, hi)
    const ls = window.map(i => lengths[i]).sort((p, q) => p - q)
    peaks.push({ length: ls[ls.length >> 1], members: window })
    order = [...order.slice(0, lo), ...order.slice(hi)]
  }
  return peaks
}

/**
 * The read to start a product from: of the reads close to the peak's length
 * (within half a percent, or the whole peak when none are), the one with
 * the best mean quality.
 */
export function pickSeed(peak: LengthPeak, lengths: ArrayLike<number>, quality: ArrayLike<number>): number {
  const close = peak.members.filter(i => Math.abs(lengths[i] - peak.length) <= Math.max(5, peak.length * 0.005))
  const pool = close.length ? close : peak.members
  let best = pool[0]
  for (const i of pool) if (quality[i] > quality[best]) best = i
  return best
}
