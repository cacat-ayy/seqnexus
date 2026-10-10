import './DigestDialog.css'
/**
 * In-silico proteolysis of the open protein: pick proteases and missed
 * cleavages, read the peptide table (positions, masses, m/z, pI,
 * hydrophobicity), see the coverage, click a peptide to select it, draw
 * the peptides over the sequence, or run the digest on an SDS-PAGE gel.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { X, GalleryVertical, Eye, EyeOff, Download } from 'lucide-react'
import { useEditorStore } from '../store'
import { PROTEASES, DEFAULT_PROTEASE_ID, digest, coverage, type Peptide } from '../protein/proteolysis'
import { proteinDigestWorkspace } from '../gel/workspace'
import { displayPosition } from '../models/Document'
import { formatMass } from '../protein/properties'
import { downloadText } from '../utils/download'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

// Peptide colours on the overlay: alternating so neighbours tell apart,
// partials grey. Feature data, as in the libraries.
const PEPTIDE_COLORS = ['#4dabf7', '#20c997']
const PARTIAL_COLOR = '#adb5bd'

type SortKey = 'position' | 'mass' | 'length' | 'pI'

export default function DigestDialog({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const setSelection = useEditorStore(s => s.setSelection)
  const peptideOverlay = useEditorStore(s => s.peptideOverlay)
  const setPeptideOverlay = useEditorStore(s => s.setPeptideOverlay)
  const createGel = useEditorStore(s => s.createGel)

  const [proteaseIds, setProteaseIds] = useState<string[]>([DEFAULT_PROTEASE_ID])
  const [missed, setMissed] = useState(0)
  const [sort, setSort] = useState<SortKey>('position')
  const [showPartials, setShowPartials] = useState(true)

  const residues = doc.sequence.bases
  const seqLen = residues.length
  const origin = doc.metadata?.displayOrigin ?? 0
  const numberAt = (i: number) => displayPosition(i, origin, seqLen)
  const proteases = useMemo(() => PROTEASES.filter(p => proteaseIds.includes(p.id)), [proteaseIds])

  const peptides = useMemo(
    () => (open && doc.sequence.isProtein ? digest(residues, proteases, { missedCleavages: missed }) : []),
    [open, doc.sequence.isProtein, residues, proteases, missed],
  )
  const complete = useMemo(() => peptides.filter(p => p.missed === 0), [peptides])
  const shown = useMemo(() => {
    const list = showPartials ? peptides : complete
    const by: Record<SortKey, (a: Peptide, b: Peptide) => number> = {
      position: (a, b) => a.start - b.start || a.end - b.end,
      mass: (a, b) => b.mono - a.mono,
      length: (a, b) => (b.end - b.start) - (a.end - a.start),
      pI: (a, b) => (a.pI ?? 99) - (b.pI ?? 99),
    }
    return [...list].sort(by[sort])
  }, [peptides, complete, showPartials, sort])
  const cover = useMemo(() => coverage(complete, seqLen), [complete, seqLen])

  const toggleProtease = useCallback((id: string, on: boolean) => {
    setProteaseIds(prev => (on ? [...prev, id] : prev.filter(p => p !== id)))
  }, [])

  const overlayOn = !!peptideOverlay && peptideOverlay.tabId === activeTabId
  const name = proteases.map(p => p.name).join(' + ')
  const buildOverlay = useCallback(() => {
    let k = 0
    return {
      tabId: activeTabId ?? '',
      name,
      peptides: (showPartials ? peptides : complete).map(p => ({
        start: p.start, end: p.end,
        name: `${p.missed === 0 ? '' : 'partial '}${displayPosition(p.start, origin, seqLen)}-${displayPosition(p.end - 1, origin, seqLen)} ${formatMass(p.mono)}`,
        color: p.missed === 0 ? PEPTIDE_COLORS[k++ % 2] : PARTIAL_COLOR,
      })),
    }
  }, [activeTabId, name, peptides, complete, showPartials, origin, seqLen])
  const toggleOverlay = useCallback(() => {
    if (overlayOn) setPeptideOverlay(null)
    else if (activeTabId) setPeptideOverlay(buildOverlay())
  }, [overlayOn, activeTabId, buildOverlay, setPeptideOverlay])

  // While the dialog is open, the overlay follows the settings.
  useEffect(() => {
    if (open && overlayOn) setPeptideOverlay(buildOverlay())
  }, [open, overlayOn, buildOverlay, setPeptideOverlay])

  const runOnGel = useCallback(() => {
    if (!activeTabId) return
    createGel({ name: `${doc.name} ${name} gel`, state: proteinDigestWorkspace(activeTabId, proteaseIds, missed) })
    onClose()
  }, [activeTabId, createGel, doc.name, name, proteaseIds, missed, onClose])

  const exportCsv = useCallback(() => {
    const header = 'Start,End,Sequence,Length,Missed,Monoisotopic (Da),Average (Da),m/z 1+,m/z 2+,m/z 3+,pI,GRAVY'
    const rows = shown.map(p => [
      numberAt(p.start), numberAt(p.end - 1), p.sequence, p.end - p.start, p.missed,
      p.mono.toFixed(4), p.average.toFixed(2), p.mz[0].toFixed(4), p.mz[1].toFixed(4), p.mz[2].toFixed(4),
      p.pI === null ? '' : p.pI.toFixed(2), p.gravy === null ? '' : p.gravy.toFixed(3),
    ].join(','))
    downloadText([header, ...rows].join('\n'), `${doc.name.replace(/[^\w.-]+/g, '_')}-${proteaseIds.join('+')}-peptides.csv`, 'text/csv')
  }, [shown, doc.name, proteaseIds, origin, seqLen]) // eslint-disable-line react-hooks/exhaustive-deps

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdrop} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog digest-modal" role="dialog" aria-modal="true" aria-labelledby="digest-title">
        <div className="modal-header">
          <h3 className="modal-title" id="digest-title">Proteolytic Digest</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="modal-body digest-body">
          <div className="digest-settings">
            <div className="digest-proteases" role="group" aria-label="Proteases">
              {PROTEASES.map(p => (
                <label key={p.id} className="dg-check" title={p.description}>
                  <input type="checkbox" checked={proteaseIds.includes(p.id)} onChange={e => toggleProtease(p.id, e.target.checked)} />
                  <span>{p.name}</span>
                  <span className="dg-rule">{p.description}</span>
                </label>
              ))}
            </div>
            <div className="digest-options">
              <label className="dg-field">
                <span className="dg-field-label">Missed cleavages</span>
                <select className="select dg-select" value={missed} onChange={e => setMissed(Number(e.target.value))}>
                  {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="dg-field">
                <span className="dg-field-label">Sort by</span>
                <select className="select dg-select" value={sort} onChange={e => setSort(e.target.value as SortKey)}>
                  <option value="position">Position</option>
                  <option value="mass">Mass</option>
                  <option value="length">Length</option>
                  <option value="pI">pI</option>
                </select>
              </label>
              {missed > 0 && (
                <label className="dg-check dg-check-plain">
                  <input type="checkbox" checked={showPartials} onChange={e => setShowPartials(e.target.checked)} />
                  <span>Show partials</span>
                </label>
              )}
            </div>
          </div>

          <div className="digest-summary">
            <span>
              <strong>{complete.length}</strong> peptide{complete.length === 1 ? '' : 's'}
              {missed > 0 && ` · ${peptides.length - complete.length} partial${peptides.length - complete.length === 1 ? '' : 's'}`}
              {' · '}coverage <strong>{Math.round(cover * 100)}%</strong>
              {complete.length > 0 && ` · largest ${formatMass(Math.max(...complete.map(p => p.average)))}`}
            </span>
            <span className="digest-actions">
              <button className="btn btn-sm" onClick={toggleOverlay} disabled={peptides.length === 0} title="Draw the peptides as bars over the sequence">
                {overlayOn ? <EyeOff size={13} /> : <Eye size={13} />} {overlayOn ? 'Hide on sequence' : 'Show on sequence'}
              </button>
              <button className="btn btn-sm" onClick={exportCsv} disabled={shown.length === 0} title="The table as CSV">
                <Download size={13} /> CSV
              </button>
              <button className="btn btn-primary btn-sm" onClick={runOnGel} disabled={proteases.length === 0} title="A new SDS-PAGE gel with the protein intact beside this digest">
                <GalleryVertical size={13} /> Run on gel
              </button>
            </span>
          </div>

          {proteases.length === 0 ? (
            <div className="re-no-results">Choose a protease</div>
          ) : (
            <div className="digest-table-wrap">
              <table className="digest-table">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th>Sequence</th>
                    <th className="num">aa</th>
                    <th className="num" title="Monoisotopic mass">[M] mono</th>
                    <th className="num" title="Average mass">[M] avg</th>
                    <th className="num" title="m/z of the singly charged ion">[M+H]+</th>
                    <th className="num">[M+2H]2+</th>
                    <th className="num">[M+3H]3+</th>
                    <th className="num">pI</th>
                    <th className="num" title="Mean Kyte-Doolittle hydropathy">GRAVY</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => (
                    <tr
                      key={`${p.start}-${p.end}`}
                      className={p.missed > 0 ? 'partial' : ''}
                      onClick={() => setSelection({ anchor: p.start, caret: p.end })}
                      title={p.missed > 0 ? `${p.missed} missed cleavage${p.missed === 1 ? '' : 's'}; click to select` : 'Click to select these residues'}
                    >
                      <td className="mono">{numberAt(p.start)}-{numberAt(p.end - 1)}</td>
                      <td className="mono seq" title={p.sequence}>{p.sequence}</td>
                      <td className="num">{p.end - p.start}</td>
                      <td className="num">{p.mono.toFixed(2)}</td>
                      <td className="num">{p.average.toFixed(1)}</td>
                      <td className="num">{p.mz[0].toFixed(3)}</td>
                      <td className="num">{p.mz[1].toFixed(3)}</td>
                      <td className="num">{p.mz[2].toFixed(3)}</td>
                      <td className="num">{p.pI === null ? '-' : p.pI.toFixed(1)}</td>
                      <td className="num">{p.gravy === null ? '-' : p.gravy.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
