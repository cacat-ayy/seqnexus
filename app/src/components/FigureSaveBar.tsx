/**
 * The Save section of every figure dialog (alignment, trace, mapping, map):
 * SVG, PNG at a chosen resolution, PDF, the size the figure prints at, and
 * the request to cite SeqNexus.
 *
 * A figure is drawn in CSS pixels, 96 to the inch, so its printed size is
 * fixed and a PNG's resolution only decides how many pixels it has. The
 * choices are named by what they are for (150 dpi for slides and the
 * screen, 300 for print, 600 for line art, the journals' usual asks), and
 * the PNG carries its resolution so it opens at the size it was made.
 */

import { useState } from 'react'
import { Copy } from 'lucide-react'
import { downloadBlob, downloadText } from '../utils/download'
import { CSS_DPI, pngWithCredit, svgWithCredit } from '../utils/file-credit'
import { notify } from '../toast'
import CiteHint from './CiteHint'
import { promptFileName } from '../utils/export-prompt'
import { copyImage } from '../utils/clipboard'
import type { FigureFile } from '../utils/figure-file'

export type { FigureFile } from '../utils/figure-file'

const RESOLUTIONS = [
  { dpi: 150, label: '150 dpi, slides and screen' },
  { dpi: 300, label: '300 dpi, print' },
  { dpi: 600, label: '600 dpi, line art' },
]

const cm = (px: number) => (px / CSS_DPI * 2.54).toFixed(1)
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface Props {
  file: FigureFile | null
  /** The file name without its extension. */
  base: string
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

export default function FigureSaveBar({ file, base, onExportPrompt }: Props) {
  const [dpi, setDpi] = useState(300)
  const withName = (def: string, run: (n: string) => void) => (onExportPrompt ?? promptFileName)(def, run)

  const saveSvg = () => file && withName(`${base}.svg`, n => {
    downloadText(svgWithCredit(file.svg()), n, 'image/svg+xml')
    notify.success(`Exported ${n}`)
  })
  const savePng = () => file && withName(`${base}-${dpi}dpi.png`, n => {
    file.png(dpi / CSS_DPI)
      .then(({ blob, scale }) => pngWithCredit(blob, Math.round(scale * CSS_DPI)))
      .then(blob => { downloadBlob(blob, n); notify.success(`Exported ${n}`) })
      .catch(err => notify.error('Could not make the PNG', { detail: errorText(err) }))
  })
  // The PNG at the chosen resolution, straight to the clipboard, for slides and documents.
  const copyPng = () => file && void copyImage(
    file.png(dpi / CSS_DPI).then(({ blob, scale }) => pngWithCredit(blob, Math.round(scale * CSS_DPI))),
    'Copied the figure as an image',
  )
  const savePdf = () => file && withName(`${base}.pdf`, n => {
    try {
      downloadBlob(file.pdf(), n)
      notify.success(`Exported ${n}`)
    } catch (err) {
      notify.error('Could not make the PDF', { detail: errorText(err) })
    }
  })

  return (
    <>
      <div className="aw-section-label">Save</div>
      <label className="aw-field">
        <span>PNG resolution</span>
        <select className="select aw-select-full" value={dpi} onChange={e => setDpi(Number(e.target.value))}>
          {RESOLUTIONS.map(r => <option key={r.dpi} value={r.dpi}>{r.label}</option>)}
        </select>
      </label>
      <div className="aw-figure-save">
        <button className="btn btn-sm btn-primary" disabled={!file} onClick={saveSvg} title="Vector; edit in Illustrator or Inkscape">SVG</button>
        <button className="btn btn-sm" disabled={!file} onClick={savePng} title={`Image at ${dpi} dpi`}>PNG</button>
        <button className="btn btn-sm" disabled={!file} onClick={savePdf} title="Vector, one page at the figure's size">PDF</button>
        <button className="btn btn-sm" disabled={!file} onClick={copyPng} title={`Copy as an image at ${dpi} dpi, to paste into slides or a document`}>
          <Copy size={12} /> Copy
        </button>
      </div>
      {file && (
        <p className="aw-note">
          Prints at {cm(file.width)} × {cm(file.height)} cm; the PNG is
          {' '}{Math.round(file.width * dpi / CSS_DPI).toLocaleString()} × {Math.round(file.height * dpi / CSS_DPI).toLocaleString()} px.
        </p>
      )}
      <CiteHint />
    </>
  )
}
