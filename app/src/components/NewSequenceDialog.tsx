import './NewSequenceDialog.css'
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { X } from 'lucide-react'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { guessAlphabet, invalidCharacters, type Alphabet } from '../models/alphabet'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
import { Sequence } from '../models/Sequence'
import type { DocumentState } from '../models/Document'
import { parseGenBankMulti } from '../io/genbank'
import { readPasted } from '../io/pasted'

export interface NewSequenceResult {
  /** One document per record; several when a multi-record FASTA or GenBank was pasted. */
  docs: DocumentState[]
  /** The folder several records are filed in. */
  folderName: string
}

interface Props {
  open: boolean
  /** Protein for New Protein: the molecule is set rather than guessed. */
  initialAlphabet?: Alphabet
  onClose: () => void
  onSubmit: (result: NewSequenceResult) => void
}

const looksLikeGenBank = (raw: string) => raw.trimStart().startsWith('LOCUS')

export default function NewSequenceDialog({ open, initialAlphabet = 'dna', onClose, onSubmit }: Props) {
  const [name, setName] = useState('Untitled')
  /** The name was typed, so a pasted header no longer fills it in. */
  const [nameTouched, setNameTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [descriptionTouched, setDescriptionTouched] = useState(false)
  const [sequence, setSequence] = useState('')
  const [topology, setTopology] = useState<'linear' | 'circular'>('linear')
  // The molecule follows the pasted letters until the user picks one; a
  // pasted peptide should not need a second click to be a protein.
  const [chosenAlphabet, setChosenAlphabet] = useState<Alphabet | null>(null)
  const sequenceRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  // The sequence is what the dialog is for, so it takes the focus; the name
  // usually comes from a pasted header.
  useEffect(() => {
    if (open) {
      setName('Untitled')
      setNameTouched(false)
      setDescription('')
      setDescriptionTouched(false)
      setSequence('')
      setTopology('linear')
      setChosenAlphabet(initialAlphabet === 'protein' ? 'protein' : null)
      // Small delay so the DOM is rendered
      requestAnimationFrame(() => sequenceRef.current?.focus())
    }
  }, [open, initialAlphabet])

  // A pasted GenBank record is read as one, features and all, rather than
  // having its header lines taken for residues.
  const genbank = useMemo(() => {
    if (!looksLikeGenBank(sequence)) return null
    try {
      return { docs: parseGenBankMulti(sequence), error: null }
    } catch (err) {
      return { docs: [], error: err instanceof Error ? err.message : String(err) }
    }
  }, [sequence])
  const records = useMemo(() => (genbank ? [] : readPasted(sequence)), [genbank, sequence])

  const several = genbank ? genbank.docs.length > 1 : records.length > 1
  const single = genbank ? genbank.docs[0] : null
  // A single record names the sequence; several are filed in a folder.
  const autoName = several ? 'New sequences' : single?.name ?? records[0]?.name ?? null
  const autoDescription = several ? null : single?.description ?? (records[0]?.description || null)
  const shownName = nameTouched ? name : (autoName ?? name)
  const shownDescription = descriptionTouched ? description : (autoDescription ?? description)

  const allBases = records.map(r => r.bases).join('')
  const alphabet: Alphabet = chosenAlphabet ?? (allBases ? guessAlphabet(allBases) : 'dna')
  const protein = alphabet === 'protein'
  /** The first record with letters that are not codes, and those letters. */
  const invalid = useMemo(() => {
    for (const r of records) {
      const bad = r.bases ? invalidCharacters(r.bases, alphabet) : []
      if (bad.length > 0) return { record: r.name, letters: bad }
    }
    return null
  }, [records, alphabet])
  const blocked = invalid !== null || (genbank !== null && (genbank.error !== null || genbank.docs.length === 0))

  const handleSubmit = useCallback(() => {
    if (blocked) return
    const typedName = shownName.trim() || 'Untitled'
    const typedDescription = shownDescription.trim()
    let docs: DocumentState[]
    if (genbank) {
      docs = genbank.docs.length === 1
        ? [{ ...genbank.docs[0], name: typedName, description: typedDescription || undefined }]
        : genbank.docs
    } else if (records.length > 1) {
      docs = records.map((r, i) => ({
        name: r.name || `${typedName} ${i + 1}`,
        description: r.description || undefined,
        sequence: new Sequence(r.bases, protein ? 'linear' : topology, alphabet),
        annotations: [],
      }))
    } else {
      docs = [{
        name: typedName,
        description: typedDescription || undefined,
        sequence: new Sequence(records[0]?.bases ?? '', protein ? 'linear' : topology, alphabet),
        annotations: [],
      }]
    }
    onSubmit({ docs, folderName: typedName })
  }, [blocked, shownName, shownDescription, genbank, records, protein, topology, alphabet, onSubmit])

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

  const recordCount = genbank ? genbank.docs.length : records.length
  const total = genbank
    ? genbank.docs.reduce((n, d) => n + d.sequence.length, 0)
    : allBases.length
  const genbankProtein = genbank !== null && genbank.docs.length > 0 && genbank.docs.every(d => d.sequence.alphabet === 'protein')
  const unit = genbank ? (genbankProtein ? 'aa' : 'bp') : protein ? 'aa' : 'bp'
  /** What the pasted text was read as, said before Create rather than after. */
  const detected = total === 0 ? null : [
    genbank ? 'GenBank' : (protein ? 'Protein' : 'DNA'),
    recordCount > 1 ? `${recordCount} records` : null,
    `${total.toLocaleString('en-US')} ${unit}`,
  ].filter(Boolean).join(' · ')
  const title = initialAlphabet === 'protein' ? 'New Protein' : 'New Sequence'
  /** Enter in a one-line field creates, as in any form. */
  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  return (
    <div className={closing ? 'modal-backdrop closing' : 'modal-backdrop'} onAnimationEnd={onAnimationEnd} ref={backdropRef} onMouseDown={handleBackdropClickDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="modal-dialog nsm-dialog" role="dialog" aria-modal="true" aria-labelledby="new-sequence-modal-title">
        <div className="modal-header">
          <h3 className="modal-title" id="new-sequence-modal-title">{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body nsm-body">
          <div className="nsm-field">
            <div className="nsm-field-head">
              <label className="nsm-label" htmlFor="nsm-sequence">Sequence</label>
              {detected && <span className="nsm-detected">{detected}</span>}
            </div>
            <textarea
              id="nsm-sequence"
              ref={sequenceRef}
              className="input nsm-textarea"
              value={sequence}
              onChange={e => setSequence(e.target.value)}
              placeholder={protein ? 'Paste or type a protein sequence…' : 'Paste or type a sequence…'}
              spellCheck={false}
              rows={9}
            />
            {invalid ? (
              <span className="nsm-error" role="alert">
                Not {protein ? 'amino acid' : 'nucleotide'} codes{records.length > 1 && invalid.record ? ` in ${invalid.record}` : ''}: {invalid.letters.slice(0, 8).join(' ')}
              </span>
            ) : genbank?.error ? (
              <span className="nsm-error" role="alert">Not a GenBank record that can be read: {genbank.error}</span>
            ) : (
              <span className="nsm-hint">
                FASTA and GenBank are read as such: a header names the sequence, and several records make several sequences.
              </span>
            )}
          </div>

          <div className="nsm-grid">
            <div className="nsm-field">
              <label className="nsm-label" htmlFor="nsm-name">{several ? 'Folder' : 'Name'}</label>
              <input
                id="nsm-name"
                className="input nsm-input"
                value={shownName}
                onChange={e => { setName(e.target.value); setNameTouched(true) }}
                onKeyDown={submitOnEnter}
                placeholder={several ? 'Folder name' : 'Sequence name'}
                spellCheck={false}
              />
            </div>
            {!several && (
              <div className="nsm-field">
                <label className="nsm-label" htmlFor="nsm-description">
                  Description <span className="field-optional">optional</span>
                </label>
                <input
                  id="nsm-description"
                  className="input nsm-input"
                  value={shownDescription}
                  onChange={e => { setDescription(e.target.value); setDescriptionTouched(true) }}
                  onKeyDown={submitOnEnter}
                  placeholder="Brief description"
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {/* A GenBank record says its own molecule and topology. */}
          {!genbank && (
            <div className="nsm-grid">
              <div className="nsm-field">
                <span className="nsm-label" id="nsm-molecule">Molecule</span>
                <div className="seg" role="radiogroup" aria-labelledby="nsm-molecule">
                  <button
                    className={!protein ? 'active' : ''}
                    onClick={() => setChosenAlphabet('dna')}
                    type="button"
                    role="radio"
                    aria-checked={!protein}
                  >
                    DNA
                  </button>
                  <button
                    className={protein ? 'active' : ''}
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
                  than sitting there disabled; a line takes its place so the
                  dialog does not change shape under the pointer. */}
              <div className="nsm-field">
                <span className="nsm-label" id="nsm-topology">Topology</span>
                {protein ? (
                  <span className="nsm-note">A protein is always linear.</span>
                ) : (
                  <div className="seg" role="radiogroup" aria-labelledby="nsm-topology">
                    <button
                      className={topology === 'linear' ? 'active' : ''}
                      onClick={() => setTopology('linear')}
                      type="button"
                      role="radio"
                      aria-checked={topology === 'linear'}
                    >
                      Linear
                    </button>
                    <button
                      className={topology === 'circular' ? 'active' : ''}
                      onClick={() => setTopology('circular')}
                      type="button"
                      role="radio"
                      aria-checked={topology === 'circular'}
                    >
                      Circular
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="nsm-footer-hint"><kbd className="menu-kbd">{isMac ? '⌘' : 'Ctrl+'}Enter</kbd> to create</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={blocked}>
            {several ? `Create ${recordCount} sequences` : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
