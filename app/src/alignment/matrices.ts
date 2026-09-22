/**
 * Scoring matrices for sequence alignment.
 *
 * DNA: simple match/mismatch scoring.
 * Protein: BLOSUM62 substitution matrix.
 */

// ── DNA scorer ──────────────────────────────────────────────────────────────

export interface DnaScoring {
  match: number
  mismatch: number
}

/** Score two DNA/RNA bases. Case-insensitive. Treats U as T. */
export function scoreDna(a: string, b: string, s: DnaScoring): number {
  const au = a.toUpperCase() === 'U' ? 'T' : a.toUpperCase()
  const bu = b.toUpperCase() === 'U' ? 'T' : b.toUpperCase()
  return au === bu ? s.match : s.mismatch
}

// ── BLOSUM62 ────────────────────────────────────────────────────────────────

const AA_ORDER = 'ARNDCQEGHILKMFPSTWYV'
const AA_INDEX: Record<string, number> = {}
for (let i = 0; i < AA_ORDER.length; i++) AA_INDEX[AA_ORDER[i]] = i

// Upper-triangular BLOSUM62 values (row-major, including diagonal).
// Standard NCBI BLOSUM62 matrix for the 20 standard amino acids.
const BLOSUM62_FLAT = [
//  A   R   N   D   C   Q   E   G   H   I   L   K   M   F   P   S   T   W   Y   V
    4, -1, -2, -2,  0, -1, -1,  0, -2, -1, -1, -1, -1, -2, -1,  1,  0, -3, -2,  0, // A
        5,  0, -2, -3,  1,  0, -2,  0, -3, -2,  2, -1, -3, -2, -1, -1, -3, -2, -3, // R
            6,  1, -3,  0,  0,  0,  1, -3, -3,  0, -2, -3, -2,  1,  0, -4, -2, -3, // N
                6, -3,  0,  2, -1, -1, -3, -4, -1, -3, -3, -1,  0, -1, -4, -3, -3, // D
                    9, -3, -4, -3, -3, -1, -1, -3, -1, -2, -3, -1, -1, -2, -2, -1, // C
                        5,  2, -2,  0, -3, -2,  1,  0, -3, -1,  0, -1, -2, -1, -2, // Q
                            5, -2,  0, -3, -3,  1, -2, -3, -1,  0, -1, -3, -2, -2, // E
                                6, -2, -4, -4, -2, -3, -3, -2,  0, -2, -2, -3, -3, // G
                                    8, -3, -3, -1, -2, -1, -2, -1, -2, -2,  2, -3, // H
                                        4,  2, -3,  1,  0, -3, -2, -1, -3, -1,  3, // I
                                            4, -2,  2,  0, -3, -2, -1, -2, -1,  1, // L
                                                5, -1, -3, -1,  0, -1, -3, -2, -2, // K
                                                    5,  0, -2, -1, -1, -1, -1,  1, // M
                                                        6, -4, -2, -2,  1,  3, -1, // F
                                                            7, -1, -1, -4, -3, -2, // P
                                                                4,  1, -3, -2, -2, // S
                                                                    5, -2, -2,  0, // T
                                                                       11,  2, -3, // W
                                                                            7, -1, // Y
                                                                                4, // V
]

// Build full 20×20 symmetric matrix
const BLOSUM62: number[][] = Array.from({ length: 20 }, () => new Array(20).fill(0))
let idx = 0
for (let i = 0; i < 20; i++) {
  for (let j = i; j < 20; j++) {
    BLOSUM62[i][j] = BLOSUM62_FLAT[idx]
    BLOSUM62[j][i] = BLOSUM62_FLAT[idx]
    idx++
  }
}

/** Score two amino acids using BLOSUM62. Unknown residues score -1. */
export function scoreProtein(a: string, b: string): number {
  const ai = AA_INDEX[a.toUpperCase()]
  const bi = AA_INDEX[b.toUpperCase()]
  if (ai === undefined || bi === undefined) return -1
  return BLOSUM62[ai][bi]
}

/** Check if two amino acids are similar (BLOSUM62 score > 0). */
export function isSimilar(a: string, b: string): boolean {
  return scoreProtein(a, b) > 0
}

// ── Unified scorer ──────────────────────────────────────────────────────────

export type Scorer = (a: string, b: string) => number

export function makeDnaScorer(match: number, mismatch: number): Scorer {
  const s: DnaScoring = { match, mismatch }
  return (a, b) => scoreDna(a, b, s)
}

export function makeProteinScorer(): Scorer {
  return scoreProtein
}
