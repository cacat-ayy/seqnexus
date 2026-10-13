/**
 * Contigs by GC content and read depth, each a dot sized by its length.
 *
 * One genome's contigs share a GC content and, apart from repeats, a depth,
 * so they gather in one cloud. Something else stands apart: a plasmid at
 * several copies per cell higher up at the same GC, contamination from
 * another organism at its own GC (usually at another depth), a collapsed
 * repeat at a multiple of the depth. As BlobTools plots assemblies, without
 * the taxonomy. Depth is on a log scale when it spans more than eight-fold.
 * Click a dot for its reads.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

export interface GcPoint {
  name: string
  length: number
  /** 0 to 1. */
  gc: number
  depth: number
}

const nf = new Intl.NumberFormat('en-US')
const PAD = { left: 52, right: 16, top: 12, bottom: 34 }
const HEIGHT = 240

function ticks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1
  const raw = span / n
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export default function CoverageGcChart({ points, onPick }: { points: GcPoint[]; onPick?: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const scale = useMemo(() => {
    const gcs = points.map(p => p.gc * 100)
    const x0 = Math.max(0, Math.floor(Math.min(...gcs) - 3))
    const x1 = Math.min(100, Math.ceil(Math.max(...gcs) + 3))
    const ds = points.map(p => Math.max(0.1, p.depth))
    const dMin = Math.min(...ds)
    const dMax = Math.max(...ds)
    const log = dMax / dMin > 8
    const y0 = log ? Math.log10(dMin) - 0.15 : 0
    const y1 = log ? Math.log10(dMax) + 0.15 : dMax * 1.1
    const maxLen = Math.max(...points.map(p => p.length))
    return { x0, x1, y0, y1, log, maxLen }
  }, [points])

  const w = Math.max(200, width)
  const plotW = w - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const X = (gc: number) => PAD.left + ((gc * 100 - scale.x0) / (scale.x1 - scale.x0 || 1)) * plotW
  const yVal = (d: number) => (scale.log ? Math.log10(Math.max(0.1, d)) : d)
  const Y = (d: number) => PAD.top + plotH - ((yVal(d) - scale.y0) / (scale.y1 - scale.y0 || 1)) * plotH
  const r = (len: number) => 3 + 9 * Math.sqrt(len / (scale.maxLen || 1))
  const yTicks = scale.log
    ? ticks(scale.y0, scale.y1, 4).filter(v => Number.isInteger(v)).map(v => 10 ** v)
    : ticks(scale.y0, scale.y1, 4)
  const order = points.map((_, i) => i).sort((a, b) => points[b].length - points[a].length)
  const h = hover !== null ? points[hover] : null

  return (
    <section className="ngs-card">
      <div className="ngs-card-title">Depth against GC</div>
      <p className="aw-note">One genome&apos;s contigs gather in one cloud; a plasmid at more copies sits higher, DNA from another organism usually at its own GC. Dots are sized by length; click one for its reads.</p>
      <div className="gc-chart" ref={ref}>
        <svg width={w} height={HEIGHT} role="img" aria-label="Contigs by GC content and depth">
          {yTicks.map(v => (
            <g key={v}>
              <line className="gc-grid" x1={PAD.left} x2={w - PAD.right} y1={Y(v)} y2={Y(v)} />
              <text className="gc-tick" x={PAD.left - 6} y={Y(v) + 3} textAnchor="end">{nf.format(Math.round(v * 10) / 10)}×</text>
            </g>
          ))}
          {ticks(scale.x0, scale.x1, 6).map(v => (
            <text key={v} className="gc-tick" x={X(v / 100)} y={HEIGHT - PAD.bottom + 14} textAnchor="middle">{v}%</text>
          ))}
          <text className="gc-axis" x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle">GC</text>
          <text className="gc-axis" x={12} y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}>Depth{scale.log ? ' (log)' : ''}</text>
          {order.map(i => {
            const p = points[i]
            return (
              <circle key={i} className={`gc-dot${hover === i ? ' on' : ''}`} cx={X(p.gc)} cy={Y(p.depth)} r={r(p.length)}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => onPick?.(i)} />
            )
          })}
        </svg>
        {h && hover !== null && (
          <div className="gc-hover" style={{ left: Math.min(w - 180, X(h.gc) + 12), top: Math.max(0, Y(h.depth) - 30) }}>
            <strong>{h.name}</strong> {nf.format(h.length)} bp
            <div className="aw-muted">{(h.gc * 100).toFixed(1)}% GC, {h.depth.toFixed(1)}× depth</div>
          </div>
        )}
      </div>
    </section>
  )
}
