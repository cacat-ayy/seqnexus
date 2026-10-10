/**
 * Knockout: guides ranked by where they cut in a gene.
 *
 * The row says which codon the cut falls in and how much of the gene is
 * behind it, because that is the fact the choice turns on, and the warnings
 * say when a guide is in one of the two places a knockout tends to fail: too
 * near the start, where translation can restart, or too late, where a
 * frameshifted protein keeps most of itself.
 */

import { useMemo, useState } from 'react'
import { useEditorStore } from '../../../store'
import { planKnockout, DEFAULT_KNOCKOUT } from '../../../crispr/strategy/knockout'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import GuideRow from '../GuideRow'
import TargetSelect from './TargetSelect'
import { SELECTION_VALUE, useChosenTarget } from './target'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
  onSelect: (candidate: GuideCandidate, e: React.MouseEvent) => void
}

export default function KnockoutTask({ candidates, nuclease, onSelect }: Props) {
  const [targetValue, setTargetValue] = useState(SELECTION_VALUE)
  const [window, setWindow] = useState<[number, number]>([DEFAULT_KNOCKOUT.windowStart, DEFAULT_KNOCKOUT.windowEnd])
  const chosen = useChosenTarget(targetValue)
  const seqLen = useEditorStore(s => s.doc.sequence.length)
  const circular = useEditorStore(s => s.doc.sequence.topology === 'circular')
  const origin = useEditorStore(s => s.doc.metadata?.displayOrigin ?? 0)
  const picks = useEditorStore(s => s.guidePicks)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const reports = useEditorStore(s => s.offTargetReports)
  const at = (i: number) => displayPosition(i, origin, seqLen)

  const plan = useMemo(() => {
    if (!chosen.coding) return null
    return planKnockout(candidates, chosen.coding, seqLen, circular, nuclease, {
      ...DEFAULT_KNOCKOUT, windowStart: window[0], windowEnd: window[1],
    })
  }, [candidates, chosen.coding, seqLen, circular, nuclease, window])

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <TargetSelect value={targetValue} onChange={setTargetValue} codingOnly label="Gene" />
        <div className="gp-field gp-field-wide">
          <label htmlFor="gp-ko-window">
            Prefer cuts between {Math.round(window[0] * 100)}% and {Math.round(window[1] * 100)}% of the gene
          </label>
          <div className="gp-range-pair">
            <input
              id="gp-ko-window"
              type="range"
              min={0}
              max={100}
              value={Math.round(window[0] * 100)}
              onChange={e => setWindow([Math.min(Number(e.target.value) / 100, window[1]), window[1]])}
            />
            <input
              type="range"
              aria-label="End of the preferred stretch"
              min={0}
              max={100}
              value={Math.round(window[1] * 100)}
              onChange={e => setWindow([window[0], Math.max(Number(e.target.value) / 100, window[0])])}
            />
          </div>
        </div>
        {!chosen.coding && (
          <p className="gp-note gp-warn">
            Choose a coding feature. A knockout is judged by where the cut falls in the protein, which needs a gene
            to measure against.
          </p>
        )}
      </div>

      {plan && (
        <>
          <div className="gp-status">
            <span className="gp-status-count">
              {plan.picks.length} in {plan.target.name}
              {plan.outside > 0 && <span className="gp-faint">{plan.outside} outside it</span>}
            </span>
          </div>
          <ul className="gp-list">
            {plan.picks.slice(0, 200).map(pick => {
              const key = guideKey(pick.candidate.site)
              return (
                <GuideRow
                  key={key}
                  candidate={pick.candidate}
                  nuclease={nuclease}
                  at={at}
                  selected={key === selectedKey}
                  picked={picks.has(key)}
                  specificity={reports[key]?.specificity}
                  onClick={onSelect}
                  extra={
                    <div className="gp-why">
                      <span className={pick.inWindow ? 'gp-why-good' : 'gp-why-plain'}>{pick.reasons[0]}</span>
                      {pick.reasons[1] && <span className="gp-why-plain">{pick.reasons[1]}</span>}
                      {pick.warnings.map(w => (
                        <span key={w} className="gp-why-warn" title={w}>{w}</span>
                      ))}
                    </div>
                  }
                />
              )
            })}
            {plan.picks.length === 0 && (
              <li className="gp-empty">No guide cuts inside {plan.target.name}.</li>
            )}
          </ul>
        </>
      )}
    </>
  )
}
