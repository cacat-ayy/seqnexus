/**
 * The guided NGS pipeline: from read sets to a mapping with its variants in
 * one go. For each read set chosen, in turn:
 *
 * 1. trim and filter (fastp for short reads, length and quality for long
 *    ones), into a new read set, unless asked not to;
 * 2. map to the references chosen, with minimap2 set for the kind of read
 *    and, for amplicons, primer clipping;
 * 3. find the variants, and the soft-clip junctions if asked.
 *
 * Every read set becomes a sample of one mapping, which opens at the end.
 * Each step is the same job the separate dialogs run; a step that fails
 * stops only its own sample. Mounted by the app, so it stays open while
 * the read sets and the mapping it makes appear behind it.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleX, Loader2, Route, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import { presetFor, PRESET_LABEL, type MapReference } from '../../ngs/mapper'
import { readSetQc, QC_LABEL } from '../../ngs/qc'
import { DEFAULT_LONG_TRIM, DEFAULT_TRIM, isLongRead, TECHNOLOGY_LABEL } from '../../ngs/types'
import type { NgsMapping } from '../../assembly/container'
import { startCallVariants, startFindJunctions, startMap, startTrim, wasmBase, CancelledError, type JobHandle } from '../../workers/readset'
import { deleteMappingStorage, deleteReadChunks } from '../../storage/idb'
import PrimerClipField from './PrimerClipField'
import { usePrimerClip } from './usePrimerClip'

const nf = new Intl.NumberFormat()

type StepState = 'skip' | 'wait' | 'run' | 'done' | 'fail'
type StepId = 'trim' | 'map' | 'variants' | 'junctions'
const STEP_LABEL: Record<StepId, string> = { trim: 'Trim', map: 'Map', variants: 'Variants', junctions: 'Junctions' }

interface SampleRun {
  readSet: ReadSet
  steps: Record<StepId, StepState>
  /** Progress of the step running, 0 to 1. */
  frac: number
  message?: string
}

