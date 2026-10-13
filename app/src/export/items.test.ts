import { describe, it, expect } from 'vitest'
import { combinable, exportWarnings, itemFile, type ExportItem } from './items'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { makeDoc } from '../msa/model'
import { readFasta, recordName } from '../io/fasta'
import { parseGenBankMulti } from '../io/genbank'

const seq = (name: string, bases = 'ATGAAATTTGGGCCC'.repeat(4), patch: Partial<DocumentState> = {}): ExportItem =>
  ({ kind: 'sequence', doc: { name, sequence: new Sequence(bases, 'linear'), annotations: [], ...patch } })

describe('itemFile', () => {
  it('writes FASTA so a name with spaces and a description come back', () => {
    const plain = itemFile(seq('pUC19 mod'), 'fasta').data as string
    expect(plain.split('\n')[0]).toBe('>pUC19_mod pUC19 mod')
    expect(recordName(readFasta(plain, 'x').records[0])).toEqual({ name: 'pUC19 mod' })

    const described = itemFile(seq('pUC19 mod', undefined, { description: 'a cloning vector' }), 'fasta').data as string
    expect(described.split('\n')[0]).toBe('>pUC19_mod a cloning vector')
    expect(recordName(readFasta(described, 'x').records[0])).toEqual({ name: 'pUC19_mod', description: 'a cloning vector' })
  })

  it('leaves an id without spaces alone', () => {
    expect((itemFile(seq('pUC19'), 'fasta').data as string).split('\n')[0]).toBe('>pUC19')
  })

  it('writes a protein as GenPept, even when SnapGene was asked for', () => {
    const protein: ExportItem = { kind: 'sequence', doc: { name: 'Ubq', sequence: new Sequence('MQIFVKTLTG', 'linear', 'protein'), annotations: [] } }
    for (const format of ['gb', 'dna'] as const) {
      const f = itemFile(protein, format)
      expect(f.ext).toBe('.gp')
      expect(f.data as string).toMatch(/^LOCUS .* aa /)
    }
  })

  it('keeps a file name free of characters file systems refuse', () => {
    expect(itemFile(seq('a/b: c'), 'gb').base).toBe('a_b_ c')
  })

  it('combines GenBank records into a file that reads back as all of them', () => {
    const text = ['one', 'two'].map(n => itemFile(seq(n), 'gb').data as string).join('')
    expect(parseGenBankMulti(text).map(d => d.name)).toEqual(['one', 'two'])
  })

  it('gives an alignment its name as the title and the format extension', () => {
    const doc = makeDoc([{ name: 'a', seq: 'AC-T' }, { name: 'b', seq: 'ACGT' }], { method: 'manual', at: 0 }, 'dna')
    const f = itemFile({ kind: 'alignment', name: 'My alignment', doc }, 'nexus')
    expect(f.ext).toBe('.nex')
    expect(f.base).toBe('My_alignment')
  })
})

describe('combinable', () => {
  it('combines only formats whose files hold several items', () => {
    expect(['gb', 'fasta', 'fastq'].every(f => combinable(f as never))).toBe(true)
    expect(['aligned-fasta', 'clustal', 'phylip', 'nexus', 'dna', 'gff3', 'csv'].some(f => combinable(f as never))).toBe(false)
  })
})

describe('exportWarnings', () => {
  it('names primers a GenBank or GFF3 file cannot hold', () => {
    const item = seq('p', undefined, { primers: [{ id: 'x', name: 'nowhere', sequence: 'CCCCCCCCCCCCCCCCCCCC', role: 'primer' }] })
    expect(exportWarnings([item], 'gb')[0]).toContain('nowhere')
    expect(exportWarnings([item], 'gff3')).toHaveLength(1)
    expect(exportWarnings([item], 'fasta')).toEqual([])
  })
})
