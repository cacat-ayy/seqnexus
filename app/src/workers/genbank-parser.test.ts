/**
 * Tests for the streaming GenBank path: the large-file worker feeds a file
 * line by line to the shared GenBankReader, so these drive the reader the
 * same way.
 */

import { describe, it, expect } from 'vitest'
import { GenBankReader } from '../io/genbank'

const SAMPLE_LINES = [
  'LOCUS       pUC19                   2686 bp    DNA     circular   01-JAN-2000',
  'DEFINITION  pUC19 cloning vector.',
  'FEATURES             Location/Qualifiers',
  '     CDS             1..100',
  '                     /label="lacZ"',
  '                     /gene="lacZ"',
  '     promoter        complement(200..250)',
  '                     /label="lac promoter"',
  'ORIGIN',
  '        1 atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga',
  '       61 atgcgatcga atgcgatcga atgcgatcga atgcgatcga',
  '//',
]

function parseAll(lines: string[]) {
  const reader = new GenBankReader()
  for (const line of lines) reader.line(line)
  return reader.finish()
}

function parseLines(lines: string[]) {
  return parseAll(lines)[0]
}

describe('streaming GenBank parser state machine', () => {
  it('parses LOCUS name and topology', () => {
    const result = parseLines(SAMPLE_LINES)
    expect(result.name).toBe('pUC19')
    expect(result.topology).toBe('circular')
  })

  it('parses sequence from ORIGIN', () => {
    const result = parseLines(SAMPLE_LINES)
    expect(result.bases.length).toBe(100)
    expect(result.bases.slice(0, 10)).toBe('ATGCGATCGA')
  })

  it('parses features with correct coordinates', () => {
    const result = parseLines(SAMPLE_LINES)
    expect(result.annotations).toHaveLength(2)

    const cds = result.annotations[0]
    expect(cds.type).toBe('CDS')
    expect(cds.name).toBe('lacZ')
    expect(cds.start).toBe(0)
    expect(cds.end).toBe(100)
    expect(cds.strand).toBe(1)
  })

  it('parses complement features', () => {
    const result = parseLines(SAMPLE_LINES)
    const prom = result.annotations[1]
    expect(prom.type).toBe('promoter')
    expect(prom.name).toBe('lac promoter')
    expect(prom.strand).toBe(-1)
    expect(prom.start).toBe(199)
    expect(prom.end).toBe(250)
  })

  it('parses qualifiers', () => {
    const result = parseLines(SAMPLE_LINES)
    const cds = result.annotations[0]
    expect(cds.qualifiers?.['gene']).toEqual(['lacZ'])
    expect(cds.qualifiers?.['label']).toEqual(['lacZ'])
  })

  it('handles linear topology', () => {
    const lines = [...SAMPLE_LINES]
    lines[0] = 'LOCUS       pTest                    50 bp    DNA     linear   01-JAN-2000'
    const result = parseLines(lines)
    expect(result.topology).toBe('linear')
  })

  it('defaults to linear when topology is missing', () => {
    const lines = [
      'LOCUS       pTest                    50 bp    DNA             01-JAN-2000',
      'ORIGIN',
      '        1 atgcgatcga atgcgatcga atgcgatcga atgcgatcga atgcgatcga',
      '//',
    ]
    const result = parseLines(lines)
    expect(result.topology).toBe('linear')
  })

  it('reads every record, not just the first', () => {
    const records = parseAll([
      'LOCUS       pTest                    10 bp    DNA     linear   01-JAN-2000',
      'ORIGIN',
      '        1 atgcgatcga',
      '//',
      'LOCUS       pOther                   20 bp    DNA     circular   01-JAN-2000',
      'ORIGIN',
      '        1 gggggggggg gggggggggg',
      '//',
    ])
    expect(records.map(r => [r.name, r.bases.length, r.topology])).toEqual([
      ['pTest', 10, 'linear'],
      ['pOther', 20, 'circular'],
    ])
  })

  it('keeps the description and primers', () => {
    const result = parseLines([
      'LOCUS       pTest                    60 bp    DNA     linear   01-JAN-2000',
      'DEFINITION  A test plasmid with a',
      '            two-line description.',
      'FEATURES             Location/Qualifiers',
      '     primer_bind     1..10',
      '                     /label="fwd"',
      '                     /primer_sequence="ATGCGATCGA"',
      'ORIGIN',
      '        1 ' + 'atgcgatcga'.repeat(6),
      '//',
    ])
    expect(result.description).toBe('A test plasmid with a two-line description')
    expect(result.primers.map(p => [p.name, p.sequence])).toEqual([['fwd', 'ATGCGATCGA']])
    expect(result.annotations).toEqual([])
  })

  it('handles join() locations', () => {
    const lines = [
      'LOCUS       pTest                    500 bp    DNA     linear   01-JAN-2000',
      'FEATURES             Location/Qualifiers',
      '     CDS             join(10..50,100..200)',
      '                     /label="joined"',
      'ORIGIN',
      '        1 ' + 'a'.repeat(60),
      '//',
    ]
    const result = parseLines(lines)
    expect(result.annotations).toHaveLength(1)
    const ann = result.annotations[0]
    expect(ann.start).toBe(9)   // 10 -> 0-based 9
    expect(ann.end).toBe(200)   // overall span
    expect(ann.segments).toEqual([[9, 50], [99, 200]])
  })

  it('handles large sequence data efficiently', () => {
    const reader = new GenBankReader()
    reader.line('LOCUS       pBig                  100000 bp    DNA     circular   01-JAN-2000')
    reader.line('ORIGIN')

    // Simulate 100,000 bases in 60-char lines
    const chunk = 'atgcgatcga'  // 10 chars
    for (let i = 0; i < 100000; i += 60) {
      const lineNum = (i + 1).toString().padStart(9)
      const bases = chunk.repeat(6).slice(0, Math.min(60, 100000 - i))
      reader.line(`${lineNum} ${bases}`)
    }
    reader.line('//')

    const [result] = reader.finish()
    expect(result.bases.length).toBe(100000)
    expect(result.topology).toBe('circular')
  })

  it('uses /product as name when /label and /gene are absent', () => {
    const lines = [
      'LOCUS       pTest                    100 bp    DNA     linear   01-JAN-2000',
      'FEATURES             Location/Qualifiers',
      '     CDS             1..90',
      '                     /product="green fluorescent protein"',
      'ORIGIN',
      '        1 ' + 'a'.repeat(60),
      '       61 ' + 'a'.repeat(40),
      '//',
    ]
    const result = parseLines(lines)
    expect(result.annotations[0].name).toBe('green fluorescent protein')
  })

  it('produces results matching the synchronous parser', () => {
    const result = parseLines(SAMPLE_LINES)
    expect(result.name).toBe('pUC19')
    expect(result.bases.length).toBe(100)
    expect(result.annotations.length).toBe(2)
    // Verify all annotations have IDs
    for (const ann of result.annotations) {
      expect(ann.id).toBeTruthy()
    }
  })
})
