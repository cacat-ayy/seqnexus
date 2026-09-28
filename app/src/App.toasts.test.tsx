import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import App from './App'
import { useToastStore } from './toast'
import { useEditorStore } from './store'

const toasts = () => useToastStore.getState().toasts

/**
 * End-to-end cover for the paths that used to fail silently. These go through
 * App rather than the store directly, because the bug in each case was a
 * missing call, not a broken notifier.
 */
describe('App notifications', () => {
  beforeEach(() => {
    useToastStore.getState().clear()
    for (const tab of useEditorStore.getState().tabs) {
      useEditorStore.getState().closeTab(tab.id)
    }
    useEditorStore.setState({ recentlyClosedTabs: [] })
  })

  it('mounts the toaster with both live regions', () => {
    render(<App />)
    expect(document.querySelectorAll('.toaster-group')).toHaveLength(2)
  })

  it('rejects an unsupported file with the filename in the message', async () => {
    render(<App />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['whatever'], 'notes.docx', { type: 'application/octet-stream' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })

    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })

    await waitFor(() => expect(toasts()).toHaveLength(1))
    const t = toasts()[0]
    expect(t.severity).toBe('error')
    expect(t.message).toContain('notes.docx')
    // The eight supported formats belong in the detail line, not the headline.
    expect(t.message).not.toContain('GenBank')
    expect(t.detail).toContain('GenBank')
  })

  it('shows an error rather than nothing when the message is long', async () => {
    render(<App />)
    // Errors are sticky, so a long message cannot time out unread.
    act(() => { useToastStore.getState().push('error', 'Session save failed') })
    expect(toasts()[0].duration).toBe(0)
    expect(await screen.findByText('Session save failed')).toBeInTheDocument()
  })
})
