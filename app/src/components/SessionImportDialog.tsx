/**
 * Confirmation modal shown after selecting a session file for import.
 *
 * Asks the user to Merge the imported session into this one, or Replace
 * this one with it. Merge is the default: Replace removes everything open
 * now, so it is styled as the destructive choice and says how much goes.
 */

import { useRef, useCallback, useEffect } from 'react'
import { X, Replace, Merge } from 'lucide-react'
import { useEditorStore } from '../store'
import { describeSession, type RestoredSession } from '../persistence'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
import './SessionDialog.css'

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

interface Props {
  open: boolean
  filename: string
  session: RestoredSession | null
  onClose: () => void
  onReplace: () => void
  onMerge: () => void
}

export default function SessionImportDialog({ open, filename, session, onClose, onReplace, onMerge }: Props) {
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  const backdropRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<HTMLButtonElement>(null)
  useFocusTrap(backdropRef, open)
  const { onMouseDown: handleBackdropClickDown, onClick: handleBackdropClick } = useBackdropDismiss(onClose)
  /** Everything Replace would remove, as the explorer lists it. */
  const current = useEditorStore(s => s.tabs.length + s.sequencingReads.length + s.alignments.length
    + s.assemblies.length + s.contigs.filter(c => !s.assemblies.some(a => a.id === c.assemblyId)).length
    + s.gels.length + s.clones.length + s.oligos.length)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  // Focus starts on Merge, the choice that loses nothing, so Enter merges
  // and Escape reaches the handler above.
  useEffect(() => {
    if (open) requestAnimationFrame(() => mergeRef.current?.focus())
  }, [open])

  if (!visible) return null
  const holds = session ? describeSession(session) : ''

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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
            {holds ? `Contains ${holds}.` : 'This session is empty.'}
          </p>
          <p className="session-note">
            <strong>Merge</strong> adds it to what is open now.
            {current > 0 && <> <strong>Replace</strong> removes the {count(current, 'item', 'items')} open now first.</>}
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${current > 0 ? 'btn-danger' : ''}`} onClick={onReplace} title="Clear the current session and load the imported one">
            <Replace size={14} />
            Replace
          </button>
          <button ref={mergeRef} className="btn btn-primary" onClick={onMerge} title="Add the imported items alongside the existing ones">
            <Merge size={14} />
            Merge
          </button>
        </div>
      </div>
    </div>
  )
}
