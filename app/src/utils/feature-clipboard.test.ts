import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from '../store'
import { fragmentDocument, fragmentFor, fragmentOf, placeFragment, rememberFragment } from './feature-clipboard'
import { parseGenBank, writeGenBank } from '../io/genbank'

const store = () => useEditorStore.getState()
const BASES = 'GATTACACGTTGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG'

describe('copy and paste with features', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    rememberFragment(null)
    store().openDocument('source', BASES)
    store().addAnnotations([
      { id: 'in', name: 'inside', type: 'misc_feature', start: 12, end: 20, strand: 1, color: '#123456' },
      { id: 'cut', name: 'cut by the edge', type: 'misc_feature', start: 5, end: 15, strand: 1 },
      { id: 'exons', name: 'exons', type: 'CDS', start: 11, end: 30, strand: -1, segments: [[11, 15], [25, 30]] },
    ])
    store().addPrimers([{ id: 'p', name: 'inner', sequence: BASES.slice(16, 34), role: 'primer' }])
  })

  it('remembers what lies wholly inside the copied stretch, counted from its start', () => {
    const f = fragmentOf(store().doc, 10, 40)
    expect(f.bases).toBe(BASES.slice(10, 40))
    expect(f.annotations.map(a => [a.name, a.start, a.end, a.segments])).toEqual([
      ['inside', 2, 10, undefined],
      ['exons', 1, 20, [[1, 5], [15, 20]]],
    ])
    expect(f.primers.map(p => p.name)).toEqual(['inner'])
  })

  it('pastes the bases with their features into another sequence, as one undo step', () => {
    rememberFragment(fragmentOf(store().doc, 10, 40))
    store().openDocument('target', 'AAAAAAAAAA')
    const fragment = fragmentFor(BASES.slice(10, 40).toLowerCase())!
    const placed = placeFragment(fragment, 5, store().doc.primers ?? [])
    store().pasteWithFeatures(5, 5, fragment.bases, placed.annotations, placed.primers)
    expect(store().doc.sequence.bases).toBe('AAAAA' + BASES.slice(10, 40) + 'AAAAA')
    const inside = store().doc.annotations.find(a => a.name === 'inside')!
    expect([inside.start, inside.end, inside.color]).toEqual([7, 15, '#123456'])
    expect(store().doc.annotations.find(a => a.name === 'exons')?.segments).toEqual([[6, 10], [20, 25]])
    expect(store().doc.primers?.map(p => p.name)).toEqual(['inner'])
    store().undo()
    expect(store().doc.sequence.bases).toBe('AAAAAAAAAA')
    expect(store().doc.annotations).toHaveLength(0)
  })

  it('pastes other text as bases only', () => {
    rememberFragment(fragmentOf(store().doc, 10, 40))
    expect(fragmentFor('ACGT')).toBeNull()
  })

  it('copies a selection as GenBank with its features', () => {
    const text = writeGenBank(fragmentDocument(fragmentOf(store().doc, 10, 40), 'source_11-40', 'dna'))
    const back = parseGenBank(text)
    expect(back.sequence.bases).toBe(BASES.slice(10, 40))
    expect(back.annotations.map(a => a.name)).toEqual(['inside', 'exons'])
    expect(back.primers?.map(p => p.name)).toEqual(['inner'])
  })
})
