/**
 * Toolbar density selection.
 *
 * jsdom does no layout, so the toolbar and its last item are given boxes that
 * respond to the density classes the hook applies, which is exactly the
 * feedback the hook relies on in a real browser. The widths below stand in for
 * a toolbar that needs 1300px as designed, 1100px squeezed, 800px without
 * labels and 560px with its tools folded into one menu.
 */
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef } from 'react'
import { useToolbarDensity } from './useToolbarDensity'

const WIDTHS = { full: 1300, tight: 1100, icons: 800, collapsed: 560 }
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
  // Width added by buttons that come and go (tools left out in a workspace).
  let extra = 0
  const el = document.createElement('div')
  el.style.paddingRight = `${PADDING}px`
  const needed = () => extra + (
    el.classList.contains('is-collapsed') ? WIDTHS.collapsed
      : el.classList.contains('is-icons') ? WIDTHS.icons
      : el.classList.contains('is-tight') ? WIDTHS.tight
      : WIDTHS.full)
  Object.defineProperty(el, 'clientWidth', { get: () => available })
  Object.defineProperty(el, 'scrollWidth', { get: () => Math.max(available, needed()) })
  el.getBoundingClientRect = () => rect(available)
  const last = document.createElement('button')
  // Wrapping folds the overflow onto a second row, so nothing sticks out.
  last.getBoundingClientRect = () =>
    rect(el.classList.contains('is-wrap') ? Math.min(needed(), available - PADDING) : needed())
  el.appendChild(last)
  document.body.appendChild(el)
  return { el, resize: (w: number) => { available = w }, grow: (w: number) => { extra = w } }
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

  it('folds the tools into one menu when even the icon row overflows', () => {
    const { el } = makeToolbar(600)
    const { result } = mount(el)
    expect(result.current).toEqual({ density: 'collapsed', wrapped: false })
    expect(el.classList.contains('is-icons')).toBe(true)
    expect(el.classList.contains('is-collapsed')).toBe(true)
  })

  it('wraps as a last resort when even the collapsed row overflows', () => {
    const { result } = mount(makeToolbar(500).el)
    expect(result.current).toEqual({ density: 'collapsed', wrapped: true })
  })

  it('re-measures when its buttons change, though its own box does not', async () => {
    const toolbar = makeToolbar(1200)
    const { result } = mount(toolbar.el)
    expect(result.current.density).toBe('tight')
    // Buttons come back (leaving a workspace): the row no longer fits squeezed.
    toolbar.grow(300)
    await act(async () => { toolbar.el.prepend(document.createElement('button')) })
    expect(result.current.density).toBe('icons')
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

/**
 * The same toolbar run down the left: icons from the start, measured by
 * height. It needs 900px with every tool and 600px with them in one menu.
 */
describe('useToolbarDensity, vertical', () => {
  const HEIGHTS = { icons: 900, collapsed: 600 }

  function makeRail(available: number) {
    const el = document.createElement('div')
    el.style.paddingBottom = `${PADDING}px`
    const needed = () => (el.classList.contains('is-collapsed') ? HEIGHTS.collapsed : HEIGHTS.icons)
    const box = (bottom: number) =>
      ({ left: 0, right: 44, top: 0, bottom, width: 44, height: bottom, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    Object.defineProperty(el, 'clientHeight', { get: () => available })
    Object.defineProperty(el, 'clientWidth', { get: () => 44 })
    el.getBoundingClientRect = () => box(available)
    const last = document.createElement('button')
    // Wrapping starts a second column, so nothing sticks out at the bottom.
    last.getBoundingClientRect = () =>
      box(el.classList.contains('is-wrap') ? Math.min(needed(), available - PADDING) : needed())
    el.appendChild(last)
    document.body.appendChild(el)
    return el
  }

  function mountRail(el: HTMLElement) {
    return renderHook(() => {
      const ref = useRef<HTMLElement | null>(el)
      return useToolbarDensity(ref, true)
    })
  }

  it('starts at icons, never at labels', () => {
    const el = makeRail(1000)
    const { result } = mountRail(el)
    expect(result.current).toEqual({ density: 'icons', wrapped: false })
    expect(el.classList.contains('is-icons')).toBe(true)
  })

  it('folds the tools into one menu when the window is too short', () => {
    expect(mountRail(makeRail(700)).result.current).toEqual({ density: 'collapsed', wrapped: false })
  })

  it('wraps into a second column as a last resort', () => {
    expect(mountRail(makeRail(500)).result.current).toEqual({ density: 'collapsed', wrapped: true })
  })
})
