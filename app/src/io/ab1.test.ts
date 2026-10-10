import { describe, it, expect } from 'vitest'
import { parseAb1, autoTrim } from './ab1'
import { buildAbif, int16Bytes, strBytes, uint16Bytes } from './abif-testing'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseAb1', () => {
  it('rejects non-ABIF files', () => {
    const buf = new ArrayBuffer(128)
    expect(() => parseAb1(buf)).toThrow('Not an ABIF file')
  })

  it('rejects files that are too small', () => {
    const buf = new ArrayBuffer(10)
    expect(() => parseAb1(buf)).toThrow('too small')
  })

  it('parses a synthetic ABIF file with all required fields', () => {
    const bases = 'ACGTACGT'
    const peaks = [10, 25, 40, 55, 70, 85, 100, 115]
    const quals = [30, 35, 40, 25, 20, 15, 10, 5]
    const traceLen = 120
    // Simple triangle traces - each channel peaks at its base positions
    const traceA = Array.from({ length: traceLen }, (_, i) => (i % 15 === 10 ? 1000 : 100))
    const traceC = Array.from({ length: traceLen }, (_, i) => (i % 15 === 5 ? 800 : 50))
    const traceG = Array.from({ length: traceLen }, (_, i) => (i % 15 === 0 ? 900 : 75))
    const traceT = Array.from({ length: traceLen }, (_, i) => (i % 15 === 3 ? 700 : 60))

    const buf = buildAbif([
      // PBAS.2 - called bases
      { tag: 'PBAS', num: 2, type: 2, elemSize: 1, data: strBytes(bases) },
      // PLOC.2 - peak locations
      { tag: 'PLOC', num: 2, type: 3, elemSize: 2, data: uint16Bytes(peaks) },
      // PCON.2 - quality scores
      { tag: 'PCON', num: 2, type: 1, elemSize: 1, data: quals },
      // FWO_.1 - filter wheel order
      { tag: 'FWO_', num: 1, type: 2, elemSize: 1, data: strBytes('GATC') },
      // DATA.9-12 - processed traces (G, A, T, C per FWO_ = GATC)
      { tag: 'DATA', num: 9, type: 4, elemSize: 2, data: int16Bytes(traceG) },
      { tag: 'DATA', num: 10, type: 4, elemSize: 2, data: int16Bytes(traceA) },
      { tag: 'DATA', num: 11, type: 4, elemSize: 2, data: int16Bytes(traceT) },
      { tag: 'DATA', num: 12, type: 4, elemSize: 2, data: int16Bytes(traceC) },
      // SMPL.1 - sample name (pascal string: length byte + chars)
      { tag: 'SMPL', num: 1, type: 18, elemSize: 1, data: [10, ...strBytes('TestSample')] },
    ])

    const result = parseAb1(buf)

    expect(result.bases).toBe('ACGTACGT')
    expect(result.peakLocations).toEqual(peaks)
    expect(result.qualityScores).toEqual(quals)
    expect(result.traces.A.length).toBe(traceLen)
    expect(result.traces.C.length).toBe(traceLen)
    expect(result.traces.G.length).toBe(traceLen)
    expect(result.traces.T.length).toBe(traceLen)
    // FWO_ = GATC means channel 0=G, 1=A, 2=T, 3=C
    // DATA.9 → channel 0 → G
    expect(result.traces.G).toEqual(traceG)
    // DATA.10 → channel 1 → A
    expect(result.traces.A).toEqual(traceA)
    expect(result.name).toBe('TestSample')
  })

  it('falls back to PBAS.1 when PBAS.2 is missing', () => {
    const bases = 'AACC'
    const peaks = [5, 15, 25, 35]

    const buf = buildAbif([
      { tag: 'PBAS', num: 1, type: 2, elemSize: 1, data: strBytes(bases) },
      { tag: 'PLOC', num: 1, type: 3, elemSize: 2, data: uint16Bytes(peaks) },
      { tag: 'FWO_', num: 1, type: 2, elemSize: 1, data: strBytes('GATC') },
      { tag: 'DATA', num: 9, type: 4, elemSize: 2, data: int16Bytes([0, 0]) },
      { tag: 'DATA', num: 10, type: 4, elemSize: 2, data: int16Bytes([0, 0]) },
      { tag: 'DATA', num: 11, type: 4, elemSize: 2, data: int16Bytes([0, 0]) },
      { tag: 'DATA', num: 12, type: 4, elemSize: 2, data: int16Bytes([0, 0]) },
    ])

    const result = parseAb1(buf)
    expect(result.bases).toBe('AACC')
    expect(result.peakLocations).toEqual(peaks)
    // No PCON → quality scores default to 0
    expect(result.qualityScores).toEqual([0, 0, 0, 0])
  })

  /** A minimal valid trace plus whatever extra entries a test needs. */
  function withCalls(extra: Parameters<typeof buildAbif>[0], calls = { bases: 'ACGT', peaks: [5, 15, 25, 35], quals: [30, 30, 30, 30] }) {
    return buildAbif([
      { tag: 'PBAS', num: 2, type: 2, elemSize: 1, data: strBytes(calls.bases) },
      { tag: 'PLOC', num: 2, type: 3, elemSize: 2, data: uint16Bytes(calls.peaks) },
      { tag: 'PCON', num: 2, type: 1, elemSize: 1, data: calls.quals },
      { tag: 'FWO_', num: 1, type: 2, elemSize: 1, data: strBytes('GATC') },
      ...[9, 10, 11, 12].map(num => ({ tag: 'DATA', num, type: 4, elemSize: 2, data: int16Bytes(new Array(40).fill(1)) })),
      ...extra,
    ])
  }
  const pstr = (s: string) => [s.length, ...strBytes(s)]

  it('reads the run details an instrument records', () => {
    const result = parseAb1(withCalls([
      { tag: 'SMPL', num: 1, type: 18, elemSize: 1, data: pstr('pUC19_M13F') },
      { tag: 'TUBE', num: 1, type: 18, elemSize: 1, data: pstr('B9') },
      { tag: 'LANE', num: 1, type: 4, elemSize: 2, data: int16Bytes([77]) },
      { tag: 'HCFG', num: 3, type: 19, elemSize: 1, data: [...strBytes('3730xl'), 0] },
      { tag: 'DySN', num: 1, type: 18, elemSize: 1, data: pstr('Z-BigDyeV3') },
      { tag: 'SVER', num: 2, type: 18, elemSize: 1, data: pstr('KB 1.2') },
      // S/N% in filter wheel order (G, A, T, C)
      { tag: 'S/N%', num: 1, type: 4, elemSize: 2, data: int16Bytes([500, 388, 300, 461]) },
      { tag: 'RUND', num: 1, type: 10, elemSize: 4, data: [0x07, 0xd9, 12, 12] },
      { tag: 'RUNT', num: 1, type: 11, elemSize: 4, data: [9, 56, 53, 0] },
    ]))
    expect(result.metadata).toMatchObject({
      format: 'ab1',
      sampleName: 'pUC19_M13F',
      well: 'B9',
      lane: 77,
      instrument: '3730xl',
      dyeSet: 'Z-BigDyeV3',
      basecaller: 'KB 1.2',
      signal: { G: 500, A: 388, T: 300, C: 461 },
      runStartDate: '2009-12-12',
      runStartTime: '09:56:53',
    })
    // Absent tags leave no undefined keys behind in the saved read.
    expect(Object.values(result.metadata).every(v => v !== undefined)).toBe(true)
  })

  it('keeps the original calls when the file carries different edited ones', () => {
    const result = parseAb1(withCalls([
      { tag: 'PBAS', num: 1, type: 2, elemSize: 1, data: strBytes('ACNT') },
      { tag: 'PLOC', num: 1, type: 3, elemSize: 2, data: uint16Bytes([5, 15, 25, 35]) },
      { tag: 'PCON', num: 1, type: 1, elemSize: 1, data: [30, 30, 4, 30] },
    ]))
    expect(result.bases).toBe('ACGT')
    expect(result.originalCalls?.bases).toBe('ACNT')
    expect(result.originalCalls?.qualityScores).toEqual([30, 30, 4, 30])
  })

  it('does not keep original calls identical to the edited ones', () => {
    const result = parseAb1(withCalls([
      { tag: 'PBAS', num: 1, type: 2, elemSize: 1, data: strBytes('ACGT') },
    ]))
    expect(result.originalCalls).toBeUndefined()
  })

  // Old ABI base callers write PCON as all zeros; that is no quality, not Q0.
  it('marks an all-zero quality block as missing', () => {
    const result = parseAb1(withCalls([], { bases: 'ACGT', peaks: [5, 15, 25, 35], quals: [0, 0, 0, 0] }))
    expect(result.metadata.qualityMissing).toBe(true)
  })

  it('brings calls, peaks and qualities to one length', () => {
    const result = parseAb1(withCalls([], { bases: 'ACGTA', peaks: [5, 15, 25, 35], quals: [30, 30, 30] }))
    expect(result.bases).toBe('ACGT')
    expect(result.peakLocations).toHaveLength(4)
    expect(result.qualityScores).toEqual([30, 30, 30, 0])
  })

  it('throws when PBAS is missing', () => {
    const buf = buildAbif([
      { tag: 'PLOC', num: 1, type: 3, elemSize: 2, data: uint16Bytes([5, 15]) },
    ])
    expect(() => parseAb1(buf)).toThrow('No called bases')
  })
})

