/**
 * The QC charts of a read set: a histogram (read lengths, read quality, GC)
 * and quality by position (percentile bands, FastQC style).
 *
 * Plain SVG sized to its card. One series per chart, so one colour (the
 * accent); the quality zones behind the position chart are status tints and
 * are named in its legend. Every chart has a hover readout and a table view,
 * so no value is only reachable by pointing at it.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Table2, ChartColumn } from 'lucide-react'
import type { Histogram, PositionQuality } from '../../ngs/types'

const nf = new Intl.NumberFormat()
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** The width of an element, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Round axis steps: 1, 2 or 5 times a power of ten. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const raw = max / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw) ?? raw
  // Up to the first tick at or above the maximum, so the tallest bar fits.
  const out: number[] = [0]
  while (out[out.length - 1] < max - step * 0.001) out.push(out.length * step)
  return out
}

/** A bar with its top corners rounded and its base square. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

interface CardProps {
  title: string
  subtitle?: string
  legend?: ReactNode
  table: ReactNode
  children: (width: number) => ReactNode
}

/** A chart's frame: title, legend, the chart or its table. */
function ChartCard({ title, subtitle, legend, table, children }: CardProps) {
  const [asTable, setAsTable] = useState(false)
  const [ref, width] = useWidth<HTMLDivElement>()
  return (
    <section className="ngs-chart">
      <div className="ngs-chart-head">
        <div>
          <h3 className="ngs-chart-title">{title}</h3>
          {subtitle && <div className="ngs-chart-sub">{subtitle}</div>}
        </div>
        <button className="aw-icon-btn" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          title={asTable ? 'Show as a chart' : 'Show as a table'} aria-label={asTable ? 'Show as a chart' : 'Show as a table'}>
          {asTable ? <ChartColumn size={13} /> : <Table2 size={13} />}
        </button>
      </div>
      {legend && !asTable && <div className="ngs-legend">{legend}</div>}
      <div ref={ref} className="ngs-chart-body">
        {asTable ? <div className="ngs-chart-table">{table}</div> : width > 0 && children(width)}
      </div>
    </section>
  )
}

const H = 150
const PAD = { left: 44, right: 10, top: 8, bottom: 24 }

interface HistogramProps {
  title: string
  subtitle?: string
  hist: Histogram
  /** A bin's range as text, from its edges. */
  binLabel: (lo: number, hi: number) => string
  /** An axis tick's text, from an edge. */
  tickLabel?: (edge: number) => string
  unit?: string
  /** Show each bin's share of the total (off when the values are not counts). */
  share?: boolean
  format?: (v: number) => string
}

export function HistogramChart({ title, subtitle, hist, binLabel, tickLabel = v => nf.format(v), unit = 'reads', share = true, format = v => nf.format(v) }: HistogramProps) {
  const [hover, setHover] = useState<number | null>(null)
  const total = useMemo(() => hist.counts.reduce((a, b) => a + b, 0), [hist])
  const max = Math.max(1, ...hist.counts)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || 1
  const n = hist.counts.length
  const table = (
    <table className="rs-table">
      <thead><tr><th>Range</th><th className="num">{unit[0].toUpperCase() + unit.slice(1)}</th>{share && <th className="num">Share</th>}</tr></thead>
      <tbody>
        {hist.counts.map((c, i) => (
          <tr key={i} className="ngs-static">
            <td>{binLabel(hist.edges[i], hist.edges[i + 1])}</td>
            <td className="num">{format(c)}</td>
            {share && <td className="num">{total ? `${((c / total) * 100).toFixed(1)}%` : ''}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <ChartCard title={title} subtitle={subtitle} table={table}>
      {width => {
        const pw = Math.max(10, width - PAD.left - PAD.right)
        const ph = H - PAD.top - PAD.bottom
        const band = n ? pw / n : pw
        const gap = band >= 6 ? 2 : band >= 3 ? 1 : 0
        const bw = Math.min(24, Math.max(0.5, band - gap))
        const y = (v: number) => PAD.top + ph - (v / top) * ph
        const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))))
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.floor(((e.clientX - r.left) / r.width) * n)
          setHover(i >= 0 && i < n ? i : null)
        }
        const hx = hover !== null ? PAD.left + hover * band + band / 2 : 0
        return (
          <div className="ngs-plot">
            <svg width={width} height={H} role="img" aria-label={`${title}: ${nf.format(total)} ${unit}`}>
              {ticks.map(t => (
                <g key={t}>
                  <line className="ngs-grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                  <text className="ngs-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">{compact.format(t)}</text>
                </g>
              ))}
              {hist.counts.map((c, i) => c > 0 && (
                <path key={i} className={`ngs-bar${hover === i ? ' hot' : ''}`}
                  d={barPath(PAD.left + i * band + (band - bw) / 2, y(c), bw, PAD.top + ph - y(c))} />
              ))}
              <line className="ngs-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + ph} y2={PAD.top + ph} />
              {hist.edges.map((e, i) => (i % every === 0 && i < n) && (
                <text key={i} className="ngs-axis" x={PAD.left + i * band} y={H - 8} textAnchor={i === 0 ? 'start' : 'middle'}>{tickLabel(e)}</text>
              ))}
              <rect className="ngs-hit" x={PAD.left} y={PAD.top} width={pw} height={ph}
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </svg>
            {hover !== null && (
              <div className="ngs-tip" style={{ left: Math.min(width - 150, Math.max(0, hx - 75)) }}>
                <div className="ngs-tip-head">{binLabel(hist.edges[hover], hist.edges[hover + 1])}</div>
                <div>{format(hist.counts[hover])} {unit}{share && total ? ` (${((hist.counts[hover] / total) * 100).toFixed(1)}%)` : ''}</div>
              </div>
            )}
          </div>
        )
      }}
    </ChartCard>
  )
}

