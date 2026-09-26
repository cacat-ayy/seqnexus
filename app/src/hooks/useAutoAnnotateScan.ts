import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store'
import { annotateFromList } from '../workers/annotate-list'
import { getScanReferences, enabledSourcesSignature } from '../features/feature-sources'

/**
 * Keep the auto-annotation proposals in step with what they are derived from.
 *
 * The scan used to live inside the Annotate modal, which was fine when the
 * results only ever appeared in that modal's list. Now the overlay can be
 * switched on from the panel bar without the modal ever opening, so the scan
 * has to belong to the app instead — it runs whenever either of them wants
 * results, and re-runs when anything the results depend on changes:
 * the document, the similarity threshold, or which databases are enabled.
 *
 * Keyed on sequence *length* rather than its bases: a scan per keystroke would
 * be wasted work, and a length change is the cheap signal that the coordinates
 * the proposals carry are no longer trustworthy.
 */
export function useAutoAnnotateScan(modalOpen: boolean): void {
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const seqLength = useEditorStore(s => s.doc.sequence.length)
  const minSimilarity = useEditorStore(s => s.autoAnnotateMinSimilarity)
  const featureSources = useEditorStore(s => s.featureSources)
  const loadFeatureSources = useEditorStore(s => s.loadFeatureSources)

  const sourcesKey = enabledSourcesSignature(featureSources)
  const wanted = showAutoAnnotations || modalOpen
  const generation = useRef(0)

  // Imported databases live in IndexedDB; pull them in once per session.
  const loadedRef = useRef(false)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    void loadFeatureSources()
  }, [loadFeatureSources])

  useEffect(() => {
    if (!wanted) return
    const store = useEditorStore.getState()
    if (seqLength === 0) {
      store.setAutoAnnotations([])
      return
    }

    const gen = ++generation.current
    store.setAutoAnnotateScanning(true)
    const { references } = getScanReferences(useEditorStore.getState().featureSources)
    if (references.length === 0) {
      store.setAutoAnnotations([])
      store.setAutoAnnotateScanning(false)
      return
    }

    annotateFromList(store.doc.sequence.bases, references, minSimilarity, true)
      .then(matches => {
        if (gen !== generation.current) return
        const s = useEditorStore.getState()
        s.setAutoAnnotations(matches)
        s.setAutoAnnotateScanning(false)
      })
      .catch(() => {
        if (gen !== generation.current) return
        const s = useEditorStore.getState()
        s.setAutoAnnotations([])
        s.setAutoAnnotateScanning(false)
      })
  }, [wanted, activeTabId, seqLength, minSimilarity, sourcesKey])
}
