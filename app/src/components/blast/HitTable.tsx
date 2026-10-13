/**
 * The hits of one BLAST search, as a table: sortable by every number, each
 * row expanding to its alignments, checkable for turning into features.
 *
 * Every number in a row comes from the hit's best HSP (hsps[0]) except
 * coverage, which counts all of them, as NCBI's Query cover does.
 */

import { useCallback, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, MoreHorizontal } from 'lucide-react'
import type { BlastHit, BlastSearch } from '../../blast/types'
import { hitStrandOnDoc } from '../../blast/query'
import { formatEvalue, hitMatches, orientationText } from '../../blast/format'
import { recordUrl } from '../../blast/databases'
import HitAlignment from './HitAlignment'
import Chevron from '../Chevron'

/** The DOM id of a hit's row, for scrolling it into view from the plot. */
const rowDomId = (rid: string, idx: number) => `bd-row-${rid}-${idx}`

type SortKey = 'score' | 'evalue' | 'identity' | 'coverage' | 'length'
type SortDir = 'asc' | 'desc'

interface Props {
  search: BlastSearch
  filter: string
  checked: ReadonlySet<number>
  onToggleCheck: (idx: number) => void
  onSetChecked: (idxs: number[], on: boolean) => void
  /** A row pointed at, or left (null): the drawer highlights the hit on the sequence. */
  onHover?: (idx: number | null) => void
  /** A hit's range clicked: the drawer selects it in the sequence. */
  onSelectRange?: (idx: number) => void
  /** The row's actions button, at the button's position. */
  onActions?: (idx: number, at: { x: number; y: number }) => void
  hoveredIdx?: number | null
}