interface PositionProps {
  title: string
  subtitle?: string
  positions: PositionQuality[]
}

/** The FastQC zones: good from Q28, reasonable from Q20, poor below. */
const ZONES = [{ from: 28, cls: 'good' }, { from: 20, cls: 'fair' }, { from: 0, cls: 'poor' }] as const

export function PositionQualityChart({ title, subtitle, positions }: PositionProps) {
  const [hover, setHover] = useState<number | null>(null)
  const n = positions.length
  const qMax = Math.max(41, ...positions.map(p => p.p90))
  const legend = (
    <>
      <span className="ngs-key"><i className="ngs-swatch line" /> Median</span>
      <span className="ngs-key"><i className="ngs-swatch iqr" /> Middle 50%</span>
      <span className="ngs-key"><i className="ngs-swatch p80" /> Middle 80%</span>
      <span className="ngs-key"><i className="ngs-swatch zone good" /> Q28 and up</span>
      <span className="ngs-key"><i className="ngs-swatch zone fair" /> Q20 to 28</span>
      <span className="ngs-key"><i className="ngs-swatch zone poor" /> Below Q20</span>
    </>
  )
  const table = (
    <table className="rs-table">
      <thead><tr><th className="num">Position</th><th className="num">Mean</th><th className="num">Median</th><th className="num">Middle 50%</th><th className="num">Middle 80%</th></tr></thead>
      <tbody>
        {positions.map((p, i) => (
          <tr key={i} className="ngs-static">
            <td className="num">{i + 1}</td>
            <td className="num">{p.mean.toFixed(1)}</td>
            <td className="num">{p.p50}</td>
            <td className="num">{p.p25} to {p.p75}</td>
            <td className="num">{p.p10} to {p.p90}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
  return (
    <ChartCard title={title} subtitle={subtitle} legend={legend} table={table}>
      {width => {
        const pw = Math.max(10, width - PAD.left - PAD.right)
        const ph = H - PAD.top - PAD.bottom
        const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * pw : pw / 2)
        const y = (q: number) => PAD.top + ph - (Math.min(q, qMax) / qMax) * ph
        const area = (lo: (p: PositionQuality) => number, hi: (p: PositionQuality) => number) =>
          positions.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(hi(p))}`).join('')
          + positions.map((_, i) => `L${x(n - 1 - i)},${y(lo(positions[n - 1 - i]))}`).join('') + 'Z'
        const median = positions.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.p50)}`).join('')
        const ticks = [0, 10, 20, 30, 40].filter(t => t <= qMax)
        const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 60)) / 10) * 10)
        const onMove = (e: React.PointerEvent<SVGRectElement>) => {
          const r = e.currentTarget.getBoundingClientRect()
          const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1))
          setHover(i >= 0 && i < n ? i : null)
        }
        const p = hover !== null ? positions[hover] : null
        return (
          <div className="ngs-plot">
            <svg width={width} height={H} role="img" aria-label={`${title}: median quality by position`}>
              {ZONES.map((z, k) => {
                const hi = k === 0 ? qMax : ZONES[k - 1].from
                return <rect key={z.cls} className={`ngs-zone ${z.cls}`} x={PAD.left} width={pw} y={y(hi)} height={y(z.from) - y(hi)} />
              })}
              {ticks.map(t => (
                <text key={t} className="ngs-axis" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">Q{t}</text>
              ))}
              {n > 0 && <path className="ngs-band p80" d={area(q => q.p10, q => q.p90)} />}
              {n > 0 && <path className="ngs-band iqr" d={area(q => q.p25, q => q.p75)} />}
              {n > 0 && <path className="ngs-median" d={median} />}
              {Array.from({ length: n }, (_, i) => i).filter(i => i === 0 || (i + 1) % every === 0).map(i => (
                <text key={i} className="ngs-axis" x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'middle'}>{i + 1}</text>
              ))}
              {hover !== null && <line className="ngs-cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ph} />}
              {p && <circle className="ngs-dot" cx={x(hover!)} cy={y(p.p50)} r={4} />}
              <rect className="ngs-hit" x={PAD.left} y={PAD.top} width={pw} height={ph}
                onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </svg>
            {p && (
              <div className="ngs-tip" style={{ left: Math.min(width - 170, Math.max(0, x(hover!) - 85)) }}>
                <div className="ngs-tip-head">Position {hover! + 1}</div>
                <div>Median Q{p.p50}, mean Q{p.mean.toFixed(1)}</div>
                <div>Middle 50%: Q{p.p25} to Q{p.p75}</div>
                <div>Middle 80%: Q{p.p10} to Q{p.p90}</div>
              </div>
            )}
          </div>
        )
      }}
    </ChartCard>
  )
}
