/**
 * IUPAC nucleotide codes as the bases they stand for, and as a regular
 * expression.
 *
 * This lives apart from the restriction enzyme database because everything
 * that matches an ambiguous pattern needs it: enzyme recognition sites, PAMs,
 * find, primer binding. Importing it from `enzymes/db.ts` meant pulling the
 * whole enzyme table into a worker that only wanted the six lines below.
 *
 * The same codes as 4-bit sets, for merging and consensus, are in
 * `msa/iupac.ts`.
 */

export const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'GC', W: 'AT',
  K: 'GT', M: 'AC', B: 'CGT', D: 'AGT',
  H: 'ACT', V: 'ACG', N: 'ACGT',
}

/**
 * A sequence of IUPAC codes as a regex pattern. Case-insensitive at the
 * match site, not here: anything not a code is passed through, so a pattern
 * carrying its own syntax still works.
 */
export function recognitionToRegex(recognition: string): string {
  return recognition.split('').map(c => {
    const expanded = IUPAC[c.toUpperCase()]
    if (!expanded) return c
    if (expanded.length === 1) return expanded
    return `[${expanded}]`
  }).join('')
}
