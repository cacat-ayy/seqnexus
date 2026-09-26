/**
 * ORF finder modal.
 *
 * Settings for ORF detection (sensitivity, start codons, interior filter).
 * Results list grouped by strand/frame with clickable position badges.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { X, ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../store'
import { findORFs, orfColor } from '../workers/orf-finder'
import type { ORFResult, ORFOptions } from '../workers/orf-finder'
import { orfKey, convertibleOrfs } from '../utils/orf-features'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

const FRAME_LABELS: Record<string, string> = {
  '1_0': '+1',
  '1_1': '+2',
  '1_2': '+3',
  '-1_0': '−1',
  '-1_1': '−2',
  '-1_2': '−3',
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function ORFPanel({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const annotations = useEditorStore(s => s.doc.annotations)
  const setOrfResults = useEditorStore(s => s.setOrfResults)
  const setSelection = useEditorStore(s => s.setSelection)
  const setOrfParams = useEditorStore(s => s.setOrfParams)
  const orfPicks = useEditorStore(s => s.orfPicks)
  const toggleOrfPick = useEditorStore(s => s.toggleOrfPick)
  const applyOrfs = useEditorStore(s => s.applyOrfs)

  const minCodonsInput = useEditorStore(s => s.orfMinCodons)
  const startCodons = useEditorStore(s => s.orfStartCodons)
  const allowInterior = useEditorStore(s => s.orfAllowInterior)
  const setMinCodonsInput = useCallback((v: number) => setOrfParams({ orfMinCodons: v }), [setOrfParams])
  const setStartCodons = useCallback((fn: (prev: string[]) => string[]) => {
    const prev = useEditorStore.getState().orfStartCodons
    setOrfParams({ orfStartCodons: fn(prev) })
  }, [setOrfParams])
  const setAllowInterior = useCallback((v: boolean) => setOrfParams({ orfAllowInterior: v }), [setOrfParams])

  const sequence = doc.sequence
  const seqLen = sequence.length

  const [scanning, setScanning] = useState(false)
  const [allOrfs, setAllOrfs] = useState<ORFResult[]>([])
  const [collapsedFrames, setCollapsedFrames] = useState<Set<string>>(new Set())
  const scanGeneration = useRef(0)

  const minCodons = minCodonsInput

  const topology = sequence.topology
  const options: ORFOptions = useMemo(() => ({
    minCodons,
    maxCodons: 0,
    startCodons,
    allowInterior,
    topology,
  }), [minCodons, startCodons, allowInterior, topology])

  // Scan for ORFs asynchronously in a Web Worker
  useEffect(() => {
    if (seqLen === 0) {
      setAllOrfs([])
      return
    }
    const gen = ++scanGeneration.current
    setScanning(true)
    const bases = sequence.bases
    findORFs(bases, options).then(orfs => {
      if (gen !== scanGeneration.current) return
      setAllOrfs(orfs)
      setScanning(false)
    }).catch(() => {
      if (gen === scanGeneration.current) setScanning(false)
    })
  }, [sequence, options]) // eslint-disable-line react-hooks/exhaustive-deps

  // Always push results to store
  useEffect(() => {
    setOrfResults(allOrfs)
  }, [allOrfs, setOrfResults])

  const handleStartCodonToggle = useCallback((codon: string, checked: boolean) => {
    setStartCodons(prev => {
      if (checked) return [...prev, codon]
      const next = prev.filter(c => c !== codon)
      return next.length > 0 ? next : prev // keep at least one
    })
  }, [])

  /**
   * A badge selects its ORF's bases; Ctrl/Cmd-click picks it for conversion
   * instead — the same modifier that picks an ORF on the canvas, so whichever
   * one a user reaches for first teaches the other.
   */
  const handleOrfClick = useCallback((orf: ORFResult, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      toggleOrfPick(orfKey(orf))
      return
    }
    setSelection({ anchor: orf.start, caret: orf.end })
  }, [setSelection, toggleOrfPick])

  /** ORFs a conversion would add, and how many of those are picked. */
  const convertible = useMemo(
    () => convertibleOrfs(allOrfs, annotations),
    [allOrfs, annotations],
  )
  const pickedCount = useMemo(
    () => convertible.reduce((n, o) => n + (orfPicks.has(orfKey(o)) ? 1 : 0), 0),
    [convertible, orfPicks],
  )

  /**
   * Convert, but stay open.
   *
   * Closing here would fight the panel's own close behaviour, which turns the
   * ORF overlay back on. Leaving the panel up also shows the result: the
   * converted ORFs drop out of the count, since they are features now.
   */
  const handleConvert = useCallback(() => {
    applyOrfs(pickedCount > 0 ? orfPicks : undefined)
  }, [applyOrfs, pickedCount, orfPicks])

  // Group ORFs by strand+frame for the results list
  const orfsByFrame = useMemo(() => {
    const map = new Map<string, ORFResult[]>()
    for (const orf of allOrfs) {
      const key = `${orf.strand}_${orf.frame}`
      const list = map.get(key) || []
      list.push(orf)
      map.set(key, list)
    }
    return map
  }, [allOrfs])

  // Backdrop click / Escape
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
      <div className="modal-dialog orf-modal" role="dialog" aria-modal="true" aria-labelledby="orf-panel-title">
        <div className="modal-header">
          <h3 className="modal-title" id="orf-panel-title">ORF Finder</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Settings */}
          <div className="re-settings">
            <div className="re-field">
              <label className="re-field-label">Minimum ORF size (codons):</label>
              <input
                type="number"
                className="re-num re-num-wide"
                min={1}
                value={minCodonsInput}
                onChange={e => setMinCodonsInput(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>

            <div className="re-field">
              <label className="re-field-label">Start codons:</label>
              <div className="orf-codon-checks">
                {['ATG', 'GTG', 'TTG', 'CTG'].map(codon => (
                  <label key={codon} className="re-check orf-codon-check">
                    <input
                      type="checkbox"
                      checked={startCodons.includes(codon)}
                      onChange={e => handleStartCodonToggle(codon, e.target.checked)}
                    />
                    {codon}
                  </label>
                ))}
              </div>
            </div>

            <label className="re-check" title="When enabled, only the longest ORF starting from each stop codon is kept. Interior ORFs that start at a downstream ATG within a larger ORF are removed.">
              <input
                type="checkbox"
                checked={!allowInterior}
                onChange={e => setAllowInterior(!e.target.checked)}
              />
              Filter interior ORFs
            </label>
          </div>

          {/* Status */}
          <div className="re-results-header orf-results-header" style={{ marginTop: 12 }}>
            <span>
              {scanning ? 'Scanning…' : `${allOrfs.length} ORF${allOrfs.length !== 1 ? 's' : ''} found`}
              {orfsByFrame.size > 0 && ` in ${orfsByFrame.size} frame${orfsByFrame.size !== 1 ? 's' : ''}`}
              {pickedCount > 0 && ` · ${pickedCount} picked`}
            </span>
            {convertible.length > 0 && !scanning && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleConvert}
                title="Add these ORFs to the document as CDS features"
              >
                {pickedCount > 0
                  ? `Add picked (${pickedCount})`
                  : `Add all (${convertible.length})`}
              </button>
            )}
          </div>

          {/* Results list */}
          {allOrfs.length > 0 && (
            <div className="re-results">
              <ul className="re-site-list">
                {[...orfsByFrame.entries()].map(([key, orfs]) => {
                  const isCollapsed = collapsedFrames.has(key)
                  return (
                  <li key={key} className="re-enzyme-group">
                    <div
                      className="re-enzyme-name"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCollapsedFrames(prev => {
                        const next = new Set(prev)
                        if (next.has(key)) next.delete(key); else next.add(key)
                        return next
                      })}
                    >
                      <span className="ann-result-chevron">
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <span
                        className="ann-swatch"
                        style={{ backgroundColor: orfColor(orfs[0].strand, orfs[0].frame) }}
                      />
                      Frame {FRAME_LABELS[key] ?? key}
                      <span className="re-enzyme-count" style={{ marginLeft: 6 }}>{orfs.length}×</span>
                    </div>
                    {!isCollapsed && (
                    <div className="re-site-badges">
                      {orfs.map((orf, i) => (
                        <span
                          key={i}
                          className={`re-site-badge ${orfPicks.has(orfKey(orf)) ? 'picked' : ''}`}
                          onClick={e => handleOrfClick(orf, e)}
                          title={`${orf.codons} aa, ${orf.start + 1}..${orf.end}\nCtrl-click to pick for conversion`}
                        >
                          {orf.start + 1}
                        </span>
                      ))}
                    </div>
                    )}
                  </li>
                  )
                })}
              </ul>
            </div>
          )}

          {allOrfs.length === 0 && !scanning && (
            <div className="re-no-results">No ORFs found with current settings</div>
          )}
        </div>
      </div>
    </div>
  )
}