export default function HitTable({
  search, filter, checked, onToggleCheck, onSetChecked, onHover, onSelectRange, onActions, hoveredIdx,
}: Props) {
  const { result } = search
  const program = result.program
  const [sortKey, setSortKey] = useState<SortKey>('evalue')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())

  const rows = useMemo(() => {
    const list = result.hits.map((hit, idx) => ({ hit, idx })).filter(({ hit }) => hitMatches(hit, filter))
    const dir = sortDir === 'asc' ? 1 : -1
    const value = (h: BlastHit): number => {
      switch (sortKey) {
        case 'score': return h.topScore
        case 'evalue': return h.topEvalue
        case 'identity': return h.topIdentity
        case 'coverage': return h.queryCoverage
        case 'length': return h.hsps[0]?.alignLen ?? 0
      }
    }
    return list.sort((a, b) => (value(a.hit) - value(b.hit)) * dir || a.idx - b.idx)
  }, [result.hits, filter, sortKey, sortDir])

  const sortBy = useCallback((key: SortKey) => {
    if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    // Small E-values are good; for everything else, big is good.
    setSortDir(key === 'evalue' ? 'asc' : 'desc')
  }, [sortKey])

  const toggleExpand = (idx: number) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    return next
  })

  const shown = rows.map(r => r.idx)
  const allChecked = shown.length > 0 && shown.every(i => checked.has(i))
  const someChecked = !allChecked && shown.some(i => checked.has(i))

  const sortTh = (key: SortKey, label: string, title: string) => {
    const active = key === sortKey
    return (
      <th className={`bd-th-num${active ? ' bd-th-active' : ''}`} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button className="bd-sort-btn" title={title} onClick={() => sortBy(key)}>
          {label}
          {active && <span className="bd-sort-arrow" aria-hidden="true">{sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}</span>}
        </button>
      </th>
    )
  }

  return (
    <table className="bd-table">
      <colgroup>
        <col className="bd-col-check" />
        <col className="bd-col-expand" />
        <col />
        <col className="bd-col-num" />
        <col className="bd-col-num" />
        <col className="bd-col-bar" />
        <col className="bd-col-bar" />
        <col className="bd-col-num" />
        <col className="bd-col-range" />
        {onActions && <col className="bd-col-actions" />}
      </colgroup>
      <thead>
        <tr>
          <th className="bd-th-check">
            <input
              type="checkbox"
              aria-label="Select all shown hits"
              checked={allChecked}
              ref={el => { if (el) el.indeterminate = someChecked }}
              onChange={() => onSetChecked(shown, !allChecked)}
            />
          </th>
          <th><span className="bd-sr-only">Alignments</span></th>
          <th>Hit</th>
          {sortTh('score', 'Score', 'Bit score of the best alignment')}
          {sortTh('evalue', 'E-value', 'E-value of the best alignment')}
          {sortTh('identity', 'Identity', 'Identity of the best alignment')}
          {sortTh('coverage', 'Coverage', "Share of the query covered by all of the hit's alignments")}
          {sortTh('length', 'Aligned', 'Length of the best alignment')}
          <th className="bd-th-num" title="Where the best alignment lies on the query">Query range</th>
          {onActions && <th><span className="bd-sr-only">Actions</span></th>}
        </tr>
      </thead>
      {rows.map(({ hit, idx }) => {
          const hsp = hit.hsps[0]
          if (!hsp) return null
          const open = expanded.has(idx)
          const alignId = `bd-aln-${search.rid}-${idx}`
          const reversed = hitStrandOnDoc(search.query, program, hsp) < 0
          return (
            <HitRows
              key={idx}
              open={open}
              hovered={hoveredIdx === idx}
              onMouseEnter={onHover ? () => onHover(idx) : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
            >
              <tr
                id={rowDomId(search.rid, idx)}
                className={`bd-row${open ? ' bd-row-open' : ''}${hoveredIdx === idx ? ' bd-row-hover' : ''}`}
                onClick={() => toggleExpand(idx)}
              >
                <td className="bd-td-check" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={checked.has(idx)} onChange={() => onToggleCheck(idx)} aria-label={`Select ${hit.accession}`} />
                </td>
                <td className="bd-td-expand">
                  <button
                    className="bd-icon-btn"
                    aria-expanded={open}
                    aria-controls={open ? alignId : undefined}
                    aria-label={`${open ? 'Hide' : 'Show'} the alignments of ${hit.accession}`}
                    onClick={e => { e.stopPropagation(); toggleExpand(idx) }}
                  >
                    <Chevron open={open} size={13} />
                  </button>
                </td>
                <td className="bd-td-hit">
                  <div className="bd-hit-line">
                    <a
                      className="bd-accession"
                      href={recordUrl(hit.accession, result.database, program, search.service)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      title={search.service === 'ncbi' ? 'Open the record at NCBI' : 'Open the record at EMBL-EBI'}
                    >{hit.accession}</a>
                    <span className="bd-desc" title={hit.description}>{hit.description}</span>
                  </div>
                  {hit.sciName && <div className="bd-sci">{hit.sciName}</div>}
                </td>
                <td className="bd-td-num">{Math.round(hsp.bitScore)}</td>
                <td className="bd-td-num">{formatEvalue(hsp.evalue)}</td>
                <td className="bd-td-num"><Meter value={hit.topIdentity} digits={1} /></td>
                <td className="bd-td-num"><Meter value={hit.queryCoverage} digits={0} /></td>
                <td className="bd-td-num">{hsp.alignLen.toLocaleString('en-US')}</td>
                <td className="bd-td-num">
                  {onSelectRange ? (
                    <button
                      className="bd-range-btn"
                      title="Select this range in the sequence"
                      onClick={e => { e.stopPropagation(); onSelectRange(idx) }}
                    >{hsp.queryFrom.toLocaleString('en-US')}..{hsp.queryTo.toLocaleString('en-US')}</button>
                  ) : `${hsp.queryFrom}..${hsp.queryTo}`}
                  {reversed && (
                    <span className="bd-strand" title={`${orientationText(program, hsp) ?? 'Minus strand'}: the hit runs against the query`}>minus</span>
                  )}
                </td>
                {onActions && (
                  <td className="bd-td-actions">
                    <button
                      className="bd-icon-btn"
                      aria-label={`Actions for ${hit.accession}`}
                      title="Actions"
                      onClick={e => {
                        e.stopPropagation()
                        const r = e.currentTarget.getBoundingClientRect()
                        onActions(idx, { x: r.right, y: r.bottom })
                      }}
                    ><MoreHorizontal size={14} /></button>
                  </td>
                )}
              </tr>
              {open && (
                <tr className="bd-align-row">
                  <td colSpan={onActions ? 10 : 9}>
                    <HitAlignment hit={hit} program={program} id={alignId} />
                  </td>
                </tr>
              )}
            </HitRows>
          )
        })}
    </table>
  )
}

/** A row and its alignments, hovered as one: pointing at the alignments still points at the hit. */
function HitRows({ children, onMouseEnter, onMouseLeave }: {
  children: React.ReactNode
  open: boolean
  hovered: boolean
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  // A tbody per hit groups its two rows for the pointer without breaking the table.
  return <tbody className="bd-hit" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{children}</tbody>
}

/** A fraction as a percentage with a thin bar under it. */
function Meter({ value, digits }: { value: number; digits: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <span className="bd-meter">
      <span className="bd-meter-value">{pct.toFixed(digits)}%</span>
      <span className="bd-meter-track" aria-hidden="true"><span className="bd-meter-fill" style={{ width: `${pct}%` }} /></span>
    </span>
  )
}
