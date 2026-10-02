/**
 * Assemble reads: map them to a reference, or join them to each other de
 * novo. Reads are listed with their QC (failed reads start unticked); the
 * assembly runs in a worker with progress and can be cancelled. Reads that
 * did not make it into a contig are reported, each with why.
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
import { startAssembly, type AssemblyHandle } from '../../workers/assembly'
import { readQc, VERDICT_LABEL } from '../../sanger/qc'

interface Props {
  readIds: string[]
  onClose: () => void
  /** Start mapped to this open sequence. */
  referenceTabId?: string
}

const nf = new Intl.NumberFormat()

export default function AssembleDialog({ readIds, onClose, referenceTabId }: Props) {
  const allReads = useEditorStore(s => s.sequencingReads)
  const tabs = useEditorStore(s => s.tabs)
  const candidates = useMemo(() => {
    const ids = new Set(readIds)
    return allReads.filter(r => ids.has(r.id))
  }, [allReads, readIds])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter(r => readQc(r.data).verdict !== 'fail').map(r => r.id)))
  const usableTabs = tabs.filter(t => t.doc.sequence.length >= 20)
  const [mode, setMode] = useState<'reference' | 'de-novo'>(referenceTabId || (usableTabs.length > 0 && candidates.length === 1) ? 'reference' : 'de-novo')
  const [refTab, setRefTab] = useState(referenceTabId ?? usableTabs[0]?.id ?? '')
  const [identity, setIdentity] = useState<number | null>(null)
  const [overlap, setOverlap] = useState(DEFAULT_ASSEMBLY.minOverlap)
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<AssemblyHandle | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const minIdentity = identity ?? (mode === 'reference' ? 0.8 : 0.9)

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
    const tab = tabs.find(t => t.id === refTab)
    if (mode === 'reference' && !tab) { notify.info('Choose a reference sequence, or open one first'); return }
    if (mode === 'de-novo' && reads.length < 2) { notify.info('De novo assembly needs at least two reads'); return }
    setProgress(0)
    const h = startAssembly({
      mode,
      reference: mode === 'reference' && tab ? { name: tab.doc.name, tabId: tab.id, bases: tab.doc.sequence.bases, circular: tab.doc.sequence.topology === 'circular' } : null,
      inputs: reads.map(readInput),
      settings: { ...DEFAULT_ASSEMBLY, minIdentity, minOverlap: overlap },
    }, (done, total) => setProgress(total ? done / total : 0))
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
      const folder = report.contigs.length > 1 ? `Assembly ${new Date().toISOString().slice(0, 10)}` : undefined
      store.addContigs(report.contigs, folder)
      const placed = reads.length - unplaced.length
      const msg = report.contigs.length === 1
        ? `Assembled ${placed} of ${reads.length} reads`
        : `Assembled ${placed} of ${reads.length} reads into ${report.contigs.length} contigs`
      if (unplaced.length) notify.warning(msg, { detail: unplaced.slice(0, 8).map(u => `${u.name}: ${u.reason}`).join('\n') + (unplaced.length > 8 ? `\n…and ${unplaced.length - 8} more` : '') })
      else notify.success(msg)
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

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure cw-assemble" ref={ref} role="dialog" aria-modal="true" aria-label="Assemble reads">
        <div className="aw-popover-head">
          <Layers size={14} /> <span>Assemble reads</span>
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
                    {usableTabs.length === 0 && <option value="">Open a sequence to map to</option>}
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
            {running && (
              <div className="cw-progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
              </div>
            )}
            <div className="tw-trim-actions">
              <button className="btn btn-sm" onClick={cancel}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={running || picked.size === 0 || (mode === 'reference' && !refTab)} onClick={run}>
                {running ? 'Assembling…' : `Assemble ${picked.size} ${picked.size === 1 ? 'read' : 'reads'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
