/**
 * Synthetic ABIF (.ab1) files for tests: the binary format built from
 * directory entries, and a whole small chromatogram.
 */

/**
 * Build a minimal valid ABIF buffer with the given directory entries.
 * This constructs the binary format from scratch for unit testing.
 */
export function buildAbif(entries: {
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
export function strBytes(s: string): number[] {
  return Array.from(s).map(c => c.charCodeAt(0))
}

/** Encode an array of int16 values as big-endian bytes. */
export function int16Bytes(values: number[]): number[] {
  const result: number[] = []
  for (const v of values) {
    result.push((v >> 8) & 0xff, v & 0xff)
  }
  return result
}

/** Encode an array of uint16 values as big-endian bytes. */
export function uint16Bytes(values: number[]): number[] {
  return int16Bytes(values) // same encoding for positive values
}

/** A small chromatogram: the bases called with peaks every 15 samples, four channels and the given qualities. */
export function simpleAb1(bases: string, quals: number[] = Array.from(bases, () => 40)): ArrayBuffer {
  const peaks = Array.from(bases, (_, i) => 10 + i * 15)
  const len = peaks[peaks.length - 1] + 10
  const channel = (base: string) => Array.from({ length: len }, (_, i) => (peaks.some((p, k) => p === i && bases[k] === base) ? 1000 : 50))
  return buildAbif([
    { tag: 'PBAS', num: 2, type: 2, elemSize: 1, data: strBytes(bases) },
    { tag: 'PLOC', num: 2, type: 3, elemSize: 2, data: uint16Bytes(peaks) },
    { tag: 'PCON', num: 2, type: 1, elemSize: 1, data: quals },
    { tag: 'FWO_', num: 1, type: 2, elemSize: 1, data: strBytes('GATC') },
    { tag: 'DATA', num: 9, type: 4, elemSize: 2, data: int16Bytes(channel('G')) },
    { tag: 'DATA', num: 10, type: 4, elemSize: 2, data: int16Bytes(channel('A')) },
    { tag: 'DATA', num: 11, type: 4, elemSize: 2, data: int16Bytes(channel('T')) },
    { tag: 'DATA', num: 12, type: 4, elemSize: 2, data: int16Bytes(channel('C')) },
  ])
}
