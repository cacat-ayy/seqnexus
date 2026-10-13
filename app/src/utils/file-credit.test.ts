import { describe, it, expect } from 'vitest'
import { crc32 } from '../ngs/bam'
import { blobBytes, pngWithCredit, svgWithCredit } from './file-credit'
import { FILE_CREDIT } from '../citation'

function chunk(type: string, data: number[]): number[] {
  const body = [...type].map(c => c.charCodeAt(0)).concat(data)
  const len = data.length
  const crc = crc32(new Uint8Array(body))
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]
}

/** A 1 by 1 PNG's chunks, as a browser writes them (with a 72 dpi pHYs). */
function tinyPng(): Blob {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  const ihdr = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])
  const phys = chunk('pHYs', [0, 0, 11, 19, 0, 0, 11, 19, 1])
  const idat = chunk('IDAT', [120, 156, 99, 248, 15, 0, 1, 1, 1, 0])
  const iend = chunk('IEND', [])
  return new Blob([new Uint8Array([...sig, ...ihdr, ...phys, ...idat, ...iend])], { type: 'image/png' })
}

/** The chunks of a PNG: type, data, and whether the CRC is right. */
async function chunks(blob: Blob) {
  const b = await blobBytes(blob)
  const v = new DataView(b.buffer, b.byteOffset)
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = []
  for (let at = 8; at < b.length;) {
    const len = v.getUint32(at)
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8))
    out.push({ type, data: b.subarray(at + 8, at + 8 + len), crcOk: crc32(b.subarray(at + 4, at + 8 + len)) === v.getUint32(at + 8 + len) })
    at += 12 + len
  }
  return out
}

describe('svgWithCredit', () => {
  it('adds the credit as the first child of the root', () => {
    const out = svgWithCredit('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect/></svg>')
    expect(out).toMatch(/^<svg [^>]*><desc>Made with SeqNexus/)
    expect(new DOMParser().parseFromString(out, 'image/svg+xml').querySelector('desc')?.textContent).toBe(FILE_CREDIT)
  })
})

describe('pngWithCredit', () => {
  it('writes the resolution and the credit, replacing the browser pHYs', async () => {
    const list = await chunks(await pngWithCredit(tinyPng(), 300))
    expect(list.map(c => c.type)).toEqual(['IHDR', 'pHYs', 'tEXt', 'tEXt', 'IDAT', 'IEND'])
    expect(list.every(c => c.crcOk)).toBe(true)
    const phys = new DataView(list[1].data.buffer, list[1].data.byteOffset)
    expect(phys.getUint32(0)).toBe(Math.round(300 / 0.0254))
    expect(new TextDecoder('latin1').decode(list[3].data)).toBe(`Comment\0${FILE_CREDIT}`)
  })

  it('keeps the browser resolution when none is given', async () => {
    const list = await chunks(await pngWithCredit(tinyPng()))
    expect(list.map(c => c.type)).toEqual(['IHDR', 'tEXt', 'tEXt', 'pHYs', 'IDAT', 'IEND'])
  })
})
