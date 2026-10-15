import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store'
import {
  loadSession, scheduleSave, onSaveComplete, consumeLoadWarnings,
  markSessionSaved, savedStateChanged, hasUnsavedChanges, flushSave,
} from '../persistence'
import { demoDocument } from '../demo'

/**
 * Handles session restore on mount, auto-save on store/theme changes,
 * and beforeunload warning.
 */
export function useSessionPersistence(
  theme: string,
  setTheme: (t: string) => void,
) {
  const [storageRefreshKey, setStorageRefreshKey] = useState(0)
  /**
   * Problems hit while restoring the last session. Surfaced by App as an error
   * toast: restore silently dropping documents is indistinguishable from
   * "you never saved anything".
   */
  const [sessionLoadWarnings, setSessionLoadWarnings] = useState<string[]>([])
  /** Set once the session is in the store, and whether it came from storage or is the demo. */
  const [restored, setRestored] = useState<{ fromSave: boolean } | null>(null)
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
      const warnings = consumeLoadWarnings()
      if (warnings.length > 0) setSessionLoadWarnings(warnings)
      if (saved && (saved.tabs.length > 0 || saved.sequencingReads.length > 0 || saved.alignments.length > 0 || saved.contigs.length > 0 || saved.readSets.length > 0 || saved.oligos.length > 0 || (saved.guides?.length ?? 0) > 0 || (saved.enzymeSets?.length ?? 0) > 0 || saved.gels.length > 0 || saved.clones.length > 0)) {
        useEditorStore.getState().restoreSession(
          saved.tabs,
          saved.activeTabId,
          saved.folders,
          saved.sequencingReads,
          saved.activeSequencingReadIds,
          saved.alignments,
          saved.contigs,
          saved.activeAlignmentId,
          saved.activeContigId,
          saved.itemMeta,
          saved.tagColors,
          saved.oligos,
          saved.guides,
        )
        useEditorStore.getState().restoreAssemblies(saved.assemblies, saved.activeAssemblyId ?? null)
        useEditorStore.getState().restoreReadSets(saved.readSets, saved.activeReadSetId ?? null)
        useEditorStore.getState().restoreGels(saved.gels, saved.activeGelId ?? null)
        useEditorStore.getState().restoreClones(saved.clones, saved.activeCloneId ?? null)
        useEditorStore.getState().restoreEnzymeSets(saved.enzymeSets ?? [])
        // Restore ORF/enzyme panel params so searches re-run on panel open
        const store = useEditorStore.getState()
        if (saved.orfParams) {
          store.setOrfParams({
            ...(typeof saved.orfParams.minAminoAcids === 'number' ? { orfMinAminoAcids: saved.orfParams.minAminoAcids } : {}),
            orfStartCodons: saved.orfParams.startCodons,
            orfStartsFromCode: saved.orfParams.startsFromCode ?? false,
            orfAllowInterior: saved.orfParams.allowInterior,
            orfIncludePartial: saved.orfParams.includePartial ?? false,
            orfAllStarts: saved.orfParams.allStarts ?? false,
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
        // Nothing to re-run: the ORF finder scans the active tab whenever its
        // ORFs are shown, and each tab keeps its enzyme names for App to find the sites.
        setTheme(saved.theme || 'light')
        // What was just restored is what storage holds: nothing to write back.
        markSessionSaved()
        restoredRef.current = true
        setRestored({ fromSave: true })
      } else {
        // One document, features included: they are not undoable steps.
        useEditorStore.getState().openDocumentState(demoDocument())
        restoredRef.current = true
        setRestored({ fromSave: false })
        // Autosave only reacts to later changes; the demo itself must be saved too.
        scheduleSave(themeRef.current)
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only: loads session once, theme read at call time

  // Auto-save on store changes (only after session restore)
  const themeRef = useRef(theme)
  themeRef.current = theme
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      // Caret moves, hovers and selections change the store too; only
      // changes to saved data are worth a save.
      if (restoredRef.current && savedStateChanged(state, prev)) scheduleSave(themeRef.current)
    })
    return unsub
  }, [])

  // Save when theme changes (only after session restore)
  useEffect(() => {
    if (restoredRef.current) scheduleSave(theme)
  }, [theme])

  // Save at once when the page is hidden or closed, rather than losing a
  // save still waiting on the debounce; warn on close only if something may
  // not have reached storage.
  useEffect(() => {
    const flush = () => { if (restoredRef.current) flushSave(themeRef.current) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flush()
      if (hasUnsavedChanges()) e.preventDefault()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  return { storageRefreshKey, sessionLoadWarnings, restored }
}
