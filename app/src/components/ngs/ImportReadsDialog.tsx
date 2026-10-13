/**
 * Import sequencing reads: the files dropped or chosen, grouped into samples
 * (R1/R2 files paired by name), each with its layout and technology guessed
 * from its first reads and open to correction. Samples import one after
 * another in a worker, with progress; each becomes a read set.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import { useEffect, useRef, useState } from 'react'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { toUid } from '../../explorer/types'
import type { Place } from '../../import/folders'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { pairFiles, detectTechnology, looksInterleaved } from '../../ngs/detect'
import { peekReads } from '../../ngs/peek'
import { formatBytes } from '../../utils/format'
import { TECHNOLOGY_LABEL, type Technology } from '../../ngs/types'
import type { ReadLayout } from '../../ngs/importer'
import { startImport, CancelledError, type JobHandle } from '../../workers/readset'
import type { ImportOutcome } from '../../ngs/jobs'
import { deleteReadChunks, estimateStorage } from '../../storage/idb'

interface Props {
  files: File[]
  /** Where a file's read set goes: the folder of the directory it came from, or the one it was dropped on. */
  placeOf?: (file: File) => Place | undefined
  onClose: () => void
}

interface Sample {
  /** Stable across additions, so a late guess or progress lands on its own row. */
  id: number
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

let sampleSeq = 0

/** Group files into samples, R1 and R2 of a pair together. */
function toSamples(files: File[]): Sample[] {
  return pairFiles(files.map(f => f.name)).map(g => ({
    id: ++sampleSeq,
    name: g.name,
    files: g.files.map(i => files[i]),
    layout: g.files.length === 2 ? 'pair' : 'single',
    technology: 'illumina',
    certain: false,
    status: 'waiting',
    progress: 0,
  }))
}

export default function ImportReadsDialog({ files, placeOf, onClose }: Props) {
  const [samples, setSamples] = useState<Sample[]>(() => toSamples(files))
  const [running, setRunning] = useState(false)
  const [free, setFree] = useState<number | null>(null)
  const handle = useRef<JobHandle<ImportOutcome> | null>(null)
  const stop = useRef(false)
  const live = useRef(true)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  useEffect(() => {
    live.current = true
    void estimateStorage().then(e => { if (live.current && e && e.quota) setFree(Math.max(0, e.quota - e.usage)) })
    return () => { live.current = false }
  }, [])

  // Files dropped while the dialog is open join it as more samples. The
  // list used to be built once, so they were dropped without a word and
  // their guesses landed on the rows of the first files.
  const seen = useRef(new Set(files))
  useEffect(() => {
    const fresh = files.filter(f => !seen.current.has(f))
    if (fresh.length === 0) return
    for (const f of fresh) seen.current.add(f)
    setSamples(list => [...list, ...toSamples(fresh)])
  }, [files])

  // Guess each sample's technology and layout from its first reads, once.
  const peeked = useRef(new Set<number>())
  useEffect(() => {
    for (const sample of samples) {
      if (peeked.current.has(sample.id)) continue
      peeked.current.add(sample.id)
      void peekReads(sample.files[0]).then(p => {
        if (!live.current) return
        setSamples(list => list.map(s => {
          if (s.id !== sample.id) return s
          if (p.error) return { ...s, status: 'error', message: p.error }
          const guess = detectTechnology(p.reads)
          const interleaved = s.files.length === 1 && looksInterleaved(p.reads)
          return { ...s, technology: guess.technology, certain: guess.certain, layout: interleaved ? 'interleaved' : s.layout }
        }))
      })
    }
  }, [samples])

  useEffect(() => () => { stop.current = true; handle.current?.cancel() }, [])

  const samplesRef = useRef(samples)
  samplesRef.current = samples
  const update = (id: number, patch: Partial<Sample>) => setSamples(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const total = samples.reduce((n, s) => n + s.files.reduce((m, f) => m + f.size, 0), 0)
  const runnable = samples.filter(s => s.status === 'waiting')

  const run = async () => {
    setRunning(true)
    stop.current = false
    const store = useEditorStore.getState()
    const made: ReadSet[] = []
    /** The first file of each read set made, to find its place. */
    const placed = new Map<string, File>()
    let failed = 0
    const queue = samples.filter(s => s.status === 'waiting')
    for (const s of queue) {
      if (stop.current) break
      const id = store.newReadSetId()
      update(s.id, { status: 'running', progress: 0 })
      const h = startImport({ type: 'import', id, files: s.files, layout: s.layout, technology: s.technology },
        (done, all) => update(s.id, { progress: all ? done / all : 0 }))
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
        placed.set(record.id, s.files[0])
        update(s.id, { status: 'done', progress: 1 })
      } catch (err) {
        void deleteReadChunks([id])
        if (err instanceof CancelledError) { update(s.id, { status: 'waiting', progress: 0 }); break }
        failed++
        update(s.id, { status: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        handle.current = null
      }
    }
    made.forEach((r, k) => store.addReadSet(r, k === made.length - 1))
    for (const r of made) {
      const file = placed.get(r.id)
      const folder = file ? placeOf?.(file)?.() : null
      if (folder) useEditorStore.getState().moveItemToFolder(toUid('readset', r.id), folder)
    }
    setRunning(false)
    if (made.length) {
      const reads = made.reduce((n, r) => n + r.stats.reads, 0)
      notify.success(`Imported ${made.length} ${made.length === 1 ? 'read set' : 'read sets'} (${new Intl.NumberFormat('en-US').format(reads)} reads)`)
    }
    // Samples dropped in while this ran are still to do, so the dialog stays.
    const queued = new Set(queue.map(q => q.id))
    const added = samplesRef.current.some(x => x.status === 'waiting' && !queued.has(x.id))
    if (failed === 0 && !stop.current && !added) onClose()
  }

  const cancel = () => {
    if (running) { stop.current = true; handle.current?.cancel(); return }
    onClose()
  }

  /** Take a sample off the list; the dialog closes with the last one. */
  const remove = (id: number) => {
    const rest = samples.filter(s => s.id !== id)
    if (rest.length === 0) { onClose(); return }
    setSamples(rest)
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}
      // Escape stops an import that is running, and closes the dialog otherwise.
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }}
    >
      <div className="modal-dialog ngs-import" ref={ref} role="dialog" aria-modal="true" aria-labelledby="ngs-import-title">
        <div className="modal-header">
          <h3 className="modal-title" id="ngs-import-title">Import Sequencing Reads</h3>
          <button className="modal-close" onClick={cancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body ngs-import-body">
          <p className="aw-note">
            Each sample becomes a read set. Files whose names differ only in R1 and R2 (or _1 and _2) are taken as the two mates of a pair.
            The reads are stored compressed in this browser and are not part of session files.
          </p>
          <table className="rs-table ngs-import-table">
            <thead>
              <tr><th>Sample</th><th>Files</th><th>Layout</th><th>Technology</th><th className="ngs-status-col" /><th className="ngs-remove-col" /></tr>
            </thead>
            <tbody>
              {samples.map((s, i) => (
                <tr key={s.id} className="ngs-static">
                  <td>
                    <input className="aw-text ngs-name-input" value={s.name} disabled={running || s.status === 'done'}
                      onChange={e => update(s.id, { name: e.target.value })} aria-label={`Name of sample ${i + 1}`} />
                  </td>
                  <td className="ngs-files">
                    {s.files.map(f => <div key={f.name}>{f.name} <span className="aw-muted">{formatBytes(f.size)}</span></div>)}
                  </td>
                  <td>
                    <select className="select" value={s.layout} disabled={running || s.status === 'done'}
                      onChange={e => update(s.id, { layout: e.target.value as ReadLayout })} aria-label={`Layout of ${s.name}`}>
                      {(s.files.length === 2 ? ['pair'] as ReadLayout[] : ['single', 'interleaved'] as ReadLayout[])
                        .map(l => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select" value={s.technology} disabled={running || s.status === 'done'}
                      onChange={e => update(s.id, { technology: e.target.value as Technology, certain: true })} aria-label={`Technology of ${s.name}`}>
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
                  <td className="ngs-remove-col">
                    {!running && s.status !== 'done' && (
                      <button className="ngs-remove" onClick={() => remove(s.id)} aria-label={`Leave out ${s.name}`} title="Leave out">
                        <X size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer ngs-import-foot">
          <span className="aw-muted">
            {formatBytes(total)} of files{free !== null ? ` · ${formatBytes(free)} of storage free` : ''}
          </span>
          <button className="btn" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
          <button className="btn btn-primary" disabled={running || runnable.length === 0} onClick={() => void run()}>
            {running ? 'Importing…' : `Import ${runnable.length} ${runnable.length === 1 ? 'sample' : 'samples'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
