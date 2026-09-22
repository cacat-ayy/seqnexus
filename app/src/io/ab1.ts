/**
 * ABIF (.ab1) file parser for Sanger sequencing chromatograms.
 *
 * Parses the Applied Biosystems ABIF binary format and extracts:
 * - Called base sequence (PBAS)
 * - Peak locations mapping bases to trace positions (PLOC)
 * - Per-base Phred quality scores (PCON)
 * - 4 fluorescence trace channels A/C/G/T (DATA.9-12 or DATA.1-4)
 * - Sample name and run metadata
 *
 * Format: big-endian TLV directory. Header at offset 0 contains "ABIF" magic,
 * version, and a root directory entry pointing to the directory table.
 * Each directory entry is 28 bytes.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Ab1Data {
  name: string
  bases: string
  peakLocations: number[]
  qualityScores: number[]
  traces: {
    A: number[]
    C: number[]
    G: number[]
    T: number[]
  }
  metadata: {
    lane?: number
    runStartDate?: string
    runEndDate?: string
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface DirEntry {
  tagName: string
  tagNumber: number
  elementType: number
  elementSize: number
  elementCount: number
  dataSize: number
  dataOffset: number // offset into file, or inline value if dataSize <= 4
  dataIsInline: boolean
}

// ABIF element type codes
const ELEM_PSTRING = 18 // pascal string
const ELEM_CSTRING = 19 // c string

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const ABIF_MAGIC = 0x41424946 // "ABIF"

/**
 * Parse an ABIF (.ab1) file from an ArrayBuffer.
 * Throws on invalid/corrupt files.
 */
