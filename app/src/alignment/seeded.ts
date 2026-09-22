/**
 * Seeded local alignment for large sequence pairs.
 *
 * Uses a seed-and-extend strategy (similar to BLAST/minimap2):
 *   1. Build a k-mer hash index of the reference
 *   2. Find seed matches from the query
 *   3. Chain seeds along diagonals
 *   4. Extract a bounded reference region around the best chain
 *   5. Run Smith-Waterman on the bounded region
 *
 * This reduces a 4kb × 4.6Mb alignment to a hash lookup + SW on ~4kb × ~8kb.
 */

import type { Scorer } from './matrices'
import { smithWaterman, type SWResult } from './sw'

const K = 11 // k-mer size for DNA seeds
const MAX_BOUNDED_CELLS = 40_000_000 // max cells before switching to banded SW

interface Seed {
  queryPos: number
  refPos: number
  diagonal: number // refPos - queryPos
}

interface Chain {
  diagonal: number
  seeds: Seed[]
  refStart: number
  refEnd: number
  queryStart: number
  queryEnd: number
}

/**
 * Build a k-mer index for the reference sequence.
 * Returns a Map from k-mer string to array of positions.
 *
 * To limit memory on highly repetitive genomes, k-mers that occur
 * more than maxOcc times are skipped (they're uninformative).
 */
function buildKmerIndex(ref: string, k: number, maxOcc = 500): Map<string, number[]> {
  const index = new Map<string, number[]>()
  const upper = ref.toUpperCase()
  const limit = upper.length - k + 1

  for (let i = 0; i < limit; i++) {
    const kmer = upper.substring(i, i + k)
    // Skip k-mers with ambiguous bases
    if (kmer.indexOf('N') >= 0) continue
    const arr = index.get(kmer)
    if (arr) {
      if (arr.length < maxOcc) arr.push(i)
      // If already at maxOcc, stop adding (over-represented k-mer)
    } else {
      index.set(kmer, [i])
    }
  }

  return index
}

/**
 * Find seed matches between query and reference using the k-mer index.
 */
function findSeeds(query: string, index: Map<string, number[]>, k: number): Seed[] {
  const seeds: Seed[] = []
  const upper = query.toUpperCase()
  const limit = upper.length - k + 1

  for (let qp = 0; qp < limit; qp++) {
    const kmer = upper.substring(qp, qp + k)
    const hits = index.get(kmer)
    if (!hits) continue
    for (const rp of hits) {
      seeds.push({ queryPos: qp, refPos: rp, diagonal: rp - qp })
    }
  }

  return seeds
}

/**
 * Chain seeds by diagonal proximity.
 *
 * Groups seeds into diagonal bands (allowing some tolerance),
 * then finds the best chain by seed count.
 */
function chainSeeds(seeds: Seed[], bandWidth: number): Chain | null {
  if (seeds.length === 0) return null

  // Sort seeds by diagonal
  seeds.sort((a, b) => a.diagonal - b.diagonal)

  // Group into diagonal bands
  const chains: Chain[] = []
  let chainStart = 0

  for (let i = 1; i <= seeds.length; i++) {
    // End of array or diagonal gap exceeds bandwidth
    if (i === seeds.length || seeds[i].diagonal - seeds[i - 1].diagonal > bandWidth) {
      const band = seeds.slice(chainStart, i)
      // Sort within band by query position
      band.sort((a, b) => a.queryPos - b.queryPos)

      const refPositions = band.map(s => s.refPos)
      const queryPositions = band.map(s => s.queryPos)

      chains.push({
        diagonal: band[Math.floor(band.length / 2)].diagonal,
        seeds: band,
        refStart: Math.min(...refPositions),
        refEnd: Math.max(...refPositions) + K,
        queryStart: Math.min(...queryPositions),
        queryEnd: Math.max(...queryPositions) + K,
      })

      chainStart = i
    }
  }

  // Return the chain with the most seeds
  let best: Chain | null = null
  for (const c of chains) {
    if (!best || c.seeds.length > best.seeds.length) {
      best = c
    }
  }

  return best
}

export interface SeededSWResult extends SWResult {
  /** Offset into the original reference where the bounded region started */
  refOffset: number
}

/**
 * Seeded Smith-Waterman alignment.
 *
 * Automatically determines which sequence is the query (shorter) and
 * which is the reference (longer). Builds a k-mer index of the reference,
 * finds seed matches, chains them, and runs SW on the bounded region.
 */
