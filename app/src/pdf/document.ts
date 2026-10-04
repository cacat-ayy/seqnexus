/**
 * A minimal PDF writer: pages of vector content, the three standard fonts
 * in fonts.ts, and transparency through ExtGState. No images, no embedded
 * fonts, no external library. Version 1.5, the first to allow ActualText
 * on marked content, which the sequence runs use.
 *
 * Page content is collected as text (operators plus WinAnsi strings, one
 * char per byte) and Flate-compressed with fflate, which the app already
 * ships for reading Geneious files. A sequence page is mostly repeated
 * operators, so it compresses roughly tenfold.
 */

import { zlibSync } from 'fflate'
import { PDF_FONTS, encodeWinAnsi } from './fonts'
import { PdfCanvas } from './canvas'

/** A4 in points (1/72 inch). */
export const A4 = { width: 595.28, height: 841.89 }

interface Page {
  width: number
  height: number
  canvas: PdfCanvas
}

/** A PDF literal string from already-encoded text. */
export function pdfString(encoded: string): string {
  return `(${encoded.replace(/[\\()]/g, m => `\\${m}`).replace(/\r/g, '\\r').replace(/\n/g, '\\n')})`
}

/** PDF date string for an Info dictionary. */
function pdfDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export class PdfDocument {
  private readonly pages: Page[] = []
  /** Alpha value (rounded) to ExtGState resource name, fill and stroke apart. */
  private readonly fillAlphas = new Map<number, string>()
  private readonly strokeAlphas = new Map<number, string>()

  constructor(private readonly info: { title?: string; subject?: string } = {}) {}

  /** A new page; draw on the returned context in points, origin top left. */
  addPage(width = A4.width, height = A4.height): PdfCanvas {
    const canvas = new PdfCanvas(this, height)
    this.pages.push({ width, height, canvas })
    return canvas
  }

  get pageCount(): number {
    return this.pages.length
  }

  /** The ExtGState name setting this fill (ca) or stroke (CA) alpha. */
  alphaState(kind: 'fill' | 'stroke', alpha: number): string {
    const key = Math.round(Math.max(0, Math.min(1, alpha)) * 100)
    const map = kind === 'fill' ? this.fillAlphas : this.strokeAlphas
    let name = map.get(key)
    if (!name) {
      name = `${kind === 'fill' ? 'Fa' : 'Sa'}${key}`
      map.set(key, name)
    }
    return name
  }

  /** The finished file. */
  toBytes(): Uint8Array {
    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let length = 0
    const enc = new TextEncoder()
    const push = (b: Uint8Array) => { chunks.push(b); length += b.length }
    const text = (s: string) => push(enc.encode(s))
    /** Bytes of a string whose chars are all 0..255. */
    const latin1 = (s: string) => {
      const b = new Uint8Array(s.length)
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
      return b
    }

    // Object numbers: 1 catalog, 2 page tree, 3 resources, 4 info,
    // then a page object and a content stream per page.
    const pageObj = (i: number) => 5 + i * 2
    const total = 4 + this.pages.length * 2

    const object = (n: number, body: string) => {
      offsets[n] = length
      text(`${n} 0 obj\n${body}\nendobj\n`)
    }

    // The binary comment marks the file as binary for transfer tools.
    push(latin1('%PDF-1.5\n%\xe2\xe3\xcf\xd3\n'))
    object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    const kids = this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')
    object(2, `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`)

    const fonts = Object.entries(PDF_FONTS)
      .map(([id, base]) => `/${id} << /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`)
      .join(' ')
    const states = [
      ...[...this.fillAlphas].map(([k, name]) => `/${name} << /Type /ExtGState /ca ${k / 100} >>`),
      ...[...this.strokeAlphas].map(([k, name]) => `/${name} << /Type /ExtGState /CA ${k / 100} >>`),
    ].join(' ')
    object(3, `<< /ProcSet [/PDF /Text] /Font << ${fonts} >> /ExtGState << ${states} >> >>`)

    const infoEntries = [
      this.info.title ? `/Title ${pdfString(encodeWinAnsi(this.info.title))}` : '',
      this.info.subject ? `/Subject ${pdfString(encodeWinAnsi(this.info.subject))}` : '',
      '/Producer (SeqNexus)',
      '/Creator (SeqNexus)',
      `/CreationDate (${pdfDate(new Date())})`,
    ].filter(Boolean).join(' ')
    object(4, `<< ${infoEntries} >>`)

    this.pages.forEach((page, i) => {
      const n = pageObj(i)
      object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources 3 0 R /Contents ${n + 1} 0 R >>`)
      const data = zlibSync(latin1(page.canvas.content()), { level: 6 })
      offsets[n + 1] = length
      text(`${n + 1} 0 obj\n<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`)
      push(data)
      text('\nendstream\nendobj\n')
    })

    const xref = length
    let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`
    for (let n = 1; n <= total; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
    text(table)
    text(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

    const out = new Uint8Array(length)
    let at = 0
    for (const c of chunks) { out.set(c, at); at += c.length }
    return out
  }

  toBlob(): Blob {
    return new Blob([this.toBytes()], { type: 'application/pdf' })
  }
}
