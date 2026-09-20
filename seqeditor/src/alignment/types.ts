/** Shared types for the alignment engine. */

export interface AlignmentRequest {
  sequences: { name: string; bases: string }[]
  mode: 'global' | 'local'
  seqType: 'dna' | 'protein'
  scoring: {
    match?: number     // DNA only
    mismatch?: number  // DNA only
    matrix?: string    // Protein: 'BLOSUM62'
    gapOpen: number
    gapExtend: number
  }
  /** MSA engine preference. Default 'auto' tries MAFFT first, falls back to built-in. */
  engine?: 'auto' | 'mafft' | 'builtin'
}

export interface AlignedSequence {
  name: string
  alignedBases: string   // includes gap characters '-'
  originalBases: string
}

export interface AlignmentResult {
  sequences: AlignedSequence[]
  consensus: string
  conservation: number[] // per-column, 0.0–1.0
  score: number
  identity: number       // fraction 0–1
  similarity: number     // fraction 0–1
  gaps: number           // fraction 0–1
  alignmentLength: number
  pairwiseIdentityMatrix?: number[][] // for MSA: NxN identity fractions
  algorithm: 'nw' | 'sw' | 'msa' | 'mafft'
  /** Non-fatal warning to display to the user (e.g. engine fallback). */
  warning?: string
}

export const DEFAULT_DNA_SCORING = {
  match: 1,
  mismatch: -1,
  gapOpen: -10,
  gapExtend: -0.5,
}
