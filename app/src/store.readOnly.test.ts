import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './store'
import { useToastStore } from './toast'

const store = () => useEditorStore.getState()
const toasts = () => useToastStore.getState().toasts

describe('blocked edits in a read-only sequence', () => {
  beforeEach(() => {
    for (const tab of store().tabs) store().closeTab(tab.id)
    useToastStore.getState().clear()
    store().openDocument('pLocked', 'ATGCGATCGA')
    store().toggleReadOnly()
  })

  it('says the sequence is read-only, once however often the edit is tried', () => {
    store().notifyReadOnlyBlock()
    store().notifyReadOnlyBlock()
    store().notifyReadOnlyBlock()
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].message).toBe('pLocked is read-only')
    expect(toasts()[0].action?.label).toBe('Unlock')
  })

  it('unlocks the blocked tab from the toast, even after switching away', () => {
    const lockedId = store().activeTabId!
    store().notifyReadOnlyBlock()
    const unlock = toasts()[0].action!.onClick
    store().openDocument('pOther', 'AAAA')
    unlock()
    expect(store().tabs.find(t => t.id === lockedId)?.readOnly).toBe(false)
    store().setActiveTab(lockedId)
    expect(store().readOnly).toBe(false)
  })

  it('unlocks the active tab from the toast', () => {
    store().notifyReadOnlyBlock()
    toasts()[0].action!.onClick()
    expect(store().readOnly).toBe(false)
  })

  it('takes the toast down when the sequence is unlocked from the status bar', () => {
    store().notifyReadOnlyBlock()
    store().toggleReadOnly()
    expect(store().readOnly).toBe(false)
    expect(toasts()).toHaveLength(0)
  })
})
