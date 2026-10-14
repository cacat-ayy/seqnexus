/**
 * One feature in the feature panel's list.
 *
 * Memoised with plain props: the list re-renders whenever the selection or
 * the hovered feature changes, and on a genome with thousands of features
 * only the rows whose state changed should redraw.
 */

import { memo, type ReactNode } from 'react'
import { Eye, EyeOff, Info, TriangleAlert } from 'lucide-react'
import type { Annotation } from '../../models/Annotation'
import type { Alphabet } from '../../models/alphabet'
import type { IssueMessage } from '../../utils/annotation-sequence'
import { annotationLength } from '../../utils/annotation-sequence'
import { featurePieces } from '../../utils/feature-location'
import { formatLength } from '../../utils/format'
import { rowDomId } from './feature-actions'


/**
 * Where the feature sits along the whole sequence, as a hairline under the
 * row: the parts of a joined feature, both ends of one across the origin.
 */
function LocationBar({ ann, seqLen }: { ann: Annotation; seqLen: number }) {
  const pieces = ann.segments ?? featurePieces(ann, seqLen)
  return (
    <span className="ft-loc" aria-hidden>
      {pieces.map(([s, e], k) => (
        <span
          key={k}
          className="ft-loc-fill"
          style={{ left: `${(s / seqLen) * 100}%`, width: `${Math.max(0.5, ((e - s) / seqLen) * 100)}%`, backgroundColor: ann.color }}
        />
      ))}
    </span>
  )
}

export interface FeatureRowProps {
  ann: Annotation
  seqLen: number
  alphabet: Alphabet
  issues: readonly IssueMessage[] | undefined
  expanded: boolean
  hidden: boolean
  picked: boolean
  /** The keyboard's row. */
  active: boolean
  /** Under the caret or the selection. */
  here: boolean
  /** Hovered here or on the map or sequence. */
  hovered: boolean
  showLocation: boolean
  /**
   * A row of the table in the panel along the bottom: the type, start, end
   * and length in columns of their own, lined up under the table's header.
   */
  wide?: boolean
  onClick: (e: React.MouseEvent, ann: Annotation) => void
  onDoubleClick: (ann: Annotation) => void
  onContextMenu: (e: React.MouseEvent, ann: Annotation) => void
  onToggleHidden: (ann: Annotation) => void
  onHover: (e: React.MouseEvent | null, ann: Annotation | null) => void
  children?: ReactNode
}

function FeatureRow({
  ann, seqLen, alphabet, issues, expanded, hidden, picked, active, here, hovered, showLocation, wide = false,
  onClick, onDoubleClick, onContextMenu, onToggleHidden, onHover, children,
}: FeatureRowProps) {
  const len = annotationLength(ann, seqLen)
  const warning = issues?.some(m => m.severity === 'warning') ?? false
  const classes = [
    'fs-item',
    expanded && 'expanded',
    hidden && 'dimmed',
    picked && 'picked',
    active && 'active',
    here && 'here',
    hovered && 'hovered',
    showLocation && 'with-loc',
    wide && 'wide',
  ].filter(Boolean).join(' ')

  const name = (
    <>
      <span className="ann-swatch" style={{ backgroundColor: ann.color }} />
      <span className="ft-name">{ann.name}</span>
      {ann.truncated && <span className="ft-truncated" title="Cut short at a cloning junction">truncated</span>}
      {issues && issues.length > 0 && (
        <span
          className={`ft-issue-icon ${warning ? 'warning' : 'note'}`}
          title={issues.map(m => m.text).join('\n')}
          aria-label={issues.map(m => m.text).join('. ')}
        >
          {warning ? <TriangleAlert size={11} /> : <Info size={11} />}
        </span>
      )}
    </>
  )

  return (
    <div id={rowDomId(ann.id)} className={classes} role="option" aria-selected={picked}>
      <div
        className="ft-summary"
        // Ctrl/Shift extend the multi-selection; a plain click selects the
        // feature's span in the sequence.
        onClick={e => onClick(e, ann)}
        onDoubleClick={() => onDoubleClick(ann)}
        onContextMenu={e => onContextMenu(e, ann)}
        onMouseEnter={e => onHover(e, ann)}
        onMouseLeave={() => onHover(null, null)}
      >
        {wide ? (
          <>
            <span className="ft-col-name">{name}</span>
            <span className="ft-col-type col-type" title={ann.type}>{ann.type}</span>
            <span className="ft-col-num">{(ann.start + 1).toLocaleString('en-US')}</span>
            <span className="ft-col-num col-end">{ann.end.toLocaleString('en-US')}</span>
            <span className="ft-col-num">{formatLength(len, alphabet)}</span>
          </>
        ) : (
          <>
            {name}
            <span className="ft-pos">
              <span className="ann-range">{ann.start + 1}..{ann.end}</span>
              <span className="ft-len">{formatLength(len, alphabet)}</span>
            </span>
          </>
        )}
        <span className="ft-strand-badge" aria-label={ann.strand === 1 ? 'forward' : ann.strand === -1 ? 'reverse' : 'no strand'}>
          {ann.strand === 1 ? '→' : ann.strand === -1 ? '←' : '·'}
        </span>
        <button
          className={`fs-eye-btn fs-eye-inline ${hidden ? 'hidden' : ''}`}
          // Out of the tab order: in the list the keyboard hides a feature
          // from its menu, and Tab should leave the list in one step.
          tabIndex={-1}
          onClick={e => { e.stopPropagation(); onToggleHidden(ann) }}
          title={hidden ? 'Show annotation' : 'Hide annotation'}
        >
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        {showLocation && seqLen > 0 && <LocationBar ann={ann} seqLen={seqLen} />}
      </div>
      {children}
    </div>
  )
}

export default memo(FeatureRow)
