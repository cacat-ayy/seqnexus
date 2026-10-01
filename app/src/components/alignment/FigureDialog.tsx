/**
 * Export the alignment as a figure: pick the region, line width, tracks and
 * size, see it, then save SVG, PNG or (through the print dialog) PDF.
 * Colours, highlighting and translation follow the current view.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { width } from '../../msa/model'
import { downloadBlob, downloadText } from '../../utils/download'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { PaintModel } from './layout'
import type { Selection } from './paint'
import { MAX_FIGURE_CELLS, buildFigure, figureCells, figureToPng, printFigure, type FigureOptions } from './figure'

interface Props {
  pm: PaintModel
  selection: Selection | null
  name: string
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

const PER_LINE = [40, 50, 60, 80, 100, 120, 0]

export default function FigureDialog({ pm, selection, name, onClose, onExportPrompt }: Props) {
  const hasSel = !!selection && selection.c1 - selection.c0 >= 1
  const [region, setRegion] = useState<'selection' | 'all'>(hasSel ? 'selection' : 'all')
  const [perLine, setPerLine] = useState(60)
  const [fontSize, setFontSize] = useState(10)
  const [numbers, setNumbers] = useState(true)
  const [title, setTitle] = useState('')
  const [tracks, setTracks] = useState({
    ruler: true,
    logo: pm.view.tracks.logo,
    identity: pm.view.tracks.identity,
    consensus: pm.view.tracks.consensus,
  })
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  const opts = useMemo((): FigureOptions => {
    const w = width(pm.doc)
    const sel = region === 'selection' && hasSel ? selection! : null
    return {
      rowIds: sel ? sel.rowIds : null,
      c0: sel?.c0 ?? 0,
      c1: sel?.c1 ?? w,
      perLine, tracks, numbers, fontSize,
      title: title.trim() || undefined,
    }
  }, [pm.doc, region, hasSel, selection, perLine, tracks, numbers, fontSize, title])

  const cells = figureCells(pm, opts)
  const tooBig = cells > MAX_FIGURE_CELLS
  const fig = useMemo(() => (tooBig ? null : buildFigure(pm, opts)), [pm, opts, tooBig])
  const preview = useMemo(() => (fig ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fig.svg)}` : null), [fig])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const withName = (def: string, run: (n: string) => void) => (onExportPrompt ? onExportPrompt(def, run) : run(def))

  const saveSvg = () => fig && withName(`${base}.svg`, n => downloadText(fig.svg, n, 'image/svg+xml'))
  const savePng = (scale: number) => fig && withName(`${base}${scale >= 4 ? '-print' : ''}.png`, n => {
    figureToPng(fig, scale).then(b => downloadBlob(b, n)).catch(err => notify.error('Could not make the PNG', { detail: err instanceof Error ? err.message : String(err) }))
  })
  const savePdf = () => {
    if (fig && !printFigure(fig, title.trim() || name)) {
      notify.error('Could not open the print window', { detail: 'Allow pop-ups for this site to save a PDF.' })
    }
  }

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aw-figure" ref={ref} role="dialog" aria-modal="true" aria-label="Export figure">
        <div className="aw-popover-head">
          <ImageIcon size={14} /> <span>Export figure</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="aw-figure-preview">
            {preview
              ? <img src={preview} alt="Figure preview" width={fig!.width} height={fig!.height} />
              : <p className="aw-note">This region has {cells.toLocaleString()} residues; select up to {MAX_FIGURE_CELLS.toLocaleString()} for a figure.</p>}
          </div>
          <div className="aw-figure-options aw-stack">
            <div className="aw-section-label">Region</div>
            <div className="aw-seg" role="radiogroup" aria-label="Region">
              <button role="radio" aria-checked={region === 'selection'} className={region === 'selection' ? 'active' : ''} disabled={!hasSel} onClick={() => setRegion('selection')} title={hasSel ? undefined : 'Select a block in the alignment first'}>Selection</button>
              <button role="radio" aria-checked={region === 'all'} className={region === 'all' ? 'active' : ''} onClick={() => setRegion('all')}>Whole alignment</button>
            </div>
            <label className="aw-field">
              <span>Title</span>
              <input className="aw-text" value={title} onChange={e => setTitle(e.target.value)} placeholder="None" />
            </label>
            <label className="aw-field">
              <span>Columns per line</span>
              <select className="select aw-select-full" value={perLine} onChange={e => setPerLine(Number(e.target.value))}>
                {PER_LINE.map(n => <option key={n} value={n}>{n === 0 ? 'All on one line' : n}</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Letter size</span>
              <select className="select aw-select-full" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>
                {[8, 9, 10, 11, 12, 14].map(n => <option key={n} value={n}>{n} pt</option>)}
              </select>
            </label>
            <div className="aw-section-label">Show</div>
            {(['ruler', 'logo', 'identity', 'consensus'] as const).map(k => (
              <label key={k} className="aw-check">
                <input type="checkbox" checked={tracks[k]} onChange={e => setTracks(t => ({ ...t, [k]: e.target.checked }))} />
                {k === 'ruler' ? 'Column ruler' : k === 'logo' ? 'Sequence logo' : k === 'identity' ? (pm.doc.kind === 'protein' ? 'Similarity graph' : 'Identity graph') : 'Consensus'}
              </label>
            ))}
            <label className="aw-check">
              <input type="checkbox" checked={numbers} onChange={e => setNumbers(e.target.checked)} />
              Residue numbers at line ends
            </label>
            <p className="aw-note">Colours, highlighting and translation follow the current view.</p>
            <div className="aw-section-label">Save</div>
            <div className="aw-figure-save">
              <button className="btn btn-sm btn-primary" disabled={!fig} onClick={saveSvg} title="Vector; edit in Illustrator or Inkscape">SVG</button>
              <button className="btn btn-sm" disabled={!fig} onClick={() => savePng(2)} title="Image at 2× resolution">PNG</button>
              <button className="btn btn-sm" disabled={!fig} onClick={() => savePng(4)} title="Image at 4× resolution, for print">PNG 4×</button>
              <button className="btn btn-sm" disabled={!fig} onClick={savePdf} title="Opens the print dialog; choose Save as PDF">PDF</button>
            </div>
            {fig && <p className="aw-note">{fig.width.toLocaleString()} × {fig.height.toLocaleString()} px</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
