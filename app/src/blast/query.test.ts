import { describe, it, expect } from 'vitest'
import { Sequence } from '../models/Sequence'
import { alignmentLines, annotationStrand, docRangeToQuery, fingerprint, hitRangeOnDoc, hitStrandOnDoc, placementOf, queryBases, queryRangeToDoc } from './query'
import type { BlastHsp, BlastQuery } from './types'

const hsp = (patch: Partial<BlastHsp>): BlastHsp => ({
  bitScore: 100, evalue: 1e-20, identity: 1, positives: 1, gaps: 0, alignLen: 0,
  queryFrom: 1, queryTo: 1, hitFrom: 1, hitTo: 1, queryStrand: 1, hitStrand: 1,
  queryFrame: 0, hitFrame: 0, qseq: '', hseq: '', midline: '',
  ...patch,
})

describe('fingerprint', () => {
  it('is the same for the same bases in either case and differs after an edit', () => {
    expect(fingerprint('ACGTacgt')).toBe(fingerprint('acgtACGT'))
    expect(fingerprint('ACGTACGT')).not.toBe(fingerprint('ACGTACGA'))
    expect(fingerprint('ACGT')).not.toBe(fingerprint('ACGTA'))
  })
})

describe('queryRangeToDoc', () => {
  it('offsets a hit by where a one-piece query starts', () => {
    expect(queryRangeToDoc([[100, 200]], 1, 10)).toEqual({ start: 100, end: 110 })
    expect(queryRangeToDoc([[100, 200]], 91, 100)).toEqual({ start: 190, end: 200 })
  })

  it('places a hit on a query across the origin, across it when the hit crosses the joint', () => {
    // A 100 bp circle, selection from 90 round to 20: the query reads 90..99 then 0..19.
    const segments: [number, number][] = [[90, 100], [0, 20]]
    expect(queryRangeToDoc(segments, 1, 10)).toEqual({ start: 90, end: 100 })
    expect(queryRangeToDoc(segments, 11, 20)).toEqual({ start: 0, end: 10 })
    expect(queryRangeToDoc(segments, 5, 15)).toEqual({ start: 94, end: 5 })
  })
})

describe('placementOf', () => {
  const seq = new Sequence('AAAACCCCGGGGTTTT', 'circular')
  const segments: [number, number][] = [[12, 16], [0, 4]]
  const query: BlastQuery = { label: 'Selection', segments, seqLength: 16, fingerprint: fingerprint(queryBases(seq, segments)) }

  it('reads the query across the origin in reading order', () => {
    expect(queryBases(seq, segments)).toBe('TTTTAAAA')
  })

  it('places hits while the query is unchanged', () => {
    expect(placementOf(query, seq)).toEqual({ ok: true })
  })

  it('refuses a query whose bases were edited, or a sequence that changed length', () => {
    expect(placementOf(query, new Sequence('AAAACCCCGGGGTTTA', 'circular')).ok).toBe(false)
    expect(placementOf(query, new Sequence('AAAACCCCGGGGTTTTA', 'circular')).ok).toBe(false)
  })

  it('accepts an edit elsewhere in the sequence that keeps the query and the length', () => {
    expect(placementOf(query, new Sequence('AAAACGCCGGGGTTTT', 'circular')).ok).toBe(true)
  })
})

describe('docRangeToQuery', () => {
  const q = (segments: [number, number][]): BlastQuery => ({ label: 'q', segments, seqLength: 100, fingerprint: '' })

  it('places a feature on a one-piece query, clipped to it', () => {
    expect(docRangeToQuery(q([[20, 60]]), 10, 30)).toEqual([[0, 10]])
    expect(docRangeToQuery(q([[20, 60]]), 70, 80)).toEqual([])
  })

  it('joins the parts of a feature across the origin on a query across it', () => {
    // Query 90..99 then 0..19; a feature 95..5 across the origin is query 5..15.
    expect(docRangeToQuery(q([[90, 100], [0, 20]]), 95, 5)).toEqual([[5, 15]])
  })

  it('draws nothing on a translation', () => {
    expect(docRangeToQuery({ ...q([[0, 30]]), translation: { strand: 1, protein: '' } }, 0, 30)).toEqual([])
  })
})

