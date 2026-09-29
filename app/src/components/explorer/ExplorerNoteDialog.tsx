/**
 * Short free-text note on an explorer item.
 *
 * Deliberately a plain textarea rather than a rich editor: the note shows up
 * in the row's tooltip, so anything longer than a couple of lines would not
 * be readable where it is read.
 */

import { useCallback, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'

interface Props {
  open: boolean
  itemName: string
  initialNote: string
  onSave: (note: string) => void
  onCancel: () => void
}

export default function ExplorerNoteDialog({ open, itemName, initialNote, onSave, onCancel }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(initialNote)
  useFocusTrap(backdropRef, open)

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onCancel()
  }, [onCancel])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  return (
    <div
      ref={backdropRef}
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      onClick={handleBackdrop}
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      tabIndex={-1}
    >
      <div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ex-note-title">
        <div className="modal-header">
          <h3 className="modal-title" id="ex-note-title">Note on {itemName}</h3>
          <button className="modal-close" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <textarea
            className="ex-note-input"
            value={text}
            autoFocus
            rows={3}
            placeholder="What matters about this one"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              // Enter saves, Shift-Enter starts a line: the common case here
              // is one short sentence.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSave(text)
              }
            }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(text)}>Save</button>
        </div>
      </div>
    </div>
  )
}
