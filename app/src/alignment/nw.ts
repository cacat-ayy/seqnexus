/**
 * Needleman-Wunsch global alignment with affine gap penalties.
 *
 * Uses three DP matrices (M, Ix, Iy) for match/mismatch, gap-in-X, gap-in-Y.
 * For sequences >10 kb, delegates to Hirschberg's divide-and-conquer to
 * reduce memory from O(mn) to O(min(m,n)).
 */

import type { Scorer } from './matrices'

export interface NWResult {
  alignedA: string
  alignedB: string
  score: number
}

const HIRSCHBERG_THRESHOLD = 10_000

/**
 * Global pairwise alignment (Needleman-Wunsch, affine gaps).
 */
export function needlemanWunsch(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): NWResult {
  const m = seqA.length
  const n = seqB.length

  if (m === 0) return { alignedA: '-'.repeat(n), alignedB: seqB, score: n > 0 ? gapOpen + gapExtend * n : 0 }
  if (n === 0) return { alignedA: seqA, alignedB: '-'.repeat(m), score: m > 0 ? gapOpen + gapExtend * m : 0 }

  // Use Hirschberg for large sequences
  if (m * n > HIRSCHBERG_THRESHOLD * HIRSCHBERG_THRESHOLD) {
    return hirschberg(seqA, seqB, scorer, gapOpen, gapExtend)
  }

  return nwFull(seqA, seqB, scorer, gapOpen, gapExtend)
}

/** Standard O(mn) space NW with affine gaps and full traceback. */
function nwFull(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): NWResult {
  const m = seqA.length
  const n = seqB.length

  // M[i][j] = best score ending with a match/mismatch at (i,j)
  // Ix[i][j] = best score ending with a gap in seqB (consuming seqA[i])
  // Iy[i][j] = best score ending with a gap in seqA (consuming seqB[j])
  const M  = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Ix = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Iy = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))

  // Traceback: 0=M, 1=Ix, 2=Iy for each matrix
  const trM  = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIx = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIy = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))

  const NEG_INF = -1e9

  // Initialize
  M[0][0] = 0
  Ix[0][0] = NEG_INF
  Iy[0][0] = NEG_INF

  for (let i = 1; i <= m; i++) {
    M[i][0] = NEG_INF
    Ix[i][0] = gapOpen + gapExtend * i
    Iy[i][0] = NEG_INF
  }
  for (let j = 1; j <= n; j++) {
    M[0][j] = NEG_INF
    Ix[0][j] = NEG_INF
    Iy[0][j] = gapOpen + gapExtend * j
  }

  // Fill
  for (let i = 1; i <= m; i++) {
    const ai = seqA[i - 1]
    for (let j = 1; j <= n; j++) {
      const bj = seqB[j - 1]
      const s = scorer(ai, bj)

      // M[i][j]: match/mismatch - came from any matrix at (i-1, j-1)
      const mFromM  = M[i - 1][j - 1] + s
      const mFromIx = Ix[i - 1][j - 1] + s
      const mFromIy = Iy[i - 1][j - 1] + s
      if (mFromM >= mFromIx && mFromM >= mFromIy) {
        M[i][j] = mFromM; trM[i][j] = 0
      } else if (mFromIx >= mFromIy) {
        M[i][j] = mFromIx; trM[i][j] = 1
      } else {
        M[i][j] = mFromIy; trM[i][j] = 2
      }

      // Ix[i][j]: gap in seqB (extend gap in B or open new gap)
      const ixFromM  = M[i - 1][j] + gapOpen + gapExtend
      const ixFromIx = Ix[i - 1][j] + gapExtend
      if (ixFromM >= ixFromIx) {
        Ix[i][j] = ixFromM; trIx[i][j] = 0
      } else {
        Ix[i][j] = ixFromIx; trIx[i][j] = 1
      }

      // Iy[i][j]: gap in seqA (extend gap in A or open new gap)
      const iyFromM  = M[i][j - 1] + gapOpen + gapExtend
      const iyFromIy = Iy[i][j - 1] + gapExtend
      if (iyFromM >= iyFromIy) {
        Iy[i][j] = iyFromM; trIy[i][j] = 0
      } else {
        Iy[i][j] = iyFromIy; trIy[i][j] = 2
      }
    }
  }

  // Find best ending matrix
  const finalM  = M[m][n]
  const finalIx = Ix[m][n]
  const finalIy = Iy[m][n]
  let score: number
  let mat: number // 0=M, 1=Ix, 2=Iy
  if (finalM >= finalIx && finalM >= finalIy) {
    score = finalM; mat = 0
  } else if (finalIx >= finalIy) {
    score = finalIx; mat = 1
  } else {
    score = finalIy; mat = 2
  }

  // Traceback
  const alnA: string[] = []
  const alnB: string[] = []
  let i = m, j = n

  while (i > 0 || j > 0) {
    if (i === 0) {
      // Only gaps in A remain
      alnA.push('-')
      alnB.push(seqB[j - 1])
      j--
    } else if (j === 0) {
      // Only gaps in B remain
      alnA.push(seqA[i - 1])
      alnB.push('-')
      i--
    } else if (mat === 0) {
      // Match/mismatch
      const prev = trM[i][j]
      alnA.push(seqA[i - 1])
      alnB.push(seqB[j - 1])
      i--; j--
      mat = prev
    } else if (mat === 1) {
      // Gap in seqB
      const prev = trIx[i][j]
      alnA.push(seqA[i - 1])
      alnB.push('-')
      i--
      mat = prev
    } else {
      // Gap in seqA
      const prev = trIy[i][j]
      alnA.push('-')
      alnB.push(seqB[j - 1])
      j--
      mat = prev
    }
  }

  return {
    alignedA: alnA.reverse().join(''),
    alignedB: alnB.reverse().join(''),
    score,
  }
}

