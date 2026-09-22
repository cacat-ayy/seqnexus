import './NewSequenceModal.css'
import { useState, useCallback, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'

export interface NewSequenceResult {
  name: string
  description: string
  sequence: string
  topology: 'linear' | 'circular'
}

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (result: NewSequenceResult) => void
}

/** Strips whitespace, digits, FASTA headers, and lowercases → uppercases. */
function cleanSequence(raw: string): string {
  const lines = raw.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    if (line.startsWith('>')) continue          // skip FASTA headers
    kept.push(line.replace(/[\s\d]/g, ''))      // strip whitespace + numbers
  }
  return kept.join('').toUpperCase()
}

/** Rough base count for the status line. */
function countBases(raw: string): number {
  return cleanSequence(raw).length
}

export default function NewSequenceModal({ open, onClose, onSubmit }: Props) {
  const [name, setName] = useState('Untitled')
  const [description, setDescription] = useState('')
  const [sequence, setSequence] = useState('')
  const [topology, setTopology] = useState<'linear' | 'circular'>('linear')
  const nameRef = useRef<HTMLInputElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // Focus name input on open
  useEffect(() => {
    if (open) {
      setName('Untitled')
      setDescription('')
      setSequence('')
      setTopology('linear')
      // Small delay so the DOM is rendered
      requestAnimationFrame(() => nameRef.current?.select())
    }
  }, [open])

  const handleSubmit = useCallback(() => {
    const cleaned = cleanSequence(sequence)
    onSubmit({
      name: name.trim() || 'Untitled',
      description: description.trim(),
      sequence: cleaned,
      topology,
    })
  }, [name, description, sequence, topology, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
  }, [onClose, handleSubmit])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose()
  }, [onClose])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const baseCount = countBases(sequence)

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog nsm-dialog" role="dialog" aria-modal="true" aria-labelledby="new-sequence-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="new-sequence-modal-title">New Sequence</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <label className="nsm-label">
            Name
            <input
              ref={nameRef}
              className="input nsm-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Sequence name"
              spellCheck={false}
            />
          </label>

          <label className="nsm-label">
            Description <span className="nsm-optional">(optional)</span>
            <input
              className="input nsm-input"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description"
              spellCheck={false}
            />
          </label>

          <label className="nsm-label">
            Topology
            <div className="toggle-group">
              <button
                className={`toggle-btn ${topology === 'linear' ? 'active' : ''}`}
                onClick={() => setTopology('linear')}
                type="button"
              >
                Linear
              </button>
              <button
                className={`toggle-btn ${topology === 'circular' ? 'active' : ''}`}
                onClick={() => setTopology('circular')}
                type="button"
              >
                Circular
              </button>
            </div>
          </label>

          <label className="nsm-label">
            Sequence
            {baseCount > 0 && (
              <span className="nsm-base-count">{baseCount.toLocaleString()} bp</span>
            )}
            <textarea
              className="input nsm-textarea"
              value={sequence}
              onChange={e => setSequence(e.target.value)}
              placeholder="Paste or type a DNA sequence (FASTA accepted)…"
              spellCheck={false}
              rows={10}
            />
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
