/**
 * The search settings: their defaults, the values the service accepts, and
 * how each is written in a request.
 *
 * EMBL-EBI takes the E-value threshold and the number of hits from fixed
 * lists, so the drawer offers exactly those, as menus, and nothing typed can
 * be refused.
 */

import { SYNTHETIC_CONSTRUCT_TAXID, type BlastProgram, type BlastSettings } from './types'

/** The E-value thresholds EMBL-EBI accepts, as it writes them. */
export const EVALUES = ['1e-200', '1e-100', '1e-50', '1e-10', '1e-5', '1e-4', '1e-3', '1e-2', '1e-1', '1.0', '10', '100', '1000']

/** The numbers of hits EMBL-EBI accepts. */
export const MAX_HITS = [5, 10, 20, 50, 100, 150, 200, 250, 500, 750, 1000]

export const DEFAULT_SETTINGS: BlastSettings = {
  program: 'megablast',
  database: 'em_std',
  evalue: 10,
  maxHits: 50,
  excludeSynthetic: false,
  organism: '',
  matrix: '',
  lowComplexity: 'default',
}

/** An E-value threshold as EMBL-EBI writes it: the closest of the values it accepts. */
export function evalueParam(evalue: number): string {
  let best = EVALUES[0]
  for (const v of EVALUES) if (Math.abs(Math.log10(Number(v)) - Math.log10(evalue)) < Math.abs(Math.log10(Number(best)) - Math.log10(evalue))) best = v
  return best
}

/** A number of hits as EMBL-EBI takes it: the smallest it accepts that is at least as many. */
export function maxHitsParam(n: number): number {
  return MAX_HITS.find(m => m >= n) ?? MAX_HITS[MAX_HITS.length - 1]
}

/** The scoring matrices for the protein programs; BLOSUM62 is the default. */
export const MATRICES = ['BLOSUM62', 'BLOSUM45', 'BLOSUM50', 'BLOSUM80', 'BLOSUM90', 'PAM30', 'PAM70', 'PAM250']

/** Whether a program scores with a protein matrix (every one but blastn and megablast). */
export function usesMatrix(program: BlastProgram): boolean {
  return program !== 'blastn' && program !== 'megablast'
}

/** Whether an organism entry is a taxid already: a bare number, or a name with "(taxid:N)". */
export function taxidIn(organism: string): string | null {
  const t = organism.trim()
  if (/^\d+$/.test(t)) return t
  return /\(taxid:?\s*(\d+)\)/i.exec(t)?.[1] ?? null
}

/** An organism entry as an Entrez term: a taxid, or a name in quotes. */
function organismTerm(organism: string): string {
  const taxid = taxidIn(organism)
  return taxid ? `txid${taxid}[Organism]` : `"${organism.trim().replace(/"/g, '')}"[Organism]`
}

/**
 * The Entrez query that limits a search handed to NCBI (ENTREZ_QUERY), or ''
 * for none: the organism, and leaving out synthetic constructs. `all[filter]`
 * stands for everything when only the exclusion is asked for.
 */
export function entrezQuery(s: Pick<BlastSettings, 'organism' | 'excludeSynthetic'>): string {
  const parts: string[] = []
  if (s.organism.trim()) parts.push(organismTerm(s.organism))
  const exclude = s.excludeSynthetic ? `NOT txid${SYNTHETIC_CONSTRUCT_TAXID}[Organism]` : ''
  if (!parts.length && !exclude) return ''
  return [parts.length ? parts.join(' AND ') : 'all[filter]', exclude].filter(Boolean).join(' ')
}
