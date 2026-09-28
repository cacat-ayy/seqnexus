import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore, MAX_RECENTLY_CLOSED } from './store'

const store = () => useEditorStore.getState()

/**
 * Closing a tab discards the sequence outright, which is why the delete paths
 * offer an Undo. These cover the buffer behind it.
 */
describe('reopening a closed sequence', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useEditorStore.setState({ recentlyClosedTabs: [] })
  })

  it('remembers a closed tab and puts it back', () => {
    const id = store().openDocument('pTest', 'ATGC')

    store().closeTab(id)
    expect(store().tabs).toHaveLength(0)
    expect(store().recentlyClosedTabs).toHaveLength(1)

    store().reopenClosedTab()
    expect(store().tabs).toHaveLength(1)
    expect(store().tabs[0].doc.name).toBe('pTest')
    expect(store().tabs[0].doc.sequence.bases).toBe('ATGC')
    expect(store().recentlyClosedTabs).toHaveLength(0)
  })

  it('restores it at its original position, not on the end', () => {
    store().openDocument('first', 'AAAA')
    const middle = store().openDocument('middle', 'CCCC')
    store().openDocument('last', 'GGGG')

    store().closeTab(middle)
    expect(store().tabs.map(t => t.doc.name)).toEqual(['first', 'last'])

    store().reopenClosedTab()
    expect(store().tabs.map(t => t.doc.name)).toEqual(['first', 'middle', 'last'])
  })

  it('restores folder membership', () => {
    const id = store().openDocument('filed', 'ATGC')
    const folderId = store().createFolder('Cloning')
    store().moveTabToFolder(id, folderId)

    store().closeTab(id)
    expect(store().folders[0].tabIds).not.toContain(id)

    store().reopenClosedTab()
    expect(store().folders[0].tabIds).toContain(id)
  })

  it('makes the restored tab active', () => {
    const keep = store().openDocument('keep', 'AAAA')
    const gone = store().openDocument('gone', 'TTTT')

    store().closeTab(gone)
    expect(store().activeTabId).toBe(keep)

    store().reopenClosedTab()
    expect(store().activeTabId).toBe(gone)
    expect(store().doc.sequence.bases).toBe('TTTT')
  })

  it('undoes several closes in reverse order', () => {
    const a = store().openDocument('a', 'AAAA')
    const b = store().openDocument('b', 'CCCC')

    store().closeTab(a)
    store().closeTab(b)

    store().reopenClosedTab()
    expect(store().tabs.map(t => t.doc.name)).toEqual(['b'])
    store().reopenClosedTab()
    expect(store().tabs.map(t => t.doc.name)).toEqual(['a', 'b'])
  })

  it('caps the buffer, dropping the oldest', () => {
    for (let i = 0; i < MAX_RECENTLY_CLOSED + 2; i++) {
      const id = store().openDocument(`seq${i}`, 'ATGC')
      store().closeTab(id)
    }

    expect(store().recentlyClosedTabs).toHaveLength(MAX_RECENTLY_CLOSED)
    // seq0 and seq1 fell off the end; the newest is still there.
    expect(store().recentlyClosedTabs[0].tab.doc.name).toBe('seq2')
  })

  it('does nothing when there is nothing to reopen', () => {
    store().openDocument('only', 'ATGC')
    const before = store().tabs.length

    store().reopenClosedTab()
    expect(store().tabs).toHaveLength(before)
  })
})
