import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEditorStore } from '../store'
import { useToastStore } from '../toast'
import { demoDocument } from '../demo'
import { DEFAULT_RECORD, useBackupStore } from '../backup/backup'
import { useBackupReminder, hasWork } from './useBackupReminder'

const DAY = 24 * 60 * 60 * 1000
const store = () => useEditorStore.getState()
const backup = () => useBackupStore.getState()
const toasts = () => useToastStore.getState().toasts

/** A browser that answers the storage questions the way a test wants. */
function fakeStorage(opts: { persisted?: boolean; grant?: boolean; usage?: number; quota?: number } = {}) {
  const persist = vi.fn(async () => opts.grant ?? false)
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      persisted: async () => opts.persisted ?? false,
      persist,
      estimate: async () => ({ usage: opts.usage ?? 1000, quota: opts.quota ?? 1_000_000 }),
    },
  })
  return persist
}

describe('backup reminders', () => {
  beforeEach(() => {
    for (const t of store().tabs) store().closeTab(t.id)
    useEditorStore.setState({ recentlyDeleted: [], sequencingReads: [], alignments: [], contigs: [], oligos: [], gels: [] })
    localStorage.removeItem('seqnexus:backup')
    useBackupStore.setState({ record: DEFAULT_RECORD, persisted: null })
    useToastStore.getState().clear()
  })
  afterEach(() => {
    // jsdom has no storage manager of its own.
    delete (navigator as { storage?: unknown }).storage
  })

  it('does not count the untouched demo as work', () => {
    store().openDocumentState(demoDocument())
    expect(hasWork(store())).toBe(false)
    store().openDocument('pMine', 'ACGT')
    expect(hasWork(store())).toBe(true)
  })

  it('reminds on start-up when changes have sat outside a backup too long', async () => {
    fakeStorage({ persisted: true })
    store().openDocument('pMine', 'ACGT')
    localStorage.setItem('seqnexus:backup', JSON.stringify({ ...DEFAULT_RECORD, firstUnbackedChangeAt: Date.now() - 9 * DAY, persistAsked: true }))
    const onBackup = vi.fn()

    renderHook(() => useBackupReminder(true, true, onBackup))
    await waitFor(() => expect(toasts()).toHaveLength(1))
    const toast = toasts()[0]
    expect(toast.message).toBe('Back up your session')
    expect(toast.detail).toMatch(/^9 days of changes exist only in this browser\./)
    toast.action!.onClick()
    expect(onBackup).toHaveBeenCalled()
    expect(backup().record.lastRemindedAt).not.toBeNull()
  })

  it('stays quiet when the backup is recent', async () => {
    fakeStorage({ persisted: true })
    store().openDocument('pMine', 'ACGT')
    localStorage.setItem('seqnexus:backup', JSON.stringify({ ...DEFAULT_RECORD, firstUnbackedChangeAt: Date.now() - DAY, persistAsked: true }))
    renderHook(() => useBackupReminder(true, true, vi.fn()))
    await waitFor(() => expect(backup().persisted).toBe(true))
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(toasts()).toHaveLength(0)
  })

  it('warns when storage is nearly full instead of the usual reminder', async () => {
    fakeStorage({ persisted: true, usage: 900, quota: 1000 })
    store().openDocument('pMine', 'ACGT')
    localStorage.setItem('seqnexus:backup', JSON.stringify({ ...DEFAULT_RECORD, firstUnbackedChangeAt: Date.now() - 9 * DAY, persistAsked: true }))
    renderHook(() => useBackupReminder(true, true, vi.fn()))
    await waitFor(() => expect(toasts()).toHaveLength(1))
    expect(toasts()[0].message).toBe('Browser storage is 90% full')
  })

  it('starts the clock for existing work on the first visit, and asks to keep storage once', async () => {
    const persist = fakeStorage({ grant: true })
    store().openDocument('pMine', 'ACGT')
    renderHook(() => useBackupReminder(true, true, vi.fn()))
    await waitFor(() => expect(backup().persisted).toBe(true))
    expect(persist).toHaveBeenCalledTimes(1)
    expect(backup().record.firstUnbackedChangeAt).not.toBeNull()
    expect(backup().record.persistAsked).toBe(true)
  })

  it('leaves a fresh demo alone, then tracks the first real change', async () => {
    const persist = fakeStorage()
    store().openDocumentState(demoDocument())
    renderHook(() => useBackupReminder(true, false, vi.fn()))
    await waitFor(() => expect(backup().persisted).toBe(false))
    expect(persist).not.toHaveBeenCalled()
    expect(backup().record.firstUnbackedChangeAt).toBeNull()

    act(() => { store().openDocument('pMine', 'ACGT') })
    expect(backup().record.firstUnbackedChangeAt).not.toBeNull()
    expect(persist).toHaveBeenCalledTimes(1)
  })
})
