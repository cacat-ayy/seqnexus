/**
 * Everything about one lane: what is loaded, how much, cut with what, and a
 * table of what came out. Rows and bands are linked: hovering a row outlines
 * its band on the gel, and a band clicked on the gel highlights its rows.
 * A digest fragment can be found in its sequence or cut out as a new one.
 */

import { useEffect, useRef, useState } from 'react'
import { Copy, Trash2, AlertTriangle, TextSelect, Scissors, FileOutput } from 'lucide-react'
import { LADDERS, DEFAULT_LADDER_ID, getLadder } from '../../gel/ladders'
import {
  DEFAULT_PCR_NG, DEFAULT_SAMPLE_NG, DEFAULT_SIZES_NG, type GelLane, type LaneSample,
} from '../../gel/model'
import type { LaneLayout, PlacedSpecies } from '../../gel/bands'
import type { SequenceSource } from '../../gel/simulate'
import { FORM_PRESETS, formPresetId, autoLaneLabel } from '../../gel/workspace'
import { formatNg, fragmentEnds, fragmentPosition, FORM_LABEL } from '../../gel/report'
import { formatBp } from '../../gel/render/scene'
import EnzymeField from './EnzymeField'
import { parseSizes } from '../../gel/parse'

export interface SourceOption { id: string; name: string; length: number; topology: 'linear' | 'circular' }
export interface OligoOption { id: string; name: string; length: number }

interface Props {
  lane: GelLane
  index: number
  layout: LaneLayout | undefined
  sources: SourceOption[]
  oligos: OligoOption[]
  resolveSource: (id: string) => SequenceSource | null
  /** Band of this lane picked on the gel. */
  selectedBand: number | null
  onHoverBand: (bandIdx: number | null) => void
  onSelectBand: (bandIdx: number) => void
  /** `coalesceKey` groups rapid edits (typing) into one undo step. */
  onChange: (lane: GelLane, coalesceKey?: string) => void
  onRemove: () => void
  onDuplicate: (() => void) | null
  onSelectInSequence: (s: PlacedSpecies) => void
  onExtract: (s: PlacedSpecies) => void
  onOpenPcrProduct: () => void
}

type Kind = LaneSample['kind']

const KINDS: { kind: Kind; label: string; title: string }[] = [
  { kind: 'ladder', label: 'Ladder', title: 'A DNA size ladder' },
  { kind: 'sequence', label: 'Sequence', title: 'A sequence, uncut or digested' },
  { kind: 'pcr', label: 'PCR', title: 'The product of two primers from the library' },
  { kind: 'sizes', label: 'Sizes', title: 'Band sizes typed in, e.g. from a real gel' },
  { kind: 'empty', label: 'Empty', title: 'An empty well' },
]

interface Row {
  species: PlacedSpecies
  bandIdx: number | null
  merged: boolean
  faint: boolean
  ranOff: boolean
}

function rowsFor(layout: LaneLayout | undefined): Row[] {
  if (!layout) return []
  const rows: Row[] = []
  layout.bands.forEach((band, bandIdx) => {
    const merged = new Set(band.members.map(m => `${m.bp}:${m.form}`)).size > 1
    for (const species of band.members) rows.push({ species, bandIdx, merged, faint: !band.visible, ranOff: false })
  })
  for (const species of layout.ranOff) rows.push({ species, bandIdx: null, merged: false, faint: false, ranOff: true })
  return rows
}

function SizesField({ sizes, onChange }: { sizes: number[]; onChange: (sizes: number[]) => void }) {
  const [text, setText] = useState(() => sizes.join(', '))
  return (
    <input
      className="gw-input"
      value={text}
      placeholder="e.g. 3000, 1.2 kb, 450"
      aria-label="Band sizes"
      onChange={e => { setText(e.target.value); onChange(parseSizes(e.target.value)) }}
    />
  )
}

