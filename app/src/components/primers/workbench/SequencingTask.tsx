/**
 * Sequencing: a set of primers whose reads tile the selected region, each
 * checked to bind the template once. Planned on request rather than live,
 * since it scores and binding-checks many candidates per read.
 */

import { useState } from 'react'
import { useEditorStore } from '../../../store'
import {
  tileSequencingPrimers, DEFAULT_SEQUENCING, type SequencingOptions, type SequencingPlan,
} from '../../../primers/design/sequencing'
import { primerConstraints, type DesignSettings } from '../../../primers/design/settings'
import { newPrimerId } from '../../../primers/oligo'
import { notify } from '../../../toast'
import { TargetField } from './TargetField'
import { useSelectionTarget } from './target'
import { NumField } from './SettingsSection'

export default function SequencingTask({ settings }: { settings: DesignSettings }) {
  const doc = useEditorStore(s => s.doc)
  const readOnly = useEditorStore(s => s.readOnly)
  const setDesignBatch = useEditorStore(s => s.setDesignBatch)
  const addPrimers = useEditorStore(s => s.addPrimers)
  const n = doc.sequence.length
  const t = useSelectionTarget()
  const [opts, setOpts] = useState<SequencingOptions>(DEFAULT_SEQUENCING)
  const [plan, setPlan] = useState<SequencingPlan | { error: string } | null>(null)

  const names = (p: SequencingPlan) => {
    let f = 0
    let r = 0
    return p.primers.map(x => (x.strand === 1 ? `Seq F${++f}` : `Seq R${++r}`))
  }

  const run = () => {
    if (!t.target) return
    const result = tileSequencingPrimers(doc.sequence.bases, doc.sequence.topology, t.target, primerConstraints(settings), opts)
    setPlan(result)
    if (!('error' in result)) {
      const labels = names(result)
      setDesignBatch(result.primers.map((p, i) => ({ name: labels[i], sequence: p.sequence })))
    }
  }

  const saveAll = () => {
    if (!plan || 'error' in plan) return
    const labels = names(plan)
    addPrimers(plan.primers.map((p, i) => ({
      id: newPrimerId(),
      name: labels[i],
      sequence: p.sequence,
      role: 'primer' as const,
      notes: `Sequencing primer, Tm ${p.tm.toFixed(1)}°C, read ≈ ${p.read.start + 1}..${p.read.end}`,
    })))
    setDesignBatch([])
    setPlan(null)
    notify.success(`Saved ${plan.primers.length} sequencing primers`, {
      action: { label: 'Undo', onClick: () => useEditorStore.getState().undo() },
    })
  }

  const fmt = (pos: number) => ((pos % n) + 1).toLocaleString()

  return (
    <section className="wb-section">
      <TargetField label="Region" hint="Select the region to sequence." t={t} n={n} />
      <div className="wb-conc">
        <NumField label="Read bp" value={opts.readLength} min={100} onChange={v => setOpts(o => ({ ...o, readLength: Math.round(v) }))} />
        <NumField label="Overlap bp" value={opts.overlap} min={0} onChange={v => setOpts(o => ({ ...o, overlap: Math.round(v) }))} />
        <NumField label="Lead-in bp" value={opts.lead} min={0} onChange={v => setOpts(o => ({ ...o, lead: Math.round(v) }))} />
      </div>
      <div className="wb-row">
        <label>Strands</label>
        <select
          className="input ft-select" value={opts.strands}
          onChange={e => setOpts(o => ({ ...o, strands: e.target.value as SequencingOptions['strands'] }))}
        >
          <option value="both">Both</option>
          <option value="forward">Forward only</option>
          <option value="reverse">Reverse only</option>
        </select>
      </div>
      <div className="wb-save">
        <button className="btn btn-sm btn-primary" disabled={!t.target || t.target.start === t.target.end} onClick={run}>
          Plan primers
        </button>
        {plan && !('error' in plan) && plan.primers.length > 0 && !readOnly && (
          <button className="btn btn-sm" onClick={saveAll}>Save all</button>
        )}
      </div>

      {plan && 'error' in plan && <div className="pl-error">{plan.error}</div>}
      {plan && !('error' in plan) && (
        <>
          <div className="wb-status">
            {plan.primers.length} primers
            {plan.gaps.length === 0 ? ' · full coverage' : ` · ${plan.gaps.length} gap${plan.gaps.length === 1 ? '' : 's'} left`}
          </div>
          <ol className="wb-pairs" aria-label="Sequencing primers">
            {plan.primers.map((p, i) => (
              <li key={i}>
                <button onClick={() => useEditorStore.getState().setSelection({ anchor: p.start, caret: p.end })}>
                  <span className="wb-pair-rank">{names(plan)[i]}</span>
                  <span className="wb-pair-meta">{fmt(p.start)} {p.strand === 1 ? '→' : '←'}</span>
                  <span className="wb-pair-meta">read {fmt(p.read.start)}..{fmt(p.read.end - 1)}</span>
                  <span className="wb-pair-score">{p.tm.toFixed(1)} °C</span>
                </button>
              </li>
            ))}
          </ol>
          {plan.gaps.map((g, i) => (
            <div key={i} className="wb-problem">Not covered: {fmt(g.start)}..{fmt(g.end - 1)}</div>
          ))}
          {plan.warnings.map(w => <div key={w} className="wb-problem">{w}</div>)}
        </>
      )}
    </section>
  )
}
