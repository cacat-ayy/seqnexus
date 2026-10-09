/**
 * The charts of the quality report, each drawn as FastQC draws its module
 * (so the shapes are familiar) in the app's own style: a line chart for one
 * or more series along positions or bins, FastQC's box plot of quality by
 * position, and a heatmap of quality per tile.
 *
 * Each renders either the chart, at the width it is given, or the same
 * values as a table. Series colours come from tokens (--series-*, the base
 * colours); text stays in the text tokens.
 */

import { useEffect, useRef, useState } from 'react'
import type { PositionQuality } from '../../../ngs/types'
import { niceTicks } from '../../../utils/ticks'

const nf = new Intl.NumberFormat()
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const H = 220
const PAD = { left: 48, right: 12, top: 10, bottom: 38 }

/** A tick every `step` labels, `step` a round number, so that ticks are about 56 px apart. */
function tickStep(n: number, plotWidth: number): number {
  const want = Math.max(1, n / Math.max(2, Math.floor(plotWidth / 56)))
  return [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(s => s >= want) ?? Math.ceil(want)
}

export interface Series {
  name: string
  /** A colour class: s1 to s6 (--series-*), base-a/c/g/t, or accent. */
  color: string
  values: number[]
  dashed?: boolean
}

interface LineProps {
  width: number
  /** One label per point, as the x axis and the table show it. */
  labels: string[]
  series: Series[]
  xTitle: string
  yTitle: string
  /** Fixed top of the y axis (100 for percentages); otherwise from the data. */
  yMax?: number
  format?: (v: number) => string
  /** Label every point rather than a tick every few (few categories). */
  everyLabel?: boolean
  /** The labels count from 0 (GC percentages), so ticks fall on 0, 10, 20; otherwise from 1 (positions), on 1, 10, 20. */
  zeroBased?: boolean
  /** The hover readout's heading for a point. */
  pointTitle?: (i: number) => string
}

/** One or more series as lines, with a crosshair readout of every series at the pointed position. */
export function LineChart({ width, labels, series, xTitle, yTitle, yMax, format = v => nf.format(v), everyLabel = false, zeroBased = false, pointTitle = i => labels[i] }: LineProps) {
  const [hover, setHover] = useState<number | null>(null)
  const n = labels.length
  const dataMax = Math.max(0, ...series.flatMap(s => s.values))
  const ticks = niceTicks(yMax ?? dataMax)
  const top = yMax ?? (ticks[ticks.length - 1] || 1)
  const pw = Math.max(10, width - PAD.left - PAD.right)
  const ph = H - PAD.top - PAD.bottom
  // Points sit in the middle of equal slots, as FastQC's categories do.
  const slot = n ? pw / n : pw
  const x = (i: number) => PAD.left + slot * (i + 0.5)
  const y = (v: number) => PAD.top + ph - (Math.min(v, top) / top) * ph
  const step = everyLabel ? 1 : tickStep(n, pw)
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * n)
    setHover(i >= 0 && i < n ? i : null)
  }
  return (
    <div className="ngs-plot">
      {series.length > 1 && (
        <div className="ngs-legend qr-legend">
          {series.map(s => (
            <span key={s.name} className="ngs-key"><i className={`qr-swatch ${s.color}${s.dashed ? ' dashed' : ''}`} /> {s.name}</span>
          ))}
        </div>
      )}
      <svg width={width} height={H} role="img" aria-label={`${series.map(s => s.name).join(', ')} by ${xTitle.toLowerCase()}`}>
        {ticks.map(t => (
          <g key={t}>
            <line className="ngs-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="ngs-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{compact.format(t)}</text>
          </g>
        ))}
        <text className="qr-axis-title" transform={`translate(12,${PAD.top + ph / 2}) rotate(-90)`} textAnchor="middle">{yTitle}</text>
        {series.map(s => (
          <path key={s.name} className={`qr-line ${s.color}${s.dashed ? ' dashed' : ''}`}
            d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} />
        ))}
        <line className="ngs-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + ph} y2={PAD.top + ph} />
        {labels.map((l, i) => ((everyLabel || i === 0 || (zeroBased ? i : i + 1) % step === 0) && (
          <text key={i} className="ngs-axis" x={x(i)} y={PAD.top + ph + 14} textAnchor="middle">{l}</text>
        )))}
        <text className="qr-axis-title" x={PAD.left + pw / 2} y={H - 4} textAnchor="middle">{xTitle}</text>
        {hover !== null && <line className="ngs-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ph} />}
        {hover !== null && series.map(s => (
          <circle key={s.name} className={`qr-dot ${s.color}`} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} />
        ))}
        <rect className="ngs-hit" x={PAD.left} y={PAD.top} width={pw} height={ph} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="ngs-tip" style={{ left: Math.min(width - 190, Math.max(0, x(hover) - 95)), top: series.length > 1 ? 24 : 0 }}>
          <div className="ngs-tip-head">{pointTitle(hover)}</div>
          {series.map(s => (
            <div key={s.name} className="qr-tip-row">
              {series.length > 1 && <i className={`qr-swatch ${s.color}${s.dashed ? ' dashed' : ''}`} />}
              <span>{series.length > 1 ? `${s.name}: ` : ''}{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The same values as a table: one row per point, one column per series. */
export function SeriesTable({ labels, series, xTitle, format = v => nf.format(v) }: { labels: string[]; series: Series[]; xTitle: string; format?: (v: number) => string }) {
  return (
    <table className="rs-table">
      <thead><tr><th>{xTitle}</th>{series.map(s => <th key={s.name} className="num">{s.name}</th>)}</tr></thead>
      <tbody>
        {labels.map((l, i) => (
          <tr key={i} className="ngs-static">
            <td>{l}</td>
            {series.map(s => <td key={s.name} className="num">{format(s.values[i] ?? 0)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** FastQC's quality zones: good from Q28, reasonable from Q20, poor below. */
const ZONES = [{ from: 28, cls: 'good' }, { from: 20, cls: 'fair' }, { from: 0, cls: 'poor' }] as const

/**
 * FastQC's per base quality plot: at each position a box from the lower to
 * the upper quartile, whiskers from the 10th to the 90th percentile, a mark
 * at the median, and a line through the means, over the quality zones. When
 * positions are too narrow for boxes, the boxes become bands.
 */
export function QualityBoxChart({ width, positions }: { width: number; positions: PositionQuality[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const n = positions.length
  const qMax = Math.max(40, ...positions.map(p => p.p90))
  const pw = Math.max(10, width - PAD.left - PAD.right)
  const ph = H - PAD.top - PAD.bottom
  const slot = n ? pw / n : pw
  const x = (i: number) => PAD.left + slot * (i + 0.5)
  const y = (q: number) => PAD.top + ph - (Math.min(q, qMax) / qMax) * ph
  const boxes = slot >= 4
  const bw = Math.max(1, Math.min(14, slot - 2))
  const step = tickStep(n, pw)
  const band = (lo: (p: PositionQuality) => number, hi: (p: PositionQuality) => number) =>
    positions.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(hi(p))}`).join('')
    + positions.map((_, i) => `L${x(n - 1 - i)},${y(lo(positions[n - 1 - i]))}`).join('') + 'Z'
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor(((e.clientX - r.left) / r.width) * n)
    setHover(i >= 0 && i < n ? i : null)
  }
  const p = hover !== null ? positions[hover] : null
  return (
    <div className="ngs-plot">
      <div className="ngs-legend qr-legend">
        <span className="ngs-key"><i className="qr-swatch box" /> Middle 50%</span>
        <span className="ngs-key"><i className="qr-swatch whisker" /> Middle 80%</span>
        <span className="ngs-key"><i className="qr-swatch median" /> Median</span>
        <span className="ngs-key"><i className="qr-swatch s2" /> Mean</span>
        <span className="ngs-key"><i className="ngs-swatch zone good" /> Q28 and up</span>
        <span className="ngs-key"><i className="ngs-swatch zone fair" /> Q20 to 28</span>
        <span className="ngs-key"><i className="ngs-swatch zone poor" /> Below Q20</span>
      </div>
      <svg width={width} height={H} role="img" aria-label="Quality by position in read: quartiles, 10th and 90th percentiles, median and mean">
        {ZONES.map((z, k) => {
          const hi = k === 0 ? qMax : ZONES[k - 1].from
          return <rect key={z.cls} className={`ngs-zone ${z.cls}`} x={PAD.left} width={pw} y={y(hi)} height={y(z.from) - y(hi)} />
        })}
        {[0, 10, 20, 30, 40].filter(t => t <= qMax).map(t => (
          <text key={t} className="ngs-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
        ))}
        <text className="qr-axis-title" transform={`translate(12,${PAD.top + ph / 2}) rotate(-90)`} textAnchor="middle">Phred score</text>
        {boxes ? positions.map((q, i) => (
          <g key={i} className={hover === i ? 'qr-box hot' : 'qr-box'}>
            <line className="qr-whisker" x1={x(i)} x2={x(i)} y1={y(q.p90)} y2={y(q.p10)} />
            <rect className="qr-box-fill" x={x(i) - bw / 2} width={bw} y={y(q.p75)} height={Math.max(1, y(q.p25) - y(q.p75))} />
            <line className="qr-median" x1={x(i) - bw / 2} x2={x(i) + bw / 2} y1={y(q.p50)} y2={y(q.p50)} />
          </g>
        )) : n > 0 && (
          <>
            <path className="qr-band whisker" d={band(q => q.p10, q => q.p90)} />
            <path className="qr-band box" d={band(q => q.p25, q => q.p75)} />
            <path className="qr-line median" d={positions.map((q, i) => `${i ? 'L' : 'M'}${x(i)},${y(q.p50)}`).join('')} />
          </>
        )}
        {n > 0 && <path className="qr-line s2" d={positions.map((q, i) => `${i ? 'L' : 'M'}${x(i)},${y(q.mean)}`).join('')} />}
        {Array.from({ length: n }, (_, i) => i).filter(i => i === 0 || (i + 1) % step === 0).map(i => (
          <text key={i} className="ngs-axis" x={x(i)} y={PAD.top + ph + 14} textAnchor="middle">{i + 1}</text>
        ))}
        <text className="qr-axis-title" x={PAD.left + pw / 2} y={H - 4} textAnchor="middle">Position in read (bp)</text>
        {hover !== null && !boxes && <line className="ngs-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ph} />}
        <rect className="ngs-hit" x={PAD.left} y={PAD.top} width={pw} height={ph} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {p && (
        <div className="ngs-tip" style={{ left: Math.min(width - 170, Math.max(0, x(hover!) - 85)), top: 24 }}>
          <div className="ngs-tip-head">Position {hover! + 1}</div>
          <div>Median Q{p.p50}, mean Q{p.mean.toFixed(1)}</div>
          <div>Middle 50%: Q{p.p25} to Q{p.p75}</div>
          <div>Middle 80%: Q{p.p10} to Q{p.p90}</div>
        </div>
      )}
    </div>
  )
}

export function QualityTable({ positions }: { positions: PositionQuality[] }) {
  return (
    <table className="rs-table">
      <thead><tr><th className="num">Base</th><th className="num">Mean</th><th className="num">Median</th><th className="num">Lower quartile</th><th className="num">Upper quartile</th><th className="num">10th percentile</th><th className="num">90th percentile</th></tr></thead>
      <tbody>
        {positions.map((p, i) => (
          <tr key={i} className="ngs-static">
            <td className="num">{i + 1}</td>
            <td className="num">{p.mean.toFixed(1)}</td>
            <td className="num">{p.p50}</td>
            <td className="num">{p.p25}</td>
            <td className="num">{p.p75}</td>
            <td className="num">{p.p10}</td>
            <td className="num">{p.p90}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type Rgb = [number, number, number]

/** A token's colour as RGB; canvas cannot use var(), so the heatmap reads the tokens and mixes them itself. */
function tokenRgb(cs: CSSStyleDeclaration, name: string, fallback: Rgb): Rgb {
  const v = cs.getPropertyValue(name).trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)) as Rgb
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback
}

const mix = (a: Rgb, b: Rgb, t: number) => `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`

/** Deviations at this many Phred units or more get the full colour: FastQC's fail limit. */
const HEAT_FULL = 10

/**
 * FastQC's per tile plot: each tile a row, each position a column, coloured
 * by how far the tile's mean quality there is from the mean of all tiles:
 * the neutral colour at the average, warm below it, cool above.
 */
export function TileHeatmap({ width, ids, deviation }: { width: number; ids: number[]; deviation: number[][] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<{ t: number; p: number } | null>(null)
  const rows = ids.length
  const positions = deviation[0]?.length ?? 0
  const rowH = Math.max(2, Math.min(24, Math.floor(260 / Math.max(1, rows))))
  const height = rows * rowH
  const pw = Math.max(10, width - PAD.left - PAD.right)
  const cell = positions ? pw / positions : pw
  const step = tickStep(positions, pw)
  const labelEvery = Math.max(1, Math.ceil(12 / rowH))

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(pw * dpr)
    c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs = getComputedStyle(c)
    // Fallbacks for tests and renders outside the themed root.
    const mid = tokenRgb(cs, '--diverge-mid', [240, 239, 236])
    const warm = tokenRgb(cs, '--diverge-warm', [227, 73, 72])
    const cool = tokenRgb(cs, '--diverge-cool', [42, 120, 214])
    ctx.clearRect(0, 0, pw, height)
    deviation.forEach((row, t) => {
      row.forEach((d, p) => {
        const s = Math.min(1, Math.abs(d) / HEAT_FULL)
        ctx.fillStyle = mix(mid, d < 0 ? warm : cool, s)
        ctx.fillRect(p * cell, t * rowH, Math.ceil(cell), rowH)
      })
    })
  }, [deviation, pw, height, cell, rowH])

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const p = Math.floor((e.clientX - r.left) / cell)
    const t = Math.floor((e.clientY - r.top) / rowH)
    setHover(p >= 0 && p < positions && t >= 0 && t < rows ? { t, p } : null)
  }
  const d = hover ? deviation[hover.t][hover.p] : 0
  return (
    <div className="ngs-plot qr-heat">
      <div className="ngs-legend qr-legend">
        <span className="ngs-key"><i className="qr-swatch heat-warm" /> Below the average of all tiles</span>
        <span className="ngs-key"><i className="qr-swatch heat-mid" /> At the average</span>
        <span className="ngs-key"><i className="qr-swatch heat-cool" /> Above it</span>
        <span className="ngs-key qr-muted">Full colour at {HEAT_FULL} Phred units or more</span>
      </div>
      <div className="qr-heat-grid" style={{ gridTemplateColumns: `${PAD.left}px ${pw}px` }}>
        <div className="qr-heat-tiles" style={{ height }}>
          {ids.map((id, t) => t % labelEvery === 0 && (
            <span key={id} className="ngs-axis-text" style={{ top: t * rowH + rowH / 2 }}>{id}</span>
          ))}
        </div>
        <canvas ref={canvas} className="qr-heat-canvas" style={{ width: pw, height }} role="img"
          aria-label={`Quality of ${rows} tiles by position, against the mean of all tiles`}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        <div />
        <svg width={pw} height={32} className="qr-heat-axis">
          {Array.from({ length: positions }, (_, i) => i).filter(i => i === 0 || (i + 1) % step === 0).map(i => (
            <text key={i} className="ngs-axis" x={(i + 0.5) * cell} y={12} textAnchor="middle">{i + 1}</text>
          ))}
          <text className="qr-axis-title" x={pw / 2} y={28} textAnchor="middle">Position in read (bp)</text>
        </svg>
      </div>
      {hover && (
        <div className="ngs-tip" style={{ left: Math.min(width - 190, Math.max(0, PAD.left + hover.p * cell - 95)), top: 24 + hover.t * rowH + rowH + 6 }}>
          <div className="ngs-tip-head">Tile {ids[hover.t]}, position {hover.p + 1}</div>
          <div>{d === 0 ? 'At the average of all tiles' : `${Math.abs(d).toFixed(1)} Phred units ${d < 0 ? 'below' : 'above'} the average of all tiles`}</div>
        </div>
      )}
    </div>
  )
}

export function TileTable({ ids, deviation }: { ids: number[]; deviation: number[][] }) {
  return (
    <table className="rs-table">
      <thead><tr><th className="num">Tile</th><th className="num">Worst position</th><th className="num">Deviation there</th><th className="num">Mean deviation</th></tr></thead>
      <tbody>
        {ids.map((id, t) => {
          const row = deviation[t]
          let worst = 0
          row.forEach((d, p) => { if (d < row[worst]) worst = p })
          const mean = row.reduce((a, b) => a + b, 0) / Math.max(1, row.length)
          return (
            <tr key={id} className="ngs-static">
              <td className="num">{id}</td>
              <td className="num">{worst + 1}</td>
              <td className="num">{row[worst]?.toFixed(2)}</td>
              <td className="num">{mean.toFixed(2)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
