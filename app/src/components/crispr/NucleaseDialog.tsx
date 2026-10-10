/**
 * Describe a nuclease the app does not ship.
 *
 * A PAM, which side of the spacer it sits on, a spacer length and, if they
 * are known, the two cut positions. That is the whole model, so a published
 * variant or an in-house protein can be scanned the day it is read about.
 * Leaving the cut positions empty is allowed and means something precise:
 * the row finds sites but claims no cut, so nothing downstream pretends to
 * know where the break is.
 */

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import {
  checkCustomNuclease,
  customNuclease,
  MAX_PAM,
  MAX_SPACER,
  MIN_SPACER,
  type CustomNucleaseInput,
} from '../../crispr/nucleases'
import type { PamSide } from '../../crispr/types'

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the new nuclease's id once it is saved. */
  onSaved: (id: string) => void
}

export default function NucleaseDialog({ open, onClose, onSaved }: Props) {
  const addCustomNuclease = useEditorStore(s => s.addCustomNuclease)
  const [name, setName] = useState('')
  const [pam, setPam] = useState('NGG')
  const [pamSide, setPamSide] = useState<PamSide>('threePrime')
  const [spacerLength, setSpacerLength] = useState('20')
  const [cutSite, setCutSite] = useState('3')
  const [cutOpposite, setCutOpposite] = useState('3')

  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)

  const num = (s: string) => (s.trim() === '' ? undefined : Number(s))
  const input: CustomNucleaseInput = {
    name,
    pam,
    pamSide,
    spacerLength: Number(spacerLength),
    cutSite: num(cutSite),
    cutOpposite: num(cutOpposite),
  }
  const errors = checkCustomNuclease(input)
  const errorFor = (field: 'name' | 'pam' | 'spacerLength' | 'cut') =>
    errors.find(e => e.field === field)?.message

  const save = () => {
    if (errors.length > 0) return
    const id = `custom-${Date.now().toString(36)}`
    addCustomNuclease(customNuclease(input, id))
    onSaved(id)
    onClose()
  }

  if (!visible) return null

  return (
    <div
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      ref={backdropRef}
      onClick={e => { if (e.target === backdropRef.current) onClose() }}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      tabIndex={-1}
    >
      <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="nuclease-dialog-title">
        <div className="modal-header">
          <h3 className="modal-title" id="nuclease-dialog-title">Describe a nuclease</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="gp-settings">
            <div className="gp-field gp-field-wide">
              <label htmlFor="nd-name">Name</label>
              <input
                id="nd-name"
                className="input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="SpCas9-XYZ"
                spellCheck={false}
                autoFocus
              />
            </div>

            <div className="gp-field">
              <label htmlFor="nd-pam">PAM</label>
              <input
                id="nd-pam"
                className="input"
                value={pam}
                onChange={e => setPam(e.target.value.toUpperCase())}
                maxLength={MAX_PAM}
                spellCheck={false}
                style={{ width: '9ch' }}
              />
            </div>

            <div className="gp-field">
              <label htmlFor="nd-side">PAM side</label>
              <select id="nd-side" value={pamSide} onChange={e => setPamSide(e.target.value as PamSide)}>
                <option value="threePrime">After the spacer</option>
                <option value="fivePrime">Before the spacer</option>
              </select>
            </div>

            <div className="gp-field">
              <label htmlFor="nd-spacer">Spacer</label>
              <input
                id="nd-spacer"
                className="input"
                type="number"
                min={MIN_SPACER}
                max={MAX_SPACER}
                value={spacerLength}
                onChange={e => setSpacerLength(e.target.value)}
                style={{ width: '7ch' }}
              />
            </div>

            <div className="gp-field">
              <label htmlFor="nd-cut1">Cut, spacer strand</label>
              <input
                id="nd-cut1"
                className="input"
                type="number"
                value={cutSite}
                onChange={e => setCutSite(e.target.value)}
                style={{ width: '7ch' }}
              />
            </div>

            <div className="gp-field">
              <label htmlFor="nd-cut2">Cut, other strand</label>
              <input
                id="nd-cut2"
                className="input"
                type="number"
                value={cutOpposite}
                onChange={e => setCutOpposite(e.target.value)}
                style={{ width: '7ch' }}
              />
            </div>

            <p className="gp-note">
              Both cut positions are distances in bases from the PAM edge of the spacer, counted into the spacer.
              A blunt cutter three bases in from the PAM is 3 and 3. Leave both empty for a nuclease whose cut
              position you do not want to claim: it will find sites and score them, and report no cut.
            </p>
            {errors.length > 0 && (
              <p className="gp-note gp-warn">
                {errorFor('name') ?? errorFor('pam') ?? errorFor('spacerLength') ?? errorFor('cut')}
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={errors.length > 0}>
            Save nuclease
          </button>
        </div>
      </div>
    </div>
  )
}
