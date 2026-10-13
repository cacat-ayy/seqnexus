import './MotifPanel.css'
/**
 * Motif finder for a protein: the library's patterns, the membrane spans
 * of the hydropathy rule, grouped by category with the hits as position
 * badges. A badge selects the hit; Ctrl-click picks it for conversion, as
 * on the canvas. Categories can be switched off, which the overlay follows.
 */

import { useState, useMemo, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../store'
import { MOTIF_CATEGORIES, MOTIF_LIBRARY, motifDefinition, type MotifHit } from '../protein/motifs'
import { TM_MOTIF_ID, CF_HELIX_ID, CF_STRAND_ID } from '../hooks/useMotifScan'
import { TM_WINDOW, TM_THRESHOLD } from '../protein/scales'
import { motifKey, convertibleMotifs } from '../utils/motif-features'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { displayPosition } from '../models/Document'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
import Chevron from './Chevron'

interface Props {
  open: boolean
  onClose: () => void
}

export default function MotifPanel({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const hits = useEditorStore(s => s.motifResults)
  const categoriesOff = useEditorStore(s => s.motifCategoriesOff)
  const setCategoriesOff = useEditorStore(s => s.setMotifCategoriesOff)
  const picks = useEditorStore(s => s.motifPicks)
  const togglePick = useEditorStore(s => s.toggleMotifPick)
  const applyMotifs = useEditorStore(s => s.applyMotifs)
  const setSelection = useEditorStore(s => s.setSelection)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const seqLen = doc.sequence.length
  const origin = doc.metadata?.displayOrigin ?? 0
  const numberAt = (i: number) => displayPosition(i, origin, seqLen)

  const off = useMemo(() => new Set(categoriesOff), [categoriesOff])
  const shown = useMemo(() => hits.filter(h => !off.has(h.category)), [hits, off])

  /** Hits by motif, motifs by category, in library order. */
  const groups = useMemo(() => {
    const byMotif = new Map<string, MotifHit[]>()
    for (const h of shown) {
      const list = byMotif.get(h.motifId) ?? []
      list.push(h)
      byMotif.set(h.motifId, list)
    }
    const order = [...MOTIF_LIBRARY.map(m => m.id), TM_MOTIF_ID, CF_HELIX_ID, CF_STRAND_ID]
    const predicted = new Set([TM_MOTIF_ID, CF_HELIX_ID, CF_STRAND_ID])
    return MOTIF_CATEGORIES.map(category => ({
      category,
      motifs: order
        .filter(id => byMotif.has(id) && (predicted.has(id) ? category === 'Structural' : motifDefinition(id)?.category === category))
        .map(id => ({ id, hits: byMotif.get(id)! })),
    })).filter(g => g.motifs.length > 0)
  }, [shown])

  const convertible = useMemo(() => convertibleMotifs(shown, doc.annotations), [shown, doc.annotations])
  const pickedCount = useMemo(
    () => convertible.reduce((n, h) => n + (picks.has(motifKey(h)) ? 1 : 0), 0),
    [convertible, picks],
  )

  const handleHitClick = useCallback((hit: MotifHit, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      togglePick(motifKey(hit))
      return
    }
    setSelection({ anchor: hit.start, caret: hit.end })
  }, [setSelection, togglePick])

  const toggleCategory = useCallback((category: string, on: boolean) => {
    setCategoriesOff(on ? categoriesOff.filter(c => c !== category) : [...categoriesOff, category])
  }, [categoriesOff, setCategoriesOff])

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const { onMouseDown: handleBackdropDown, onClick: handleBackdrop } = useBackdropDismiss(onClose)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const countIn = (category: string) => hits.reduce((n, h) => n + (h.category === category ? 1 : 0), 0)

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropDown} onClick={handleBackdrop} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog orf-modal" role="dialog" aria-modal="true" aria-labelledby="motif-panel-title">
        <div className="modal-header">
          <h3 className="modal-title" id="motif-panel-title">Motifs and Sites</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="re-settings">
            <div className="re-field">
              <label className="re-field-label">Categories:</label>
              <div className="orf-codon-checks">
                {MOTIF_CATEGORIES.map(category => (
                  <label key={category} className="re-check orf-codon-check">
                    <input
                      type="checkbox"
                      checked={!off.has(category)}
                      onChange={e => toggleCategory(category, e.target.checked)}
                    />
                    {category}
                    <span className="mp-count">{countIn(category)}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="ann-library-note">
              PROSITE patterns for the sites a construct is checked for, the sequence liabilities a developability
              review flags, and membrane spans by the Kyte-Doolittle rule (a {TM_WINDOW}-residue window above {TM_THRESHOLD}).
              Every occurrence is shown; a pattern this short also matches by chance, so a hit is a place to look, not a finding.
            </p>
          </div>

          <div className="re-results-header orf-results-header" style={{ marginTop: 12 }}>
            <span>
              {shown.length} hit{shown.length !== 1 ? 's' : ''}
              {groups.length > 0 && ` in ${groups.reduce((n, g) => n + g.motifs.length, 0)} motif${groups.reduce((n, g) => n + g.motifs.length, 0) !== 1 ? 's' : ''}`}
              {pickedCount > 0 && ` · ${pickedCount} picked`}
            </span>
            {convertible.length > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => applyMotifs(pickedCount > 0 ? picks : undefined)}
                title="Add these hits to the document as features"
              >
                {pickedCount > 0 ? `Add picked (${pickedCount})` : `Add all (${convertible.length})`}
              </button>
            )}
          </div>

          {groups.length > 0 && (
            <div className="re-results">
              <ul className="re-site-list">
                {groups.map(group => (
                  <li key={group.category} className="mp-category">
                    <div className="mp-category-name">{group.category}</div>
                    {group.motifs.map(({ id, hits: motifHits }) => {
                      const def = motifDefinition(id)
                      const first = motifHits[0]
                      const isCollapsed = collapsed.has(id)
                      return (
                        <div key={id} className="re-enzyme-group">
                          <div
                            className="re-enzyme-name"
                            style={{ cursor: 'pointer' }}
                            title={def ? `${def.pattern}\n${def.description}\n${def.source}`
                              : id === TM_MOTIF_ID ? `Mean Kyte-Doolittle hydropathy over ${TM_WINDOW} residues above ${TM_THRESHOLD}`
                              : 'Chou and Fasman (1978): nucleated where the propensities cluster, extended while they hold'}
                            onClick={() => setCollapsed(prev => {
                              const next = new Set(prev)
                              if (next.has(id)) next.delete(id); else next.add(id)
                              return next
                            })}
                          >
                            <span className="ann-result-chevron">
                              <Chevron open={!isCollapsed} size={14} />
                            </span>
                            <span className="ann-swatch" style={{ backgroundColor: first.color }} />
                            {first.name}
                            {def && <span className="mp-pattern">{def.pattern}</span>}
                            <span className="re-enzyme-count" style={{ marginLeft: 6 }}>{motifHits.length}×</span>
                          </div>
                          {!isCollapsed && (
                            <div className="re-site-badges">
                              {motifHits.map(hit => (
                                <span
                                  key={motifKey(hit)}
                                  className={`re-site-badge ${picks.has(motifKey(hit)) ? 'picked' : ''}`}
                                  onClick={e => handleHitClick(hit, e)}
                                  title={`${hit.sequence}, ${numberAt(hit.start)}..${numberAt(hit.end - 1)}\nCtrl-click to pick for conversion`}
                                >
                                  {numberAt(hit.start)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {shown.length === 0 && (
            <div className="re-no-results">No motifs found in the categories shown</div>
          )}
        </div>
      </div>
    </div>
  )
}
