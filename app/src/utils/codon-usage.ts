/**
 * Codon usage over a document's CDS features, for the statistics popover.
 */

import type { Annotation } from '../models/Annotation'
import type { Sequence } from '../models/Sequence'
import { annotationCodingBases } from './annotation-sequence'
import { geneticCode, translateCodonWith } from '../codon/genetic-codes'

/**
 * Each CDS is read on its own strand, from its /codon_start, through its
 * exons, and translated with the code its /transl_table names (the standard
 * code when it names none, or one that doesn't exist).
 */
export function codonUsage(annotations: Annotation[], sequence: Sequence): Map<string, { aa: string; count: number }> | null {
  const cdsAnns = annotations.filter(a => a.type === 'CDS' && !a.id.startsWith('_orf_'))
  if (cdsAnns.length === 0) return null

  const counts = new Map<string, { aa: string; count: number }>()
  for (const ann of cdsAnns) {
    const code = geneticCode(parseInt(ann.qualifiers?.transl_table?.[0] ?? '', 10))
    const seq = annotationCodingBases(ann, sequence).toUpperCase()
    for (let i = 0; i + 2 < seq.length; i += 3) {
      const codon = seq.slice(i, i + 3)
      const entry = counts.get(codon)
      if (entry) entry.count++
      else counts.set(codon, { aa: translateCodonWith(code, codon), count: 1 })
    }
  }
  return counts.size > 0 ? counts : null
}
