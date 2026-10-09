/**
 * The physical properties of the open protein, or of the selected residues:
 * mass and formula, charge and isoelectric point with a titration curve,
 * absorbance at 280 nm, the sequence indices, and the composition. Rendered
 * inside the statistics popover's frame.
 *
 * Everything recomputes from the residues on each render; the maths is
 * O(n) and a protein is short, so no worker and no debounce.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEditorStore, selectionSegments, extraSelectionsOf, selectedRanges, joinedSegments } from '../store'
import type { DocumentState } from '../models/Document'
import { displayPosition } from '../models/Document'
import { residueColorFor } from '../utils/residue-colors'
import {
  PKA_SETS, pkaSet, proteinProperties, netCharge, chargeCurve, formatFormula, formatMass,
  type PkaSetId,
} from '../protein/properties'

const AA_NAMES: Record<string, string> = {
  A: 'Ala', C: 'Cys', D: 'Asp', E: 'Glu', F: 'Phe', G: 'Gly', H: 'His', I: 'Ile',
  K: 'Lys', L: 'Leu', M: 'Met', N: 'Asn', P: 'Pro', Q: 'Gln', R: 'Arg', S: 'Ser',
  T: 'Thr', V: 'Val', W: 'Trp', Y: 'Tyr',
}

/** The twenty standard residues, in the order the composition lists them. */
const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY'

function countResidues(residues: string): { counts: Map<string, number>; other: number } {
  const counts = new Map<string, number>()
  for (const r of RESIDUES) counts.set(r, 0)
  let other = 0
  for (let i = 0; i < residues.length; i++) {
    const n = counts.get(residues[i].toUpperCase())
    if (n === undefined) other++
    else counts.set(residues[i].toUpperCase(), n + 1)
  }
  return { counts, other }
}

const fmt = (v: number | null, digits = 2) => (v === null ? '-' : v.toFixed(digits))
const signed = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))
const eps = (v: number) => `${v.toLocaleString()} M⁻¹cm⁻¹`

