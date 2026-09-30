/**
 * The candidate landscape: every primer the search found, over the window
 * it searched.
 *
 * Forward candidates stand above the line at their 3' end, reverse ones hang
 * below it at theirs; taller and greener is better. Clicking a tick picks
 * that side on its own, which is what the old list of pre-made pairs could
 * not do: keep a forward primer you like and try reverse primers against it.
 */

import { useMemo, useRef, useState } from 'react'
import type { Candidate, DesignResult, Region } from '../../primers/design/types'
import type { BindingSite } from '../../primers/binding'
import { penaltyQuality as quality, type PenaltyQuality } from '../../primers/display'

const W = 1000
const H = 76
const MID = 38

type Quality = PenaltyQuality

/** Taller for better candidates, never so short it cannot be seen. */
const tickH = (penalty: number) => 6 + 26 * Math.max(0, 1 - penalty / 12)

interface Props {
  result: DesignResult
  excluded: Region[]
  circular: boolean
  /** Where the current picks bind, to mark them on the track. */
  picked: { forward: BindingSite | null; reverse: BindingSite | null; probe: BindingSite | null }
  onPick: (role: 'forward' | 'reverse', candidate: Candidate) => void
}

export default function DesignTrack({ result, excluded, circular, picked, onPick }: Props) {
  const { window: win, target, seqLen: n } = result
  const span = Math.max(1, win.end - win.start)
  const x = (lin: number) => ((lin - win.start) / span) * W
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<{ role: 'forward' | 'reverse'; c: Candidate } | null>(null)

  /** A template position in the window's scan coordinates. */
  const toLin = (pos: number) => {
    if (!circular) return pos
    const copies = [pos, pos + n, pos + 2 * n]
    const mid = (win.start + win.end) / 2
    return copies.reduce((best, c) => (Math.abs(c - mid) < Math.abs(best - mid) ? c : best))
  }

  const paths = useMemo(() => {
    const out: Record<Quality, string[]> = { good: [], ok: [], poor: [] }
    for (const c of result.forward) {
      const px = x(c.linEnd)
      out[quality(c.penalty)].push(`M${px} ${MID - 3}V${MID - 3 - tickH(c.penalty)}`)
    }
    for (const c of result.reverse) {
      const px = x(c.linStart)
      out[quality(c.penalty)].push(`M${px} ${MID + 3}V${MID + 3 + tickH(c.penalty)}`)
    }
    return { good: out.good.join(''), ok: out.ok.join(''), poor: out.poor.join('') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const excludedRects = excluded.flatMap(r => {
    const end = r.start < r.end ? r.end : r.end + n
    const copies = circular ? [-1, 0, 1, 2, 3] : [0]
    return copies
      .map(k => [r.start + k * n, end + k * n] as const)
      .filter(([a, b]) => b > win.start && a < win.end)
  })

  /** Nearest candidate to the pointer, on the side the pointer is on. */
  const nearest = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const lin = win.start + ((clientX - rect.left) / rect.width) * span
    const role: 'forward' | 'reverse' = clientY - rect.top < (MID / H) * rect.height ? 'forward' : 'reverse'
    const list = role === 'forward' ? result.forward : result.reverse
    const pos = (c: Candidate) => (role === 'forward' ? c.linEnd : c.linStart)
    const tolerance = (8 / rect.width) * span
    let best: Candidate | null = null
    for (const c of list) {
      const d = Math.abs(pos(c) - lin)
      if (d <= tolerance && (!best || d < Math.abs(pos(best) - lin))) best = c
    }
    return best ? { role, c: best } : null
  }

  const pickBar = (site: BindingSite | null, y: number, cls: string) => {
    if (!site) return null
    const a = toLin(site.start)
    const b = a + (site.start < site.end ? site.end - site.start : n - site.start + site.end)
    return <rect className={cls} x={x(a)} y={y} width={Math.max(2, x(b) - x(a))} height={4} />
  }

  const fmt = (pos: number) => (((pos % n) + n) % n + 1).toLocaleString()

  return (
    <div className="wb-track">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${result.counts.forward} forward and ${result.counts.reverse} reverse candidates`}
        onPointerMove={e => setHover(nearest(e.clientX, e.clientY))}
        onPointerLeave={() => setHover(null)}
        onClick={e => {
          const hit = nearest(e.clientX, e.clientY)
          if (hit) onPick(hit.role, hit.c)
        }}
      >
        <rect className="wb-track-target" x={x(target.start)} y={0} width={x(target.end) - x(target.start)} height={H} />
        {excludedRects.map(([a, b], i) => (
          <rect key={i} className="wb-track-excluded" x={x(a)} y={0} width={Math.max(1, x(b) - x(a))} height={H} />
        ))}
        <line className="wb-track-axis" x1={0} x2={W} y1={MID} y2={MID} />
        <path className="wb-tick poor" d={paths.poor} />
        <path className="wb-tick ok" d={paths.ok} />
        <path className="wb-tick good" d={paths.good} />
        {pickBar(picked.forward, MID - 2 - 34, 'wb-track-pick')}
        {pickBar(picked.reverse, MID + 32, 'wb-track-pick')}
        {pickBar(picked.probe, MID - 2, 'wb-track-pick probe')}
        {hover && (
          <line
            className="wb-track-hover"
            x1={x(hover.role === 'forward' ? hover.c.linEnd : hover.c.linStart)}
            x2={x(hover.role === 'forward' ? hover.c.linEnd : hover.c.linStart)}
            y1={hover.role === 'forward' ? 0 : MID}
            y2={hover.role === 'forward' ? MID : H}
          />
        )}
      </svg>
      <div className="wb-track-scale">
        <span>{fmt(win.start)}</span>
        <span className="wb-track-legend">▲ forward · ▼ reverse · taller is better</span>
        <span>{fmt(win.end - 1)}</span>
      </div>
      <div className="wb-track-readout" aria-live="polite">
        {hover
          ? `${hover.role === 'forward' ? 'Forward' : 'Reverse'} ${fmt(hover.c.start)}..${fmt(hover.c.end - 1)} · ${hover.c.length} nt · Tm ${hover.c.tm.toFixed(1)} °C · penalty ${hover.c.penalty.toFixed(1)} — click to pick`
          : 'Hover a tick to inspect it, click to pick that side.'}
      </div>
    </div>
  )
}
