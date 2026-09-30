/**
 * Primers on the document: each change is one undo entry, and because a
 * primer stores no coordinates, base edits leave it alone.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { snapshot, restore } from './models/Document'
import { reverseComplement } from './models/complement'
import type { PrimerData } from './primers/oligo'

const store = () => useEditorStore.getState()

const BASES = 'GATTACACGTTGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG'

const fwd: PrimerData = { id: 'o1', name: 'Fwd', sequence: 'GAATTC' + BASES.slice(0, 18), role: 'primer' }
const rev: PrimerData = { id: 'o2', name: 'Rev', sequence: reverseComplement(BASES.slice(40, 60)), role: 'primer' }

describe('primer actions', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pPrimer', BASES)
  })

  it('adds several primers as one undo entry', () => {
    store().addPrimers([fwd, rev])
    expect(store().doc.primers?.map(p => p.name)).toEqual(['Fwd', 'Rev'])
    store().undo()
    expect(store().doc.primers ?? []).toEqual([])
    store().redo()
    expect(store().doc.primers).toHaveLength(2)
  })

  it('renames and removes, each undoable', () => {
    store().addPrimers([fwd, rev])
    store().updatePrimer('o1', { name: 'EcoRI-fwd' })
    expect(store().doc.primers?.[0].name).toBe('EcoRI-fwd')
    store().removePrimers(['o2'])
    expect(store().doc.primers?.map(p => p.id)).toEqual(['o1'])
    store().undo()
    store().undo()
    expect(store().doc.primers?.map(p => p.name)).toEqual(['Fwd', 'Rev'])
  })

  it('spends no undo entry on a no-op', () => {
    store().addPrimers([fwd])
    const depth = store().tabs[0].undoStack.length
    store().removePrimers(['nope'])
    store().updatePrimer('nope', { name: 'x' })
    expect(store().tabs[0].undoStack.length).toBe(depth)
  })

  it('keeps primers through a base edit, since they store no position', () => {
    store().addPrimers([fwd])
    store().insert(5, 'CCCC')
    expect(store().doc.primers).toEqual([fwd])
  })

  it('converts primer_bind features, keeping a recorded tail', () => {
    store().addAnnotations([
      {
        id: 'a1', name: 'Old fwd', type: 'primer_bind', start: 0, end: 18, strand: 1,
        qualifiers: { sequence: ['GAATTC' + BASES.slice(0, 18)] },
      },
      { id: 'a2', name: 'Old rev', type: 'primer_bind', start: 40, end: 60, strand: -1 },
      { id: 'a3', name: 'Promoter', type: 'promoter', start: 20, end: 30, strand: 1 },
    ])
    const depth = store().tabs[0].undoStack.length
    expect(store().convertFeaturesToPrimers(['a1', 'a2', 'a3'])).toBe(2)
    expect(store().tabs[0].undoStack.length).toBe(depth + 1)
    expect(store().doc.annotations.map(a => a.id)).toEqual(['a3'])
    expect(store().doc.primers?.map(p => [p.name, p.sequence])).toEqual([
      ['Old fwd', 'GAATTC' + BASES.slice(0, 18)],
      ['Old rev', reverseComplement(BASES.slice(40, 60))],
    ])
  })

  it('keeps the design session per tab', () => {
    const first = store().activeTabId!
    store().setDesignPicks({ forward: 'ACGTACGTACGTACGTAC' })
    const second = store().openDocument('pOther', BASES)
    expect(store().primerDesign.picks.forward).toBeNull()
    store().setActiveTab(first)
    expect(store().primerDesign.picks.forward).toBe('ACGTACGTACGTACGTAC')
    store().setActiveTab(second)
    expect(store().primerDesign.picks.forward).toBeNull()
  })

  it('survives a snapshot round trip', () => {
    store().addPrimers([fwd, rev])
    expect(restore(snapshot(store().doc)).primers).toEqual([fwd, rev])
  })
})