export function seededSmithWaterman(
  seqA: string,
  seqB: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
): SWResult {
  // The shorter sequence is the query, longer is the reference
  const aIsQuery = seqA.length <= seqB.length
  const query = aIsQuery ? seqA : seqB
  const ref = aIsQuery ? seqB : seqA

  // Step 1: Build k-mer index of the reference
  const index = buildKmerIndex(ref, K)

  // Step 2: Find seeds
  const seeds = findSeeds(query, index, K)

  if (seeds.length === 0) {
    return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }
  }

  // Step 3: Chain seeds
  // Band width: allow diagonals within ~10% of query length to merge
  const bandWidth = Math.max(50, Math.floor(query.length * 0.1))
  const chain = chainSeeds(seeds, bandWidth)

  if (!chain) {
    return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }
  }

  // Step 4: Extract bounded reference region
  // Padding proportional to chain span, not query length
  const chainSpan = chain.refEnd - chain.refStart
  const padding = Math.max(Math.floor(chainSpan * 0.2), 500)
  const refStart = Math.max(0, chain.refStart - padding)
  const refEnd = Math.min(ref.length, chain.refEnd + padding)
  const subRef = ref.slice(refStart, refEnd)
  const subQuery = query

  // Step 5: Align the bounded region
  const boundedCells = subQuery.length * subRef.length
  let result: SWResult

  if (boundedCells <= MAX_BOUNDED_CELLS) {
    // Small enough for full SW
    result = smithWaterman(subQuery, subRef, scorer, gapOpen, gapExtend)
  } else {
    // Use banded SW along the chain diagonal
    const diagOffset = chain.diagonal - refStart // diagonal in subRef coordinates
    const band = Math.max(500, Math.floor(subQuery.length * 0.05))
    result = bandedSmithWaterman(subQuery, subRef, scorer, gapOpen, gapExtend, diagOffset, band)
  }

  // Adjust positions back to original reference coordinates
  if (aIsQuery) {
    return {
      alignedA: result.alignedA,
      alignedB: result.alignedB,
      score: result.score,
      startA: result.startA,
      startB: result.startB + refStart,
    }
  } else {
    // seqA was the reference, seqB was the query – swap back
    return {
      alignedA: result.alignedB,
      alignedB: result.alignedA,
      score: result.score,
      startA: result.startA + refStart,
      startB: result.startB,
    }
  }
}

/**
 * Banded Smith-Waterman: only compute cells within ±band of a target diagonal.
 *
 * The diagonal is defined as refPos - queryPos = diagOffset.
 * For each row i (query position), we only compute columns j where
 * |j - (i + diagOffset)| ≤ band.
 *
 * Memory: O(band × m) via rolling rows. Time: O(m × 2*band).
 */
