/**
 * The feature filter's options: how the list is laid out, whether it keeps
 * only the features where the selection is, and the filter's own syntax,
 * shown as terms to click rather than left for the user to guess.
 */

import { useRef, type RefObject } from 'react'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'

export type FeatureListView = 'type' | 'position'

const EXAMPLES: { term: string; means: string }[] = [
  { term: 'type:CDS', means: 'feature key contains CDS' },
  { term: 'len>500', means: 'longer than 500 (also <, >=, <=, 1k)' },
  { term: 'len:100-1k', means: 'between 100 and 1,000' },
  { term: 'strand:-', means: 'reverse strand (+, -, none)' },
]

export default function FeatureListOptions({
  view, onViewChange, inSelection, onInSelectionChange, onInsertTerm, onClose, triggerRef,
}: {
  view: FeatureListView
  onViewChange: (v: FeatureListView) => void
  inSelection: boolean
  onInSelectionChange: (on: boolean) => void
  onInsertTerm: (term: string) => void
  onClose: () => void
  triggerRef: RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDivElement>(null)
  usePopoverDismiss(true, onClose, ref, triggerRef)

  return (
    <div
      ref={ref}
      className="fs-options"
      role="dialog"
      aria-label="Filter options"
      onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); triggerRef.current?.focus() }
      }}
    >
      <div className="fs-options-label">Show</div>
      <div className="seg seg-sm fs-segmented fs-options-seg" role="radiogroup" aria-label="List layout">
        <button role="radio" aria-checked={view === 'type'} className={view === 'type' ? 'active' : ''} onClick={() => onViewChange('type')}>
          By Type
        </button>
        <button role="radio" aria-checked={view === 'position'} className={view === 'position' ? 'active' : ''} onClick={() => onViewChange('position')}>
          By Position
        </button>
      </div>
      <label className="fs-options-check">
        <input type="checkbox" checked={inSelection} onChange={e => onInSelectionChange(e.target.checked)} />
        Only features where the selection is
      </label>

      <div className="fs-options-label">Filter terms</div>
      <div className="fs-options-terms">
        {EXAMPLES.map(x => (
          <button key={x.term} className="fs-options-term" onClick={() => onInsertTerm(x.term)} title="Add to the filter">
            <code>{x.term}</code>
            <span>{x.means}</span>
          </button>
        ))}
      </div>
      <p className="fs-options-hint">
        Words match names, types and qualifier values; "quotes" keep a phrase together. All terms must match.
      </p>
    </div>
  )
}
