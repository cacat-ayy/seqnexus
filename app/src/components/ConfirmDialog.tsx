import './ConfirmDialog.css'
import { useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

export interface ConfirmButton {
  label: string
  value: string
  variant?: 'default' | 'danger' | 'primary'
}

interface Props {
  open: boolean
  title: string
  message: string
  buttons: ConfirmButton[]
  onResult: (value: string | null) => void
}

/**
 * Generic confirmation dialog. Renders a modal with a message and
 * configurable buttons. Calls `onResult` with the button's `value`
 * or `null` if dismissed via backdrop/Escape/X.
 */
export default function ConfirmDialog({ open, title, message, buttons, onResult }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onResult(null)
  }, [onResult])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onResult(null)
  }, [onResult])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdrop} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="modal-header">
          <h3 className="modal-title" id="confirm-dialog-title">{title}</h3>
          <button className="modal-close" onClick={() => onResult(null)} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p className="confirm-message">{message}</p>
        </div>
        <div className="modal-footer">
          {buttons.map(btn => (
            <button
              key={btn.value}
              className={`btn ${btn.variant === 'danger' ? 'btn-danger' : btn.variant === 'primary' ? 'btn-primary' : ''}`}
              onClick={() => onResult(btn.value)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
