/**
 * What the ORF scan asks the finder for: the settings of the tab, the start
 * codons of the genetic code when asked, and a range only on its own tab.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEditorStore } from '../store'
import { useOrfScan } from './useOrfScan'
import { findORFs } from '../workers/orf-finder'

vi.mock('../workers/orf-finder', async importOriginal => ({
  ...(await importOriginal<typeof import('../workers/orf-finder')>()),
  findORFs: vi.fn(async () => []),
}))

const store = () => useEditorStore.getState()
const lastOptions = () => vi.mocked(findORFs).mock.lastCall?.[1]

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
}

describe('useOrfScan', () => {
  beforeEach(() => {
    vi.mocked(findORFs).mockClear()
    store().loadDocument('orfs', 'ATGGCCGCCTAA'.repeat(10), 'linear')
    store().setTranslationCode(1)
    store().setOrfRange(null)
    store().setOrfParams({ orfStartCodons: ['ATG'], orfStartsFromCode: false, orfAllStarts: false })
  })

  it("scans with the start codons chosen, or the genetic code's own", async () => {
    renderHook(() => useOrfScan(true))
    await settle()
    expect(lastOptions()).toMatchObject({ startCodons: ['ATG'], allStarts: false })
    act(() => { store().setOrfParams({ orfStartsFromCode: true, orfAllStarts: true }) })
    await settle()
    expect(lastOptions()).toMatchObject({ startCodons: ['ATG', 'TTG', 'CTG'], allStarts: true })
    act(() => { store().setTranslationCode(2) })
    await settle()
    expect(lastOptions()).toMatchObject({ startCodons: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG'], geneticCode: 2 })
  })

  it('limits the scan to the range of its own tab only', async () => {
    renderHook(() => useOrfScan(true))
    await settle()
    expect(lastOptions()?.region).toBeUndefined()
    act(() => { store().setOrfRange({ tabId: store().activeTabId!, start: 12, end: 60 }) })
    await settle()
    expect(lastOptions()?.region).toEqual({ start: 12, end: 60 })
    act(() => { store().setOrfRange({ tabId: 'another tab', start: 0, end: 24 }) })
    await settle()
    expect(lastOptions()?.region).toBeUndefined()
  })
})
