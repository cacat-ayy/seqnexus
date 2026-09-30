/**
 * Toolbar density selection.
 *
 * jsdom does no layout, so the toolbar and its last item are given boxes that
 * respond to the density classes the hook applies — which is exactly the
 * feedback the hook relies on in a real browser. The widths below stand in for
 * a toolbar that needs 1300px as designed, 1100px squeezed, and 800px without
 * labels.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { useToolbarDensity } from './useToolbarDensity'

const WIDTHS = { full: 1300, tight: 1100, icons: 800 }
const PADDING = 8

function rect(right: number): DOMRect {
  return { left: 0, right, top: 0, bottom: 36, width: right, height: 36, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
}

/**
 * A toolbar whose layout depends on the classes set on it, the way a real one
 * does: a flex spacer soaks up any spare room, so scrollWidth never drops
 * below clientWidth, and only the last item's position shows an overflow.
 */
function makeToolbar(initial: number) {
  let available = initial
  const el = document.createElement('div')
  el.style.paddingRight = `${PADDING}px`
  const needed = () =>
    el.classList.contains('is-icons') ? WIDTHS.icons
      : el.classList.contains('is-tight') ? WIDTHS.tight
      : WIDTHS.full
  Object.defineProperty(el, 'clientWidth', { get: () => available })
  Object.defineProperty(el, 'scrollWidth', { get: () => Math.max(available, needed()) })
  el.getBoundingClientRect = () => rect(available)
  const last = document.createElement('button')
  // Wrapping folds the overflow onto a second row, so nothing sticks out.
  last.getBoundingClientRect = () =>
    rect(el.classList.contains('is-wrap') ? Math.min(needed(), available - PADDING) : needed())
  el.appendChild(last)
  document.body.appendChild(el)
  return { el, resize: (w: number) => { available = w } }
}

function mount(el: HTMLElement) {
  return renderHook(() => {
    const ref = useRef<HTMLElement | null>(el)
    return useToolbarDensity(ref)
  })
}

beforeEach(() => {
  // The hook coalesces re-measurement into a frame; run those inline. The
  // handle has to be 0: the callback has already run by the time the hook
  // stores it, and a truthy handle would read as a frame still pending.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useToolbarDensity', () => {
  it('keeps the full layout when the row fits', () => {
    const { result } = mount(makeToolbar(1400).el)
    expect(result.current).toEqual({ density: 'full', wrapped: false })
  })

  it('keeps the full layout on a wide screen, where the spacer pads scrollWidth up to clientWidth', () => {
    // The regression: every density measured as overflowing when the spare
    // room was taken up by the spacer, so labels never showed at any width.
    const { el } = makeToolbar(1600)
    expect(el.scrollWidth).toBe(el.clientWidth)
    const { result } = mount(el)
    expect(result.current).toEqual({ density: 'full', wrapped: false })
  })

  it('squeezes before dropping labels', () => {
    const { result } = mount(makeToolbar(1200).el)
    expect(result.current).toEqual({ density: 'tight', wrapped: false })
  })

  it('drops labels only when squeezing is not enough', () => {
    const { result } = mount(makeToolbar(1000).el)
    expect(result.current).toEqual({ density: 'icons', wrapped: false })
  })

  it('wraps as a last resort when even the icon row overflows', () => {
    const { result } = mount(makeToolbar(600).el)
    expect(result.current).toEqual({ density: 'icons', wrapped: true })
  })

  it('leaves the chosen classes on the element', () => {
    const { el } = makeToolbar(1000)
    mount(el)
    expect(el.classList.contains('is-tight')).toBe(true)
    expect(el.classList.contains('is-icons')).toBe(true)
    expect(el.classList.contains('is-wrap')).toBe(false)
  })

  it('counts the toolbar padding as unavailable', () => {
    // 1300 of content in exactly 1300 of box pokes into the right padding.
    const { result } = mount(makeToolbar(WIDTHS.full).el)
    expect(result.current.density).toBe('tight')
  })

  it('stays put when an unmeasurable toolbar reports zero width', () => {
    const { result } = mount(makeToolbar(0).el)
    expect(result.current).toEqual({ density: 'full', wrapped: false })
  })

  it('re-measures when the toolbar is resized', () => {
    const toolbar = makeToolbar(1400)

    let notify: (() => void) | null = null
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { notify = cb }
      observe() {}
      unobserve() {}
      disconnect() {}
    })

    const { result } = mount(toolbar.el)
    expect(result.current.density).toBe('full')

    toolbar.resize(1000)
    act(() => { notify?.() })
    expect(result.current.density).toBe('icons')

    toolbar.resize(1600)
    act(() => { notify?.() })
    expect(result.current.density).toBe('full')
  })
})
