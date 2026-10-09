/**
 * Trim and filter a read set into a new one: fastp for short reads, a
 * length and read-quality filter for long reads (see ngs/trimmer.ts). The
 * original read set is kept.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useRef, useState } from 'react'
import { Scissors, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { DEFAULT_LONG_TRIM, DEFAULT_TRIM, isLongRead, type TrimSettings } from '../../ngs/types'
import { startTrim, CancelledError, wasmBase, type JobHandle } from '../../workers/readset'
import { FASTP_NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import type { TrimOutcome } from '../../ngs/jobs'
import { deleteReadChunks } from '../../storage/idb'

interface Props {
  readSet: ReadSet
  onClose: () => void
}

const nf = new Intl.NumberFormat()

export default function TrimReadsDialog({ readSet: rs, onClose }: Props) {
  const long = isLongRead(rs.technology)
  // fastp is fetched from wasm/, which a page opened from disk may not do.
  const blocked = !long && openedAsFile()
  const [s, setS] = useState<TrimSettings>(long ? DEFAULT_LONG_TRIM : DEFAULT_TRIM)
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<JobHandle<TrimOutcome> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => handle.current?.cancel(), [])

  const run = () => {
    const store = useEditorStore.getState()
    const toId = store.newReadSetId()
    setProgress(0)
    const h = startTrim({
      type: 'trim', fromId: rs.id, toId, chunks: rs.chunks, paired: rs.paired,
      technology: rs.technology, settings: s, wasmBase: wasmBase(),
    }, (d, t) => setProgress(t ? d / t : 0))
    handle.current = h
    h.promise.then(res => {
      const now = Date.now()
      const record: ReadSet = {
        id: toId,
        name: `${rs.name} ${long ? 'filtered' : 'trimmed'}`,
        createdAt: now, modifiedAt: now,
        technology: rs.technology, paired: rs.paired, files: [],
        stats: res.stats, qc: res.qc, chunks: res.chunks, storedBytes: res.storedBytes,
        origin: {
          fromId: rs.id, fromName: rs.name, method: long ? 'filter' : 'fastp', settings: s,
          readsBefore: res.readsBefore, readsAfter: res.stats.reads,
          basesBefore: res.basesBefore, basesAfter: res.stats.bases,
          ...(res.adapterTrimmedReads !== undefined ? { adapterTrimmedReads: res.adapterTrimmedReads } : {}),
        },
      }
      store.addReadSet(record)
      notify.success(`Kept ${nf.format(res.stats.reads)} of ${nf.format(res.readsBefore)} reads`, { detail: `New read set: ${record.name}` })
      onClose()
    }).catch(err => {
      void deleteReadChunks([toId])
      setProgress(null)
      if (err instanceof CancelledError) return
      notify.error(long ? 'Filtering failed' : 'Trimming failed', { detail: err instanceof Error ? err.message : String(err) })
    }).finally(() => { handle.current = null })
  }

  const cancel = () => {
    if (handle.current) { handle.current.cancel(); return }
    onClose()
  }
  const running = progress !== null
  const set = (patch: Partial<TrimSettings>) => setS(x => ({ ...x, ...patch }))

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-trim" ref={ref} role="dialog" aria-modal="true" aria-label={long ? 'Filter reads' : 'Trim and filter reads'}>
        <div className="aw-popover-head">
          <Scissors size={14} /> <span>{long ? 'Filter reads' : 'Trim and filter reads'}</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          {long ? (
            <p className="aw-note">Long reads are filtered, not trimmed: current basecallers already cut the sequencing adapters. A read's quality is its mean error probability, as a Phred score.</p>
          ) : (
            <p className="aw-note">
              fastp trims {rs.paired ? 'adapters where the two mates overlap and run past the insert' : 'adapters it detects in the reads'}, cuts
              low-quality ends, and drops reads that end up too short{rs.paired ? ', together with their mate' : ''}. It also drops
              reads with more than 40% of bases below Q15, and cuts poly-G tails on NovaSeq and NextSeq data.
            </p>
          )}
          {!long && (
            <label className="ngs-check">
              <input type="checkbox" checked={s.adapters} disabled={running} onChange={e => set({ adapters: e.target.checked })} />
              Trim adapters
            </label>
          )}
          {!long && (
            <label className="aw-field">
              <span>Trim ends below: {s.windowQuality > 0 ? `Q${s.windowQuality} (mean of a 4-base window)` : 'off'}</span>
              <input type="range" min={0} max={35} step={1} value={s.windowQuality} disabled={running}
                onChange={e => set({ windowQuality: Number(e.target.value) })} />
            </label>
          )}
          {long && (
            <label className="aw-field">
              <span>Lowest read quality: {s.minReadQuality > 0 ? `Q${s.minReadQuality}` : 'off'}</span>
              <input type="range" min={0} max={30} step={1} value={s.minReadQuality} disabled={running}
                onChange={e => set({ minReadQuality: Number(e.target.value) })} />
            </label>
          )}
          <label className="aw-field">
            <span>Shortest read kept: {nf.format(s.minLength)} bp</span>
            <input type="range" min={long ? 0 : 10} max={long ? 20000 : 150} step={long ? 100 : 5} value={s.minLength} disabled={running}
              onChange={e => set({ minLength: Number(e.target.value) })} />
          </label>
          <p className="aw-note">The result is a new read set; {rs.name} is kept.</p>
          {blocked && <p className="aw-note ngs-warn-note">{FASTP_NEEDS_WEB}</p>}
          {running && (
            <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
            <button className="btn btn-sm btn-primary" disabled={running || blocked} onClick={run}>
              {running ? (long ? 'Filtering…' : 'Trimming…') : (long ? 'Filter' : 'Trim')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
