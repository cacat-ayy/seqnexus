/**
 * One candidate as a row, shared by every task.
 *
 * The tasks differ in why a guide is worth looking at, not in what a guide
 * is, so they all render this and add their own line underneath: which codon
 * a knockout cuts in, how many bystanders a base edit brings, where a tiled
 * guide sits.
 */

import type { ReactNode } from 'react'
import type { GuideCandidate, Nuclease } from '../../crispr/types'
import { guideKey } from '../../utils/guide-features'

interface Props {
  candidate: GuideCandidate
  nuclease: Nuclease
  /** Position as the document numbers it. */
  at: (i: number) => number
  selected: boolean
  picked: boolean
  /** Specificity from an off-target run, when there is one. */
  specificity?: number
  /** The task's own line, under the sequence. */
  extra?: ReactNode
  onClick: (candidate: GuideCandidate, e: React.MouseEvent) => void
}

export default function GuideRow({ candidate, nuclease, at, selected, picked, specificity, extra, onClick }: Props) {
  const { site, scores } = candidate
  const threePrime = nuclease.pamSide === 'threePrime'
  return (
    <li
      className={`gp-row${selected ? ' sel' : ''}${picked ? ' picked' : ''}`}
      onClick={e => onClick(candidate, e)}
      title="Click to select it in the sequence, Ctrl-click to pick it"
      data-key={guideKey(site)}
    >
      <div className="gp-row-main">
        <span className="gp-pos">{at(site.start)}{site.strand === 1 ? '+' : '-'}</span>
        <span className="gp-seq">
          {threePrime ? (
            <>
              <span className="gp-spacer-seq">{site.spacer}</span>
              <span className="gp-pam">{site.pam}</span>
            </>
          ) : (
            <>
              <span className="gp-pam">{site.pam}</span>
              <span className="gp-spacer-seq">{site.spacer}</span>
            </>
          )}
        </span>
      </div>
      <div className="gp-scores">
        {specificity !== undefined && (
          <span className={specificity < 50 ? 'gp-spec-low' : 'gp-spec'}>S {specificity}</span>
        )}
        {scores.onTarget !== null && <span className="gp-score-strong">{scores.onTarget}</span>}
        {scores.outOfFrame !== null && (
          <span title="Share of the predicted deletions that shift the frame">
            {Math.round(scores.outOfFrame)}% oof
          </span>
        )}
        <span title="GC content of the spacer">{Math.round(scores.gc * 100)}%</span>
      </div>
      {extra}
      {scores.flags.length > 0 && (
        <div className="gp-chips">
          {scores.flags.map(flag => (
            <span key={flag.id} className={`gp-chip ${flag.severity}`} title={flag.detail}>
              {flag.label}
            </span>
          ))}
        </div>
      )}
    </li>
  )
}
