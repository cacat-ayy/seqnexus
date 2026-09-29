/**
 * Translation with the standard genetic code.
 *
 * The table itself now lives in codon/genetic-codes.ts as NCBI table 1, next
 * to the other codes the optimizer offers. Keeping a second copy here is how
 * the two would eventually disagree, so this re-exports that one. Callers that
 * have no genetic code to work from keep using these functions unchanged.
 */

import { STANDARD_CODE_TABLE } from '../codon/genetic-codes'

/** Standard genetic code codon table. */
export const CODON_TABLE: Record<string, string> = STANDARD_CODE_TABLE

/** Translate a single codon to its amino acid letter. */
export function translateCodon(codon: string): string {
  return CODON_TABLE[codon.toUpperCase()] ?? '?'
}

/** Translate a DNA string to an amino acid string. */
export function translate(dna: string): string {
  const upper = dna.toUpperCase()
  const aas: string[] = []
  for (let i = 0; i + 2 < upper.length; i += 3) {
    aas.push(CODON_TABLE[upper.slice(i, i + 3)] ?? '?')
  }
  return aas.join('')
}
