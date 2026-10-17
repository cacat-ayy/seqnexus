/**
 * What a guide's search found, for the inspector.
 *
 * Each hit is two lines: the spacer, and the site under it with matching
 * bases as dots, so the mismatches are the only letters there are to read.
 * Where it is and what it sits in matter as much as how many bases differ, so
 * both are on the row, and a hit inside a coding feature is marked rather
 * than left for the reader to notice.
 */

import {
  mismatchDiagram,
  OFF_TARGET_MODELS,
  type OffTargetHit,
  type OffTargetReport,
} from '../../crispr/offtarget'
import { searchedLine } from '../../crispr/targets'

interface Props {
  report: OffTargetReport
  /** Hits shown before the list is cut off. */
  limit?: number
}

/** Coding features are the ones worth calling out. */
const CODING = new Set(['CDS', 'gene', 'exon', 'mRNA'])

function hitKey(hit: OffTargetHit, i: number): string {
  return `${hit.targetId}:${hit.start}:${hit.strand}:${i}`
}

export default function OffTargetList({ report, limit = 12 }: Props) {
  const shown = report.hits.slice(0, limit)
  const perfect = report.hits.filter(h => h.mismatches === 0 && !h.bulge).length

  return (
    <div className="gi-section">
      <div className="gi-section-title">
        Off-targets
        <span className="gi-spec" title={OFF_TARGET_MODELS[report.model].caveat}>
          {report.specificity} specificity, {OFF_TARGET_MODELS[report.model].name}
        </span>
      </div>

      <p className="gi-caveat">
        {OFF_TARGET_MODELS[report.model].caveat}
        {' '}
        {searchedLine(report.searched)}
        {' '}
        {report.hits.length === 0
          ? 'Nothing else this guide could bind was found there.'
          : `${report.hits.length} site${report.hits.length === 1 ? '' : 's'} found`}
        {report.hits.length > 0 && `, up to ${report.settings.maxMismatches} mismatch${report.settings.maxMismatches === 1 ? '' : 'es'}`}
        {report.hits.length > 0 && report.settings.bulges && ' and one unpaired base'}
        {report.hits.length > 0 && '.'}
        {report.truncated && ' The search stopped at its hit cap.'}
      </p>

      {perfect > 0 && (
        <p className="gi-flag">
          <span className="gp-chip bad">{perfect} perfect</span>{' '}
          This spacer matches somewhere else exactly. It cannot tell the two apart.
        </p>
      )}

      {shown.length > 0 && (
        <table className="gi-offtargets">
          <tbody>
            {shown.map((hit, i) => {
              const diagram = mismatchDiagram(report.spacer, hit)
              return (
                <tr key={hitKey(hit, i)}>
                  <td className="gi-ot-seq">
                    {[...diagram.site].map((ch, j) => (
                      <span key={j} className={ch === '.' ? 'gi-ot-same' : 'gi-ot-diff'}>{ch}</span>
                    ))}
                    <span className="gp-pam">{hit.pam}</span>
                  </td>
                  <td className="gi-ot-meta">
                    <span className="gi-ot-mm">
                      {hit.mismatches} mm
                      {hit.bulge ? `, ${hit.bulge.kind === 'dna' ? 'DNA' : 'RNA'} bulge` : ''}
                    </span>
                    <span className="gi-ot-where" title={hit.targetName}>
                      {hit.targetName} {hit.start + 1}{hit.strand === 1 ? '+' : '-'}
                    </span>
                    {hit.feature && (
                      <span className={CODING.has(hit.feature.type) ? 'gp-chip bad' : 'gp-chip'}>
                        {hit.feature.name}
                      </span>
                    )}
                    {hit.pamKind === 'alternative' && <span className="gp-chip">{hit.pam}</span>}
                  </td>
                  <td className="gi-ot-score">{(hit.score * 100).toFixed(hit.score >= 0.1 ? 0 : 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {report.hits.length > shown.length && (
        <p className="gi-caveat">
          Showing the {shown.length} likeliest of {report.hits.length}.
        </p>
      )}
    </div>
  )
}
