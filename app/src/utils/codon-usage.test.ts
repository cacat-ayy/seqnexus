import { describe, it, expect } from 'vitest'
import { codonUsage } from './codon-usage'
import { Sequence } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import { reverseComplement } from '../models/complement'

const cds = (patch: Partial<AnnotationData>) =>
  new Annotation({ id: 'c', name: 'c', type: 'CDS', start: 0, end: 0, strand: 1, ...patch })

const usage = (bases: string, anns: Annotation[]) =>
  Object.fromEntries([...(codonUsage(anns, new Sequence(bases)) ?? [])].map(([k, v]) => [k, `${v.aa}${v.count}`]))

describe('codonUsage (M10)', () => {
  it('reads a reverse-strand CDS on its own strand', () => {
    const gene = 'ATGAAATGGTAA' // M K W *
    const bases = reverseComplement(gene)
    expect(usage(bases, [cds({ start: 0, end: 12, strand: -1 })])).toEqual({ ATG: 'M1', AAA: 'K1', TGG: 'W1', TAA: '*1' })
  })

  it('honours /codon_start', () => {
    expect(usage('CATGAAA', [cds({ start: 0, end: 7, qualifiers: { codon_start: ['2'] } })])).toEqual({ ATG: 'M1', AAA: 'K1' })
  })

  it('translates with the code /transl_table names', () => {
    // TGA is a stop in the standard code and tryptophan in the vertebrate mitochondrial code.
    expect(usage('ATGTGA', [cds({ start: 0, end: 6 })])).toEqual({ ATG: 'M1', TGA: '*1' })
    expect(usage('ATGTGA', [cds({ start: 0, end: 6, qualifiers: { transl_table: ['2'] } })])).toEqual({ ATG: 'M1', TGA: 'W1' })
  })

  it('reads through exons and skips introns', () => {
    const bases = 'ATGAAA' + 'GTCCCCAG' + 'TGGTAA'
    const spliced = cds({ start: 0, end: 20, segments: [[0, 6], [14, 20]] })
    expect(usage(bases, [spliced])).toEqual({ ATG: 'M1', AAA: 'K1', TGG: 'W1', TAA: '*1' })
  })
})
