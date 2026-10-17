import './EnzymePanel.css'
/**
 * Restriction Enzymes modal.
 *
 * Enzyme subset selection, cut count/position filters, results list.
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { X, GalleryVertical } from 'lucide-react'
import { useEditorStore } from '../store'
import type { RestrictionEnzyme } from '../enzymes/db'
import { summarizeMethylation, siteMethylationNote, type MethylationSummary } from '../enzymes/methylation'
import { BUILT_IN_SUBSETS, setKey, subsetEnzymes } from '../enzymes/sets'
import EnzymeSetControls from './EnzymeSetControls'
import { cuttingSites, type CutSite } from '../enzymes/finder'
import { findEnzymeSitesAsync } from '../workers/enzyme-finder'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { digestWorkspace } from '../gel/workspace'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'

interface Props {
  open: boolean
  onClose: () => void
}

/** Positions listed per enzyme before the rest are summed up as "+N more". */
const MAX_BADGES = 24

/**
 * A recognition sequence with its cut. A cut inside the site is a mark in
 * the sequence; one outside it is written as REBASE writes it: GGTCTC(1/5)
 * counts top/bottom from the site's 3' end, and a Type IIB enzyme gets a
 * pair before the site too, (10/15)ACNNNNGTAYC(12/7).
 */
function RecogWithCut({ enzyme }: { enzyme: RestrictionEnzyme }) {
  const { recognition, fwd_cut: fwd, rev_cut: rev, fwd_cut2: fwd2, rev_cut2: rev2 } = enzyme
  const n = recognition.length
  const inside = (c: number) => c >= 0 && c <= n
  if (fwd2 === undefined && inside(fwd) && inside(rev)) {
    if (fwd <= 0 || fwd >= n) return <>{recognition}</>
    return <>{recognition.slice(0, fwd)}<span className="re-cut-mark" />{recognition.slice(fwd)}</>
  }
  const before = fwd2 !== undefined && rev2 !== undefined ? `(${-fwd2}/${-rev2})` : ''
  return <>{before}{recognition}({fwd - n}/{rev - n})</>
}

