/**
 * Export the trace as a figure: pick the stretch, row length and tracks, see
 * it, then save SVG, PNG or PDF. Orientation, channels, peak height and
 * even heights follow the current view.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import FigureSaveBar from '../FigureSaveBar'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { TraceModel } from '../../sanger/model'
import type { TraceView } from '../../sanger/view'
import { figureFile } from '../alignment/figure'
import { buildTraceFigure, MAX_FIGURE_BASES } from './figure'
import type { TraceSelection } from './TraceCanvas'

interface Props {
  model: TraceModel
  view: TraceView
  selection: TraceSelection | null
  name: string
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

const PER_LINE = [40, 60, 80, 100, 150, 200, 0]

export default function TraceFigureDialog({ model, view, selection, name, onClose, onExportPrompt }: Props) {
  const hasSel = !!selection && selection.d1 - selection.d0 >= 2
  const [region, setRegion] = useState<'selection' | 'kept' | 'all'>(hasSel ? 'selection' : 'kept')
  const [perLine, setPerLine] = useState(80)
  const [fontSize, setFontSize] = useState(10)
  const [traceHeight, setTraceHeight] = useState(80)
  const [ruler, setRuler] = useState(true)
  const [quality, setQuality] = useState(view.quality)
  const [title, setTitle] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  const [d0, d1] = region === 'selection' && hasSel ? [selection!.d0, selection!.d1]
    : region === 'kept' ? model.trim
    : [0, model.n]
  const tooBig = d1 - d0 > MAX_FIGURE_BASES
  const fig = useMemo(
    () => (tooBig || d1 <= d0 ? null : buildTraceFigure(model, view, {
      d0, d1, perLine, fontSize, traceHeight, ruler, quality, showTrim: region === 'all', title: title.trim() || undefined,
    })),
    [model, view, d0, d1, perLine, fontSize, traceHeight, ruler, quality, region, title, tooBig],
  )
  const preview = useMemo(() => (fig ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fig.svg)}` : null), [fig])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const file = useMemo(() => (fig ? figureFile(fig, title.trim() || name) : null), [fig, title, name])

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
              : <p className="aw-note">{tooBig ? `This stretch has ${(d1 - d0).toLocaleString()} bases; choose up to ${MAX_FIGURE_BASES.toLocaleString()} for a figure.` : 'Nothing to draw.'}</p>}
          </div>
          <div className="aw-figure-options aw-stack">
            <div className="aw-section-label">Region</div>
            <div className="aw-seg" role="radiogroup" aria-label="Region">
              <button role="radio" aria-checked={region === 'selection'} className={region === 'selection' ? 'active' : ''} disabled={!hasSel} onClick={() => setRegion('selection')} title={hasSel ? undefined : 'Select a stretch of the read first'}>Selection</button>
              <button role="radio" aria-checked={region === 'kept'} className={region === 'kept' ? 'active' : ''} onClick={() => setRegion('kept')}>Trimmed read</button>
              <button role="radio" aria-checked={region === 'all'} className={region === 'all' ? 'active' : ''} onClick={() => setRegion('all')}>Whole read</button>
            </div>
            <label className="aw-field">
              <span>Title</span>
              <input className="aw-text" value={title} onChange={e => setTitle(e.target.value)} placeholder="None" />
            </label>
            <label className="aw-field">
              <span>Bases per row</span>
              <select className="select aw-select-full" value={perLine} onChange={e => setPerLine(Number(e.target.value))}>
                {PER_LINE.map(n => <option key={n} value={n}>{n === 0 ? 'All on one row' : n}</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Letter size</span>
              <select className="select aw-select-full" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>
                {[8, 9, 10, 11, 12, 14].map(n => <option key={n} value={n}>{n} pt</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Trace height</span>
              <select className="select aw-select-full" value={traceHeight} onChange={e => setTraceHeight(Number(e.target.value))}>
                {[50, 80, 110, 150].map(n => <option key={n} value={n}>{n} px</option>)}
              </select>
            </label>
            <div className="aw-section-label">Show</div>
            <label className="aw-check"><input type="checkbox" checked={ruler} onChange={e => setRuler(e.target.checked)} /> Ruler</label>
            <label className="aw-check"><input type="checkbox" checked={quality} onChange={e => setQuality(e.target.checked)} disabled={!!model.data.metadata.qualityMissing} /> Quality bars</label>
            <p className="aw-note">Orientation, channels, peak height and even heights follow the current view.</p>
            <FigureSaveBar file={file} base={base} onExportPrompt={onExportPrompt} />
          </div>
        </div>
      </div>
    </div>
  )
}
