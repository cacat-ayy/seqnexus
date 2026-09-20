import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store'
import { loadSession, scheduleSave, onSaveComplete } from '../persistence'
import { findORFs } from '../workers/orf-finder'
import { findEnzymeSitesAsync } from '../workers/enzyme-finder'
import { ENZYME_DB, ENZYME_GROUPS, type RestrictionEnzyme } from '../enzymes/db'

const SUBSET_TO_GROUP: Record<string, string | null> = {
  all: null, common6: 'Common (6-cutters)', rare8: 'Rare (8-cutters)',
  freq4: 'Frequent (4-cutters)', goldengate: 'Golden Gate (Type IIS)',
  all6: 'All 6-cutters', all4: 'All 4-cutters', all8plus: 'All 8+ cutters',
  blunt: 'Blunt cutters', overhang5: "5' overhang", overhang3: "3' overhang", typeIIS: 'Type IIS',
}

function getSubsetEnzymes(subset: string, searchQuery: string): RestrictionEnzyme[] {
  const groupName = SUBSET_TO_GROUP[subset]
  let enzymes = groupName ? ENZYME_DB.filter(e => ENZYME_GROUPS[groupName]?.includes(e.name)) : ENZYME_DB
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toUpperCase()
    enzymes = enzymes.filter(e => e.name.toUpperCase().includes(q) || e.recognition.toUpperCase().includes(q))
  }
  return enzymes
}

/**
 * Handles session restore on mount, auto-save on store/theme changes,
 * and beforeunload warning.
 */
export function useSessionPersistence(
  theme: string,
  setTheme: (t: string) => void,
  openDocument: (name: string, bases: string, topology?: 'linear' | 'circular', description?: string) => void,
  demoSequence: string,
) {
  const [storageRefreshKey, setStorageRefreshKey] = useState(0)
  // Block saves until the session has been restored (or demo loaded)
  const restoredRef = useRef(false)

  // Increment refresh key after each save so StorageIndicator re-reads
  useEffect(() => {
    onSaveComplete(() => setStorageRefreshKey(k => k + 1))
    return () => onSaveComplete(null)
  }, [])

  // Restore saved session or load demo on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const saved = await loadSession()
      if (cancelled) return
      if (saved && (saved.tabs.length > 0 || saved.sequencingReads.length > 0 || saved.alignments.length > 0 || saved.readAlignments.length > 0 || saved.contigs.length > 0)) {
        useEditorStore.getState().restoreSession(
          saved.tabs,
          saved.activeTabId,
          saved.folders,
          saved.sequencingReads,
          saved.activeSequencingReadIds,
          saved.alignments,
          saved.readAlignments,
          saved.contigs,
          saved.activeAlignmentId,
          saved.activeContigId,
          saved.activeReadAlignmentId,
        )
        // Restore ORF/enzyme panel params so searches re-run on panel open
        const store = useEditorStore.getState()
        if (saved.orfParams) {
          store.setOrfParams({
            orfMinCodons: saved.orfParams.minCodons,
            orfStartCodons: saved.orfParams.startCodons,
            orfAllowInterior: saved.orfParams.allowInterior,
          })
        }
        if (saved.enzymeParams) {
          store.setEnzymeParams({
            enzymeSubset: saved.enzymeParams.subset,
            enzymeSearchQuery: saved.enzymeParams.searchQuery,
            enzymeFilterByCount: saved.enzymeParams.filterByCount,
            enzymeMinCuts: saved.enzymeParams.minCuts,
            enzymeMaxCuts: saved.enzymeParams.maxCuts,
          })
        }
        // Re-run ORF/enzyme searches for the active tab if its visibility flags are on
        const doc = store.doc
        if (doc.sequence.length > 0) {
          if (store.showOrfs && saved.orfParams) {
            const p = saved.orfParams
            findORFs(doc.sequence.bases, {
              minCodons: p.minCodons, maxCodons: 0,
              startCodons: p.startCodons, allowInterior: p.allowInterior,
              topology: doc.sequence.topology,
            }).then(orfs => useEditorStore.getState().setOrfResults(orfs)).catch(() => {})
          }
          if (store.showEnzymes && saved.enzymeParams) {
            const ep = saved.enzymeParams
            const enzymes = getSubsetEnzymes(ep.subset, ep.searchQuery)
            findEnzymeSitesAsync(doc.sequence.bases, enzymes, doc.sequence.topology).then(allSites => {
              const perEnzyme = new Map<string, typeof allSites>()
              for (const site of allSites) {
                const list = perEnzyme.get(site.enzyme.name) || []
                list.push(site)
                perEnzyme.set(site.enzyme.name, list)
              }
              let filtered = enzymes
              if (ep.filterByCount) {
                filtered = filtered.filter(e => {
                  const count = perEnzyme.get(e.name)?.length ?? 0
                  return count >= ep.minCuts && count <= ep.maxCuts
                })
              } else {
                filtered = filtered.filter(e => (perEnzyme.get(e.name)?.length ?? 0) > 0)
              }
              const sites = filtered.flatMap(e => perEnzyme.get(e.name) ?? [])
                .sort((a, b) => a.position - b.position)
              const s = useEditorStore.getState()
              s.setEnzymeCutSites(sites)
              s.setEnzymeNames(filtered.map(e => e.name))
            }).catch(() => {})
          }
        }
        setTheme(saved.theme || 'light')
        restoredRef.current = true
      } else {
        openDocument('pUC19', demoSequence, 'circular')
        setTimeout(() => {
          const s = useEditorStore.getState()
          s.addAnnotation({ id: 'f1', name: 'lacZ-alpha', type: 'CDS', start: 0, end: 396, strand: 1, color: '#4dabf7' })
          s.addAnnotation({ id: 'f2', name: 'AmpR', type: 'CDS', start: 1629, end: 2489, strand: -1, color: '#ff6b6b' })
          s.addAnnotation({ id: 'f3', name: 'ori', type: 'rep_origin', start: 836, end: 1424, strand: 1, color: '#51cf66' })
          s.addAnnotation({ id: 'f4', name: 'MCS', type: 'misc_feature', start: 396, end: 452, strand: 1, color: '#ffd43b' })
          restoredRef.current = true
        }, 0)
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only: loads session once, openDocument/theme read at call time

  // Auto-save on store changes (only after session restore)
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => {
    const unsub = useEditorStore.subscribe(() => {
      if (restoredRef.current) scheduleSave(themeRef.current)
    })
    return unsub
  }, [])

  // Save when theme changes (only after session restore)
  useEffect(() => {
    if (restoredRef.current) scheduleSave(theme)
  }, [theme])

  // Warn before closing with unsaved data
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const { tabs } = useEditorStore.getState()
      if (tabs.length > 0) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  return { storageRefreshKey }
}
