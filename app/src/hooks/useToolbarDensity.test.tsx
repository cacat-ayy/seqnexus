/**
 * Toolbar density selection.
 *
 * jsdom does no layout, so the element is given a scrollWidth that responds to
 * the density classes the hook applies — which is exactly the feedback the
 * hook relies on in a real browser. The widths below stand in for a toolbar
 * that needs 1300px as designed, 1100px squeezed, and 800px without labels.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { useToolbarDensity } from './useToolbarDensity'

const WIDTHS = { full: 1300, tight: 1100, icons: 800 }

/** A toolbar element whose measured width depends on the classes set on it. */
function makeToolbar(available: number) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { get: () => available })
  Object.defineProperty(el, 'scrollWidth', {
    get: () => {
      const needed = el.classList.contains('is-icons') ? WIDTHS.icons
        : el.classList.contains('is-tight') ? WIDTHS.tight
        : WIDTHS.full
      // Wrapping folds the overflow onto a second row, so nothing sticks out.
      return el.classList.contains('is-wrap') ? Math.min(needed, available) : needed
    },
  })
  document.body.appendChild(el)
  return el
}

function mount(el: HTMLElement) {
  return renderHook(() => {
    const ref = useRef<HTMLElement | null>(el)
    return useToolbarDensity(ref)
  })
}

beforeEach(() => {
  // The hook coalesces re-measurement into a frame; run those inline.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useToolbarDensity', () => {
  it('keeps the full layout when the row fits', () => {
    const { result } = mount(makeToolbar(1400))
    expect(result.current).toEqual({ density: 'full', wrapped: false })
  })

  it('squeezes before dropping labels', () => {
    const { result } = mount(makeToolbar(1200))
    expect(result.current).toEqual({ density: 'tight', wrapped: false })
  })

  it('drops labels only when squeezing is not enough', () => {
    const { result } = mount(makeToolbar(1000))
    expect(result.current).toEqual({ density: 'icons', wrapped: false })
  })

  it('wraps as a last resort when even the icon row overflows', () => {
    const { result } = mount(makeToolbar(600))
    expect(result.current).toEqual({ density: 'icons', wrapped: true })
  })

  it('leaves the chosen classes on the element', () => {
    const el = makeToolbar(1000)
    mount(el)
    expect(el.classList.contains('is-tight')).toBe(true)
    expect(el.classList.contains('is-icons')).toBe(true)
    expect(el.classList.contains('is-wrap')).toBe(false)
  })

  it('counts the toolbar padding as unavailable', () => {
    // 1300 of content in exactly 1300 of box overflows once the right padding
    // scrollWidth omits is accounted for.
    const { result } = mount(makeToolbar(WIDTHS.full))
    expect(result.current.density).toBe('tight')
  })

  it('stays put when an unmeasurable toolbar reports zero width', () => {
    const { result } = mount(makeToolbar(0))
    expect(result.current).toEqual({ density: 'full', wrapped: false })
  })

  it('re-measures when the toolbar is resized', () => {
    let available = 1400
    const el = document.createElement('div')
    Object.defineProperty(el, 'clientWidth', { get: () => available })
    Object.defineProperty(el, 'scrollWidth', {
      get: () => el.classList.contains('is-icons') ? WIDTHS.icons
        : el.classList.contains('is-tight') ? WIDTHS.tight
        : WIDTHS.full,
    })
    document.body.appendChild(el)

    let notify: (() => void) | null = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb }
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const { result } = mount(el)
    expect(result.current.density).toBe('full')

    available = 1000
    act(() => { notify?.() })
    expect(result.current.density).toBe('icons')
  })
})
