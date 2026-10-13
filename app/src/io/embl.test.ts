import { describe, it, expect } from 'vitest'
import { looksLikeEmbl, parseEmbl, writeEmbl } from './embl'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

const EMBL = `ID   X56734; SV 1; linear; mRNA; STD; PLN; 40 BP.
XX
AC   X56734; S46826;
XX
DE   Trifolium repens mRNA for non-cyanogenic beta-glucosidase,
DE   partial cds
XX
FH   Key             Location/Qualifiers
FH
FT   source          1..40
FT                   /organism="Trifolium repens"
FT   CDS             join(3..10,21..30)
FT                   /gene="lin1"
FT                   /product="non-cyanogenic beta-glucosidase with a name that
FT                   runs on"
FT   misc_feature    complement(31..38)
FT                   /note="reverse"
XX
SQ   Sequence 40 BP; 10 A; 10 C; 10 G; 10 T; 0 other;
     acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt                              40
//
ID   PLASMID1; SV 1; circular; genomic DNA; STD; SYN; 12 BP.
DE   A small circle
SQ   Sequence 12 BP;
     aaaacccggg tt                                                            12
//
`

describe('EMBL', () => {
  it('is recognised by its ID line', () => {
    expect(looksLikeEmbl(EMBL)).toBe(true)
    expect(looksLikeEmbl('LOCUS       pX 12 bp')).toBe(false)
  })

  it('reads records with their features, as the GenBank reader does', () => {
    const [first, second] = parseEmbl(EMBL)
    expect(first.name).toBe('X56734')
    expect(first.description).toBe('Trifolium repens mRNA for non-cyanogenic beta-glucosidase, partial cds')
    expect(first.sequence.bases).toBe('ACGT'.repeat(10))
    expect(first.sequence.topology).toBe('linear')

    const cds = first.annotations.find(a => a.type === 'CDS')!
    expect([cds.start, cds.end]).toEqual([2, 30])
    expect(cds.segments).toEqual([[2, 10], [20, 30]])
    expect(cds.qualifiers?.product?.[0]).toBe('non-cyanogenic beta-glucosidase with a name that runs on')
    const rev = first.annotations.find(a => a.type === 'misc_feature')!
    expect(rev.strand).toBe(-1)
    expect([rev.start, rev.end]).toEqual([30, 38])

    expect(second.name).toBe('PLASMID1')
    expect(second.description).toBe('A small circle')
    expect(second.sequence.topology).toBe('circular')
    expect(second.sequence.bases).toBe('AAAACCCGGGTT')
  })
})

describe('writeEmbl', () => {
  const bases = 'ATGAAAGCTTGGTAACCCGGGAAATTTCCCGGG'.repeat(5)
  const doc = (): DocumentState => ({
    name: 'pTest v2',
    description: 'A test construct',
    sequence: new Sequence(bases, 'circular'),
    annotations: [
      new Annotation({ id: 'a', name: 'exons', type: 'CDS', start: 10, end: 60, strand: -1, segments: [[10, 20], [40, 60]], color: '#123456', qualifiers: { note: ['a note'] } }),
      new Annotation({ id: 'b', name: 'wrap', type: 'misc_feature', start: bases.length - 5, end: 7, strand: 1 }),
    ],
    primers: [{ id: 'p', name: 'fwd', sequence: bases.slice(0, 20), role: 'primer' }],
  })

  it('writes EMBL that reads back as it was', () => {
    const text = writeEmbl(doc())
    expect(text).toMatch(/^ID {3}pTest_v2; SV 1; circular; other DNA; STD; SYN; 165 BP\.\n/)
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80)
    const [back] = parseEmbl(text)
    expect(back.name).toBe('pTest_v2')
    expect(back.description).toBe('A test construct')
    expect(back.sequence.bases).toBe(bases)
    expect(back.sequence.topology).toBe('circular')
    expect(back.annotations.map(a => [a.name, a.start, a.end, a.strand, a.segments, a.color])).toEqual([
      ['exons', 10, 60, -1, [[10, 20], [40, 60]], '#123456'],
      ['wrap', bases.length - 5, 7, 1, undefined, back.annotations[1].color],
    ])
    expect(back.primers?.map(p => p.name)).toEqual(['fwd'])
  })

  it('counts the bases on the SQ line and numbers each sequence line', () => {
    const lines = writeEmbl(doc()).split('\n')
    expect(lines.find(l => l.startsWith('SQ'))).toMatch(/^SQ {3}Sequence 165 BP; \d+ A; \d+ C; \d+ G; \d+ T; 0 other;$/)
    const seqLines = lines.filter(l => /^ {5}[acgt]/.test(l))
    expect(seqLines[0]).toMatch(/ {2,}60$/)
    expect(seqLines[0]).toHaveLength(80)
    expect(seqLines[seqLines.length - 1]).toMatch(/ 165$/)
  })
})
