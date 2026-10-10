/**
 * The source feature over a whole record is kept out of the features and
 * written back on GenBank export.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest'
import type { AnnotationData } from '../models/Annotation'
import { takeSource } from './source-feature'
import { parseGenBank, writeGenBank } from './genbank'
import { readGeneiousXml } from './geneious'

const feature = (type: string, start: number, end: number, qualifiers: Record<string, string[]> = {}, extra: Partial<AnnotationData> = {}): AnnotationData =>
  ({ id: `${type}${start}`, name: type, type, start, end, strand: 1, qualifiers, ...extra })

const BASES = 'ACGTACGTAC'.repeat(6)

function record(features: string): string {
  return [
    'LOCUS       pTest                     60 bp    DNA     circular SYN 01-JAN-2020',
    'DEFINITION  Cloning vector pTest.',
    'FEATURES             Location/Qualifiers',
    features,
    'ORIGIN',
    `        1 ${BASES.slice(0, 60).match(/.{10}/g)!.join(' ').toLowerCase()}`,
    '//',
  ].join('\n')
}

describe('takeSource', () => {
  it('takes a source over the whole sequence out, with its qualifiers', () => {
    const { annotations, source } = takeSource([
      feature('source', 0, 60, { organism: ['Cloning vector pUC19'], mol_type: ['other DNA'] }),
      feature('CDS', 10, 40),
    ], 60)
    expect(annotations.map(a => a.type)).toEqual(['CDS'])
    expect(source).toEqual([{ organism: ['Cloning vector pUC19'], mol_type: ['other DNA'] }])
  })

  it('leaves a source over part of the sequence as a feature', () => {
    const { annotations, source } = takeSource([feature('source', 0, 30), feature('source', 30, 60)], 60)
    expect(annotations).toHaveLength(2)
    expect(source).toEqual([])
  })
})

describe('GenBank', () => {
  const text = record([
    '     source          1..60',
    '                     /organism="Cloning vector pTest"',
    '                     /mol_type="other DNA"',
    '     CDS             11..40',
    '                     /gene="bla"',
  ].join('\n'))

  it('reads the source into the metadata, not the features', () => {
    const doc = parseGenBank(text)
    expect(doc.annotations.map(a => a.type)).toEqual(['CDS'])
    expect(doc.metadata?.source).toEqual([{ organism: ['Cloning vector pTest'], mol_type: ['other DNA'] }])
  })

  it('writes it back first, over the whole sequence as it is now', () => {
    const doc = parseGenBank(text)
    const longer = { ...doc, sequence: doc.sequence.insert(5, 'GGGGG') }
    const out = writeGenBank(longer)
    const features = out.slice(out.indexOf('FEATURES'), out.indexOf('ORIGIN')).split('\n')
    expect(features[1]).toBe('     source          1..65')
    expect(features[2]).toBe('                     /organism="Cloning vector pTest"')
    expect(features[3]).toBe('                     /mol_type="other DNA"')
    expect(features[4]).toMatch(/^ {5}CDS {13}/)
    // And reads back the same.
    expect(parseGenBank(out).metadata?.source).toEqual(doc.metadata?.source)
  })

  it('writes no source for a sequence that never had one', () => {
    const doc = parseGenBank(record('     CDS             11..40'))
    expect(doc.metadata?.source).toBeUndefined()
    expect(writeGenBank(doc)).not.toContain('source')
  })
})

describe('Geneious', () => {
  it('keeps the source of a Geneious sequence out of the features', () => {
    const xml = '<geneious><folder name="F" /><geneiousDocument class="com.biomatters.plugins.ncbi.documents.GenBankNucleotideSequence">'
      + '<hiddenFields><cache_name>pUC19</cache_name></hiddenFields><fields><topology>circular</topology></fields>'
      + '<originalElement><XMLSerialisableRootElement><sequenceAnnotations>'
      + '<annotation><description>source Cloning vector pUC19</description><type>source</type><intervals><interval><minimumIndex>1</minimumIndex><maximumIndex>60</maximumIndex><direction>leftToRight</direction></interval></intervals>'
      + '<qualifiers><qualifier><name>organism</name><value>Cloning vector pUC19</value></qualifier></qualifiers></annotation>'
      + `</sequenceAnnotations><charSequence>${BASES}</charSequence></XMLSerialisableRootElement></originalElement></geneiousDocument></geneious>`
    const doc = readGeneiousXml(xml).sequences[0]
    expect(doc.annotations).toEqual([])
    expect(doc.metadata?.source).toEqual([{ organism: ['Cloning vector pUC19'] }])
  })
})
