/**
 * Mutagenesis: select the bases to change (or put the caret where bases go
 * in), type what they should become, and get the primer pair for either a
 * back-to-back (Q5 SDM) or an overlapping (QuikChange) protocol. The mutant
 * sequence can be opened directly, which is what the PCR plus ligation (or
 * DpnI digest) gives back.
 */

import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../store'
import { designMutagenesis, type MutagenesisMethod } from '../../../primers/design/mutagenesis'
import { primerConstraints, type DesignSettings } from '../../../primers/design/settings'
import { TargetField } from './TargetField'
import { useSelectionTarget } from './target'
import PicksPanel from './PicksPanel'
import { openMutant } from './openProduct'

export default function MutagenesisTask({ settings }: { settings: DesignSettings }) {
  const doc = useEditorStore(s => s.doc)
  const setDesignPicks = useEditorStore(s => s.setDesignPicks)
  const n = doc.sequence.length
  const bases = doc.sequence.bases
  const t = useSelectionTarget(true)
  const [replacement, setReplacement] = useState('')
  const [method, setMethod] = useState<MutagenesisMethod>('back-to-back')

  const cleaned = replacement.toUpperCase().replace(/[^ACGT]/g, '')
  const design = useMemo(() => {
    if (!t.target) return null
    return designMutagenesis({
      template: bases,
      topology: doc.sequence.topology,
      at: t.target,
      replacement: cleaned,
      method,
      constraints: primerConstraints(settings),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.target?.start, t.target?.end, cleaned, method, bases, doc.sequence.topology, settings])

  useEffect(() => {
    if (design && !('error' in design)) {
      setDesignPicks({ forward: design.forward, reverse: design.reverse, probe: null })
    }
  }, [design, setDesignPicks])

  const ok = design && !('error' in design) ? design : null
  const target = t.target

  return (
    <>
      <section className="wb-section">
        <TargetField label="Change" hint="Select the bases to change, or click where bases should go in." t={t} n={n} />
        <div className="wb-row">
          <label htmlFor="wb-mut-to">To</label>
          <input
            id="wb-mut-to"
            className="input ft-input pl-seq-input"
            value={replacement}
            spellCheck={false}
            placeholder={target && target.start !== target.end ? 'empty deletes the selection' : 'bases to insert'}
            onChange={e => setReplacement(e.target.value)}
          />
        </div>
        {replacement && cleaned.length !== replacement.replace(/\s/g, '').length && (
          <div className="pl-error">Only A, C, G and T are used; other characters are ignored.</div>
        )}
        <div className="wb-row">
          <label>Design</label>
          <select className="input ft-select" value={method} onChange={e => setMethod(e.target.value as MutagenesisMethod)}>
            <option value="back-to-back">Back-to-back (Q5 SDM style)</option>
            <option value="overlapping">Overlapping (QuikChange style)</option>
          </select>
        </div>
        <div className="wb-hint">
          {method === 'back-to-back'
            ? 'The primers face away from each other and meet at the edit; the new bases ride on the forward primer’s 5′ end.'
            : 'Both primers carry the edit in the middle; sized to the QuikChange rule (Tm ≥ 78 °C).'}
        </div>
        {design && 'error' in design && <div className="pl-error">{design.error}</div>}
        {ok && (
          <>
            <div className="wb-target">{ok.summary}</div>
            <div className="wb-hint">
              {method === 'overlapping'
                ? `QuikChange Tm ${ok.tmForward.toFixed(1)} °C`
                : `Binding parts ${ok.tmForward.toFixed(1)} / ${ok.tmReverse.toFixed(1)} °C`}
            </div>
            {ok.warnings.map(w => <div key={w} className="wb-problem">{w}</div>)}
          </>
        )}
      </section>
      <PicksPanel
        settings={settings}
        note={ok ? `Mutagenesis (${method}): ${ok.summary}` : undefined}
        actions={ok && target && (
          <button
            className="btn btn-sm"
            onClick={() => openMutant(target, cleaned, ok.summary)}
            title="Open the sequence with the edit made, as the mutagenesis would give it"
          >
            Open mutant
          </button>
        )}
      />
    </>
  )
}