// ── Hirschberg's algorithm ──────────────────────────────────────────────────

/** Compute last row of NW score matrix in O(n) space (forward direction). */
function nwScoreRow(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): Float64Array {
  const m = seqA.length
  const n = seqB.length
  const NEG_INF = -1e9

  let mPrev = new Float64Array(n + 1)
  let ixPrev = new Float64Array(n + 1)
  let iyPrev = new Float64Array(n + 1)
  let mCurr = new Float64Array(n + 1)
  let ixCurr = new Float64Array(n + 1)
  let iyCurr = new Float64Array(n + 1)

  mPrev[0] = 0; ixPrev[0] = NEG_INF; iyPrev[0] = NEG_INF
  for (let j = 1; j <= n; j++) {
    mPrev[j] = NEG_INF
    ixPrev[j] = NEG_INF
    iyPrev[j] = gapOpen + gapExtend * j
  }

  for (let i = 1; i <= m; i++) {
    const ai = seqA[i - 1]
    mCurr[0] = NEG_INF
    ixCurr[0] = gapOpen + gapExtend * i
    iyCurr[0] = NEG_INF

    for (let j = 1; j <= n; j++) {
      const s = scorer(ai, seqB[j - 1])
      mCurr[j] = Math.max(mPrev[j - 1], ixPrev[j - 1], iyPrev[j - 1]) + s
      ixCurr[j] = Math.max(mCurr[j - 1] + gapOpen + gapExtend, // note: should be mPrev row for Ix
        mPrev[j] + gapOpen + gapExtend, ixPrev[j] + gapExtend)
      // Fix: Ix extends gap in B (consumes A[i], skips B)
      ixCurr[j] = Math.max(mPrev[j] + gapOpen + gapExtend, ixPrev[j] + gapExtend)
      iyCurr[j] = Math.max(mCurr[j - 1] + gapOpen + gapExtend, iyCurr[j - 1] + gapExtend)
    }

    ;[mPrev, mCurr] = [mCurr, mPrev]
    ;[ixPrev, ixCurr] = [ixCurr, ixPrev]
    ;[iyPrev, iyCurr] = [iyCurr, iyPrev]
  }

  // Best score at each column = max(M, Ix, Iy)
  const result = new Float64Array(n + 1)
  for (let j = 0; j <= n; j++) {
    result[j] = Math.max(mPrev[j], ixPrev[j], iyPrev[j])
  }
  return result
}

function reverseStr(s: string): string {
  return s.split('').reverse().join('')
}

function hirschberg(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): NWResult {
  const m = seqA.length
  const n = seqB.length

  if (m === 0) {
    return { alignedA: '-'.repeat(n), alignedB: seqB, score: n > 0 ? gapOpen + gapExtend * n : 0 }
  }
  if (n === 0) {
    return { alignedA: seqA, alignedB: '-'.repeat(m), score: m > 0 ? gapOpen + gapExtend * m : 0 }
  }
  if (m === 1 || n === 1) {
    return nwFull(seqA, seqB, scorer, gapOpen, gapExtend)
  }

  const mid = Math.floor(m / 2)
  const topHalf = seqA.slice(0, mid)
  const botHalf = seqA.slice(mid)

  const scoreL = nwScoreRow(topHalf, seqB, scorer, gapOpen, gapExtend)
  const scoreR = nwScoreRow(reverseStr(botHalf), reverseStr(seqB), scorer, gapOpen, gapExtend)

  // Find optimal split point in seqB
  let bestJ = 0
  let bestScore = -Infinity
  for (let j = 0; j <= n; j++) {
    const total = scoreL[j] + scoreR[n - j]
    if (total > bestScore) {
      bestScore = total
      bestJ = j
    }
  }

  const left = hirschberg(topHalf, seqB.slice(0, bestJ), scorer, gapOpen, gapExtend)
  const right = hirschberg(botHalf, seqB.slice(bestJ), scorer, gapOpen, gapExtend)

  return {
    alignedA: left.alignedA + right.alignedA,
    alignedB: left.alignedB + right.alignedB,
    score: bestScore,
  }
}
