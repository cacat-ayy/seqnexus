import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Hover state that appears after a delay and disappears immediately.
 *
 * Feature tooltips used to be set straight from `mousemove`, so sweeping the
 * pointer across a dense annotation track flashed a popover for every feature
 * it crossed. A short delay means the popover only appears where the pointer
 * actually comes to rest.
 *
 * The delay applies to appearing, never to disappearing: a tooltip that
 * lingers after the pointer has left reads as a bug, not as polish.
 */

export interface HoverTarget {
  x: number
  y: number
  /**
   * Stable identity of the thing under the pointer. The countdown restarts
   * only when this changes, which is what lets the pointer drift within one
   * target without resetting the delay. Callers add their own payload
   * alongside it — a feature id, a grouped cut site, and so on.
   */
  key: string
}

/**
 * 300ms. Long enough that crossing a feature on the way somewhere else does
 * not trigger it, short enough to feel like a direct response when the pointer
 * stops. Below ~200ms the flashing returns; much above ~400ms it reads as lag.
 */
export const HOVER_DELAY_MS = 300

export function useDelayedHover<T extends HoverTarget>(delayMs: number = HOVER_DELAY_MS) {
  const [target, setTarget] = useState<T | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Latest pointer position, so the tooltip opens where the pointer is now. */
  const pendingRef = useRef<T | null>(null)
  /** Which target the running timer is counting down for. */
  const armedIdRef = useRef<string | null>(null)
  /** Which target is currently on screen; mirrors `target` for use in callbacks. */
  const visibleIdRef = useRef<string | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    armedIdRef.current = null
  }, [])

  const hide = useCallback(() => {
    clearTimer()
    pendingRef.current = null
    if (visibleIdRef.current !== null) {
      visibleIdRef.current = null
      setTarget(null)
    }
  }, [clearTimer])

  const show = useCallback((next: T) => {
    // Always record the newest position, even mid-countdown.
    pendingRef.current = next

    // Already open for this target: track the pointer without re-delaying.
    if (visibleIdRef.current === next.key) {
      setTarget(next)
      return
    }

    // Countdown already running for this target: let it finish. Restarting it
    // on every mousemove is what would stop the tooltip ever appearing.
    if (armedIdRef.current === next.key) return

    // Moved onto a different target: drop the old tooltip at once, then arm.
    clearTimer()
    if (visibleIdRef.current !== null) {
      visibleIdRef.current = null
      setTarget(null)
    }

    armedIdRef.current = next.key
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      armedIdRef.current = null
      const pending = pendingRef.current
      if (!pending) return
      visibleIdRef.current = pending.key
      setTarget(pending)
    }, delayMs)
  }, [clearTimer, delayMs])

  // A timer that fires after unmount would setState on a dead component.
  useEffect(() => clearTimer, [clearTimer])

  return { target, show, hide }
}
