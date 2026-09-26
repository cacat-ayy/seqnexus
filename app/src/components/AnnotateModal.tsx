import './AnnotateModal.css'
/**
 * Annotate panel — settings and results for the auto-annotation overlay.
 *
 * The scan itself lives in useAutoAnnotateScan, because the overlay can be
 * switched on from the panel bar without this ever opening. What is left here
 * is everything that needs room: which databases to scan against, how similar
 * a hit has to be, and the full list of suggestions.
 *
 * Suggestions are *picked*, not added: the checkboxes here and Ctrl-click on
 * the canvas feed the same set, and one "Add" converts them in a single
 * undoable step. A row that adds a feature on the spot would be a second,
 * quieter way to edit the document, and the two would drift apart.
 */

import { useState, useMemo, useCallback, useRef } from 'react'
import { X, Search, Loader2, ChevronDown, ChevronRight, Upload, Trash2, Database } from 'lucide-react'
import { useEditorStore } from '../store'
import { FEATURE_CATEGORIES } from '../features/common-features'
import { getScanReferences, sourceIdForMatch, customCategories } from '../features/feature-sources'
import { parseFeatureSource, describeImport, FeatureSourceError } from '../features/feature-source-import'
import { matchKey, proposalsFrom } from '../utils/auto-annotations'
import type { AnnotationMatch } from '../workers/annotate-list'

import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface Props {
  open: boolean
  onClose: () => void
}

const IMPORT_ACCEPT = '.fasta,.fa,.fas,.fna,.txt,.csv,.tsv,.gb,.gbk,.genbank'

