import { useEffect } from 'react'

/**
 * The chosen option of a segmented control (`.seg`) and the active tab of a
 * tab strip slide to their new place instead of jumping.
 *
 * One controller for the whole app rather than a hook in every control: it
 * finds the controls in the DOM, measures the active child and hands its box
 * to CSS as --ind-x, --ind-y, --ind-w and --ind-h on the container, where a
 * pseudo-element draws the pill (segmented) or the underline (tabs) and
 * transitions between boxes. Until a control has been measured it keeps the
 * look it has without this (the active child's own fill or border), so a
 * control is never left without its state, in tests or on first paint.
 */

const SEG = '.seg'
// Tab strips are found by their tabs; the sidebar's off-screen copy used to
// measure label widths is skipped.
const TABS = '.view-tabs, :has(> .panel-tab)'
const ACTIVE = ':scope > .active, :scope > [aria-selected="true"], :scope > [aria-checked="true"]'

function place(el: HTMLElement, tabs: boolean) {
  const active = el.querySelector<HTMLElement>(ACTIVE)
  // Hidden (zero size) or nothing chosen: no indicator, and no slide from a
  // stale box the next time it shows. The box is read against the control,
  // which the CSS positions, so one that is not its active child's
  // offsetParent is left as it is.
  if (!active || active.offsetParent !== el || el.offsetWidth === 0 || active.offsetWidth === 0) {
    if (el.classList.contains('has-ind')) el.classList.remove('has-ind', 'ind-ready')
    return
  }
  const x = active.offsetLeft
  const w = active.offsetWidth
  const h = tabs ? 2 : active.offsetHeight
  const y = tabs ? active.offsetTop + active.offsetHeight - h : active.offsetTop
  const s = el.style
  const set = (name: string, v: number) => {
    const px = `${v}px`
    if (s.getPropertyValue(name) !== px) s.setProperty(name, px)
  }
  set('--ind-x', x)
  set('--ind-y', y)
  set('--ind-w', w)
  set('--ind-h', h)
  if (!el.classList.contains('has-ind')) {
    el.classList.add('has-ind', tabs ? 'ind-bar' : 'ind-pill')
    // The first placement appears in place; only later moves slide.
    requestAnimationFrame(() => el.classList.add('ind-ready'))
  }
}

export function useSlidingIndicators() {
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const sized = new WeakSet<Element>()
    const ro = new ResizeObserver(() => schedule())

    const visit = (el: HTMLElement, tabs: boolean) => {
      place(el, tabs)
      // A control that changes width (a sidebar resized) moves its active option.
      if (!sized.has(el)) { sized.add(el); ro.observe(el) }
    }
    const run = () => {
      frame = 0
      for (const el of document.querySelectorAll<HTMLElement>(SEG)) visit(el, false)
      for (const el of document.querySelectorAll<HTMLElement>(TABS)) {
        if (!el.closest('[aria-hidden="true"]')) visit(el, true)
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(run)
    }

    // What changes the active option: a class or aria state flipping, or a
    // control mounting. Style is not watched, as the controller writes it.
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, {
      subtree: true, childList: true,
      attributes: true, attributeFilter: ['class', 'aria-selected', 'aria-checked'],
    })
    schedule()
    document.fonts?.ready.then(schedule).catch(() => {})
    return () => {
      mo.disconnect()
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
