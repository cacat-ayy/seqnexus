/**
 * Feature locations through real files: the forms NCBI writes, origin-
 * spanning features, spliced features, and what survives export and reopen.
 */
import { describe, it, expect } from 'vitest'
import { parseGenBank, parseGenBankMulti, readGenBankRecords, writeGenBank } from './genbank'
import { parseSnapGene, writeSnapGene } from './snapgene'
import { Sequence } from '../models/Sequence'
import { Annotation, type AnnotationData } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { insertBasesInPlace, deleteBasesInPlace, rotateOriginInPlace } from '../models/Document'

const BASES = 'ACGTTGCA'.repeat(125) // 1000 bp

function originLines(bases: string): string[] {
  const out: string[] = []
  for (let i = 0; i < bases.length; i += 60) {
    const chunks: string[] = []
    for (let j = i; j < Math.min(i + 60, bases.length); j += 10) chunks.push(bases.slice(j, j + 10).toLowerCase())
    out.push(`${String(i + 1).padStart(9)} ${chunks.join(' ')}`)
  }
  return out
}

function gb(features: string[], topology = 'circular'): string {
  return [
    `LOCUS       pTest                   1000 bp    DNA     ${topology}   01-JAN-2000`,
    'FEATURES             Location/Qualifiers',
    ...features,
    'ORIGIN',
    ...originLines(BASES),
    '//',
  ].join('\n')
}

function doc(annotations: AnnotationData[], topology: 'linear' | 'circular' = 'circular'): DocumentState {
  return { name: 'pTest', sequence: new Sequence(BASES, topology), annotations: annotations.map(a => new Annotation(a)) }
}

const reopen = (d: DocumentState) => parseGenBank(writeGenBank(d))
const span = (a: Annotation) => ({ start: a.start, end: a.end, strand: a.strand, segments: a.segments })

describe('GenBank feature locations (H1, H2)', () => {
  it('keeps an origin-spanning feature to its own length through export and reopen', () => {
    const d = doc([{ id: 'a', name: 'wrap', type: 'CDS', start: 900, end: 50, strand: -1 }])
    const back = reopen(d).annotations[0]
    expect(span(back)).toEqual({ start: 900, end: 50, strand: -1, segments: undefined })
  })

  it('reads partial locations without NaN', () => {
    const [a] = parseGenBank(gb(['     gene            <1..>50', '                     /gene="x"'])).annotations
    expect([a.start, a.end]).toEqual([0, 50])
  })

  it('reads NCBI reverse-strand joins as reverse strand', () => {
    const [a] = parseGenBank(gb(['     CDS             join(complement(400..500),complement(100..200))'])).annotations
    expect(span(a)).toEqual({ start: 99, end: 500, strand: -1, segments: [[99, 200], [399, 500]] })
  })

  it('reads a location that wraps onto the next line', () => {
    const [a] = parseGenBank(gb([
      '     CDS             join(10..50,100..200,',
      '                     300..400)',
      '                     /gene="long"',
    ])).annotations
    expect(span(a)).toEqual({ start: 9, end: 400, strand: 1, segments: [[9, 50], [99, 200], [299, 400]] })
    expect(a.name).toBe('long')
  })

  it('skips a feature that lies only on another record, with a warning', () => {
    const warnings: string[] = []
    const d = parseGenBank(gb([
      '     misc_feature    J00194.1:100..202',
      '     misc_feature    10..20',
    ]), warnings)
    expect(d.annotations).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/another record/)
  })

  it('keeps the exons of a spliced CDS through export and reopen', () => {
    const d = doc([{ id: 'a', name: 'spliced', type: 'CDS', start: 9, end: 400, strand: 1, segments: [[9, 50], [99, 200], [299, 400]] }], 'linear')
    expect(writeGenBank(d)).toContain('join(10..50,100..200,300..400)')
    expect(span(reopen(d).annotations[0])).toEqual(span(d.annotations[0]))
  })

  it('moves exons with an edit inside an intron, and writes the moved join', () => {
    let d = doc([{ id: 'a', name: 's', type: 'CDS', start: 9, end: 400, strand: 1, segments: [[9, 50], [99, 200], [299, 400]] }], 'linear')
    d = insertBasesInPlace(d, 60, 'AAAAA')
    expect(d.annotations[0].segments).toEqual([[9, 50], [104, 205], [304, 405]])
    d = deleteBasesInPlace(d, 50, 104)
    // The first intron is gone: the first two exons are now one.
    expect(span(d.annotations[0])).toEqual({ start: 9, end: 351, strand: 1, segments: [[9, 151], [250, 351]] })
    expect(writeGenBank(d)).toContain('join(10..151,251..351)')
  })

  it('keeps exons when the origin is moved', () => {
    const d = rotateOriginInPlace(doc([{ id: 'a', name: 's', type: 'CDS', start: 100, end: 400, strand: 1, segments: [[100, 200], [300, 400]] }]), 150)
    expect(span(d.annotations[0])).toEqual({ start: 950, end: 250, strand: 1, segments: [[950, 1000], [0, 50], [150, 250]] })
  })

  it('drops segments, rather than keeping wrong ones, when something else moves the ends', () => {
    const a = new Annotation({ id: 'a', name: 's', type: 'CDS', start: 9, end: 400, strand: 1, segments: [[9, 50], [299, 400]] })
    expect(a.with({ start: 20 }).segments).toBeUndefined()
    expect(a.with({ name: 'renamed' }).segments).toEqual([[9, 50], [299, 400]])
  })
})

