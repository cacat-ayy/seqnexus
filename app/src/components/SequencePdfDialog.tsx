import './SequencePdfDialog.css'
/**
 * Export the sequence as a PDF, drawn as the text view draws it.
 *
 * Pick the bases (all, the rows in view, the selection or a range), the
 * line length and orientation, and what goes with the sequence (header and
 * page numbers, a map page, feature and enzyme tables). A preview shows
 * each page as it will print. The file is written in the browser, vector
 * throughout, with the sequence as selectable text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import { isOriginSpanningSelection } from '../store'
import { displayPosition } from '../models/Document'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { downloadBlob } from '../utils/download'
import { copyText } from '../utils/clipboard'
import { notify } from '../toast'
import { CITATION_TEXT } from '../citation'
import { getRenderMode } from './zoom-layout'
import { getVisibleRange } from './sequence-view-controls'
import { useSequencePdfSource } from '../pdf/useSequencePdfSource'
import {
  MAX_PDF_PAGES, planSequencePdf, rangeLength, renderPdfPage, writeSequencePdf,
  type PdfRange, type SequencePdfOptions,
} from '../pdf/sequence-pdf'
import { PAPER } from '../pdf/print-colors'

interface Props {
  open: boolean
  onClose: () => void
  /** Ask App for a filename before writing the file, as the other exports do. */
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

type RangeKind = 'all' | 'visible' | 'selection' | 'custom'

/** Line lengths offered at letters zoom; 0 is the screen's. */
const LINE_LENGTHS = [0, 50, 60, 80, 100, 120, 150]

/** Below this the sequence letters get hard to read on paper. */
const SMALL_LETTER_PT = 5

/** Preview width in CSS px for each orientation. */
const PREVIEW_W = { portrait: 300, landscape: 424 }

/** Choices worth keeping between exports; the range and title are per export. */
interface Prefs {
  basesPerRow: number
  landscape: boolean
  header: boolean
  map: boolean
  features: boolean
  enzymes: boolean
}
const PREFS_KEY = 'seqnexus.pdfExport'
const DEFAULT_PREFS: Prefs = { basesPerRow: 0, landscape: false, header: true, map: true, features: true, enzymes: true }

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch { /* private mode: not remembered */ }
}

export default function SequencePdfDialog({ open, onClose, onExportPrompt }: Props) {
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null
  return (
    <PdfDialogBody closing={closing} onAnimationEnd={onAnimationEnd} onClose={onClose} onExportPrompt={onExportPrompt} />
  )
}

