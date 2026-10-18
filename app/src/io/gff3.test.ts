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

describe('writeGff3: what used to be lost on the way back', () => {
  const L = 120
  const doc = (annotations: Annotation[], patch: Partial<DocumentState> = {}): DocumentState => ({
    name: 'pTest',
    sequence: new Sequence('ATGAAACCCGGG'.repeat(10), 'circular'),
    annotations,
    ...patch,
  })

  it('writes the topology and reads it back', () => {
    const text = writeGff3(doc([]))
    expect(text).toContain('pTest\tSeqNexus\tregion\t1\t120\t.\t.\t.\tID=pTest_region;molecule_type=DNA;Is_circular=true')
    const read = readGff3(text)
    expect(read.circular.has('pTest')).toBe(true)
    expect(read.features.size).toBe(0)
  })

  it('keeps the parts of a joined feature, across the origin too', () => {
    const read = readGff3(writeGff3(doc([
      new Annotation({ id: 'a', name: 'exons', type: 'CDS', start: 10, end: 60, strand: -1, segments: [[10, 20], [40, 60]] }),
      new Annotation({ id: 'b', name: 'wrapped', type: 'misc_feature', start: 100, end: 20, strand: 1, segments: [[100, 110], [5, 20]] }),
    ])))
    const [exons, wrapped] = read.features.get('pTest')!
    expect(exons.segments).toEqual([[10, 20], [40, 60]])
    expect([wrapped.start, wrapped.end, wrapped.segments]).toEqual([100, 20, [[100, 110], [5, 20]]])
  })

  it('keeps a site between two bases', () => {
    const read = readGff3(writeGff3(doc([
      new Annotation({ id: 'a', name: 'site', type: 'misc_feature', start: 50, end: 50, strand: 0 }),
      new Annotation({ id: 'b', name: 'at origin', type: 'misc_feature', start: 0, end: 0, strand: 0 }),
    ])))
    expect(read.warnings).toEqual([])
    expect(read.features.get('pTest')!.map(f => [f.name, f.start, f.end])).toEqual([['site', 50, 50], ['at origin', 0, 0]])
  })

  it('keeps /gene when the name comes from /label', () => {
    const read = readGff3(writeGff3(doc([
      new Annotation({ id: 'a', name: 'AmpR', type: 'CDS', start: 0, end: 30, strand: 1, qualifiers: { label: ['AmpR'], gene: ['bla'] } }),
    ])))
    const [f] = read.features.get('pTest')!
    expect(f.name).toBe('AmpR')
    expect(f.qualifiers?.gene).toEqual(['bla'])
  })

  it('writes the phase of each CDS part, reading from the 5′ end', () => {
    const lines = writeGff3(doc([
      new Annotation({ id: 'f', name: 'fwd', type: 'CDS', start: 0, end: 50, strand: 1, segments: [[0, 10], [30, 50]], qualifiers: { codon_start: ['2'] } }),
      new Annotation({ id: 'r', name: 'rev', type: 'CDS', start: 0, end: 50, strand: -1, segments: [[0, 10], [30, 50]] }),
    ])).split('\n').filter(l => l.includes('\tCDS\t'))
    // Forward: skip 1 base; 9 bases left = 3 codons; the next part starts on a codon.
    expect(lines.slice(0, 2).map(l => l.split('\t')[7])).toEqual(['1', '0'])
    // Reverse: the right part is read first (20 bases, 2 left over), so the left part skips 1.
    expect(lines.slice(2).map(l => l.split('\t')[7])).toEqual(['1', '0'])
  })

  it('writes the primers and reads them back as primers', () => {
    const d = doc([], { primers: [{ id: 'p1', name: 'fwd', sequence: 'GGGG' + 'ATGAAACCCGGGATGAAACC', role: 'primer' }] })
    const read = readGff3(writeGff3(d))
    expect(read.features.size).toBe(0)
    expect(read.primers.get('pTest')?.map(p => [p.name, p.sequence])).toEqual([['fwd', 'GGGGATGAAACCCGGGATGAAACC']])
  })

  it(`opens a sequence of ${L} bases with its primers from a ##FASTA file`, () => {
    const d = doc([], { primers: [{ id: 'p1', name: 'fwd', sequence: 'ATGAAACCCGGGATGAAACC', role: 'primer' }] })
    const text = writeGff3(d) + '##FASTA\n>pTest\n' + d.sequence.bases + '\n'
    const [back] = gff3Documents(readGff3(text))
    expect(back.sequence.topology).toBe('circular')
    expect(back.primers?.map(p => p.name)).toEqual(['fwd'])
  })
})

describe('GFF3 with its sequence', () => {
  it('opens as the sequence it was written from, name and topology included', () => {
    const doc: DocumentState = {
      name: 'pUC19 mod',
      sequence: new Sequence('ATGAAACCCGGG'.repeat(10), 'circular'),
      annotations: [new Annotation({ id: 'a', name: 'ori', type: 'rep_origin', start: 10, end: 30, strand: 1 })],
    }
    const text = writeGff3(doc, { withSequence: true })
    expect(text).toContain('##FASTA\n>pUC19_mod pUC19 mod\n')
    const [back] = gff3Documents(readGff3(text))
    expect(back.name).toBe('pUC19 mod')
    expect(back.sequence.bases).toBe(doc.sequence.bases)
    expect(back.sequence.topology).toBe('circular')
    expect(back.annotations.map(a => [a.name, a.start, a.end])).toEqual([['ori', 10, 30]])
  })
})

describe('writeGff3: the seqid', () => {
  it('percent-encodes what the specification does not allow in column 1', () => {
    const d = {
      name: 'p/lasmid ünï',
      sequence: new Sequence('ACGTACGTACGT', 'circular'),
      annotations: [new Annotation({ id: 'a', name: 'f', type: 'CDS', start: 0, end: 6, strand: 1 })],
    }
    const text = writeGff3(d, { withSequence: true })
    const seqid = text.split('\n').find(l => l.includes('\tCDS\t'))!.split('\t')[0]
    expect(seqid).toBe('p%2Flasmid_%C3%BCn%C3%AF')
    expect(seqid).toMatch(/^[a-zA-Z0-9.:^*$@!+_?|%-]+$/)
    // The sequence and its features still find each other on the way back.
    const back = gff3Documents(readGff3(text))[0]
    expect(back.name).toBe('p/lasmid ünï')
    expect(back.annotations.map(a => [a.start, a.end])).toEqual([[0, 6]])
  })
})
