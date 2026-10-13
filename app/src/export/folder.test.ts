import { describe, it, expect } from 'vitest'
import { folderExport } from './folder'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { makeDoc } from '../msa/model'

const doc = (name: string, alphabet: 'dna' | 'protein' = 'dna'): DocumentState =>
  ({ name, sequence: new Sequence(alphabet === 'dna' ? 'ACGTACGTAC' : 'MKVLAA', 'linear', alphabet), annotations: [] })

function state() {
  return {
    folders: [
      { id: 'f1', name: 'Project', parentId: null, itemUids: ['sequence:t1', 'protein:t2', 'oligo:o1', 'gel:g1', 'alignment:a1'] },
      { id: 'f2', name: 'Clones', parentId: 'f1', itemUids: ['sequence:t3'] },
      { id: 'f3', name: 'Elsewhere', parentId: null, itemUids: ['sequence:t4'] },
    ],
    tabs: [
      { id: 't1', doc: doc('pUC19') }, { id: 't2', doc: doc('Ubq', 'protein') },
      { id: 't3', doc: doc('clone 1') }, { id: 't4', doc: doc('other') },
    ],
    activeTabId: null,
    sequencingReads: [], contigs: [], assemblies: [],
    alignments: [{ id: 'a1', name: 'my aln', doc: makeDoc([{ name: 'x', seq: 'AC-T' }, { name: 'y', seq: 'ACGT' }], { method: 'manual', at: 0 }) }],
    oligos: [{ id: 'o1', name: 'fwd', sequence: 'ACGTACGTACGTACGTAA', role: 'primer', createdAt: 0 }],
  }
}

describe('folderExport', () => {
  it('writes a folder and its subfolders in each kind’s open format', () => {
    const out = folderExport(state() as never, 'f1', doc('unused'))
    expect(out.entries.map(e => e.path).sort()).toEqual([
      'Project/Clones/clone 1.gb', 'Project/Ubq.gp', 'Project/my_aln.fasta', 'Project/oligos.csv', 'Project/pUC19.gb',
    ])
    expect(out.skipped).toEqual({ gel: 1 })
    expect(out.written).toBe(5)
  })
})
