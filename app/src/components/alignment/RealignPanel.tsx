/**
 * Realign the selection or the whole alignment with any engine.
 *
 * Only the chosen block is sent to the aligner, as ungapped residues; the
 * result is spliced back in place (see replaceRegion), so the rest of the
 * alignment, including hand edits, is untouched. Rows with no residues in the
 * block are left as they are.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Wand2, X } from 'lucide-react'
import { ungapped, width, type AlnDoc } from '../../msa/model'
import {
  DEFAULT_ENGINE_SETTINGS, ENGINE_CHOICES, engineChoice, engineLabel, estimateSeconds, formatDuration,
  resolveEngine, settingsFromChoice, shapeOf, type ConcreteEngine, type EngineSettings,
} from '../../msa/engines/catalog'
import { AlignCancelled, startAlignment, type AlignJob } from '../../msa/engines/runner'
import type { Selection } from './paint'

export interface RealignResult {
  rowIds: string[]
  c0: number
  c1: number
  rows: string[]
  engine: ConcreteEngine
  label: string
  whole: boolean
  /** The document the job started from, to detect edits made meanwhile. */
  from: AlnDoc
}

interface Props {
  doc: AlnDoc
  selection: Selection | null
  onApply: (r: RealignResult) => void
  onClose: () => void
  /** Tell the workspace a job is running, so it can hold edits. */
  onBusy: (busy: boolean) => void
}

let lastSettings: EngineSettings = DEFAULT_ENGINE_SETTINGS

export default function RealignPanel({ doc, selection, onApply, onClose, onBusy }: Props) {
  const usable = !!selection && selection.rowIds.length >= 2 && selection.c1 - selection.c0 >= 2
  const [target, setTarget] = useState<'selection' | 'all'>(usable ? 'selection' : 'all')
  const [settings, setSettings] = useState<EngineSettings>(lastSettings)
  const [job, setJob] = useState<{ job: AlignJob; started: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const block = useMemo(() => {
    const w = width(doc)
    const sel = target === 'selection' && usable ? selection! : null
    const ids = sel ? new Set(sel.rowIds) : null
    const c0 = sel?.c0 ?? 0
    const c1 = sel?.c1 ?? w
    const rows = doc.rows.filter(r => !ids || ids.has(r.id))
    const picked = rows.map(r => ({ id: r.id, seq: ungapped(r.seq.slice(c0, c1)) })).filter(r => r.seq.length > 0)
    return { c0, c1, picked, whole: !sel }
  }, [doc, selection, target, usable])

  const plan = useMemo(() => {
    if (block.picked.length < 2) return null
    const shape = shapeOf(block.picked.map(p => p.seq))
    const engine = resolveEngine(settings, shape, doc.kind)
    return { engine, label: engineLabel(engine, settings), estimate: estimateSeconds(engine, shape, doc.kind) }
  }, [block, settings, doc.kind])

  useEffect(() => {
    if (!job) return
    const t = setInterval(() => setElapsed((performance.now() - job.started) / 1000), 250)
    return () => clearInterval(t)
  }, [job])

  // Closing the panel cancels a running job.
  const jobRef = useRef<AlignJob | null>(null)
  useEffect(() => () => { jobRef.current?.cancel(); onBusy(false) }, [onBusy])

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!job && !ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [job, onClose])

  const pairwiseOk = block.picked.length === 2

  const run = () => {
    if (!plan) return
    setError(null)
    lastSettings = settings
    const from = doc
    const j = startAlignment(block.picked.map(p => p.seq), doc.kind, settings)
    jobRef.current = j
    setJob({ job: j, started: performance.now() })
    setElapsed(0)
    onBusy(true)
    j.promise
      .then(out => {
        onApply({
          rowIds: block.picked.map(p => p.id), c0: block.c0, c1: block.c1, rows: out.rows,
          engine: out.engine, label: out.label, whole: block.whole, from,
        })
        onClose()
      })
      .catch(err => {
        if (!(err instanceof AlignCancelled)) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => { jobRef.current = null; setJob(null); onBusy(false) })
  }

  return (
    <div className="aw-popover" ref={ref} role="dialog" aria-label="Realign">
      <div className="aw-popover-head">
        <Wand2 size={14} /> <span>Realign</span>
        <button className="aw-icon-btn" onClick={() => { job?.job.cancel(); onClose() }} aria-label="Close"><X size={14} /></button>
      </div>
      {job ? (
        <div className="aw-running">
          <div className="aw-running-line"><Loader2 size={14} className="aw-spin" /> {job.job.label} is aligning {block.picked.length} sequences…</div>
          <div className="aw-progress"><span style={{ width: `${Math.round(100 * (1 - Math.exp(-elapsed / Math.max(0.5, job.job.estimate))))}%` }} /></div>
          <div className="aw-note">{Math.floor(elapsed)} s · expected {formatDuration(job.job.estimate)}</div>
          <div className="aw-subpanel-buttons">
            <button className="btn btn-sm" onClick={() => job.job.cancel()}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="aw-stack aw-popover-body">
          <div className="aw-seg" role="radiogroup" aria-label="What to realign">
            <button role="radio" aria-checked={target === 'selection'} className={target === 'selection' ? 'active' : ''} disabled={!usable} title={usable ? undefined : 'Select at least two rows and two columns first'} onClick={() => setTarget('selection')}>
              Selection
            </button>
            <button role="radio" aria-checked={target === 'all'} className={target === 'all' ? 'active' : ''} onClick={() => setTarget('all')}>
              Whole alignment
            </button>
          </div>
          <p className="aw-note">
            {block.whole
              ? `All ${block.picked.length} sequences are aligned again from scratch; hand edits are replaced.`
              : `Columns ${(block.c0 + 1).toLocaleString()}–${block.c1.toLocaleString()} of ${block.picked.length} rows are realigned; everything else stays as it is.`}
          </p>
          <label className="aw-field">
            <span>Aligner</span>
            <select
              className="select aw-select-full"
              value={engineChoice(settings)}
              onChange={e => setSettings(s => settingsFromChoice(e.target.value, s))}
            >
              {ENGINE_CHOICES.map(c => (
                <option key={c.value} value={c.value} title={c.title} disabled={c.pairwiseOnly && !pairwiseOk}>{c.label}</option>
              ))}
            </select>
          </label>
          {plan ? (
            <p className="aw-note">
              {settings.engine === 'auto' && <><b>{plan.label}</b> · </>}{formatDuration(plan.estimate)}
              {plan.estimate > 60 && plan.engine !== 'kalign' && ' — Kalign 3 would take seconds'}
            </p>
          ) : (
            <p className="aw-note">Needs at least two rows with residues in the block.</p>
          )}
          {error && <p className="aw-error">{error}</p>}
          <div className="aw-subpanel-buttons">
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={!plan || (settings.engine === 'pairwise' && !pairwiseOk)} onClick={run}>Realign</button>
          </div>
        </div>
      )}
    </div>
  )
}
