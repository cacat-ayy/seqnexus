/**
 * Hook that clamps a tooltip's fixed position so it stays within the viewport.
 *
 * Returns a ref callback to attach to the tooltip element and the clamped { left, top }.
 * Measures the element after render and adjusts on every x/y change, and again
 * whenever the element changes size: a popover that grows after it opens (a
 * section expanding) would otherwise run past the edge it was clamped to.
 */

import { useRef, useState, useLayoutEffect, useCallback } from 'react'

const MARGIN = 8 // px from viewport edge

export interface ClampedPosition {
  left: number
  top: number
}

export interface ClampOptions {
  /**
   * Open towards the other side of the point when it does not fit, as a
   * context menu does, instead of sliding over it. A menu slid up over the
   * pointer puts a different item under it than the user aimed at.
   */
  flip?: boolean
}

export function useClampedPosition(
  x: number,
  y: number,
  { flip = false }: ClampOptions = {},
): { ref: React.RefCallback<HTMLDivElement>; pos: ClampedPosition } {
  const elRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<ClampedPosition>({ left: x, top: y })
  const observerRef = useRef<ResizeObserver | null>(null)
  const [size, setSize] = useState(0)

  // Watches the element for resizes, bumping `size` to rerun the clamp below.
  // Stable, so React does not detach and reattach it on every render, and the
  // observer is swapped here rather than in an effect so it follows the
  // element across mount and unmount.
  const ref = useCallback((el: HTMLDivElement | null) => {
    elRef.current = el
    observerRef.current?.disconnect()
    observerRef.current = null
    if (el && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => setSize(n => n + 1))
      observer.observe(el)
      observerRef.current = observer
    }
  }, [])

  useLayoutEffect(() => {
    const el = elRef.current
    if (!el) {
      setPos({ left: x, top: y })
      return
    }

    // The layout size, not the drawn one: popovers open with a scale-in
    // animation, and measuring the shrunken first frame left them a few pixels
    // short of the margin. offsetWidth ignores transforms; the bounding rect
    // is the fallback where there is no layout (jsdom).
    const box = el.getBoundingClientRect()
    const rect = { width: el.offsetWidth || box.width, height: el.offsetHeight || box.height }
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x
    let top = y

    if (flip) {
      if (left + rect.width > vw - MARGIN && x - rect.width >= MARGIN) left = x - rect.width
      if (top + rect.height > vh - MARGIN && y - rect.height >= MARGIN) top = y - rect.height
    }
    if (left + rect.width > vw - MARGIN) left = vw - rect.width - MARGIN
    if (left < MARGIN) left = MARGIN
    if (top + rect.height > vh - MARGIN) top = vh - rect.height - MARGIN
    if (top < MARGIN) top = MARGIN

    setPos({ left, top })
  }, [x, y, flip, size])

  return { ref, pos }
}
