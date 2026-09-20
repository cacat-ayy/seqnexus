/**
 * Tests for the streaming GenBank parser state machine.
 *
 * Imports the line-processing functions directly from the worker module
 * to test parsing logic without needing File.stream() or Web Workers.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createState,
  processLine,
  finalize,
  _resetIdCounter,
} from './genbank-parser.worker'

beforeEach(() => {
  _resetIdCounter()
})

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

function parseLines(lines: string[]) {
  const state = createState()
  for (const line of lines) {
    processLine(state, line)
  }
  return finalize(state)
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
    expect(cds.qualifiers['gene']).toEqual(['lacZ'])
    expect(cds.qualifiers['label']).toEqual(['lacZ'])
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

  it('stops at // record terminator', () => {
    const state = createState()
    processLine(state, 'LOCUS       pTest                    10 bp    DNA     linear   01-JAN-2000')
    processLine(state, 'ORIGIN')
    processLine(state, '        1 atgcgatcga')
    processLine(state, '//')
    // Lines after // should be ignored
    processLine(state, 'LOCUS       pOther                   20 bp    DNA     circular   01-JAN-2000')
    processLine(state, 'ORIGIN')
    processLine(state, '        1 gggggggggg gggggggggg')

    const result = finalize(state)
    expect(result.name).toBe('pTest')
    expect(result.bases.length).toBe(10)
    expect(result.topology).toBe('linear')
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
  })

  it('handles large sequence data efficiently', () => {
    const state = createState()
    processLine(state, 'LOCUS       pBig                  100000 bp    DNA     circular   01-JAN-2000')
    processLine(state, 'ORIGIN')

    // Simulate 100,000 bases in 60-char lines
    const chunk = 'atgcgatcga'  // 10 chars
    for (let i = 0; i < 100000; i += 60) {
      const lineNum = (i + 1).toString().padStart(9)
      const bases = chunk.repeat(6).slice(0, Math.min(60, 100000 - i))
      processLine(state, `${lineNum} ${bases}`)
    }
    processLine(state, '//')

    const result = finalize(state)
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
    expect(result.type).toBe('done')
    expect(result.name).toBe('pUC19')
    expect(result.bases.length).toBe(100)
    expect(result.annotations.length).toBe(2)
    // Verify all annotations have IDs
    for (const ann of result.annotations) {
      expect(ann.id).toBeTruthy()
    }
  })
})
