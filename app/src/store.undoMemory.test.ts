/**
 * Undo entries used to copy every annotation, so each typed base in a
 * genome with thousands of features cost thousands of objects (M13). Now an
 * edit that moves no feature leaves the list, and the entries, shared.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { restoreUndo, undoSnapshot } from './models/Document'

const store = () => useEditorStore.getState()
const tab = () => store().tabs.find(t => t.id === store().activeTabId)!

beforeEach(() => {
  for (const t of store().tabs) store().closeTab(t.id)
  store().openDocument('pMem', 'ACGT'.repeat(250))
  store().addAnnotations(Array.from({ length: 50 }, (_, i) => ({
    id: `f${i}`, name: `f${i}`, type: 'misc_feature', start: i * 10, end: i * 10 + 5, strand: 1 as const,
  })))
})

describe('undo history and annotations', () => {
  it('shares one annotation list across edits that move no feature', () => {
    const before = tab().doc.annotations
    store().insert(900, 'A')
    store().insert(901, 'C')
    store().delete(950, 960)
    expect(tab().doc.annotations).toBe(before)
    const stack = tab().undoStack
    expect(stack[stack.length - 1].annotations).toBe(before)
    expect(stack[stack.length - 2].annotations).toBe(before)
  })

  it('keeps unmoved features as the same objects when an edit moves others', () => {
    const before = tab().doc.annotations
    store().insert(205, 'GG') // just after f20 (200..205): f21 onward move
    const after = tab().doc.annotations
    expect(after[0]).toBe(before[0])
    expect(after[20]).toBe(before[20])
    expect(after[21]).not.toBe(before[21])
    expect(after[21].start).toBe(212)
  })

  it('still undoes to the right features', () => {
    store().insert(0, 'TTT')
    expect(tab().doc.annotations[0].start).toBe(3)
    store().undo()
    expect(tab().doc.annotations[0].start).toBe(0)
  })

  it('restores entries that come back from storage as plain data', () => {
    const doc = tab().doc
    const snap = { ...undoSnapshot(doc), annotations: doc.annotations.map(a => a.toData()) }
    const back = restoreUndo(snap, doc.sequence)
    expect(back.annotations[3].start).toBe(30)
    expect(typeof back.annotations[3].with).toBe('function')
  })
})
