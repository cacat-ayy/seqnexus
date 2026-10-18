import { describe, it, expect } from 'vitest'
import { BamParser, bamHeader, bamRecord } from './bam'
import { samHeaderText } from './sam'
import { editDistance } from './alignments'
import type { SamFields } from './alignments'

const program = { id: 'minimap2', name: 'minimap2', version: '2.22', command: '' }

const read = (qname: string, pos: number): SamFields => ({
  qname, flag: 0, ref: 0, pos, mapq: 60, cigar: '4M', mateRef: -1, matePos: -1, tlen: 0, seq: 'ACGT', qual: 'IIII',
})

describe('read groups', () => {
  it('names the sample in the SAM header', () => {
    const text = samHeaderText(['p'], [100], program, { id: 'S1', sample: 'Sample\t1' })
    expect(text.split('\n')).toContain('@RG\tID:S1\tSM:Sample 1')
  })

  it('names the platform, which a read group without one fails validation for', () => {
    const text = samHeaderText(['p'], [100], program, { id: 'S1', sample: 'S1', platform: 'ILLUMINA' })
    expect(text.split('\n')).toContain('@RG\tID:S1\tSM:S1\tPL:ILLUMINA')
  })

  it('marks a circular reference TP:circular, which is what lets a read run past LN', () => {
    const text = samHeaderText(['p', 'q'], [100, 200], program, undefined, [true, false])
    expect(text.split('\n')).toContain('@SQ\tSN:p\tLN:100\tTP:circular')
    expect(text.split('\n')).toContain('@SQ\tSN:q\tLN:200')
  })

  it('tags each BAM record and still reads record by record', () => {
    const header = samHeaderText(['p'], [100], program, { id: 'S1', sample: 'S1' })
    const bytes = [bamHeader(header, [{ name: 'p', length: 100 }]), bamRecord(read('r1', 0), 4, 'S1'), bamRecord(read('r2', 10), 14, 'S1')]
    const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (const b of bytes) { all.set(b, at); at += b.length }
    // The tag is the record's last bytes: "RGZ", the value, a NUL.
    const rec = bytes[1]
    expect(new TextDecoder().decode(rec.subarray(rec.length - 6))).toBe('RGZS1\0')
    const parser = new BamParser()
    parser.push(all)
    expect(parser.readHeader()).toBe(true)
    const recs: SamFields[] = []
    for (let f = parser.next(); f; f = parser.next()) recs.push(f)
    expect(recs.map(r => [r.qname, r.pos, r.seq])).toEqual([['r1', 0, 'ACGT'], ['r2', 10, 'ACGT']])
  })
})

describe('the NM tag', () => {
  it('counts substitutions and inserted and deleted bases from the difference string', () => {
    expect(editDistance(':10')).toBe(0)
    expect(editDistance(':5*ac:4')).toBe(1)
    expect(editDistance(':5+acg:4')).toBe(3)
    expect(editDistance(':5-acgt:4')).toBe(4)
    expect(editDistance(':3*ac+gg-tt:2')).toBe(5)
    expect(editDistance('*')).toBeNull()
  })

  it('goes into a BAM record as the smallest integer type that holds it', () => {
    const rec = bamRecord(read('r1', 0), 4, undefined, 3)
    // The tag is the record's last bytes: "NM", type C, the value.
    expect([...rec.subarray(rec.length - 4)]).toEqual([78, 77, 67, 3])
  })
})
