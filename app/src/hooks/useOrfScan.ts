/**
 * Keep the ORFs in step with the sequence, whenever the overlay or the ORFs
 * tab wants them, as useMotifScan does for a protein's motifs. A sequence
 * whose ORFs nobody is looking at is not scanned, and a protein never is.
 *
 * Edits rewrite the piece table in place, so the sequence is the same object
 * before and after one: its version is what changes. Typing rescans once the
 * typing stops; anything else (showing them, another sequence, new settings)
 * scans at once.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useEditorStore } from '../store'
import { findORFs, type ORFOptions } from '../workers/orf-finder'

/** The pause after an edit before the sequence is scanned again. */
const EDIT_DELAY_MS = 300

export function useOrfScan(tabOpen: boolean): void {
  const showOrfs = useEditorStore(s => s.showOrfs)
  const sequence = useEditorStore(s => s.doc.sequence)
  const seqVersion = sequence.pieceTable.version
  const seqLen = sequence.length
  const topology = sequence.topology

  const minAminoAcids = useEditorStore(s => s.orfMinAminoAcids)
  const startCodons = useEditorStore(s => s.orfStartCodons)
  const allowInterior = useEditorStore(s => s.orfAllowInterior)
  const includePartial = useEditorStore(s => s.orfIncludePartial)
  // Stops come from the genetic code chosen for translations, so ORFs in a
  // mitochondrial sequence end where its proteins do.
  const geneticCode = useEditorStore(s => s.translationCodeId)
  const options: ORFOptions = useMemo(() => ({
    minAminoAcids,
    maxAminoAcids: 0,
    startCodons,
    allowInterior,
    topology,
    geneticCode,
    includePartial,
  }), [minAminoAcids, startCodons, allowInterior, topology, geneticCode, includePartial])

  const active = (tabOpen || showOrfs) && !sequence.isProtein

  /** What the last scan that started was of. */
  const scanned = useRef<{ sequence: unknown; version: number; options: ORFOptions } | null>(null)
  const wasActive = useRef(false)
  const generation = useRef(0)

  useEffect(() => {
    const becameActive = active && !wasActive.current
    wasActive.current = active
    if (!active) return
    const store = useEditorStore.getState()
    if (seqLen === 0) {
      scanned.current = null
      if (store.orfResults.length > 0) store.setOrfResults([])
      return
    }
    const last = scanned.current
    if (last && last.sequence === sequence && last.version === seqVersion && last.options === options) return
    const scan = () => {
      scanned.current = { sequence, version: seqVersion, options }
      const gen = ++generation.current
      // Results land on the tab that is active when they arrive: one scanned
      // for another sequence is dropped.
      const tabId = useEditorStore.getState().activeTabId
      useEditorStore.getState().setOrfScanning(true)
      findORFs(sequence.bases, options).then(orfs => {
        if (gen !== generation.current) return
        if (useEditorStore.getState().activeTabId !== tabId) {
          // Not kept, so not scanned: going back to that sequence scans it again.
          scanned.current = null
          useEditorStore.getState().setOrfScanning(false)
          return
        }
        const s = useEditorStore.getState()
        s.setOrfResults(orfs)
        s.setOrfScanning(false)
      }).catch(() => {
        if (gen === generation.current) useEditorStore.getState().setOrfScanning(false)
      })
    }
    const edited = !becameActive && last?.sequence === sequence && last.options === options
    if (!edited) { scan(); return }
    const timer = setTimeout(scan, EDIT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [active, sequence, seqVersion, seqLen, options])
}
