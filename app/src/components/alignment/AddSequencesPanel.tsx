/**
 * Add sequences to an open alignment: open sequences, sequencing reads (as
 * trimmed) or pasted FASTA.
 *
 * "Fit to this alignment" aligns each new sequence to the alignment as a
 * profile and only inserts gap columns, so the existing rows and any hand
 * edits stay as they are. "Realign everything" runs an engine on all rows.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ListPlus, Loader2, Search, X } from 'lucide-react'
import { applyEdits, useEditorStore } from '../../store'
import { toUid } from '../../explorer/types'
import { cleanResidues, detectKind, ungapped, type AlnDoc, type RowInput } from '../../msa/model'
import { parseFasta } from '../../msa/formats/fasta'
import { addToAlignment, profileCost } from '../../msa/profile'
import {
  DEFAULT_ENGINE_SETTINGS, ENGINE_CHOICES, engineChoice, engineLabel, estimateSeconds, formatDuration,
  resolveEngine, settingsFromChoice, shapeOf, type ConcreteEngine, type EngineSettings,
} from '../../msa/engines/catalog'
import { AlignCancelled, startAlignment, type AlignJob } from '../../msa/engines/runner'

export type AddResult =
  | { kind: 'fit'; doc: AlnDoc; ids: string[]; from: AlnDoc; count: number }
  | { kind: 'realign'; inputs: RowInput[]; rows: string[]; engine: ConcreteEngine; label: string; from: AlnDoc }

interface Candidate {
  key: string
  name: string
  seq: string
  source: RowInput['source']
  what: string
}

interface Props {
  doc: AlnDoc
  onApply: (r: AddResult) => void
  onClose: () => void
  onBusy: (busy: boolean) => void
}

/** Profile additions run on the main thread; past this many cells they would freeze it. */
const MAX_PROFILE_CELLS = 4e8

