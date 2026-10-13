/**
 * The virtual gel as a PDF report: its title, the gel's conditions, the
 * photo, and a table of the lanes and their fragments, written by the app's
 * own PDF writer like every other report (pdf/report-pdf.ts). The photo goes
 * in as an image: the slab is drawn pixel by pixel (band blur, glow, the
 * stained background), which has no vector form.
 *
 * It used to open a pop-up window and the browser's print dialog, which a
 * pop-up blocker stopped, named the file "Virtual Gel Export" and closed the
 * window before some browsers had printed it.
 */

import { writeReportPdf } from '../pdf/report-pdf'

export interface LaneRow {
  lane: number
  type: string
  source: string
  enzymes: string
  fragCount: number
  fragments: string
}

export function gelReportPdf(canvas: HTMLCanvasElement, rows: readonly LaneRow[], gel: { name: string; caption: string; unit: string }): Uint8Array {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('The gel could not be drawn')
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return writeReportPdf({
    title: gel.name,
    subtitle: `${gel.caption}. ${rows.length} ${rows.length === 1 ? 'lane' : 'lanes'}. Made with SeqNexus on ${date}.`,
    blocks: [
      { kind: 'image', width: canvas.width, height: canvas.height, rgba: pixels },
      {
        kind: 'table',
        columns: [
          { label: 'Lane', numeric: true }, { label: 'Type' }, { label: 'Source' }, { label: 'Enzymes' },
          { label: 'Fragments', numeric: true }, { label: `Sizes (${gel.unit})` },
        ],
        rows: rows.map(r => [String(r.lane), r.type, r.source, r.enzymes, String(r.fragCount), r.fragments]),
      },
    ],
  })
}
