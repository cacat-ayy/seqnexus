import { render, screen, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Toaster from './Toaster'
import { notify, useToastStore } from '../toast'

/**
 * jsdom never fires `animationend`, so the component's exit relies on its
 * fallback timer. That is deliberate and is what these tests exercise.
 */
const EXIT_MS = 300

describe('Toaster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.getState().clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function show(fn: () => void) {
    render(<Toaster />)
    act(() => { fn() })
  }

  it('renders nothing but the live regions when there are no toasts', () => {
    render(<Toaster />)
    expect(screen.queryByText(/./)).toBeNull()
    // The regions must exist up front, or screen readers miss the first toast.
    expect(document.querySelectorAll('.toaster-group')).toHaveLength(2)
  })

  it('announces confirmations politely and failures assertively', () => {
    show(() => {
      notify.success('Exported plasmid.gb')
      notify.error('Session save failed')
    })

    const polite = document.querySelector('[aria-live="polite"]')!
    const assertive = document.querySelector('[aria-live="assertive"]')!
    expect(polite).toHaveTextContent('Exported plasmid.gb')
    expect(assertive).toHaveTextContent('Session save failed')
  })

  it('shows the detail line under the message', () => {
    show(() => notify.error('Could not read "x.gb"', { detail: 'Unexpected LOCUS line' }))

    expect(screen.getByText('Could not read "x.gb"')).toBeInTheDocument()
    expect(screen.getByText('Unexpected LOCUS line')).toBeInTheDocument()
  })

  it('dismisses from a close button that has an accessible name', () => {
    show(() => notify.error('Session save failed'))

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    act(() => { vi.advanceTimersByTime(EXIT_MS) })

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-dismisses after its duration', () => {
    show(() => notify.success('Copied 240 bp', { duration: 2000 }))

    act(() => { vi.advanceTimersByTime(1999) })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // Two steps: the first starts the exit, and only the re-render that
    // follows schedules the timer that removes it from the store.
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { vi.advanceTimersByTime(EXIT_MS) })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('does not auto-dismiss an error', () => {
    show(() => notify.error('Session save failed'))

    act(() => { vi.advanceTimersByTime(60_000) })
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('holds a toast open while the pointer is over it', () => {
    show(() => notify.success('Copied 240 bp', { duration: 2000 }))
    const toast = document.querySelector('.toast')!

    fireEvent.pointerEnter(toast)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // ...and resumes once the pointer leaves.
    fireEvent.pointerLeave(toast)
    act(() => { vi.advanceTimersByTime(2000) })
    act(() => { vi.advanceTimersByTime(EXIT_MS) })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('runs the action and then dismisses', () => {
    const onClick = vi.fn()
    show(() => notify.success('Deleted 3 features', { action: { label: 'Undo', onClick } }))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onClick).toHaveBeenCalledOnce()

    act(() => { vi.advanceTimersByTime(EXIT_MS) })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismisses on Escape while focus is inside the toast', () => {
    show(() => notify.error('Session save failed'))

    fireEvent.keyDown(document.querySelector('.toast')!, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(EXIT_MS) })

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('marks severity on the card so the accent colour follows the theme', () => {
    show(() => notify.warning('Restriction site scan failed'))
    expect(document.querySelector('.toast')).toHaveClass('toast-warning')
  })
})
