import { useState, useEffect, useCallback } from 'react'

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
    // Only respond to the backdrop's own animation, not bubbled child events
    if (closing && e.currentTarget === e.target) {
      setVisible(false)
      setClosing(false)
    }
  }, [closing])

  return { visible, closing, onAnimationEnd }
}
