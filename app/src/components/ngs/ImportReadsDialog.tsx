/**
 * Import sequencing reads: the files dropped or chosen, grouped into samples
 * (R1/R2 files paired by name), each with its layout and technology guessed
 * from its first reads and open to correction. Samples import one after
 * another in a worker, with progress; each becomes a read set.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, FileStack, TriangleAlert, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { pairFiles, detectTechnology, looksInterleaved } from '../../ngs/detect'
import { peekReads } from '../../ngs/peek'
import { formatBytes } from '../../ngs/format'
import { TECHNOLOGY_LABEL, type Technology } from '../../ngs/types'
import type { ReadLayout } from '../../ngs/importer'
import { startImport, CancelledError, type JobHandle } from '../../workers/readset'
import type { ImportOutcome } from '../../ngs/jobs'
import { deleteReadChunks, estimateStorage } from '../../storage/idb'

interface Props {
  files: File[]
  onClose: () => void
}

interface Sample {
  name: string
  files: File[]
  layout: ReadLayout
  technology: Technology
  /** The technology was read from headers, not guessed from lengths. */
  certain: boolean
  status: 'waiting' | 'running' | 'done' | 'error'
  progress: number
  message?: string
}

const LAYOUT_LABEL: Record<ReadLayout, string> = {
  single: 'Single reads',
  pair: 'Paired (two files)',
  interleaved: 'Paired (interleaved)',
}

