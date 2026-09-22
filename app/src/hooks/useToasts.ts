import { useState, useCallback, useRef } from 'react'

/**
 * Manages error and hint toast state with auto-dismiss timers
 * and exit animation support.
 */
export function useToasts() {
  // --- Error toast ---
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [errorToastClosing, setErrorToastClosing] = useState(false)
  const errorTimerRef = useRef<number>(0)

  const dismissErrorToast = useCallback(() => {
    clearTimeout(errorTimerRef.current)
    setErrorToastClosing(true)
  }, [])

  const showError = useCallback((msg: string) => {
    setErrorToastClosing(false)
    setErrorToast(msg)
    clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => dismissErrorToast(), 5000)
  }, [dismissErrorToast])

  const handleErrorAnimationEnd = useCallback(() => {
    if (errorToastClosing) {
      setErrorToast(null)
      setErrorToastClosing(false)
    }
  }, [errorToastClosing])

  // --- Hint toast ---
  const [hintToast, setHintToast] = useState<string | null>(null)
  const [hintToastClosing, setHintToastClosing] = useState(false)
  const hintTimerRef = useRef<number>(0)

  const dismissHintToast = useCallback(() => {
    clearTimeout(hintTimerRef.current)
    setHintToastClosing(true)
  }, [])

  const showHint = useCallback((msg: string, durationMs = 4000) => {
    setHintToastClosing(false)
    setHintToast(msg)
    clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => dismissHintToast(), durationMs)
  }, [dismissHintToast])

  const handleHintAnimationEnd = useCallback(() => {
    if (hintToastClosing) {
      setHintToast(null)
      setHintToastClosing(false)
    }
  }, [hintToastClosing])

  return {
    errorToast,
    errorToastClosing,
    dismissErrorToast,
    showError,
    handleErrorAnimationEnd,
    hintToast,
    hintToastClosing,
    dismissHintToast,
    showHint,
    handleHintAnimationEnd,
  }
}
