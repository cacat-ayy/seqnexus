/**
 * What the GenBank writer puts in a file must read back as it was, here and
 * in strict readers (Biopython and others).
 */
import { describe, it, expect } from 'vitest'
import { parseGenBank, writeGenBank } from './genbank'
import { Sequence } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'

const BASES = 'ATGAAATTTGGG'.repeat(50)

function doc(name: string, annotations: AnnotationData[], description?: string): DocumentState {
  return { name, description, sequence: new Sequence(BASES, 'linear'), annotations: annotations.map(a => new Annotation(a)) }
}

const feature = (patch: Partial<AnnotationData> = {}): AnnotationData =>
  ({ id: 'f', name: 'feat', type: 'CDS', start: 0, end: 90, strand: 1, ...patch })

describe('GenBank writer (M5)', () => {
  it('keeps a name with spaces through export and reopen', () => {
    const text = writeGenBank(doc('My plasmid v2', []))
    expect(text).toMatch(/^LOCUS {7}My_plasmid_v2 /)
    expect(parseGenBank(text).name).toBe('My plasmid v2')
  })

  it('keeps the description apart from the name when there is one', () => {
    const back = parseGenBank(writeGenBank(doc('My plasmid', [], 'A test construct')))
    expect(back.name).toBe('My_plasmid')
    expect(back.description).toBe('A test construct')
  })

  it('doubles quotes inside values and reads them back', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: ['the "best" one'] } })]))
    expect(text).toContain('/note="the ""best"" one"')
    expect(parseGenBank(text).annotations[0].qualifiers.note).toEqual(['the "best" one'])
  })

  it('wraps long values at 79 columns and reads them back whole', () => {
    const translation = 'MKVLAAGIVGLLLAAQPAMA'.repeat(10)
    const note = 'a long note that goes on and on about this feature '.repeat(4).trim()
    const text = writeGenBank(doc('p', [feature({ qualifiers: { translation: [translation], note: [note] } })]))
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(79)
    const q = parseGenBank(text).annotations[0].qualifiers
    expect(q.translation).toEqual([translation])
    expect(q.note).toEqual([note])
  })

  it('wraps a long location and reads it back', () => {
    const segments: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 30, i * 30 + 10])
    const text = writeGenBank(doc('p', [feature({ start: 0, end: 580, segments })]))
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(79)
    expect(parseGenBank(text).annotations[0].segments).toEqual(segments)
  })

  it('leaves a space after a long feature key', () => {
    const text = writeGenBank(doc('p', [feature({ type: 'regulatory_region_x' })]))
    expect(text).toContain('     regulatory_region_x 1..90')
    expect(parseGenBank(text).annotations[0].type).toBe('regulatory_region_x')
  })

  it('writes numeric qualifiers without quotes', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { codon_start: ['1'], transl_table: ['11'] } })]))
    expect(text).toContain('/codon_start=1\n')
    expect(text).toContain('/transl_table=11\n')
    expect(parseGenBank(text).annotations[0].qualifiers.codon_start).toEqual(['1'])
  })

  it('keeps a feature renamed after import', () => {
    const imported = feature({ name: 'lacZ-alpha', qualifiers: { label: ['lacZ'] } })
    expect(parseGenBank(writeGenBank(doc('p', [imported]))).annotations[0].name).toBe('lacZ-alpha')
  })

  it("writes today's date, not 2000 (L6)", () => {
    expect(writeGenBank(doc('p', []))).not.toContain('01-JAN-2000')
    expect(writeGenBank(doc('p', []))).toMatch(/^LOCUS .* \d{2}-[A-Z]{3}-\d{4}\n/)
  })
})
