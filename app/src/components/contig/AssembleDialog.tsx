/**
 * Assemble reads: map them to a reference, or join them to each other de
 * novo. Reads are listed with their QC (failed reads start unticked); the
 * assembly runs in a worker with progress and can be cancelled. The result
 * is one assembly holding its contigs, the settings used and the reads that
 * did not make it into a contig, each with why.
 *
 * Given `rerunId`, the dialog runs an existing assembly again: it starts
 * from that assembly's reads, reference and settings, and the result
 * replaces its contigs (with an Undo).
 */

import './ContigWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import '../sanger/ReadQcSummary.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { readInput } from '../../assembly/input'
import { DEFAULT_ASSEMBLY } from '../../assembly/types'
import { assemblyName, referenceSource, type AssemblyRun } from '../../assembly/container'
import { startAssembly, type AssemblyHandle } from '../../workers/assembly'
import { readQc, VERDICT_LABEL } from '../../sanger/qc'

interface Props {
  readIds: string[]
  onClose: () => void
  /** Start mapped to this open sequence. */
  referenceTabId?: string
  /** Run this assembly again instead of making a new one. */
  rerunId?: string
}

const nf = new Intl.NumberFormat()
/** The reference kept in the assembly's own contig, for when the sequence is no longer open. */
const STORED_REF = '__stored__'

