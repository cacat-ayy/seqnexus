/**
 * What the feature panel does to a feature, shared by its rows, its
 * keyboard and its menus so each action behaves the same from all three.
 */

import { useEditorStore } from '../../store'
import type { Annotation } from '../../models/Annotation'
import { notify } from '../../toast'
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
 * BLAST the feature: select it and ask for a new search on the selection.
 * Not offered for a feature across the origin, which BLAST would read as the
 * rest of the sequence (the selection's query takes one stretch).
 */
export function blastFeature(ann: Annotation): void {
  selectFeature(ann)
  useEditorStore.getState().requestBlastSelection()
}

/** The DOM id of a feature's row, for the list's aria-activedescendant. */
export const rowDomId = (id: string) => `fs-opt-${id}`