describe('autoTrim', () => {
  it('trims low-quality ends', () => {
    // Low quality at start and end, high in middle
    const quals = [5, 5, 5, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 5, 5, 5]
    const [start, end] = autoTrim(quals, 20)
    expect(start).toBe(3)
    expect(end).toBeGreaterThan(start)
    // All bases in [start, end) should have reasonable quality
    const trimmedQuals = quals.slice(start, end)
    expect(trimmedQuals.every(q => q >= 20)).toBe(true)
  })

  it('returns full range for all-high-quality reads', () => {
    const quals = Array(50).fill(40)
    const [start, end] = autoTrim(quals, 20)
    expect(start).toBe(0)
    expect(end).toBe(50)
  })

  it('returns empty range for all-low-quality reads', () => {
    const quals = Array(50).fill(5)
    const [start, end] = autoTrim(quals, 20)
    expect(start).toBe(0)
    expect(end).toBe(0)
  })

  it('handles empty input', () => {
    const [start, end] = autoTrim([], 20)
    expect(start).toBe(0)
    expect(end).toBe(0)
  })

  it('handles very short reads', () => {
    const quals = [30, 30, 30]
    const [start, end] = autoTrim(quals, 20)
    expect(start).toBe(0)
    expect(end).toBe(3)
  })
})
