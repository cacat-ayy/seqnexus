/**
 * Per-kind dispatch, in one place.
 *
 * Rename, delete, open and duplicate were each written out five times in the
 * old explorer, once per section, which is how the five delete confirmations
 * ended up with four different wordings and only one of them offered an undo.
 * Rows call these and never branch on kind.
 */

import { useCallback, useMemo } from 'react'
import { useEditorStore } from '../store'
import { notify } from '../toast'
import type { ExplorerItem, ItemKind } from './types'
import { KIND_LABEL } from './kinds'

export interface ItemActions {
  /** Show it in the centre panel. */
  open: (item: ExplorerItem) => void
  /** Reads only: add or remove from the multi-trace view. */
  toggleInMultiView: (item: ExplorerItem) => void
  rename: (item: ExplorerItem, name: string) => void
  /**
   * Delete it and offer an undo. No confirmation: every kind now lands in the
   * delete buffer, so the toast is the safety net and a modal on every single
   * delete was noise. Bulk deletes still confirm.
   */
  remove: (item: ExplorerItem) => void
  /** Delete without the toast, for callers that report on the batch instead. */
  removeQuiet: (item: ExplorerItem) => void
  duplicate: (item: ExplorerItem) => void
  toggleStar: (uid: string) => void
}

export function useItemActions(): ItemActions {
  const open = useCallback((item: ExplorerItem) => {
    const s = useEditorStore.getState()
    switch (item.kind) {
      case 'sequence': return s.setActiveTab(item.id)
      case 'read': return s.setActiveSequencingRead(item.id)
      case 'alignment': return s.setActiveAlignment(item.id)
      case 'read-alignment': return s.setActiveReadAlignment(item.id)
      case 'contig': return s.setActiveContig(item.id)
      case 'gel': return s.setActiveGel(item.id)
      // An oligo has no view of its own; opening it shows where it binds.
      case 'oligo': {
        const o = s.oligos.find(x => x.id === item.id)
        if (o) s.requestCheck(o.sequence, o.role)
        return
      }
    }
  }, [])

  const toggleInMultiView = useCallback((item: ExplorerItem) => {
    if (item.kind !== 'read') return
    useEditorStore.getState().toggleSequencingRead(item.id)
  }, [])

  const rename = useCallback((item: ExplorerItem, name: string) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === item.name) return
    const s = useEditorStore.getState()
    switch (item.kind) {
      case 'sequence': return s.renameTab(item.id, trimmed)
      case 'read': return s.renameSequencingRead(item.id, trimmed)
      case 'alignment': return s.renameAlignment(item.id, trimmed)
      case 'read-alignment': return s.renameReadAlignment(item.id, trimmed)
      case 'contig': return s.renameContig(item.id, trimmed)
      case 'gel': return s.renameGel(item.id, trimmed)
      case 'oligo': return s.updateLibraryOligo(item.id, { name: trimmed })
    }
  }, [])

  const removeQuiet = useCallback((item: ExplorerItem) => {
    const s = useEditorStore.getState()
    switch (item.kind) {
      case 'sequence': return s.closeTab(item.id)
      case 'read': return s.removeSequencingRead(item.id)
      case 'alignment': return s.removeAlignment(item.id)
      case 'read-alignment': return s.removeReadAlignment(item.id)
      case 'contig': return s.removeContig(item.id)
      case 'gel': return s.removeGel(item.id)
      case 'oligo': return s.removeLibraryOligo(item.id)
    }
  }, [])

  const remove = useCallback((item: ExplorerItem) => {
    removeQuiet(item)
    notify.success(`Deleted "${item.name}"`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undoDelete() },
    })
  }, [removeQuiet])

  const duplicate = useCallback((item: ExplorerItem) => {
    if (!item.canDuplicate) return
    const s = useEditorStore.getState()
    if (item.kind === 'gel') s.duplicateGel(item.id)
    else s.duplicateTab(item.id)
  }, [])

  const toggleStar = useCallback((uid: string) => {
    useEditorStore.getState().toggleItemStar(uid)
  }, [])

  return useMemo(
    () => ({ open, toggleInMultiView, rename, remove, removeQuiet, duplicate, toggleStar }),
    [open, toggleInMultiView, rename, remove, removeQuiet, duplicate, toggleStar],
  )
}

/** "Sequence", "Read alignment": for dialog titles and toasts. */
export function kindLabel(kind: ItemKind): string {
  return KIND_LABEL[kind]
}
