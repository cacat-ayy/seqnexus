/**
 * Export a stretch of a mapping as a figure (mappingFigure.ts): the view as
 * it is, or a stretch typed in, with a choice of tracks and size; then SVG,
 * PNG or PDF. Reads are drawn as laid out on
 * screen, so their colours, sorting and downsampling follow the view.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import FigureSaveBar from '../FigureSaveBar'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { figureFile } from '../alignment/figure'
import { buildMappingFigure, MAX_READ_SPAN, type MappingFigureInput } from './mappingFigure'
import type { ColorBy } from './mappingPaint'

const nf = new Intl.NumberFormat('en-US')

interface Props {
  input: MappingFigureInput
  /** What the view shows, and the stretch whose reads are loaded. */
  view: [number, number]
  loaded: [number, number] | null
  colorBy: ColorBy
  strands: boolean
  name: string
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

export default function MappingFigureDialog({ input, view, loaded, colorBy, strands: viewStrands, name, onClose, onExportPrompt }: Props) {
  const [region, setRegion] = useState<'view' | 'custom'>('view')
  const [from, setFrom] = useState(Math.floor(view[0]) + 1)
  const [to, setTo] = useState(Math.ceil(view[1]))
  const [width, setWidth] = useState(1000)
  const [maxRows, setMaxRows] = useState(40)
  const [coverageHeight, setCoverageHeight] = useState(60)
  const [title, setTitle] = useState('')
  const [tracks, setTracks] = useState({ ruler: true, coverage: true, variants: !!input.variants?.length, reference: true, reads: true })
  const [strands, setStrands] = useState(viewStrands)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  const [a, b] = region === 'view' ? [Math.floor(view[0]), Math.ceil(view[1])] : [Math.max(0, Math.min(from, to) - 1), Math.min(input.length, Math.max(from, to))]
  // Reads exist only where they are loaded.
  const readsHere = !!loaded && a >= loaded[0] && b <= loaded[1]
  const fig = useMemo(() => (b > a ? buildMappingFigure(input, {
    from: a, to: b, width, title: title.trim() || undefined,
    tracks: { ...tracks, reads: tracks.reads && readsHere },
    maxRows, coverageHeight, strands, colorBy,
    caption: input.layout && readsHere && tracks.reads && input.layout.sampledOut > 0 ? 'Reads downsampled to at most 100 starting in any 50 bases; coverage counts every read.' : undefined,
  }) : null), [input, a, b, width, title, tracks, readsHere, maxRows, coverageHeight, strands, colorBy])
  const preview = useMemo(() => (fig ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fig.svg)}` : null), [fig])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = `${name}_${a + 1}-${b}`.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const file = useMemo(() => (fig ? figureFile(fig, title.trim() || name) : null), [fig, title, name])
  const check = (k: keyof typeof tracks, label: string, disabled = false, hint?: string) => (
    <label className="aw-check" title={hint}><input type="checkbox" checked={tracks[k] && !disabled} disabled={disabled} onChange={e => setTracks(t => ({ ...t, [k]: e.target.checked }))} /> {label}</label>
  )

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aw-figure" ref={ref} role="dialog" aria-modal="true" aria-label="Export figure">
        <div className="aw-popover-head">
          <ImageIcon size={14} /> <span>Export figure</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="aw-figure-preview">
            {preview ? <img src={preview} alt="Figure preview" width={fig!.width} height={fig!.height} /> : <p className="aw-note">Nothing to draw.</p>}
          </div>
          <div className="aw-figure-options aw-stack">
            <div className="aw-section-label">Stretch of {input.refName}</div>
            <div className="seg seg-sm aw-seg" role="radiogroup" aria-label="Stretch">
              <button role="radio" aria-checked={region === 'view'} className={region === 'view' ? 'active' : ''} onClick={() => setRegion('view')}>The view</button>
              <button role="radio" aria-checked={region === 'custom'} className={region === 'custom' ? 'active' : ''} onClick={() => setRegion('custom')}>From … to …</button>
            </div>
            {region === 'custom' ? (
              <div className="tw-trim-pair">
                <label className="aw-field"><span>From</span><input className="aw-text" type="number" min={1} max={input.length} value={from} onChange={e => setFrom(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></label>
                <label className="aw-field"><span>To</span><input className="aw-text" type="number" min={1} max={input.length} value={to} onChange={e => setTo(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></label>
              </div>
            ) : <p className="aw-note">{nf.format(a + 1)} to {nf.format(b)} ({nf.format(b - a)} bp)</p>}
            <label className="aw-field">
              <span>Title</span>
              <input className="aw-text" value={title} onChange={e => setTitle(e.target.value)} placeholder="None" />
            </label>
            <label className="aw-field">
              <span>Width</span>
              <select className="select aw-select-full" value={width} onChange={e => setWidth(Number(e.target.value))}>
                {[600, 800, 1000, 1400, 2000].map(n => <option key={n} value={n}>{n} px</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Coverage height</span>
              <select className="select aw-select-full" value={coverageHeight} onChange={e => setCoverageHeight(Number(e.target.value))}>
                {[40, 60, 90, 140].map(n => <option key={n} value={n}>{n} px</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Rows of reads, at most</span>
              <select className="select aw-select-full" value={maxRows} onChange={e => setMaxRows(Number(e.target.value))}>
                {[10, 20, 40, 80, 150].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="aw-section-label">Show</div>
            {check('ruler', 'Ruler')}
            {check('coverage', 'Coverage')}
            <label className="aw-check"><input type="checkbox" checked={strands} disabled={!tracks.coverage} onChange={e => setStrands(e.target.checked)} /> Coverage by strand</label>
            {check('variants', 'Variants', !input.variants?.length, input.variants ? undefined : 'Find the variants first')}
            {check('reference', 'Reference bases', !input.bases)}
            {check('reads', 'Reads', !readsHere || b - a > MAX_READ_SPAN,
              b - a > MAX_READ_SPAN ? `Reads are drawn for ${nf.format(MAX_READ_SPAN)} bases or less` : !readsHere ? 'Reads are drawn where the view has them loaded: export the view, or move the view there first' : undefined)}
            <p className="aw-note">Reads keep the view&apos;s colours, order and downsampling; the reference&apos;s bases show when they are wide enough to tell apart.</p>
            <FigureSaveBar file={file} base={base} onExportPrompt={onExportPrompt} />
          </div>
        </div>
      </div>
    </div>
  )
}
