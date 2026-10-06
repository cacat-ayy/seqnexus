/**
 * The variants of a mapping, docked under its reads and linked to them:
 * clicking a row (or Up and Down in the table) moves the view to the
 * variant, and a variant pointed at in the view's variant track is lit up
 * here. Hovering a row shows its evidence.
 *
 * Thresholds are chips across the top, applied live: each holds its value
 * in a small field, x turns it off, and turned-off ones wait under "Add a
 * filter". A preset sets them all for a kind of read. Variants that fail a
 * filter can be listed too, with what they failed.
 *
 * Rows are drawn only where the list is scrolled to, so a genome's
 * thousands of variants scroll smoothly.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Download, FileOutput, Plus, Tags, TriangleAlert, X } from 'lucide-react'
import HoverCard from '../HoverCard'
import {
  FILTERS, PRESET_NAME, STRAND_BIAS_P, VARIANT_PRESETS, variantFilters, variantKey, variantLabel, variantQual,
  type FilterId, type Variant, type VariantPreset, type VariantSettings, type VariantType,
} from '../../assembly/variants'

const nf = new Intl.NumberFormat()
const ROW_H = 24

export type CallState = { kind: 'none' } | { kind: 'running'; progress: number } | { kind: 'ready' } | { kind: 'error'; message: string }


interface Props {
  variants: readonly Variant[]
  settings: VariantSettings
  preset: VariantPreset | 'custom'
  onSettings: (s: VariantSettings, preset: VariantPreset | 'custom') => void
  selected: string | null
  /** Lit up from the view. */
  lit: string | null
  onSelect: (v: Variant) => void
  call: CallState
  onCall: () => void
  canAnnotate: boolean
  annotateTitle: string
  onAnnotate: (vs: Variant[]) => void
  onExport: (format: 'vcf' | 'vcf-all' | 'csv') => void
  onConsensus: () => void
  onClose: () => void
  refName: string
}

type SortKey = 'position' | 'frequency' | 'coverage' | 'count' | 'quality' | 'effect'

const EFFECT_RANK: Record<string, number> = {
  Nonsense: 0, Frameshift: 0, 'Start lost': 0, 'Stop lost': 0, Missense: 1, 'In-frame insertion': 1, 'In-frame deletion': 1, Synonymous: 2,
}

function effectClass(v: Variant): string {
  const e = v.coding?.effect
  if (!e) return ''
  if (e === 'Synonymous') return 'mild'
  if (e === 'Missense' || e.startsWith('In-frame')) return 'moderate'
  return 'severe'
}

