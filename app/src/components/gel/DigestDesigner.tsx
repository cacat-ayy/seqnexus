/**
 * The diagnostic digest designer, as an inspector tab.
 *
 * Pick the sequences a sample might be; get digests ranked by how clearly the
 * gel would tell them apart, each with a miniature of its band pattern. Apply
 * one and the gel is laid out for it: a ladder that fits, then one lane per
 * candidate. Applying is one undo step.
 */

import { useMemo, useState } from 'react'
import { Wand2, Check, X } from 'lucide-react'
import {
  designDigests, POOL_LABEL, DEFAULT_DESIGN_OPTIONS,
  type DigestDesign, type EnzymePool, type DesignCandidate,
} from '../../gel/designer'
import type { GelConditions } from '../../gel/model'
import type { SequenceSource } from '../../gel/simulate'
import { runLengthMm } from '../../gel/migration'
import { formatBp } from '../../gel/render/scene'
import type { SourceOption } from './LaneInspector'

interface Props {
  sources: SourceOption[]
  resolveSource: (id: string) => SequenceSource | null
  conditions: GelConditions
  /** Candidates ticked to begin with. */
  initialIds: string[]
  /** Listed first: the sequences on the gel and the one being viewed. */
  priorityIds: string[]
  onApply: (design: DigestDesign, candidateIds: string[]) => void
}

const LETTERS = 'ABCDEFGH'
const MAX_CANDIDATES = LETTERS.length
/** Show a search box once the list is longer than this. */
const SEARCH_FROM = 6

function verdict(d: DigestDesign, n: number): { label: string; tone: 'good' | 'ok' | 'weak' } {
  if (n < 2) return d.score > 0.85 ? { label: 'clean pattern', tone: 'good' } : { label: 'readable', tone: 'ok' }
  if (d.separationMm >= 3) return { label: 'clearly distinct', tone: 'good' }
  if (d.separationMm >= 1.8) return { label: 'distinct', tone: 'ok' }
  return { label: 'close, check carefully', tone: 'weak' }
}

