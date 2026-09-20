/**
 * Core alignment runner - shared between the Web Worker and main-thread fallback.
 */

import type { AlignmentRequest, AlignmentResult } from './types'
import { needlemanWunsch } from './nw'
import { smithWaterman } from './sw'
import { seededSmithWaterman } from './seeded'
import { progressiveMSA } from './msa'
import { makeDnaScorer, makeProteinScorer, isSimilar } from './matrices'
import {
  computeConsensus,
  computeConservation,
  alignmentStats,
  pairwiseIdentityMatrix,
} from './consensus'

// Max DP cells before we refuse to run (prevents browser tab from hanging).
// 500M cells ≈ a few seconds on modern hardware.
const MAX_DP_CELLS = 500_000_000

export function executeAlignment(req: AlignmentRequest): AlignmentResult {
  const { sequences, mode, seqType, scoring } = req

  const scorer = seqType === 'dna'
    ? makeDnaScorer(scoring.match ?? 1, scoring.mismatch ?? -1)
    : makeProteinScorer()

  const similarityFn = seqType === 'protein' ? isSimilar : undefined

  const names = sequences.map(s => s.name)
  const bases = sequences.map(s => s.bases)

  let alignedBases: string[]
  let score = 0
  let algorithm: 'nw' | 'sw' | 'msa'

  if (bases.length === 2) {
    if (mode === 'local') {
      const cells = bases[0].length * bases[1].length
      let r
      if (cells > MAX_DP_CELLS) {
        // Too large for full DP – use seed-and-extend
        r = seededSmithWaterman(bases[0], bases[1], scorer, scoring.gapOpen, scoring.gapExtend)
        if (r.score === 0) {
          throw new Error('No significant similarity found. The sequences may not be homologous.')
        }
      } else {
        r = smithWaterman(bases[0], bases[1], scorer, scoring.gapOpen, scoring.gapExtend)
      }
      alignedBases = [r.alignedA, r.alignedB]
      score = r.score
      algorithm = 'sw'
    } else {
      const cells = bases[0].length * bases[1].length
      if (cells > MAX_DP_CELLS) {
        throw new Error(
          `Global alignment too large (${(bases[0].length / 1000).toFixed(1)} kb × ${(bases[1].length / 1000).toFixed(1)} kb). ` +
          `Use local alignment mode for large sequences.`
        )
      }
      const r = needlemanWunsch(bases[0], bases[1], scorer, scoring.gapOpen, scoring.gapExtend)
      alignedBases = [r.alignedA, r.alignedB]
      score = r.score
      algorithm = 'nw'
    }
  } else {
    alignedBases = progressiveMSA(bases, scorer, scoring.gapOpen, scoring.gapExtend)
    algorithm = 'msa'
  }

  const consensus = computeConsensus(alignedBases)
  const conservation = computeConservation(alignedBases, consensus)

  const stats = bases.length === 2
    ? alignmentStats(alignedBases[0], alignedBases[1], similarityFn)
    : { identity: 0, similarity: 0, gaps: 0, alignmentLength: alignedBases[0]?.length ?? 0 }

  let identity = stats.identity
  let similarity = stats.similarity
  let gaps = stats.gaps
  let pairwiseMatrix: number[][] | undefined

  if (bases.length > 2) {
    pairwiseMatrix = pairwiseIdentityMatrix(alignedBases)
    let sum = 0, count = 0
    for (let i = 0; i < pairwiseMatrix.length; i++) {
      for (let j = i + 1; j < pairwiseMatrix.length; j++) {
        sum += pairwiseMatrix[i][j]
        count++
      }
    }
    identity = count > 0 ? sum / count : 0
    similarity = identity
    const alnLen = alignedBases[0]?.length ?? 0
    let gapCols = 0
    for (let col = 0; col < alnLen; col++) {
      for (const seq of alignedBases) {
        if (seq[col] === '-') { gapCols++; break }
      }
    }
    gaps = alnLen > 0 ? gapCols / alnLen : 0
  }

  return {
    sequences: alignedBases.map((aligned, i) => ({
      name: names[i],
      alignedBases: aligned,
      originalBases: bases[i],
    })),
    consensus,
    conservation,
    score,
    identity,
    similarity,
    gaps,
    alignmentLength: alignedBases[0]?.length ?? 0,
    pairwiseIdentityMatrix: pairwiseMatrix,
    algorithm,
  }
}
