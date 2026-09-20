/**
 * Smith-Waterman local alignment with affine gap penalties.
 *
 * For small matrices (m*n ≤ 50M cells), uses the standard O(mn) DP with
 * full traceback matrices. For larger inputs, uses a linear-memory
 * three-pass approach:
 *   1. Forward pass (O(n) memory) to find the best score and end position
 *   2. Reverse pass to find the start position
 *   3. Full DP only over the bounded local region
 */

import type { Scorer } from './matrices'

export interface SWResult {
  alignedA: string
  alignedB: string
  score: number
  /** 0-based start position in seqA of the local alignment */
  startA: number
  /** 0-based start position in seqB of the local alignment */
  startB: number
}

const MAX_FULL_CELLS = 50_000_000

export function smithWaterman(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): SWResult {
  const m = seqA.length
  const n = seqB.length

  if (m === 0 || n === 0) {
    return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }
  }

  if ((m + 1) * (n + 1) <= MAX_FULL_CELLS) {
    return swFull(seqA, seqB, m, n, scorer, gapOpen, gapExtend)
  }

  return swLinearMemory(seqA, seqB, m, n, scorer, gapOpen, gapExtend)
}

// ── Standard O(mn) implementation ──

function swFull(
  seqA: string, seqB: string,
  m: number, n: number,
  scorer: Scorer, gapOpen: number, gapExtend: number,
): SWResult {
  const NEG_INF = -1e9

  const M  = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Ix = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const Iy = Array.from({ length: m + 1 }, () => new Float64Array(n + 1))
  const trM  = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIx = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))
  const trIy = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1))

  for (let i = 0; i <= m; i++) { Ix[i][0] = NEG_INF; Iy[i][0] = NEG_INF }
  for (let j = 0; j <= n; j++) { Ix[0][j] = NEG_INF; Iy[0][j] = NEG_INF }

  let maxScore = 0, maxI = 0, maxJ = 0, maxMat = 0

  for (let i = 1; i <= m; i++) {
    const ai = seqA[i - 1]
    for (let j = 1; j <= n; j++) {
      const bj = seqB[j - 1]
      const s = scorer(ai, bj)

      const mFromM = M[i-1][j-1] + s, mFromIx = Ix[i-1][j-1] + s, mFromIy = Iy[i-1][j-1] + s
      const mBest = Math.max(mFromM, mFromIx, mFromIy, 0)
      if (mBest <= 0) { M[i][j] = 0; trM[i][j] = 3 }
      else if (mBest === mFromM) { M[i][j] = mFromM; trM[i][j] = 0 }
      else if (mBest === mFromIx) { M[i][j] = mFromIx; trM[i][j] = 1 }
      else { M[i][j] = mFromIy; trM[i][j] = 2 }

      const ixFromM = M[i-1][j] + gapOpen + gapExtend, ixFromIx = Ix[i-1][j] + gapExtend
      if (ixFromM >= ixFromIx && ixFromM > 0) { Ix[i][j] = ixFromM; trIx[i][j] = 0 }
      else if (ixFromIx > 0) { Ix[i][j] = ixFromIx; trIx[i][j] = 1 }
      else { Ix[i][j] = 0; trIx[i][j] = 3 }

      const iyFromM = M[i][j-1] + gapOpen + gapExtend, iyFromIy = Iy[i][j-1] + gapExtend
      if (iyFromM >= iyFromIy && iyFromM > 0) { Iy[i][j] = iyFromM; trIy[i][j] = 0 }
      else if (iyFromIy > 0) { Iy[i][j] = iyFromIy; trIy[i][j] = 2 }
      else { Iy[i][j] = 0; trIy[i][j] = 3 }

      const cellMax = Math.max(M[i][j], Ix[i][j], Iy[i][j])
      if (cellMax > maxScore) {
        maxScore = cellMax; maxI = i; maxJ = j
        maxMat = cellMax === M[i][j] ? 0 : cellMax === Ix[i][j] ? 1 : 2
      }
    }
  }

  if (maxScore <= 0) return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }

  const alnA: string[] = [], alnB: string[] = []
  let i = maxI, j = maxJ, mat = maxMat

  while (i > 0 || j > 0) {
    if (i === 0) { alnA.push('-'); alnB.push(seqB[j-1]); j--; continue }
    if (j === 0) { alnA.push(seqA[i-1]); alnB.push('-'); i--; continue }
    let tr: number
    if (mat === 0) { tr = trM[i][j]; if (tr === 3) break; alnA.push(seqA[i-1]); alnB.push(seqB[j-1]); i--; j-- }
    else if (mat === 1) { tr = trIx[i][j]; if (tr === 3) break; alnA.push(seqA[i-1]); alnB.push('-'); i-- }
    else { tr = trIy[i][j]; if (tr === 3) break; alnA.push('-'); alnB.push(seqB[j-1]); j-- }
    mat = tr
  }

  return { alignedA: alnA.reverse().join(''), alignedB: alnB.reverse().join(''), score: maxScore, startA: i, startB: j }
}

