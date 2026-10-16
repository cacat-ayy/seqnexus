/**
 * The Annotate panel's list of suggestions, one row per locus.
 *
 * A locus is a stretch of the document and every element suggested for it
 * (see suggestionLoci). Its row offers the best of them; the others sit
 * behind "N similar", where picking one swaps it in. An element found at
 * several places is a group with one row per place, so its copies can be
 * picked together; an element found once is a single line.
 *
 * Every row can be rejected: the element is not suggested in this document
 * again, until it is restored from the list at the bottom.
 */

import { EyeOff, RotateCcw } from 'lucide-react'
import { matchKey, type SuggestionLocus } from '../utils/auto-annotations'
import type { AnnotationMatch } from '../workers/annotate-list'
import type { RejectedSuggestion } from '../models/Document'
import Chevron from './Chevron'

interface RowActions {
  picks: ReadonlySet<string>
  readOnly: boolean
  onTogglePick: (key: string) => void
  onReject: (entries: RejectedSuggestion[]) => void
  /** Name of the imported database a match came from; null for the built-in one. */
  sourceOf: (m: AnnotationMatch) => string | null
}

const span = (m: AnnotationMatch) => `${m.start + 1}..${m.end}`
const asRejected = (m: AnnotationMatch): RejectedSuggestion => ({ name: m.refName, type: m.refType })

function Partial({ m }: { m: AnnotationMatch }) {
  if (m.coverage === undefined) return null
  return (
    <span
      className="ann-match-partial"
      title={`An end of this copy is missing: it covers ${m.coverage}% of the reference`}
    >
      partial {Math.round(m.coverage)}%
    </span>
  )
}

/** Rejection is by element, so it covers every copy of it in the document. */
function RejectButton({ m, actions }: { m: AnnotationMatch; actions: RowActions }) {
  if (actions.readOnly) return null
  return (
    <button
      className="ann-reject-btn"
      onClick={() => actions.onReject([asRejected(m)])}
      title={`Don't suggest ${m.refName} in this document`}
      aria-label={`Don't suggest ${m.refName} in this document`}
    >
      <EyeOff size={12} />
    </button>
  )
}

