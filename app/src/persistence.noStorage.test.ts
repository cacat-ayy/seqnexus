/**
 * With IndexedDB unavailable (blocked storage, some private windows) autosave
 * used to save nothing and report success. It must say so, once, and leave
 * the work counted as unsaved.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./storage/idb', async importOriginal => ({
  ...(await importOriginal<typeof import('./storage/idb')>()),
  isAvailable: async () => false,
}))

import { saveSession, hasUnsavedChanges } from './persistence'
import { useEditorStore } from './store'
import { useToastStore } from './toast'

describe('autosave without storage', () => {
  it('warns that nothing is being saved, and counts the work as unsaved', async () => {
    useEditorStore.getState().openDocument('pA', 'AAAA')
    await saveSession('light')
    await saveSession('light')
    const toasts = useToastStore.getState().toasts.filter(t => /not being saved/.test(t.message))
    expect(toasts).toHaveLength(1)
    expect(hasUnsavedChanges()).toBe(true)
  })
})