export default function ImportReadsDialog({ files, onClose }: Props) {
  const groups = useMemo(() => pairFiles(files.map(f => f.name)), [files])
  const [samples, setSamples] = useState<Sample[]>(() => groups.map(g => ({
    name: g.name,
    files: g.files.map(i => files[i]),
    layout: g.files.length === 2 ? 'pair' : 'single',
    technology: 'illumina',
    certain: false,
    status: 'waiting',
    progress: 0,
  })))
  const [running, setRunning] = useState(false)
  const [free, setFree] = useState<number | null>(null)
  const handle = useRef<JobHandle<ImportOutcome> | null>(null)
  const stop = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  // Guess each sample's technology and layout from its first reads.
  useEffect(() => {
    let live = true
    groups.forEach((g, i) => {
      void peekReads(files[g.files[0]]).then(p => {
        if (!live) return
        setSamples(list => list.map((s, k) => {
          if (k !== i) return s
          if (p.error) return { ...s, status: 'error', message: p.error }
          const guess = detectTechnology(p.reads)
          const interleaved = g.files.length === 1 && looksInterleaved(p.reads)
          return { ...s, technology: guess.technology, certain: guess.certain, layout: interleaved ? 'interleaved' : s.layout }
        }))
      })
    })
    void estimateStorage().then(e => { if (live && e && e.quota) setFree(Math.max(0, e.quota - e.usage)) })
    return () => { live = false }
  }, [groups, files])

  useEffect(() => () => { stop.current = true; handle.current?.cancel() }, [])

  const update = (i: number, patch: Partial<Sample>) => setSamples(list => list.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const total = samples.reduce((n, s) => n + s.files.reduce((m, f) => m + f.size, 0), 0)
  const runnable = samples.filter(s => s.status === 'waiting')

  const run = async () => {
    setRunning(true)
    stop.current = false
    const store = useEditorStore.getState()
    const made: ReadSet[] = []
    let failed = 0
    const queue = samples.map((s, i) => [s, i] as const).filter(([s]) => s.status === 'waiting')
    for (const [s, i] of queue) {
      if (stop.current) break
      const id = store.newReadSetId()
      update(i, { status: 'running', progress: 0 })
      const h = startImport({ type: 'import', id, files: s.files, layout: s.layout, technology: s.technology },
        (done, all) => update(i, { progress: all ? done / all : 0 }))
      handle.current = h
      try {
        const res = await h.promise
        const now = Date.now()
        const record: ReadSet = {
          id, name: s.name.trim() || s.files[0].name, createdAt: now, modifiedAt: now,
          technology: s.technology, paired: s.layout !== 'single',
          files: s.files.map(f => ({ name: f.name, bytes: f.size })),
          stats: res.stats, qc: res.qc, chunks: res.chunks, storedBytes: res.storedBytes,
        }
        made.push(record)
        update(i, { status: 'done', progress: 1 })
      } catch (err) {
        void deleteReadChunks([id])
        if (err instanceof CancelledError) { update(i, { status: 'waiting', progress: 0 }); break }
        failed++
        update(i, { status: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        handle.current = null
      }
    }
    made.forEach((r, k) => store.addReadSet(r, k === made.length - 1))
    setRunning(false)
    if (made.length) {
      const reads = made.reduce((n, r) => n + r.stats.reads, 0)
      notify.success(`Imported ${made.length} ${made.length === 1 ? 'read set' : 'read sets'} (${new Intl.NumberFormat().format(reads)} reads)`)
    }
    if (failed === 0 && !stop.current) onClose()
  }

  const cancel = () => {
    if (running) { stop.current = true; handle.current?.cancel(); return }
    onClose()
  }

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-import" ref={ref} role="dialog" aria-modal="true" aria-label="Import sequencing reads">
        <div className="aw-popover-head">
          <FileStack size={14} /> <span>Import sequencing reads</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-import-body">
          <p className="aw-note">
            Each sample becomes a read set. Files whose names differ only in R1 and R2 (or _1 and _2) are taken as the two mates of a pair.
            The reads are stored compressed in this browser and are not part of session files.
          </p>
          <table className="rs-table ngs-import-table">
            <thead>
              <tr><th>Sample</th><th>Files</th><th>Layout</th><th>Technology</th><th className="ngs-status-col" /></tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={i} className="ngs-static">
                  <td>
                    <input className="aw-text ngs-name-input" value={s.name} disabled={running || s.status === 'done'}
                      onChange={e => update(i, { name: e.target.value })} aria-label={`Name of sample ${i + 1}`} />
                  </td>
                  <td className="ngs-files">
                    {s.files.map(f => <div key={f.name}>{f.name} <span className="aw-muted">{formatBytes(f.size)}</span></div>)}
                  </td>
                  <td>
                    <select className="select" value={s.layout} disabled={running || s.status === 'done'}
                      onChange={e => update(i, { layout: e.target.value as ReadLayout })} aria-label={`Layout of ${s.name}`}>
                      {(s.files.length === 2 ? ['pair'] as ReadLayout[] : ['single', 'interleaved'] as ReadLayout[])
                        .map(l => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={s.technology} disabled={running || s.status === 'done'}
                      onChange={e => update(i, { technology: e.target.value as Technology, certain: true })} aria-label={`Technology of ${s.name}`}>
                      {(Object.keys(TECHNOLOGY_LABEL) as Technology[]).map(t => <option key={t} value={t}>{TECHNOLOGY_LABEL[t]}</option>)}
                    </select>
                    {!s.certain && s.status === 'waiting' && <div className="aw-muted ngs-guess">Guessed from read lengths</div>}
                  </td>
                  <td className="ngs-status-col">
                    {s.status === 'running' && (
                      <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(s.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                        <div style={{ width: `${Math.round(s.progress * 100)}%` }} />
                      </div>
                    )}
                    {s.status === 'done' && <CircleCheck size={14} className="ngs-ok" aria-label="Imported" />}
                    {s.status === 'error' && <span className="ngs-error" title={s.message}><TriangleAlert size={13} /> {s.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ngs-import-foot">
          <span className="aw-muted">
            {formatBytes(total)} of files{free !== null ? ` · ${formatBytes(free)} of storage free` : ''}
          </span>
          <span className="aw-spacer" />
          <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Close'}</button>
          <button className="btn btn-sm btn-primary" disabled={running || runnable.length === 0} onClick={() => void run()}>
            {running ? 'Importing…' : `Import ${runnable.length} ${runnable.length === 1 ? 'sample' : 'samples'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
