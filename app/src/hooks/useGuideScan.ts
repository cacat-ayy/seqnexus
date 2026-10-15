/**
 * Keep the guide scan in step with the document and the settings.
 *
 * The scan runs when the overlay is on or the panel is open, and it runs in a
 * worker, so it is driven by an effect rather than computed in a memo the way
 * the motif scan is: the sites arrive after the render that asked for them.
 * Only the newest request is kept, since the panel shows one scan.
 *
 * A protein has no PAM to find, and a sequence with no bases has nothing to
 * scan, so both clear the results instead of running.
 */

import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store'
import { scanGuidesAsync, cancelGuideScan } from '../workers/crispr'
import { resolveNuclease } from '../crispr/nucleases'
import type { GuideScanOptions } from '../crispr/finder'

export function useGuideScan(panelOpen: boolean): void {
  const showGuides = useEditorStore(s => s.showGuides)
  const activeTabId = useEditorStore(s => s.activeTabId)
  const isDna = useEditorStore(s => s.doc.sequence.alphabet !== 'protein')
  const bases = useEditorStore(s => (isDna ? s.doc.sequence.bases : ''))
  const topology = useEditorStore(s => s.doc.sequence.topology)
  const nucleaseId = useEditorStore(s => s.crisprNucleaseId)
  const spacerLength = useEditorStore(s => s.crisprSpacerLength)
  // "Selection only": the range taken from a selection on this tab.
  const range = useEditorStore(s => (s.crisprRange && s.crisprRange.tabId === s.activeTabId ? s.crisprRange : null))
  const customNucleases = useEditorStore(s => s.customNucleases)

  const wanted = (showGuides || panelOpen) && isDna && bases.length > 0
  // Cut to the sequence as it is now: edits since it was taken may have shortened it.
  const region = range ? { start: Math.min(range.start, bases.length), end: Math.min(range.end, bases.length) } : null
  const regionKey = region ? `${region.start}:${region.end}` : ''
  const requestId = useRef(0)

  useEffect(() => {
    const store = useEditorStore.getState()
    const nuclease = resolveNuclease(nucleaseId, customNucleases)
    if (!wanted || !nuclease) {
      cancelGuideScan()
      if (store.guideResults.length > 0 || store.guideScanInfo.running) store.clearGuides()
      return
    }

    const id = ++requestId.current
    store.setGuideScanRunning(true)
    const options: GuideScanOptions = {
      ...(spacerLength > 0 ? { spacerLength } : {}),
      ...(region ? { region } : {}),
    }
    scanGuidesAsync({ bases, nuclease, topology, options, promoter: nuclease.promoter })
      .then(res => {
        // A later scan has started, so this answer is about an older question.
        if (id !== requestId.current) return
        useEditorStore.getState().setGuideResults(res.candidates, {
          truncated: res.truncated,
          skippedAmbiguous: res.skippedAmbiguous,
        })
      })
      .catch(() => {
        if (id !== requestId.current) return
        useEditorStore.getState().setGuideResults([], { truncated: false, skippedAmbiguous: 0 })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, activeTabId, bases, topology, nucleaseId, spacerLength, regionKey, customNucleases])
}
