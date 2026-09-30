/**
 * One picked oligo, taken apart.
 *
 * Everything the search weighed is shown with its weight, so a pick can be
 * judged rather than trusted: the penalty as bars, the hairpin as a fold,
 * the self-dimer as the duplex it would form. The ends can be trimmed or
 * extended a base at a time along the template, and all of it recomputes.
 */

import { useMemo } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { offTargets } from '../../primers/offtarget'
import type { BindingSite } from '../../primers/binding'
import { scorePrimer, type PrimerConstraints } from '../../primers/scoring'
import { oligoStructure, summarizeOligo } from '../../primers/display'
import type { PrimerData } from '../../primers/oligo'
import OligoSequence from './OligoSequence'

const COMP: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' }

const fmtTm = (t: number | null) => (t === null || !Number.isFinite(t) ? '–' : `${t.toFixed(1)} °C`)
/** Structure Tms are estimates, and meaningless below freezing. */
const fmtStructTm = (t: number) => (t < 0 ? '< 0 °C' : `≈ ${t.toFixed(0)} °C`)

interface Props {
  label: string
  oligo: PrimerData
  sites: BindingSite[]
  constraints: PrimerConstraints
  template: string
  circular: boolean
  onChange: (sequence: string) => void
  onClear: () => void
}

