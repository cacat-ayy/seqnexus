import { describe, it, expect, beforeEach, vi } from 'vitest'
import { copyText, readText } from './clipboard'
import { useToastStore } from '../toast'

const toasts = () => useToastStore.getState().toasts

function stubClipboard(impl: Partial<Clipboard>) {
  Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true })
}

describe('clipboard', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
  })

  it('copies and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    await expect(copyText('ATGC', 'Copied 4 bp')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('ATGC')
    expect(toasts()[0].message).toBe('Copied 4 bp')
    expect(toasts()[0].severity).toBe('success')
  })

  it('stays quiet on success when the caller has its own confirmation', async () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })

    await copyText('ATGC')
    expect(toasts()).toHaveLength(0)
  })

  it('reports a rejected write instead of swallowing it', async () => {
    // The old call sites did .catch(console.warn), so a blocked clipboard
    // produced no success toast and no error: nothing at all.
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })

    await expect(copyText('ATGC', 'Copied 4 bp')).resolves.toBe(false)
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].severity).toBe('error')
    expect(toasts()[0].message).toBe('Could not copy to clipboard')
  })

  it('reports a missing clipboard API', async () => {
    stubClipboard({})

    await expect(copyText('ATGC', 'Copied 4 bp')).resolves.toBe(false)
    expect(toasts()[0].severity).toBe('error')
  })

  it('returns null and reports when a read fails', async () => {
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) })

    await expect(readText()).resolves.toBeNull()
    expect(toasts()[0].severity).toBe('error')
    expect(toasts()[0].message).toBe('Could not read the clipboard')
  })

  it('returns the text on a successful read', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('ATGC') })

    await expect(readText()).resolves.toBe('ATGC')
    expect(toasts()).toHaveLength(0)
  })
})
