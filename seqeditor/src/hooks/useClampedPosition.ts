/**
 * Hook that clamps a tooltip's fixed position so it stays within the viewport.
 *
 * Returns a ref callback to attach to the tooltip element and the clamped { left, top }.
 * Measures the element after render and adjusts on every x/y change.
 */

import { useRef, useState, useLayoutEffect } from 'react'

const MARGIN = 8 // px from viewport edge

export interface ClampedPosition {
  left: number
  top: number
}

export function useClampedPosition(
  x: number,
  y: number,
): { ref: React.RefCallback<HTMLDivElement>; pos: ClampedPosition } {
  const elRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<ClampedPosition>({ left: x, top: y })

  const ref = (node: HTMLDivElement | null) => {
    elRef.current = node
  }

  useLayoutEffect(() => {
    const el = elRef.current
    if (!el) {
      setPos({ left: x, top: y })
      return
    }

    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let left = x
    let top = y

    if (left + rect.width > vw - MARGIN) left = vw - rect.width - MARGIN
    if (left < MARGIN) left = MARGIN
    if (top + rect.height > vh - MARGIN) top = vh - rect.height - MARGIN
    if (top < MARGIN) top = MARGIN

    setPos({ left, top })
  }, [x, y])

  return { ref, pos }
}
