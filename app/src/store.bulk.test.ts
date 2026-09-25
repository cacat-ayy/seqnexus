/**
 * Batch mutation and undo-coalescing behaviour.
 *
 * The invariant these lock down is "one user action produces exactly one undo
 * entry". Before the transact() layer, a bulk delete of N features pushed N
 * full-document snapshots, and a single drag of a group colour picker pushed
 * one per frame — enough to evict the user's real history past MAX_UNDO.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import type { AnnotationData } from './models/Annotation'

const store = () => useEditorStore.getState()

/** Undo stack depth for the active tab. */
function undoDepth(): number {
  const s = store()
  return s.tabs.find(t => t.id === s.activeTabId)!.undoStack.length
}

function feature(i: number): AnnotationData {
  return {
    id: `f${i}`,
    name: `feature ${i}`,
    type: i % 2 === 0 ? 'CDS' : 'promoter',
    start: i * 3,
    end: i * 3 + 3,
    strand: 1,
    color: '#111111',
  }
}

function seedFeatures(n: number) {
  store().addAnnotations(Array.from({ length: n }, (_, i) => feature(i)))
}

describe('batch annotation mutations', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pBulk', 'ATGC'.repeat(100))
  })

  it('adds many annotations as one undo entry', () => {
    const before = undoDepth()
    seedFeatures(20)
    expect(store().doc.annotations).toHaveLength(20)
    expect(undoDepth()).toBe(before + 1)
  })

  it('deletes many annotations as one undo entry, and one undo restores them all', () => {
    seedFeatures(20)
    const afterSeed = undoDepth()

    store().removeAnnotations(store().doc.annotations.slice(0, 15).map(a => a.id))
    expect(store().doc.annotations).toHaveLength(5)
    expect(undoDepth()).toBe(afterSeed + 1)

    store().undo()
    expect(store().doc.annotations).toHaveLength(20)
  })

  it('patches many annotations as one undo entry', () => {
    seedFeatures(10)
    const afterSeed = undoDepth()

    store().updateAnnotations(store().doc.annotations.map(a => a.id), { color: '#ff0000' })
    expect(store().doc.annotations.every(a => a.color === '#ff0000')).toBe(true)
    expect(undoDepth()).toBe(afterSeed + 1)
  })

  it('does not consume an undo entry for a no-op', () => {
    seedFeatures(5)
    const afterSeed = undoDepth()

    store().removeAnnotations([])
    store().removeAnnotations(['does-not-exist'])
    store().updateAnnotations([], { color: '#ff0000' })

    expect(undoDepth()).toBe(afterSeed)
    expect(store().doc.annotations).toHaveLength(5)
  })

  it('leaves the document untouched when the tab is read-only', () => {
    seedFeatures(5)
    store().toggleReadOnly()
    const afterSeed = undoDepth()

    store().removeAnnotations(['f0', 'f1'])
    expect(store().doc.annotations).toHaveLength(5)
    expect(undoDepth()).toBe(afterSeed)

    store().toggleReadOnly()
  })
})

describe('undo coalescing', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pBulk', 'ATGC'.repeat(100))
    seedFeatures(30)
  })

  const ids = () => store().doc.annotations.map(a => a.id)

  it('collapses a whole drag into one undo entry', () => {
    const before = undoDepth()
    // Stand-in for a colour picker dragged across 40 frames.
    for (let frame = 0; frame < 40; frame++) {
      const color = `#0000${frame.toString(16).padStart(2, '0')}`
      store().updateAnnotations(ids(), { color }, { coalesceKey: 'drag-1' })
    }
    expect(undoDepth()).toBe(before + 1)
    expect(store().doc.annotations[0].color).toBe('#000027')
  })

  it('restores the pre-drag colour with a single undo', () => {
    store().updateAnnotations(ids(), { color: '#abcdef' }, { coalesceKey: 'drag-1' })
    store().updateAnnotations(ids(), { color: '#123456' }, { coalesceKey: 'drag-1' })

    store().undo()
    expect(store().doc.annotations.every(a => a.color === '#111111')).toBe(true)
  })

  it('keeps two separate drags separately undoable', () => {
    const before = undoDepth()
    store().updateAnnotations(ids(), { color: '#aaaaaa' }, { coalesceKey: 'drag-1' })
    store().updateAnnotations(ids(), { color: '#bbbbbb' }, { coalesceKey: 'drag-2' })
    expect(undoDepth()).toBe(before + 2)

    store().undo()
    expect(store().doc.annotations.every(a => a.color === '#aaaaaa')).toBe(true)
  })

  it('an uncoalesced mutation between frames ends the run', () => {
    const before = undoDepth()
    store().updateAnnotations(ids(), { color: '#aaaaaa' }, { coalesceKey: 'drag-1' })
    store().removeAnnotation('f0')                                  // no key
    store().updateAnnotations(ids(), { color: '#cccccc' }, { coalesceKey: 'drag-1' })
    // drag frame, delete, then a *new* run under the same key: three entries.
    expect(undoDepth()).toBe(before + 3)
  })

  it('does not fold a drag into an entry the user has undone past', () => {
    store().updateAnnotations(ids(), { color: '#aaaaaa' }, { coalesceKey: 'drag-1' })
    store().undo()
    const afterUndo = undoDepth()

    store().updateAnnotations(ids(), { color: '#bbbbbb' }, { coalesceKey: 'drag-1' })
    expect(undoDepth()).toBe(afterUndo + 1)

    store().undo()
    expect(store().doc.annotations.every(a => a.color === '#111111')).toBe(true)
  })
})

describe('setAnnotationsVisibility', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pBulk', 'ATGC'.repeat(100))
    seedFeatures(10)
  })

  it('hides and shows an arbitrary set', () => {
    store().setAnnotationsVisibility(['f1', 'f3', 'f5'], true)
    expect([...store().hiddenAnnotationIds].sort()).toEqual(['f1', 'f3', 'f5'])

    store().setAnnotationsVisibility(['f3'], false)
    expect([...store().hiddenAnnotationIds].sort()).toEqual(['f1', 'f5'])
  })

  it('does not duplicate ids that are already hidden', () => {
    store().setAnnotationsVisibility(['f1', 'f2'], true)
    store().setAnnotationsVisibility(['f2', 'f3'], true)
    expect([...store().hiddenAnnotationIds].sort()).toEqual(['f1', 'f2', 'f3'])
  })

  it('is not undoable — visibility is view state, not document state', () => {
    const before = undoDepth()
    store().setAnnotationsVisibility(['f1', 'f2'], true)
    expect(undoDepth()).toBe(before)
  })
})
