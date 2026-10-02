/**
 * The contig's side panel.
 *
 * "Contig": what it is, the consensus settings, and every read with how
 * well it agrees. "Column": every read's base at the caret's column with
 * its quality and peak heights, for deciding a disagreement.
 */

import { memo, useMemo } from 'react'
import { Check, Download, FileOutput, Repeat2, Table2, Tag, Trash2 } from 'lucide-react'
import type { Consensus, ConsensusSettings } from '../../assembly/consensus'
import { sameBase } from '../../assembly/consensus'
import type { ContigDoc } from '../../assembly/types'
import type { ContigView } from '../../assembly/view'
import type { SequencingRead } from '../../store'
import { readQc, VERDICT_LABEL } from '../../sanger/qc'
import { peakTable } from '../../sanger/peaks'
import type { ContigSelection } from './paint'
import { variantLabel, type Variant, type VariantSettings } from '../../assembly/variants'

export interface ContigActions {
  openConsensus: () => void
  openAlignment: () => void
  removeRows: (ids: string[]) => void
  selectRow: (index: number) => void
  openRow: (index: number) => void
  /** Make every read covering a column agree with a base. */
  resolveColumn: (col: number, base: string) => void
  gotoVariant: (v: Variant) => void
  annotateVariants: () => void
  annotateRepeats: () => void
  exportVariants: () => void
}

interface Props {
  doc: ContigDoc
  cons: Consensus
  view: ContigView
  refPos: Int32Array
  reads: Map<string, SequencingRead>
  selection: ContigSelection | null
  caret: { row: number; col: number } | null
  editing: boolean
  tab: 'contig' | 'column' | 'variants'
  onTab: (t: 'contig' | 'column' | 'variants') => void
  variants: Variant[]
  /** The reference is an open sequence that can take features. */
  canAnnotate: boolean
  repeatCount: number
  onView: (patch: Partial<ContigView>) => void
  actions: ContigActions
}

const nf = new Intl.NumberFormat()

function ContigInspector(p: Props) {
  return (
    <aside className="aw-inspector" aria-label="Contig inspector">
      <div className="aw-tabs" role="tablist">
        <button role="tab" aria-selected={p.tab === 'contig'} className={`aw-tab ${p.tab === 'contig' ? 'active' : ''}`} onClick={() => p.onTab('contig')}>Contig</button>
        <button role="tab" aria-selected={p.tab === 'column'} className={`aw-tab ${p.tab === 'column' ? 'active' : ''}`} onClick={() => p.onTab('column')}>Column</button>
        <button role="tab" aria-selected={p.tab === 'variants'} className={`aw-tab ${p.tab === 'variants' ? 'active' : ''}`} onClick={() => p.onTab('variants')}>
          Variants{p.variants.length ? ` (${p.variants.length})` : ''}
        </button>
      </div>
      <div className="aw-inspector-body">
        {p.tab === 'contig' ? <ContigPanel {...p} /> : p.tab === 'column' ? <ColumnPanel {...p} /> : <VariantsPanel {...p} />}
      </div>
    </aside>
  )
}

export default memo(ContigInspector)

