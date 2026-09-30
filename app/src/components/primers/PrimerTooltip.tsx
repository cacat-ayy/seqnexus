/**
 * Hover card for a primer or probe binding site, in the same frame as the
 * feature card so the two read as one family.
 *
 * Two Tms because a tailed primer has two: the annealed part is what binds
 * in the first cycles, the whole oligo once the tail has been copied into
 * the product. For a primer without tails they are the same number.
 *
 * Below the numbers, the checks worth a glance before ordering: the
 * strongest hairpin and self-dimer with their Tm (estimates, see
 * primers/secondary.ts), what the 5' tail carries, and for a probe the
 * TaqMan rules (no G at the 5' end, Tm above the primers').
 */

import type { ReactNode } from 'react'
import type { PrimerItem } from '../../primers/display'
import { flankingPrimers, oligoStructure, summarizeOligo } from '../../primers/display'
import { structureGrade, type StructureGrade } from '../../primers/secondary'
import { tailEnzymes } from '../../primers/tails'
import { useEditorStore } from '../../store'
import HoverCard from '../HoverCard'
import OligoSequence from './OligoSequence'

const fmtTm = (t: number | null) => (t === null || !Number.isFinite(t) ? '–' : `${t.toFixed(1)} °C`)
/** A structure Tm: an estimate, and meaningless below freezing. */
const fmtStructTm = (t: number) => (t < 0 ? '< 0 °C' : `≈ ${t.toFixed(0)} °C`)

/** TaqMan guidance: the probe should melt 6-10 °C above its primers. */
function probeMarginGrade(margin: number): StructureGrade {
  return margin >= 6 ? 'good' : margin >= 3 ? 'ok' : 'poor'
}

function Check({ label, grade, children, title }: {
  label: string
  grade: StructureGrade
  children: ReactNode
  title?: string
}) {
  const word = grade === 'good' ? 'fine' : grade === 'ok' ? 'borderline' : 'a problem'
  return (
    <>
      <span className="hc-check-label">{label}</span>
      <span className="hc-check-value" title={title}>{children}</span>
      <span className={`hc-dot ${grade}`} role="img" aria-label={`${label}: ${word}`} title={`${label}: ${word}`} />
    </>
  )
}

