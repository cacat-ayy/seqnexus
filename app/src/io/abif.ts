/**
 * Generic reader for the Applied Biosystems ABIF container (.ab1, .fsa).
 *
 * ABIF is a big-endian tag directory: a 128-byte header whose root entry
 * points at a table of 28-byte entries, each naming a tag ("PBAS", "DATA",
 * ...), a tag number, an element type and where the data lives. Values of
 * four bytes or fewer are stored inside the entry itself.
 *
 * This module only knows the container. What the tags mean for a sequencing
 * trace is in ab1.ts.
 */

export interface AbifEntry {
  tag: string
  num: number
  elementType: number
  elementSize: number
  count: number
  dataSize: number
  /** Absolute file offset of the data (inside the entry when inline). */
  offset: number
}

/** ABIF element type codes that are read here. */
export const ABIF_TYPE = {
  byte: 1,
  char: 2,
  word: 3,
  short: 4,
  long: 5,
  float: 7,
  double: 8,
  date: 10,
  time: 11,
  pString: 18,
  cString: 19,
} as const

const ABIF_MAGIC = 0x41424946 // "ABIF"
const ENTRY_SIZE = 28

export class AbifFile {
  readonly entries: AbifEntry[]
  private readonly view: DataView
  private readonly byKey = new Map<string, AbifEntry>()

  constructor(readonly buffer: ArrayBuffer) {
    if (buffer.byteLength < 128) throw new Error('File too small to be a valid ABIF file.')
    this.view = new DataView(buffer)
    if (this.view.getUint32(0, false) !== ABIF_MAGIC) {
      throw new Error('Not an ABIF file - invalid magic bytes.')
    }

    // Root entry at offset 6: elementCount at +12, dataOffset at +20.
    const count = this.view.getInt32(18, false)
    const dirOffset = this.view.getInt32(26, false)
    if (count <= 0 || dirOffset <= 0 || dirOffset >= buffer.byteLength) {
      throw new Error('Invalid ABIF directory pointer.')
    }

    this.entries = []
    for (let i = 0; i < count; i++) {
      const base = dirOffset + i * ENTRY_SIZE
      if (base + ENTRY_SIZE > buffer.byteLength) break
      const v = this.view
      const tag = String.fromCharCode(v.getUint8(base), v.getUint8(base + 1), v.getUint8(base + 2), v.getUint8(base + 3))
      const dataSize = v.getInt32(base + 16, false)
      const entry: AbifEntry = {
        tag,
        num: v.getInt32(base + 4, false),
        elementType: v.getInt16(base + 8, false),
        elementSize: v.getInt16(base + 10, false),
        count: v.getInt32(base + 12, false),
        dataSize,
        offset: dataSize <= 4 ? base + 20 : v.getInt32(base + 20, false),
      }
      // A truncated file can point past its end; such entries are dropped
      // rather than read as garbage.
      if (entry.offset < 0 || entry.offset + Math.max(0, dataSize) > buffer.byteLength) continue
      this.entries.push(entry)
      const key = `${tag}.${entry.num}`
      if (!this.byKey.has(key)) this.byKey.set(key, entry)
    }
  }

  get(tag: string, num = 1): AbifEntry | undefined {
    return this.byKey.get(`${tag}.${num}`)
  }

  has(tag: string, num = 1): boolean {
    return this.byKey.has(`${tag}.${num}`)
  }

  /** Text of a char, pString or cString entry, trimmed of padding. */
  string(tag: string, num = 1): string | undefined {
    const e = this.get(tag, num)
    if (!e) return undefined
    let start = e.offset
    let len: number
    if (e.elementType === ABIF_TYPE.pString) {
      if (e.dataSize < 1) return ''
      len = Math.min(this.view.getUint8(start), e.dataSize - 1)
      start += 1
    } else {
      len = e.elementType === ABIF_TYPE.char || e.elementType === ABIF_TYPE.cString ? e.count : e.dataSize
    }
    len = Math.max(0, Math.min(len, this.buffer.byteLength - start))
    let out = ''
    for (let i = 0; i < len; i++) {
      const c = this.view.getUint8(start + i)
      if (c === 0) break
      // Latin-1: instrument software writes µ and similar in some fields.
      if (c >= 32) out += String.fromCharCode(c)
    }
    return out.trim()
  }

  /** Numeric values of an entry, whatever its integer or float type. */
  numbers(tag: string, num = 1): number[] | undefined {
    const e = this.get(tag, num)
    if (!e) return undefined
    const v = this.view
    const out: number[] = new Array(e.count)
    const o = e.offset
    switch (e.elementType) {
      case ABIF_TYPE.byte:
      case ABIF_TYPE.char:
        for (let i = 0; i < e.count; i++) out[i] = v.getUint8(o + i)
        return out
      case ABIF_TYPE.word:
        for (let i = 0; i < e.count; i++) out[i] = v.getUint16(o + i * 2, false)
        return out
      case ABIF_TYPE.short:
        for (let i = 0; i < e.count; i++) out[i] = v.getInt16(o + i * 2, false)
        return out
      case ABIF_TYPE.long:
        for (let i = 0; i < e.count; i++) out[i] = v.getInt32(o + i * 4, false)
        return out
      case ABIF_TYPE.float:
        for (let i = 0; i < e.count; i++) out[i] = v.getFloat32(o + i * 4, false)
        return out
      case ABIF_TYPE.double:
        for (let i = 0; i < e.count; i++) out[i] = v.getFloat64(o + i * 8, false)
        return out
      default:
        return undefined
    }
  }

  /** First numeric value of an entry. */
  number(tag: string, num = 1): number | undefined {
    const n = this.numbers(tag, num)
    return n && n.length > 0 ? n[0] : undefined
  }

  /** A date entry as YYYY-MM-DD, or undefined when absent or implausible. */
  date(tag: string, num = 1): string | undefined {
    const e = this.get(tag, num)
    if (!e || e.elementType !== ABIF_TYPE.date || e.dataSize < 4) return undefined
    const year = this.view.getInt16(e.offset, false)
    const month = this.view.getUint8(e.offset + 2)
    const day = this.view.getUint8(e.offset + 3)
    if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return undefined
    return `${year}-${pad2(month)}-${pad2(day)}`
  }

  /** A time entry as HH:MM:SS. */
  time(tag: string, num = 1): string | undefined {
    const e = this.get(tag, num)
    if (!e || e.elementType !== ABIF_TYPE.time || e.dataSize < 3) return undefined
    const h = this.view.getUint8(e.offset)
    const m = this.view.getUint8(e.offset + 1)
    const s = this.view.getUint8(e.offset + 2)
    if (h > 23 || m > 59 || s > 59) return undefined
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
