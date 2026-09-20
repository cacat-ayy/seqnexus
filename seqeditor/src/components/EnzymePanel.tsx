import './EnzymePanel.css'
/**
 * Restriction Analysis modal.
 *
 * Enzyme subset selection, cut count/position filters, results list.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../store'
import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme, methylationEffect } from '../enzymes/db'
import type { CutSite } from '../enzymes/finder'
import { findEnzymeSitesAsync } from '../workers/enzyme-finder'
import { useExitAnimation } from '../hooks/useExitAnimation'

type SubsetKey = 'all' | 'common6' | 'rare8' | 'freq4' | 'goldengate' | 'all6' | 'all4' | 'all8plus' | 'blunt' | 'overhang5' | 'overhang3' | 'typeIIS'

const SUBSET_LABELS: Record<SubsetKey, string> = {
  all: 'All enzymes',
  common6: 'Common (6-cutters)',
  rare8: 'Rare (8-cutters)',
  freq4: 'Frequent (4-cutters)',
  goldengate: 'Golden Gate (Type IIS)',
  all6: 'All 6-cutters',
  all4: 'All 4-cutters',
  all8plus: 'All 8+ cutters',
  blunt: 'Blunt cutters',
  overhang5: "5' overhang",
  overhang3: "3' overhang",
  typeIIS: 'Type IIS',
}

const SUBSET_TO_GROUP: Record<SubsetKey, string | null> = {
  all: null,
  common6: 'Common (6-cutters)',
  rare8: 'Rare (8-cutters)',
  freq4: 'Frequent (4-cutters)',
  goldengate: 'Golden Gate (Type IIS)',
  all6: 'All 6-cutters',
  all4: 'All 4-cutters',
  all8plus: 'All 8+ cutters',
  blunt: 'Blunt cutters',
  overhang5: "5' overhang",
  overhang3: "3' overhang",
  typeIIS: 'Type IIS',
}

function getSubsetEnzymes(subset: SubsetKey): RestrictionEnzyme[] {
  const groupName = SUBSET_TO_GROUP[subset]
  if (!groupName) return ENZYME_DB
  const names = ENZYME_GROUPS[groupName]
  if (!names) return ENZYME_DB
  return ENZYME_DB.filter(e => names.includes(e.name))
}

interface Props {
  open: boolean
  onClose: () => void
}

/** Render a recognition sequence with a cut-site marker inserted at the fwd_cut position. */
function RecogWithCut({ recognition, cutPos }: { recognition: string; cutPos: number }) {
  // cutPos is between bases cutPos-1 and cutPos (0-based)
  // If cut is outside the recognition site (Type IIS), just show the sequence
  if (cutPos <= 0 || cutPos >= recognition.length) {
    return <>{recognition}</>
  }
  const left = recognition.slice(0, cutPos)
  const right = recognition.slice(cutPos)
  return <>{left}<span className="re-cut-mark" />{right}</>
}