export default function AnnotateModal({ open, onClose }: Props) {
  const annotations = useEditorStore(s => s.doc.annotations)
  const matches = useEditorStore(s => s.autoAnnotations)
  const scanning = useEditorStore(s => s.autoAnnotateScanning)
  const minSimilarity = useEditorStore(s => s.autoAnnotateMinSimilarity)
  const overlapThreshold = useEditorStore(s => s.autoAnnotateOverlapThreshold)
  const setParams = useEditorStore(s => s.setAutoAnnotateParams)
  const picks = useEditorStore(s => s.autoAnnotationPicks)
  const togglePick = useEditorStore(s => s.toggleAutoAnnotationPick)
  const setPicks = useEditorStore(s => s.setAutoAnnotationPicks)
  const applyAutoAnnotations = useEditorStore(s => s.applyAutoAnnotations)

  const featureSources = useEditorStore(s => s.featureSources)
  const addFeatureSource = useEditorStore(s => s.addFeatureSource)
  const removeFeatureSource = useEditorStore(s => s.removeFeatureSource)
  const toggleFeatureSource = useEditorStore(s => s.toggleFeatureSource)

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [sourceMessage, setSourceMessage] = useState<{ text: string; error: boolean } | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  /** Suggestions: matches the document does not already cover. */
  const proposals = useMemo(
    () => proposalsFrom(matches, annotations, overlapThreshold),
    [matches, annotations, overlapThreshold],
  )

  /** Which database each hit came from, for the source badge. */
  const originBySource = useMemo(
    () => getScanReferences(featureSources).originBySource,
    [featureSources],
  )
  const sourceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of featureSources) map.set(s.id, s.name)
    return map
  }, [featureSources])
  const customSourceIds = useMemo(
    () => new Set(featureSources.filter(s => !s.builtin).map(s => s.id)),
    [featureSources],
  )

  const categories = useMemo(
    () => [...FEATURE_CATEGORIES, ...customCategories(featureSources)],
    [featureSources],
  )

  const filtered = useMemo(() => {
    let list = proposals
    if (categoryFilter !== 'All') {
      const catByName = new Map<string, string>()
      for (const s of featureSources) {
        for (const f of s.features) catByName.set(`${f.name}\u0000${f.type}`, f.category)
      }
      list = list.filter(m => catByName.get(`${m.refName}\u0000${m.refType}`) === categoryFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(m =>
        m.refName.toLowerCase().includes(q) ||
        m.refType.toLowerCase().includes(q)
      )
    }
    return list
  }, [proposals, search, categoryFilter, featureSources])

  const grouped = useMemo(() => {
    const map = new Map<string, AnnotationMatch[]>()
    for (const m of filtered) {
      const list = map.get(m.refName) || []
      list.push(m)
      map.set(m.refName, list)
    }
    return map
  }, [filtered])

  const pickedInView = useMemo(
    () => filtered.filter(m => picks.has(matchKey(m))).length,
    [filtered, picks],
  )

  const handleToggleGroup = useCallback((name: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }, [])

  /** Pick or unpick every hit of one feature — the "all four copies" case. */
  const handleToggleGroupPicks = useCallback((list: AnnotationMatch[]) => {
    const keys = list.map(matchKey)
    const current = useEditorStore.getState().autoAnnotationPicks
    const allPicked = keys.every(k => current.has(k))
    const next = new Set(current)
    for (const k of keys) {
      if (allPicked) next.delete(k)
      else next.add(k)
    }
    setPicks(next)
  }, [setPicks])

  const handleAdd = useCallback(() => {
    if (pickedInView > 0) {
      applyAutoAnnotations(useEditorStore.getState().autoAnnotationPicks)
    } else {
      applyAutoAnnotations(filtered.map(matchKey))
    }
  }, [pickedInView, filtered, applyAutoAnnotations])

  const handleImportFile = useCallback((file: File | undefined) => {
    if (!file) return
    file.text()
      .then(text => {
        const parsed = parseFeatureSource(file.name, text)
        if (parsed.features.length === 0) {
          setSourceMessage({ text: `No usable features in "${file.name}".`, error: true })
          return
        }
        addFeatureSource(file.name.replace(/\.[^.]+$/, ''), parsed.features)
        setSourceMessage({ text: describeImport(file.name, parsed), error: false })
      })
      .catch((err: unknown) => {
        const text = err instanceof FeatureSourceError
          ? err.message
          : `Could not read "${file.name}".`
        setSourceMessage({ text, error: true })
      })
  }, [addFeatureSource])

  // Backdrop / Escape
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
      <div className="modal-dialog ann-modal" role="dialog" aria-modal="true" aria-labelledby="annotate-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="annotate-modal-title">Annotate</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
            <div className="ann-find">
              {/* Databases to scan against */}
              <div className="ann-sources">
                <div className="ann-sources-head">
                  <span className="ann-sources-title"><Database size={13} /> Databases</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => importInputRef.current?.click()}
                    title="Import a FASTA, CSV/TSV or GenBank file of reference features"
                  >
                    <Upload size={12} /> Import database…
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept={IMPORT_ACCEPT}
                    style={{ display: 'none' }}
                    onChange={e => { handleImportFile(e.target.files?.[0]); e.target.value = '' }}
                  />
                </div>
                <ul className="ann-source-list">
                  {featureSources.map(source => (
                    <li key={source.id} className="ann-source">
                      <label className="ann-source-label">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={() => toggleFeatureSource(source.id)}
                        />
                        <span className="ann-source-name">{source.name}</span>
                      </label>
                      <span className="re-enzyme-count">{source.features.length}</span>
                      {!source.builtin && (
                        <button
                          className="ann-source-remove"
                          onClick={() => removeFeatureSource(source.id)}
                          title={`Remove "${source.name}"`}
                          aria-label={`Remove "${source.name}"`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {sourceMessage && (
                  <div className={`ann-source-msg ${sourceMessage.error ? 'error' : ''}`} role="status">
                    {sourceMessage.text}
                  </div>
                )}
              </div>

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
                  {categories.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Similarity slider */}
              <div className="ann-similarity-row">
                <label htmlFor="ann-min-similarity">Min. similarity:</label>
                <input
                  id="ann-min-similarity"
                  type="range"
                  min={50}
                  max={100}
                  value={minSimilarity}
                  onChange={e => setParams({ autoAnnotateMinSimilarity: parseInt(e.target.value) })}
                  className="ann-slider"
                />
                <span className="ann-sim-value">{minSimilarity}%</span>
              </div>

              {/* Overlap threshold slider */}
              <div className="ann-similarity-row">
                <label htmlFor="ann-overlap">Overlap threshold:</label>
                <input
                  id="ann-overlap"
                  type="range"
                  min={25}
                  max={100}
                  value={overlapThreshold}
                  onChange={e => setParams({ autoAnnotateOverlapThreshold: parseInt(e.target.value) })}
                  className="ann-slider"
                />
                <span className="ann-sim-value">{overlapThreshold}%</span>
              </div>

              {/* Results */}
              <div className="ann-results-header">
                {scanning ? (
                  <span className="ann-scanning"><Loader2 size={14} className="ann-spin" /> Scanning…</span>
                ) : (
                  <span>
                    {filtered.length} suggestion{filtered.length !== 1 ? 's' : ''}
                    {pickedInView > 0 && ` · ${pickedInView} picked`}
                  </span>
                )}
                {filtered.length > 0 && !scanning && (
                  <button
                    className="btn btn-primary btn-sm ann-add-all-btn"
                    onClick={handleAdd}
                  >
                    {pickedInView > 0 ? `Add picked (${pickedInView})` : `Add all (${filtered.length})`}
                  </button>
                )}
              </div>

              <div className="ann-results-list">
                {!scanning && filtered.length === 0 && (
                  <div className="re-no-results">
                    {matches.length > 0
                      ? 'Every match is already annotated'
                      : `No features found at ${minSimilarity}% similarity`}
                  </div>
                )}
                {Array.from(grouped.entries()).map(([name, matchList]) => {
                  const isCollapsed = collapsedGroups.has(name)
                  const groupKeys = matchList.map(matchKey)
                  const allPicked = groupKeys.every(k => picks.has(k))
                  const somePicked = !allPicked && groupKeys.some(k => picks.has(k))
                  const sourceId = sourceIdForMatch(matchList[0], originBySource)
                  const customSource = sourceId && customSourceIds.has(sourceId)
                    ? sourceNameById.get(sourceId)
                    : null
                  return (
                  <div key={name} className="ann-result-group">
                    <div className="ann-result-name">
                      <input
                        type="checkbox"
                        checked={allPicked}
                        ref={el => { if (el) el.indeterminate = somePicked }}
                        onChange={() => handleToggleGroupPicks(matchList)}
                        aria-label={`Pick all ${matchList.length} hits of ${name}`}
                        onClick={e => e.stopPropagation()}
                      />
                      <span
                        className="ann-result-head"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleToggleGroup(name)}
                      >
                        <span className="ann-result-chevron">
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </span>
                        <span className="ann-swatch" style={{ backgroundColor: matchList[0].color }} />
                        <span>{name}</span>
                        <span className="ft-type-badge">{matchList[0].refType}</span>
                        {customSource && <span className="ann-source-badge">{customSource}</span>}
                        <span className="re-enzyme-count">{matchList.length}×</span>
                      </span>
                    </div>
                    {!isCollapsed && matchList.map(m => {
                      const key = matchKey(m)
                      const picked = picks.has(key)
                      return (
                        <label key={key} className={`ann-result-match ${picked ? 'picked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => togglePick(key)}
                          />
                          <span className="ann-match-pos">
                            {m.start + 1}..{m.end}
                          </span>
                          <span className="ann-match-strand">
                            {m.strand === 1 ? '→' : '←'}
                          </span>
                          <span className="ann-match-sim">{m.similarity}%</span>
                        </label>
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