function VariantTable(p: Props) {
  const s = p.settings
  const [types, setTypes] = useState<Set<VariantType>>(() => new Set(['SNP', 'Insertion', 'Deletion']))
  const [showFiltered, setShowFiltered] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'position', dir: 1 })
  const [addOpen, setAddOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [hover, setHover] = useState<{ v: Variant; x: number; y: number } | null>(null)
  const set = (patch: Partial<VariantSettings>) => p.onSettings({ ...s, ...patch }, 'custom')

  const judged = useMemo(() => p.variants.map(v => ({ v, failed: variantFilters(v, s) })), [p.variants, s])
  const counts = useMemo(() => {
    const c = { SNP: 0, Insertion: 0, Deletion: 0, failed: 0 }
    for (const j of judged) { if (j.failed.length) c.failed++; else c[j.v.type]++ }
    return c
  }, [judged])
  const rows = useMemo(() => {
    const list = judged.filter(j => types.has(j.v.type) && (showFiltered || j.failed.length === 0))
    const key = (j: (typeof list)[number]): number => {
      const v = j.v
      switch (sort.key) {
        case 'frequency': return v.frequency
        case 'coverage': return v.coverage
        case 'count': return v.count
        case 'quality': return variantQual(v)
        case 'effect': return v.coding ? EFFECT_RANK[v.coding.effect] ?? 3 : 4
        default: return v.position
      }
    }
    return list.sort((a, b) => (key(a) - key(b)) * sort.dir || a.v.position - b.v.position)
  }, [judged, types, showFiltered, sort])

  // ---- Scrolling, drawing only the rows in view ----
  const bodyRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, h: 300 })
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => setScroll({ top: el.scrollTop, h: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 5)
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + 5)
  const reveal = (i: number) => {
    const el = bodyRef.current
    if (!el) return
    const y = i * ROW_H
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
  }
  const lit = p.lit
  useEffect(() => {
    if (!lit) return
    const i = rows.findIndex(r => variantKey(r.v) === lit)
    if (i >= 0) reveal(i)
  }, [lit]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const at = rows.findIndex(r => variantKey(r.v) === p.selected)
    const i = Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))
    if (rows[i]) { p.onSelect(rows[i].v); reveal(i) }
  }

  useEffect(() => {
    if (!addOpen && !exportOpen) return
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.vt-pop')) { setAddOpen(false); setExportOpen(false) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [addOpen, exportOpen])

  // ---- Chips ----
  const qual = s.maxPValue >= 1 ? 0 : Math.round(-10 * Math.log10(s.maxPValue))
  const chips: { id: FilterId; on: boolean; label: string; field?: { value: number; min: number; max: number; suffix?: string; onChange: (n: number) => void }; off: () => void; add: () => void }[] = [
    { id: 'depth', on: s.minCoverage > 1, label: 'Depth ≥', field: { value: s.minCoverage, min: 1, max: 100000, onChange: n => set({ minCoverage: Math.max(1, n) }) }, off: () => set({ minCoverage: 1 }), add: () => set({ minCoverage: 10 }) },
    { id: 'frequency', on: s.minFrequency > 0, label: 'Frequency ≥', field: { value: Math.round(s.minFrequency * 100), min: 0, max: 100, suffix: '%', onChange: n => set({ minFrequency: Math.max(0, Math.min(100, n)) / 100 }) }, off: () => set({ minFrequency: 0 }), add: () => set({ minFrequency: 0.2 }) },
    { id: 'reads', on: s.minAltReads > 0, label: 'Reads ≥', field: { value: s.minAltReads, min: 0, max: 100000, onChange: n => set({ minAltReads: Math.max(0, n) }) }, off: () => set({ minAltReads: 0 }), add: () => set({ minAltReads: 3 }) },
    { id: 'quality', on: s.maxPValue < 1, label: 'Quality ≥ Q', field: { value: qual, min: 0, max: 999, onChange: n => set({ maxPValue: n <= 0 ? 1 : 10 ** (-n / 10) }) }, off: () => set({ maxPValue: 1 }), add: () => set({ maxPValue: 1e-6 }) },
    { id: 'strandBias', on: s.excludeStrandBias, label: 'No strand bias', off: () => set({ excludeStrandBias: false }), add: () => set({ excludeStrandBias: true }) },
    { id: 'homopolymer', on: s.excludeHomopolymerIndels, label: 'No indels in homopolymers ≥', field: { value: s.homopolymerLength, min: 2, max: 50, onChange: n => set({ homopolymerLength: Math.max(2, n) }) }, off: () => set({ excludeHomopolymerIndels: false }), add: () => set({ excludeHomopolymerIndels: true }) },
    { id: 'coding', on: s.codingOnly, label: 'Coding only', off: () => set({ codingOnly: false }), add: () => set({ codingOnly: true }) },
  ]
  const passing = counts.SNP + counts.Insertion + counts.Deletion

  const head = (key: SortKey, label: string, title?: string, cls = 'num') => (
    <button className={`vt-th ${cls}${sort.key === key ? ' sorted' : ''}`} title={title}
      onClick={() => setSort(o => ({ key, dir: o.key === key ? (o.dir === 1 ? -1 : 1) : key === 'position' ? 1 : -1 }))}>
      {label}{sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
    </button>
  )

  return (
    <section className="vt" aria-label="Variants">
      <div className="vt-bar">
        <span className="vt-title">Variants</span>
        <span className="aw-muted">{p.call.kind === 'ready' ? `${nf.format(passing)} on ${p.refName}` : ''}</span>
        <select className="select aw-select" value={p.preset} aria-label="Thresholds for"
          onChange={e => { const k = e.target.value as VariantPreset | 'custom'; if (k !== 'custom') p.onSettings(VARIANT_PRESETS[k], k) }}
          title="Starting thresholds for a kind of read">
          {(Object.keys(VARIANT_PRESETS) as VariantPreset[]).map(k => <option key={k} value={k}>{PRESET_NAME[k]} thresholds</option>)}
          {p.preset === 'custom' && <option value="custom">Own thresholds</option>}
        </select>
        <span className="aw-spacer" />
        <div className="vt-pop">
          <button className="aw-tool-btn" onClick={() => setExportOpen(o => !o)} disabled={p.call.kind !== 'ready'} aria-expanded={exportOpen}>
            <Download size={13} /> Export <ChevronDown size={12} />
          </button>
          {exportOpen && (
            <div className="aw-menu vt-menu-right" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={() => { p.onExport('vcf'); setExportOpen(false) }}>
                <span className="aw-menu-label">VCF, variants that pass</span>
                <span className="aw-menu-desc">Every reference, for IGV, bcftools and annotation tools</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { p.onExport('vcf-all'); setExportOpen(false) }}>
                <span className="aw-menu-label">VCF, every candidate</span>
                <span className="aw-menu-desc">Those that fail a threshold say which in FILTER</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => { p.onExport('csv'); setExportOpen(false) }}>
                <span className="aw-menu-label">CSV of this table</span>
              </button>
            </div>
          )}
        </div>
        <button className="aw-tool-btn" onClick={() => p.onAnnotate(rows.filter(r => !r.failed.length).map(r => r.v))}
          disabled={p.call.kind !== 'ready' || !rows.some(r => !r.failed.length) || !p.canAnnotate} title={p.annotateTitle}>
          <Tags size={13} /> Add to the reference
        </button>
        <button className="aw-tool-btn" onClick={p.onConsensus} disabled={p.call.kind !== 'ready'}
          title="The sample's sequence: the reference with the reads' alleles, low coverage as N">
          <FileOutput size={13} /> Consensus…
        </button>
        <button className="aw-icon-btn" onClick={p.onClose} title="Hide the variants" aria-label="Hide the variants"><X size={14} /></button>
      </div>

      {p.call.kind === 'ready' && (
        <div className="vt-chips">
          {(['SNP', 'Insertion', 'Deletion'] as VariantType[]).map(t => (
            <button key={t} className={`vt-type${types.has(t) ? ' on' : ''}`} aria-pressed={types.has(t)}
              onClick={() => setTypes(o => { const n = new Set(o); if (n.has(t)) n.delete(t); else n.add(t); return n })}>
              {t === 'SNP' ? 'SNPs' : t === 'Insertion' ? 'Insertions' : 'Deletions'} <b>{nf.format(counts[t])}</b>
            </button>
          ))}
          <span className="aw-tool-sep" />
          {chips.filter(c => c.on).map(c => (
            <span key={c.id} className="vt-chip" title={FILTERS[c.id].label + ' (left out)'}>
              {c.label}
              {c.field && (
                <>
                  <input type="number" className="vt-chip-input" value={c.field.value} min={c.field.min} max={c.field.max}
                    aria-label={c.label} onChange={e => c.field!.onChange(Math.round(Number(e.target.value) || 0))} />
                  {c.field.suffix}
                </>
              )}
              <button className="vt-chip-x" onClick={c.off} aria-label={`Remove: ${c.label}`}><X size={11} /></button>
            </span>
          ))}
          {chips.some(c => !c.on) && (
            <div className="vt-pop">
              <button className="vt-add" onClick={() => setAddOpen(o => !o)} aria-expanded={addOpen}><Plus size={11} /> Add a filter</button>
              {addOpen && (
                <div className="aw-menu" role="menu">
                  {chips.filter(c => !c.on).map(c => (
                    <button key={c.id} role="menuitem" className="aw-menu-item" onClick={() => { c.add(); setAddOpen(false) }}>
                      <span className="aw-menu-label">{FILTERS[c.id].label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <span className="aw-spacer" />
          <label className="aw-check small">
            <input type="checkbox" checked={showFiltered} onChange={e => setShowFiltered(e.target.checked)} />
            List the {nf.format(counts.failed)} left out
          </label>
        </div>
      )}

      {p.call.kind === 'none' && (
        <div className="vt-empty">
          <p className="aw-note">Variants are found by counting every read again at the positions where some differ from the reference. This is done once and kept with the mapping.</p>
          <button className="btn btn-sm btn-primary" onClick={p.onCall}>Find variants</button>
        </div>
      )}
      {p.call.kind === 'running' && (
        <div className="vt-empty">
          <p className="aw-note">Counting the reads at each candidate site… {Math.round(p.call.progress * 100)}%</p>
          <div className="ngs-progress"><div style={{ width: `${Math.round(p.call.progress * 100)}%` }} /></div>
        </div>
      )}
      {p.call.kind === 'error' && <div className="vt-empty"><p className="aw-note ngs-warn-note">{p.call.message}</p><button className="btn btn-sm" onClick={p.onCall}>Try again</button></div>}

      {p.call.kind === 'ready' && (
        <div className="vt-table" role="grid" aria-rowcount={rows.length}>
          <div className={`vt-row vt-head${showFiltered ? ' with-filter' : ''}`} role="row">
            {head('position', 'Position', undefined, '')}
            <span className="vt-th">Change</span>
            {head('frequency', 'Frequency')}
            {head('coverage', 'Depth', 'Reads covering the position')}
            {head('count', 'Reads', 'Reads carrying the variant, forward + reverse')}
            {head('quality', 'Quality', 'Phred-scaled chance it is sequencing error: Q30 is 1 in 1,000')}
            {head('effect', 'Effect', undefined, '')}
            <span className="vt-th">Flags</span>
            {showFiltered && <span className="vt-th">Left out for</span>}
          </div>
          <div className="vt-body" ref={bodyRef} tabIndex={0} onKeyDown={onKey}
            onScroll={e => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}>
            {rows.length === 0 && <p className="aw-note vt-none">No variants {showFiltered ? '' : 'pass the filters '}here.</p>}
            <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {rows.slice(first, last).map(({ v, failed }, k) => {
                const key = variantKey(v)
                return (
                  <div key={key} role="row" style={{ top: (first + k) * ROW_H }}
                    className={`vt-row${showFiltered ? ' with-filter' : ''}${key === p.selected ? ' selected' : ''}${key === lit ? ' lit' : ''}${failed.length ? ' failed' : ''}`}
                    onClick={() => p.onSelect(v)}
                    onMouseMove={e => setHover({ v, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}>
                    <span className="vt-pos">{nf.format(v.position)}</span>
                    <span className={`vt-change ${v.type}`}>{variantLabel(v)}</span>
                    <span className="num vt-freq"><i style={{ width: `${Math.round(v.frequency * 100)}%` }} />{(v.frequency * 100).toFixed(v.frequency < 0.1 ? 1 : 0)}%</span>
                    <span className="num">{nf.format(v.coverage)}</span>
                    <span className="num">{nf.format(v.count)} <span className="aw-muted">{v.forward.alt}+/{v.reverse.alt}−</span></span>
                    <span className="num">{variantQual(v) >= 999 ? '≥999' : Math.round(variantQual(v))}</span>
                    <span className={`vt-effect ${effectClass(v)}`}>{v.coding ? `${v.coding.protein} ${v.coding.effect.toLowerCase()}` : v.features[0] ?? ''}</span>
                    <span className="vt-flags">
                      {v.strandBiasP < STRAND_BIAS_P && <span className="vt-flag" title={`Strand bias: p ${v.strandBiasP.toPrecision(2)}`}>strand</span>}
                      {v.homopolymer && <span className="vt-flag" title={`In a run of ${v.homopolymer} of the same base`}>HP{v.homopolymer}</span>}
                      {v.repeat && <span className="vt-flag" title={`In the tandem repeat ${v.repeat}`}>{v.repeat}</span>}
                    </span>
                    {showFiltered && <span className="vt-failed">{failed.map(f => FILTERS[f].vcf).join(', ')}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {hover && <VariantCard v={hover.v} x={hover.x} y={hover.y} failed={variantFilters(hover.v, s)} />}
    </section>
  )
}

export default memo(VariantTable)

/** The evidence for a variant: its numbers, the alleles seen with their strands, and why it was left out. */
export function VariantCard({ v, x, y, failed }: { v: Variant; x: number; y: number; failed: readonly FilterId[] }) {
  const q = variantQual(v)
  return (
    <HoverCard x={x + 14} y={y + 14} pinKey={`variant:${variantKey(v)}`}>
      <div className="ft-tooltip-name">
        <span className="hc-name">{v.type} {variantLabel(v)} at {nf.format(v.position)}</span>
        <span className="hc-chip">{Math.round(v.frequency * 100)}%</span>
      </div>
      <table className="ft-tooltip-table">
        <tbody>
          <tr><td>Reads</td><td>{nf.format(v.count)} of {nf.format(v.coverage)}: {v.forward.alt} forward, {v.reverse.alt} reverse</td></tr>
          <tr><td>Reference reads</td><td>{v.forward.ref} forward, {v.reverse.ref} reverse</td></tr>
          <tr><td>Quality</td><td>{q >= 999 ? 'Q999 or more' : `Q${Math.round(q)}`} (P {v.pValue > 0 ? v.pValue.toExponential(1) : '< 1e-300'} by error alone)</td></tr>
          <tr><td>Strand bias</td><td>p {v.strandBiasP.toPrecision(2)}{v.strandBiasP < STRAND_BIAS_P ? ': seen mostly on one strand' : ''}</td></tr>
          {v.meanQuality >= 0 && v.type !== 'Deletion' && <tr><td>Base quality</td><td>Q{Math.round(v.meanQuality)} on average</td></tr>}
          {v.coding && <tr><td>{v.coding.feature}</td><td>{v.coding.cdna}, {v.coding.protein} ({v.coding.effect.toLowerCase()})</td></tr>}
          {!v.coding && v.features.length > 0 && <tr><td>In</td><td>{v.features.join(', ')}</td></tr>}
          {v.homopolymer && <tr><td>Homopolymer</td><td>A run of {v.homopolymer} {(v.type === 'Insertion' ? v.alt : v.ref)[0]}: indels here are a common sequencing error</td></tr>}
          {v.repeat && <tr><td>Repeat</td><td>Inside {v.repeat}</td></tr>}
        </tbody>
      </table>
      {v.alleles && v.alleles.length > 0 && (
        <table className="vt-alleles">
          <thead><tr><th>Allele</th><th>Forward</th><th>Reverse</th><th>Mean Q</th></tr></thead>
          <tbody>
            {v.alleles.slice(0, 8).map(a => (
              <tr key={a.allele} className={a.isRef ? 'ref' : ''}>
                <td>{a.allele.length > 12 ? `${a.allele.slice(0, 11)}…` : a.allele}{a.isRef ? ' (ref)' : ''}</td>
                <td>{nf.format(a.forward)}</td><td>{nf.format(a.reverse)}</td>
                <td>{a.meanQuality < 0 ? '' : Math.round(a.meanQuality)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {failed.length > 0 && (
        <div className="vt-card-failed"><TriangleAlert size={12} /> Left out: {failed.map(f => FILTERS[f].label.toLowerCase()).join('; ')}</div>
      )}
    </HoverCard>
  )
}
