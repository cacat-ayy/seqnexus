/**
 * Where a search's hits lie on its query: a ruler over the query, the query's
 * own features, then one line per hit with a bar for each of its HSPs.
 *
 * A range plot, read for position and overlap, with score as the one
 * colour channel: a single-hue sequential ramp in NCBI's five score bins,
 * lighter for weaker. The hit table below is its table view, so the plot is
 * hidden from screen readers and the keyboard, which have the table; the
 * pointer gets a tooltip, and the hit pointed at is highlighted in the
 * sequence and the map.
 */

import { useMemo, useState } from 'react'
import { useEditorStore } from '../../store'
import { docRangeToQuery } from '../../blast/query'
import { formatEvalue } from '../../blast/format'
import type { BlastSearch } from '../../blast/types'
import { defaultColorForType } from '../../models/Annotation'
import { contrastText } from '../../utils/color'
import { useClampedPosition } from '../../hooks/useClampedPosition'

/** NCBI's score bins for its graphic summary, by bit score. */
const SCORE_BINS: { min: number; label: string }[] = [
  { min: 0, label: '<40' },
  { min: 40, label: '40-50' },
  { min: 50, label: '50-80' },
  { min: 80, label: '80-200' },
  { min: 200, label: '≥200' },
]

const binOf = (score: number) => {
  let b = 0
  for (let i = 0; i < SCORE_BINS.length; i++) if (score >= SCORE_BINS[i].min) b = i
  return b
}

/** At most this many hit lines; the rest are in the table. */
const MAX_LINES = 30
/** At most this many lanes of features; a crowded query keeps its first ones. */
const MAX_FEATURE_LANES = 3

/** Tick positions on a query of `len`: round steps (1, 2 or 5 times a power of ten), about six of them. */
function ticks(len: number): number[] {
  if (len <= 1) return [1]
  const raw = len / 6
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw
  const out = [1]
  for (let t = step; t < len; t += step) out.push(t)
  if (len - out[out.length - 1] > step / 3) out.push(len)
  else out[out.length - 1] = len
  return out
}

interface Props {
  search: BlastSearch
  /** The hits in the order the table shows them, so the two read alike. */
  order: number[]
  hoveredIdx: number | null
  onHover: (idx: number | null) => void
  onPick: (idx: number) => void
  /** Whether a click can select the hit (the query still lines up with the sequence). */
  canPick: boolean
}

export default function HitMap({ search, order, hoveredIdx, onHover, onPick, canPick }: Props) {
  const { result, query } = search
  const len = Math.max(1, result.queryLen)
  const pct = (pos: number) => `${(Math.max(0, Math.min(len, pos)) / len) * 100}%`
  const annotations = useEditorStore(s => s.doc.annotations)
  const [tip, setTip] = useState<{ idx: number; x: number; y: number } | null>(null)

  // The query's features, on the query's axis, packed into a few lanes.
  const lanes = useMemo(() => {
    const items = annotations
      .filter(a => a.type !== 'source')
      .flatMap(a => docRangeToQuery(query, a.start, a.end).map(([s, e]) => ({
        name: a.name, s, e, color: a.color ?? defaultColorForType(a.type),
      })))
      .sort((x, y) => x.s - y.s || y.e - x.e)
    const out: typeof items[] = []
    for (const it of items) {
      const lane = out.find(l => l[l.length - 1].e <= it.s)
      if (lane) lane.push(it)
      else if (out.length < MAX_FEATURE_LANES) out.push([it])
    }
    return out
  }, [annotations, query])

  const lines = order.slice(0, MAX_LINES)
  const more = order.length - lines.length
  const tipHit = tip ? result.hits[tip.idx] : null

  return (
    <div className="bd-map" aria-hidden="true">
      <div className="bd-map-head">
        <span className="bd-map-title">Hits on the query</span>
        <span className="bd-map-legend">
          <span className="bd-map-legend-label">Max score</span>
          {SCORE_BINS.map((b, i) => (
            <span key={b.label} className="bd-map-key">
              <span className={`bd-map-swatch bd-bin-${i}`} />
              {b.label}
            </span>
          ))}
        </span>
      </div>

      <div className="bd-map-plot">
        <div className="bd-map-axis">
          {ticks(len).map(t => (
            <span key={t} className="bd-map-tick" style={{ left: pct(t - 1) }}>
              <span className={`bd-map-tick-label${t === 1 ? ' bd-first' : t === len ? ' bd-last' : ''}`}>{t.toLocaleString()}</span>
            </span>
          ))}
        </div>
        <div className="bd-map-query" title={`${query.label}: ${len.toLocaleString()} ${query.translation ? 'aa' : 'bp'}`} />

        {lanes.map((lane, li) => (
          <div key={li} className="bd-map-lane">
            {lane.map((f, fi) => (
              // A feature's colour is the document's data, so it is drawn as
              // stored, with black or white text by its luminance.
              <span
                key={fi}
                className="bd-map-feature"
                style={{ left: pct(f.s), width: pct(f.e - f.s), background: f.color, color: contrastText(f.color) }}
                title={f.name}
              >{f.name}</span>
            ))}
          </div>
        ))}

        <div className="bd-map-hits" onMouseLeave={() => { setTip(null); onHover(null) }}>
          {lines.map(idx => {
            const hit = result.hits[idx]
            const from = Math.min(...hit.hsps.map(h => h.queryFrom))
            const to = Math.max(...hit.hsps.map(h => h.queryTo))
            return (
              <div
                key={idx}
                className={`bd-map-line${hoveredIdx === idx ? ' bd-map-line-hover' : ''}`}
                onMouseEnter={() => onHover(idx)}
                onMouseMove={e => setTip({ idx, x: e.clientX, y: e.clientY })}
                onClick={canPick ? () => onPick(idx) : undefined}
              >
                {hit.hsps.length > 1 && (
                  <span className="bd-map-join" style={{ left: pct(from - 1), width: pct(to - from + 1) }} />
                )}
                {hit.hsps.map((h, hi) => (
                  <span
                    key={hi}
                    className={`bd-map-bar bd-bin-${binOf(h.bitScore)}`}
                    style={{ left: pct(h.queryFrom - 1), width: pct(h.queryTo - h.queryFrom + 1) }}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {more > 0 && <div className="bd-map-more">{more.toLocaleString()} more {more === 1 ? 'hit' : 'hits'} in the table</div>}

      {tip && tipHit && (
        <MapTip x={tip.x} y={tip.y}>
          <div className="bd-map-tip-title"><span className="bd-map-tip-acc">{tipHit.accession}</span> {tipHit.description}</div>
          {tipHit.sciName && <div className="bd-map-tip-sci">{tipHit.sciName}</div>}
          <div className="bd-map-tip-meta">
            Score {Math.round(tipHit.topScore)} · E {formatEvalue(tipHit.topEvalue)} · {(tipHit.topIdentity * 100).toFixed(1)}% identity
            {' · '}query {tipHit.hsps[0].queryFrom.toLocaleString()}..{tipHit.hsps[0].queryTo.toLocaleString()}
            {tipHit.hsps.length > 1 && ` and ${tipHit.hsps.length - 1} more`}
          </div>
          {canPick && <div className="bd-map-tip-hint">Click to select it in the sequence</div>}
        </MapTip>
      )}
    </div>
  )
}

/** The tooltip, beside the pointer and kept on screen: the drawer is at the bottom of the window. */
function MapTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const { ref, pos } = useClampedPosition(x + 14, y + 14, { flip: true })
  return <div ref={ref} className="bd-map-tip" style={{ left: pos.left, top: pos.top }}>{children}</div>
}
