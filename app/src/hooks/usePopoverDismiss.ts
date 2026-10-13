import { useEffect, useRef, type RefObject } from 'react'

/**
 * The open popovers, most recently opened last. Escape closes the top one
 * only: a menu opened from a popover goes first, then the popover, rather
 * than both at once.
 */
const escapeStack: Array<() => void> = []

function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || escapeStack.length === 0) return
  // Taken in the capture phase and stopped, so whatever has focus underneath
  // (the sequence clearing its selection, a dialog closing) does not also act.
  e.stopPropagation()
  escapeStack[escapeStack.length - 1]()
}

/**
 * Closes a popover/dropdown when a full click (mousedown + mouseup)
 * occurs outside of it, or on Escape. A mousedown alone won't dismiss: the
 * user must complete the click outside for it to count.
 *
 * Optionally ignores clicks on a trigger button, which also gets the focus
 * back when Escape closes the popover from inside it.
 */
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  const downOutside = useRef(false)
  // The latest close, read when Escape comes: callers pass inline arrows, and
  // re-registering on each render would reorder the stack.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return

    const isInside = (target: Node) => {
      if (triggerRef?.current?.contains(target)) return true
      if (popoverRef.current?.contains(target)) return true
      return false
    }

    const handleDown = (e: MouseEvent) => {
      downOutside.current = !isInside(e.target as Node)
    }

    const handleUp = (e: MouseEvent) => {
      if (downOutside.current && !isInside(e.target as Node)) {
        onClose()
      }
      downOutside.current = false
    }

    document.addEventListener('mousedown', handleDown)
    document.addEventListener('mouseup', handleUp)
    return () => {
      document.removeEventListener('mousedown', handleDown)
      document.removeEventListener('mouseup', handleUp)
      downOutside.current = false
    }
  }, [open, onClose, popoverRef, triggerRef])

  useEffect(() => {
    if (!open) return
    const close = () => {
      const active = document.activeElement
      closeRef.current()
      // Like a menu: focus returns to the button that opened it, unless it
      // had already moved somewhere else on purpose.
      const trigger = triggerRef?.current
      if (trigger && (!active || active === document.body || popoverRef.current?.contains(active))) trigger.focus()
    }
    escapeStack.push(close)
    if (escapeStack.length === 1) window.addEventListener('keydown', onEscape, true)
    return () => {
      const i = escapeStack.lastIndexOf(close)
      if (i >= 0) escapeStack.splice(i, 1)
      if (escapeStack.length === 0) window.removeEventListener('keydown', onEscape, true)
    }
  }, [open, popoverRef, triggerRef])
}