export function PrimerTooltipContent({ item, siteCount, items = [] }: {
  item: PrimerItem
  siteCount: number
  /** Every primer item on the sequence, to find a probe's primers. */
  items?: readonly PrimerItem[]
}) {
  const { primer, site, annotation } = item
  const sequence = useEditorStore(st => st.doc.sequence)
  const s = summarizeOligo(primer, site, { bases: sequence.bases, topology: sequence.topology })
  // Two numbers whenever the annealed Tm differs from the oligo's own:
  // a tail, or a mismatch against this template.
  const tailed = site.tail5.length > 0 || site.tail3.length > 0 || site.mismatches.length > 0
  const annealLen = site.annealTo - site.annealFrom
  const reference = s.tmAnneal ?? s.tmFull

  const { hairpin, dimer } = oligoStructure(primer.sequence)
  const hairpinGrade = structureGrade(hairpin?.tm ?? null, reference, hairpin?.threePrime ?? false)
  const dimerGrade = structureGrade(dimer?.tm ?? null, reference, dimer?.threePrime ?? false)

  const annealed = primer.sequence.slice(site.annealFrom, site.annealTo)
  const enzymes = tailEnzymes(site.tail5, annealed)

  const isProbe = primer.role === 'probe'
  const pair = isProbe
    ? flankingPrimers(item, items, sequence.length, sequence.topology === 'circular')
    : null
  const pairTm = pair
    ? Math.max(
      summarizeOligo(pair.fwd.primer, pair.fwd.site, { bases: sequence.bases, topology: sequence.topology }).tmAnneal ?? NaN,
      summarizeOligo(pair.rev.primer, pair.rev.site, { bases: sequence.bases, topology: sequence.topology }).tmAnneal ?? NaN,
    )
    : NaN

  return (
    <>
      <div className="ft-tooltip-name">
        <span className="ann-swatch" style={{ backgroundColor: annotation.color, marginRight: 6 }} />
        <span className="hc-name">{primer.name}</span>
        {/* The feature type it is saved as, like any feature; a probe is a primer_bind
            with a role qualifier, and the role is what the checks below key on. */}
        <span className="hc-chip">{annotation.type}</span>
        {isProbe && <span className="hc-chip hc-chip-role">probe</span>}
      </div>
      <div className="hc-sub">
        Binds {site.start + 1}..{site.end} {site.strand === 1 ? '(+)' : '(−)'}
        {siteCount > 1 && <> · 1 of {siteCount} sites</>}
        {site.mismatches.length > 0 && <> · {site.mismatches.length} mismatch{site.mismatches.length === 1 ? '' : 'es'}</>}
      </div>

      <div className="hc-stats">
        <div>
          <div className="hc-stat-label">Tm</div>
          <div className="hc-stat-value">{fmtTm(tailed ? s.tmAnneal : s.tmFull)}</div>
          {tailed && <div className="hc-stat-note">{fmtTm(s.tmFull)} full</div>}
        </div>
        <div>
          <div className="hc-stat-label">GC</div>
          <div className="hc-stat-value">{s.gc.toFixed(0)} %</div>
        </div>
        <div>
          <div className="hc-stat-label">Length</div>
          <div className="hc-stat-value">{s.length} nt</div>
          {tailed && <div className="hc-stat-note">{annealLen} annealed</div>}
        </div>
      </div>

      <div className="ft-tooltip-bases">
        <span className="hc-muted">5′ </span>
        <OligoSequence sequence={primer.sequence} site={site} />
        <span className="hc-muted"> 3′</span>
      </div>

      <div className="hc-checks">
        <Check
          label="Hairpin"
          grade={hairpinGrade}
          title={hairpin ? `${hairpin.stem} bp stem, ${hairpin.loop}-nt loop, ΔG ${hairpin.dG.toFixed(1)} kcal/mol` : undefined}
        >
          {hairpin
            ? <>{fmtStructTm(hairpin.tm)}{hairpin.threePrime && <small> · 3′ end</small>}</>
            : <small>none</small>}
        </Check>
        <Check
          label="Self-dimer"
          grade={dimerGrade}
          title={dimer ? `${dimer.run} bp, ΔG ${dimer.dG.toFixed(1)} kcal/mol` : undefined}
        >
          {dimer
            ? <>{fmtStructTm(dimer.tm)}{dimer.threePrime && <small> · 3′ end</small>}</>
            : <small>none</small>}
        </Check>
        {site.tail5.length > 0 && (
          <Check label="5′ tail" grade="good">
            {site.tail5.length} nt{enzymes.length > 0 && <small> · {enzymes.slice(0, 3).join(', ')}{enzymes.length > 3 ? ' …' : ''}</small>}
          </Check>
        )}
        {site.tail3.length > 0 && (
          <Check label="3′ tail" grade={isProbe ? 'good' : 'poor'}>
            {site.tail3.length} nt <small>unpaired</small>
          </Check>
        )}
        {isProbe && (
          <Check
            label="5′ base"
            grade={primer.sequence[0]?.toUpperCase() === 'G' ? 'poor' : 'good'}
            title="A G next to the reporter dye quenches it"
          >
            {primer.sequence[0]?.toUpperCase()}
            {primer.sequence[0]?.toUpperCase() === 'G' && <small> · quenches reporter</small>}
          </Check>
        )}
        {isProbe && pair && Number.isFinite(pairTm) && (
          <Check
            label="vs primers"
            grade={probeMarginGrade(reference - pairTm)}
            title={`${pair.fwd.primer.name} / ${pair.rev.primer.name}; aim for 6-10 °C above`}
          >
            {reference - pairTm >= 0 ? '+' : '−'}{Math.abs(reference - pairTm).toFixed(1)} °C
            <small> · {pair.fwd.primer.name}/{pair.rev.primer.name}</small>
          </Check>
        )}
      </div>
    </>
  )
}

export default function PrimerTooltip({ item, siteCount, items, x, y }: {
  item: PrimerItem
  siteCount: number
  items?: readonly PrimerItem[]
  x: number
  y: number
}) {
  return (
    <HoverCard x={x} y={y} pinKey={`primer:${item.annotation.id}`}>
      <PrimerTooltipContent item={item} siteCount={siteCount} items={items} />
    </HoverCard>
  )
}
