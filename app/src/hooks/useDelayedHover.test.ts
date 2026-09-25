import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDelayedHover, HOVER_DELAY_MS } from './useDelayedHover'

const A = { x: 10, y: 20, key: 'ann-a' }
const B = { x: 60, y: 20, key: 'ann-b' }

describe('useDelayedHover', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

  it('does not show immediately', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    expect(result.current.target).toBeNull()
  })

  it('shows after the delay elapses', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS)
    expect(result.current.target).toEqual(A)
  })

  it('still hidden one tick before the delay', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS - 1)
    expect(result.current.target).toBeNull()
  })

  it('never shows if the pointer leaves before the delay', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS - 50)
    act(() => result.current.hide())
    advance(HOVER_DELAY_MS * 2)
    expect(result.current.target).toBeNull()
  })

  it('hides immediately, with no delay on the way out', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS)
    expect(result.current.target).toEqual(A)
    act(() => result.current.hide())
    expect(result.current.target).toBeNull()
  })

  it('does not restart the countdown on every mousemove over the same feature', () => {
    // This is the bug a naive implementation has: re-arming on each move means
    // the tooltip never appears while the pointer is drifting.
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    for (let t = 0; t < HOVER_DELAY_MS; t += 20) {
      advance(20)
      act(() => result.current.show({ ...A, x: A.x + t }))
    }
    expect(result.current.target).not.toBeNull()
    expect(result.current.target?.key).toBe('ann-a')
  })

  it('opens at the pointer position current when the delay fires', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS - 100)
    act(() => result.current.show({ ...A, x: 999 }))
    advance(100)
    expect(result.current.target?.x).toBe(999)
  })

  it('tracks the pointer once visible, without re-delaying', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS)
    act(() => result.current.show({ ...A, x: 123 }))
    expect(result.current.target?.x).toBe(123)
  })

  it('drops the old tooltip at once when moving to a different feature', () => {
    const { result } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    advance(HOVER_DELAY_MS)
    expect(result.current.target?.key).toBe('ann-a')

    act(() => result.current.show(B))
    expect(result.current.target).toBeNull()   // A is gone straight away

    advance(HOVER_DELAY_MS)
    expect(result.current.target?.key).toBe('ann-b')
  })

  it('shows nothing when sweeping across features without pausing', () => {
    const { result } = renderHook(() => useDelayedHover())
    for (const id of ['f1', 'f2', 'f3', 'f4', 'f5']) {
      act(() => result.current.show({ x: 0, y: 0, key: id }))
      advance(HOVER_DELAY_MS / 4)
    }
    expect(result.current.target).toBeNull()
  })

  it('honours a custom delay', () => {
    const { result } = renderHook(() => useDelayedHover(1000))
    act(() => result.current.show(A))
    advance(999)
    expect(result.current.target).toBeNull()
    advance(1)
    expect(result.current.target).toEqual(A)
  })

  it('does not fire a pending timer after unmount', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
    const { result, unmount } = renderHook(() => useDelayedHover())
    act(() => result.current.show(A))
    unmount()
    advance(HOVER_DELAY_MS * 2)
    expect(errors).toEqual([])
    spy.mockRestore()
  })

  it('carries an arbitrary payload alongside the key', () => {
    // Enzyme tooltips hover a grouped cut site, not just an id, so the hook
    // has to be generic over whatever the caller attaches.
    type EnzymeTarget = { x: number; y: number; key: string; group: { label: string } }
    const { result } = renderHook(() => useDelayedHover<EnzymeTarget>())
    act(() => result.current.show({ x: 1, y: 2, key: 'EcoRI@42', group: { label: 'EcoRI' } }))
    advance(HOVER_DELAY_MS)
    expect(result.current.target?.group.label).toBe('EcoRI')
  })
})
