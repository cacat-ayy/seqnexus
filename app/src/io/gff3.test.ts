import { describe, it, expect } from 'vitest'
import { readGff3, gff3Documents, looksLikeGff3, matchSeqid, writeGff3 } from './gff3'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

const GFF = [
  '##gff-version 3',
  '##sequence-region chr1 1 60',
  'chr1\t.\tregion\t1\t60\t.\t+\t.\tID=chr1;Is_circular=true',
  'chr1\t.\tgene\t5\t40\t.\t+\t.\tID=g1;Name=lacZ',
  'chr1\t.\tCDS\t5\t10\t.\t+\t0\tID=cds1;Parent=g1;product=beta%2Cgalactosidase',
  'chr1\t.\tCDS\t21\t40\t.\t+\t0\tID=cds1;Parent=g1;product=beta%2Cgalactosidase',
  'chr1\t.\tfive_prime_UTR\t1\t4\t.\t+\t.\tNote=leader',
  'chr1\t.\tpromoter\t50\t55\t.\t-\t.\tID=p1',
  'bad line',
  '##FASTA',
  '>chr1 a test chromosome',
  'ACGT'.repeat(15),
].join('\n')

describe('readGff3', () => {
  it('is recognised by its version line', () => {
    expect(looksLikeGff3(GFF)).toBe(true)
    expect(looksLikeGff3('>a\nACGT')).toBe(false)
  })

  it('reads features, joining lines that share an ID into one feature', () => {
    const read = readGff3(GFF)
    const features = read.features.get('chr1')!
    expect(features.map(f => f.type)).toEqual(['gene', 'CDS', "5'UTR", 'promoter'])
    const cds = features[1]
    expect([cds.start, cds.end]).toEqual([4, 40])
    expect(cds.segments).toEqual([[4, 10], [20, 40]])
    expect(cds.name).toBe('beta,galactosidase')
    expect(features[2].qualifiers?.note).toEqual(['leader'])
    expect(features[3].strand).toBe(-1)
    expect(read.circular.has('chr1')).toBe(true)
    expect(read.warnings).toHaveLength(1)
  })

  it('opens the ##FASTA sequences with their features', () => {
    const [doc] = gff3Documents(readGff3(GFF))
    expect(doc.name).toBe('chr1')
    expect(doc.description).toBe('a test chromosome')
    expect(doc.sequence.topology).toBe('circular')
    expect(doc.annotations).toHaveLength(4)
  })

  it('reads back what the writer wrote, an origin-spanning feature included', () => {
    const doc: DocumentState = {
      name: 'p X',
      sequence: new Sequence('ACGT'.repeat(25), 'circular'),
      annotations: [
        new Annotation({ id: 'a', name: 'ori', type: 'rep_origin', start: 10, end: 30, strand: 1 }),
        new Annotation({ id: 'b', name: 'wrap', type: 'misc_feature', start: 90, end: 8, strand: -1, qualifiers: { note: ['across; the origin'] } }),
      ],
    }
    const read = readGff3(writeGff3(doc))
    const [ori, wrap] = read.features.get('p_X')!
    expect([ori.name, ori.type, ori.start, ori.end]).toEqual(['ori', 'rep_origin', 10, 30])
    expect([wrap.start, wrap.end, wrap.strand]).toEqual([90, 8, -1])
    expect(wrap.qualifiers?.note).toEqual(['across; the origin'])
  })

  it('finds the open sequence a seqid names, as the writer spells it too', () => {
    const tabs = [{ doc: { name: 'my plasmid' } }, { doc: { name: 'chr1' } }]
    expect(matchSeqid('CHR1', tabs)).toBe(tabs[1])
    expect(matchSeqid('my_plasmid', tabs)).toBe(tabs[0])
    expect(matchSeqid('other', tabs)).toBeUndefined()
  })
})