export default function EnzymePanel({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const setEnzymeCutSites = useEditorStore(s => s.setEnzymeCutSites)
  const setEnzymeNames = useEditorStore(s => s.setEnzymeNames)
  const setSelection = useEditorStore(s => s.setSelection)
  const toggleEnzymes = useEditorStore(s => s.toggleEnzymes)

  const setEnzymeParams = useEditorStore(s => s.setEnzymeParams)
  const subset = useEditorStore(s => s.enzymeSubset) as SubsetKey
  const searchQuery = useEditorStore(s => s.enzymeSearchQuery)
  const filterByCount = useEditorStore(s => s.enzymeFilterByCount)
  const minCuts = useEditorStore(s => s.enzymeMinCuts)
  const maxCuts = useEditorStore(s => s.enzymeMaxCuts)
  const setSubset = useCallback((v: SubsetKey) => setEnzymeParams({ enzymeSubset: v }), [setEnzymeParams])
  const setSearchQuery = useCallback((v: string) => setEnzymeParams({ enzymeSearchQuery: v }), [setEnzymeParams])
  const setFilterByCount = useCallback((v: boolean) => setEnzymeParams({ enzymeFilterByCount: v }), [setEnzymeParams])
  const setMinCuts = useCallback((v: number) => setEnzymeParams({ enzymeMinCuts: v }), [setEnzymeParams])
  const setMaxCuts = useCallback((v: number) => setEnzymeParams({ enzymeMaxCuts: v }), [setEnzymeParams])
  const [posStart, setPosStart] = useState(1)
  const [posEnd, setPosEnd] = useState(doc.sequence.length || 1)

  const sequence = doc.sequence
  const topology = sequence.topology
  const seqLen = sequence.length

  // Update posEnd when sequence changes
  useEffect(() => {
    setPosEnd(seqLen || 1)
  }, [seqLen])

  const [scanning, setScanning] = useState(false)
  const [perEnzymeSites, setPerEnzymeSites] = useState<Map<string, CutSite[]>>(new Map())
  const scanGeneration = useRef(0)

  // Compute all sites for the selected subset, filtered by search query
  const candidateEnzymes = useMemo(() => {
    let enzymes = getSubsetEnzymes(subset)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase()
      enzymes = enzymes.filter(e =>
        e.name.toUpperCase().includes(q) ||
        e.recognition.toUpperCase().includes(q)
      )
    }
    return enzymes
  }, [subset, searchQuery])

  // Scan for sites asynchronously in a Web Worker
  useEffect(() => {
    if (seqLen === 0) {
      setPerEnzymeSites(new Map())
      return
    }
    const gen = ++scanGeneration.current
    setScanning(true)
    const bases = sequence.bases // materialize once
    findEnzymeSitesAsync(bases, candidateEnzymes, topology).then(allSites => {
      if (gen !== scanGeneration.current) return // stale result
      // Group by enzyme name
      const map = new Map<string, CutSite[]>()
      for (const site of allSites) {
        const list = map.get(site.enzyme.name) || []
        list.push(site)
        map.set(site.enzyme.name, list)
      }
      setPerEnzymeSites(map)
      setScanning(false)
    }).catch(() => {
      if (gen === scanGeneration.current) setScanning(false)
    })
  }, [sequence, topology, candidateEnzymes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply filters to get the final set of enzymes and sites
  const filteredResult = useMemo(() => {
    let enzymes = candidateEnzymes

    // Filter by cut count
    if (filterByCount) {
      enzymes = enzymes.filter(e => {
        const count = perEnzymeSites.get(e.name)?.length ?? 0
        return count >= minCuts && count <= maxCuts
      })
    } else {
      // Still exclude enzymes with 0 cuts
      enzymes = enzymes.filter(e => (perEnzymeSites.get(e.name)?.length ?? 0) > 0)
    }

    // Collect all sites from matching enzymes
    let sites: CutSite[] = []
    for (const e of enzymes) {
      const s = perEnzymeSites.get(e.name)
      if (s) sites.push(...s)
    }

    // Filter by position range
    const pStart = posStart - 1 // convert to 0-based
    const pEnd = posEnd
    sites = sites.filter(s => s.position >= pStart && s.position < pEnd)

    sites.sort((a, b) => a.position - b.position)
    return { enzymes, sites }
  }, [candidateEnzymes, perEnzymeSites, filterByCount, minCuts, maxCuts, posStart, posEnd])

  // Total matching enzyme count
  const matchCount = filteredResult.sites.length

  // Always push results to store; auto-enable display when sites are found
  useEffect(() => {
    setEnzymeCutSites(filteredResult.sites)
    setEnzymeNames(filteredResult.enzymes.map(e => e.name))
  }, [filteredResult, setEnzymeCutSites, setEnzymeNames])

  // Auto-enable restriction site display when the user is in the modal and it produces results
  const prevSiteCount = useRef(0)
  useEffect(() => {
    const count = filteredResult.sites.length
    if (open && count > 0 && prevSiteCount.current !== count && !useEditorStore.getState().showEnzymes) {
      toggleEnzymes()
    }
    prevSiteCount.current = count
  }, [filteredResult.sites.length, toggleEnzymes, open])

  const handleSiteClick = useCallback((site: CutSite) => {
    setSelection({ anchor: site.position, caret: site.position + site.enzyme.recognition.length })
  }, [setSelection])

  // Group sites by enzyme for the results list
  const sitesByEnzyme = useMemo(() => {
    const map = new Map<string, CutSite[]>()
    for (const site of filteredResult.sites) {
      const list = map.get(site.enzyme.name) || []
      list.push(site)
      map.set(site.enzyme.name, list)
    }
    return map
  }, [filteredResult.sites])

  // Backdrop click / Escape
  const backdropRef = useRef<HTMLDivElement>(null)
  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div className="modal-dialog enzyme-modal">
        <div className="modal-header">
          <h3 className="modal-title">Restriction Analysis</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Settings */}
          <div className="re-settings">
            <div className="re-field">
              <label className="re-field-label">Candidate Enzymes:</label>
              <select
                className="select re-select"
                value={subset}
                onChange={e => setSubset(e.target.value as SubsetKey)}
              >
                {Object.entries(SUBSET_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            <div className="re-field">
              <label className="re-field-label">Search:</label>
              <input
                className="input re-search-input"
                type="text"
                placeholder="Name or recognition sequence…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                spellCheck={false}
              />
            </div>

            <label className="re-check">
              <input
                type="checkbox"
                checked={filterByCount}
                onChange={e => setFilterByCount(e.target.checked)}
              />
              Enzymes must match:
            </label>
            {filterByCount && (
              <div className="re-range-row">
                <input
                  type="number"
                  className="re-num"
                  min={0}
                  value={minCuts}
                  onChange={e => setMinCuts(Math.max(0, parseInt(e.target.value) || 0))}
                />
                <span>to</span>
                <input
                  type="number"
                  className="re-num"
                  min={0}
                  value={maxCuts}
                  onChange={e => setMaxCuts(Math.max(0, parseInt(e.target.value) || 0))}
                />
                <span>times</span>
              </div>
            )}

            <div className="re-field">
              <label className="re-field-label">Cut position range:</label>
              <div className="re-range-row">
                <input
                  type="number"
                  className="re-num re-num-wide"
                  min={1}
                  max={seqLen}
                  value={posStart}
                  onChange={e => setPosStart(Math.max(1, parseInt(e.target.value) || 1))}
                />
                <span>to</span>
                <input
                  type="number"
                  className="re-num re-num-wide"
                  min={1}
                  max={seqLen}
                  value={posEnd}
                  onChange={e => setPosEnd(Math.min(seqLen, parseInt(e.target.value) || seqLen))}
                />
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="re-results-header" style={{ marginTop: 12 }}>
            {scanning ? 'Scanning…' : `${sitesByEnzyme.size} enzyme${sitesByEnzyme.size !== 1 ? 's' : ''}, ${matchCount} site${matchCount !== 1 ? 's' : ''}`}
          </div>

          {/* Results list */}
          {matchCount > 0 && (
            <div className="re-results">
              <ul className="re-site-list">
                {[...sitesByEnzyme.entries()].map(([name, sites]) => {
                  const enz = sites[0].enzyme
                  const ovLabel = enz.overhang === 'blunt' ? 'blunt'
                    : enz.overhang === '5prime' ? "5'"
                    : "3'"
                  const methEffect = methylationEffect(enz, doc.metadata?.damMethylated, doc.metadata?.dcmMethylated)
                  const methClass = methEffect === 'blocked' ? ' re-methyl-blocked' : methEffect === 'impaired' ? ' re-methyl-impaired' : ''
                  const methLabel = methEffect === 'blocked' ? 'Blocked by methylation' : methEffect === 'impaired' ? 'Impaired by methylation' : undefined
                  return (
                  <li key={name} className={`re-enzyme-group${methClass}`} title={methLabel}>
                    <div className="re-enzyme-row">
                      <span className="re-enzyme-name">{name}</span>
                      <span className="re-enzyme-count">{sites.length}×</span>
                      <span className="re-enzyme-recog">
                        <RecogWithCut recognition={enz.recognition} cutPos={enz.fwd_cut} />
                      </span>
                      <span className="re-enzyme-overhang">{ovLabel}</span>
                      {methEffect && <span className={`re-methyl-tag re-methyl-tag-${methEffect}`}>{methEffect === 'blocked' ? 'blocked' : 'impaired'}</span>}
                    </div>
                    <div className="re-site-badges">
                      {sites.map((site, i) => (
                        <span
                          key={i}
                          className="re-site-badge"
                          onClick={() => handleSiteClick(site)}
                          title={`${site.enzyme.name} at ${site.position + 1}`}
                        >
                          {site.position + 1}
                        </span>
                      ))}
                    </div>
                  </li>
                  )
                })}
              </ul>
            </div>
          )}

          {matchCount === 0 && !scanning && (
            <div className="re-no-results">No sites match the current filters</div>
          )}
        </div>
      </div>
    </div>
  )
}
