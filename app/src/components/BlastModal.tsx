import './BlastModal.css'
/**
 * NCBI BLAST search modal.
 *
 * Three states: input form → progress/polling → results table.
 * Users can BLAST the full sequence or selection, choose program/database,
 * view results, expand alignments, and add hits as annotations.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { X, Loader2, Copy, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Search } from 'lucide-react'
import { useEditorStore, selectionRange } from '../store'
import { submitBlast, pollBlast, fetchResults } from '../blast/client'
import { parseBlastJson } from '../blast/parser'
import type { BlastProgram, BlastResult, BlastHit } from '../blast/types'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
  onPhaseChange?: (phase: Phase) => void
}

type Phase = 'input' | 'polling' | 'results'
type SortKey = 'score' | 'evalue' | 'identity' | 'coverage' | 'length'
type SortDir = 'asc' | 'desc'

const POLL_INTERVAL = 15_000
const TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

const LS_BLAST_SETTINGS = 'seqnexus:blast-settings'
const LS_BLAST_HISTORY = 'seqnexus:blast-history'
const MAX_BLAST_HISTORY = 10

function formatEvalue(e: number): string {
  if (e === 0) return '0'
  if (e < 0.001) return e.toExponential(1)
  if (e < 1) return e.toFixed(3)
  return e.toFixed(1)
}

/** Format a relative time string (e.g., "2h ago", "yesterday"). */
function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

interface BlastHistoryEntry {
  result: BlastResult
  rid: string
  timestamp: number
}

/** Load saved BLAST settings from localStorage. */
function loadSettings(): { program: BlastProgram; database: string; evalue: string; maxHits: string } | null {
  try {
    const raw = localStorage.getItem(LS_BLAST_SETTINGS)
    if (!raw) return null
    return JSON.parse(raw)
  } catch { return null }
}

/** Save BLAST settings to localStorage. */
function saveSettings(s: { program: BlastProgram; database: string; evalue: string; maxHits: string }) {
  try { localStorage.setItem(LS_BLAST_SETTINGS, JSON.stringify(s)) } catch { /* quota */ }
}

/** Load BLAST history from localStorage. */
function loadBlastHistory(): BlastHistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_BLAST_HISTORY)
    if (!raw) {
      // Migrate from old single-result format
      const old = localStorage.getItem('seqnexus:blast-result')
      if (old) {
        const parsed = JSON.parse(old)
        localStorage.removeItem('seqnexus:blast-result')
        const entry: BlastHistoryEntry = { result: parsed.result, rid: parsed.rid, timestamp: Date.now() }
        localStorage.setItem(LS_BLAST_HISTORY, JSON.stringify([entry]))
        return [entry]
      }
      return []
    }
    return JSON.parse(raw)
  } catch { return [] }
}

/** Save a result to BLAST history (prepend, cap at MAX_BLAST_HISTORY). */
function pushBlastHistory(result: BlastResult, rid: string) {
  try {
    const history = loadBlastHistory()
    const entry: BlastHistoryEntry = { result, rid, timestamp: Date.now() }
    // Remove duplicate RIDs
    const filtered = history.filter(e => e.rid !== rid)
    const updated = [entry, ...filtered].slice(0, MAX_BLAST_HISTORY)
    localStorage.setItem(LS_BLAST_HISTORY, JSON.stringify(updated))
  } catch { /* quota */ }
}

/** Remove a history entry by index. */
function removeBlastHistory(index: number) {
  try {
    const history = loadBlastHistory()
    history.splice(index, 1)
    localStorage.setItem(LS_BLAST_HISTORY, JSON.stringify(history))
  } catch { /* ok */ }
}



/** Build NCBI accession URL. */
function ncbiAccessionUrl(accession: string, program: string): string {
  // blastx/tblastx search protein DBs
  const isProtein = program === 'blastx' || program === 'tblastx'
  if (isProtein) return `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(accession)}`
  return `https://www.ncbi.nlm.nih.gov/nuccore/${encodeURIComponent(accession)}`
}

