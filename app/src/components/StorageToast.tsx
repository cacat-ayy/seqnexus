import './StorageToast.css'
/**
 * Non-blocking toast notification for storage save failures.
 *
 * Exposes a module-level `showStorageError()` function that any module can
 * call (no React context needed). Deduplicates - only one toast at a time.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, AlertTriangle } from 'lucide-react'

const AUTO_DISMISS_MS = 8000

type Listener = (msg: string | null) => void
let _listener: Listener | null = null
let _pending: string | null = null

/** Show a storage error toast. Safe to call from non-React code. */
export function showStorageError(message: string): void {
  if (_listener) {
    _listener(message)
  } else {
    _pending = message
  }
}

export default function StorageToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [closing, setClosing] = useState(false)

  const dismiss = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setMessage(null)
      setClosing(false)
    }, 150)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    _listener = (msg: string | null) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setMessage(msg)
      if (msg) {
        timerRef.current = setTimeout(() => {
          setClosing(true)
          setTimeout(() => {
            setMessage(null)
            setClosing(false)
          }, 150)
          timerRef.current = null
        }, AUTO_DISMISS_MS)
      }
    }
    // Flush any message that arrived before mount
    if (_pending) {
      _listener(_pending)
      _pending = null
    }
    return () => {
      _listener = null
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!message) return null

  return (
    <div className={`storage-toast ${closing ? 'storage-toast-out' : ''}`}>
      <AlertTriangle size={14} className="storage-toast-icon" />
      <span className="storage-toast-msg">{message}</span>
      <button className="storage-toast-close" onClick={dismiss} title="Dismiss">
        <X size={12} />
      </button>
    </div>
  )
}
