/** Small contigs for tests. */

import type { ContigDoc, ContigRow } from './types'

export function testRow(id: string, start: number, seq: string, over: Partial<ContigRow> = {}): ContigRow {
  return {
    id, readId: null, name: id, reversed: false, start, seq, orig: seq,
    src: [...seq].map((ch, i) => (ch === '-' ? -1 : i)),
    qual: [...seq].map(ch => (ch === '-' ? 0 : 40)),
    ...over,
  }
}

/** A contig of the given rows; with `reference`, mapped to it (reference must span every column). */
export function testContig(rows: ContigRow[], reference?: string, refName = 'pUC19', tabId: string | null = null): ContigDoc {
  const width = Math.max(reference?.length ?? 0, ...rows.map(r => r.start + r.seq.length))
  return {
    method: reference ? 'reference' : 'de-novo',
    reference: reference ? { name: refName, tabId, length: reference.replace(/-/g, '').length, circular: false, seq: reference } : null,
    width,
    rows,
  }
}
