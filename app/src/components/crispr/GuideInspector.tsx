/**
 * One guide, explained.
 *
 * The score at the top of a column is only useful if the reason is one click
 * away, so this shows the terms that made it, the flags in full sentences,
 * and the deletions the break is likely to produce. The spacer is here as
 * text to copy, with the PAM marked but kept out of what the button copies:
 * the PAM belongs to the target, and ordering it with the spacer is a
 * mistake worth designing out.
 */

import { useMemo } from 'react'
import { Copy, Crosshair, Plus } from 'lucide-react'
import { useEditorStore } from '../../store'
import { guideDetail } from '../../crispr/score/guide'
import { guideKey, guideName } from '../../utils/guide-features'
import OffTargetList from './OffTargetList'
import { useOffTargetRun } from '../../hooks/useOffTargetRun'
import { SCOPE_LABEL } from '../../crispr/targets'
import { onTargetModelName } from '../../crispr/score/ontarget'
import { displayPosition } from '../../models/Document'
import { notify } from '../../toast'
import type { GuideCandidate, Nuclease } from '../../crispr/types'

interface Props {
  candidate: GuideCandidate
  nuclease: Nuclease
}

export default function GuideInspector({ candidate, nuclease }: Props) {
  const bases = useEditorStore(s => s.doc.sequence.bases)
  const topology = useEditorStore(s => s.doc.sequence.topology)
  const seqLen = useEditorStore(s => s.doc.sequence.length)
  const origin = useEditorStore(s => s.doc.metadata?.displayOrigin ?? 0)
  const readOnly = useEditorStore(s => s.readOnly)
  const applyGuides = useEditorStore(s => s.applyGuides)
  const reports = useEditorStore(s => s.offTargetReports)
  const scope = useEditorStore(s => s.offTargetScope)
  const searching = useEditorStore(s => s.offTargetRun !== null)
  const { run, ready } = useOffTargetRun()

  const { site } = candidate
  const detail = useMemo(
    () => guideDetail(site, nuclease, bases, topology),
    [site, nuclease, bases, topology],
  )
  const at = (i: number) => displayPosition(i, origin, seqLen)
  const threePrimePam = nuclease.pamSide === 'threePrime'

  const copySpacer = () => {
    navigator.clipboard.writeText(site.spacer)
      .then(() => notify.success('Spacer copied'))
      .catch(() => notify.error('Could not copy the spacer'))
  }

  const addOne = () => {
    const added = applyGuides([guideKey(site)])
    notify[added > 0 ? 'success' : 'info'](
      added > 0 ? 'Guide added as a feature' : 'That guide is already a feature',
    )
  }

  return (
    <div className="gi">
      <div className="gi-head">
        <span className="gi-title">{guideName(site, nuclease)}</span>
        <div className="gi-actions">
          <button className="btn btn-sm" onClick={copySpacer} title="Copy the spacer, without the PAM">
            <Copy size={12} /> Spacer
          </button>
          <button className="btn btn-sm" onClick={addOne} disabled={readOnly} title="Add this guide to the document as a feature">
            <Plus size={12} /> Feature
          </button>
        </div>
      </div>

      <div className="gi-seq">
        {threePrimePam ? (
          <>{site.spacer}<span className="gp-pam">{site.pam}</span></>
        ) : (
          <><span className="gp-pam">{site.pam}</span>{site.spacer}</>
        )}
      </div>

      <dl className="gi-grid">
        <dt>Protospacer</dt>
        <dd>{at(site.start)}..{at(site.end - 1)} on the {site.strand === 1 ? 'sense' : 'antisense'} strand</dd>
        <dt>Length</dt>
        <dd>{site.spacer.length} nt, GC {Math.round(detail.scores.gc * 100)}%</dd>
        <dt>Cut</dt>
        <dd>
          {nuclease.cleaves === 'none'
            ? 'none, this one binds without cutting'
            : site.cutTop === site.cutBottom
              ? `blunt, after ${at(site.cutTop - 1)}`
              : `after ${at(site.cutTop - 1)} and ${at(site.cutBottom - 1)}, a ${Math.abs(site.cutBottom - site.cutTop)} nt overhang`}
        </dd>
        {detail.scores.onTarget !== null && (
          <>
            <dt>Score</dt>
            <dd>{detail.scores.onTarget} of 100</dd>
          </>
        )}
        {reports[guideKey(site)] && (
          <>
            <dt>Specificity</dt>
            <dd>{reports[guideKey(site)].specificity} of 100, in what was searched</dd>
          </>
        )}
        {detail.scores.outOfFrame !== null && (
          <>
            <dt>Out of frame</dt>
            <dd>{Math.round(detail.scores.outOfFrame)}% of the predicted deletions</dd>
          </>
        )}
      </dl>

      <div className="gi-section">
        <div className="gi-section-title">{onTargetModelName(detail.onTarget.model)}</div>
        {detail.onTarget.terms.length > 0 ? (
          <div className="gi-terms">
            {detail.onTarget.terms.map((term, i) => (
              <div className="gi-term" key={i}>
                <span>{term.label}</span>
                <span className={`gi-term-delta${term.delta < 0 ? ' down' : ''}`}>
                  {term.delta > 0 ? '+' : ''}{term.delta}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <p className="gi-caveat">{detail.onTarget.caveat}</p>
      </div>

      {detail.scores.flags.length > 0 && (
        <div className="gi-section">
          <div className="gi-section-title">Flags</div>
          {detail.scores.flags.map(flag => (
            <p className="gi-flag" key={flag.id}>
              <span className={`gp-chip ${flag.severity}`}>{flag.label}</span>{' '}
              {flag.detail}
            </p>
          ))}
        </div>
      )}

      {reports[guideKey(site)] ? (
        <OffTargetList report={reports[guideKey(site)]} />
      ) : (
        <div className="gi-section gi-ot-ask">
          <button
            className="btn btn-sm"
            onClick={() => void run([guideKey(site)])}
            disabled={!ready}
            title="Look for other places this spacer could bind"
          >
            <Crosshair size={12} /> {searching ? 'Searching…' : 'Check off-targets'}
          </button>
          <span className="gi-caveat">in {SCOPE_LABEL[scope].toLowerCase()}</span>
        </div>
      )}

      {detail.repair && detail.repair.patterns.length > 0 && (
        <div className="gi-section">
          <div className="gi-section-title">Likely deletions</div>
          <table className="gi-deletions">
            <thead>
              <tr>
                <th>Size</th>
                <th>At</th>
                <th>Microhomology</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {detail.repair.patterns.slice(0, 6).map((p, i) => (
                <tr key={i}>
                  <td className={p.frameshift ? 'gi-shift' : undefined}>
                    {p.deletionLength} nt{p.frameshift ? ', shifts' : ''}
                  </td>
                  <td>{at(p.deletionStart)}</td>
                  <td className="gi-mh">{p.microhomology}</td>
                  <td>{Math.round((p.patternScore / detail.repair!.totalScore) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="gi-caveat">
            End joining often uses a short identical stretch either side of the break. These are the deletions this
            sequence makes available, weighted as Bae and colleagues weight them, not measured outcomes.
          </p>
        </div>
      )}
    </div>
  )
}
