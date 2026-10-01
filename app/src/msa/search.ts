/**
 * Finding a motif in an alignment. Rows are searched without their gaps, so
 * a motif split by a gap in the alignment is still found; each hit is
 * reported as the columns it spans in its row.
 */

import { cleanResidues, columnOfResidue, ungapped, type AlnDoc } from './model'

export interface SearchHit {
  rowId: string
  /** First and last column of the hit (inclusive, then exclusive). */
  c0: number
  c1: number
}

const DNA_CODES: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: '[TU]', U: '[TU]', R: '[AGR]', Y: '[CTUY]', S: '[CGS]', W: '[ATUW]',
  K: '[GTUK]', M: '[ACM]', B: '[CGTUB]', D: '[AGTUD]', H: '[ACTUH]', V: '[ACGV]', N: '.',
}

/** A pattern for the motif; DNA motifs may use IUPAC codes, protein motifs may use X. */
function motifPattern(motif: string, kind: AlnDoc['kind']): RegExp | null {
  const clean = cleanResidues(motif, kind).replace(/-/g, '')
  if (!clean) return null
  const parts = [...clean].map(ch => {
    if (kind === 'dna') return DNA_CODES[ch] ?? ch.replace(/[*]/g, '\\*')
    if (ch === 'X') return '.'
    return ch === '*' ? '\\*' : ch
  })
  return new RegExp(`(?=(${parts.join('')}))`, 'g')
}

/** Every hit of `motif` in every row, top to bottom then left to right. Capped at `limit`. */
export function findMotif(doc: AlnDoc, motif: string, limit = 5000): SearchHit[] {
  const re = motifPattern(motif, doc.kind)
  if (!re) return []
  const hits: SearchHit[] = []
  for (const row of doc.rows) {
    const plain = ungapped(row.seq)
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(plain)) !== null) {
      const len = m[1].length
      const c0 = columnOfResidue(row, m.index)
      const c1 = columnOfResidue(row, m.index + len - 1) + 1
      hits.push({ rowId: row.id, c0, c1 })
      if (hits.length >= limit) return hits
      re.lastIndex = m.index + 1
    }
  }
  return hits
}

/** The column of residue `n` (1-based, in the row's own numbering) in a row, or -1. */
export function columnOfPosition(doc: AlnDoc, rowId: string, n: number): number {
  const row = doc.rows.find(r => r.id === rowId)
  if (!row) return -1
  return columnOfResidue(row, n - (row.start ?? 1))
}
