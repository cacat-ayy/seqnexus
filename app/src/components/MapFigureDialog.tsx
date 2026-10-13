/**
 * Export a map as a figure: the plasmid map, the protein domain map and
 * the cloning maps. Pick the size, the colours and whether the selection
 * shows, see it, then save SVG, PNG or PDF.
 *
 * The map is drawn again for the file rather than copied from the screen,
 * so the figure is the same whatever the panel's size, zoom or theme, and
 * never shows what the pointer happens to be over.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import type { PlasmidScene } from '../plasmid/scene'
import { renderSceneToSvg } from '../plasmid/renderSvg'
import { pdfMeasureText, sceneFigureFile, type MapFigureOptions } from '../plasmid/exportImage'
import FigureSaveBar from './FigureSaveBar'

interface Props {
  /** What is exported, for the file name and the PDF's title. */
  name: string
  /** Widths offered, in CSS pixels, smallest first. */
  sizes: readonly number[]
  defaultSize: number
  /** There is a selection or highlight that could be kept. */
  hasHighlights: boolean
  build: (o: MapFigureOptions) => PlasmidScene | null
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

const SIZE_NAMES = ['Small', 'Medium', 'Large']

export default function MapFigureDialog({ name, sizes, defaultSize, hasHighlights, build, onClose, onExportPrompt }: Props) {
  const [size, setSize] = useState(defaultSize)
  const [print, setPrint] = useState(true)
  const [highlights, setHighlights] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  const opts = useMemo<MapFigureOptions>(() => ({ size, print, highlights: highlights && hasHighlights }), [size, print, highlights, hasHighlights])
  const scene = useMemo(() => build(opts), [build, opts])
  const preview = useMemo(() => (scene ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSceneToSvg(scene))}` : null), [scene])
  const file = useMemo(() => (scene
    ? sceneFigureFile(scene, () => build({ ...opts, measureText: pdfMeasureText }) ?? scene, name)
    : null), [scene, build, opts, name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aw-figure" ref={ref} role="dialog" aria-modal="true" aria-label="Export figure">
        <div className="aw-popover-head">
          <ImageIcon size={14} /> <span>Export figure</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="aw-figure-preview aw-figure-preview-fit">
            {preview && scene && <img src={preview} alt="Figure preview" width={scene.size} height={scene.height ?? scene.size} />}
          </div>
          <div className="aw-figure-options aw-stack">
            <div className="aw-section-label">Size</div>
            <div className="aw-seg" role="radiogroup" aria-label="Size">
              {sizes.map((s, i) => (
                <button key={s} role="radio" aria-checked={size === s} className={size === s ? 'active' : ''} onClick={() => setSize(s)} title={`${s} px across`}>
                  {SIZE_NAMES[i] ?? `${s} px`}
                </button>
              ))}
            </div>
            <div className="aw-section-label">Colours</div>
            <div className="aw-seg" role="radiogroup" aria-label="Colours">
              <button role="radio" aria-checked={print} className={print ? 'active' : ''} onClick={() => setPrint(true)}>Print</button>
              <button role="radio" aria-checked={!print} className={!print ? 'active' : ''} onClick={() => setPrint(false)}>App theme</button>
            </div>
            <p className="aw-note">
              {print
                ? 'The light theme’s colours on white, as a journal or a slide wants them.'
                : 'The colours on screen, background included.'}
            </p>
            <label className="aw-check" title={hasHighlights ? undefined : 'Nothing is selected or found'}>
              <input type="checkbox" checked={highlights && hasHighlights} disabled={!hasHighlights} onChange={e => setHighlights(e.target.checked)} />
              Selection and highlights
            </label>
            <FigureSaveBar file={file} base={base} onExportPrompt={onExportPrompt} />
          </div>
        </div>
      </div>
    </div>
  )
}
