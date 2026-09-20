import { useEffect, useRef, type RefObject } from 'react'

/**
 * Closes a popover/dropdown when a full click (mousedown + mouseup)
 * occurs outside of it. A mousedown alone won't dismiss – the user
 * must complete the click outside for it to count.
 *
 * Optionally ignores clicks on a trigger button.
 */
export function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  const downOutside = useRef(false)

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
}
