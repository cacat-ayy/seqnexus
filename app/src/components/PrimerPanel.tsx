import './PrimerPanel.css'
/**
 * Primer design modal.
 *
 * Allows the user to:
 * - Define a target region (from current selection or manual input)
 * - Set Tm range, product size range, primer length, salt concentration
 * - Run primer pair search in a Web Worker
 * - View ranked results with Tm, GC%, length, penalty
 * - Click a result to highlight the primers on the sequence
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { X, ChevronDown, ChevronRight, Copy, Check, Bookmark, AlertTriangle } from 'lucide-react'
import { useEditorStore, selectionRange } from '../store'
import { findPrimerPairsAsync } from '../workers/primer-finder'
import type { PrimerConstraints } from '../primers/scoring'
import { DEFAULT_CONSTRAINTS } from '../primers/scoring'
import { DEFAULT_PROBE_CONSTRAINTS } from '../primers/finder'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

const LS_PRIMER_SETTINGS = 'seqnexus:primer-settings'

interface PrimerSettings {
  minTm: number; maxTm: number; optTm: number
  minLen: number; maxLen: number
  minProduct: number; maxProduct: number
  naConc: number; primerConc: number; mgConc: number; dntpConc: number
  probeMinTm: number; probeMaxTm: number; probeOptTm: number
}

function loadPrimerSettings(): PrimerSettings | null {
  try {
    const raw = localStorage.getItem(LS_PRIMER_SETTINGS)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

function savePrimerSettings(s: PrimerSettings) {
  try { localStorage.setItem(LS_PRIMER_SETTINGS, JSON.stringify(s)) } catch { /* quota */ }
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function PrimerPanel({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const setSelection = useEditorStore(s => s.setSelection)
  const setPrimerResults = useEditorStore(s => s.setPrimerResults)
  const primerResults = useEditorStore(s => s.primerResults)
  const selectedPrimerIndices = useEditorStore(s => s.selectedPrimerIndices)
  const toggleSelectedPrimer = useEditorStore(s => s.toggleSelectedPrimer)
  const clearPrimers = useEditorStore(s => s.clearPrimers)
  const addAnnotation = useEditorStore(s => s.addAnnotation)

  const seqLen = doc.sequence.length

  // Primer type selection
  const [wantFwd, setWantFwd] = useState(true)
  const [wantRev, setWantRev] = useState(true)
  const [wantProbe, setWantProbe] = useState(false)

  // Target region
  const selRange = selectionRange(selection)
  const [targetStart, setTargetStart] = useState(1)
  const [targetEnd, setTargetEnd] = useState(Math.min(500, seqLen))
  const [useSelection, setUseSelection] = useState(false)

  // Constraints (restore saved settings)
  const savedPrimer = useRef(loadPrimerSettings())
  const [minTm, setMinTm] = useState(savedPrimer.current?.minTm ?? DEFAULT_CONSTRAINTS.minTm)
  const [maxTm, setMaxTm] = useState(savedPrimer.current?.maxTm ?? DEFAULT_CONSTRAINTS.maxTm)
  const [optTm, setOptTm] = useState(savedPrimer.current?.optTm ?? DEFAULT_CONSTRAINTS.optTm)
  const [minLen, setMinLen] = useState(savedPrimer.current?.minLen ?? DEFAULT_CONSTRAINTS.minLength)
  const [maxLen, setMaxLen] = useState(savedPrimer.current?.maxLen ?? DEFAULT_CONSTRAINTS.maxLength)
  const [minProduct, setMinProduct] = useState(savedPrimer.current?.minProduct ?? 150)
  const [maxProduct, setMaxProduct] = useState(savedPrimer.current?.maxProduct ?? 1000)
  const [naConc, setNaConc] = useState(savedPrimer.current?.naConc ?? DEFAULT_CONSTRAINTS.naConc)
  const [primerConc, setPrimerConc] = useState(savedPrimer.current?.primerConc ?? DEFAULT_CONSTRAINTS.primerConc)
  const [mgConc, setMgConc] = useState(savedPrimer.current?.mgConc ?? DEFAULT_CONSTRAINTS.mgConc)
  const [dntpConc, setDntpConc] = useState(savedPrimer.current?.dntpConc ?? DEFAULT_CONSTRAINTS.dntpConc)

  // Probe Tm settings
  const [probeMinTm, setProbeMinTm] = useState(savedPrimer.current?.probeMinTm ?? DEFAULT_PROBE_CONSTRAINTS.minTm)
  const [probeMaxTm, setProbeMaxTm] = useState(savedPrimer.current?.probeMaxTm ?? DEFAULT_PROBE_CONSTRAINTS.maxTm)
  const [probeOptTm, setProbeOptTm] = useState(savedPrimer.current?.probeOptTm ?? DEFAULT_PROBE_CONSTRAINTS.optTm)

  // Collapsible Tm Calculation section
  const [tmSectionOpen, setTmSectionOpen] = useState(false)

  const [searching, setSearching] = useState(false)
  const searchGen = useRef(0)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Copy feedback: tracks which sequence was just copied
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>()

  // Track which primer result indices have been saved as annotations
  const [savedIndices, setSavedIndices] = useState<Set<number>>(new Set())

  // Reset target range when the sequence changes (different doc or first load)
  const prevSeqLen = useRef(seqLen)
  useEffect(() => {
    if (seqLen > 0 && seqLen !== prevSeqLen.current) {
      prevSeqLen.current = seqLen
      if (!useSelection) {
        setTargetStart(1)
        setTargetEnd(Math.min(500, seqLen))
      }
    }
  }, [seqLen, useSelection])

  // Sync target from selection
  useEffect(() => {
    if (useSelection && selRange) {
      setTargetStart(selRange[0] + 1) // display as 1-based
      setTargetEnd(selRange[1])
    }
  }, [useSelection, selRange?.[0], selRange?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(() => {
    if (seqLen === 0) return

    // Save settings for next time
    savePrimerSettings({ minTm, maxTm, optTm, minLen, maxLen, minProduct, maxProduct, naConc, primerConc, mgConc, dntpConc, probeMinTm, probeMaxTm, probeOptTm })

    let tStart = (useSelection && selRange) ? selRange[0] : targetStart - 1
    let tEnd = (useSelection && selRange) ? selRange[1] : targetEnd

    // If target range is unset (0,0) or invalid, default to a sensible range
    if (tStart === 0 && tEnd === 0 && seqLen > 0) {
      tStart = 0
      tEnd = Math.min(500, seqLen)
      setTargetStart(1)
      setTargetEnd(tEnd)
    }

    const isCircular = doc.sequence.topology === 'circular'
    if (tStart < 0 || tEnd > seqLen) return
    // For linear sequences, start must be before end.
    // For circular, start > end means origin-spanning target (valid).
    if (!isCircular && tStart >= tEnd) return
    if (tStart === tEnd) return

    const constraints: PrimerConstraints = {
      minLength: minLen,
      maxLength: maxLen,
      optLength: Math.round((minLen + maxLen) / 2),
      minTm,
      maxTm,
      optTm,
      minGC: DEFAULT_CONSTRAINTS.minGC,
      maxGC: DEFAULT_CONSTRAINTS.maxGC,
      maxHomopolymer: DEFAULT_CONSTRAINTS.maxHomopolymer,
      primerConc,
      naConc,
      mgConc,
      dntpConc,
    }

    // Auto-adjust product size range if the target region makes it impossible
    const targetSpan = isCircular && tStart >= tEnd
      ? (seqLen - tStart) + tEnd
      : tEnd - tStart
    let effMinProduct = minProduct
    let effMaxProduct = maxProduct
    if (targetSpan > effMaxProduct) {
      effMaxProduct = targetSpan + 200
      effMinProduct = Math.max(effMinProduct, targetSpan)
      setMinProduct(effMinProduct)
      setMaxProduct(effMaxProduct)
    } else if (targetSpan > effMinProduct) {
      effMinProduct = targetSpan
      setMinProduct(effMinProduct)
    }

    const gen = ++searchGen.current
    setSearching(true)

    findPrimerPairsAsync({
      template: doc.sequence.bases,
      targetStart: tStart,
      targetEnd: tEnd,
      minProductSize: effMinProduct,
      maxProductSize: effMaxProduct,
      constraints,
      maxResults: 20,
      topology: doc.sequence.topology,
      wantForward: wantFwd,
      wantReverse: wantRev,
      findProbe: wantProbe,
      probeConstraints: wantProbe ? {
        ...DEFAULT_PROBE_CONSTRAINTS,
        minTm: probeMinTm,
        maxTm: probeMaxTm,
        optTm: probeOptTm,
        naConc,
        primerConc,
        mgConc,
        dntpConc,
      } : undefined,
    }).then(pairs => {
      if (gen !== searchGen.current) return
      setPrimerResults(pairs)
      setSavedIndices(new Set())
      setSearching(false)
    }).catch(() => {
      if (gen === searchGen.current) setSearching(false)
    })
  }, [seqLen, useSelection, selRange, targetStart, targetEnd, minLen, maxLen, minTm, maxTm, optTm, primerConc, naConc, mgConc, dntpConc, minProduct, maxProduct, doc.sequence, setPrimerResults, wantFwd, wantRev, wantProbe, probeMinTm, probeMaxTm, probeOptTm])

  const handlePairClick = useCallback((idx: number) => {
    toggleSelectedPrimer(idx)
    const pair = primerResults[idx]
    if (pair) {
      setSelection({ anchor: pair.forward.start, caret: pair.reverse.end })
    }
  }, [primerResults, toggleSelectedPrimer, setSelection])

  const handleCopy = useCallback((seq: string, key: string) => {
    navigator.clipboard.writeText(seq).catch(e => console.warn('Clipboard write failed:', e))
    setCopiedKey(key)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopiedKey(null), 1500)
  }, [])

  const handleSaveAsAnnotations = useCallback(() => {
    if (selectedPrimerIndices.size === 0) return
    for (const idx of selectedPrimerIndices) {
      const pair = primerResults[idx]
      if (!pair) continue
      const ts = `${Date.now().toString(36)}_${idx}`
      if (wantFwd) {
        addAnnotation({
          id: `primer_fwd_${ts}`,
          name: `FWD primer (${pair.forward.tm.toFixed(1)}°C)`,
          type: 'primer_bind',
          start: pair.forward.start,
          end: pair.forward.end,
          strand: 1,
          color: '#3b82f6',
          qualifiers: {
            note: [`Tm=${pair.forward.tm.toFixed(1)}°C, GC=${pair.forward.gc.toFixed(0)}%, ${pair.forward.length}bp`],
            sequence: [pair.forward.sequence],
          },
        })
      }
      if (wantRev) {
        addAnnotation({
          id: `primer_rev_${ts}`,
          name: `REV primer (${pair.reverse.tm.toFixed(1)}°C)`,
          type: 'primer_bind',
          start: pair.reverse.start,
          end: pair.reverse.end,
          strand: -1,
          color: '#ef4444',
          qualifiers: {
            note: [`Tm=${pair.reverse.tm.toFixed(1)}°C, GC=${pair.reverse.gc.toFixed(0)}%, ${pair.reverse.length}bp`],
            sequence: [pair.reverse.sequence],
          },
        })
      }
      if (wantProbe && pair.probe) {
        addAnnotation({
          id: `primer_probe_${ts}`,
          name: `Probe (${pair.probe.tm.toFixed(1)}°C)`,
          type: 'primer_bind',
          start: pair.probe.start,
          end: pair.probe.end,
          strand: pair.probe.strand,
          color: '#f59e0b',
          qualifiers: {
            note: [`Tm=${pair.probe.tm.toFixed(1)}°C, GC=${pair.probe.gc.toFixed(0)}%, ${pair.probe.length}bp`],
            sequence: [pair.probe.sequence],
          },
        })
      }
      setSavedIndices(prev => new Set(prev).add(idx))
    }
  }, [selectedPrimerIndices, primerResults, wantFwd, wantRev, wantProbe, addAnnotation])

  const handleReset = useCallback(() => {
    clearPrimers()
    setSavedIndices(new Set())
    setWantFwd(true)
    setWantRev(true)
    setWantProbe(false)
    setUseSelection(false)
    setTargetStart(1)
    setTargetEnd(Math.min(500, seqLen))
    setMinTm(DEFAULT_CONSTRAINTS.minTm)
    setMaxTm(DEFAULT_CONSTRAINTS.maxTm)
    setOptTm(DEFAULT_CONSTRAINTS.optTm)
    setMinLen(DEFAULT_CONSTRAINTS.minLength)
    setMaxLen(DEFAULT_CONSTRAINTS.maxLength)
    setMinProduct(150)
    setMaxProduct(1000)
    setNaConc(DEFAULT_CONSTRAINTS.naConc)
    setPrimerConc(DEFAULT_CONSTRAINTS.primerConc)
    setMgConc(DEFAULT_CONSTRAINTS.mgConc)
    setDntpConc(DEFAULT_CONSTRAINTS.dntpConc)
    setProbeMinTm(DEFAULT_PROBE_CONSTRAINTS.minTm)
    setProbeMaxTm(DEFAULT_PROBE_CONSTRAINTS.maxTm)
    setProbeOptTm(DEFAULT_PROBE_CONSTRAINTS.optTm)
    setTmSectionOpen(false)
  }, [clearPrimers, seqLen])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdrop} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog primer-modal" role="dialog" aria-modal="true" aria-labelledby="primer-panel-title">
        <div className="modal-header">
          <h3 className="modal-title" id="primer-panel-title">Primer Design</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body primer-modal-body">
          <div className="primer-modal-cols">
            {/* Left column: settings */}
            <div className="primer-modal-settings">
              {/* Primer types */}
              <div className="nsm-label">
                Primers
                <div className="primer-type-row">
                  <label className="primer-check">
                    <input type="checkbox" checked={wantFwd} onChange={e => setWantFwd(e.target.checked)} />
                    <span>Forward</span>
                  </label>
                  <label className="primer-check">
                    <input type="checkbox" checked={wantRev} onChange={e => setWantRev(e.target.checked)} />
                    <span>Reverse</span>
                  </label>
                  <label className="primer-check" title="Find an internal probe (TaqMan/qPCR) between the primers">
                    <input type="checkbox" checked={wantProbe} onChange={e => setWantProbe(e.target.checked)} />
                    <span>Probe</span>
                  </label>
                </div>
              </div>

              {/* Target region */}
              <div className="nsm-label">
                Target Region
                <label className="primer-check">
                  <input
                    type="checkbox"
                    checked={useSelection}
                    onChange={e => setUseSelection(e.target.checked)}
                  />
                  <span>Use current selection</span>
                </label>
                {!useSelection && (
                  <div className="primer-range-row">
                    <input
                      type="number"
                      className="input nsm-input primer-num"
                      min={1}
                      max={seqLen}
                      value={targetStart}
                      onChange={e => setTargetStart(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                    <span className="primer-range-sep">to</span>
                    <input
                      type="number"
                      className="input nsm-input primer-num"
                      min={1}
                      max={seqLen}
                      value={targetEnd}
                      onChange={e => setTargetEnd(Math.min(seqLen, parseInt(e.target.value) || 1))}
                    />
                  </div>
                )}
                {useSelection && !selRange && (
                  <div className="primer-hint">Select a region on the sequence first</div>
                )}
                {useSelection && selRange && (
                  <div className="primer-hint">
                    {selRange[0] + 1}..{selRange[1]} ({selRange[1] - selRange[0]} bp)
                  </div>
                )}
              </div>

              {/* Tm range */}
              <div className="nsm-label">
                Tm Range (°C)
                <div className="primer-range-row">
                  <input type="number" className="input nsm-input primer-num" min={30} max={90} value={minTm}
                    onChange={e => setMinTm(parseFloat(e.target.value) || 50)} />
                  <span className="primer-range-sep">–</span>
                  <input type="number" className="input nsm-input primer-num" min={30} max={90} value={maxTm}
                    onChange={e => setMaxTm(parseFloat(e.target.value) || 70)} />
                  <span className="primer-range-sep">opt</span>
                  <input type="number" className="input nsm-input primer-num" min={30} max={90} value={optTm}
                    onChange={e => setOptTm(parseFloat(e.target.value) || 60)} />
                </div>
              </div>

              {/* Primer length */}
              <div className="nsm-label">
                Primer Length (bp)
                <div className="primer-range-row">
                  <input type="number" className="input nsm-input primer-num" min={10} max={40} value={minLen}
                    onChange={e => setMinLen(Math.max(10, parseInt(e.target.value) || 18))} />
                  <span className="primer-range-sep">to</span>
                  <input type="number" className="input nsm-input primer-num" min={10} max={40} value={maxLen}
                    onChange={e => setMaxLen(Math.min(40, parseInt(e.target.value) || 25))} />
                </div>
              </div>

              {/* Probe Tm range - shown when probe is enabled */}
              {wantProbe && (
                <div className="nsm-label">
                  Probe Tm Range (°C)
                  <div className="primer-range-row">
                    <input type="number" className="input nsm-input primer-num" min={30} max={95} value={probeMinTm}
                      onChange={e => setProbeMinTm(parseFloat(e.target.value) || 68)} />
                    <span className="primer-range-sep">–</span>
                    <input type="number" className="input nsm-input primer-num" min={30} max={95} value={probeMaxTm}
                      onChange={e => setProbeMaxTm(parseFloat(e.target.value) || 72)} />
                    <span className="primer-range-sep">opt</span>
                    <input type="number" className="input nsm-input primer-num" min={30} max={95} value={probeOptTm}
                      onChange={e => setProbeOptTm(parseFloat(e.target.value) || 70)} />
                  </div>
                </div>
              )}

              {/* Product size */}
              <div className="nsm-label">
                Product Size (bp)
                <div className="primer-range-row">
                  <input type="number" className="input nsm-input primer-num" min={50} value={minProduct}
                    onChange={e => setMinProduct(Math.max(50, parseInt(e.target.value) || 150))} />
                  <span className="primer-range-sep">to</span>
                  <input type="number" className="input nsm-input primer-num" min={50} value={maxProduct}
                    onChange={e => setMaxProduct(parseInt(e.target.value) || 1000)} />
                </div>
              </div>

              {/* Tm Calculation - collapsible */}
              <button
                className="primer-collapse-toggle"
                onClick={() => setTmSectionOpen(v => !v)}
                type="button"
              >
                {tmSectionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Tm Calculation
              </button>
              {tmSectionOpen && (
                <div className="primer-collapse-body">
                  <div className="primer-collapse-subtitle">Formula</div>
                  <div className="primer-range-row">
                    <span className="primer-field-label">Tm method:</span>
                    <span className="primer-field-value">SantaLucia 1998</span>
                  </div>
                  <div className="primer-range-row">
                    <span className="primer-field-label">Salt correction:</span>
                    <span className="primer-field-value">Owczarzy 2004</span>
                  </div>

                  <div className="primer-collapse-subtitle">Concentration Settings</div>
                  <div className="primer-conc-grid">
                    <span className="primer-conc-label">Monovalent:</span>
                    <input type="number" className="input nsm-input primer-num" min={1} max={1000} value={naConc}
                      onChange={e => setNaConc(Math.max(1, parseFloat(e.target.value) || 50))} />
                    <span className="primer-conc-unit">mM</span>

                    <span className="primer-conc-label">Oligo:</span>
                    <input type="number" className="input nsm-input primer-num" min={1} max={10000} value={primerConc}
                      onChange={e => setPrimerConc(Math.max(1, parseFloat(e.target.value) || 250))} />
                    <span className="primer-conc-unit">nM</span>

                    <span className="primer-conc-label">Divalent:</span>
                    <input type="number" className="input nsm-input primer-num" min={0} max={100} step={0.1} value={mgConc}
                      onChange={e => setMgConc(Math.max(0, parseFloat(e.target.value) || 0))} />
                    <span className="primer-conc-unit">mM</span>

                    <span className="primer-conc-label">dNTPs:</span>
                    <input type="number" className="input nsm-input primer-num" min={0} max={10} step={0.1} value={dntpConc}
                      onChange={e => setDntpConc(Math.max(0, parseFloat(e.target.value) || 0))} />
                    <span className="primer-conc-unit">mM</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right column: results */}
            <div className="primer-modal-results">
              {primerResults.length > 0 ? (
                <>
                  <div className="primer-results-header">
                    {primerResults.length} pair{primerResults.length !== 1 ? 's' : ''} found
                  </div>
                  <div className="primer-results-list">
                    {primerResults.map((pair, idx) => (
                      <div
                        key={idx}
                        className={`primer-result-card ${selectedPrimerIndices.has(idx) ? 'selected' : ''}`}
                        onClick={() => handlePairClick(idx)}
                      >
                        <div className="primer-result-header">
                          <span className="primer-result-rank">#{idx + 1}</span>
                          <span className="primer-result-product">{pair.productSize} bp</span>
                          <span className="primer-result-penalty">penalty: {pair.penalty.toFixed(1)}</span>
                        </div>
                        {wantFwd && (
                          <PrimerOligoRow label="FWD" labelClass="fwd" candidate={pair.forward}
                            copyKey={`fwd-${idx}`} copiedKey={copiedKey} onCopy={handleCopy} />
                        )}
                        {wantRev && (
                          <PrimerOligoRow label="REV" labelClass="rev" candidate={pair.reverse}
                            copyKey={`rev-${idx}`} copiedKey={copiedKey} onCopy={handleCopy} />
                        )}
                        {wantFwd && wantRev && Math.abs(pair.forward.tm - pair.reverse.tm) > 3 && (
                          <div className="primer-tm-warn">
                            <AlertTriangle size={12} />
                            <span>ΔTm {Math.abs(pair.forward.tm - pair.reverse.tm).toFixed(1)}°C — primers may anneal unevenly</span>
                          </div>
                        )}
                        {wantProbe && pair.probe && (
                          <PrimerOligoRow label="PRB" labelClass="probe" candidate={pair.probe}
                            copyKey={`prb-${idx}`} copiedKey={copiedKey} onCopy={handleCopy} />
                        )}
                        {wantProbe && !pair.probe && (
                          <div className="primer-result-stats" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            No suitable probe found
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="primer-empty">
                  {searching
                    ? 'Searching…'
                    : 'Select a target region and click "Find Primers" to design primer pairs.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          {primerResults.length > 0 && (
            <>
              <button className="btn btn-sm" onClick={handleReset}>Clear Results</button>
              <button
                className="btn btn-sm"
                onClick={handleSaveAsAnnotations}
                disabled={selectedPrimerIndices.size === 0 || [...selectedPrimerIndices].every(i => savedIndices.has(i))}
                title={selectedPrimerIndices.size > 0 && [...selectedPrimerIndices].every(i => savedIndices.has(i)) ? 'Already saved' : 'Save selected primers as annotations on the sequence'}
              >
                <Bookmark size={13} /> {selectedPrimerIndices.size > 0 && [...selectedPrimerIndices].every(i => savedIndices.has(i)) ? 'Saved' : 'Save as Annotations'}
              </button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn btn-primary"
            onClick={handleSearch}
            disabled={searching || seqLen === 0 || (useSelection && !selRange) || (!wantFwd && !wantRev)}
          >
            {searching ? 'Searching…' : 'Find Primers'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A single primer/probe row in a result card with copy button. */
function PrimerOligoRow({ label, labelClass, candidate, copyKey, copiedKey, onCopy }: {
  label: string
  labelClass: string
  candidate: { sequence: string; tm: number; gc: number; length: number }
  copyKey: string
  copiedKey: string | null
  onCopy: (seq: string, key: string) => void
}) {
  const isCopied = copiedKey === copyKey
  return (
    <>
      <div className="primer-result-oligo">
        <span className={`primer-result-dir ${labelClass}`}>{label}</span>
        <span className="primer-result-seq mono">{truncateSeq(candidate.sequence, 30)}</span>
        <button
          className={`primer-copy-btn ${isCopied ? 'copied' : ''}`}
          onClick={e => { e.stopPropagation(); onCopy(candidate.sequence, copyKey) }}
          title={isCopied ? 'Copied!' : 'Copy sequence'}
        >
          {isCopied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
      <div className="primer-result-stats">
        Tm {candidate.tm.toFixed(1)}°C | GC {candidate.gc.toFixed(0)}% | {candidate.length} bp
      </div>
    </>
  )
}

function truncateSeq(seq: string, max: number): string {
  if (seq.length <= max) return seq
  return seq.slice(0, max - 1) + '…'
}