describe('hitRangeOnDoc for a translation', () => {
  const base = { label: 'CDS', seqLength: 1000, fingerprint: '' }

  it('maps residues to their codons on the plus strand, through the coding parts', () => {
    // Exons 100..130 and 200..230 (30 bases each): residues 1-10 then 11-20.
    const q: BlastQuery = { ...base, segments: [[100, 130], [200, 230]], translation: { strand: 1, protein: '' } }
    expect(hitRangeOnDoc(q, 1, 10)).toEqual({ start: 100, end: 130 })
    expect(hitRangeOnDoc(q, 11, 20)).toEqual({ start: 200, end: 230 })
    expect(hitRangeOnDoc(q, 9, 12)).toEqual({ start: 124, end: 206 })
  })

  it('reads a minus-strand coding sequence from the far end', () => {
    // A CDS on the minus strand over 300..330: residue 1 is the codon at 327..330.
    const q: BlastQuery = { ...base, segments: [[300, 330]], translation: { strand: -1, protein: '' } }
    expect(hitRangeOnDoc(q, 1, 1)).toEqual({ start: 327, end: 330 })
    expect(hitRangeOnDoc(q, 1, 10)).toEqual({ start: 300, end: 330 })
  })

  it('leaves a base query to queryRangeToDoc', () => {
    const q: BlastQuery = { ...base, segments: [[100, 200]] }
    expect(hitRangeOnDoc(q, 1, 10)).toEqual({ start: 100, end: 110 })
  })

  it('gives a translation hit its own strand', () => {
    const q: BlastQuery = { ...base, segments: [[300, 330]], translation: { strand: -1, protein: '' } }
    expect(hitStrandOnDoc(q, 'blastp', { queryStrand: 1, hitStrand: 1 })).toBe(-1)
  })
})

describe('annotationStrand', () => {
  it('points a blastn hit on the minus strand of its record against the query', () => {
    expect(annotationStrand('blastn', { queryStrand: 1, hitStrand: -1 })).toBe(-1)
    expect(annotationStrand('blastn', { queryStrand: 1, hitStrand: 1 })).toBe(1)
  })

  it('follows the query frame of a translated query', () => {
    expect(annotationStrand('blastx', { queryStrand: -1, hitStrand: 1 })).toBe(-1)
    expect(annotationStrand('tblastx', { queryStrand: 1, hitStrand: -1 })).toBe(1)
  })

  it('keeps a protein query forward', () => {
    expect(annotationStrand('blastp', { queryStrand: 1, hitStrand: 1 })).toBe(1)
    expect(annotationStrand('tblastn', { queryStrand: 1, hitStrand: -1 })).toBe(1)
  })
})

describe('alignmentLines', () => {
  const dna = (n: number) => 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n)

  it('counts a blastn minus-strand subject down', () => {
    const s = dna(70)
    const lines = alignmentLines(hsp({ queryFrom: 1, queryTo: 70, hitFrom: 431, hitTo: 500, hitStrand: -1, qseq: s, hseq: s, midline: s }), 'blastn')
    expect(lines.map(l => [l.qStart, l.qEnd, l.hStart, l.hEnd])).toEqual([[1, 60, 500, 441], [61, 70, 440, 431]])
  })

  it('steps a translated query three bases per residue, down a minus frame', () => {
    const p = 'M'.repeat(100)
    const lines = alignmentLines(hsp({ queryFrom: 1, queryTo: 300, queryStrand: -1, queryFrame: -1, hitFrom: 1, hitTo: 100, qseq: p, hseq: p, midline: p }), 'blastx')
    expect(lines.map(l => [l.qStart, l.qEnd, l.hStart, l.hEnd])).toEqual([[300, 121, 1, 60], [120, 1, 61, 100]])
  })

  it('steps a translated subject three bases per residue', () => {
    const p = 'M'.repeat(100)
    const lines = alignmentLines(hsp({ queryFrom: 1, queryTo: 100, hitFrom: 1001, hitTo: 1300, hitFrame: 2, qseq: p, hseq: p, midline: p }), 'tblastn')
    expect(lines.map(l => [l.hStart, l.hEnd])).toEqual([[1001, 1180], [1181, 1300]])
  })

  it('gives gaps no positions', () => {
    const [line] = alignmentLines(hsp({ queryFrom: 11, queryTo: 14, hitFrom: 1, hitTo: 6, qseq: 'AC--GT', hseq: 'ACTTGT', midline: '||  ||' }), 'blastn')
    expect([line.qStart, line.qEnd, line.hStart, line.hEnd]).toEqual([11, 14, 1, 6])
  })
})
