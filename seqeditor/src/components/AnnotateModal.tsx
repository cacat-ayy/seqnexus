import './AnnotateModal.css'
/**
 * Annotate modal - auto-detect common features in the loaded sequence.
 *
 * Scans the sequence against a database of ~85 common molecular biology
 * features (promoters, terminators, resistance genes, reporters, etc.)
 * using a Web Worker with k-mer indexed fuzzy matching.
 *
 * Two tabs:
 *   "Find Features" - auto-scan results with per-match add + add-all
 *   "Custom" - manual annotation form
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { X, Search, Check, CheckCheck, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore } from '../store'
import { getCommonFeatures, FEATURE_CATEGORIES } from '../features/common-features'
import { annotateFromList, matchToAnnotationData } from '../workers/annotate-list'
import type { AnnotationMatch } from '../workers/annotate-list'

import { useExitAnimation } from '../hooks/useExitAnimation'

interface Props {
  open: boolean
  onClose: () => void
}

export default function AnnotateModal({ open, onClose }: Props) {
  const sequence = useEditorStore(s => s.doc.sequence)
  const seqLength = sequence.length
  const annotations = useEditorStore(s => s.doc.annotations)
  const addAnnotation = useEditorStore(s => s.addAnnotation)
  const addAnnotations = useEditorStore(s => s.addAnnotations)

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [matches, setMatches] = useState<AnnotationMatch[]>([])
  const [minSimilarity, setMinSimilarity] = useState(85)
  const [overlapThreshold, setOverlapThreshold] = useState(75)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [addedSet, setAddedSet] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const scanGeneration = useRef(0)

  // Reset added set when modal opens
  useEffect(() => {
    if (open) setAddedSet(new Set())
  }, [open])

  // Auto-scan when modal opens or similarity changes
  useEffect(() => {
    if (!open || seqLength === 0) return
    const gen = ++scanGeneration.current
    setScanning(true)

    const features = getCommonFeatures()
    const refs = features.map(f => ({
      name: f.name,
      type: f.type,
      sequence: f.sequence,
      color: f.color,
    }))

    annotateFromList(sequence.bases, refs, minSimilarity, true)
      .then(results => {
        if (gen !== scanGeneration.current) return
        setMatches(results)
        setScanning(false)
      })
      .catch(() => {
        if (gen !== scanGeneration.current) return
        setMatches([])
        setScanning(false)
      })
  }, [open, seqLength, minSimilarity]) // eslint-disable-line react-hooks/exhaustive-deps -- sequence.bases read inside but keyed on seqLength to avoid re-scan on every edit

  // Unique key for a match (for tracking added/duplicate state)
  const matchKey = (m: AnnotationMatch) =>
    `${m.refName}:${m.start}:${m.end}:${m.strand}`

  // Filter matches by search and category
  const filteredMatches = useMemo(() => {
    let list = matches
    if (categoryFilter !== 'All') {
      // Map match back to its category
      const catMap = new Map<string, string>()
      for (const f of getCommonFeatures()) catMap.set(f.name, f.category)
      list = list.filter(m => catMap.get(m.refName) === categoryFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(m =>
        m.refName.toLowerCase().includes(q) ||
        m.refType.toLowerCase().includes(q)
      )
    }
    return list
  }, [matches, search, categoryFilter])

  // Detect duplicates: matches that overlap existing annotations
  const duplicateSet = useMemo(() => {
    const dupes = new Set<string>()
    if (annotations.length === 0) return dupes
    for (const m of filteredMatches) {
      const mLen = m.end - m.start
      for (const ann of annotations) {
        if (ann.type !== m.refType) continue
        if (ann.strand !== m.strand) continue
        const overlapStart = Math.max(m.start, ann.start)
        const overlapEnd = Math.min(m.end, ann.end)
        const overlapLen = Math.max(0, overlapEnd - overlapStart)
        const annLen = ann.end - ann.start
        // Reciprocal overlap: both the match and the annotation must overlap by >= threshold
        const matchOverlap = mLen > 0 ? (overlapLen / mLen) * 100 : 0
        const annOverlap = annLen > 0 ? (overlapLen / annLen) * 100 : 0
        if (matchOverlap >= overlapThreshold && annOverlap >= overlapThreshold) {
          dupes.add(matchKey(m))
          break
        }
      }
    }
    return dupes
  }, [filteredMatches, annotations, overlapThreshold])

  // Group filtered matches by feature name
  const grouped = useMemo(() => {
    const map = new Map<string, AnnotationMatch[]>()
    for (const m of filteredMatches) {
      const list = map.get(m.refName) || []
      list.push(m)
      map.set(m.refName, list)
    }
    return map
  }, [filteredMatches])

  const handleAddMatch = useCallback((m: AnnotationMatch) => {
    const data = matchToAnnotationData(m)
    addAnnotation(data)
    setAddedSet(prev => new Set(prev).add(matchKey(m)))
  }, [addAnnotation])

  const handleAddAll = useCallback(() => {
    const toAdd = filteredMatches.filter(m => !addedSet.has(matchKey(m)) && !duplicateSet.has(matchKey(m)))
    if (toAdd.length === 0) return
    const dataArray = toAdd.map(m => matchToAnnotationData(m))
    addAnnotations(dataArray)
    setAddedSet(prev => {
      const next = new Set(prev)
      for (const m of toAdd) next.add(matchKey(m))
      return next
    })
  }, [filteredMatches, addedSet, duplicateSet, addAnnotations])

  // Backdrop / Escape
  const backdropRef = useRef<HTMLDivElement>(null)
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const unadded = filteredMatches.filter(m => !addedSet.has(matchKey(m)) && !duplicateSet.has(matchKey(m))).length

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div className="modal-dialog ann-modal">
        <div className="modal-header">
          <h3 className="modal-title">Annotate</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="modal-body">
            <div className="ann-find">
              {/* Controls row */}
              <div className="ann-controls">
                <div className="ann-search-box">
                  <Search size={14} />
                  <input
                    className="ann-search-input"
                    placeholder="Filter results…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <select
                  className="select ft-select"
                  value={categoryFilter}
                  onChange={e => setCategoryFilter(e.target.value)}
                >
                  <option value="All">All categories</option>
                  {FEATURE_CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Similarity slider */}
              <div className="ann-similarity-row">
                <label>Min. similarity:</label>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={minSimilarity}
                  onChange={e => setMinSimilarity(parseInt(e.target.value))}
                  className="ann-slider"
                />
                <span className="ann-sim-value">{minSimilarity}%</span>
              </div>

              {/* Overlap threshold slider */}
              <div className="ann-similarity-row">
                <label>Overlap threshold:</label>
                <input
                  type="range"
                  min={25}
                  max={100}
                  value={overlapThreshold}
                  onChange={e => setOverlapThreshold(parseInt(e.target.value))}
                  className="ann-slider"
                />
                <span className="ann-sim-value">{overlapThreshold}%</span>
              </div>

              {/* Results */}
              <div className="ann-results-header">
                {scanning ? (
                  <span className="ann-scanning"><Loader2 size={14} className="ann-spin" /> Scanning…</span>
                ) : (
                  <span>{filteredMatches.length} match{filteredMatches.length !== 1 ? 'es' : ''} found</span>
                )}
                {filteredMatches.length > 0 && !scanning && (
                  <button
                    className="btn btn-primary btn-sm ann-add-all-btn"
                    onClick={handleAddAll}
                    disabled={unadded === 0}
                  >
                    <CheckCheck size={14} />
                    {unadded > 0 ? `Add All (${unadded})` : 'All Added'}
                  </button>
                )}
              </div>

              <div className="ann-results-list">
                {!scanning && filteredMatches.length === 0 && (
                  <div className="re-no-results">No features found at {minSimilarity}% similarity</div>
                )}
                {Array.from(grouped.entries()).map(([name, matchList]) => {
                  const isCollapsed = collapsedGroups.has(name)
                  return (
                  <div key={name} className="ann-result-group">
                    <div
                      className="ann-result-name"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCollapsedGroups(prev => {
                        const next = new Set(prev)
                        if (next.has(name)) next.delete(name); else next.add(name)
                        return next
                      })}
                    >
                      <span className="ann-result-chevron">
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </span>
                      <span className="ann-swatch" style={{ backgroundColor: matchList[0].color }} />
                      <span>{name}</span>
                      <span className="ft-type-badge">{matchList[0].refType}</span>
                      <span className="re-enzyme-count">{matchList.length}×</span>
                    </div>
                    {!isCollapsed && matchList.map((m, i) => {
                      const key = matchKey(m)
                      const added = addedSet.has(key)
                      const isDuplicate = duplicateSet.has(key)
                      return (
                        <div key={i} className={`ann-result-match ${isDuplicate ? 'duplicate' : ''}`}>
                          <span className="ann-match-pos">
                            {m.start + 1}..{m.end}
                          </span>
                          <span className="ann-match-strand">
                            {m.strand === 1 ? '→' : '←'}
                          </span>
                          <span className="ann-match-sim">{m.similarity}%</span>
                          <button
                            className={`btn btn-sm ann-add-btn ${added || isDuplicate ? 'added' : ''}`}
                            onClick={() => handleAddMatch(m)}
                            disabled={added || isDuplicate}
                          >
                            {isDuplicate ? 'Already annotated' : added ? <><Check size={12} /> Added</> : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  )
                })}
              </div>
            </div>
        </div>
      </div>
    </div>
  )
}
