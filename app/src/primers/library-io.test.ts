import { describe, it, expect } from 'vitest'
import { parseOligoList, toCsv, toFasta, toOrderSheet } from './library-io'

describe('parseOligoList', () => {
  it('reads a CSV with a header, finding the columns by name', () => {
    const r = parseOligoList('Sequence,Notes,Name\nTGTAAAACGACGGCCAGT,universal,M13F\nCAGGAAACAGCTATGAC,,M13R\n')
    expect(r.oligos).toEqual([
      { name: 'M13F', sequence: 'TGTAAAACGACGGCCAGT', role: 'primer', notes: 'universal' },
      { name: 'M13R', sequence: 'CAGGAAACAGCTATGAC', role: 'primer' },
    ])
    expect(r.skipped).toEqual([])
  })

  it('honours quoted cells with commas in them', () => {
    const r = parseOligoList('Name,Sequence\n"T7, promoter",TAATACGACTCACTATAGGG')
    expect(r.oligos[0].name).toBe('T7, promoter')
  })

  it('reads headerless name–sequence lines, tab or space separated', () => {
    const r = parseOligoList('M13F\tTGTAAAACGACGGCCAGT\nT7 promoter TAATACGACTCACTATAGGG')
    expect(r.oligos.map(o => [o.name, o.sequence])).toEqual([
      ['M13F', 'TGTAAAACGACGGCCAGT'],
      ['T7 promoter', 'TAATACGACTCACTATAGGG'],
    ])
  })

  it('names bare sequences itself', () => {
    const r = parseOligoList('ACGTACGTACGTACGTAC\nGGGGCCCCAAAATTTT')
    expect(r.oligos.map(o => o.name)).toEqual(['Oligo 1', 'Oligo 2'])
  })

  it('reads FASTA, joining wrapped lines', () => {
    const r = parseOligoList(">fwd\nACGTACGTAC\nGTACGTAC\n>rev probe\nTTTTGGGGCCCCAAAA\n")
    expect(r.oligos.map(o => [o.name, o.sequence])).toEqual([
      ['fwd', 'ACGTACGTACGTACGTAC'],
      ['rev probe', 'TTTTGGGGCCCCAAAA'],
    ])
  })

  it('marks probes from a role column', () => {
    const r = parseOligoList('Name\tSequence\tType\nP1\tACGTACGTACGTACGTAC\tTaqMan probe')
    expect(r.oligos[0].role).toBe('probe')
  })

  it('reports lines it could not read, with their line numbers', () => {
    const r = parseOligoList('Name,Sequence\nGood,ACGTACGTACGTACGT\nBad,ACGTXYZ\nEmpty,\n')
    expect(r.oligos).toHaveLength(1)
    expect(r.skipped.map(s => s.line)).toEqual([3, 4])
  })

  it('ignores blank lines and comments', () => {
    expect(parseOligoList('\n# my primers\n\nP ACGTACGTACGT\n').oligos).toHaveLength(1)
  })
})

describe('writing oligo lists', () => {
  const oligos = [
    { name: 'M13F', sequence: 'TGTAAAACGACGGCCAGT', notes: 'says "hi", twice' },
    { name: 'M13F', sequence: 'CAGGAAACAGCTATGAC', role: 'probe' as const },
  ]

  it('CSV quotes what needs quoting and round-trips through the reader', () => {
    const csv = toCsv(oligos)
    expect(csv).toContain('"says ""hi"", twice"')
    expect(parseOligoList(csv).oligos.map(o => o.sequence)).toEqual(oligos.map(o => o.sequence))
  })

  it('FASTA round-trips', () => {
    expect(parseOligoList(toFasta(oligos)).oligos.map(o => o.name)).toEqual(['M13F', 'M13F'])
  })

  it('order sheet: tab-separated, vendor codes passed through, names made unique', () => {
    const sheet = toOrderSheet(oligos, { scale: '100nm', purification: 'PAGE' })
    const rows = sheet.trim().split('\n').map(r => r.split('\t'))
    expect(rows[0]).toEqual(['Name', 'Sequence', 'Scale', 'Purification'])
    expect(rows[1]).toEqual(['M13F', 'TGTAAAACGACGGCCAGT', '100nm', 'PAGE'])
    expect(rows[2][0]).toBe('M13F_2')
  })
})
