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
 * Keyed on the sequence's edit counter, which every change to the bases bumps
 * (typing, a paste, a replace, moving the origin, undo), not on its length: a
 * replace of the same length or a new origin leaves the length alone and
 * every proposal pointing at the wrong bases. An edit that only touched the
 * features bumps nothing, and an undo that restores the same bases is caught
 * by comparing them with the ones last scanned.
 *
 * A protein is scanned against the protein library instead of the DNA
 * databases: its short peptides exactly, its long entries at the threshold.
 */
export function useAutoAnnotateScan(modalOpen: boolean): void {
  const showAutoAnnotations = useEditorStore(s => s.showAutoAnnotations)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const seqLength = useEditorStore(s => s.doc.sequence.length)
  const sequenceObj = useEditorStore(s => s.doc.sequence)
  const basesVersion = useEditorStore(s => s.doc.sequence.pieceTable.version)
  const circular = useEditorStore(s => s.doc.sequence.topology === 'circular')
  const protein = useEditorStore(s => s.doc.sequence.alphabet === 'protein')
  const minSimilarity = useEditorStore(s => s.autoAnnotateMinSimilarity)
  const featureSources = useEditorStore(s => s.featureSources)
  const loadFeatureSources = useEditorStore(s => s.loadFeatureSources)

  const sourcesKey = enabledSourcesSignature(featureSources)
  const wanted = showAutoAnnotations || modalOpen
  const generation = useRef(0)
  /** What the results on screen were computed from, to skip a scan that would repeat it. */
  const lastScan = useRef<{ tabId: string | null; bases: string; settings: string } | null>(null)

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
      lastScan.current = null
      store.setAutoAnnotations([])
      return
    }

    const bases = store.doc.sequence.bases
    // An undo that put back the same bases, or a feature edit, needs no scan.
    const settings = `${protein}|${circular}|${minSimilarity}|${sourcesKey}`
    const last = lastScan.current
    if (last && last.tabId === activeTabId && last.settings === settings && last.bases === bases) return

    const gen = ++generation.current
    store.setAutoAnnotateScanning(true)
    lastScan.current = null

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
      scan = annotateFromList(bases, references, minSimilarity, true, false, circular)
    }

    scan
      .then(matches => {
        if (gen !== generation.current) return
        const s = useEditorStore.getState()
        s.setAutoAnnotations(matches)
        s.setAutoAnnotateScanning(false)
        lastScan.current = { tabId: activeTabId, bases, settings }
      })
      .catch(() => {
        if (gen !== generation.current) return
        const s = useEditorStore.getState()
        s.setAutoAnnotations([])
        s.setAutoAnnotateScanning(false)
      })
  }, [wanted, activeTabId, seqLength, sequenceObj, basesVersion, circular, protein, minSimilarity, sourcesKey])
}