export default function AddSequencesPanel({ doc, onApply, onClose, onBusy }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const reads = useEditorStore(s => s.sequencingReads)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [method, setMethod] = useState<'fit' | 'realign'>('fit')
  const [settings, setSettings] = useState<EngineSettings>(DEFAULT_ENGINE_SETTINGS)
  const [job, setJob] = useState<{ job: AlignJob; started: number } | null>(null)
  const [working, setWorking] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const jobRef = useRef<AlignJob | null>(null)

  const candidates = useMemo((): Candidate[] => {
    const out: Candidate[] = []
    for (const t of tabs) {
      out.push({
        key: `t:${t.id}`, name: t.doc.name, seq: t.doc.sequence.bases,
        source: { uid: toUid('sequence', t.id), name: t.doc.name }, what: 'Sequence',
      })
    }
    for (const r of reads) {
      const { bases } = applyEdits(r.data.bases, r.edits)
      out.push({
        key: `r:${r.id}`, name: r.data.name, seq: bases.slice(r.trimStart, r.trimEnd || bases.length),
        source: { uid: toUid('read', r.id), name: r.data.name }, what: 'Read, trimmed',
      })
    }
    return out
  }, [tabs, reads])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? candidates.filter(c => c.name.toLowerCase().includes(q)) : candidates
  }, [candidates, query])

  const pasted = useMemo((): RowInput[] => {
    if (!paste.trim()) return []
    const text = paste.trim().startsWith('>') ? paste : `>Pasted sequence\n${paste}`
    return parseFasta(text).rows.filter(r => r.seq.replace(/[-.\s]/g, '')).map(r => ({ name: r.name, seq: r.seq.replace(/[-.]/g, '') }))
  }, [paste])

  // Residues only (pasted text can carry numbers and spaces), no gaps, upper case.
  const inputs = useMemo((): RowInput[] => [
    ...candidates.filter(c => picked.has(c.key)).map(c => ({ name: c.name, seq: c.seq, source: c.source })),
    ...pasted,
  ].map(i => ({ ...i, seq: ungapped(cleanResidues(i.seq, doc.kind)) })).filter(i => i.seq.length > 0), [candidates, picked, pasted, doc.kind])

  const kindClash = inputs.some(i => detectKind([i.seq]) !== doc.kind && i.seq.length >= 20)
  const cost = useMemo(() => profileCost(doc, inputs.map(i => i.seq)), [doc, inputs])

  const plan = useMemo(() => {
    if (method !== 'realign' || inputs.length === 0) return null
    const all = [...doc.rows.map(r => ungapped(r.seq)), ...inputs.map(i => i.seq)].filter(s => s.length)
    const shape = shapeOf(all)
    const engine = resolveEngine(settings, shape, doc.kind)
    return { engine, label: engineLabel(engine, settings), estimate: estimateSeconds(engine, shape, doc.kind), count: all.length }
  }, [method, inputs, doc, settings])

  useEffect(() => {
    if (!job) return
    const t = setInterval(() => setElapsed((performance.now() - job.started) / 1000), 250)
    return () => clearInterval(t)
  }, [job])
  useEffect(() => () => { jobRef.current?.cancel(); onBusy(false) }, [onBusy])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!job && !working && !ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [job, working, onClose])

  const toggle = (key: string) => setPicked(p => {
    const next = new Set(p)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const run = () => {
    setError(null)
    const from = doc
    if (method === 'fit') {
      setWorking(true)
      // Let the spinner paint before the (synchronous) profile alignment.
      setTimeout(() => {
        try {
          const r = addToAlignment(from, inputs)
          onApply({ kind: 'fit', doc: r.doc, ids: r.ids, from, count: inputs.length })
          onClose()
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        } finally {
          setWorking(false)
        }
      }, 30)
      return
    }
    const seqs = [...from.rows.map(r => ungapped(r.seq)), ...inputs.map(i => i.seq)]
    if (seqs.some(s => !s)) { setError('Some rows have no residues; remove them first or use "Fit to this alignment"'); return }
    const j = startAlignment(seqs, from.kind, settings)
    jobRef.current = j
    setJob({ job: j, started: performance.now() })
    setElapsed(0)
    onBusy(true)
    j.promise
      .then(out => { onApply({ kind: 'realign', inputs, rows: out.rows, engine: out.engine, label: out.label, from }); onClose() })
      .catch(err => { if (!(err instanceof AlignCancelled)) setError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { jobRef.current = null; setJob(null); onBusy(false) })
  }

  const tooBig = method === 'fit' && cost > MAX_PROFILE_CELLS

  return (
    <div className="aw-popover aw-popover-wide" ref={ref} role="dialog" aria-label="Add sequences">
      <div className="aw-popover-head">
        <ListPlus size={14} /> <span>Add sequences</span>
        <button className="aw-icon-btn" onClick={() => { job?.job.cancel(); onClose() }} aria-label="Close"><X size={14} /></button>
      </div>
      {job ? (
        <div className="aw-running">
          <div className="aw-running-line"><Loader2 size={14} className="aw-spin" /> {job.job.label} is aligning {plan?.count ?? ''} sequences…</div>
          <div className="aw-progress"><span style={{ width: `${Math.round(100 * (1 - Math.exp(-elapsed / Math.max(0.5, job.job.estimate))))}%` }} /></div>
          <div className="aw-note">{Math.floor(elapsed)} s · expected {formatDuration(job.job.estimate)}</div>
          <div className="aw-subpanel-buttons"><button className="btn btn-sm" onClick={() => job.job.cancel()}>Cancel</button></div>
        </div>
      ) : (
        <div className="aw-stack aw-popover-body">
          <div className="aw-search">
            <Search size={12} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter open sequences and reads" aria-label="Filter" />
          </div>
          <div className="aw-pick-list" role="listbox" aria-label="Sequences to add" aria-multiselectable>
            {shown.length === 0 && <div className="aw-note aw-pick-empty">{candidates.length ? 'Nothing matches.' : 'No sequences or reads are open.'}</div>}
            {shown.map(c => (
              <label key={c.key} className="aw-pick" role="option" aria-selected={picked.has(c.key)}>
                <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
                <span className="aw-pick-name" title={c.name}>{c.name}</span>
                <span className="aw-pick-meta">{c.what} · {c.seq.length.toLocaleString()}</span>
              </label>
            ))}
          </div>
          <textarea
            className="aw-paste"
            value={paste}
            onChange={e => setPaste(e.target.value)}
            placeholder={'Or paste sequences (FASTA or plain)'}
            aria-label="Paste sequences"
            rows={3}
          />
          <div className="aw-seg" role="radiogroup" aria-label="How to add">
            <button role="radio" aria-checked={method === 'fit'} className={method === 'fit' ? 'active' : ''} onClick={() => setMethod('fit')}>Fit to this alignment</button>
            <button role="radio" aria-checked={method === 'realign'} className={method === 'realign' ? 'active' : ''} onClick={() => setMethod('realign')}>Realign everything</button>
          </div>
          {method === 'fit' ? (
            <p className="aw-note">Each sequence is aligned to the alignment as it stands; existing rows only gain gap columns, and hand edits are kept.</p>
          ) : (
            <>
              <select className="select aw-select-full" value={engineChoice(settings)} aria-label="Aligner" onChange={e => setSettings(s => settingsFromChoice(e.target.value, s))}>
                {ENGINE_CHOICES.filter(c => !c.pairwiseOnly).map(c => <option key={c.value} value={c.value} title={c.title}>{c.label}</option>)}
              </select>
              {plan && <p className="aw-note">{settings.engine === 'auto' && <><b>{plan.label}</b> · </>}{formatDuration(plan.estimate)}; hand edits are replaced.</p>}
            </>
          )}
          {kindClash && <p className="aw-error">Some of these look like {doc.kind === 'dna' ? 'protein' : 'DNA'}, but this is a {doc.kind === 'dna' ? 'DNA' : 'protein'} alignment.</p>}
          {tooBig && <p className="aw-error">Too large to fit here; use "Realign everything" with Kalign 3.</p>}
          {error && <p className="aw-error">{error}</p>}
          <div className="aw-subpanel-buttons">
            <button className="btn btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-sm btn-primary" disabled={inputs.length === 0 || tooBig || working} onClick={run}>
              {working ? <Loader2 size={12} className="aw-spin" /> : null}
              {inputs.length > 1 ? `Add ${inputs.length} sequences` : 'Add sequence'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
