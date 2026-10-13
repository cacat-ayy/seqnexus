/**
 * The SeqNexus credit and print resolution written into exported figures.
 *
 * - SVG: a <desc> as the first child of the root, which editors keep and
 *   renderers do not draw.
 * - PNG: a pHYs chunk with the resolution, so a 300 dpi PNG opens in Word,
 *   Illustrator or a journal's system at its intended size rather than at
 *   72 or 96 dpi, and tEXt chunks for the software and the citation.
 *
 * Both are written after the image is made, so every figure path can
 * share them.
 */

import { FILE_CREDIT } from '../citation'
import { crc32 } from '../ngs/bam'

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** An SVG with the credit as its first <desc>. */
export function svgWithCredit(svg: string): string {
  const open = /<svg\b[^>]*>/.exec(svg)
  if (!open) return svg
  const at = open.index + open[0].length
  return `${svg.slice(0, at)}<desc>${escXml(FILE_CREDIT)}</desc>${svg.slice(at)}`
}

/** CSS pixels per inch, the scale every figure is drawn at. */
export const CSS_DPI = 96

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A tEXt chunk: a Latin-1 keyword, a zero byte, Latin-1 text. */
function textChunk(keyword: string, text: string): Uint8Array {
  const bytes = new Uint8Array(keyword.length + 1 + text.length)
  for (let i = 0; i < keyword.length; i++) bytes[i] = keyword.charCodeAt(i) & 0xff
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    bytes[keyword.length + 1 + i] = c < 256 ? c : 0x3f
  }
  return chunk('tEXt', bytes)
}

/** A blob's bytes (FileReader where Blob.arrayBuffer is missing, as in jsdom). */
export function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then(b => new Uint8Array(b))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** A pHYs chunk: pixels per metre on both axes. */
function physChunk(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint32(0, ppm)
  view.setUint32(4, ppm)
  data[8] = 1 // the unit is the metre
  return chunk('pHYs', data)
}

/**
 * A PNG with its resolution (when known) and the credit added after the
 * header chunk. Any pHYs the browser wrote is replaced. A blob that is not
 * a PNG comes back unchanged.
 */
export async function pngWithCredit(blob: Blob, dpi?: number): Promise<Blob> {
  const bytes = await blobBytes(blob)
  const PNG = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 33 || PNG.some((b, i) => bytes[i] !== b)) return blob
  const ihdrEnd = 8 + 12 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(8)
  const parts: Uint8Array[] = [bytes.subarray(0, ihdrEnd)]
  if (dpi) parts.push(physChunk(dpi))
  parts.push(textChunk('Software', 'SeqNexus'), textChunk('Comment', FILE_CREDIT))
  // The rest, without a pHYs of the browser's.
  let at = ihdrEnd
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const end = at + 12 + len
    if (type !== 'pHYs' || !dpi) parts.push(bytes.subarray(at, end))
    at = end
  }
  return new Blob(parts as BlobPart[], { type: 'image/png' })
}
