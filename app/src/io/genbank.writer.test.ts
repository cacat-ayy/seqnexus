/**
 * What the GenBank writer puts in a file must read back as it was, here and
 * in strict readers (Biopython and others).
 */
import { describe, it, expect } from 'vitest'
import { parseGenBank, unwrittenPrimers, writeGenBank } from './genbank'
import { Sequence } from '../models/Sequence'
import { Annotation, defaultColorForType, type AnnotationData } from '../models/Annotation'
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

describe('GenBank writer: what used to be lost on the way back', () => {
  it('writes the LOCUS line in the GenBank columns', () => {
    const line = writeGenBank(doc('pUC19', [])).split('\n')[0]
    expect(line.slice(0, 12)).toBe('LOCUS       ')
    expect(line.slice(12, 28).trimEnd()).toBe('pUC19')
    expect(line.slice(29, 40).trimStart()).toBe('600')
    expect(line.slice(41, 43)).toBe('bp')
    expect(line.slice(44, 50)).toBe('ds-DNA')
    expect(line.slice(55, 63).trimEnd()).toBe('linear')
    expect(line.slice(64, 67)).toBe('SYN')
    expect(line).toHaveLength(79)
  })

  it('keeps every feature after one whose note has line breaks, as one note', () => {
    const text = writeGenBank(doc('p', [
      feature({ id: 'a', name: 'first', qualifiers: { note: ['line one\nline two'] } }),
      feature({ id: 'b', name: 'second' }),
    ]))
    const back = parseGenBank(text)
    expect(back.annotations.map(a => a.name)).toEqual(['first', 'second'])
    // A value holds no line break, so it becomes a space: one note in, one
    // note out. Splitting it made a second note that was never there.
    expect(back.annotations[0].qualifiers.note).toEqual(['line one line two'])
  })

  it('keeps the values of a qualifier that has several, in order', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: ['first value', 'second value'] } })]))
    expect(parseGenBank(text).annotations[0].qualifiers.note).toEqual(['first value', 'second value'])
  })

  it('writes an empty value as "" and a valueless qualifier bare', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: [''], pseudo: [''] } })]))
    expect(text).toContain('/note=""')
    expect(text).toContain('/pseudo\n')
    expect(text).not.toContain('/note\n')
  })

  it('wraps a description with no spaces in it, so no line runs past 79 columns', () => {
    const long = 'D'.repeat(200)
    const text = writeGenBank(doc('p', [], long))
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(79)
    expect(parseGenBank(text).description?.replace(/ /g, '')).toBe(long)
  })

  it('writes a description with line breaks on one line', () => {
    const back = parseGenBank(writeGenBank(doc('p', [feature()], 'line one\nline two')))
    expect(back.description).toBe('line one line two')
    expect(back.annotations).toHaveLength(1)
  })

  it('keeps a primer whose notes have line breaks, and the primers after it', () => {
    const d = doc('p', [])
    d.primers = [
      { id: 'p1', name: 'fwd', sequence: BASES.slice(0, 20), role: 'primer', notes: 'note a\nnote b' },
      { id: 'p2', name: 'rev', sequence: 'CCCAAATTTCATCCCAAATT', role: 'primer' },
    ]
    const back = parseGenBank(writeGenBank(d))
    expect(back.primers?.map(p => [p.name, p.notes])).toEqual([['fwd', 'note a\nnote b'], ['rev', undefined]])
  })

  it('keeps a long URL whole and does not start a line with "/"', () => {
    const url = 'https://www.addgene.org/browse/sequence/123456/some/really/long/path/without/any/spaces/at/all'
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: [url], gene: ['see /etc/x and /usr/local/share/a/b/c/d/e/f/g for more of the same words here'] } })]))
    for (const line of text.split('\n').filter(l => l !== '//')) {
      expect(line.trimStart().startsWith('/') && !/^\s{21}\/\w+(=|$)/.test(line)).toBe(false)
    }
    const q = parseGenBank(text).annotations[0].qualifiers
    expect(q.note).toEqual([url])
    expect(q.gene).toEqual(['see /etc/x and /usr/local/share/a/b/c/d/e/f/g for more of the same words here'])
  })

  it('reads a value continued on a line that starts with "/" inside the quotes', () => {
    const text = writeGenBank(doc('p', [feature()])).replace(
      '                     /label="feat"',
      '                     /label="feat"\n                     /note="see https://example.org\n                     /a/b/c"',
    )
    expect(parseGenBank(text).annotations[0].qualifiers.note).toEqual(['see https://example.org /a/b/c'])
  })

  it("keeps a feature's own colour and leaves the type's colour out", () => {
    const text = writeGenBank(doc('p', [feature({ id: 'a', name: 'mine', color: '#123456', strand: -1 }), feature({ id: 'b', name: 'plain' })]))
    expect(text.match(/ApEinfo_fwdcolor/g)).toHaveLength(1)
    const back = parseGenBank(text)
    expect(back.annotations[0].color).toBe('#123456')
    expect(back.annotations[0].qualifiers.ApEinfo_fwdcolor).toBeUndefined()
    expect(back.annotations[1].color).toBe(defaultColorForType('CDS'))
  })

  it("reads ApE's colours for the feature's strand", () => {
    const text = writeGenBank(doc('p', [feature({ strand: -1, qualifiers: { ApEinfo_fwdcolor: ['#ff0000'], ApEinfo_revcolor: ['#00ff00'] } })]))
    expect(parseGenBank(text).annotations[0].color).toBe('#00ff00')
  })

  it('names the primers it cannot write', () => {
    const d = doc('p', [])
    d.primers = [
      { id: 'p1', name: 'binds', sequence: BASES.slice(0, 20), role: 'primer' },
      { id: 'p2', name: 'nowhere', sequence: 'GGGGGGGGGGGGGGGGGGGG', role: 'primer' },
    ]
    expect(unwrittenPrimers(d)).toEqual(['nowhere'])
  })
})

describe('GenBank reader: colours written by SnapGene', () => {
  it('takes the colour from a SnapGene colour note and keeps the other notes', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: ['color: #b7e6d7; direction: LEFT', 'a real note'] } })]))
    const a = parseGenBank(text).annotations[0]
    expect(a.color).toBe('#b7e6d7')
    expect(a.qualifiers.note).toEqual(['a real note'])
  })

  it('prefers ApE colours when a feature has both', () => {
    const text = writeGenBank(doc('p', [feature({ qualifiers: { note: ['color: #b7e6d7'], ApEinfo_fwdcolor: ['#ff0000'] } })]))
    const a = parseGenBank(text).annotations[0]
    expect(a.color).toBe('#ff0000')
  })
})

describe('GenBank writer: a record with no description', () => {
  it('does not come back with its own name as a description', () => {
    const back = parseGenBank(writeGenBank(doc('plasmid7', [feature()])))
    expect(back.name).toBe('plasmid7')
    expect(back.description).toBeUndefined()
  })

  it('keeps a name with spaces and still has no description', () => {
    const back = parseGenBank(writeGenBank(doc('my plasmid 7', [feature()])))
    expect(back.name).toBe('my plasmid 7')
    expect(back.description).toBeUndefined()
  })
})

describe('GenBank writer: a description that is the name again', () => {
  it('is written once and reads back as the name, with no description', () => {
    const back = parseGenBank(writeGenBank(doc('pUC19', [feature()], 'pUC19')))
    expect(back.name).toBe('pUC19')
    expect(back.description).toBeUndefined()
  })
})
