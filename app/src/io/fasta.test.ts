import { describe, it, expect } from 'vitest'
import { readFasta } from './fasta'

describe('readFasta (M8)', () => {
  it('reads multi-record FASTA, naming records by the first word of the header', () => {
    const r = readFasta('>seq1 a description\nacgt\nACGT\n>seq2\nGGCC\n', 'file')
    expect(r.records).toEqual([{ name: 'seq1', bases: 'ACGTACGT' }, { name: 'seq2', bases: 'GGCC' }])
  })

  it('accepts plain RNA', () => {
    expect(readFasta('ACGUACGU\n', 'rna').records).toEqual([{ name: 'rna', bases: 'ACGUACGU' }])
  })

  it('sets protein records aside instead of opening them as DNA', () => {
    const r = readFasta('>dna\nACGT\n>prot\nMKVLAAGIVGLLLAAQPAMA\n', 'f')
    expect(r.records.map(x => x.name)).toEqual(['dna'])
    expect(r.proteins).toEqual(['prot'])
  })

  it('treats everything in a .faa file as protein', () => {
    const r = readFasta('>p1\nMKVAHD\n', 'f', true)
    expect(r.records).toEqual([])
    expect(r.proteins).toEqual(['p1'])
  })

  it('reports records that are neither', () => {
    expect(readFasta('>x\nAC#GT\n', 'f').unreadable).toEqual(['x'])
  })

  it('drops numbers, gaps and comment lines', () => {
    expect(readFasta(';comment\n>s\n1 ACG-T\n6 AC.GT\n', 'f').records[0].bases).toBe('ACGTACGT')
  })
})