function bandedSmithWaterman(
  query: string,
  ref: string,
  scorer: Scorer,
  gapOpen: number,
  gapExtend: number,
  diagOffset: number,
  band: number,
): SWResult {
  const m = query.length
  const n = ref.length
  const W = 2 * band + 1 // band width

  // Map column j to band index: bandIdx = j - jStart
  // For row i: jStart = max(1, i + diagOffset - band)
  //            jEnd   = min(n, i + diagOffset + band)

  // Use rolling arrays of size W+2 (with padding)
  const arrSize = W + 2
  let pM  = new Float64Array(arrSize)
  let pIx = new Float64Array(arrSize)
  let pIy = new Float64Array(arrSize)
  let cM  = new Float64Array(arrSize)
  let cIx = new Float64Array(arrSize)
  let cIy = new Float64Array(arrSize)

  // Traceback: store (mat, i, j) for each cell – but that's too much memory
  // for large inputs. Instead, use the same 2-pass approach: find end, reverse
  // to find start, then do banded DP on the small subregion.

  // --- Pass 1: Forward scan to find best score and end position ---
  let maxScore = 0, endI = 0, endJ = 0
  let prevJStart = 0

  for (let i = 1; i <= m; i++) {
    const ai = query[i - 1]
    const jCenter = i + diagOffset
    const jStart = Math.max(1, jCenter - band)
    const jEnd = Math.min(n, jCenter + band)

    cM.fill(0)
    cIx.fill(0)
    cIy.fill(0)

    for (let j = jStart; j <= jEnd; j++) {
      const bj = ref[j - 1]
      const s = scorer(ai, bj)
      const bi = j - jStart // band index for current row

      // Previous row band index for column j and j-1
      const pbi = j - prevJStart     // j in previous row's band
      const pbiM1 = j - 1 - prevJStart // j-1 in previous row's band

      // M[i][j] = max(prev_M[j-1] + s, prev_Ix[j-1] + s, prev_Iy[j-1] + s, 0)
      let diagM = 0, diagIx = 0, diagIy = 0
      if (pbiM1 >= 0 && pbiM1 < arrSize) {
        diagM = pM[pbiM1]; diagIx = pIx[pbiM1]; diagIy = pIy[pbiM1]
      }
      cM[bi] = Math.max(diagM + s, diagIx + s, diagIy + s, 0)

      // Ix[i][j] = max(prev_M[j] + gapOpen + gapExtend, prev_Ix[j] + gapExtend, 0)
      let upM = 0, upIx = 0
      if (pbi >= 0 && pbi < arrSize) {
        upM = pM[pbi]; upIx = pIx[pbi]
      }
      cIx[bi] = Math.max(upM + gapOpen + gapExtend, upIx + gapExtend, 0)

      // Iy[i][j] = max(cur_M[j-1] + gapOpen + gapExtend, cur_Iy[j-1] + gapExtend, 0)
      const leftBi = bi - 1
      let leftM = 0, leftIy = 0
      if (leftBi >= 0) {
        leftM = cM[leftBi]; leftIy = cIy[leftBi]
      }
      cIy[bi] = Math.max(leftM + gapOpen + gapExtend, leftIy + gapExtend, 0)

      const best = Math.max(cM[bi], cIx[bi], cIy[bi])
      if (best > maxScore) {
        maxScore = best; endI = i; endJ = j
      }
    }

    prevJStart = jStart
    let t: Float64Array
    t = pM; pM = cM; cM = t
    t = pIx; pIx = cIx; cIx = t
    t = pIy; pIy = cIy; cIy = t
  }

  if (maxScore <= 0) {
    return { alignedA: '', alignedB: '', score: 0, startA: 0, startB: 0 }
  }

  // --- Pass 2: Reverse scan to find start position ---
  const revQ = reverseStr(query, 0, endI)
  const revR = reverseStr(ref, 0, endJ)
  const rm = revQ.length, rn = revR.length
  // The diagonal in reversed coordinates
  const revDiag = (endJ - 1) - (endI - 1) // same as endJ - endI = diagOffset (approximately)

  pM  = new Float64Array(arrSize); pIx = new Float64Array(arrSize); pIy = new Float64Array(arrSize)
  cM  = new Float64Array(arrSize); cIx = new Float64Array(arrSize); cIy = new Float64Array(arrSize)

  let revMax = 0, startI = 0, startJ = 0
  prevJStart = 0

  for (let i = 1; i <= rm; i++) {
    const ai = revQ[i - 1]
    const jCenter = i + revDiag
    const jStart = Math.max(1, jCenter - band)
    const jEnd = Math.min(rn, jCenter + band)

    cM.fill(0); cIx.fill(0); cIy.fill(0)

    for (let j = jStart; j <= jEnd; j++) {
      const s = scorer(ai, revR[j - 1])
      const bi = j - jStart
      const pbi = j - prevJStart
      const pbiM1 = j - 1 - prevJStart

      let diagM = 0, diagIx = 0, diagIy = 0
      if (pbiM1 >= 0 && pbiM1 < arrSize) { diagM = pM[pbiM1]; diagIx = pIx[pbiM1]; diagIy = pIy[pbiM1] }
      cM[bi] = Math.max(diagM + s, diagIx + s, diagIy + s, 0)

      let upM = 0, upIx = 0
      if (pbi >= 0 && pbi < arrSize) { upM = pM[pbi]; upIx = pIx[pbi] }
      cIx[bi] = Math.max(upM + gapOpen + gapExtend, upIx + gapExtend, 0)

      const leftBi = bi - 1
      let leftM = 0, leftIy = 0
      if (leftBi >= 0) { leftM = cM[leftBi]; leftIy = cIy[leftBi] }
      cIy[bi] = Math.max(leftM + gapOpen + gapExtend, leftIy + gapExtend, 0)

      const best = Math.max(cM[bi], cIx[bi], cIy[bi])
      if (best > revMax) { revMax = best; startI = i; startJ = j }
    }

    prevJStart = jStart
    let t: Float64Array
    t = pM; pM = cM; cM = t
    t = pIx; pIx = cIx; cIx = t
    t = pIy; pIy = cIy; cIy = t
  }

  const fwdStartI = endI - startI
  const fwdStartJ = endJ - startJ

  // --- Pass 3: Full SW on the small bounded subregion ---
  const subQ = query.slice(fwdStartI, endI)
  const subR = ref.slice(fwdStartJ, endJ)
  const sub = smithWaterman(subQ, subR, scorer, gapOpen, gapExtend)

  return {
    alignedA: sub.alignedA,
    alignedB: sub.alignedB,
    score: maxScore,
    startA: fwdStartI + sub.startA,
    startB: fwdStartJ + sub.startB,
  }
}

function reverseStr(s: string, start: number, end: number): string {
  let r = ''
  for (let i = end - 1; i >= start; i--) r += s[i]
  return r
}
