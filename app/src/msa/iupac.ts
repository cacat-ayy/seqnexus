/**
 * IUPAC nucleotide codes as 4-bit sets (A=1, C=2, G=4, T/U=8), for merging
 * rows and for ambiguity consensus.
 */

const BITS: Record<string, number> = {
  A: 1, C: 2, G: 4, T: 8, U: 8,
  R: 1 | 4, Y: 2 | 8, S: 2 | 4, W: 1 | 8, K: 4 | 8, M: 1 | 2,
  B: 2 | 4 | 8, D: 1 | 4 | 8, H: 1 | 2 | 8, V: 1 | 2 | 4, N: 15,
}

const CODE = ['', 'A', 'C', 'M', 'G', 'R', 'S', 'V', 'T', 'W', 'Y', 'H', 'K', 'D', 'B', 'N']

/** The base set a code stands for, or 0 for anything that is not a nucleotide code. */
export function baseBits(ch: string): number {
  return BITS[ch] ?? 0
}

/** The code for a base set; 'N' for the empty set, which never names a real base. */
export function codeForBits(bits: number): string {
  return CODE[bits & 15] || 'N'
}

/** Is `ch` a definite nucleotide (no ambiguity)? */
export function isPlainBase(ch: string): boolean {
  return ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U'
}