/** Net charge against pH, with the pI and the chosen pH marked. */
function ChargeChart({ curve, pI, pH }: { curve: { pH: number; charge: number }[]; pI: number | null; pH: number }) {
  const W = 300, H = 88, L = 26, R = 6, T = 6, B = 16
  const maxAbs = Math.max(1, ...curve.map(p => Math.abs(p.charge)))
  const x = (v: number) => L + (v / 14) * (W - L - R)
  const y = (c: number) => T + ((maxAbs - c) / (2 * maxAbs)) * (H - T - B)
  const path = curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.pH).toFixed(1)},${y(p.charge).toFixed(1)}`).join(' ')
  const at = curve.reduce((best, p) => (Math.abs(p.pH - pH) < Math.abs(best.pH - pH) ? p : best), curve[0])
  return (
    <svg className="pp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Net charge against pH">
      <line className="pp-chart-zero" x1={L} x2={W - R} y1={y(0)} y2={y(0)} />
      {[0, 7, 14].map(v => (
        <text key={v} className="pp-chart-tick" x={x(v)} y={H - 4} textAnchor={v === 0 ? 'start' : v === 14 ? 'end' : 'middle'}>{v}</text>
      ))}
      <text className="pp-chart-tick" x={L - 4} y={y(maxAbs) + 4} textAnchor="end">+{Math.round(maxAbs)}</text>
      <text className="pp-chart-tick" x={L - 4} y={y(-maxAbs) + 2} textAnchor="end">-{Math.round(maxAbs)}</text>
      <path className="pp-chart-curve" d={path} />
      <line className="pp-chart-ph" x1={x(pH)} x2={x(pH)} y1={T} y2={H - B} />
      <circle className="pp-chart-at" cx={x(at.pH)} cy={y(at.charge)} r={3} />
      {pI !== null && <circle className="pp-chart-pi" cx={x(pI)} cy={y(0)} r={3} />}
    </svg>
  )
}

export default function ProteinProperties({ doc }: { doc: DocumentState }) {
  const selection = useEditorStore(s => s.selection)
  const extraSelections = useEditorStore(extraSelectionsOf)
  const pkaSetId = useEditorStore(s => s.proteinPkaSet)
  const setPkaSet = useEditorStore(s => s.setProteinPkaSet)
  const scheme = useEditorStore(s => s.proteinColorScheme)
  const [scope, setScope] = useState<'whole' | 'selection'>('selection')
  const [pH, setPH] = useState(7.4)
  const [compositionOpen, setCompositionOpen] = useState(false)

  const seqLen = doc.sequence.length
  const topology = doc.sequence.topology
  // The selected residues, joined in reading order when there are several ranges.
  const segs = useMemo(() => {
    const ranges = extraSelections.length > 0 ? selectedRanges(selection, extraSelections, topology) : [selection]
    return extraSelections.length > 0
      ? joinedSegments(ranges, topology, seqLen)
      : selectionSegments(selection, topology, seqLen)
  }, [selection, extraSelections, topology, seqLen])
  const hasSelection = segs.length > 0
  const useSelection = hasSelection && scope === 'selection'

  const residues = useMemo(
    () => (useSelection ? segs.map(([s, e]) => doc.sequence.basesIn(s, e)).join('') : doc.sequence.bases),
    [useSelection, segs, doc.sequence],
  )
  const disulfides = useMemo(() => doc.annotations.filter(a => {
    if (a.type !== 'disulfide') return false
    return !useSelection || segs.some(([s, e]) => a.start >= s && a.end <= e)
  }).length, [doc.annotations, useSelection, segs])
  const hasDisulfideFeatures = doc.annotations.some(a => a.type === 'disulfide')

  const set = pkaSet(pkaSetId)
  const props = useMemo(() => proteinProperties(residues, disulfides, set), [residues, disulfides, set])
  const curve = useMemo(() => chargeCurve(props.groups, set, 0.2), [props.groups, set])
  const chargeAtPH = netCharge(props.groups, pH, set)
  const composition = useMemo(() => countResidues(residues), [residues])

  const origin = doc.metadata?.displayOrigin || 0
  const dp = (p: number) => displayPosition(p, origin, seqLen).toLocaleString()
  const selectionLabel = hasSelection
    ? `${dp(segs[0][0])}..${dp(segs[segs.length - 1][1] - 1)}`
    : ''

  const rows = [...composition.counts.entries()].sort((a, b) => b[1] - a[1])
  const n = residues.length

  return (
    <>
      {/* What the numbers are of. With a selection they follow it, since
          that is why the panel is open: the whole protein is one click away. */}
      <div className="stats-section">
        <div className="stats-section-title">SEQUENCE</div>
        {hasSelection && (
          <div className="pp-scope" role="radiogroup" aria-label="Compute for">
            <button className={`pp-scope-btn ${useSelection ? 'active' : ''}`} role="radio" aria-checked={useSelection} onClick={() => setScope('selection')}>
              Selection {selectionLabel}
            </button>
            <button className={`pp-scope-btn ${!useSelection ? 'active' : ''}`} role="radio" aria-checked={!useSelection} onClick={() => setScope('whole')}>
              Whole protein
            </button>
          </div>
        )}
        <div className="stats-row">
          <span>Length</span>
          <span>{props.length.toLocaleString()} aa</span>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-section-title">MASS</div>
        <div className="stats-row stats-row-tip">
          <span>Average</span>
          <span>{formatMass(props.mass.average)} <span className="stats-muted">{props.mass.average.toLocaleString(undefined, { maximumFractionDigits: 1 })} Da</span></span>
          <div className="stats-tip">Sum of the average residue masses plus one water. Ambiguous residues take the mean of what they stand for.</div>
        </div>
        <div className="stats-row stats-row-tip">
          <span>Monoisotopic</span>
          <span>{props.mass.monoisotopic.toLocaleString(undefined, { maximumFractionDigits: 2 })} Da</span>
          <div className="stats-tip">The mass with the most abundant isotope of every atom, as a mass spectrometer reports it.</div>
        </div>
        <div className="stats-row">
          <span>Formula</span>
          <span className="pp-formula">{formatFormula(props.formula) || '-'} <span className="stats-muted">{props.formula.atoms.toLocaleString()} atoms</span></span>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-section-title">CHARGE</div>
        <div className="stats-row">
          <span>Isoelectric point</span>
          <span>{props.pI === null ? '-' : `pI ${props.pI.toFixed(2)}`}</span>
        </div>
        <div className="stats-row">
          <span>pKa values</span>
          <select className="select pp-select" value={pkaSetId} onChange={e => setPkaSet(e.target.value as PkaSetId)} aria-label="pKa set">
            {PKA_SETS.map(s => <option key={s.id} value={s.id} title={s.description}>{s.label}</option>)}
          </select>
        </div>
        <div className="pp-ph-row">
          <label htmlFor="pp-ph">Charge at pH</label>
          <input id="pp-ph" type="range" className="ann-slider" min={0} max={14} step={0.1} value={pH} onChange={e => setPH(Number(e.target.value))} />
          <span className="pp-ph-value">{pH.toFixed(1)}</span>
          <span className="pp-charge">{signed(chargeAtPH)}</span>
        </div>
        <ChargeChart curve={curve} pI={props.pI} pH={pH} />
        <div className="stats-row">
          <span>Asp + Glu</span>
          <span>{props.negative}</span>
        </div>
        <div className="stats-row">
          <span>Arg + Lys</span>
          <span>{props.positive}</span>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-section-title">ABSORBANCE AT 280 NM</div>
        <div className="stats-row stats-row-tip">
          <span>ε, all Cys reduced</span>
          <span>{eps(props.extinction.reduced)}</span>
          <div className="stats-tip">Pace et al. (1995): 5500 per Trp, 1490 per Tyr. A 1 mg/mL solution absorbs {props.extinction.a280Reduced.toFixed(3)} in a 1 cm cell.</div>
        </div>
        <div className="stats-row stats-row-tip">
          <span>ε, all Cys as cystine</span>
          <span>{eps(props.extinction.allCystine)}</span>
          <div className="stats-tip">Every pair of Cys as a disulfide, 125 each. A 1 mg/mL solution absorbs {props.extinction.a280AllCystine.toFixed(3)}.</div>
        </div>
        {hasDisulfideFeatures && (
          <div className="stats-row stats-row-tip">
            <span>ε, annotated disulfides</span>
            <span>{eps(props.extinction.annotated)}</span>
            <div className="stats-tip">{disulfides} disulfide feature{disulfides === 1 ? '' : 's'} counted. A 1 mg/mL solution absorbs {props.extinction.a280Annotated.toFixed(3)}.</div>
          </div>
        )}
        <div className="stats-row">
          <span>A280 of 1 mg/mL</span>
          <span>{props.extinction.a280Reduced.toFixed(3)} <span className="stats-muted">to {props.extinction.a280AllCystine.toFixed(3)}</span></span>
        </div>
      </div>

      <div className="stats-section">
        <div className="stats-section-title">INDICES</div>
        <div className="stats-row stats-row-tip">
          <span>GRAVY</span>
          <span>{fmt(props.gravy, 3)}</span>
          <div className="stats-tip">Grand average of hydropathy: the mean Kyte-Doolittle value. Positive is hydrophobic.</div>
        </div>
        <div className="stats-row stats-row-tip">
          <span>Aliphatic index</span>
          <span>{fmt(props.aliphatic)}</span>
          <div className="stats-tip">Ikai (1980): relative volume of Ala, Val, Ile and Leu side chains. Higher goes with thermostability.</div>
        </div>
        <div className="stats-row stats-row-tip">
          <span>Instability index</span>
          <span>{fmt(props.instability)}{props.instability !== null && <span className={`pp-verdict ${props.instability < 40 ? 'ok' : 'warn'}`}>{props.instability < 40 ? 'stable' : 'unstable'}</span>}</span>
          <div className="stats-tip">Guruprasad et al. (1990): a dipeptide composition statistic. Below 40 predicts a protein that is stable in vivo.</div>
        </div>
        <div className="stats-row">
          <span>Aromaticity</span>
          <span>{props.aromaticity === null ? '-' : `${(props.aromaticity * 100).toFixed(1)}%`}</span>
        </div>
      </div>

      <div className="stats-section">
        <button className="stats-collapse-btn" onClick={() => setCompositionOpen(v => !v)}>
          {compositionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="stats-section-title" style={{ marginBottom: 0 }}>COMPOSITION</span>
          <span className="stats-collapse-count">{n.toLocaleString()} residues</span>
        </button>
        {n > 0 && (
          <div className="stats-nuc-bar">
            {rows.filter(([, k]) => k > 0).map(([aa, k]) => (
              <div key={aa} className="stats-nuc-bar-seg" style={{ width: `${k / n * 100}%`, background: residueColorFor(scheme, aa, 'currentColor') }} />
            ))}
          </div>
        )}
        {compositionOpen && rows.map(([aa, k]) => (
          <div className="stats-row" key={aa}>
            <span className="stats-nuc-label">
              <span className="stats-nuc-dot" style={{ background: residueColorFor(scheme, aa, 'currentColor') }} />
              {aa} <span className="stats-muted">{AA_NAMES[aa]}</span>
            </span>
            <span>{k.toLocaleString()} ({n > 0 ? (k / n * 100).toFixed(1) : '0.0'}%)</span>
          </div>
        ))}
        {compositionOpen && composition.other > 0 && (
          <div className="stats-row">
            <span className="stats-nuc-label">Other (X, U, O, stops)</span>
            <span>{composition.other.toLocaleString()}</span>
          </div>
        )}
      </div>
    </>
  )
}
