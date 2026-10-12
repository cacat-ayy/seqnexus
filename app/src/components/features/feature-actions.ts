/**
 * What the feature panel does to a feature, shared by its rows, its
 * keyboard and its menus so each action behaves the same from all three.
 */

import { useEditorStore } from '../../store'
import type { Annotation } from '../../models/Annotation'
import { notify } from '../../toast'
import { prepareSelectionSearch, prepareTranslationSearch } from '../../blast/session'
import { fingerprint, queryBases } from '../../blast/query'
import { annotationProtein, codonStartOffset } from '../../utils/annotation-sequence'
import { centerSequenceViewOn, zoomSequenceViewTo } from '../sequence-view-controls'

/** Select a feature's span and scroll the sequence to it. */
export function selectFeature(ann: Pick<Annotation, 'start' | 'end'>): void {
  const store = useEditorStore.getState()
  store.smoothScrollRequested = true
  store.setSelection({ anchor: ann.start, caret: ann.end })
}

/**
 * Select a feature and centre it in the sequence view, for the deliberate
 * ways of picking one (a double-click, the menu's Select). A plain click
 * only brings it into view, so running down the list does not keep moving
 * the sequence under the eye.
 */
export function selectAndCenterFeature(ann: Pick<Annotation, 'start' | 'end'>): void {
  selectFeature(ann)
  centerSequenceViewOn(ann.start, ann.end)
}

/**
 * Delete features, with Undo on the toast as the bulk delete has.
 *
 * Undo is per document, so the toast's Undo does nothing once the user has
 * moved to another tab: it would pop that sequence's history instead.
 */
export function deleteFeaturesWithUndo(anns: readonly Annotation[]): void {
  if (anns.length === 0) return
  const store = useEditorStore.getState()
  const tabId = store.activeTabId
  if (anns.length === 1) store.removeAnnotation(anns[0].id)
  else store.removeAnnotations(anns.map(a => a.id))
  const what = anns.length === 1 ? `"${anns[0].name}"` : `${anns.length} features`
  notify.success(`Deleted ${what}`, {
    action: {
      label: 'Undo',
      onClick: () => {
        const s = useEditorStore.getState()
        if (s.activeTabId === tabId) s.undo()
      },
    },
  })
}

/** A copy of the feature beside it, named as a copy; returns the new id. */
export function duplicateFeature(ann: Annotation): string {
  const id = `ann_${Date.now()}`
  useEditorStore.getState().addAnnotation({ ...ann.toData(), id, name: `${ann.name} copy` })
  return id
}

/** Select the feature and zoom the sequence view in on it. */
export function zoomToFeature(ann: Annotation): void {
  selectFeature(ann)
  if (!zoomSequenceViewTo(ann.start, ann.end)) {
    notify.info('Zoom works in the sequence view: switch to it or the split view')
  }
}

/**
 * BLAST the feature: select it and open the BLAST drawer ready to search the
 * selection. A feature across the origin selects across it, and the query
 * joins the two stretches in reading order.
 */
export function blastFeature(ann: Annotation): void {
  selectFeature(ann)
  const tabId = useEditorStore.getState().activeTabId
  if (tabId) prepareSelectionSearch(tabId)
}

/**
 * BLAST a coding feature's protein: translate it as the feature reads (its
 * exons, strand, /codon_start and /transl_table) and open the BLAST drawer
 * ready to send it to blastp. The search keeps the coding parts, so its hits
 * can be mapped back onto their codons.
 */
export function blastFeatureProtein(ann: Annotation): void {
  const state = useEditorStore.getState()
  const tabId = state.activeTabId
  if (!tabId) return
  const seq = state.doc.sequence
  const L = seq.length
  // A trailing stop ends the protein; an internal one is sent as an unknown
  // residue, which BLAST scores like any mismatch.
  const protein = annotationProtein(ann, seq).replace(/\*+$/, '').replace(/\*/g, 'X')
  if (protein.length < 10) {
    notify.info(`${ann.name} is too short to BLAST as a protein`, { detail: 'A query needs at least 10 residues.' })
    return
  }
  const strand: 1 | -1 = ann.strand === -1 ? -1 : 1
  const segments: [number, number][] = ann.segments
    ? ann.segments.map(([s, e]) => [s, e])
    : ann.start > ann.end ? [[ann.start, L], [0, ann.end]] : [[ann.start, ann.end]]
  // /codon_start skips bases at the coding start: the first base on the plus
  // strand, the last on the minus strand, where the coding sequence begins.
  const skip = codonStartOffset(ann)
  if (skip) {
    if (strand > 0) segments[0] = [segments[0][0] + skip, segments[0][1]]
    else segments[segments.length - 1] = [segments[segments.length - 1][0], segments[segments.length - 1][1] - skip]
  }
  const label = `${ann.name} protein`
  prepareTranslationSearch(tabId, {
    label,
    protein,
    query: {
      label,
      segments,
      translation: { strand, protein },
      seqLength: L,
      fingerprint: fingerprint(queryBases(seq, segments)),
    },
  })
}

/** The DOM id of a feature's row, for the list's aria-activedescendant. */
export const rowDomId = (id: string) => `fs-opt-${id}`
