/**
 * Consensus sequence and per-column conservation from aligned sequences.
 */

/**
 * Compute consensus: most frequent residue per column.
 * Gap if >50% of sequences have a gap. Ties broken alphabetically.
 */
export function computeConsensus(alignedSeqs: string[]): string {
  if (alignedSeqs.length === 0) return ''
  const len = alignedSeqs[0].length
  const result: string[] = []

  for (let col = 0; col < len; col++) {
    const counts = new Map<string, number>()
    let gapCount = 0
    for (const seq of alignedSeqs) {
      const ch = seq[col]?.toUpperCase() ?? '-'
      if (ch === '-') {
        gapCount++
      } else {
        counts.set(ch, (counts.get(ch) ?? 0) + 1)
      }
    }

    if (gapCount > alignedSeqs.length / 2) {
      result.push('-')
    } else {
      let best = '-'
      let bestCount = 0
      for (const [ch, count] of counts) {
        if (count > bestCount || (count === bestCount && ch < best)) {
          best = ch
          bestCount = count
        }
      }
      result.push(best)
    }
  }

  return result.join('')
}

/**
 * Per-column conservation: fraction of sequences matching the consensus.
 * Gap columns get conservation 0.
 */
export function computeConservation(alignedSeqs: string[], consensus: string): number[] {
  if (alignedSeqs.length === 0) return []
  const len = consensus.length
  const result: number[] = []

  for (let col = 0; col < len; col++) {
    const con = consensus[col]?.toUpperCase()
    if (con === '-') {
      result.push(0)
      continue
    }
    let matches = 0
    for (const seq of alignedSeqs) {
      if (seq[col]?.toUpperCase() === con) matches++
    }
    result.push(matches / alignedSeqs.length)
  }

  return result
}

/**
 * Compute pairwise identity between two aligned sequences.
 * Identity = matching non-gap columns / alignment length (excluding double-gap columns).
 */
export function pairwiseIdentity(a: string, b: string): number {
  let matches = 0
  let compared = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i]
    if (ai === '-' && bi === '-') continue
    compared++
    if (ai.toUpperCase() === bi.toUpperCase()) matches++
  }
  return compared > 0 ? matches / compared : 0
}

/**
 * Compute NxN pairwise identity matrix for aligned sequences.
 */
export function pairwiseIdentityMatrix(alignedSeqs: string[]): number[][] {
  const n = alignedSeqs.length
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(1))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const id = pairwiseIdentity(alignedSeqs[i], alignedSeqs[j])
      matrix[i][j] = id
      matrix[j][i] = id
    }
  }
  return matrix
}

/**
 * Compute alignment statistics for a pairwise alignment.
 * @param similarityFn Optional function to check if two residues are similar (for protein).
 */
export function alignmentStats(
  alignedA: string,
  alignedB: string,
  similarityFn?: (a: string, b: string) => boolean,
): { identity: number; similarity: number; gaps: number; alignmentLength: number } {
  const len = alignedA.length
  let identical = 0
  let similar = 0
  let gapCols = 0
  let compared = 0

  for (let i = 0; i < len; i++) {
    const a = alignedA[i], b = alignedB[i]
    if (a === '-' || b === '-') {
      gapCols++
      continue
    }
    compared++
    if (a.toUpperCase() === b.toUpperCase()) {
      identical++
      similar++
    } else if (similarityFn?.(a, b)) {
      similar++
    }
  }

  return {
    identity: compared > 0 ? identical / compared : 0,
    similarity: compared > 0 ? similar / compared : 0,
    gaps: len > 0 ? gapCols / len : 0,
    alignmentLength: len,
  }
}