export default function AssembleDialog({ readIds, onClose, referenceTabId, rerunId }: Props) {
  const allReads = useEditorStore(s => s.sequencingReads)
  const tabs = useEditorStore(s => s.tabs)
  const rerun = useEditorStore(s => (rerunId ? s.assemblies.find(a => a.id === rerunId) ?? null : null))
  const rerunContigs = useEditorStore(s => s.contigs)
  const own = useMemo(() => (rerun ? rerunContigs.filter(c => c.assemblyId === rerun.id) : []), [rerun, rerunContigs])
  const ids = rerun ? rerun.inputs.readIds : readIds
  const candidates = useMemo(() => {
    const wanted = new Set(ids)
    return allReads.filter(r => wanted.has(r.id))
  }, [allReads, ids])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(
    rerun ? candidates.map(r => r.id) : candidates.filter(r => readQc(r.data).verdict !== 'fail').map(r => r.id),
  ))
  const usableTabs = tabs.filter(t => t.doc.sequence.length >= 20)
  // Running again with the reference closed: map to the copy the contig keeps.
  const storedRef = useMemo(() => {
    if (!rerun || rerun.method !== 'reference') return null
    const doc = own.find(c => c.doc.reference)?.doc
    const bases = doc ? referenceSource(doc) : null
    return doc?.reference && bases ? { name: doc.reference.name, bases, circular: doc.reference.circular } : null
  }, [rerun, own])
  const startRef = rerun?.inputs.reference?.tabId && usableTabs.some(t => t.id === rerun.inputs.reference?.tabId)
    ? rerun.inputs.reference.tabId
    : storedRef ? STORED_REF : referenceTabId ?? usableTabs[0]?.id ?? ''
  const [mode, setMode] = useState<'reference' | 'de-novo'>(
    rerun ? rerun.method : referenceTabId || (usableTabs.length > 0 && candidates.length === 1) ? 'reference' : 'de-novo',
  )
  const [refTab, setRefTab] = useState(startRef)
  const [identity, setIdentity] = useState<number | null>(rerun?.settings?.minIdentity ?? null)
  const [overlap, setOverlap] = useState(rerun?.settings?.minOverlap ?? DEFAULT_ASSEMBLY.minOverlap)
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<AssemblyHandle | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const minIdentity = identity ?? (mode === 'reference' ? 0.8 : 0.9)
  const missing = rerun ? rerun.inputs.readIds.length - candidates.length : 0
  const edited = own.some(c => c.undoStack.length > 0 || c.doc.rows.some(r => r.seq !== r.orig))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); handle.current?.cancel() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cancel = () => {
    handle.current?.cancel()
    handle.current = null
    onClose()
  }

  const run = () => {
    const reads = candidates.filter(r => picked.has(r.id))
    const tab = refTab === STORED_REF ? null : tabs.find(t => t.id === refTab)
    const reference = mode !== 'reference' ? null
      : tab ? { name: tab.doc.name, tabId: tab.id, bases: tab.doc.sequence.bases, circular: tab.doc.sequence.topology === 'circular' }
        : refTab === STORED_REF && storedRef ? { ...storedRef, tabId: rerun?.inputs.reference?.tabId ?? null }
          : null
    if (mode === 'reference' && !reference) { notify.info('Choose a reference sequence, or open one first'); return }
    if (mode === 'de-novo' && reads.length < 2) { notify.info('De novo assembly needs at least two reads'); return }
    const settings = { ...DEFAULT_ASSEMBLY, minIdentity, minOverlap: overlap }
    setProgress(0)
    const h = startAssembly({ mode, reference, inputs: reads.map(readInput), settings },
      (done, total) => setProgress(total ? done / total : 0))
    handle.current = h
    h.promise.then(report => {
      if (handle.current !== h) return
      handle.current = null
      const store = useEditorStore.getState()
      const unplaced = report.unplaced
      if (report.contigs.length === 0) {
        setProgress(null)
        notify.warning('No contig could be made', { detail: unplaced.slice(0, 6).map(u => `${u.name}: ${u.reason}`).join('\n') })
        return
      }
      const runInfo: AssemblyRun = {
        method: mode,
        settings,
        inputs: { readIds: reads.map(r => r.id), reference: reference ? { tabId: reference.tabId, name: reference.name } : null },
        unplaced,
      }
      let undo: (() => void) | null = null
      if (rerun) undo = store.replaceAssemblyRun(rerun.id, runInfo, report.contigs)
      else store.addAssembly({ ...runInfo, name: assemblyName(reads.map(r => r.data.name), reference?.name ?? null), contigs: report.contigs })
      const placed = reads.length - unplaced.length
      const msg = report.contigs.length === 1
        ? `Assembled ${placed} of ${reads.length} reads`
        : `Assembled ${placed} of ${reads.length} reads into ${report.contigs.length} contigs`
      const action = undo ? { label: 'Undo', onClick: undo } : undefined
      if (unplaced.length) notify.warning(msg, { action, detail: unplaced.slice(0, 8).map(u => `${u.name}: ${u.reason}`).join('\n') + (unplaced.length > 8 ? `\n…and ${unplaced.length - 8} more` : '') })
      else notify.success(msg, { action })
      onClose()
    }).catch(err => {
      if (handle.current !== h) return
      handle.current = null
      setProgress(null)
      notify.error('Assembly failed', { detail: err instanceof Error ? err.message : String(err) })
    })
  }

  const toggle = (id: string) => setPicked(p => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const running = progress !== null
  const title = rerun ? `Run ${rerun.name} again` : 'Assemble reads'

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure cw-assemble" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <div className="aw-popover-head">
          <Layers size={14} /> <span>{title}</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="cw-assemble-reads">
            <table className="rs-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label="All reads" checked={picked.size === candidates.length}
                      onChange={e => setPicked(e.target.checked ? new Set(candidates.map(r => r.id)) : new Set())} />
                  </th>
                  <th>Read</th><th>QC</th><th className="num">Kept</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(r => {
                  const v = readQc(r.data).verdict
                  return (
                    <tr key={r.id} onClick={() => toggle(r.id)}>
                      <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} aria-label={`Include ${r.data.name}`} /></td>
                      <td className="rs-name">{r.reversed ? '◀ ' : ''}{r.data.name}</td>
                      <td><span className={`read-qc-verdict ${v}`}>{VERDICT_LABEL[v]}</span></td>
                      <td className="num">{nf.format(Math.max(0, r.trimEnd - r.trimStart))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="aw-figure-options aw-stack">
            <div className="aw-seg" role="radiogroup" aria-label="How to assemble">
              <button role="radio" aria-checked={mode === 'reference'} className={mode === 'reference' ? 'active' : ''} onClick={() => setMode('reference')}>Map to a reference</button>
              <button role="radio" aria-checked={mode === 'de-novo'} className={mode === 'de-novo' ? 'active' : ''} onClick={() => setMode('de-novo')}>De novo</button>
            </div>
            {mode === 'reference' ? (
              <>
                <p className="aw-note">Each read is placed on the reference, on whichever strand it matches. Bases the reads have that the reference lacks get columns of their own.</p>
                <label className="aw-field">
                  <span>Reference</span>
                  <select className="select aw-select-full" value={refTab} onChange={e => setRefTab(e.target.value)}>
                    {usableTabs.length === 0 && !storedRef && <option value="">Open a sequence to map to</option>}
                    {storedRef && <option value={STORED_REF}>{storedRef.name}, as kept in the assembly ({nf.format(storedRef.bases.length)} bp)</option>}
                    {usableTabs.map(t => <option key={t.id} value={t.id}>{t.doc.name} ({nf.format(t.doc.sequence.length)} bp{t.doc.sequence.topology === 'circular' ? ', circular' : ''})</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <p className="aw-note">Reads that overlap are joined into contigs and turned to a common strand, keeping as many as possible the way you show them. Reads that overlap nothing are listed afterwards.</p>
                <label className="aw-field">
                  <span>Shortest overlap: {overlap} bases</span>
                  <input type="range" min={15} max={150} step={5} value={overlap} onChange={e => setOverlap(Number(e.target.value))} />
                </label>
              </>
            )}
            <label className="aw-field">
              <span>Lowest identity: {Math.round(minIdentity * 100)}%</span>
              <input type="range" min={0.6} max={1} step={0.01} value={minIdentity} onChange={e => setIdentity(Number(e.target.value))} />
            </label>
            {mode === 'de-novo' && <p className="aw-note">Raise it to keep similar but different sequences (haplotypes, alleles) in separate contigs.</p>}
            <p className="aw-note">The reads go in as trimmed and edited now; the contig keeps its own copy of their bases.</p>
            {missing > 0 && (
              <p className="aw-note">{nf.format(missing)} {missing === 1 ? 'read that went in is' : 'reads that went in are'} no longer in the session.</p>
            )}
            {rerun && edited && (
              <p className="aw-note cw-warn-note">The new contigs replace the current ones, and edits made in them are lost. Undo puts them back.</p>
            )}
            {running && (
              <div className="cw-assemble-progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
            )}
            <div className="tw-trim-actions">
              <button className="btn btn-sm" onClick={cancel}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={running || picked.size === 0 || (mode === 'reference' && !refTab)} onClick={run}>
                {running ? 'Assembling…' : `${rerun ? 'Run again with' : 'Assemble'} ${picked.size} ${picked.size === 1 ? 'read' : 'reads'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
