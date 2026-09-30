/**
 * Hover card for a primer binding site, in the same frame as the feature
 * tooltip so the two read as one family.
 *
 * Two Tms because a tailed primer has two: the annealed part is what binds
 * in the first cycles, the whole oligo once the tail has been copied into
 * the product. For a primer without tails they are the same number.
 */

import type { PrimerItem } from '../../primers/display'
import { summarizeOligo } from '../../primers/display'
import { useClampedPosition } from '../../hooks/useClampedPosition'
import { useEditorStore } from '../../store'
import OligoSequence from './OligoSequence'

const fmtTm = (t: number | null) => (t === null || !Number.isFinite(t) ? '–' : `${t.toFixed(1)} °C`)

export function PrimerTooltipContent({ item, siteCount }: { item: PrimerItem; siteCount: number }) {
  const { primer, site, annotation } = item
  const sequence = useEditorStore(st => st.doc.sequence)
  const s = summarizeOligo(primer, site, { bases: sequence.bases, topology: sequence.topology })
  // Two numbers whenever the annealed Tm differs from the oligo's own:
  // a tail, or a mismatch against this template.
  const tailed = site.tail5.length > 0 || site.tail3.length > 0 || site.mismatches.length > 0
  return (
    <>
      <div className="ft-tooltip-name">
        <span className="ann-swatch" style={{ backgroundColor: annotation.color, marginRight: 6 }} />
        {primer.name}
      </div>
      <table className="ft-tooltip-table">
        <tbody>
          <tr><td>Type</td><td>{primer.role === 'probe' ? 'Probe' : 'Primer'}</td></tr>
          <tr>
            <td>Binds</td>
            <td>
              {site.start + 1}..{site.end} {site.strand === 1 ? '(+)' : '(−)'}
              {siteCount > 1 && <span className="oligo-note"> · 1 of {siteCount} sites</span>}
            </td>
          </tr>
          <tr><td>Length</td><td>{s.length} nt{tailed && ` (${site.annealTo - site.annealFrom} annealed)`}</td></tr>
          <tr><td>GC</td><td>{s.gc.toFixed(0)}%</td></tr>
          <tr>
            <td>Tm</td>
            <td>{tailed ? `${fmtTm(s.tmAnneal)} annealed · ${fmtTm(s.tmFull)} full` : fmtTm(s.tmFull)}</td>
          </tr>
          {site.mismatches.length > 0 && (
            <tr><td>Mismatches</td><td>{site.mismatches.length}</td></tr>
          )}
        </tbody>
      </table>
      <div className="ft-tooltip-bases">
        <OligoSequence sequence={primer.sequence} site={site} />
      </div>
    </>
  )
}

export default function PrimerTooltip({ item, siteCount, x, y }: {
  item: PrimerItem
  siteCount: number
  x: number
  y: number
}) {
  const { ref, pos } = useClampedPosition(x, y)
  return (
    <div
      ref={ref}
      className="ft-tooltip"
      style={{ position: 'fixed', left: pos.left, top: pos.top, pointerEvents: 'none' }}
    >
      <PrimerTooltipContent item={item} siteCount={siteCount} />
    </div>
  )
}