/** A miniature gel: one lane per candidate, bands at their real positions. */
function MiniGel({ design, runMm }: { design: DigestDesign; runMm: number }) {
  const laneW = 22
  const gap = 8
  const h = 96
  const pad = 4
  const w = design.patterns.length * (laneW + gap) - gap + pad * 2
  const labelH = design.patterns.length > 1 ? 14 : 0
  return (
    <svg className="gw-dd-mini" width={w} height={h + labelH} viewBox={`0 0 ${w} ${h + labelH}`} aria-hidden="true">
      <rect x={0} y={0} width={w} height={h} rx={3} className="gw-dd-mini-gel" />
      {design.patterns.map((p, i) => {
        const x = pad + i * (laneW + gap)
        return (
          <g key={p.id}>
            <rect x={x} y={3} width={laneW} height={3} className="gw-dd-mini-well" />
            {p.bandMm.map((mm, j) => (
              <rect key={j} x={x + 1} y={8 + (mm / runMm) * (h - 12) - 1} width={laneW - 2} height={2.4} rx={1} className="gw-dd-mini-band" />
            ))}
            {design.patterns.length > 1 && (
              <text x={x + laneW / 2} y={h + 11} textAnchor="middle" className="gw-dd-mini-label">{LETTERS[i]}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default function DigestDesigner({ sources, resolveSource, conditions, initialIds, priorityIds, onApply }: Props) {
  const [picked, setPicked] = useState<string[]>(() => initialIds.filter(id => sources.some(s => s.id === id)).slice(0, MAX_CANDIDATES))
  const [pool, setPool] = useState<EnzymePool>(DEFAULT_DESIGN_OPTIONS.pool)
  const [pairs, setPairs] = useState(DEFAULT_DESIGN_OPTIONS.pairs)
  const [results, setResults] = useState<DigestDesign[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [appliedIdx, setAppliedIdx] = useState<number | null>(null)
  const runMm = runLengthMm(conditions)

  const [query, setQuery] = useState('')

  const names = useMemo(() => new Map(sources.map(s => [s.id, s.name])), [sources])

  // Sequences on the gel (and the one being viewed) first, then the rest by name.
  const ordered = useMemo(() => {
    const rank = (id: string) => { const i = priorityIds.indexOf(id); return i === -1 ? Infinity : i }
    return [...sources].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [sources, priorityIds])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? ordered.filter(s => s.name.toLowerCase().includes(q)) : ordered
  }, [ordered, query])

  const full = picked.length >= MAX_CANDIDATES
  // Letters only mean something once there are lanes to tell apart.
  const lettered = picked.length > 1

  const toggle = (id: string) => {
    setResults(null)
    setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_CANDIDATES ? p : [...p, id]))
  }

  const run = () => {
    const candidates: DesignCandidate[] = picked
      .map(id => ({ id, source: resolveSource(id) }))
      .filter((c): c is DesignCandidate => c.source !== null)
    setBusy(true)
    setAppliedIdx(null)
    // Let the button show that it is working before the search blocks.
    setTimeout(() => {
      setResults(designDigests(candidates, conditions, { ...DEFAULT_DESIGN_OPTIONS, pool, pairs }))
      setBusy(false)
    }, 20)
  }

  return (
    <div className="gw-inspector-body gw-dd">
      <div className="gw-section-title">Tell apart</div>
      <p className="gw-dd-help">
        Tick every sequence your sample could be, such as the clone you want, the empty vector,
        and the insert the wrong way round. With one ticked, you get a clean confirmatory digest.
      </p>

      {picked.length > 0 && (
        <div className="gw-dd-picked" aria-label="Picked sequences">
          {picked.map((id, i) => (
            <span
              key={id}
              className="gw-dd-chip"
              title={lettered ? `Lane ${LETTERS[i]} in the previews below` : undefined}
            >
              {lettered && <span className="gw-dd-letter">{LETTERS[i]}</span>}
              <span className="gw-dd-chip-name">{names.get(id) ?? id}</span>
              <button
                type="button"
                className="gw-dd-chip-x"
                aria-label={`Remove ${names.get(id) ?? id}`}
                onClick={() => toggle(id)}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {lettered && <div className="gw-field-hint gw-dd-hint">Letters mark each sequence's lane in the previews below.</div>}

      {sources.length > SEARCH_FROM && (
        <input
          className="gw-input"
          type="search"
          value={query}
          placeholder={`Search ${sources.length} sequences`}
          aria-label="Search sequences"
          onChange={e => setQuery(e.target.value)}
        />
      )}
      <div className="gw-dd-candidates" role="group" aria-label="Candidate sequences">
        {sources.length === 0 && <div className="gw-dd-empty">Open a sequence first.</div>}
        {sources.length > 0 && shown.length === 0 && <div className="gw-dd-empty">No sequences match "{query}".</div>}
        {shown.map(s => {
          const on = picked.includes(s.id)
          const blocked = !on && full
          return (
            <label
              key={s.id}
              className={`gw-dd-cand ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`}
              title={blocked ? `Up to ${MAX_CANDIDATES} sequences` : undefined}
            >
              <input type="checkbox" checked={on} disabled={blocked} onChange={() => toggle(s.id)} />
              <span className="gw-dd-name">{s.name}</span>
              <span className="gw-dd-meta">{formatBp(s.length)}, {s.topology}</span>
            </label>
          )
        })}
      </div>
      <div className={`gw-field-hint gw-dd-hint ${full ? 'warn' : ''}`}>
        {picked.length} of up to {MAX_CANDIDATES} picked
      </div>

      <label className="gw-field">
        <span className="gw-field-label">Enzymes</span>
        <select className="select gw-select" value={pool} onChange={e => { setPool(e.target.value as EnzymePool); setResults(null) }}>
          {(Object.keys(POOL_LABEL) as EnzymePool[]).map(p => <option key={p} value={p}>{POOL_LABEL[p]}</option>)}
        </select>
      </label>
      <label className="gw-check">
        <input type="checkbox" checked={pairs} onChange={e => { setPairs(e.target.checked); setResults(null) }} />
        Try pairs of enzymes too
      </label>

      <button className="btn btn-primary btn-sm gw-dd-run" onClick={run} disabled={picked.length === 0 || busy}>
        <Wand2 size={13} /> {busy ? 'Searching…' : 'Find digests'}
      </button>

      {results && (
        <>
          <div className="gw-section-title">
            Suggestions <span className="gw-count">{results.length}</span>
          </div>
          {results.length === 0 && (
            <div className="gw-field-hint">
              Nothing in this enzyme set separates these sequences on this gel. Try all enzymes, pairs, or another agarose percentage.
            </div>
          )}
          <ol className="gw-dd-results">
            {results.map((d, i) => {
              const v = verdict(d, picked.length)
              return (
                <li key={d.enzymes.join('+')} className="gw-dd-result">
                  <div className="gw-dd-result-head">
                    <span className="gw-dd-enzymes">{d.enzymes.join(' + ')}</span>
                    <span className={`gw-dd-verdict ${v.tone}`}>{v.label}</span>
                  </div>
                  <div className="gw-dd-result-body">
                    <MiniGel design={d} runMm={runMm} />
                    <div className="gw-dd-patterns">
                      {d.patterns.map((p, k) => (
                        <div key={p.id} className="gw-dd-pattern">
                          <span className="gw-dd-letter">{d.patterns.length > 1 ? LETTERS[k] : ''}</span>
                          <span className="gw-dd-pattern-name">{names.get(p.id) ?? p.id}</span>
                          <span className="gw-dd-sizes">{p.fragments.map(formatBp).join(', ')}</span>
                        </div>
                      ))}
                      {d.notes.length > 0 && <div className="gw-dd-notes">{d.notes.join(' · ')}</div>}
                      {d.alternatives.length > 0 && <div className="gw-dd-notes">Same result: {d.alternatives.join(', ')}</div>}
                    </div>
                  </div>
                  <button
                    className="gw-btn gw-dd-apply"
                    onClick={() => { onApply(d, picked); setAppliedIdx(i) }}
                  >
                    {appliedIdx === i ? <><Check size={13} /> On the gel</> : 'Put on the gel'}
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}
