/**
 * What is under the pointer in a trace: the base, its quality, the four
 * peak heights and any second peak. The read workspace and the stacked
 * read view both show it in their status bars.
 */

import { KIND_DELETE, KIND_INSERT, KIND_SUBSTITUTE } from '../../sanger/layout'
import { forwardColumn, type TraceModel } from '../../sanger/model'

const nf = new Intl.NumberFormat('en-US')

export default function HoverReadout({ m, d }: { m: TraceModel; d: number }) {
  const c = forwardColumn(m, d)
  const k = m.kind[d]
  const o = m.layout.origin[c]
  const b = m.shown[d]
  const parts: React.ReactNode[] = [<span key="pos">Base <b>{nf.format(d + 1)}</b></span>]
  if (k === KIND_INSERT) {
    parts.push(<span key="call"><b className="tw-call">{b}</b> inserted by hand</span>)
  } else {
    const q = m.quality[d]
    parts.push(
      <span key="call">
        <b className="tw-call">{b}</b>
        {!m.data.metadata.qualityMissing && <> Q{q}</>}
        {k === KIND_SUBSTITUTE && <> · was {m.original[d]}</>}
        {k === KIND_DELETE && <> · deleted</>}
      </span>,
    )
    if (o < m.peaks.length) {
      const hs = (['A', 'C', 'G', 'T'] as const).map((ch, i) => {
        // In a reversed view the A row shows the forward T channel.
        const fi = m.reversed ? 3 - i : i
        return <span key={ch} className={`tw-ch-${ch}`}>{ch} {nf.format(Math.round(m.peaks.heights[o * 4 + fi]))}</span>
      })
      parts.push(<span key="peaks" className="tw-peaks">{hs}</span>)
      const r = m.secondRatio[d]
      if (r >= 0.15) parts.push(<span key="ratio">second peak {m.secondBase[d]} {Math.round(r * 100)}%</span>)
    }
    if (m.reversed || m.layout.edited > 0) parts.push(<span key="orig" className="aw-muted">read position {nf.format(o + 1)}</span>)
  }
  if (d < m.trim[0] || d >= m.trim[1]) parts.push(<span key="trim" className="aw-muted">trimmed</span>)
  return <>{parts}</>
}
