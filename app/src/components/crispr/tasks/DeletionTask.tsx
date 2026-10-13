/**
 * Deletion: pairs of guides that take a region out.
 *
 * A pair is judged on what it costs beyond the region asked for, so the
 * overshoot is the first thing on the row, with the join it would leave next
 * to it. Opening the result makes a real document, because the question after
 * "which pair" is always "what does that leave me with".
 */

import { useMemo, useState } from 'react'
import { Scissors } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { planDeletion, DEFAULT_DELETION, type DeletionPair } from '../../../crispr/strategy/deletion'
import { deletionDocument } from '../../../crispr/strategy/document'
import { displayPosition } from '../../../models/Document'
import { notify } from '../../../toast'
import TargetSelect from './TargetSelect'
import { SELECTION_VALUE, useChosenTarget } from './target'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
}

export default function DeletionTask({ candidates, nuclease }: Props) {
  const [targetValue, setTargetValue] = useState(SELECTION_VALUE)
  const [flank, setFlank] = useState(DEFAULT_DELETION.flank)
  const [chosenPair, setChosenPair] = useState<number | null>(null)
  const chosen = useChosenTarget(targetValue)
  const doc = useEditorStore(s => s.doc)
  const circular = doc.sequence.topology === 'circular'
  const origin = doc.metadata?.displayOrigin ?? 0
  const setSelection = useEditorStore(s => s.setSelection)
  const openDocumentState = useEditorStore(s => s.openDocumentState)
  const at = (i: number) => displayPosition(i, origin, doc.sequence.length)

  const pairs = useMemo(() => {
    if (!chosen.region) return []
    return planDeletion(candidates, chosen.region, doc.sequence.bases, circular, nuclease, {
      ...DEFAULT_DELETION, flank,
    })
  }, [candidates, chosen.region, doc.sequence.bases, circular, nuclease, flank])

  const openResult = (pair: DeletionPair) => {
    openDocumentState(deletionDocument(doc, pair, nuclease.name))
    notify.success(`${pair.length.toLocaleString('en-US')} bp removed in a new sequence`)
  }

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <TargetSelect value={targetValue} onChange={setTargetValue} label="Region to remove" />
        <div className="gp-field">
          <label htmlFor="gp-flank">Cut within</label>
          <select id="gp-flank" value={flank} onChange={e => setFlank(Number(e.target.value))}>
            {[50, 100, 300, 1000].map(f => <option key={f} value={f}>{f} bp of the region</option>)}
          </select>
        </div>
        {!chosen.region && (
          <p className="gp-note gp-warn">Select a region, or choose a feature, to delete.</p>
        )}
      </div>

      {chosen.region && (
        <div className="gp-status">
          <span className="gp-status-count">
            {pairs.length} pair{pairs.length === 1 ? '' : 's'} around {chosen.label}
          </span>
        </div>
      )}

      <ul className="gp-list">
        {pairs.map((pair, i) => (
          <li
            key={`${pair.start}:${pair.end}`}
            className={`gp-row gp-pair${chosenPair === i ? ' sel' : ''}`}
            onClick={() => {
              setChosenPair(i)
              setSelection({ anchor: pair.start, caret: pair.end })
            }}
          >
            <div className="gp-row-main">
              <span className="gp-pos">{at(pair.start)}..{at(pair.end)}</span>
              <span className="gp-seq"><span className="gp-spacer-seq">{pair.junction}</span></span>
            </div>
            <div className="gp-scores">
              <span className="gp-score-strong">{pair.length.toLocaleString('en-US')} bp</span>
              <span title="Lost beyond the region asked for, left and right">
                +{pair.overshoot.left}/{pair.overshoot.right}
              </span>
            </div>
            <div className="gp-why">
              <span className="gp-why-plain">{pair.left.site.spacer}{pair.left.site.strand === 1 ? '+' : '-'}</span>
              <span className="gp-why-plain">{pair.right.site.spacer}{pair.right.site.strand === 1 ? '+' : '-'}</span>
              {pair.warnings.map(w => <span key={w} className="gp-why-warn">{w}</span>)}
            </div>
            {chosenPair === i && (
              <div className="gp-pair-actions">
                <button className="btn btn-sm" onClick={e => { e.stopPropagation(); openResult(pair) }}>
                  <Scissors size={12} /> Open the result
                </button>
              </div>
            )}
          </li>
        ))}
        {chosen.region && pairs.length === 0 && (
          <li className="gp-empty">
            No pair brackets {chosen.label} within {flank} bp. Widen the flank, or choose a nuclease with a
            commoner PAM.
          </li>
        )}
      </ul>
    </>
  )
}
