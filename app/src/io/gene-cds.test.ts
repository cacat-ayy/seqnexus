import { describe, it, expect } from 'vitest'
import type { AnnotationData } from '../models/Annotation'
import { mergeGenesIntoCds } from './gene-cds'

let n = 0
function feature(type: string, start: number, end: number, qualifiers: Record<string, string[]> = {}, extra: Partial<AnnotationData> = {}): AnnotationData {
  return { id: `f${++n}`, name: qualifiers.gene?.[0] ?? type, type, start, end, strand: 1, qualifiers, ...extra }
}

describe('mergeGenesIntoCds', () => {
  it('folds a gene over the same bases as its CDS into the CDS, keeping the gene\'s qualifiers', () => {
    const gene = feature('gene', 10, 100, { gene: ['cat'], locus_tag: ['b001'], db_xref: ['GeneID:1'] })
    const cds = feature('CDS', 10, 100, { gene: ['cat'], product: ['chloramphenicol acetyltransferase'], db_xref: ['GI:9'] })
    const out = mergeGenesIntoCds([gene, cds])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(cds.id)
    expect(out[0].qualifiers).toEqual({
      gene: ['cat'],
      product: ['chloramphenicol acetyltransferase'],
      db_xref: ['GI:9', 'GeneID:1'],
      locus_tag: ['b001'],
    })
    // The input is left alone.
    expect(cds.qualifiers).toEqual({ gene: ['cat'], product: ['chloramphenicol acetyltransferase'], db_xref: ['GI:9'] })
  })

  it('folds a gene that wraps the origin with its CDS', () => {
    const out = mergeGenesIntoCds([
      feature('gene', 3698, 618, { gene: ['bla'] }),
      feature('CDS', 3698, 618, { gene: ['bla'] }),
    ])
    expect(out.map(a => a.type)).toEqual(['CDS'])
  })

  it('keeps a gene that is longer than its CDS, on the other strand, or another gene', () => {
    const cds = feature('CDS', 50, 100, { gene: ['lacZ'] })
    const out = mergeGenesIntoCds([
      feature('gene', 20, 100, { gene: ['lacZ'] }),
      feature('gene', 50, 100, { gene: ['lacZ'] }, { strand: -1 }),
      feature('gene', 50, 100, { gene: ['lacI'] }),
      cds,
    ])
    expect(out).toHaveLength(4)
  })

  it('matches by locus tag, then by name, when the gene qualifier is missing', () => {
    expect(mergeGenesIntoCds([
      feature('gene', 0, 30, { locus_tag: ['HIV1gp1'] }),
      feature('CDS', 0, 30, { locus_tag: ['HIV1gp1'] }),
    ])).toHaveLength(1)
    expect(mergeGenesIntoCds([
      feature('gene', 0, 30, {}, { name: 'ORF1' }),
      feature('CDS', 0, 30, {}, { name: 'ORF1' }),
    ])).toHaveLength(1)
    expect(mergeGenesIntoCds([
      feature('gene', 0, 30, {}, { name: 'ORF1' }),
      feature('CDS', 0, 30, {}, { name: 'ORF2' }),
    ])).toHaveLength(2)
  })

  it('keeps a gene with no CDS, and a spliced gene drawn exon by exon', () => {
    const out = mergeGenesIntoCds([
      feature('gene', 0, 30, { gene: ['rrnB'] }),
      feature('rRNA', 0, 30, { gene: ['rrnB'] }),
      feature('gene', 100, 300, { gene: ['x'] }, { segments: [[100, 150], [200, 300]] }),
      feature('CDS', 100, 300, { gene: ['x'] }, { segments: [[100, 150], [200, 300]] }),
    ])
    expect(out.map(a => a.type)).toEqual(['gene', 'rRNA', 'gene', 'CDS'])
  })

  it('folds one gene into one CDS when two CDSs share the span', () => {
    const out = mergeGenesIntoCds([
      feature('gene', 0, 30, { gene: ['a'] }),
      feature('CDS', 0, 30, { gene: ['a'], product: ['p1'] }),
      feature('CDS', 0, 30, { gene: ['a'], product: ['p2'] }),
    ])
    expect(out.map(a => a.qualifiers?.product?.[0])).toEqual(['p1', 'p2'])
  })
})