// ── Linear-memory implementation for large inputs ──

/** Forward SW scan using O(n) memory. Returns best score and end position. */
function swForwardScan(
  seqA: string, seqB: string,
  m: number, n: number,
  scorer: Scorer, gapOpen: number, gapExtend: number,
): { score: number; endI: number; endJ: number } {
  const NEG_INF = -1e9

  let pM  = new Float64Array(n + 1)
  let pIx = new Float64Array(n + 1)
  let pIy = new Float64Array(n + 1)
  let cM  = new Float64Array(n + 1)
  let cIx = new Float64Array(n + 1)
  let cIy = new Float64Array(n + 1)

  pIx.fill(NEG_INF)
  pIy.fill(NEG_INF)

  let maxScore = 0, endI = 0, endJ = 0

  for (let i = 1; i <= m; i++) {
    const ai = seqA[i - 1]
    cM.fill(0); cIx.fill(0); cIy.fill(0)

    for (let j = 1; j <= n; j++) {
      const s = scorer(ai, seqB[j - 1])

      cM[j] = Math.max(pM[j-1] + s, pIx[j-1] + s, pIy[j-1] + s, 0)
      cIx[j] = Math.max(pM[j] + gapOpen + gapExtend, pIx[j] + gapExtend, 0)
      cIy[j] = Math.max(cM[j-1] + gapOpen + gapExtend, cIy[j-1] + gapExtend, 0)

      const best = Math.max(cM[j], cIx[j], cIy[j])
      if (best > maxScore) { maxScore = best; endI = i; endJ = j }
    }

    let t: Float64Array
    t = pM; pM = cM; cM = t
    t = pIx; pIx = cIx; cIx = t
    t = pIy; pIy = cIy; cIy = t
  }

  return { score: maxScore, endI, endJ }
}

function swLinearMemory(
  seqA: string, seqB: string,
  m: number, n: number,
  scorer: Scorer, gapOpen: number, gapExtend: number,
): SWResult {
  // Ensure seqA is the shorter sequence for efficiency
  const swapped = m > n
  if (swapped) {
    [seqA, seqB] = [seqB, seqA];
    [m, n] = [n, m]
  }

  // Pass 1: find end position
  const fwd = swForwardScan(seqA, seqB, m, n, scorer, gapOpen, gapExtend)
  if (fwd.score <= 0) {
    return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }
  }

  // Pass 2: find start position by running forward scan on reversed subsequences
  const revA = reverseSlice(seqA, 0, fwd.endI)
  const revB = reverseSlice(seqB, 0, fwd.endJ)
  const rev = swForwardScan(revA, revB, revA.length, revB.length, scorer, gapOpen, gapExtend)

  const startI = fwd.endI - rev.endI
  const startJ = fwd.endJ - rev.endJ

  // Pass 3: full DP on the bounded subregion
  const subA = seqA.slice(startI, fwd.endI)
  const subB = seqB.slice(startJ, fwd.endJ)

  // The subregion should be small enough for full DP (query length × local hit length)
  const sub = swFull(subA, subB, subA.length, subB.length, scorer, gapOpen, gapExtend)

  if (swapped) {
    return {
      alignedA: sub.alignedB,
      alignedB: sub.alignedA,
      score: fwd.score,
      startA: startJ + sub.startB,
      startB: startI + sub.startA,
    }
  }

  return {
    alignedA: sub.alignedA,
    alignedB: sub.alignedB,
    score: fwd.score,
    startA: startI + sub.startA,
    startB: startJ + sub.startB,
  }
}

function reverseSlice(s: string, start: number, end: number): string {
  let r = ''
  for (let i = end - 1; i >= start; i--) r += s[i]
  return r
}
