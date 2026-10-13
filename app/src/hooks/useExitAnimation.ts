import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Keeps a component mounted during its CSS exit animation.
 *
 * Returns `visible` (whether to render), `closing` (whether the exit
 * animation is playing), and `onAnimationEnd` (to complete unmount).
 *
 * Usage:
 *   const { visible, closing, onAnimationEnd } = useExitAnimation(open)
 *   if (!visible) return null
 *   return <div className={closing ? 'closing' : ''} onAnimationEnd={onAnimationEnd}>…</div>
 */
export function useExitAnimation(open: boolean): {
  visible: boolean
  closing: boolean
  onAnimationEnd: (e: React.AnimationEvent) => void
} {
  const [visible, setVisible] = useState(false)
  const [closing, setClosing] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    if (open) {
      setClosing(false)
      setVisible(true)
    } else {
      // Use functional update to avoid stale closure over visible/closing
      setVisible(prev => {
        if (prev) setClosing(true)
        return prev
      })
    }
  }, [open])

  const onAnimationEnd = useCallback((e: React.AnimationEvent) => {
    // Only respond to the backdrop's own animation, not bubbled child events,
    // and not once it has been opened again: reopened just as the exit
    // animation ended, this closure still saw it closing and hid it while
    // `open` stayed true, so it could not be shown again.
    if (closing && !openRef.current && e.currentTarget === e.target) {
      setVisible(false)
      setClosing(false)
    }
  }, [closing])

  return { visible, closing, onAnimationEnd }
}
