/**
 * Undo entries carry a short name for the change they revert, which the Undo
 * and Redo tooltips show. The name has to follow the entry across the stacks:
 * undoing "Add feature" must offer to redo "Add feature".
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, defaultSearchOptions } from './store'

const store = () => useEditorStore.getState()
const tab = () => store().tabs.find(t => t.id === store().activeTabId)!
const undoTop = () => tab().undoStack.at(-1)?.label
const redoTop = () => tab().redoStack.at(-1)?.label

beforeEach(() => {
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('pTest', 'ATGCGATCGAATGCGATCGA')
})

describe('undo labels', () => {
  it('names base edits by their length', () => {
    store().insert(0, 'TTT')
    expect(undoTop()).toBe('Insert 3 bp')
    store().delete(0, 5)
    expect(undoTop()).toBe('Delete 5 bp')
    store().replace(0, 2, 'CC')
    expect(undoTop()).toBe('Replace 2 bp')
  })

  it('names a feature by its name, and several by their count', () => {
    store().addAnnotation({ id: 'f1', name: 'GFP', type: 'CDS', start: 2, end: 8, strand: 1 })
    expect(undoTop()).toBe('Add feature “GFP”')
    store().addAnnotations([
      { id: 'f2', name: 'a', type: 'misc_feature', start: 0, end: 3, strand: 1 },
      { id: 'f3', name: 'b', type: 'misc_feature', start: 4, end: 6, strand: 1 },
    ])
    expect(undoTop()).toBe('Add 2 features')
    store().updateAnnotation('f1', { name: 'mGFP' })
    // The name the user knew it by when they made the change.
    expect(undoTop()).toBe('Edit feature “GFP”')
    store().removeAnnotations(['f2', 'f3'])
    expect(undoTop()).toBe('Delete 2 features')
  })

  it('moves the label to the redo stack and back', () => {
    store().addAnnotation({ id: 'f1', name: 'GFP', type: 'CDS', start: 2, end: 8, strand: 1 })
    store().undo()
    expect(undoTop()).toBeUndefined()
    expect(redoTop()).toBe('Add feature “GFP”')
    store().redo()
    expect(undoTop()).toBe('Add feature “GFP”')
    expect(redoTop()).toBeUndefined()
  })

  it('labels a match replacement', () => {
    store().setSearch('ATG', { ...defaultSearchOptions, revComplement: false })
    store().replaceAllMatches('CCC')
    expect(undoTop()).toBe('Replace 2 matches')
  })
})
