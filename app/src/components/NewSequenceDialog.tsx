import './NewSequenceDialog.css'
import { useState, useCallback, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { guessAlphabet, invalidCharacters, type Alphabet } from '../models/alphabet'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'

export interface NewSequenceResult {
  name: string
  description: string
  sequence: string
  topology: 'linear' | 'circular'
  alphabet: Alphabet
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

export default function NewSequenceDialog({ open, onClose, onSubmit }: Props) {
  const [name, setName] = useState('Untitled')
  const [description, setDescription] = useState('')
  const [sequence, setSequence] = useState('')
  const [topology, setTopology] = useState<'linear' | 'circular'>('linear')
  // The molecule follows the pasted letters until the user picks one; a
  // pasted peptide should not need a second click to be a protein.
  const [chosenAlphabet, setChosenAlphabet] = useState<Alphabet | null>(null)
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
      setChosenAlphabet(null)
      // Small delay so the DOM is rendered
      requestAnimationFrame(() => nameRef.current?.select())
    }
  }, [open])

  const cleaned = cleanSequence(sequence)
  const alphabet: Alphabet = chosenAlphabet ?? (cleaned ? guessAlphabet(cleaned) : 'dna')
  const protein = alphabet === 'protein'
  const invalid = cleaned ? invalidCharacters(cleaned, alphabet) : []

  const handleSubmit = useCallback(() => {
    if (invalid.length > 0) return
    onSubmit({
      name: name.trim() || 'Untitled',
      description: description.trim(),
      sequence: cleaned,
      topology: protein ? 'linear' : topology,
      alphabet,
    })
  }, [name, description, cleaned, topology, alphabet, protein, invalid.length, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit()
    }
  }, [onClose, handleSubmit])

  const { onMouseDown: handleBackdropClickDown, onClick: handleBackdropClick } = useBackdropDismiss(onClose)

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const count = cleaned.length

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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

          <div className="nsm-row">
            <div className="nsm-label">
              Molecule
              <div className="toggle-group" role="radiogroup" aria-label="Molecule">
                <button
                  className={`toggle-btn ${!protein ? 'active' : ''}`}
                  onClick={() => setChosenAlphabet('dna')}
                  type="button"
                  role="radio"
                  aria-checked={!protein}
                >
                  DNA
                </button>
                <button
                  className={`toggle-btn ${protein ? 'active' : ''}`}
                  onClick={() => setChosenAlphabet('protein')}
                  type="button"
                  role="radio"
                  aria-checked={protein}
                >
                  Protein
                </button>
              </div>
            </div>

            {/* A protein has no topology, so the choice goes away rather
                than sitting there disabled. */}
            {!protein && (
              <div className="nsm-label">
                Topology
                <div className="toggle-group" role="radiogroup" aria-label="Topology">
                  <button
                    className={`toggle-btn ${topology === 'linear' ? 'active' : ''}`}
                    onClick={() => setTopology('linear')}
                    type="button"
                    role="radio"
                    aria-checked={topology === 'linear'}
                  >
                    Linear
                  </button>
                  <button
                    className={`toggle-btn ${topology === 'circular' ? 'active' : ''}`}
                    onClick={() => setTopology('circular')}
                    type="button"
                    role="radio"
                    aria-checked={topology === 'circular'}
                  >
                    Circular
                  </button>
                </div>
              </div>
            )}
          </div>

          <label className="nsm-label">
            Sequence
            {count > 0 && (
              <span className="nsm-base-count">{count.toLocaleString()} {protein ? 'aa' : 'bp'}</span>
            )}
            <textarea
              className="input nsm-textarea"
              value={sequence}
              onChange={e => setSequence(e.target.value)}
              placeholder={protein ? 'Paste or type a protein sequence (FASTA accepted)…' : 'Paste or type a DNA or protein sequence (FASTA accepted)…'}
              spellCheck={false}
              rows={10}
            />
            {invalid.length > 0 && (
              <span className="nsm-error" role="alert">
                Not {protein ? 'amino acid' : 'nucleotide'} codes: {invalid.slice(0, 8).join(' ')}
              </span>
            )}
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={invalid.length > 0}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
