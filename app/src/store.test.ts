import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'

describe('EditorStore', () => {
  beforeEach(() => {
    // Reset store: close all tabs, then open a fresh document
    const state = useEditorStore.getState()
    for (const tab of state.tabs) {
      useEditorStore.getState().closeTab(tab.id)
    }
    useEditorStore.getState().openDocument('pTest', 'ATGCGATCGA')
  })

  it('loads a document', () => {
    const { doc } = useEditorStore.getState()
    expect(doc.name).toBe('pTest')
    expect(doc.sequence.bases).toBe('ATGCGATCGA')
    expect(doc.annotations).toHaveLength(0)
  })

  it('inserts bases', () => {
    useEditorStore.getState().insert(0, 'TTT')
    expect(useEditorStore.getState().doc.sequence.bases).toBe('TTTATGCGATCGA')
  })

  it('deletes bases', () => {
    useEditorStore.getState().delete(0, 3)
    expect(useEditorStore.getState().doc.sequence.bases).toBe('CGATCGA')
  })

  it('replaces bases', () => {
    useEditorStore.getState().replace(0, 3, 'CCC')
    expect(useEditorStore.getState().doc.sequence.bases).toBe('CCCCGATCGA')
  })

  it('undo reverts last action', () => {
    useEditorStore.getState().insert(0, 'TTT')
    expect(useEditorStore.getState().doc.sequence.bases).toBe('TTTATGCGATCGA')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('ATGCGATCGA')
  })

  it('redo re-applies undone action', () => {
    useEditorStore.getState().insert(0, 'TTT')
    useEditorStore.getState().undo()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('TTTATGCGATCGA')
  })

  it('new action clears redo stack', () => {
    useEditorStore.getState().insert(0, 'TTT')
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().canRedo()).toBe(true)

    useEditorStore.getState().insert(0, 'GGG')
    expect(useEditorStore.getState().canRedo()).toBe(false)
  })

  it('canUndo / canRedo', () => {
    expect(useEditorStore.getState().canUndo()).toBe(false)
    expect(useEditorStore.getState().canRedo()).toBe(false)

    useEditorStore.getState().insert(0, 'A')
    expect(useEditorStore.getState().canUndo()).toBe(true)
  })

  it('multiple undo/redo', () => {
    useEditorStore.getState().insert(0, 'A')
    useEditorStore.getState().insert(0, 'B')
    useEditorStore.getState().insert(0, 'C')

    expect(useEditorStore.getState().doc.sequence.bases).toBe('CBAATGCGATCGA')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('BAATGCGATCGA')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('AATGCGATCGA')

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().doc.sequence.bases).toBe('BAATGCGATCGA')
  })

  it('add and remove annotation', () => {
    useEditorStore.getState().addAnnotation({
      id: 'f1', name: 'GFP', type: 'CDS', start: 2, end: 8, strand: 1,
    })
    expect(useEditorStore.getState().doc.annotations).toHaveLength(1)

    useEditorStore.getState().removeAnnotation('f1')
    expect(useEditorStore.getState().doc.annotations).toHaveLength(0)

    // undo removal
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().doc.annotations).toHaveLength(1)
    expect(useEditorStore.getState().doc.annotations[0].name).toBe('GFP')
  })
})