export default function LaneInspector({
  lane, index, layout, sources, oligos, resolveSource, selectedBand, onHoverBand, onSelectBand,
  onChange, onRemove, onDuplicate, onSelectInSequence, onExtract, onOpenPcrProduct,
}: Props) {
  const sample = lane.sample
  const tableRef = useRef<HTMLDivElement>(null)
  const names = {
    sequence: (id: string) => sources.find(s => s.id === id)?.name ?? null,
    oligo: (id: string) => oligos.find(o => o.id === id)?.name ?? null,
  }
  const source = sample.kind === 'sequence' ? resolveSource(sample.sourceId) : null
  const sourceInfo = sample.kind === 'sequence' ? sources.find(s => s.id === sample.sourceId) : undefined

  const setSample = (s: LaneSample, coalesceKey?: string) => onChange({ ...lane, sample: s }, coalesceKey)
  const ngKey = `ng:${lane.id}`

  const switchKind = (kind: Kind) => {
    if (kind === sample.kind) return
    // Carry the sequence across where it makes sense: digest ↔ PCR template.
    const seqId = sample.kind === 'sequence' ? sample.sourceId : sample.kind === 'pcr' ? sample.templateId : sources[0]?.id ?? ''
    switch (kind) {
      case 'ladder': return setSample({ kind: 'ladder', ladderId: DEFAULT_LADDER_ID })
      case 'empty': return setSample({ kind: 'empty' })
      case 'sequence': return setSample({ kind: 'sequence', sourceId: seqId, enzymes: [], ng: DEFAULT_SAMPLE_NG })
      case 'pcr': return setSample({
        kind: 'pcr', templateId: seqId,
        forwardId: oligos[0]?.id ?? '', reverseId: oligos[1]?.id ?? oligos[0]?.id ?? '', ng: DEFAULT_PCR_NG,
      })
      case 'sizes': return setSample({ kind: 'sizes', sizes: [], ng: DEFAULT_SIZES_NG })
    }
  }

  // Bring the picked band's rows into view.
  useEffect(() => {
    if (selectedBand === null) return
    tableRef.current?.querySelector(`[data-band="${selectedBand}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedBand])

  const rows = rowsFor(layout)
  const isLadder = sample.kind === 'ladder'
  const showEnds = rows.some(r => r.species.fragment)
  // Forms only differ for uncut plasmid; a digest is all linear.
  const showForm = !isLadder && rows.some(r => r.species.form !== 'linear')
  const nominalNg = isLadder ? getLadder(sample.ladderId)?.totalNg : undefined

  const amountField = (value: number, onValue: (ng: number) => void, label = 'Amount', hint?: string) => (
    <label className="gw-field" title={hint}>
      <span className="gw-field-label">{label}</span>
      <span className="gw-number">
        <input
          className="gw-input"
          type="number" min={0.1} max={5000} step={10}
          value={value}
          onChange={e => { const v = Number(e.target.value); if (v > 0) onValue(v) }}
        />
        <span className="gw-unit">ng</span>
      </span>
    </label>
  )

  const sequenceSelect = (value: string, onValue: (id: string) => void, label: string) => (
    <label className="gw-field">
      <span className="gw-field-label">{label}</span>
      <select className="select gw-select" value={value} onChange={e => onValue(e.target.value)}>
        {!sources.some(s => s.id === value) && <option value={value}>– choose a sequence –</option>}
        {sources.map(s => (
          <option key={s.id} value={s.id}>{s.name} ({formatBp(s.length)}, {s.topology})</option>
        ))}
      </select>
    </label>
  )

  const primerSelect = (value: string, onValue: (id: string) => void, label: string) => (
    <label className="gw-field">
      <span className="gw-field-label">{label}</span>
      <select className="select gw-select" value={value} onChange={e => onValue(e.target.value)}>
        {!oligos.some(o => o.id === value) && <option value={value}>– choose a primer –</option>}
        {oligos.map(o => <option key={o.id} value={o.id}>{o.name} ({o.length} nt)</option>)}
      </select>
    </label>
  )

  return (
    <div className="gw-inspector-body">
      <div className="gw-lane-head">
        <span className="gw-lane-num">Lane {index + 1}</span>
        <input
          className="gw-input gw-lane-label"
          value={lane.label ?? ''}
          placeholder={autoLaneLabel(sample, names)}
          aria-label="Lane label"
          onChange={e => onChange({ ...lane, label: e.target.value || undefined }, `label:${lane.id}`)}
        />
        {onDuplicate && (
          <button className="gw-icon-btn" onClick={onDuplicate} title="Duplicate lane" aria-label="Duplicate lane">
            <Copy size={13} />
          </button>
        )}
        <button className="gw-icon-btn danger" onClick={onRemove} title="Remove lane (Delete)" aria-label="Remove lane">
          <Trash2 size={13} />
        </button>
      </div>

      <div className="gw-kinds" role="radiogroup" aria-label="Sample type">
        {KINDS.map(k => (
          <button
            key={k.kind}
            role="radio"
            aria-checked={sample.kind === k.kind}
            title={k.title}
            className={`gw-kind ${sample.kind === k.kind ? 'active' : ''}`}
            onClick={() => switchKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>

      {sample.kind === 'ladder' && (
        <>
          <label className="gw-field">
            <span className="gw-field-label">Ladder</span>
            <select
              className="select gw-select"
              value={getLadder(sample.ladderId)?.id ?? DEFAULT_LADDER_ID}
              onChange={e => setSample({ kind: 'ladder', ladderId: e.target.value, ...(sample.ng !== undefined ? { ng: sample.ng } : {}) })}
            >
              {LADDERS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="gw-field">
            <span className="gw-field-label">Amount</span>
            <span className="gw-number">
              <input
                className="gw-input"
                type="number" min={10} max={5000} step={50}
                value={sample.ng ?? ''}
                placeholder={nominalNg ? String(Math.round(nominalNg)) : ''}
                onChange={e => {
                  // Cleared means "the ladder's nominal load".
                  const v = Number(e.target.value)
                  setSample({ kind: 'ladder', ladderId: sample.ladderId, ...(v > 0 ? { ng: v } : {}) }, ngKey)
                }}
              />
              <span className="gw-unit">ng</span>
            </span>
          </label>
        </>
      )}

      {sample.kind === 'sequence' && (
        <>
          {sequenceSelect(sample.sourceId, id => setSample({ ...sample, sourceId: id }), 'Sequence')}
          <div className="gw-field">
            <span className="gw-field-label">Enzymes</span>
            <EnzymeField value={sample.enzymes} onChange={enzymes => setSample({ ...sample, enzymes })} source={source} />
          </div>
          {amountField(sample.ng, ng => setSample({ ...sample, ng }, ngKey))}
          {sample.enzymes.length === 0 && sourceInfo?.topology === 'circular' && (
            <>
              <label className="gw-field">
                <span className="gw-field-label">Plasmid</span>
                <select
                  className="select gw-select"
                  value={formPresetId(sample.forms)}
                  onChange={e => setSample({ ...sample, forms: FORM_PRESETS.find(p => p.id === e.target.value)?.forms })}
                >
                  {FORM_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </label>
              <div className="gw-field-hint">
                {(() => {
                  const f = FORM_PRESETS.find(p => p.id === formPresetId(sample.forms))!.forms
                  return `${Math.round(f.supercoiled * 100)}% supercoiled · ${Math.round(f.nicked * 100)}% nicked · ${Math.round(f.linear * 100)}% linear`
                })()}
              </div>
            </>
          )}
        </>
      )}

      {sample.kind === 'pcr' && (
        <>
          {sequenceSelect(sample.templateId, id => setSample({ ...sample, templateId: id }), 'Template')}
          {oligos.length === 0 ? (
            <div className="gw-field-hint warn">The primer library is empty. Add primers in the Primers panel first.</div>
          ) : (
            <>
              {primerSelect(sample.forwardId, id => setSample({ ...sample, forwardId: id }), 'Primer 1')}
              {primerSelect(sample.reverseId, id => setSample({ ...sample, reverseId: id }), 'Primer 2')}
            </>
          )}
          {amountField(sample.ng, ng => setSample({ ...sample, ng }, ngKey), 'Amount', 'Product loaded: a few µl of the reaction')}
          {rows.some(r => r.species.pcr === 'product') && (
            <button className="gw-btn gw-inline-btn" onClick={onOpenPcrProduct}>
              <FileOutput size={13} /> Open product as a sequence
            </button>
          )}
        </>
      )}

      {sample.kind === 'sizes' && (
        <>
          <label className="gw-field">
            <span className="gw-field-label">Sizes</span>
            <SizesField sizes={sample.sizes} onChange={sizes => setSample({ ...sample, sizes }, `sizes:${lane.id}`)} />
          </label>
          {amountField(sample.ng, ng => setSample({ ...sample, ng }, ngKey), 'Per band')}
        </>
      )}

      {layout && layout.warnings.length > 0 && (
        <ul className="gw-warnings">
          {layout.warnings.map(w => <li key={w}><AlertTriangle size={12} />{w}</li>)}
        </ul>
      )}

      {rows.length > 0 && (
        <div className="gw-frag-section">
          <div className="gw-section-title">
            {isLadder || sample.kind === 'sizes' ? 'Bands' : sample.kind === 'pcr' ? 'Products' : 'Fragments'} <span className="gw-count">{rows.length}</span>
          </div>
          <div className="gw-frag-table-wrap" ref={tableRef}>
            <table className="gw-frag-table">
              <thead>
                <tr>
                  <th>Size</th>
                  {showForm && <th>Form</th>}
                  <th className="num">Mass</th>
                  {showEnds && <th>Position</th>}
                  {showEnds && <th>Ends</th>}
                  {showEnds && <th aria-label="Actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const f = r.species.fragment
                  return (
                    <tr
                      key={i}
                      data-band={r.bandIdx ?? undefined}
                      className={[
                        r.bandIdx !== null && r.bandIdx === selectedBand ? 'selected' : '',
                        r.faint ? 'faint' : '',
                        r.ranOff ? 'ran-off' : '',
                      ].join(' ')}
                      onMouseEnter={() => onHoverBand(r.bandIdx)}
                      onMouseLeave={() => onHoverBand(null)}
                      onClick={() => r.bandIdx !== null && onSelectBand(r.bandIdx)}
                    >
                      <td className="size">
                        {formatBp(r.species.bp)}
                        {r.species.reference && <span className="gw-pill" title="Reference band, loaded heavier">ref</span>}
                        {r.species.pcr === 'side' && <span className="gw-pill warn" title="Another product the primers could make">side</span>}
                        {r.merged && <span className="gw-pill" title="Runs together with another fragment">merged</span>}
                        {r.faint && <span className="gw-pill warn" title="Below what the stain can show">faint</span>}
                        {r.ranOff && <span className="gw-pill warn" title="Ran off the end of the gel">ran off</span>}
                      </td>
                      {showForm && <td title={FORM_LABEL[r.species.form]}>{r.species.form}</td>}
                      <td className="num">{formatNg(r.species.ng)}</td>
                      {showEnds && <td className="mono">{f && sourceInfo ? fragmentPosition(f, sourceInfo.length) : '–'}</td>}
                      {showEnds && <td>{f ? fragmentEnds(f) : '–'}</td>}
                      {showEnds && (
                        <td className="gw-row-actions">
                          {f && (
                            <>
                              <button
                                className="gw-row-btn"
                                title="Select in the sequence"
                                aria-label={`Select the ${formatBp(r.species.bp)} fragment in the sequence`}
                                onClick={e => { e.stopPropagation(); onSelectInSequence(r.species) }}
                              >
                                <TextSelect size={12} />
                              </button>
                              <button
                                className="gw-row-btn"
                                title="Cut out: open as a new sequence"
                                aria-label={`Extract the ${formatBp(r.species.bp)} fragment as a new sequence`}
                                onClick={e => { e.stopPropagation(); onExtract(r.species) }}
                              >
                                <Scissors size={12} />
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
