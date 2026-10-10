/**
 * Tiling: a spaced set across a region.
 *
 * What a tiling set is judged on is coverage, so the gaps are reported as
 * plainly as the picks. The table is the deliverable, so it copies out in one
 * click, and the whole set can become features in one step.
 */

import { useMemo, useState } from 'react'
import { ClipboardCopy, Plus } from 'lucide-react'
import { useEditorStore } from '../../../store'
import { planTiling, tilingCsv, DEFAULT_TILE } from '../../../crispr/strategy/tile'
import { guideKey } from '../../../utils/guide-features'
import { displayPosition } from '../../../models/Document'
import { notify } from '../../../toast'
import GuideRow from '../GuideRow'
import TargetSelect from './TargetSelect'
import { WHOLE_VALUE, useChosenTarget } from './target'
import type { GuideCandidate, Nuclease } from '../../../crispr/types'

interface Props {
  candidates: readonly GuideCandidate[]
  nuclease: Nuclease
  onSelect: (candidate: GuideCandidate, e: React.MouseEvent) => void
}

export default function TileTask({ candidates, nuclease, onSelect }: Props) {
  const [targetValue, setTargetValue] = useState(WHOLE_VALUE)
  const [spacing, setSpacing] = useState(DEFAULT_TILE.spacing)
  const [count, setCount] = useState(DEFAULT_TILE.count)
  const chosen = useChosenTarget(targetValue)
  const doc = useEditorStore(s => s.doc)
  const seqLen = doc.sequence.length
  const circular = doc.sequence.topology === 'circular'
  const origin = doc.metadata?.displayOrigin ?? 0
  const picks = useEditorStore(s => s.guidePicks)
  const selectedKey = useEditorStore(s => s.selectedGuideKey)
  const reports = useEditorStore(s => s.offTargetReports)
  const applyGuides = useEditorStore(s => s.applyGuides)
  const readOnly = useEditorStore(s => s.readOnly)
  const at = (i: number) => displayPosition(i, origin, seqLen)

  // Without a region the whole sequence is tiled, worked out inside the memo
  // so an absent choice does not look like a new object every render.
  const plan = useMemo(
    () => planTiling(
      candidates,
      chosen.region ?? { start: 0, end: seqLen },
      seqLen, circular, nuclease,
      { spacing, count, skipFlagged: true },
    ),
    [candidates, chosen.region, seqLen, circular, nuclease, spacing, count],
  )

  return (
    <>
      <div className="gp-settings gp-settings-tight">
        <TargetSelect value={targetValue} onChange={setTargetValue} whole label="Across" />
        <div className="gp-field">
          <label htmlFor="gp-spacing">At least</label>
          <select id="gp-spacing" value={spacing} onChange={e => setSpacing(Number(e.target.value))}>
            {[20, 50, 100, 250, 500, 1000].map(s => <option key={s} value={s}>{s} bp apart</option>)}
          </select>
        </div>
        <div className="gp-field">
          <label htmlFor="gp-count">How many</label>
          <select id="gp-count" value={count} onChange={e => setCount(Number(e.target.value))}>
            {[5, 10, 20, 50, 100].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="gp-status">
        <span className="gp-status-count">
          {plan.picks.length} across {chosen.label}
          {plan.gaps.length > 0 && (
            <span className="gp-warn" title={plan.gaps.map(([a, b]) => `${at(a)}..${at(b)}`).join(', ')}>
              {plan.gaps.length} gap{plan.gaps.length === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <div className="gi-actions">
          <button
            className="btn btn-sm"
            disabled={plan.picks.length === 0}
            onClick={() => {
              navigator.clipboard.writeText(tilingCsv(plan, nuclease.name))
                .then(() => notify.success('Table copied'))
                .catch(() => notify.error('Could not copy the table'))
            }}
          >
            <ClipboardCopy size={12} /> Table
          </button>
          <button
            className="btn btn-sm"
            disabled={plan.picks.length === 0 || readOnly}
            onClick={() => {
              const added = applyGuides(plan.picks.map(p => guideKey(p.candidate.site)))
              notify[added > 0 ? 'success' : 'info'](
                added > 0 ? `${added} added as features` : 'They are features already',
              )
            }}
          >
            <Plus size={12} /> Features
          </button>
        </div>
      </div>

      <ul className="gp-list">
        {plan.picks.map((pick, i) => {
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
                  <span className="gp-why-plain">#{i + 1}, cuts at {at(pick.cut)}</span>
                  {i > 0 && (
                    <span className="gp-why-plain">{pick.cut - plan.picks[i - 1].cut} bp from the one before</span>
                  )}
                </div>
              }
            />
          )
        })}
        {plan.picks.length === 0 && (
          <li className="gp-empty">Nothing to tile here. Widen the region or allow guides closer together.</li>
        )}
        {plan.gaps.length > 0 && (
          <li className="gp-more">
            No guide between: {plan.gaps.map(([a, b]) => `${at(a)}..${at(b)}`).join(', ')}
          </li>
        )}
      </ul>
    </>
  )
}
