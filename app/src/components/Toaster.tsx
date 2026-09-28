import './Toaster.css'
/**
 * Renders the toast stack. Mounted once, near the root.
 *
 * Toasts live in two persistent live regions rather than one: a confirmation
 * ("Exported 3 files") should wait its turn, while a save failure should
 * interrupt. Both wrappers stay in the DOM even when empty, because assistive
 * technology only reliably announces content inserted into a region that
 * already existed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useToastStore, type Toast, type ToastSeverity } from '../toast'
import { useExitAnimation } from '../hooks/useExitAnimation'

/** Comfortably longer than the CSS exit animation (`--dur-fast`, 120 ms). */
const EXIT_FALLBACK_MS = 250

const ICONS = {
  success: CheckCircle2,
  info: Info,
  warning: AlertTriangle,
  error: XCircle,
} satisfies Record<ToastSeverity, typeof Info>

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore(s => s.dismiss)
  const [open, setOpen] = useState(true)
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)

  // Hovering or tabbing into a toast holds it open. Auto-dismiss exists to
  // keep the corner clear, not to snatch text away from someone reading it.
  const [held, setHeld] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (toast.duration <= 0 || held) return
    timerRef.current = setTimeout(() => setOpen(false), toast.duration)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [toast.duration, held])

  // The exit animation has played out; drop it from the store for real.
  useEffect(() => {
    if (!visible && !open) dismiss(toast.id)
  }, [visible, open, dismiss, toast.id])

  // Fallback for anywhere `animationend` never arrives: jsdom fires no
  // animations at all, and a reduced-motion stylesheet can suppress them.
  // `dismiss` is idempotent, so racing the effect above is harmless.
  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => dismiss(toast.id), EXIT_FALLBACK_MS)
    return () => clearTimeout(t)
  }, [closing, dismiss, toast.id])

  const handleAction = useCallback(() => {
    toast.action?.onClick()
    setOpen(false)
  }, [toast])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    }
  }, [])

  if (!visible) return null

  const Icon = ICONS[toast.severity]

  return (
    <div
      className={`toast toast-${toast.severity}${closing ? ' toast-closing' : ''}`}
      onAnimationEnd={onAnimationEnd}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onKeyDown={handleKeyDown}
    >
      <Icon size={14} className="toast-icon" aria-hidden="true" />
      <div className="toast-body">
        <span className="toast-message">{toast.message}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </div>
      {toast.action && (
        <button type="button" className="toast-action" onClick={handleAction}>
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        onClick={() => setOpen(false)}
        aria-label="Dismiss notification"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function Toaster() {
  const toasts = useToastStore(s => s.toasts)

  const polite = toasts.filter(t => t.severity === 'success' || t.severity === 'info')
  const assertive = toasts.filter(t => t.severity === 'warning' || t.severity === 'error')

  return (
    <div className="toaster" role="region" aria-label="Notifications">
      <div className="toaster-group" aria-live="polite" aria-atomic="false">
        {polite.map(t => <ToastItem key={t.id} toast={t} />)}
      </div>
      <div className="toaster-group" aria-live="assertive" aria-atomic="false">
        {assertive.map(t => <ToastItem key={t.id} toast={t} />)}
      </div>
    </div>
  )
}
