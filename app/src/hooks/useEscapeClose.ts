import { useEffect } from 'react'

/**
 * Closes a popover when Escape is pressed anywhere. The key is taken in the
 * capture phase and stopped, so whatever has focus underneath (a grid that
 * clears its selection on Escape, say) does not also act on it.
 */
export function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])
}