export default function BlastModal({ open, onClose, onPhaseChange }: Props) {
  // --- Store ---
  const doc = useEditorStore(s => s.doc)
  const selection = useEditorStore(s => s.selection)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const selRange = selectionRange(selection)

  // Notify parent of phase changes
  const setPhaseAndNotify = useCallback((p: Phase) => {
    setPhase(p)
    onPhaseChange?.(p)
  }, [onPhaseChange])

  // --- Input state (restore saved settings) ---
  const saved = useRef(loadSettings())
  const [querySource, setQuerySource] = useState<'full' | 'selection'>('full')
  const [program, setProgram] = useState<BlastProgram>(saved.current?.program ?? 'megablast')
  const [database, setDatabase] = useState(saved.current?.database ?? 'core_nt')
  const [evalue, setEvalue] = useState(saved.current?.evalue ?? '10')
  const [maxHits, setMaxHits] = useState(saved.current?.maxHits ?? '25')

  // --- Progress state ---
  const [phase, setPhase] = useState<Phase>('input')
  const [rid, setRid] = useState('')
  const [statusText, setStatusText] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  // --- Results state ---
  const [result, setResult] = useState<BlastResult | null>(null)
  const [expandedHit, setExpandedHit] = useState<number | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('evalue')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState('')

  // --- History state ---
  const [history, setHistory] = useState<BlastHistoryEntry[]>([])
  const [activeHistoryIdx, setActiveHistoryIdx] = useState<number | null>(null)
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null)

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Restore history on mount
  useEffect(() => {
    const h = loadBlastHistory()
    setHistory(h)
    if (!result && h.length > 0) {
      setResult(h[0].result)
      setRid(h[0].rid)
      setActiveHistoryIdx(0)
      setPhaseAndNotify('results')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount only - don't reset on open/close
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const querySequence = useMemo(() => {
    if (!doc) return ''
    if (querySource === 'selection' && selRange) {
      return doc.sequence.basesIn(selRange[0], selRange[1])
    }
    return doc.sequence.bases
  }, [doc, querySource, selRange])

  const queryLen = querySequence.length

  // --- Filtered + sorted hits ---
  const displayHits = useMemo(() => {
    if (!result) return []
    let hits = result.hits.map((h, i) => ({ hit: h, origIdx: i }))

    // Filter
    if (filter.trim()) {
      const q = filter.trim().toLowerCase()
      hits = hits.filter(({ hit }) =>
        hit.accession.toLowerCase().includes(q) ||
        hit.description.toLowerCase().includes(q) ||
        hit.sciName.toLowerCase().includes(q),
      )
    }

    // Sort
    const dir = sortDir === 'asc' ? 1 : -1
    hits.sort((a, b) => {
      const ha = a.hit, hb = b.hit
      switch (sortKey) {
        case 'score': return (ha.topScore - hb.topScore) * dir
        case 'evalue': return (ha.topEvalue - hb.topEvalue) * dir
        case 'identity': return (ha.topIdentity - hb.topIdentity) * dir
        case 'coverage': return (ha.queryCoverage - hb.queryCoverage) * dir
        case 'length': return ((ha.hsps[0]?.alignLen ?? 0) - (hb.hsps[0]?.alignLen ?? 0)) * dir
        default: return 0
      }
    })

    return hits
  }, [result, filter, sortKey, sortDir])

  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return key
      }
      // Default direction: evalue asc, everything else desc
      setSortDir(key === 'evalue' ? 'asc' : 'desc')
      return key
    })
  }, [])

  // --- Submit ---
  const handleSubmit = useCallback(async () => {
    if (queryLen < 10) {
      setError('Query too short – minimum 10 bases.')
      return
    }

    // Save settings for next time
    saveSettings({ program, database, evalue, maxHits })

    setError(null)
    setPhaseAndNotify('polling')
    setStatusText('Submitting search...')
    startTimeRef.current = Date.now()

    // Elapsed timer
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    try {
      const res = await submitBlast({
        query: querySequence,
        program,
        database,
        evalue: parseFloat(evalue) || 10,
        maxHits: parseInt(maxHits, 10) || 25,
      })

      setRid(res.rid)
      setStatusText(`Waiting for results (est. ${res.rtoe}s)...`)

      // Start polling
      pollRef.current = setInterval(async () => {
        // Timeout check
        if (Date.now() - startTimeRef.current > TIMEOUT_MS) {
          if (pollRef.current) clearInterval(pollRef.current)
          if (timerRef.current) clearInterval(timerRef.current)
          setError(`Search timed out after 15 minutes. Your RID is ${res.rid} – check results at NCBI.`)
          setPhaseAndNotify('input')
          return
        }

        try {
          const status = await pollBlast(res.rid)
          if (status === 'READY') {
            if (pollRef.current) clearInterval(pollRef.current)
            setStatusText('Fetching results...')
            const raw = await fetchResults(res.rid)
            const parsed = parseBlastJson(raw)
            parsed.queryName = doc.name
            setResult(parsed)
            pushBlastHistory(parsed, res.rid)
            setHistory(loadBlastHistory())
            setActiveHistoryIdx(0)
            setPhaseAndNotify('results')
            if (timerRef.current) clearInterval(timerRef.current)
          } else if (status === 'FAILED' || status === 'UNKNOWN') {
            if (pollRef.current) clearInterval(pollRef.current)
            if (timerRef.current) clearInterval(timerRef.current)
            setError(`BLAST search failed (status: ${status}). RID: ${res.rid}`)
            setPhaseAndNotify('input')
          }
          // WAITING: keep polling
        } catch (err) {
          // Network error during poll - keep trying
          console.warn('BLAST poll error:', err)
        }
      }, POLL_INTERVAL)
    } catch (err) {
      if (timerRef.current) clearInterval(timerRef.current)
      setError(err instanceof Error ? err.message : 'BLAST submission failed')
      setPhaseAndNotify('input')
    }
  }, [querySequence, queryLen, program, database, evalue, maxHits])

  const handleCancelSearch = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    pollRef.current = null
    timerRef.current = null
    setPhaseAndNotify('input')
    setRid('')
    setStatusText('')
    setElapsed(0)
    setError(null)
  }, [])

  const handleNewSearch = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    pollRef.current = null
    timerRef.current = null
    setPhaseAndNotify('input')
    setRid('')
    setStatusText('')
    setElapsed(0)
    setError(null)
    setResult(null)
    setActiveHistoryIdx(null)
    setExpandedHit(null)
    setChecked(new Set())
    setFilter('')
    setSortKey('evalue')
    setSortDir('asc')
  }, [])

  const handleSelectHistory = useCallback((idx: number) => {
    const entry = history[idx]
    if (!entry) return
    setResult(entry.result)
    setRid(entry.rid)
    setActiveHistoryIdx(idx)
    setExpandedHit(null)
    setChecked(new Set())
    setFilter('')
    setSortKey('evalue')
    setSortDir('asc')
    setPhaseAndNotify('results')
    setError(null)
  }, [history, setPhaseAndNotify])

  const handleDeleteHistory = useCallback((idx: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirmDeleteIdx !== idx) {
      // First click — ask for confirmation
      setConfirmDeleteIdx(idx)
      return
    }
    // Second click — confirmed, delete
    setConfirmDeleteIdx(null)
    removeBlastHistory(idx)
    const updated = loadBlastHistory()
    setHistory(updated)
    if (activeHistoryIdx === idx) {
      if (updated.length > 0) {
        const newIdx = Math.min(idx, updated.length - 1)
        setResult(updated[newIdx].result)
        setRid(updated[newIdx].rid)
        setActiveHistoryIdx(newIdx)
      } else {
        setResult(null)
        setActiveHistoryIdx(null)
        setPhaseAndNotify('input')
      }
    } else if (activeHistoryIdx !== null && idx < activeHistoryIdx) {
      setActiveHistoryIdx(activeHistoryIdx - 1)
    }
  }, [activeHistoryIdx, confirmDeleteIdx, setPhaseAndNotify])

  const handleCopyRid = useCallback(() => {
    if (rid) navigator.clipboard.writeText(rid).catch(e => console.warn('Clipboard write failed:', e))
  }, [rid])

  const ncbiResultsUrl = rid
    ? `https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=Get&RID=${encodeURIComponent(rid)}`
    : null

  // --- Add annotations ---
  const handleAddAnnotations = useCallback(() => {
    if (!result || !doc) return
    const selOffset = querySource === 'selection' && selRange ? selRange[0] : 0

    for (const idx of checked) {
      const hit = result.hits[idx]
      if (!hit) continue
      const hsp = hit.hsps[0]
      if (!hsp) continue

      const start = hsp.queryFrom - 1 + selOffset // convert 1-based to 0-based
      const end = hsp.queryTo + selOffset
      const strand = hsp.queryFrame >= 0 ? 1 : -1

      const label = hit.sciName
        ? `${hit.accession} ${hit.sciName}`
        : `${hit.accession} ${hit.description.slice(0, 40)}`

      addAnnotation({
        id: `blast_${Date.now()}_${idx}`,
        name: label,
        type: 'misc_feature',
        start: Math.max(0, start),
        end: Math.min(end, doc.sequence.length),
        strand: strand as 1 | -1 | 0,
        color: BLAST_COLORS[idx % BLAST_COLORS.length],
        qualifiers: {
          note: [`BLAST hit, E=${formatEvalue(hit.topEvalue)}, ${(hit.topIdentity * 100).toFixed(1)}% identity`],
          db_xref: [`NCBI:${hit.accession}`],
        },
      })
    }

    setChecked(new Set())
  }, [result, checked, doc, querySource, selRange, addAnnotation])

  const toggleCheck = useCallback((idx: number) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (!result) return
    const visibleIdxs = displayHits.map(d => d.origIdx)
    const allChecked = visibleIdxs.every(i => checked.has(i))
    if (allChecked) {
      setChecked(prev => {
        const next = new Set(prev)
        for (const i of visibleIdxs) next.delete(i)
        return next
      })
    } else {
      setChecked(prev => {
        const next = new Set(prev)
        for (const i of visibleIdxs) next.add(i)
        return next
      })
    }
  }, [result, checked, displayHits])

  // --- Keyboard / backdrop ---
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  // Keep component mounted so polling survives close - just hide the modal
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return <></>

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog blast-modal" role="dialog" aria-modal="true" aria-labelledby="blast-modal-title">
        {/* Header */}
        <div className="modal-header">
          <h3 className="modal-title" id="blast-modal-title">
            NCBI BLAST Search
            {phase === 'polling' && <span className="blast-header-badge">Searching...</span>}
            {phase === 'results' && result && <span className="blast-header-badge blast-header-badge-done">{result.hits.length} hits</span>}
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* History chips — visible in all phases */}
        {history.length > 0 && (
          <div className="blast-history-bar" onClick={() => setConfirmDeleteIdx(null)}>
            {history.map((entry, i) => {
              const isConfirming = confirmDeleteIdx === i
              return (
              <button
                key={entry.rid}
                className={`blast-history-chip ${activeHistoryIdx === i ? 'active' : ''} ${isConfirming ? 'confirming' : ''}`}
                onClick={() => { setConfirmDeleteIdx(null); handleSelectHistory(i) }}
                title={`${entry.result.program} · ${entry.result.database} · ${entry.result.queryLen.toLocaleString()} bp · ${entry.result.hits.length} hits`}
              >
                <span className="blast-chip-name">{entry.result.queryName || 'Untitled'}</span>
                <span className="blast-chip-meta">{entry.result.hits.length} hits · {timeAgo(entry.timestamp)}</span>
                <span
                  className={`blast-chip-close ${isConfirming ? 'blast-chip-close-confirm' : ''}`}
                  onClick={(e) => handleDeleteHistory(i, e)}
                  title={isConfirming ? 'Click again to delete' : 'Remove from history'}
                >{isConfirming ? 'Delete?' : '×'}</span>
              </button>
              )
            })}
          </div>
        )}

        <div className="modal-body blast-body">
          {/* --- Input phase --- */}
          {phase === 'input' && (
            <div className="blast-form">
              {/* Query source */}
              <div className="blast-section">
                <div className="blast-section-label">Query</div>
                <div className="blast-radio-group">
                  <label className="blast-radio">
                    <input
                      type="radio"
                      checked={querySource === 'full'}
                      onChange={() => setQuerySource('full')}
                    />
                    Full sequence ({doc ? doc.sequence.length.toLocaleString() : 0} bp)
                  </label>
                  <label className={`blast-radio ${!selRange ? 'blast-radio-disabled' : ''}`}>
                    <input
                      type="radio"
                      checked={querySource === 'selection'}
                      onChange={() => setQuerySource('selection')}
                      disabled={!selRange}
                    />
                    Selection only {selRange ? `(${(selRange[1] - selRange[0]).toLocaleString()} bp)` : '(none)'}
                  </label>
                </div>
              </div>

              {/* Program */}
              <div className="blast-section">
                <div className="blast-section-label">Program</div>
                <select
                  className="select blast-select"
                  value={program}
                  onChange={e => setProgram(e.target.value as BlastProgram)}
                >
                  <option value="megablast">megablast (fast, high similarity)</option>
                  <option value="blastn">blastn (somewhat similar)</option>
                  <option value="blastx">blastx (translated query vs protein DB)</option>
                  <option value="tblastx">tblastx (translated query vs translated DB)</option>
                </select>
              </div>

              {/* Database */}
              <div className="blast-section">
                <div className="blast-section-label">Database</div>
                <select
                  className="select blast-select"
                  value={database}
                  onChange={e => setDatabase(e.target.value)}
                >
                  <optgroup label="Nucleotide">
                    <option value="core_nt">core_nt – Standard nucleotide collection</option>
                    <option value="nt">nt – Full nucleotide collection</option>
                    <option value="refseq_rna">refseq_rna – RefSeq RNA</option>
                    <option value="refseq_representative_genomes">refseq_representative_genomes – RefSeq representative genomes</option>
                    <option value="refseq_select">refseq_select – RefSeq Select</option>
                  </optgroup>
                  <optgroup label="Protein">
                    <option value="nr">nr – Non-redundant protein</option>
                    <option value="swissprot">swissprot – UniProt/Swiss-Prot</option>
                    <option value="refseq_protein">refseq_protein – RefSeq protein</option>
                    <option value="pdb">pdb – Protein Data Bank</option>
                  </optgroup>
                  <optgroup label="Genomic">
                    <option value="wgs">wgs – Whole-genome shotgun</option>
                    <option value="env_nt">env_nt – Environmental nucleotide</option>
                    <option value="patnt">patnt – Patent nucleotide</option>
                  </optgroup>
                  <optgroup label="Organism-specific">
                    <option value="human_genomic">human_genomic – Human genome</option>
                    <option value="mouse_genomic">mouse_genomic – Mouse genome</option>
                  </optgroup>
                </select>
              </div>

              {/* E-value & Max hits */}
              <div className="blast-field-row">
                <div className="blast-section">
                  <div className="blast-section-label">E-value</div>
                  <input
                    className="input blast-input blast-input-sm"
                    type="text"
                    value={evalue}
                    onChange={e => setEvalue(e.target.value)}
                  />
                </div>
                <div className="blast-section">
                  <div className="blast-section-label">Max hits</div>
                  <input
                    className="input blast-input blast-input-sm"
                    type="text"
                    value={maxHits}
                    onChange={e => setMaxHits(e.target.value)}
                  />
                </div>
              </div>

              {/* Error */}
              {error && <div className="blast-error">{error}</div>}

              {/* Query length warning */}
              {queryLen > 100_000 && (
                <div className="blast-warn">
                  Query is {queryLen.toLocaleString()} bp – large queries may take a long time.
                </div>
              )}

            </div>
          )}

          {/* --- Polling phase --- */}
          {phase === 'polling' && (
            <div className="blast-polling">
              <div className="blast-poll-row">
                <Loader2 size={18} className="blast-spin-icon" />
                <div className="blast-poll-info">
                  <div className="blast-poll-status">{statusText}</div>
                  <div className="blast-poll-meta">
                    <span className="blast-poll-elapsed">{elapsed}s elapsed</span>
                    {rid && (
                      <span className="blast-rid">
                        RID: <code>{rid}</code>
                        <button className="blast-rid-copy" onClick={handleCopyRid} title="Copy RID">
                          <Copy size={12} />
                        </button>
                        {ncbiResultsUrl && (
                          <a
                            href={ncbiResultsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="blast-ncbi-link"
                          >
                            View on NCBI ↗
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="blast-poll-hint">You can close this dialog - the search will continue in the background.</div>
            </div>
          )}

          {/* --- Results phase --- */}
          {phase === 'results' && result && (
            <div className="blast-results">
              {/* Summary */}
              <div className="blast-summary">
                <span>
                  {result.hits.length} hit{result.hits.length !== 1 ? 's' : ''} found
                  {' · '}{result.program} · {result.database}
                  {result.queryName && <> · <strong>{result.queryName}</strong></>}
                  {' · '}query {result.queryLen.toLocaleString()} bp
                  {result.message && <span className="blast-msg"> · {result.message}</span>}
                </span>
                {ncbiResultsUrl && (
                  <a
                    href={ncbiResultsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="blast-ncbi-link"
                  >
                    View on NCBI ↗
                  </a>
                )}
              </div>

              {result.hits.length === 0 ? (
                <div className="blast-no-hits">No significant similarity found.</div>
              ) : (
                <>
                  {/* Filter */}
                  <div className="blast-filter">
                    <Search size={13} className="blast-filter-icon" />
                    <input
                      className="input blast-filter-input"
                      type="text"
                      placeholder="Filter by accession, description, or organism..."
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                    />
                    {filter && (
                      <span className="blast-filter-count">
                        {displayHits.length}/{result.hits.length}
                      </span>
                    )}
                  </div>

                  {/* Results table */}
                  <div className="blast-table-wrap">
                    <table className="blast-table">
                      <thead>
                        <tr>
                          <th className="blast-th-check">
                            <input
                              type="checkbox"
                              checked={displayHits.length > 0 && displayHits.every(d => checked.has(d.origIdx))}
                              onChange={toggleAll}
                            />
                          </th>
                          <th></th>
                          <th>Hit</th>
                          <SortTh label="Score" sortKey="score" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                          <SortTh label="E-value" sortKey="evalue" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                          <SortTh label="Identity" sortKey="identity" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                          <SortTh label="Coverage" sortKey="coverage" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                          <SortTh label="Length" sortKey="length" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                          <th>Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayHits.map(({ hit, origIdx }) => (
                          <HitRow
                            key={origIdx}
                            hit={hit}
                            program={result.program}
                            expanded={expandedHit === origIdx}
                            checked={checked.has(origIdx)}
                            onToggleExpand={() => setExpandedHit(expandedHit === origIdx ? null : origIdx)}
                            onToggleCheck={() => toggleCheck(origIdx)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                </>
              )}
            </div>
          )}
        </div>

        {/* Footer - consistent across all phases */}
        <div className="modal-footer">
          {phase === 'input' && (
            <>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={queryLen < 1 || !database.trim()}
              >
                Search
              </button>
            </>
          )}
          {phase === 'polling' && (
            <>
              <button className="btn" onClick={handleCancelSearch}>Cancel search</button>
              <button className="btn btn-primary" onClick={onClose}>Close</button>
            </>
          )}
          {phase === 'results' && (
            <>
              <button className="btn" onClick={handleNewSearch}>New search</button>
              <button className="btn" onClick={onClose}>Close</button>
              {result && result.hits.length > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleAddAnnotations}
                  disabled={checked.size === 0}
                >
                  Add {checked.size} as annotation{checked.size !== 1 ? 's' : ''}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Hit row sub-component ---

function HitRow({
  hit, program, expanded, checked, onToggleExpand, onToggleCheck,
}: {
  hit: BlastHit
  program: string
  expanded: boolean
  checked: boolean
  onToggleExpand: () => void
  onToggleCheck: () => void
}) {
  const hsp = hit.hsps[0]
  if (!hsp) return null

  const descTruncated = hit.description.length > 60

  return (
    <>
      <tr className={`blast-row ${expanded ? 'blast-row-expanded' : ''}`} onClick={onToggleExpand}>
        <td className="blast-td-check" onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onToggleCheck} />
        </td>
        <td className="blast-td-expand">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>
        <td className="blast-td-hit">
          <a
            className="blast-accession"
            href={ncbiAccessionUrl(hit.accession, program)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
          >{hit.accession}</a>
          <span className="blast-desc" title={descTruncated ? hit.description : undefined}>
            {hit.description.slice(0, 60)}{descTruncated ? '...' : ''}
          </span>
          {hit.sciName && <span className="blast-sci">{hit.sciName}</span>}
        </td>
        <td className="blast-td-num">{Math.round(hsp.bitScore)}</td>
        <td className="blast-td-num">{formatEvalue(hsp.evalue)}</td>
        <td className="blast-td-num">{(hit.topIdentity * 100).toFixed(1)}%</td>
        <td className="blast-td-num">{(hit.queryCoverage * 100).toFixed(0)}%</td>
        <td className="blast-td-num">{hsp.alignLen}</td>
        <td className="blast-td-num">{hsp.queryFrom}..{hsp.queryTo}</td>
      </tr>
      {expanded && (
        <tr className="blast-align-row">
          <td colSpan={9}>
            <div className="blast-alignment">
              {hit.hsps.map((h, hi) => (
                <div key={hi} className="blast-hsp">
                  {hit.hsps.length > 1 && (
                    <div className="blast-hsp-header">
                      HSP {hi + 1}: score {Math.round(h.bitScore)}, E={formatEvalue(h.evalue)}, {(h.identity * 100).toFixed(1)}% identity
                    </div>
                  )}
                  <AlignmentBlock hsp={h} isProtein={program === 'blastx' || program === 'tblastx'} />
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// --- Alignment block ---

/** Color for a nucleotide base (matches SequenceView). */
function baseColor(b: string): string {
  switch (b) {
    case 'A': case 'a': return '#2d8a4e'
    case 'T': case 't': case 'U': case 'u': return '#c0392b'
    case 'G': case 'g': return '#2874a6'
    case 'C': case 'c': return '#d4a017'
    default: return ''
  }
}

/** Color for an amino acid (Clustal-ish scheme). */
function aaColor(a: string): string {
  switch (a.toUpperCase()) {
    case 'D': case 'E': return '#e03030'                   // acidic
    case 'R': case 'K': case 'H': return '#1464f0'         // basic
    case 'N': case 'Q': case 'S': case 'T': return '#10a050' // polar
    case 'A': case 'V': case 'L': case 'I': case 'M': return '#808080' // hydrophobic
    case 'F': case 'W': case 'Y': return '#8040a0'         // aromatic
    case 'P': return '#c88000'                              // proline
    case 'G': return '#d07020'                              // glycine
    case 'C': return '#c0a020'                              // cysteine
    default: return ''
  }
}

/** Is this a gap character? */
function isGap(c: string): boolean { return c === '-' || c === '.' }

/** Is this column a mismatch? */
function isMismatch(q: string, h: string, m: string): boolean {
  if (isGap(q) || isGap(h)) return false
  return m === ' '
}

/** Render a colored sequence line. Each base gets its nucleotide/AA color; mismatches get a background highlight. */
function ColoredSeq({ seq, midline, other, isProtein }: { seq: string; midline: string; other: string; isProtein: boolean }) {
  const colorFn = isProtein ? aaColor : baseColor
  // Group consecutive chars with same style
  const parts: { color: string; cls: string; text: string }[] = []
  for (let i = 0; i < seq.length; i++) {
    const ch = seq[i]
    const gap = isGap(ch)
    const mis = !gap && isMismatch(seq[i], other[i], midline[i])
    const color = gap ? '' : colorFn(ch)
    const cls = gap ? 'ba-gap' : mis ? 'ba-mis' : ''
    const last = parts.length > 0 ? parts[parts.length - 1] : null
    if (last && last.color === color && last.cls === cls) {
      last.text += ch
    } else {
      parts.push({ color, cls, text: ch })
    }
  }
  return <>{parts.map((p, i) =>
    <span key={i} className={p.cls || undefined} style={p.color ? { color: p.color } : undefined}>{p.text}</span>
  )}</>
}

/** Render the midline with coloring. */
function ColoredMid({ midline, qseq, hseq }: { midline: string; qseq: string; hseq: string }) {
  const parts: { cls: string; text: string }[] = []
  for (let i = 0; i < midline.length; i++) {
    const gap = isGap(qseq[i]) || isGap(hseq[i])
    const mis = !gap && midline[i] === ' '
    const cls = gap ? 'ba-gap' : mis ? 'ba-mis-mid' : 'ba-match-mid'
    const last = parts.length > 0 ? parts[parts.length - 1] : null
    if (last && last.cls === cls) {
      last.text += midline[i]
    } else {
      parts.push({ cls, text: midline[i] })
    }
  }
  return <>{parts.map((p, i) => <span key={i} className={p.cls}>{p.text}</span>)}</>
}

function AlignmentBlock({ hsp, isProtein }: { hsp: import('../blast/types').BlastHsp; isProtein: boolean }) {
  // Show alignment in 60-char chunks
  const CHUNK = 60
  const lines: { qseq: string; mid: string; hseq: string; qStart: number; hStart: number }[] = []

  let qPos = hsp.queryFrom
  let hPos = hsp.hitFrom
  const qDir = hsp.queryFrom <= hsp.queryTo ? 1 : -1
  const hDir = hsp.hitFrom <= hsp.hitTo ? 1 : -1

  for (let i = 0; i < hsp.qseq.length; i += CHUNK) {
    const qChunk = hsp.qseq.slice(i, i + CHUNK)
    const mChunk = hsp.midline.slice(i, i + CHUNK)
    const hChunk = hsp.hseq.slice(i, i + CHUNK)

    lines.push({ qseq: qChunk, mid: mChunk, hseq: hChunk, qStart: qPos, hStart: hPos })

    // Advance positions (skip gaps)
    for (const c of qChunk) { if (c !== '-') qPos += qDir }
    for (const c of hChunk) { if (c !== '-') hPos += hDir }
  }

  return (
    <pre className="blast-align-pre">
      {lines.map((l, i) => (
        <span key={i}>
          <span className="blast-align-label">{'Query'.padEnd(8)}{String(l.qStart).padStart(6)} </span>
          <ColoredSeq seq={l.qseq} midline={l.mid} other={l.hseq} isProtein={isProtein} />{'\n'}
          <span className="blast-align-label">{''.padEnd(15)}</span>
          <ColoredMid midline={l.mid} qseq={l.qseq} hseq={l.hseq} />{'\n'}
          <span className="blast-align-label">{'Sbjct'.padEnd(8)}{String(l.hStart).padStart(6)} </span>
          <ColoredSeq seq={l.hseq} midline={l.mid} other={l.qseq} isProtein={isProtein} />{'\n'}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

// --- Sortable table header ---

function SortTh({ label, sortKey: sk, currentKey, dir, onSort }: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
}) {
  const active = currentKey === sk
  return (
    <th className={`blast-th-sort ${active ? 'blast-th-sort-active' : ''}`} onClick={() => onSort(sk)}>
      {label}
      {active && (
        <span className="blast-sort-arrow">
          {dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
        </span>
      )}
    </th>
  )
}

const BLAST_COLORS = [
  '#4dabf7', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8',
  '#20c997', '#ff922b', '#748ffc', '#f06595', '#66d9e8',
]
