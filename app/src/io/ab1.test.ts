import { describe, it, expect } from 'vitest'
import { parseAb1, autoTrim } from './ab1'

// ---------------------------------------------------------------------------
// Synthetic ABIF buffer builder for testing
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid ABIF buffer with the given directory entries.
 * This constructs the binary format from scratch for unit testing.
 */
function buildAbif(entries: {
  tag: string
  num: number
  type: number
  elemSize: number
  data: ArrayBuffer | number[]
}[]): ArrayBuffer {
  // Phase 1: compute data section - entries with data > 4 bytes go into a data block
  const DIR_ENTRY_SIZE = 28

  // We'll place directory at offset 128, data after that
  const dirOffset = 128
  const dirSize = entries.length * DIR_ENTRY_SIZE
  let dataOffset = dirOffset + dirSize

  // Prepare data blocks
  interface PreparedEntry {
    tag: string
    num: number
    type: number
    elemSize: number
    elemCount: number
    dataSize: number
    dataOffset: number
    dataBytes: Uint8Array
    inline: boolean
  }

  const prepared: PreparedEntry[] = []
  for (const e of entries) {
    const dataBytes = e.data instanceof ArrayBuffer
      ? new Uint8Array(e.data)
      : new Uint8Array(e.data)
    const dataSize = dataBytes.length
    const elemCount = e.elemSize > 0 ? Math.floor(dataSize / e.elemSize) : dataSize
    const inline = dataSize <= 4

    let offset: number
    if (inline) {
      offset = 0 // will be set to dir entry offset + 20 during write
    } else {
      offset = dataOffset
      dataOffset += dataSize
      // Align to 2 bytes
      if (dataOffset % 2 !== 0) dataOffset++
    }

    prepared.push({
      tag: e.tag,
      num: e.num,
      type: e.type,
      elemSize: e.elemSize,
      elemCount,
      dataSize,
      dataOffset: offset,
      dataBytes,
      inline,
    })
  }

  // Allocate buffer
  const totalSize = dataOffset + 16 // some padding
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  // Write header
  // Magic "ABIF"
  view.setUint32(0, 0x41424946, false)
  // Version
  view.setInt16(4, 101, false)

  // Root directory entry at offset 6 (28 bytes)
  // tag = "tdir", num = 1
  bytes[6] = 0x74; bytes[7] = 0x64; bytes[8] = 0x69; bytes[9] = 0x72 // "tdir"
  view.setInt32(10, 1, false) // tagNumber
  view.setInt16(14, 1023, false) // elementType (root)
  view.setInt16(16, DIR_ENTRY_SIZE, false) // elementSize
  view.setInt32(18, entries.length, false) // elementCount = num dir entries
  view.setInt32(22, entries.length * DIR_ENTRY_SIZE, false) // dataSize
  view.setInt32(26, dirOffset, false) // dataOffset = where directory starts

  // Write directory entries
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i]
    const base = dirOffset + i * DIR_ENTRY_SIZE

    // Tag name (4 chars)
    for (let j = 0; j < 4; j++) {
      bytes[base + j] = p.tag.charCodeAt(j)
    }
    view.setInt32(base + 4, p.num, false) // tagNumber
    view.setInt16(base + 8, p.type, false) // elementType
    view.setInt16(base + 10, p.elemSize, false) // elementSize
    view.setInt32(base + 12, p.elemCount, false) // elementCount
    view.setInt32(base + 16, p.dataSize, false) // dataSize

    if (p.inline) {
      // Write data inline at offset base + 20
      for (let j = 0; j < p.dataSize; j++) {
        bytes[base + 20 + j] = p.dataBytes[j]
      }
    } else {
      // Write data offset
      view.setInt32(base + 20, p.dataOffset, false)
      // Write data at the offset
      for (let j = 0; j < p.dataSize; j++) {
        bytes[p.dataOffset + j] = p.dataBytes[j]
      }
    }
  }

  return buf
}

/** Encode a string as a byte array. */
function strBytes(s: string): number[] {
  return Array.from(s).map(c => c.charCodeAt(0))
}

/** Encode an array of int16 values as big-endian bytes. */
function int16Bytes(values: number[]): number[] {
  const result: number[] = []
  for (const v of values) {
    result.push((v >> 8) & 0xff, v & 0xff)
  }
  return result
}

/** Encode an array of uint16 values as big-endian bytes. */
function uint16Bytes(values: number[]): number[] {
  return int16Bytes(values) // same encoding for positive values
}

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
    const [start, end] = autoTrim(quals, 20, 5)
    expect(start).toBe(3)
    expect(end).toBeGreaterThan(start)
    // All bases in [start, end) should have reasonable quality
    const trimmedQuals = quals.slice(start, end)
    expect(trimmedQuals.every(q => q >= 20)).toBe(true)
  })

  it('returns full range for all-high-quality reads', () => {
    const quals = Array(50).fill(40)
    const [start, end] = autoTrim(quals, 20, 10)
    expect(start).toBe(0)
    expect(end).toBe(50)
  })

  it('returns empty range for all-low-quality reads', () => {
    const quals = Array(50).fill(5)
    const [start, end] = autoTrim(quals, 20, 10)
    expect(start).toBe(0)
    expect(end).toBe(0)
  })

  it('handles empty input', () => {
    const [start, end] = autoTrim([], 20, 10)
    expect(start).toBe(0)
    expect(end).toBe(0)
  })

  it('handles very short reads', () => {
    const quals = [30, 30, 30]
    const [start, end] = autoTrim(quals, 20, 10)
    expect(start).toBe(0)
    expect(end).toBe(3)
  })
})