export function parseAb1(buffer: ArrayBuffer): Ab1Data {
  const view = new DataView(buffer)

  // Validate magic
  if (buffer.byteLength < 128) {
    throw new Error('File too small to be a valid ABIF file.')
  }
  const magic = view.getUint32(0, false)
  if (magic !== ABIF_MAGIC) {
    throw new Error('Not an ABIF file - invalid magic bytes.')
  }

  // Header: version at offset 4 (int16)
  // Root directory entry starts at offset 6 (28 bytes)
  // We need: elementCount at offset 18 (int32) and dataOffset at offset 22 (int32)
  // But the root entry is at bytes 6..33 of the header.
  // Root entry fields (relative to offset 6):
  //   tagName: 4 bytes (offset 6)
  //   tagNumber: 4 bytes (offset 10)
  //   elementType: 2 bytes (offset 14)
  //   elementSize: 2 bytes (offset 16)
  //   elementCount: 4 bytes (offset 18) - number of directory entries
  //   dataSize: 4 bytes (offset 22)
  //   dataOffset: 4 bytes (offset 26) - offset to directory table

  const numEntries = view.getInt32(18, false)
  const dirOffset = view.getInt32(26, false)

  if (numEntries <= 0 || dirOffset <= 0 || dirOffset >= buffer.byteLength) {
    throw new Error('Invalid ABIF directory pointer.')
  }

  // Parse directory entries
  const entries: DirEntry[] = []
  for (let i = 0; i < numEntries; i++) {
    const base = dirOffset + i * 28
    if (base + 28 > buffer.byteLength) break

    const tagName = String.fromCharCode(
      view.getUint8(base),
      view.getUint8(base + 1),
      view.getUint8(base + 2),
      view.getUint8(base + 3),
    )
    const tagNumber = view.getInt32(base + 4, false)
    const elementType = view.getInt16(base + 8, false)
    const elementSize = view.getInt16(base + 10, false)
    const elementCount = view.getInt32(base + 12, false)
    const dataSize = view.getInt32(base + 16, false)
    const dataOffset = view.getInt32(base + 20, false)
    const dataIsInline = dataSize <= 4

    entries.push({
      tagName,
      tagNumber,
      elementType,
      elementSize,
      elementCount,
      dataSize,
      dataOffset: dataIsInline ? base + 20 : dataOffset,
      dataIsInline,
    })
  }

  // Helper to find a directory entry
  function findEntry(tag: string, num: number): DirEntry | undefined {
    return entries.find(e => e.tagName === tag && e.tagNumber === num)
  }

  // Helper to read a string from an entry
  function readString(entry: DirEntry): string {
    const offset = entry.dataOffset
    let start: number
    let len: number

    if (entry.elementType === ELEM_PSTRING) {
      // Pascal string: first byte is length, rest is content
      // But for ABIF, pascal strings with dataSize > 4 store the length byte
      // at the data offset. For inline data, it's at the entry offset.
      if (offset + entry.dataSize <= buffer.byteLength && entry.dataSize > 0) {
        len = view.getUint8(offset)
        start = offset + 1
        // Clamp to available data
        len = Math.min(len, entry.dataSize - 1)
      } else {
        return ''
      }
    } else {
      // Char array or C string
      start = offset
      len = entry.elementCount > 0 ? entry.elementCount : entry.dataSize
    }

    // Bounds check
    if (start + len > buffer.byteLength) {
      len = Math.max(0, buffer.byteLength - start)
    }

    const chars: string[] = []
    for (let i = 0; i < len; i++) {
      const c = view.getUint8(start + i)
      if (c === 0 && entry.elementType === ELEM_CSTRING) break
      if (c >= 32) chars.push(String.fromCharCode(c))
    }
    return chars.join('')
  }

  // Helper to read an array of int16 values
  function readInt16Array(entry: DirEntry): number[] {
    const arr: number[] = []
    const offset = entry.dataOffset
    for (let i = 0; i < entry.elementCount; i++) {
      arr.push(view.getInt16(offset + i * 2, false))
    }
    return arr
  }

  // Helper to read an array of uint16 values
  function readUint16Array(entry: DirEntry): number[] {
    const arr: number[] = []
    const offset = entry.dataOffset
    for (let i = 0; i < entry.elementCount; i++) {
      arr.push(view.getUint16(offset + i * 2, false))
    }
    return arr
  }

  // Helper to read an array of uint8 values
  function readUint8Array(entry: DirEntry): number[] {
    const arr: number[] = []
    const offset = entry.dataOffset
    for (let i = 0; i < entry.elementCount; i++) {
      arr.push(view.getUint8(offset + i))
    }
    return arr
  }

  // ---- Extract called bases ----
  // Prefer PBAS.2 (edited), fall back to PBAS.1 (original)
  const pbasEntry = findEntry('PBAS', 2) ?? findEntry('PBAS', 1)
  if (!pbasEntry) {
    throw new Error('No called bases (PBAS) found in ABIF file.')
  }
  const bases = readString(pbasEntry).toUpperCase()

  // ---- Extract peak locations ----
  const plocEntry = findEntry('PLOC', 2) ?? findEntry('PLOC', 1)
  if (!plocEntry) {
    throw new Error('No peak locations (PLOC) found in ABIF file.')
  }
  const peakLocations = readUint16Array(plocEntry)

  // ---- Extract quality scores ----
  const pconEntry = findEntry('PCON', 2) ?? findEntry('PCON', 1)
  const qualityScores = pconEntry ? readUint8Array(pconEntry) : new Array(bases.length).fill(0)

  // ---- Extract trace data ----
  // Determine channel-to-base mapping from FWO_ (filter wheel order)
  const fwoEntry = findEntry('FWO_', 1)
  let channelOrder = 'GATC' // default ABI order
  if (fwoEntry) {
    channelOrder = readString(fwoEntry).toUpperCase()
    if (channelOrder.length < 4) channelOrder = 'GATC'
  }

  // Processed traces are DATA.9-12, raw are DATA.1-4
  // Try processed first
  const traceEntries: (DirEntry | undefined)[] = [
    findEntry('DATA', 9) ?? findEntry('DATA', 1),
    findEntry('DATA', 10) ?? findEntry('DATA', 2),
    findEntry('DATA', 11) ?? findEntry('DATA', 3),
    findEntry('DATA', 12) ?? findEntry('DATA', 4),
  ]

  const traceArrays: number[][] = traceEntries.map(entry => {
    if (!entry) return []
    return readInt16Array(entry)
  })

  // Map channels to bases using FWO_ order
  const traces: Ab1Data['traces'] = { A: [], C: [], G: [], T: [] }
  for (let i = 0; i < 4; i++) {
    const base = channelOrder[i] as 'A' | 'C' | 'G' | 'T'
    if (base in traces) {
      traces[base] = traceArrays[i]
    }
  }

  // ---- Extract metadata ----
  const smplEntry = findEntry('SMPL', 1)
  const name = smplEntry ? readString(smplEntry) : ''

  const laneEntry = findEntry('LANE', 1)
  let lane: number | undefined
  if (laneEntry) {
    if (laneEntry.dataIsInline) {
      lane = laneEntry.elementSize === 2
        ? view.getInt16(laneEntry.dataOffset, false)
        : view.getInt32(laneEntry.dataOffset, false)
    } else {
      lane = view.getInt16(laneEntry.dataOffset, false)
    }
  }

  // Run dates (RUND.1 = start, RUND.2 = end) - stored as 4 int16: year, month, day, unused
  function readDate(entry: DirEntry | undefined): string | undefined {
    if (!entry || entry.dataSize < 6) return undefined
    const off = entry.dataOffset
    const year = view.getInt16(off, false)
    const month = view.getUint8(off + 2)
    const day = view.getUint8(off + 3)
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const runStartDate = readDate(findEntry('RUND', 1))
  const runEndDate = readDate(findEntry('RUND', 2))

  return {
    name: name || 'Untitled',
    bases,
    peakLocations,
    qualityScores,
    traces,
    metadata: {
      lane,
      runStartDate,
      runEndDate,
    },
  }
}

// ---------------------------------------------------------------------------
// Auto-trim
// ---------------------------------------------------------------------------

/**
 * Compute auto-trim boundaries using Mott's modified trimming algorithm.
 *
 * For each base, compute score = quality - threshold. Then find the contiguous
 * sub-array with the maximum cumulative sum (Kadane's algorithm variant).
 * This naturally trims low-quality tails while keeping the best internal region.
 *
 * Returns [trimStart, trimEnd) - 0-based, half-open.
 */
export function autoTrim(
  qualityScores: number[],
  minQuality = 20,
  _windowSize = 10,
): [number, number] {
  const n = qualityScores.length
  if (n === 0) return [0, 0]

  // Mott's algorithm: find the sub-array with maximum cumulative sum
  // where each element is (quality - threshold)
  let bestStart = 0
  let bestEnd = 0
  let bestSum = 0
  let curStart = 0
  let curSum = 0

  for (let i = 0; i < n; i++) {
    curSum += qualityScores[i] - minQuality
    if (curSum > bestSum) {
      bestSum = curSum
      bestEnd = i + 1
      bestStart = curStart
    }
    if (curSum < 0) {
      curSum = 0
      curStart = i + 1
    }
  }

  // If no region has positive cumulative quality, return empty
  if (bestEnd <= bestStart) return [0, 0]
  return [bestStart, bestEnd]
}
