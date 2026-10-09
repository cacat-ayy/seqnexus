import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store'
import { annotateFromList, type AnnotationMatch } from '../workers/annotate-list'
import { getScanReferences, enabledSourcesSignature } from '../features/feature-sources'
import { getProteinFeatures, EXACT_BELOW } from '../features/protein-features'

/**
 * Keep the auto-annotation proposals in step with what they are derived from.
 *
 * The scan used to live inside the Annotate modal, which was fine when the
 * results only ever appeared in that modal's list. Now the overlay can be
 * switched on from the panel bar without the modal ever opening, so the scan
 * has to belong to the app instead: it runs whenever either of them wants
 * results, and re-runs when anything the results depend on changes:
 * the document, the similarity threshold, or which databases are enabled.
 *
 * Keyed on sequence *length* rather than its bases: a scan per keystroke would
 * be wasted work, and a length change is the cheap signal that the coordinates
 * the proposals carry are no longer trustworthy.
 *
 * A protein is scanned against the protein library instead of the DNA
 * databases: its short peptides exactly, its long entries at the threshold.
 */
export function useAutoAnnotateScan(modalOpen: boolean): void {
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const seqLength = useEditorStore(s => s.doc.sequence.length)
  const protein = useEditorStore(s => s.doc.sequence.alphabet === 'protein')
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
    const bases = store.doc.sequence.bases

    let scan: Promise<AnnotationMatch[]>
    if (protein) {
      const refs = getProteinFeatures()
      const short = refs.filter(r => r.sequence.length < EXACT_BELOW)
      const long = refs.filter(r => r.sequence.length >= EXACT_BELOW)
      scan = Promise.all([
        annotateFromList(bases, short, 100, true, true),
        annotateFromList(bases, long, minSimilarity, true, true),
      ]).then(([a, b]) => [...a, ...b].sort((x, y) => x.start - y.start))
    } else {
      const { references } = getScanReferences(useEditorStore.getState().featureSources)
      if (references.length === 0) {
        store.setAutoAnnotations([])
        store.setAutoAnnotateScanning(false)
        return
      }
      scan = annotateFromList(bases, references, minSimilarity, true)
    }

    scan
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
  }, [wanted, activeTabId, seqLength, protein, minSimilarity, sourcesKey])
}
