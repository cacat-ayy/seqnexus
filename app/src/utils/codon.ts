/**
 * Translation with the standard genetic code.
 *
 * The table itself now lives in codon/genetic-codes.ts as NCBI table 1, next
 * to the other codes the optimizer offers. Keeping a second copy here is how
 * the two would eventually disagree, so this re-exports that one. Callers that
 * have no genetic code to work from keep using these functions unchanged.
 */

import { geneticCode, STANDARD_CODE_TABLE, translateCodonWith, translateWith } from '../codon/genetic-codes'

/** Standard genetic code codon table. */
export const CODON_TABLE: Record<string, string> = STANDARD_CODE_TABLE

const STANDARD = geneticCode(1)

/** Translate a single codon to its amino acid letter; ambiguous codons as translateCodonWith reads them. */
export function translateCodon(codon: string): string {
  return translateCodonWith(STANDARD, codon)
}

/** Translate a DNA string to an amino acid string. */
export function translate(dna: string): string {
  return translateWith(STANDARD, dna)
}