describe('GenBank qualifiers (M6)', () => {
  it('joins a wrapped note with a space and undoes doubled quotes', () => {
    const [a] = parseGenBank(gb([
      '     misc_feature    10..20',
      '                     /note="this is a long',
      '                     note with a ""quoted"" word"',
    ])).annotations
    expect(a.qualifiers.note).toEqual(['this is a long note with a "quoted" word'])
  })

  it('joins a wrapped translation without spaces', () => {
    const [a] = parseGenBank(gb([
      '     CDS             10..99',
      '                     /translation="MKVLAAGIVG',
      '                     LLLAAQPAMA"',
    ])).annotations
    expect(a.qualifiers.translation).toEqual(['MKVLAAGIVGLLLAAQPAMA'])
  })
})

describe('GenBank records', () => {
  it('reads every record of a multi-record file, with descriptions', () => {
    const two = gb([]).replace('LOCUS', 'LOCUS').replace('FEATURES', 'DEFINITION  First one.\nFEATURES') + '\n' +
      gb([]).replace('pTest', 'pTwo')
    const docs = parseGenBankMulti(two)
    expect(docs.map(d => [d.name, d.description, d.sequence.length])).toEqual([
      ['pTest', 'First one', 1000],
      ['pTwo', undefined, 1000],
    ])
  })

  it('reads a record with no terminating //', () => {
    expect(readGenBankRecords(gb([]).replace(/\/\/$/, ''))).toHaveLength(1)
  })
})

describe('SnapGene feature segments (H1)', () => {
  it('keeps an origin-spanning feature to its own length', () => {
    const d = doc([{ id: 'a', name: 'wrap', type: 'CDS', start: 900, end: 50, strand: 1 }])
    const back = parseSnapGene(writeSnapGene(d)).annotations[0]
    expect([back.start, back.end]).toEqual([900, 50])
  })

  it('keeps the exons of a spliced feature', () => {
    const d = doc([{ id: 'a', name: 's', type: 'CDS', start: 9, end: 400, strand: -1, segments: [[9, 50], [299, 400]] }])
    const back = parseSnapGene(writeSnapGene(d)).annotations[0]
    expect(span(back)).toEqual({ start: 9, end: 400, strand: -1, segments: [[9, 50], [299, 400]] })
  })
})

describe('SnapGene large files (H6)', () => {
  it('opens a sequence of several hundred kb', () => {
    const big: DocumentState = { name: 'BAC', sequence: new Sequence('ACGT'.repeat(75_000), 'linear'), annotations: [] }
    expect(parseSnapGene(writeSnapGene(big)).sequence.length).toBe(300_000)
  })
})
