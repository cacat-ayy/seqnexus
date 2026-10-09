/**
 * A protein as DNA: each residue gets the codon its host uses most, and the
 * result is then optimized like any coding sequence (the constraints and the
 * strategy in the optimizer apply to it). The seed is what the optimizer
 * reports as "before".
 */

import type { GeneticCode } from './genetic-codes'
import { synonymsFor } from './genetic-codes'
import { familyFractions, type CodonUsageTable } from './usage-tables'

/** What an ambiguity code is back-translated as. */
const RESOLVE: Readonly<Record<string, string>> = { B: 'D', Z: 'E', J: 'I' }

export interface BackTranslation {
  bases: string
  /** Residues no codon exists for (X, U, O), each once, in order of appearance. */
  unencodable: string[]
}

export function backTranslate(residues: string, code: GeneticCode, table: CodonUsageTable): BackTranslation {
  const fractions = familyFractions(table, code)
  const best = new Map<string, string>()
  const codonFor = (aa: string): string | null => {
    let c = best.get(aa)
    if (c) return c
    const family = synonymsFor(code, aa)
    if (family.length === 0) return null
    c = family.reduce((a, b) => ((fractions[b] ?? 0) > (fractions[a] ?? 0) ? b : a))
    best.set(aa, c)
    return c
  }
  const out: string[] = []
  const unencodable: string[] = []
  for (const raw of residues) {
    const aa = RESOLVE[raw.toUpperCase()] ?? raw.toUpperCase()
    const c = codonFor(aa)
    if (!c) {
      if (!unencodable.includes(raw.toUpperCase())) unencodable.push(raw.toUpperCase())
      continue
    }
    out.push(c)
  }
  return { bases: out.join(''), unencodable }
}