export default function EnzymePanel({ open, onClose }: Props) {
  const doc = useEditorStore(s => s.doc)
  const setEnzymeCutSites = useEditorStore(s => s.setEnzymeCutSites)
  const setEnzymeNames = useEditorStore(s => s.setEnzymeNames)
  const setSelection = useEditorStore(s => s.setSelection)
  const toggleEnzymes = useEditorStore(s => s.toggleEnzymes)

  const setEnzymeParams = useEditorStore(s => s.setEnzymeParams)
  const subset = useEditorStore(s => s.enzymeSubset)
  const enzymeSets = useEditorStore(s => s.enzymeSets)
  const searchQuery = useEditorStore(s => s.enzymeSearchQuery)
  const filterByCount = useEditorStore(s => s.enzymeFilterByCount)
  const minCuts = useEditorStore(s => s.enzymeMinCuts)
  const maxCuts = useEditorStore(s => s.enzymeMaxCuts)
  const setSubset = useCallback((v: string) => setEnzymeParams({ enzymeSubset: v }), [setEnzymeParams])
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
  // Enzymes with too many sites to list (MAX_LISTED_SITES), and how many.
  const [tooMany, setTooMany] = useState<Map<string, number>>(new Map())
  const scanGeneration = useRef(0)
  // Edits rewrite the piece table in place, so `sequence` is the same object
  // before and after one: its version is what changes. Keyed on the object
  // alone, the list kept the sites of the sequence as it was before the edit.
  const seqVersion = sequence.pieceTable.version
  const scanned = useRef<{ sequence: unknown; enzymes: unknown; topology: string; version: number } | null>(null)

  // Compute all sites for the selected subset, filtered by search query
  const candidateEnzymes = useMemo(() => {
    let enzymes = subsetEnzymes(subset, enzymeSets)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase()
      enzymes = enzymes.filter(e =>
        e.name.toUpperCase().includes(q) ||
        e.recognition.toUpperCase().includes(q)
      )
    }
    return enzymes
  }, [subset, searchQuery, enzymeSets])

  // Scan for sites asynchronously in a Web Worker
  useEffect(() => {
    if (seqLen === 0) {
      setPerEnzymeSites(new Map())
      setTooMany(new Map())
      return
    }
    // The dialog is modal, so edits happen while it is closed. Rescanning
    // every candidate enzyme on each keystroke would be wasted work: an edit
    // marks the scan stale and it runs when the dialog opens. The sites on
    // the map follow edits meanwhile through App's rescan of those shown.
    const prev = scanned.current
    if (prev && prev.sequence === sequence && prev.enzymes === candidateEnzymes && prev.topology === topology
      && (prev.version === seqVersion || !open)) return
    scanned.current = { sequence, enzymes: candidateEnzymes, topology, version: seqVersion }
    const gen = ++scanGeneration.current
    setScanning(true)
    const bases = sequence.bases // materialize once
    findEnzymeSitesAsync(bases, candidateEnzymes, topology, { channel: 'panel' }).then(({ sites: allSites, tooMany: over }) => {
      if (gen !== scanGeneration.current) return // stale result
      // Group by enzyme name
      const map = new Map<string, CutSite[]>()
      for (const site of allSites) {
        const list = map.get(site.enzyme.name) || []
        list.push(site)
        map.set(site.enzyme.name, list)
      }
      setPerEnzymeSites(map)
      setTooMany(over)
      setScanning(false)
    }).catch(() => {
      if (gen === scanGeneration.current) setScanning(false)
    })
  }, [sequence, seqVersion, topology, candidateEnzymes, open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply filters to get the final set of enzymes and sites
  const filteredResult = useMemo(() => {
    let enzymes = candidateEnzymes
    // Cuts, not sites: a Type IIS site whose cut would fall past an end of a
    // linear sequence is there, but cuts nothing.
    const count = (e: RestrictionEnzyme) => {
      const sites = perEnzymeSites.get(e.name)
      return sites ? cuttingSites(sites).length : tooMany.get(e.name) ?? 0
    }

    // Filter by cut count
    if (filterByCount) {
      enzymes = enzymes.filter(e => count(e) >= minCuts && count(e) <= maxCuts)
    } else {
      // Still exclude enzymes with 0 cuts
      enzymes = enzymes.filter(e => count(e) > 0)
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
    // Listed by count only: their sites are neither listed nor drawn.
    const unlisted = enzymes.filter(e => tooMany.has(e.name)).map(e => ({ enzyme: e, count: tooMany.get(e.name)! }))
    return { enzymes, sites, unlisted }
  }, [candidateEnzymes, perEnzymeSites, tooMany, filterByCount, minCuts, maxCuts, posStart, posEnd])

  /** The enzymes the panel lists, which "Save list as set" keeps. */
  const listedNames = useMemo(() => filteredResult.enzymes.map(e => e.name), [filteredResult.enzymes])

  // Total matching site count, including the ones too many to list
  const unlistedSites = filteredResult.unlisted.reduce((a, u) => a + u.count, 0)
  const matchCount = cuttingSites(filteredResult.sites).length + unlistedSites

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

  // Closing the dialog shows what it found. The effect above only fires when
  // the count changes while it is open, so reopening it with the same
  // results (or after switching the sites off) used to close on nothing
  // shown. Watching the close itself covers every way out: the close
  // button, Escape, the backdrop and running a gel.
  const siteCountRef = useRef(0)
  siteCountRef.current = filteredResult.sites.length
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open && siteCountRef.current > 0 && !useEditorStore.getState().showEnzymes) {
      toggleEnzymes()
    }
    wasOpen.current = open
  }, [open, toggleEnzymes])

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

  // What methylation does to each enzyme's sites, site by site, as the
  // digest and the gel decide it. The sites are rescanned after every edit,
  // so the bases read here match them.
  const damMethylated = doc.metadata?.damMethylated ?? false
  const dcmMethylated = doc.metadata?.dcmMethylated ?? false
  const methylationByEnzyme = useMemo(() => {
    const ctx = { bases: sequence.bases, topology, dam: damMethylated, dcm: dcmMethylated }
    const map = new Map<string, MethylationSummary>()
    for (const [name, sites] of sitesByEnzyme) map.set(name, summarizeMethylation(sites, ctx))
    return map
  }, [sitesByEnzyme, sequence, topology, damMethylated, dcmMethylated])

  // Backdrop click / Escape
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const { onMouseDown: handleBackdropDown, onClick: handleBackdrop } = useBackdropDismiss(onClose)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  /** A new gel: ladder, the sequence uncut, and cut with this enzyme. */
  const runOnGel = useCallback((enzyme: string) => {
    const s = useEditorStore.getState()
    if (!s.activeTabId) return
    s.createGel({ name: `${s.doc.name} ${enzyme}`, state: digestWorkspace(s.activeTabId, [enzyme]) })
    onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropDown} onClick={handleBackdrop} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog enzyme-modal" role="dialog" aria-modal="true" aria-labelledby="enzyme-panel-title">
        <div className="modal-header">
          <h3 className="modal-title" id="enzyme-panel-title">Restriction Enzymes</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Settings */}
          <div className="re-settings">
            <div className="re-field">
              <label className="re-field-label">Candidate enzymes</label>
              <select
                className="select re-select"
                value={subset}
                onChange={e => setSubset(e.target.value)}
              >
                <optgroup label="Built in">
                  {BUILT_IN_SUBSETS.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </optgroup>
                {enzymeSets.length > 0 && (
                  <optgroup label="Your sets">
                    {enzymeSets.map(s => (
                      <option key={s.id} value={setKey(s.id)}>{s.name} ({s.enzymes.length})</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <EnzymeSetControls subset={subset} onSubset={setSubset} listed={listedNames} />
            </div>

            <div className="re-field">
              <label className="re-field-label">Search</label>
              <input
                className="input re-search-input"
                type="text"
                placeholder="Name or recognition sequence…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                spellCheck={false}
              />
            </div>

            {/* The count filter reads as one sentence on one line: "Cutting 1 to 1 times". */}
            <div className="re-range-row">
              <label className="re-check">
                <input
                  type="checkbox"
                  checked={filterByCount}
                  onChange={e => setFilterByCount(e.target.checked)}
                />
                Cutting
              </label>
              {filterByCount ? (
                <>
                  <input
                    type="number"
                    className="re-num"
                    min={0}
                    value={minCuts}
                    aria-label="Fewest cuts"
                    onChange={e => setMinCuts(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                  <span>to</span>
                  <input
                    type="number"
                    className="re-num"
                    min={0}
                    value={maxCuts}
                    aria-label="Most cuts"
                    onChange={e => setMaxCuts(Math.max(0, parseInt(e.target.value) || 0))}
                  />
                  <span>times</span>
                </>
              ) : <span>any number of times</span>}
            </div>

            <div className="re-field">
              <label className="re-field-label">Cut positions</label>
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
          <div className="re-results-header re-results-status">
            {scanning ? 'Scanning…' : (() => {
              const enzymeCount = sitesByEnzyme.size + filteredResult.unlisted.length
              return `${enzymeCount.toLocaleString('en-US')} enzyme${enzymeCount !== 1 ? 's' : ''}, ${matchCount.toLocaleString('en-US')} site${matchCount !== 1 ? 's' : ''}`
            })()}
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
                  const meth = methylationByEnzyme.get(name)
                  // The row fades only when methylation stops every site; a
                  // partial block is shown on the tag and on the sites it hits.
                  const allBlocked = !!meth && meth.total > 0 && meth.blocked === meth.total
                  const allImpaired = !!meth && meth.total > 0 && meth.blocked === 0 && meth.impaired === meth.total
                  const methClass = allBlocked ? ' re-methyl-blocked' : allImpaired ? ' re-methyl-impaired' : ''
                  return (
                  <li key={name} className={`re-enzyme-group${methClass}`} title={meth?.note ?? undefined}>
                    <div className="re-enzyme-row">
                      <span className="re-enzyme-name">{name}</span>
                      <span className="re-enzyme-count">{cuttingSites(sites).length}×</span>
                      <span className="re-enzyme-recog">
                        <RecogWithCut enzyme={enz} />
                      </span>
                      <span className="re-enzyme-overhang">{ovLabel}</span>
                      {meth?.tag && (
                        <span className={`re-methyl-tag re-methyl-tag-${allBlocked ? 'blocked' : meth.blocked > 0 ? 'partial' : 'impaired'}`}>
                          {meth.tag}
                        </span>
                      )}
                      {/* The positions sit in the enzyme's row, not a line of their own. */}
                      <div className="re-site-badges">
                        {sites.slice(0, MAX_BADGES).map((site, i) => {
                          const eff = meth?.effects[i] ?? null
                          const cls = site.offEnd ? ' re-site-off-end'
                            : eff ? ` re-site-${eff.effect}` : ''
                          return (
                            <span
                              key={i}
                              className={`re-site-badge${cls}`}
                              onClick={() => handleSiteClick(site)}
                              title={site.offEnd
                                ? `${site.enzyme.name} at ${site.position + 1} cuts past the end of the sequence, so it does not cut`
                                : eff ? `${site.enzyme.name} at ${site.position + 1}: ${siteMethylationNote(eff)}`
                                : `${site.enzyme.name} at ${site.position + 1}`}
                            >
                              {site.position + 1}
                            </span>
                          )
                        })}
                        {sites.length > MAX_BADGES && (
                          <span className="re-site-more">+{(sites.length - MAX_BADGES).toLocaleString('en-US')} more</span>
                        )}
                      </div>
                      <button
                        className="re-gel-btn"
                        title={`Run a ${name} digest on a virtual gel`}
                        aria-label={`Run ${name} on a gel`}
                        onClick={() => runOnGel(name)}
                      >
                        <GalleryVertical size={12} />
                      </button>
                    </div>
                  </li>
                  )
                })}
                {filteredResult.unlisted.map(({ enzyme: enz, count }) => (
                  <li key={enz.name} className="re-enzyme-group">
                    <div className="re-enzyme-row">
                      <span className="re-enzyme-name">{enz.name}</span>
                      <span className="re-enzyme-count">{count.toLocaleString('en-US')}×</span>
                      <span className="re-enzyme-recog"><RecogWithCut enzyme={enz} /></span>
                      <div className="re-site-badges">
                        <span className="re-site-more">too many sites to list or draw</span>
                      </div>
                    </div>
                  </li>
                ))}
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
