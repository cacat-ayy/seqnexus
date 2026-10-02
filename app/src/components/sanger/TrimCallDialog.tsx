/**
 * Trim and call mixed bases, for one read or many.
 *
 * Settings on the right, every read's result on the left, recomputed as the
 * settings change; nothing is changed until "Apply". Each read changes as one
 * named undo step. The settings are remembered for next time, apart from the
 * vector, which is one of the open sequences.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Scissors, X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { cleanOligo } from '../../primers/oligo'
import {
  loadProcessSettings, planRead, processLabel, saveProcessSettings, type ProcessSettings,
} from '../../sanger/process'
import type { TrimSettings } from '../../sanger/trim'

interface Props {
  readIds: string[]
  onClose: () => void
}

const nf = new Intl.NumberFormat()

export default function TrimCallDialog({ readIds, onClose }: Props) {
  const allReads = useEditorStore(s => s.sequencingReads)
  const oligos = useEditorStore(s => s.oligos)
  const tabs = useEditorStore(s => s.tabs)
  const [settings, setSettings] = useState<ProcessSettings>(loadProcessSettings)
  const [vectorTab, setVectorTab] = useState('')
  const [primerDraft, setPrimerDraft] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  const reads = useMemo(() => {
    const ids = new Set(readIds)
    return allReads.filter(r => ids.has(r.id))
  }, [allReads, readIds])

  const vector = useMemo(() => {
    const tab = tabs.find(t => t.id === vectorTab)
    return tab ? { name: tab.doc.name, sequence: tab.doc.sequence.bases, circular: tab.doc.sequence.topology === 'circular' } : null
  }, [tabs, vectorTab])
  const effective: ProcessSettings = useMemo(() => ({ ...settings, trim: { ...settings.trim, vector } }), [settings, vector])
  const plans = useMemo(() => reads.map(r => ({ read: r, plan: planRead(r, effective) })), [reads, effective])
  const changing = plans.filter(p => p.plan.changed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setTrim = (patch: Partial<TrimSettings>) => setSettings(s => ({ ...s, trim: { ...s.trim, ...patch } }))
  const setMixed = (patch: Partial<ProcessSettings['mixed']>) => setSettings(s => ({ ...s, mixed: { ...s.mixed, ...patch } }))

  const addPrimer = (name: string, sequence: string) => {
    if (settings.trim.primers.some(p => p.sequence === sequence)) return
    setTrim({ primers: [...settings.trim.primers, { name, sequence }] })
  }
  const addDraft = () => {
    const seq = cleanOligo(primerDraft)
    if (!seq || seq.length < 12) { notify.info('Enter a primer of at least 12 bases (IUPAC codes allowed)'); return }
    addPrimer(`Primer ${settings.trim.primers.length + 1}`, seq)
    setPrimerDraft('')
  }

  const apply = () => {
    const store = useEditorStore.getState()
    const label = processLabel(effective)
    for (const { plan } of changing) {
      store.changeSequencingRead(plan.readId, { trimStart: plan.trimStart, trimEnd: plan.trimEnd, edits: plan.edits }, label)
    }
    saveProcessSettings(settings)
    const calls = changing.reduce((a, p) => a + p.plan.mixedCalls, 0)
    const parts = [`${label} on ${changing.length === 1 ? '1 read' : `${changing.length} reads`}`]
    if (settings.mixed.enabled) parts.push(`${nf.format(calls)} mixed ${calls === 1 ? 'base' : 'bases'} called`)
    notify.success(parts[0], {
      detail: parts[1],
      action: changing.length === 1 ? { label: 'Undo', onClick: () => useEditorStore.getState().undoSequencing(changing[0].plan.readId) } : undefined,
    })
    onClose()
  }

  const t = settings.trim
  const one = reads.length === 1

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aw-figure tw-trim" ref={ref} role="dialog" aria-modal="true" aria-label="Trim and call mixed bases">
        <div className="aw-popover-head">
          <Scissors size={14} /> <span>Trim and call mixed bases{one ? ` · ${reads[0].data.name}` : ` · ${reads.length} reads`}</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="tw-trim-preview">
            <table className="rs-table">
              <thead>
                <tr>
                  <th>Read</th>
                  <th className="num">Kept now</th>
                  <th className="num">After</th>
                  <th className="num">Change</th>
                  {settings.mixed.enabled && <th className="num">Mixed calls</th>}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(({ read, plan }) => {
                  const before = plan.before[1] - plan.before[0]
                  const after = plan.trimEnd - plan.trimStart
                  const delta = after - before
                  return (
                    <tr key={read.id} className={plan.changed ? '' : 'tw-unchanged'}>
                      <td className="rs-name" title={read.data.name}>{read.data.name}</td>
                      <td className="num">{nf.format(before)}</td>
                      <td className={`num${plan.tooShort ? ' tw-bad' : ''}`}>{nf.format(after)} <span className="aw-muted">({nf.format(plan.trimStart + 1)}–{nf.format(plan.trimEnd)})</span></td>
                      <td className="num">{delta === 0 ? '' : delta > 0 ? `+${nf.format(delta)}` : nf.format(delta)}</td>
                      {settings.mixed.enabled && <td className="num">{plan.mixedCalls || ''}</td>}
                      <td className="rs-issues" title={plan.notes.join('\n')}>{plan.notes.join(' · ') || (plan.changed ? '' : 'No change')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="aw-figure-options aw-stack">
            <label className="aw-check">
              <input type="checkbox" checked={settings.trimEnabled} onChange={e => setSettings(s => ({ ...s, trimEnabled: e.target.checked }))} />
              <b>Trim the ends</b>
            </label>
            {settings.trimEnabled && (
              <>
                <div className="aw-seg" role="radiogroup" aria-label="Quality trimming">
                  {([['error', 'Error rate'], ['quality', 'Quality'], ['keep', 'Keep current']] as const).map(([id, label]) => (
                    <button key={id} role="radio" aria-checked={t.method === id} className={t.method === id ? 'active' : ''} onClick={() => setTrim({ method: id })}>{label}</button>
                  ))}
                </div>
                {t.method === 'error' && (
                  <label className="aw-field">
                    <span title="Each base scores the limit minus its error probability; the stretch with the highest total is kept. Higher keeps more.">Error probability limit</span>
                    <input className="aw-text" type="number" min={0.001} max={0.5} step={0.01} value={t.errorLimit} onChange={e => setTrim({ errorLimit: clamp(Number(e.target.value), 0.001, 0.5) })} />
                  </label>
                )}
                {t.method === 'quality' && (
                  <label className="aw-field">
                    <span>Keep the best stretch at quality</span>
                    <input className="aw-text" type="number" min={5} max={50} value={t.minQuality} onChange={e => setTrim({ minQuality: clamp(Math.round(Number(e.target.value)), 5, 50) })} />
                  </label>
                )}
                <div className="tw-trim-pair">
                  <label className="aw-field">
                    <span>Also cut from the start</span>
                    <input className="aw-text" type="number" min={0} max={500} value={t.cutStart} onChange={e => setTrim({ cutStart: clamp(Math.round(Number(e.target.value)), 0, 2000) })} />
                  </label>
                  <label className="aw-field">
                    <span>and from the end</span>
                    <input className="aw-text" type="number" min={0} max={500} value={t.cutEnd} onChange={e => setTrim({ cutEnd: clamp(Math.round(Number(e.target.value)), 0, 2000) })} />
                  </label>
                </div>

                <div className="aw-section-label">Primers</div>
                <p className="aw-note">Found near the start, the read is trimmed after the primer; near the end (an amplicon read running into the other primer), before it.</p>
                {t.primers.length > 0 && (
                  <div className="tw-chips">
                    {t.primers.map(p => (
                      <span key={p.sequence} className="tw-chip" title={p.sequence}>
                        {p.name}
                        <button aria-label={`Remove ${p.name}`} onClick={() => setTrim({ primers: t.primers.filter(x => x !== p) })}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                {oligos.length > 0 && (
                  <select
                    className="select aw-select-full"
                    value=""
                    aria-label="Add a primer from the library"
                    onChange={e => { const o = oligos.find(x => x.id === e.target.value); if (o) addPrimer(o.name, o.sequence) }}
                  >
                    <option value="">Add from the primer library…</option>
                    {oligos.map(o => <option key={o.id} value={o.id}>{o.name} ({o.sequence.length} nt)</option>)}
                  </select>
                )}
                <div className="tw-trim-add">
                  <input className="aw-text" value={primerDraft} placeholder="Paste a primer sequence" aria-label="Primer sequence" onChange={e => setPrimerDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addDraft() }} />
                  <button className="aw-tool-icon" onClick={addDraft} aria-label="Add primer" title="Add primer"><Plus size={14} /></button>
                </div>
                {t.primers.length > 0 && (
                  <label className="aw-field">
                    <span>Mismatches allowed</span>
                    <select className="select aw-select-full" value={t.primerMismatches} onChange={e => setTrim({ primerMismatches: Number(e.target.value) })}>
                      {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}

                <div className="aw-section-label">Vector</div>
                <select className="select aw-select-full" value={vectorTab} aria-label="Vector" onChange={e => setVectorTab(e.target.value)}>
                  <option value="">None</option>
                  {tabs.filter(tb => tb.doc.sequence.length >= 100).map(tb => <option key={tb.id} value={tb.id}>{tb.doc.name} ({nf.format(tb.doc.sequence.length)} bp)</option>)}
                </select>
                {vectorTab && <p className="aw-note">Vector sequence read at either end, before or after the insert, is trimmed.</p>}

                <label className="aw-field">
                  <span>Warn when fewer bases are left than</span>
                  <input className="aw-text" type="number" min={0} max={2000} value={t.minLength} onChange={e => setTrim({ minLength: clamp(Math.round(Number(e.target.value)), 0, 5000) })} />
                </label>
              </>
            )}

            <label className="aw-check tw-trim-section">
              <input type="checkbox" checked={settings.mixed.enabled} onChange={e => setMixed({ enabled: e.target.checked })} />
              <b>Call mixed bases</b>
            </label>
            {settings.mixed.enabled && (
              <>
                <p className="aw-note">Where the second peak reaches this share of the called one, the call becomes the IUPAC code for both bases (A and G: R). Calls from an earlier run are replaced.</p>
                <label className="aw-field">
                  <span>Second peak at least {Math.round(settings.mixed.ratio * 100)}% of the first</span>
                  <input type="range" min={0.15} max={0.7} step={0.01} value={settings.mixed.ratio} onChange={e => setMixed({ ratio: Number(e.target.value) })} />
                </label>
                <label className="aw-check small">
                  <input type="checkbox" checked={settings.mixed.keepUserEdits} onChange={e => setMixed({ keepUserEdits: e.target.checked })} />
                  Leave bases I edited by hand
                </label>
              </>
            )}

            <div className="tw-trim-actions">
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={changing.length === 0} onClick={apply}>
                {changing.length === 0 ? 'Nothing to change' : changing.length === 1 ? 'Apply' : `Apply to ${changing.length} reads`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo
}
