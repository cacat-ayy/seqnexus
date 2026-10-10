import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, gelSourceTabId } from '../store'

const store = () => useEditorStore.getState()

describe('gelSourceTabId', () => {
  it('is the sequence in view', () => {
    expect(gelSourceTabId({ activeTabId: 'a', activeGelId: null, gelReturnTabId: 'b' })).toBe('a')
  })

  it('is the tab a gel was entered from while that gel is open', () => {
    expect(gelSourceTabId({ activeTabId: null, activeGelId: 'g', gelReturnTabId: 'b' })).toBe('b')
  })

  it('is nothing in another view, however long ago a gel was visited', () => {
    expect(gelSourceTabId({ activeTabId: null, activeGelId: null, gelReturnTabId: 'b' })).toBeNull()
  })
})

describe('createGel from another view', () => {
  beforeEach(() => {
    useEditorStore.setState({ gels: [], activeGelId: null, gelReturnTabId: null })
  })

  it('makes a blank gel rather than one from the sequence left behind', () => {
    const tabId = store().openDocument('pUC19', 'ATGC'.repeat(50), 'circular')
    store().createGel()
    // Leave the gel for another view: no sequence tab, no gel.
    useEditorStore.setState({ activeGelId: null, activeTabId: null })
    const id = store().createGel({ activate: false })
    const gel = store().gels.find(g => g.id === id)!
    const usesPuc = gel.state.lanes.some(l => l.sample.kind === 'sequence' && l.sample.sourceId === tabId)
    expect(usesPuc).toBe(false)
    expect(gel.name).not.toContain('pUC19')
  })
})
