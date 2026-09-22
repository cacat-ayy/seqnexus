import { describe, it, expect } from 'vitest'
import { parseFastq, meanQuality } from './fastq'

describe('parseFastq', () => {
  it('parses a single record', () => {
    const recs = parseFastq('@read1 some description\nACGT\n+\nIIII\n')
    expect(recs).toHaveLength(1)
    expect(recs[0].name).toBe('read1')
    expect(recs[0].bases).toBe('ACGT')
    // 'I' is ASCII 73 → Q40 under Phred+33
    expect(recs[0].qualityScores).toEqual([40, 40, 40, 40])
  })

  it('parses multiple records', () => {
    const recs = parseFastq('@a\nAC\n+\nII\n@b\nGT\n+\n!!\n')
    expect(recs.map(r => r.name)).toEqual(['a', 'b'])
    expect(recs[1].qualityScores).toEqual([0, 0]) // '!' is ASCII 33 → Q0
  })

  it('uppercases bases', () => {
    expect(parseFastq('@r\nacgt\n+\nIIII\n')[0].bases).toBe('ACGT')
  })

  it('takes only the first token of the header as the name', () => {
    expect(parseFastq('@r1 length=4 extra\nACGT\n+\nIIII\n')[0].name).toBe('r1')
  })

  it('handles sequence and quality wrapped across lines', () => {
    const recs = parseFastq('@r\nACGT\nACGT\n+\nIIII\nIIII\n')
    expect(recs[0].bases).toBe('ACGTACGT')
    expect(recs[0].qualityScores).toHaveLength(8)
  })

  it('does not mistake a quality line starting with @ for a new record', () => {
    // '@' is ASCII 64 → Q31, a perfectly ordinary quality character.
    const recs = parseFastq('@r1\nACGT\n+\n@III\n@r2\nTTTT\n+\nIIII\n')
    expect(recs).toHaveLength(2)
    expect(recs[0].qualityScores[0]).toBe(31)
    expect(recs[1].name).toBe('r2')
  })

  it('tolerates blank lines between and before records', () => {
    expect(parseFastq('\n\n@a\nAC\n+\nII\n\n@b\nGT\n+\nII\n\n')).toHaveLength(2)
  })

  it('repeats the name on the + line without confusion', () => {
    const recs = parseFastq('@r1\nACGT\n+r1\nIIII\n')
    expect(recs).toHaveLength(1)
    expect(recs[0].bases).toBe('ACGT')
  })

  it('returns an empty array for empty input', () => {
    expect(parseFastq('')).toEqual([])
    expect(parseFastq('\n\n')).toEqual([])
  })

  it('throws when quality length does not match sequence length', () => {
    expect(() => parseFastq('@r\nACGT\n+\nII\n')).toThrow(/does not match sequence length/)
  })

  it('throws when the + separator is missing', () => {
    expect(() => parseFastq('@r\nACGT\n')).toThrow(/missing "\+" separator/)
  })

  it('throws when the file does not start with a header', () => {
    expect(() => parseFastq('ACGT\n+\nIIII\n')).toThrow(/expected a record header/)
  })

  it('round-trips what the app exports', () => {
    // Matches exportReadText's output shape: @name / seq / + / quality
    const exported = '@my_read\nACGTACGT\n+\nIIIIIIII\n'
    const recs = parseFastq(exported)
    expect(recs[0].name).toBe('my_read')
    expect(recs[0].bases).toBe('ACGTACGT')
    expect(recs[0].qualityScores).toHaveLength(8)
  })
})

describe('meanQuality', () => {
  it('averages and rounds to one decimal', () => {
    expect(meanQuality([40, 40, 30])).toBe(36.7)
  })

  it('returns 0 for an empty read', () => {
    expect(meanQuality([])).toBe(0)
  })
})