export default function AnalyseReadsDialog({ readSetIds, onClose }: { readSetIds: string[]; onClose: () => void }) {
  const readSets = useEditorStore(s => s.readSets).filter(r => !r.discardedAt)
  const allTabs = useEditorStore(s => s.tabs)
  const tabs = useMemo(() => allTabs.filter(t => t.doc.sequence.length >= 100), [allTabs])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(readSetIds.filter(id => readSets.some(r => r.id === id))))
  const [refIds, setRefIds] = useState<Set<string>>(() => new Set(tabs.length === 1 ? [tabs[0].id] : []))
  // Read sets already made by trimming are not trimmed again.
  const [trim, setTrim] = useState(true)
  const [variants, setVariants] = useState(true)
  const [junctions, setJunctions] = useState(false)
  const [name, setName] = useState('')
  const [runs, setRuns] = useState<SampleRun[] | null>(null)
  const [finished, setFinished] = useState<string | null>(null)
  const handle = useRef<JobHandle<unknown> | null>(null)
  const stop = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => { stop.current = true; handle.current?.cancel() }, [])

  const refs: MapReference[] = useMemo(() => tabs.filter(t => refIds.has(t.id)).map(t => ({
    name: t.doc.name, tabId: t.id, bases: t.doc.sequence.bases, circular: t.doc.sequence.topology === 'circular',
  })), [tabs, refIds])
  const clip = usePrimerClip(refs)
  const chosen = readSets.filter(r => picked.has(r.id))
  const asFile = openedAsFile()
  // minimap2 (and fastp) cannot be loaded by a page opened from disk.
  const blocked = asFile
  const defaultName = chosen.length === 1 && refs.length
    ? `${chosen[0].name} vs ${refs.map(r => r.name).join(', ')}`
    : refs.length ? `${refs.map(r => r.name).join(', ')} samples` : 'Samples'
  const running = runs !== null && !finished

  const setStep = (i: number, step: StepId, state: StepState, extra: Partial<SampleRun> = {}) =>
    setRuns(rs => rs && rs.map((r, k) => (k === i ? { ...r, ...extra, steps: { ...r.steps, [step]: state } } : r)))

  const run = async () => {
    if (!chosen.length || !refs.length) return
    const store = useEditorStore.getState()
    const list: SampleRun[] = chosen.map(rs => ({
      readSet: rs,
      frac: 0,
      steps: { trim: trim && !rs.origin ? 'wait' : 'skip', map: 'wait', variants: variants ? 'wait' : 'skip', junctions: junctions ? 'wait' : 'skip' },
    }))
    setRuns(list)
    stop.current = false
    const assemblyId = store.newAssemblyId()
    const title = name.trim() || defaultName
    let made = 0
    const job = async <T,>(h: JobHandle<T>): Promise<T> => {
      handle.current = h as JobHandle<unknown>
      try { return await h.promise } finally { handle.current = null }
    }
    const progress = (i: number) => (d: number, t: number) => setRuns(rs => rs && rs.map((r, k) => (k === i ? { ...r, frac: t ? d / t : 0 } : r)))

    for (let i = 0; i < list.length && !stop.current; i++) {
      let rs = list[i].readSet
      let step: StepId = 'trim'
      try {
        // 1. Trim or filter, into a new read set.
        if (list[i].steps.trim === 'wait') {
          setStep(i, 'trim', 'run', { frac: 0 })
          const long = isLongRead(rs.technology)
          const settings = long ? DEFAULT_LONG_TRIM : DEFAULT_TRIM
          const toId = store.newReadSetId()
          try {
            const res = await job(startTrim({ type: 'trim', fromId: rs.id, toId, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, settings, wasmBase: wasmBase() }, progress(i)))
            const now = Date.now()
            const record: ReadSet = {
              id: toId, name: `${rs.name} ${long ? 'filtered' : 'trimmed'}`, createdAt: now, modifiedAt: now,
              technology: rs.technology, paired: rs.paired, files: [],
              stats: res.stats, chunks: res.chunks, storedBytes: res.storedBytes,
              origin: {
                fromId: rs.id, fromName: rs.name, method: long ? 'filter' : 'fastp', settings,
                readsBefore: res.readsBefore, readsAfter: res.stats.reads, basesBefore: res.basesBefore, basesAfter: res.stats.bases,
                ...(res.adapterTrimmedReads !== undefined ? { adapterTrimmedReads: res.adapterTrimmedReads } : {}),
              },
            }
            useEditorStore.getState().addReadSet(record, false)
            rs = record
          } catch (err) {
            void deleteReadChunks([toId])
            throw err
          }
          setStep(i, 'trim', 'done')
        }

        // 2. Map, as a sample of the mapping.
        step = 'map'
        setStep(i, 'map', 'run', { frac: 0 })
        const storageId = made === 0 ? assemblyId : store.newAssemblyId()
        let sample: NgsMapping
        try {
          const report = await job(startMap({
            type: 'map', storageId,
            readSet: { id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, maxLength: rs.stats.maxLength, bases: rs.stats.bases },
            refs, preset: presetFor(rs.technology), wasmBase: wasmBase(),
            ...(clip.on && clip.info ? { primerSites: clip.info.sites } : {}),
          }, progress(i)))
          sample = { readSetId: rs.id, readSetName: rs.name, storageId, report }
        } catch (err) {
          void deleteMappingStorage(storageId)
          throw err
        }
        const st = useEditorStore.getState()
        if (made === 0) {
          const now = Date.now()
          st.addMapping({
            id: assemblyId, name: title, createdAt: now, modifiedAt: now, contigIds: [], method: 'reference', settings: null,
            inputs: { readIds: [], reference: { tabId: refs[0].tabId, name: refs[0].name } }, unplaced: [], samples: [sample],
          }, false)
        } else st.addSamples(assemblyId, [sample])
        made++
        setStep(i, 'map', 'done')

        // 3. Variants and junctions.
        const references = refs.map(r => ({ name: r.name, length: r.bases.length, circular: r.circular }))
        if (variants) {
          step = 'variants'
          setStep(i, 'variants', 'run', { frac: 0 })
          await job(startCallVariants({ type: 'call-variants', storageId, references }, progress(i)))
          setStep(i, 'variants', 'done')
        }
        if (junctions) {
          step = 'junctions'
          setStep(i, 'junctions', 'run', { frac: 0 })
          await job(startFindJunctions({ type: 'find-junctions', storageId, references }, progress(i)))
          setStep(i, 'junctions', 'done')
        }
      } catch (err) {
        if (err instanceof CancelledError) { setStep(i, step, 'fail', { message: 'Stopped' }); break }
        setStep(i, step, 'fail', { message: err instanceof Error ? err.message : String(err) })
      }
    }
    setFinished(made ? assemblyId : 'none')
    if (made) {
      useEditorStore.getState().setActiveAssembly(assemblyId)
      notify.success(made === 1 ? `Made ${title}` : `Made ${title}, with ${made} samples`)
    }
  }

  const cancel = () => {
    if (handle.current) { stop.current = true; handle.current.cancel(); return }
    onClose()
  }
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, id: string) => set(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-trim ap" ref={ref} role="dialog" aria-modal="true" aria-label="Analyse reads"
        onKeyDown={e => { if (e.key === 'Escape') cancel() }}>
        <div className="aw-popover-head">
          <Route size={14} /> <span>Analyse reads</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        {runs ? (
          <div className="ngs-trim-body aw-stack">
            <p className="aw-note">{finished ? (finished === 'none' ? 'Nothing was made.' : 'Done: the mapping is open behind this window.') : 'Each read set in turn; the mapping opens when they are done.'}</p>
            <table className="rs-table ap-runs">
              <thead><tr><th>Read set</th>{(Object.keys(STEP_LABEL) as StepId[]).map(s => <th key={s}>{STEP_LABEL[s]}</th>)}</tr></thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.readSet.id} className="ngs-static">
                    <td className="rs-name">{r.readSet.name}{r.message && <div className="ap-msg">{r.message}</div>}</td>
                    {(Object.keys(STEP_LABEL) as StepId[]).map(s => (
                      <td key={s} className={`ap-step ${r.steps[s]}`}>
                        {r.steps[s] === 'done' ? <CircleCheck size={13} aria-label="done" />
                          : r.steps[s] === 'fail' ? <CircleX size={13} aria-label="failed" />
                            : r.steps[s] === 'run' ? <><Loader2 size={13} className="ap-spin" aria-label="running" /> {Math.round(r.frac * 100)}%</>
                              : r.steps[s] === 'skip' ? '-' : ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tw-trim-actions">
              {finished ? <button className="btn btn-sm btn-primary" onClick={onClose}>Close</button> : <button className="btn btn-sm" onClick={cancel}>Stop</button>}
            </div>
          </div>
        ) : (
          <div className="ngs-trim-body aw-stack">
            <p className="aw-note">From read sets to a mapping with its variants in one go: each read set is cleaned up, mapped and searched for variants, and becomes a sample of one mapping.</p>
            <div className="aw-field">
              <span>1. Read sets (samples)</span>
              {readSets.length === 0 && <p className="aw-note">Import reads first: drop FASTQ files on the window.</p>}
              <div className="ngs-ref-list">
                {readSets.map(r => {
                  const qc = readSetQc(r.stats, r.technology)
                  return (
                    <label key={r.id} className="ngs-check">
                      <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(setPicked, r.id)} />
                      {r.name}{' '}
                      <span className="aw-muted">{TECHNOLOGY_LABEL[r.technology]}, {nf.format(r.stats.reads)} reads{r.origin ? ', already cleaned up' : ''}</span>
                      <span className={`ap-qc ${qc.verdict}`} title={qc.issues.join('\n') || undefined}>QC {QC_LABEL[qc.verdict].toLowerCase()}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <label className="ngs-check" title="fastp for short reads (adapters, low-quality ends, short reads); length and quality for long reads. Each into a new read set, keeping the original.">
              <input type="checkbox" checked={trim} onChange={e => setTrim(e.target.checked)} />
              2. Trim and filter first, with the default settings
            </label>
            <div className="aw-field">
              <span>3. Map to</span>
              {tabs.length === 0 && <p className="aw-note">Open the reference sequence first (it needs at least 100 bp).</p>}
              <div className="ngs-ref-list">
                {tabs.map(t => (
                  <label key={t.id} className="ngs-check">
                    <input type="checkbox" checked={refIds.has(t.id)} onChange={() => toggle(setRefIds, t.id)} />
                    {t.doc.name} <span className="aw-muted">{nf.format(t.doc.sequence.length)} bp{t.doc.sequence.topology === 'circular' ? ', circular' : ''}</span>
                  </label>
                ))}
              </div>
              {chosen.length > 0 && <p className="aw-note">minimap2 {[...new Set(chosen.map(r => PRESET_LABEL[presetFor(r.technology)]))].join(', ')}.</p>}
            </div>
            <PrimerClipField clip={clip} />
            <div className="aw-field">
              <span>4. Then</span>
              <label className="ngs-check"><input type="checkbox" checked={variants} onChange={e => setVariants(e.target.checked)} /> Find variants</label>
              <label className="ngs-check" title="Positions where many reads stop aligning together: long deletions, inversions, inserted DNA. Reads every alignment once.">
                <input type="checkbox" checked={junctions} onChange={e => setJunctions(e.target.checked)} /> Find soft-clip junctions
              </label>
            </div>
            <label className="aw-field">
              <span>Name of the mapping</span>
              <input className="aw-text" value={name} placeholder={defaultName} onChange={e => setName(e.target.value)} />
            </label>
            {blocked && <p className="aw-note ngs-warn-note">{NEEDS_WEB('minimap2')}</p>}
            <div className="tw-trim-actions">
              <button className="btn btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={blocked || chosen.length === 0 || refs.length === 0} onClick={() => void run()}>
                {chosen.length > 1 ? `Analyse ${chosen.length} read sets` : 'Analyse'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