function ContigPanel({ doc, cons, view, reads, selection, onView, actions }: Props) {
  const stats = useMemo(() => {
    let covered = 0
    let total = 0
    let min = Infinity
    for (let c = 0; c < doc.width; c++) {
      const v = cons.coverage[c]
      if (v) { covered++; total += v; if (v < min) min = v }
    }
    const length = cons.bases.replace(/[- ]/g, '').length
    return { covered, mean: covered ? total / covered : 0, min: covered ? min : 0, length }
  }, [doc, cons])
  const identities = useMemo(() => doc.rows.map(r => {
    let same = 0
    let n = 0
    for (let k = 0; k < r.seq.length; k++) {
      const c = cons.bases[r.start + k]
      if (r.seq[k] === '-' && c === '-') continue
      n++
      if (sameBase(r.seq[k], c)) same++
    }
    return n ? same / n : 0
  }), [doc, cons])
  const selectedRows = selection && selection.r0 >= 0 ? doc.rows.slice(selection.r0, selection.r1) : []

  return (
    <div className="aw-panel">
      <div className="aw-sel-head">
        <div className="aw-sel-title">{doc.method === 'reference' ? `Mapped to ${doc.reference?.name}` : 'De novo contig'}</div>
        <div className="aw-sel-sub">{nf.format(doc.rows.length)} reads · {nf.format(doc.width)} columns</div>
      </div>
      <dl className="aw-stats">
        <Stat label="Consensus length" value={`${nf.format(stats.length)} bp`} strong />
        <Stat label="Mean coverage" value={stats.mean.toFixed(1)} />
        <Stat label="Lowest coverage" value={nf.format(stats.min)} />
        <Stat label="Disagreements" value={nf.format(cons.disagreements.length)} hint="Columns where some read differs from the consensus" />
        {doc.reference && <Stat label="Reference covered" value={`${Math.round(refCovered(doc, cons) * 100)}%`} hint="Share of the reference with at least one read over it" />}
      </dl>

      <div className="aw-section-label">Consensus</div>
      <div className="aw-seg" role="radiogroup" aria-label="Consensus method">
        {([['quality', 'Highest quality'], ['majority', 'Majority']] as const).map(([id, label]) => (
          <button key={id} role="radio" aria-checked={view.consensus.method === id} className={view.consensus.method === id ? 'active' : ''}
            onClick={() => onView({ consensus: { ...view.consensus, method: id as ConsensusSettings['method'] } })}
            title={id === 'quality' ? 'Each base weighed by its quality: one clean read outvotes two noisy ones' : 'One read, one vote'}
          >{label}</button>
        ))}
      </div>
      <label className="aw-field">
        <span>{view.consensus.ambiguity > 0 ? `IUPAC code for bases with at least ${Math.round(view.consensus.ambiguity * 100)}% of the weight` : 'No ambiguity codes'}</span>
        <input type="range" min={0} max={0.5} step={0.05} value={view.consensus.ambiguity} onChange={e => onView({ consensus: { ...view.consensus, ambiguity: Number(e.target.value) } })} aria-label="Ambiguity threshold" />
      </label>
      <div className="aw-actions">
        <button className="aw-action" onClick={actions.openConsensus}><FileOutput size={13} /> Open consensus as a sequence</button>
        <button className="aw-action" onClick={actions.openAlignment}><Table2 size={13} /> Open as an alignment</button>
      </div>

      <div className="aw-section-label">Reads</div>
      <div className="cw-reads">
        {doc.rows.map((r, i) => {
          const read = r.readId ? reads.get(r.readId) : undefined
          const v = read ? readQc(read.data).verdict : null
          return (
            <button
              key={r.id}
              className={`cw-read${selection && selection.r0 <= i && i < selection.r1 ? ' active' : ''}`}
              onClick={() => actions.selectRow(i)}
              onDoubleClick={() => actions.openRow(i)}
              title={`${r.name}\nColumns ${r.start + 1}–${r.start + r.seq.length}${r.reversed ? ' · reverse complemented' : ''}\nDouble-click to open the read`}
            >
              <span className={r.reversed ? 'cw-dir rev' : 'cw-dir'}>{r.reversed ? '◀' : '▶'}</span>
              <span className="cw-read-name">{r.name}</span>
              <span className="cw-read-id">{(identities[i] * 100).toFixed(1)}%</span>
              {v && v !== 'good' && <span className={`read-qc-verdict ${v}`}>{VERDICT_LABEL[v]}</span>}
            </button>
          )
        })}
      </div>
      {selectedRows.length > 0 && selectedRows.length < doc.rows.length && (
        <div className="aw-actions">
          <button className="aw-action danger" onClick={() => actions.removeRows(selectedRows.map(r => r.id))}>
            <Trash2 size={13} /> Remove {selectedRows.length === 1 ? 'the read' : `${selectedRows.length} reads`} from the contig
          </button>
        </div>
      )}
    </div>
  )
}

function refCovered(doc: ContigDoc, cons: Consensus): number {
  if (!doc.reference) return 0
  let ref = 0
  let cov = 0
  for (let c = 0; c < doc.width; c++) {
    if (doc.reference.seq[c] === '-') continue
    ref++
    if (cons.coverage[c]) cov++
  }
  return ref ? cov / ref : 0
}