/** One stretch of the document: the element offered there, and the others behind it. */
function LocusRow({ locus, showName, expanded, onToggleExpand, actions }: {
  locus: SuggestionLocus
  /** False inside a group, whose header already names the element. */
  showName: boolean
  expanded: boolean
  onToggleExpand: () => void
  actions: RowActions
}) {
  const m = locus.shown
  const key = matchKey(m)
  const picked = actions.picks.has(key)
  const others = locus.members.length - 1
  const source = actions.sourceOf(m)
  return (
    <div className="ann-locus">
      <div className={`ann-locus-row${picked ? ' picked' : ''}${showName ? ' named' : ''}`}>
        <label className="ann-locus-main">
          <input
            type="checkbox"
            checked={picked}
            onChange={() => actions.onTogglePick(key)}
            aria-label={`Pick ${m.refName} at ${span(m)}`}
          />
          {showName ? (
            <>
              <span className="ann-swatch ann-match-swatch" style={{ backgroundColor: m.color }} />
              <span className="ann-locus-name" title={m.refName}>{m.refName}</span>
              <span className="ft-type-badge" title={m.refType}>{m.refType}</span>
            </>
          ) : (
            // Empty cells where the group header names the element, so the
            // positions line up with the rows of single elements.
            <><span /><span /><span /></>
          )}
          <span className="ann-match-pos">{span(m)}</span>
          <span className="ann-match-strand">{m.strand === 1 ? '→' : '←'}</span>
          <span className="ann-match-sim">{m.similarity}%</span>
          <span className="ann-locus-extra">
            <Partial m={m} />
            {source && <span className="ann-source-badge">{source}</span>}
          </span>
        </label>
        {others > 0 && (
          <button
            className="ann-alt-toggle"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            title={`${others} other element${others === 1 ? '' : 's'} match here; pick one to use it instead`}
          >
            <Chevron open={expanded} size={12} />
            {others} similar
          </button>
        )}
        <RejectButton m={m} actions={actions} />
      </div>
      {expanded && others > 0 && (
        <ul className="ann-alts" aria-label={`Elements that match at ${span(m)}`}>
          {locus.members.map(a => {
            const k = matchKey(a)
            const on = actions.picks.has(k)
            const src = actions.sourceOf(a)
            return (
              <li key={k} className={`ann-alt${on ? ' picked' : ''}`}>
                <label className="ann-locus-main">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => actions.onTogglePick(k)}
                    aria-label={`Pick ${a.refName} here`}
                  />
                  <span className="ann-swatch ann-match-swatch" style={{ backgroundColor: a.color }} />
                  <span className="ann-locus-name" title={a.refName}>{a.refName}</span>
                  <span className="ann-match-pos">{span(a)}</span>
                  <span className="ann-match-sim">{a.similarity}%</span>
                  <span className="ann-locus-extra">
                    <Partial m={a} />
                    {src && <span className="ann-source-badge">{src}</span>}
                  </span>
                </label>
                <RejectButton m={a} actions={actions} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export interface SuggestionGroup {
  /** Name and type of the element, unique in the list. */
  id: string
  name: string
  loci: SuggestionLocus[]
}

export function SuggestionList({
  groups, collapsed, onToggleCollapse, onToggleGroupPicks, expanded, onToggleExpand, actions,
}: {
  groups: SuggestionGroup[]
  /** Groups folded shut, by id. */
  collapsed: ReadonlySet<string>
  onToggleCollapse: (groupId: string) => void
  onToggleGroupPicks: (loci: SuggestionLocus[]) => void
  /** Loci whose alternatives are open, by the key of their best member. */
  expanded: ReadonlySet<string>
  onToggleExpand: (locusId: string) => void
  actions: RowActions
}) {
  const rowFor = (l: SuggestionLocus, showName: boolean) => {
    const id = matchKey(l.members[0])
    return (
      <LocusRow
        key={id}
        locus={l}
        showName={showName}
        expanded={expanded.has(id)}
        onToggleExpand={() => onToggleExpand(id)}
        actions={actions}
      />
    )
  }
  return (
    <>
      {groups.map(({ id: groupId, name, loci }) => {
        if (loci.length === 1) {
          return <div key={groupId} className="ann-result-group">{rowFor(loci[0], true)}</div>
        }
        const first = loci[0].shown
        const keys = loci.map(l => matchKey(l.shown))
        const allPicked = keys.every(k => actions.picks.has(k))
        const somePicked = !allPicked && keys.some(k => actions.picks.has(k))
        const isCollapsed = collapsed.has(groupId)
        const source = actions.sourceOf(first)
        return (
          <div key={groupId} className="ann-result-group">
            <div className="ann-result-name">
              <input
                type="checkbox"
                checked={allPicked}
                ref={el => { if (el) el.indeterminate = somePicked }}
                onChange={() => onToggleGroupPicks(loci)}
                aria-label={`Pick all ${loci.length} copies of ${name}`}
              />
              <button
                className="ann-result-head"
                onClick={() => onToggleCollapse(groupId)}
                aria-expanded={!isCollapsed}
              >
                <span className="ann-result-chevron"><Chevron open={!isCollapsed} size={14} /></span>
                <span className="ann-swatch ann-match-swatch" style={{ backgroundColor: first.color }} />
                <span className="ann-locus-name">{name}</span>
                <span className="ft-type-badge">{first.refType}</span>
                {source && <span className="ann-source-badge">{source}</span>}
                <span className="re-enzyme-count">{loci.length}×</span>
              </button>
              <RejectButton m={first} actions={actions} />
            </div>
            {!isCollapsed && loci.map(l => rowFor(l, false))}
          </div>
        )
      })}
    </>
  )
}

/** The elements rejected in this document, each one click from coming back. */
export function RejectedList({ rejected, readOnly, onRestore }: {
  rejected: readonly RejectedSuggestion[]
  readOnly: boolean
  onRestore: (entries?: RejectedSuggestion[]) => void
}) {
  if (rejected.length === 0) return null
  return (
    <details className="ann-rejected">
      <summary>
        Not suggested in this document: {rejected.length}
      </summary>
      <ul>
        {rejected.map(r => (
          <li key={`${r.name}\u0000${r.type}`}>
            <span className="ann-locus-name">{r.name}</span>
            <span className="ft-type-badge">{r.type}</span>
            {!readOnly && (
              <button
                className="ann-restore-btn"
                onClick={() => onRestore([r])}
                title={`Suggest ${r.name} again`}
                aria-label={`Suggest ${r.name} again`}
              >
                <RotateCcw size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && rejected.length > 1 && (
        <button className="btn btn-sm ann-restore-all" onClick={() => onRestore()}>
          Suggest all again
        </button>
      )}
    </details>
  )
}
