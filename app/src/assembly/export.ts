/**
 * A contig as an alignment (reference, consensus and reads, padded to the
 * full width), so every alignment format and the alignment workspace can
 * take it. Only for export: the contig itself never stores padded rows.
 */

import { makeDoc, type AlnDoc } from '../msa/model'
import { computeConsensus, type ConsensusSettings } from './consensus'
import type { ContigDoc } from './types'

export function contigToAlignment(doc: ContigDoc, name: string, consensus?: ConsensusSettings): AlnDoc {
  const cons = computeConsensus(doc, consensus)
  const pad = (start: number, seq: string) => '-'.repeat(Math.max(0, start)) + seq + '-'.repeat(Math.max(0, doc.width - start - seq.length))
  const rows = [
    ...(doc.reference ? [{ name: doc.reference.name, seq: doc.reference.seq }] : []),
    { name: `${name} consensus`, seq: cons.bases.replace(/ /g, '-') },
    ...doc.rows.map(r => ({ name: r.reversed ? `${r.name} (reversed)` : r.name, seq: pad(r.start, r.seq) })),
  ]
  const aln = makeDoc(rows, { method: 'manual', detail: doc.method === 'reference' ? `Reads mapped to ${doc.reference?.name}` : 'De novo contig', at: Date.now() }, 'dna')
  return doc.reference ? { ...aln, referenceId: aln.rows[0].id } : aln
}
