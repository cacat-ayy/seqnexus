/**
 * When the auto-annotation scan runs again.
 *
 * The proposals carry coordinates, so any change to the bases has to re-run
 * the scan, including the ones that keep the length: a replace of the same
 * length, a new origin, an undo. A change to the features alone must not.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const calls: { bases: string; circular: boolean }[] = []
vi.mock('../workers/annotate-list', () => ({
  annotateFromList: (...args: [string, unknown, number, boolean, boolean?, boolean?]) => {
    calls.push({ bases: args[0], circular: args[5] ?? false })
    return Promise.resolve([])
  },
}))

import { useEditorStore } from '../store'
import { useAutoAnnotateScan } from './useAutoAnnotateScan'

const store = () => useEditorStore.getState()

describe('useAutoAnnotateScan', () => {
  beforeEach(() => {
    calls.length = 0
    for (const tab of store().tabs) store().closeTab(tab.id)
    store().openDocument('pScan', 'AAAACCCCGGGGTTTTACGTACGT', 'circular')
  })

  const settle = async (n: number) => {
    await waitFor(() => expect(calls.length).toBe(n))
    // Nothing more arrives after the expected scan.
    await new Promise(r => setTimeout(r, 30))
    expect(calls.length).toBe(n)
  }

  it('scans a circular document as circular', async () => {
    renderHook(() => useAutoAnnotateScan(true))
    await settle(1)
    expect(calls[0].circular).toBe(true)
  })

  it('scans again when the origin moves, though the length does not change', async () => {
    renderHook(() => useAutoAnnotateScan(true))
    await settle(1)
    store().rotateOrigin(4)
    await settle(2)
    expect(calls[1].bases).toBe('CCCCGGGGTTTTACGTACGTAAAA')
  })

  it('scans again after a replace of the same length', async () => {
    renderHook(() => useAutoAnnotateScan(true))
    await settle(1)
    store().replace(0, 4, 'TTTT')
    await settle(2)
    expect(calls[1].bases.startsWith('TTTTCCCC')).toBe(true)
  })

  it('does not scan for a change to the features alone', async () => {
    renderHook(() => useAutoAnnotateScan(true))
    await settle(1)
    store().addAnnotations([{ id: 'f1', name: 'x', type: 'misc_feature', start: 0, end: 4, strand: 1 }])
    await settle(1)
  })

  it('does not scan again when an undo puts the same bases back', async () => {
    renderHook(() => useAutoAnnotateScan(true))
    await settle(1)
    store().addAnnotations([{ id: 'f1', name: 'x', type: 'misc_feature', start: 0, end: 4, strand: 1 }])
    store().undo()
    await settle(1)
    // An undo that changes the bases does scan.
    store().rotateOrigin(4)
    await settle(2)
    store().undo()
    await settle(3)
    expect(calls[2].bases).toBe('AAAACCCCGGGGTTTTACGTACGT')
  })
})