export default function OligoInspector({ label, oligo, sites, constraints, template, circular, onChange, onClear }: Props) {
  const site = sites[0] ?? null
  const seq = oligo.sequence
  const n = template.length
  const s = summarizeOligo(oligo, site, { bases: template, topology: circular ? 'circular' : 'linear' })
  // Judged on what anneals; a tail is not part of the primer's fit.
  const annealed = site ? seq.slice(site.annealFrom, site.annealTo) : seq
  const scored = scorePrimer(annealed, 0, site?.strand ?? 1, constraints)
  const terms = [...scored.terms].sort((a, b) => b.penalty - a.penalty)
  const maxTerm = Math.max(4, ...terms.map(t => t.penalty))
  const topology = circular ? 'circular' : 'linear'
  // Two binding scans; stand-in oligos are rebuilt each render, so key on
  // what they contain rather than the object.
  const offTarget = useMemo(
    () => offTargets(oligo, template, topology),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [oligo.sequence, oligo.role, template, topology],
  )
  // The same folds, and Tms, as the hover card on the sequence.
  const { hairpin, dimer } = oligoStructure(seq)
  const showDimer = dimer && (dimer.run >= 4 || (dimer.threePrime && dimer.run >= 3))

  /** Template base at a position, wrapping on a circle; null off a line or
   *  on an ambiguous base, which would put an N into the primer. */
  const baseAt = (pos: number): string | null => {
    const b = circular ? template[((pos % n) + n) % n] : pos >= 0 && pos < n ? template[pos] : undefined
    return b && COMP[b] ? b : null
  }

  // Extending reads the next template base along the primer's own strand.
  const next3 = site ? (site.strand === 1 ? baseAt(site.end) : complement(baseAt(site.start - 1))) : null
  const next5 = site && !site.tail5
    ? (site.strand === 1 ? baseAt(site.start - 1) : complement(baseAt(site.end)))
    : null

  return (
    <section className="wb-oligo" aria-label={label}>
      <header className="wb-oligo-head">
        <span className="wb-oligo-label">{label}</span>
        <span className="wb-oligo-meta">
          {site ? `${site.start + 1}..${site.end} ${site.strand === 1 ? '(+)' : '(−)'}` : 'unbound'}
        </span>
        <button className="fs-icon-btn" onClick={onClear} title="Discard this pick" aria-label={`Discard ${label}`}>
          <X size={12} />
        </button>
      </header>

      <div className="ft-tooltip-bases pl-oligo">
        <OligoSequence sequence={seq} site={site} />
      </div>

      <div className="wb-trim" role="group" aria-label="Adjust ends">
        <span>5′</span>
        <button className="btn btn-sm" disabled={seq.length <= 10} onClick={() => onChange(seq.slice(1))} title="Trim a base from the 5′ end">
          <Minus size={11} />
        </button>
        <button className="btn btn-sm" disabled={!next5} onClick={() => next5 && onChange(next5 + seq)} title="Extend the 5′ end along the template">
          <Plus size={11} />
        </button>
        <span className="wb-trim-len">{seq.length} nt</span>
        <button className="btn btn-sm" disabled={!next3} onClick={() => next3 && onChange(seq + next3)} title="Extend the 3′ end along the template">
          <Plus size={11} />
        </button>
        <button className="btn btn-sm" disabled={seq.length <= 10} onClick={() => onChange(seq.slice(0, -1))} title="Trim a base from the 3′ end">
          <Minus size={11} />
        </button>
        <span>3′</span>
      </div>

      <dl className="wb-stats">
        <div>
          <dt>Tm</dt>
          <dd title={site && (site.tail5 || site.tail3 || site.mismatches.length) ? 'annealed / full oligo' : undefined}>
            {site && (site.tail5 || site.tail3 || site.mismatches.length > 0)
              ? `${fmtTm(s.tmAnneal)} / ${fmtTm(s.tmFull)}`
              : fmtTm(s.tmFull)}
          </dd>
        </div>
        <div><dt>GC</dt><dd>{s.gc.toFixed(0)}%</dd></div>
        <div><dt>3′ ΔG</dt><dd>{scored.checks.end3dG === null ? '–' : `${scored.checks.end3dG.toFixed(1)}`}</dd></div>
        <div><dt>Clamp</dt><dd>{scored.checks.gcClamp ? 'yes' : 'no'}</dd></div>
      </dl>

      {sites.length === 0 && <div className="pl-error">Does not bind this sequence with its 3′ end paired.</div>}
      {sites.length > 1 && (
        <div className="pl-error">Binds {sites.length} sites: it may prime off target.</div>
      )}
      {offTarget.weak.length > 0 && (
        <div className="wb-problem" title="Weaker sites where the last 8 bases at the 3′ end pair perfectly">
          Could also prime at {offTarget.weak.slice(0, 3).map(w => `${w.start + 1}..${w.end} ${w.strand === 1 ? '(+)' : '(−)'}`).join(', ')}
          {offTarget.weak.length > 3 ? ` and ${offTarget.weak.length - 3} more` : ''}
        </div>
      )}
      {scored.problems.map(p => <div key={p} className="wb-problem">{p}</div>)}

      {terms.length > 0 && (
        <div className="wb-terms" aria-label={`Penalty ${scored.penalty.toFixed(1)}`}>
          {terms.map(t => (
            <div key={t.label} className="wb-term">
              <span className="wb-term-label">{t.label}</span>
              <span className="wb-term-bar"><span style={{ width: `${(t.penalty / maxTerm) * 100}%` }} /></span>
              <span className="wb-term-value">{t.penalty.toFixed(1)}</span>
            </div>
          ))}
          <div className="wb-term wb-term-total">
            <span className="wb-term-label">Penalty</span>
            <span />
            <span className="wb-term-value">{scored.penalty.toFixed(1)}</span>
          </div>
        </div>
      )}

      {hairpin && (
        <figure className="wb-structure">
          <figcaption>Hairpin · {hairpin.stem} bp stem, {hairpin.loop}-nt loop · Tm {fmtStructTm(hairpin.tm)}</figcaption>
          <pre>{seq}{'\n'}{hairpin.dotBracket}</pre>
        </figure>
      )}
      {showDimer && dimer && (
        <figure className="wb-structure">
          <figcaption>
            Self-dimer · {dimer.run} bp, ΔG {dimer.dG.toFixed(1)} kcal/mol, Tm {fmtStructTm(dimer.tm)}{dimer.threePrime ? ' · at a 3′ end' : ''}
          </figcaption>
          <pre>{dimer.lines.join('\n')}</pre>
        </figure>
      )}
    </section>
  )
}

function complement(b: string | null): string | null {
  return b ? COMP[b.toUpperCase()] ?? null : null
}