function PdfDialogBody({ closing, onAnimationEnd, onClose, onExportPrompt }: {
  closing: boolean
  onAnimationEnd: (e: React.AnimationEvent) => void
  onClose: () => void
  onExportPrompt?: Props['onExportPrompt']
}) {
  const source = useSequencePdfSource()
  const { doc, selection } = source
  const seqLen = doc.sequence.length
  const topology = doc.sequence.topology
  const origin = (topology === 'circular' ? doc.metadata?.displayOrigin : 0) || 0
  const dp = useCallback((p: number) => displayPosition(p, origin, seqLen), [origin, seqLen])

  // Snapshot of what was on screen when the dialog opened.
  const [visibleRange] = useState(() => getVisibleRange())
  const hasSelection = selection.anchor !== selection.caret
  const selectionRange = useMemo<PdfRange | null>(() => {
    if (!hasSelection) return null
    if (isOriginSpanningSelection(selection, topology)) return { start: selection.anchor, end: selection.caret }
    return { start: Math.min(selection.anchor, selection.caret), end: Math.max(selection.anchor, selection.caret) }
  }, [hasSelection, selection, topology])

  const [rangeKind, setRangeKind] = useState<RangeKind>('all')
  const [customFrom, setCustomFrom] = useState(() => String(dp(selectionRange?.start ?? 0)))
  const [customTo, setCustomTo] = useState(() => String(dp(((selectionRange?.end ?? seqLen) - 1 + seqLen) % seqLen)))
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [title, setTitle] = useState('')
  const [highlights, setHighlights] = useState(false)
  const [page, setPage] = useState(0)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    setPrefs(p => {
      const next = { ...p, [key]: value }
      savePrefs(next)
      return next
    })
  }

  /** Custom range from the typed display positions, or an error to show. */
  const custom = useMemo((): { range: PdfRange } | { error: string } => {
    const from = parseInt(customFrom.replace(/[,\s]/g, ''), 10)
    const to = parseInt(customTo.replace(/[,\s]/g, ''), 10)
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: 'Enter two positions' }
    if (from < 1 || to < 1 || from > seqLen || to > seqLen) return { error: `Positions run from 1 to ${seqLen.toLocaleString()}` }
    const internal = (d: number) => (d - 1 + origin) % seqLen
    let start = internal(from)
    let last = internal(to)
    if (topology !== 'circular' && start > last) [start, last] = [last, start]
    // On a circular sequence "from" past "to" reads through the origin.
    return { range: { start, end: last + 1 } }
  }, [customFrom, customTo, seqLen, origin, topology])

  const range: PdfRange | null =
    rangeKind === 'all' ? { start: 0, end: seqLen }
      : rangeKind === 'visible' ? visibleRange
        : rangeKind === 'selection' ? selectionRange
          : 'range' in custom ? custom.range : null

  const letters = getRenderMode(source.zoomLevel) === 'letters'
  const isCircular = topology === 'circular'
  const hasEnzymes = source.groupedSites.length > 0
  const hasHighlights = hasSelection || source.search.matches.length > 0

  // The range object is rebuilt each render; its two numbers are what matter.
  const rangeStart = range ? range.start : -1
  const rangeEnd = range ? range.end : -1
  const options = useMemo((): SequencePdfOptions | null => {
    if (rangeStart < 0) return null
    return {
      range: { start: rangeStart, end: rangeEnd },
      basesPerRow: prefs.basesPerRow,
      landscape: prefs.landscape,
      header: prefs.header,
      highlights,
      selectionTranslation: highlights || rangeKind === 'selection',
      map: prefs.map && isCircular,
      features: prefs.features,
      enzymes: prefs.enzymes && hasEnzymes,
      title,
    }
  }, [rangeStart, rangeEnd, prefs, highlights, rangeKind, isCircular, hasEnzymes, title])

  const plan = useMemo(() => (options && rangeLength(options.range, seqLen) > 0 ? planSequencePdf(source, options) : null), [source, options, seqLen])
  const pageCount = plan?.pages.length ?? 0
  const tooMany = pageCount > MAX_PDF_PAGES
  const shownPage = Math.min(page, Math.max(0, pageCount - 1))

  // --- Preview ---
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewW = prefs.landscape ? PREVIEW_W.landscape : PREVIEW_W.portrait
  const previewH = plan ? Math.round(previewW * (plan.pageHeight / plan.pageWidth)) : Math.round(previewW * 1.414)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !plan || tooMany) return
    // Drawn at twice the device resolution so small print stays legible.
    const px = (window.devicePixelRatio || 1) * 2
    canvas.width = Math.round(previewW * px)
    canvas.height = Math.round(previewH * px)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const s = (previewW * px) / plan.pageWidth
    ctx.setTransform(s, 0, 0, s, 0, 0)
    renderPdfPage(ctx, plan, shownPage)
  }, [plan, shownPage, previewW, previewH, tooMany])

  // --- Save ---
  const busy = progress !== null
  const save = () => {
    if (!plan || tooMany || busy) return
    const base = (title.trim() || doc.name || 'sequence').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'sequence'
    const write = async (name: string) => {
      const filename = /\.pdf$/i.test(name) ? name : `${name}.pdf`
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setProgress({ done: 0, total: plan.pages.length })
      try {
        const bytes = await writeSequencePdf(plan, (done, total) => setProgress({ done, total }), ctrl.signal)
        const blob = new Blob([bytes], { type: 'application/pdf' })
        downloadBlob(blob, filename)
        notify.success(`Exported ${filename}`, { detail: `${plan.pages.length} page${plan.pages.length === 1 ? '' : 's'}` })
        onClose()
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          notify.error('Could not write the PDF', { detail: err instanceof Error ? err.message : String(err) })
        }
      } finally {
        abortRef.current = null
        setProgress(null)
      }
    }
    if (onExportPrompt) onExportPrompt(`${base}.pdf`, n => { void write(n) })
    else void write(`${base}.pdf`)
  }

  const close = useCallback(() => {
    abortRef.current?.abort()
    onClose()
  }, [onClose])
  useEffect(() => () => abortRef.current?.abort(), [])

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, true)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }

  const rangeNote = (r: PdfRange | null) => {
    if (!r) return ''
    const n = rangeLength(r, seqLen)
    return `${dp(r.start).toLocaleString()}-${dp((r.end - 1 + seqLen) % seqLen).toLocaleString()} (${n.toLocaleString()} bp)`
  }

  const letterPt = plan?.letterPt ?? 0
  const rangeOptions: { id: RangeKind; label: string; disabled?: boolean; why?: string }[] = [
    { id: 'all', label: 'Whole sequence' },
    { id: 'visible', label: 'Visible region', disabled: !visibleRange, why: 'Open the sequence view to use the rows in view' },
    { id: 'selection', label: 'Selection', disabled: !selectionRange, why: 'Select some bases first' },
    { id: 'custom', label: 'Range' },
  ]

  return (
    <div
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      ref={backdropRef}
      onMouseDown={e => { if (e.target === backdropRef.current && !busy) close() }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-dialog pdf-dialog" role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title">
        <div className="modal-header">
          <h3 className="modal-title" id="pdf-dialog-title">Export PDF</h3>
          <button className="modal-close" onClick={close} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body pdf-body">
          <div className="pdf-preview">
            <div className="pdf-page" style={{ width: previewW, height: previewH }}>
              {plan && !tooMany
                ? <canvas ref={canvasRef} style={{ width: previewW, height: previewH }} aria-label={`Preview of page ${shownPage + 1}`} />
                : <p className="pdf-page-note">{tooMany
                    ? `This would be ${pageCount.toLocaleString()}+ pages. Export a smaller range, or zoom out for an overview.`
                    : 'Nothing to export in this range.'}</p>}
            </div>
            {plan && !tooMany && (
              <div className="pdf-pager">
                <button className="pdf-pager-btn" onClick={() => setPage(Math.max(0, shownPage - 1))} disabled={shownPage === 0} aria-label="Previous page"><ChevronLeft size={14} /></button>
                <span>Page {shownPage + 1} of {pageCount}</span>
                <button className="pdf-pager-btn" onClick={() => setPage(Math.min(pageCount - 1, shownPage + 1))} disabled={shownPage >= pageCount - 1} aria-label="Next page"><ChevronRight size={14} /></button>
              </div>
            )}
          </div>

          <div className="pdf-options">
            <div className="pdf-section">
              <div className="pdf-section-label" id="pdf-range-label">Bases</div>
              <div className="pdf-range-list" role="radiogroup" aria-labelledby="pdf-range-label">
                {rangeOptions.map(o => (
                  <label key={o.id} className={`pdf-radio${o.disabled ? ' disabled' : ''}`} title={o.disabled ? o.why : undefined}>
                    <input type="radio" name="pdf-range" checked={rangeKind === o.id} disabled={o.disabled} onChange={() => { setRangeKind(o.id); setPage(0) }} />
                    <span>{o.label}</span>
                    {o.id === 'visible' && visibleRange && <span className="pdf-hint">{rangeNote(visibleRange)}</span>}
                    {o.id === 'selection' && selectionRange && <span className="pdf-hint">{rangeNote(selectionRange)}</span>}
                    {o.id === 'all' && <span className="pdf-hint">{seqLen.toLocaleString()} bp</span>}
                  </label>
                ))}
              </div>
              {rangeKind === 'custom' && (
                <div className="pdf-custom">
                  <input className="input pdf-pos" value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label="From position" inputMode="numeric" />
                  <span>to</span>
                  <input className="input pdf-pos" value={customTo} onChange={e => setCustomTo(e.target.value)} aria-label="To position" inputMode="numeric" />
                  {'error' in custom
                    ? <span className="pdf-hint pdf-warn">{custom.error}</span>
                    : <span className="pdf-hint">{rangeLength(custom.range, seqLen).toLocaleString()} bp</span>}
                </div>
              )}
            </div>

            <div className="pdf-section">
              <div className="pdf-section-label">Layout</div>
              <div className="pdf-row">
                <span className="pdf-row-label">Page</span>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${!prefs.landscape ? 'active' : ''}`} onClick={() => setPref('landscape', false)}>A4 portrait</button>
                  <button type="button" className={`toggle-btn ${prefs.landscape ? 'active' : ''}`} onClick={() => setPref('landscape', true)}>A4 landscape</button>
                </div>
              </div>
              {letters ? (
                <label className="pdf-row">
                  <span className="pdf-row-label">Bases per line</span>
                  <select className="select" value={prefs.basesPerRow} onChange={e => { setPref('basesPerRow', Number(e.target.value)); setPage(0) }}>
                    {LINE_LENGTHS.map(n => (
                      <option key={n} value={n}>{n === 0 ? `As on screen (${source.screenBasesPerRow || 60})` : n}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="pdf-note">Zoomed out, so the lines print as the overview on screen. Zoom in until the bases show to print them.</p>
              )}
              {letters && letterPt > 0 && (
                <p className={`pdf-note${letterPt < SMALL_LETTER_PT ? ' pdf-warn' : ''}`}>
                  Bases print at {letterPt.toFixed(1)} pt.
                  {letterPt < SMALL_LETTER_PT && ' That is small: fewer bases per line, or landscape, prints larger.'}
                </p>
              )}
              <label className="pdf-row">
                <span className="pdf-row-label">Title</span>
                <input className="input pdf-title" value={title} onChange={e => setTitle(e.target.value)} placeholder={doc.name || 'Untitled'} spellCheck={false} />
              </label>
            </div>

            <div className="pdf-section">
              <div className="pdf-section-label">Include</div>
              <label className="pdf-check">
                <input type="checkbox" checked={prefs.header} onChange={e => setPref('header', e.target.checked)} />
                Title, length and page numbers
              </label>
              <label className={`pdf-check${isCircular ? '' : ' disabled'}`} title={isCircular ? undefined : 'Only circular sequences have a plasmid map'}>
                <input type="checkbox" checked={prefs.map && isCircular} disabled={!isCircular} onChange={e => setPref('map', e.target.checked)} />
                Plasmid map on the first page
              </label>
              <label className="pdf-check">
                <input type="checkbox" checked={prefs.features} onChange={e => setPref('features', e.target.checked)} />
                Feature table
              </label>
              <label className={`pdf-check${hasEnzymes ? '' : ' disabled'}`} title={hasEnzymes ? undefined : 'Show enzymes in the view to list their sites'}>
                <input type="checkbox" checked={prefs.enzymes && hasEnzymes} disabled={!hasEnzymes} onChange={e => setPref('enzymes', e.target.checked)} />
                Restriction site table
              </label>
              <label className={`pdf-check${hasHighlights ? '' : ' disabled'}`} title={hasHighlights ? undefined : 'Nothing is selected or found'}>
                <input type="checkbox" checked={highlights && hasHighlights} disabled={!hasHighlights} onChange={e => setHighlights(e.target.checked)} />
                Selection and search highlights
              </label>
              <p className="pdf-note">Colours, features, enzymes and translations follow the view, printed in the light theme's colours.</p>
            </div>

            <div className="pdf-cite">
              <p>Using this in a publication? Please cite SeqNexus:</p>
              <p className="pdf-cite-text">{CITATION_TEXT}</p>
              <button type="button" className="btn btn-sm" onClick={() => { void copyText(CITATION_TEXT, 'Citation copied') }}>
                <Copy size={12} /> Copy citation
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {busy && <span className="pdf-progress">Writing page {Math.min(progress.done + 1, progress.total)} of {progress.total}…</span>}
          <button className="btn" onClick={busy ? () => abortRef.current?.abort() : close}>{busy ? 'Stop' : 'Cancel'}</button>
          <button className="btn btn-primary" onClick={save} disabled={!plan || tooMany || busy}>
            Save PDF{plan && !tooMany ? ` (${pageCount} page${pageCount === 1 ? '' : 's'})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
