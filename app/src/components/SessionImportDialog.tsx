/**
 * Confirmation modal shown after selecting a session file for import.
 *
 * Asks the user to Replace or Merge the imported session.
 */

import { useRef, useCallback, useEffect } from 'react'
import { X, Replace, Merge } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import './SessionDialog.css'

interface Props {
  open: boolean
  filename: string
  tabCount: number
  readCount: number
  alignmentCount: number
  onClose: () => void
  onReplace: () => void
  onMerge: () => void
}

export default function SessionImportDialog({ open, filename, tabCount, readCount, alignmentCount, onClose, onReplace, onMerge }: Props) {
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  // This dialog holds only buttons and nothing autofocuses, so move focus into
  // it on open. Without this, Escape never reaches the handler above and
  // keyboard users stay stranded on the page behind the modal.
  useEffect(() => {
    if (open) backdropRef.current?.focus()
  }, [open])

  if (!visible) return null

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog session-dialog" role="dialog" aria-modal="true" aria-labelledby="session-import-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="session-import-modal-title">Import Session</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body session-body">
          <p className="session-name">
            <strong>{filename}</strong>
          </p>
          <p className="session-note">
            Contains {tabCount} sequence{tabCount !== 1 ? 's' : ''}
            {readCount > 0 && <>, {readCount} read{readCount !== 1 ? 's' : ''}</>}
            {alignmentCount > 0 && <>, {alignmentCount} alignment{alignmentCount !== 1 ? 's' : ''}</>}
          </p>
          <p className="session-note">
            How should this session be imported?
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={onMerge} title="Add imported items alongside existing ones">
            <Merge size={14} />
            Merge
          </button>
          <button className="btn btn-primary" onClick={onReplace} title="Clear current session and load imported data">
            <Replace size={14} />
            Replace
          </button>
        </div>
      </div>
    </div>
  )
}