function ColumnPanel({ doc, cons, refPos, reads, caret, selection, editing, actions }: Props) {
  const col = caret?.col ?? selection?.c0 ?? null
  if (col === null || col < 0 || col >= doc.width) {
    return <div className="aw-panel"><p className="tw-note">Click a column to see every read&apos;s base there, with its quality and peaks.</p></div>
  }
  const c = cons.bases[col]
  const rows = doc.rows
    .map((r, i) => ({ r, i, k: col - r.start }))
    .filter(x => x.k >= 0 && x.k < x.r.seq.length)
  const bases = new Set(rows.map(x => x.r.seq[x.k]).filter(b => b !== '-'))
  return (
    <div className="aw-panel">
      <div className="aw-sel-head">
        <div className="aw-sel-title">Column {nf.format(col + 1)}</div>
        <div className="aw-sel-sub">
          {doc.reference ? (refPos[col] ? `Reference ${nf.format(refPos[col])}: ${doc.reference.seq[col]}` : 'Not in the reference (inserted)') : 'De novo'}
        </div>
      </div>
      <dl className="aw-stats">
        <Stat label="Consensus" value={c === ' ' ? '—' : c === '-' ? 'gap' : c} strong />
        <Stat label="Consensus quality" value={c === ' ' ? '—' : `Q${cons.quality[col]}`} />
        <Stat label="Coverage" value={nf.format(cons.coverage[col])} />
      </dl>
      <table className="cw-col-table">
        <thead><tr><th>Read</th><th>Base</th><th className="num">Q</th><th className="num" title="Peak heights A C G T at this call">Peaks</th></tr></thead>
        <tbody>
          {rows.map(({ r, i, k }) => {
            const ch = r.seq[k]
            const read = r.readId ? reads.get(r.readId) : undefined
            const src = r.src[k]
            let peaks = ''
            if (read && src >= 0) {
              const t = peakTable(read.data)
              if (src < t.length) {
                const h = [0, 1, 2, 3].map(ci => Math.round(t.heights[src * 4 + (r.reversed ? 3 - ci : ci)]))
                peaks = h.join(' ')
              }
            }
            const differs = !sameBase(ch, c) && c !== ' '
            return (
              <tr key={r.id} className={differs ? 'cw-differs' : ''} onClick={() => actions.selectRow(i)}>
                <td className="cw-read-name">{r.reversed ? '◀ ' : '▶ '}{r.name}</td>
                <td className="cw-base">{ch === '-' ? 'gap' : ch}{ch !== r.orig[k] ? ` (was ${r.orig[k] === '-' ? 'gap' : r.orig[k]})` : ''}</td>
                <td className="num">{ch === '-' ? '' : r.qual[k]}</td>
                <td className="num cw-peaks">{peaks}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {editing && rows.length > 0 && (
        <>
          <div className="aw-section-label">Make every read agree</div>
          <div className="aw-actions cw-resolve">
            {[...new Set([...(c !== ' ' ? [c] : []), ...bases, '-'])].map(b => (
              <button key={b} className="aw-action" onClick={() => actions.resolveColumn(col, b)}>
                <Check size={13} /> {b === '-' ? 'Gap' : b}{b === c ? ' (consensus)' : ''}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const P_VALUES = [1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-8, 1e-10]

function VariantsPanel({ doc, view, variants, canAnnotate, repeatCount, onView, actions }: Props) {
  const s = view.variants
  const set = (patch: Partial<VariantSettings>) => onView({ variants: { ...s, ...patch } })
  const against = doc.reference ? 'the reference' : 'the consensus'
  return (
    <div className="aw-panel">
      <div className="aw-sel-head">
        <div className="aw-sel-title">{variants.length ? `${nf.format(variants.length)} ${variants.length === 1 ? 'variant' : 'variants'} against ${against}` : `No variants against ${against}`}</div>
        <div className="aw-sel-sub">Positions where reads carry another base, or a gap, often enough and confidently enough</div>
      </div>
      <label className="aw-field">
        <span>Carried by at least {Math.round(s.minFrequency * 100)}% of reads</span>
        <input type="range" min={0.05} max={1} step={0.05} value={s.minFrequency} onChange={e => set({ minFrequency: Number(e.target.value) })} />
      </label>
      <div className="tw-trim-pair">
        <label className="aw-field">
          <span>Lowest coverage</span>
          <input className="aw-text" type="number" min={1} max={100} value={s.minCoverage} onChange={e => set({ minCoverage: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
        </label>
        <label className="aw-field">
          <span title="The chance the variant is sequencing error, from the base qualities of the reads showing it">Highest P-value</span>
          <select className="select aw-select-full" value={s.maxPValue} onChange={e => set({ maxPValue: Number(e.target.value) })}>
            {P_VALUES.map(v => <option key={v} value={v}>{v === 1 ? 'Any' : v.toExponential(0)}</option>)}
          </select>
        </label>
      </div>
      <label className="aw-check small">
        <input type="checkbox" checked={s.codingOnly} disabled={!doc.reference} onChange={e => set({ codingOnly: e.target.checked })} />
        Only in coding features (CDS)
      </label>
      <label className="aw-check small" title="Fisher's exact test on forward and reverse reads; a variant seen on one strand only, at p below 1e-5, is often an artefact">
        <input type="checkbox" checked={s.excludeStrandBias} onChange={e => set({ excludeStrandBias: e.target.checked })} />
        Leave out strand-biased variants
      </label>

      {variants.length > 0 && (
        <div className="cw-variants">
          {variants.map((v, i) => (
            <button key={i} className="cw-variant" onClick={() => actions.gotoVariant(v)} title={variantTitle(v)}>
              <span className="cw-variant-pos">{nf.format(v.position)}</span>
              <span className="cw-variant-change">{variantLabel(v)}</span>
              <span className="cw-variant-freq">{Math.round(v.frequency * 100)}%</span>
              <span className={`cw-variant-effect ${effectClass(v)}`}>{v.coding ? `${v.coding.protein} · ${v.coding.effect}` : v.features[0] ?? ''}{v.repeat ? ` · ${v.repeat}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      <div className="aw-actions">
        <button className="aw-action" onClick={actions.annotateVariants} disabled={!variants.length || !canAnnotate}
          title={canAnnotate ? 'Add a "variation" feature for each variant to the reference sequence' : 'Open the reference sequence to annotate it'}>
          <Tag size={13} /> Annotate on the reference
        </button>
        <button className="aw-action" onClick={actions.annotateRepeats} disabled={!repeatCount || !canAnnotate}
          title="Add a repeat_region feature for each short tandem repeat in the reference">
          <Repeat2 size={13} /> Annotate {repeatCount ? nf.format(repeatCount) : ''} tandem repeats
        </button>
        <button className="aw-action" onClick={actions.exportVariants} disabled={!variants.length}><Download size={13} /> Export as CSV</button>
      </div>
    </div>
  )
}

function variantTitle(v: Variant): string {
  return [
    `${v.type} at ${v.position}: ${v.ref || '-'} > ${v.alt || '-'}`,
    `${v.count} of ${v.coverage} reads (${Math.round(v.frequency * 100)}%), mean Q${Math.round(v.meanQuality)}`,
    `P-value ${v.pValue.toExponential(1)} · strand bias p ${v.strandBiasP.toPrecision(2)}`,
    `Forward ${v.forward.ref}/${v.forward.alt} · reverse ${v.reverse.ref}/${v.reverse.alt} (reference/variant)`,
    ...(v.coding ? [`${v.coding.feature}: ${v.coding.cdna}, ${v.coding.protein} (${v.coding.effect})`] : []),
    ...(v.features.length ? [`In ${v.features.join(', ')}`] : []),
    ...(v.repeat ? [`Inside tandem repeat ${v.repeat}`] : []),
  ].join('\n')
}

function effectClass(v: Variant): string {
  const e = v.coding?.effect
  if (!e) return ''
  if (e === 'Synonymous') return 'mild'
  if (e === 'Missense' || e.startsWith('In-frame')) return 'moderate'
  return 'severe'
}

function Stat({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`aw-stat${strong ? ' strong' : ''}`} title={hint}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
