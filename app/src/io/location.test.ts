import { describe, it, expect } from 'vitest'
import { parseGenBankLocation, resolveLocation, formatGenBankLocation } from './location'

/** Parse and resolve in one step, as the GenBank reader does. */
function read(loc: string, seqLen = 1000, circular = false) {
  const parsed = parseGenBankLocation(loc)
  if (!parsed) return null
  return resolveLocation(parsed.parts, seqLen, circular)
}

describe('parseGenBankLocation', () => {
  it('reads plain ranges, single bases and complements', () => {
    expect(read('10..20')).toEqual({ start: 9, end: 20, strand: 1 })
    expect(read('15')).toEqual({ start: 14, end: 15, strand: 1 })
    expect(read('complement(10..20)')).toEqual({ start: 9, end: 20, strand: -1 })
  })

  it('reads partial locations instead of giving NaN', () => {
    expect(read('<1..>50')).toEqual({ start: 0, end: 50, strand: 1 })
    expect(read('complement(<5..100)')).toEqual({ start: 4, end: 100, strand: -1 })
    expect(read('(102.110)..200')).toEqual({ start: 101, end: 200, strand: 1 })
  })

  it('reads a between-bases site as zero length', () => {
    expect(read('100^101')).toEqual({ start: 100, end: 100, strand: 1 })
  })

  it('reads complement inside join on the reverse strand', () => {
    const r = read('join(complement(40..50),complement(1..20))')
    expect(r).toEqual({ start: 0, end: 50, strand: -1, segments: [[0, 20], [39, 50]] })
    // The other way NCBI writes the same thing.
    expect(read('complement(join(1..20,40..50))')).toEqual(r)
  })

  it('keeps the exons of a join', () => {
    expect(read('join(10..50,100..200,300..400)')).toEqual({
      start: 9, end: 400, strand: 1, segments: [[9, 50], [99, 200], [299, 400]],
    })
    expect(read('order(10..50,100..200)')?.segments).toEqual([[9, 50], [99, 200]])
  })

  it('merges parts that touch into one', () => {
    expect(read('join(10..50,51..80)')).toEqual({ start: 9, end: 80, strand: 1 })
  })

  it('ignores whitespace left by a location that wrapped onto several lines', () => {
    expect(read('join(10..50,\n                     100..200)')?.segments).toEqual([[9, 50], [99, 200]])
  })

  it('skips parts on another record, and counts them', () => {
    const p = parseGenBankLocation('join(J00194.1:100..202,1..50)')
    expect(p).toEqual({ parts: [{ start: 0, end: 50, strand: 1 }], remote: 1 })
    expect(read('J00194.1:100..202')).toBeNull()
  })

  it('refuses what it cannot read', () => {
    for (const bad of ['', 'join(1..5', '1..5)', 'gene(1..5)', 'abc', '1....5']) {
      expect(parseGenBankLocation(bad)).toBeNull()
    }
  })
})

describe('resolveLocation across the origin', () => {
  it('turns a join over the origin into the wrapped form, not the whole plasmid', () => {
    expect(read('join(901..1000,1..50)', 1000, true)).toEqual({ start: 900, end: 50, strand: 1 })
    expect(read('complement(join(901..1000,1..50))', 1000, true)).toEqual({ start: 900, end: 50, strand: -1 })
  })

  it('reads a single range written across the origin', () => {
    expect(read('901..50', 1000, true)).toEqual({ start: 900, end: 50, strand: 1 })
  })

  it('keeps the gaps of a spliced feature that crosses the origin', () => {
    expect(read('join(901..950,981..1000,1..50)', 1000, true)).toEqual({
      start: 900, end: 50, strand: 1, segments: [[900, 950], [980, 1000], [0, 50]],
    })
  })

  it('falls back to the overall span for parts listed out of order on a linear record', () => {
    expect(read('join(100..200,10..50)', 1000, false)).toEqual({ start: 9, end: 200, strand: 1 })
  })
})

describe('formatGenBankLocation', () => {
  const fmt = (a: Parameters<typeof formatGenBankLocation>[0], len = 1000, circular = true) =>
    formatGenBankLocation(a, len, circular)

  it('writes plain, reverse and wrapped features', () => {
    expect(fmt({ start: 9, end: 20, strand: 1 })).toBe('10..20')
    expect(fmt({ start: 9, end: 20, strand: -1 })).toBe('complement(10..20)')
    expect(fmt({ start: 900, end: 50, strand: 1 })).toBe('join(901..1000,1..50)')
  })

  it('writes segments as a join', () => {
    expect(fmt({ start: 9, end: 200, strand: -1, segments: [[9, 50], [99, 200]] }))
      .toBe('complement(join(10..50,100..200))')
  })

  it('writes a zero-length site in between-bases form', () => {
    expect(fmt({ start: 100, end: 100, strand: 1 })).toBe('100^101')
    expect(fmt({ start: 0, end: 0, strand: 1 })).toBe('1000^1')
  })

  it('round-trips through the parser', () => {
    const cases = [
      { start: 9, end: 20, strand: 1 as const },
      { start: 900, end: 50, strand: -1 as const },
      { start: 9, end: 200, strand: 1 as const, segments: [[9, 50], [99, 200]] as [number, number][] },
      { start: 900, end: 50, strand: 1 as const, segments: [[900, 950], [980, 1000], [0, 50]] as [number, number][] },
      { start: 100, end: 100, strand: 1 as const },
    ]
    for (const c of cases) expect(read(fmt(c), 1000, true)).toEqual(c)
  })
})
