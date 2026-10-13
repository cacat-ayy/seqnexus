/**
 * Import a SAM or BAM file as a mapping.
 *
 * The file's header names its references; each is matched to an open
 * sequence (by name, then by length), which the user can change or leave
 * out. The alignments' bases are stored as differences from these
 * sequences, so the right ones matter: a reference of a different length is
 * flagged. Reading the file and storing it runs as a job, in a worker where
 * one can start. BAM and SAM are read in JavaScript, so this works from a
 * page opened from disk too.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '../../store'
import { toUid } from '../../explorer/types'
import type { Place } from '../../import/folders'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { readAlignmentHeader, type AlignmentFileHeader } from '../../ngs/alignmentImport'
import type { MappingReport } from '../../ngs/builder'
import { formatBytes } from '../../utils/format'
import { startImportAlignments, CancelledError, type JobHandle } from '../../workers/readset'
import { deleteMappingStorage } from '../../storage/idb'
import { tabReference } from '../../assembly/features'
import { samName } from '../../ngs/refNames'

interface Props {
  file: File
  /** Where the mapping goes: the folder of the directory the file came from, or the one it was dropped on. */
  place?: Place
  onClose: () => void
}

const nf = new Intl.NumberFormat()
/** A name as the BAM export writes it, so a file exported here finds the sequence it came from. */
const norm = (s: string) => samName(s).toLowerCase()

export default function ImportAlignmentsDialog({ file, place, onClose }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const [header, setHeader] = useState<AlignmentFileHeader | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Per header reference: the tab id chosen, or '' for none. */
  const [chosen, setChosen] = useState<string[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<JobHandle<MappingReport> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => handle.current?.cancel(), [])
  const running = progress !== null

  useEffect(() => {
    let live = true
    readAlignmentHeader(file).then(h => {
      if (!live) return
      setHeader(h)
      // Match by name first, then by a unique length.
      setChosen(h.refs.map(r => {
        const byName = tabs.find(t => norm(t.doc.name) === norm(r.name))
        if (byName) return byName.id
        const byLength = tabs.filter(t => t.doc.sequence.length === r.length)
        return byLength.length === 1 ? byLength[0].id : ''
      }))
    }).catch(err => { if (live) setError(err instanceof Error ? err.message : String(err)) })
    return () => { live = false }
    // The open tabs are matched once, when the file is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  const tabById = useMemo(() => new Map(tabs.map(t => [t.id, t])), [tabs])
  const given = chosen.filter(Boolean).length

  const run = () => {
    if (!header) return
    const store = useEditorStore.getState()
    const refs = header.refs.map((_, i) => {
      const t = tabById.get(chosen[i])
      return t ? tabReference(t) : null
    })
    const first = refs.find(r => r !== null)
    if (!first) { notify.info('Choose an open sequence for at least one reference'); return }
    const id = store.newAssemblyId()
    setProgress(0)
    const h = startImportAlignments({ type: 'import-alignments', file, storageId: id, refs }, (d, t) => setProgress(t ? d / t : 0))
    handle.current = h
    h.promise.then(report => {
      const now = Date.now()
      store.addMapping({
        id, name: file.name.replace(/\.(bam|sam)$/i, ''), createdAt: now, modifiedAt: now,
        contigIds: [], method: 'reference', settings: null,
        inputs: { readIds: [], reference: { tabId: first.tabId, name: first.name } },
        unplaced: [],
        samples: [{ readSetId: null, readSetName: file.name.replace(/\.(bam|sam)$/i, ''), storageId: id, report }],
      })
      const folder = place?.()
      if (folder) useEditorStore.getState().moveItemToFolder(toUid('assembly', id), folder)
      notify.success(`Imported ${nf.format(report.mapped + report.supplementary)} alignments from ${file.name}`)
      onClose()
    }).catch(err => {
      void deleteMappingStorage(id)
      setProgress(null)
      if (err instanceof CancelledError) return
      notify.error('Import failed', { detail: err instanceof Error ? err.message : String(err) })
    }).finally(() => { handle.current = null })
  }

  const cancel = () => {
    if (handle.current) { handle.current.cancel(); return }
    onClose()
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}
      // Escape stops an import that is running, and closes the dialog otherwise.
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }}
    >
      <div className="modal-dialog ngs-import ngs-import-narrow" ref={ref} role="dialog" aria-modal="true" aria-labelledby="ngs-aln-import-title">
        <div className="modal-header">
          <h3 className="modal-title" id="ngs-aln-import-title">Import Read Alignments</h3>
          <button className="modal-close" onClick={cancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body ngs-import-body">
          <p className="ngs-import-file">{file.name}</p>
          {error && <p className="aw-note ngs-warn-note">{error}</p>}
          {!header && !error && <p className="aw-note">Reading the header…</p>}
          {header && (
            <>
              <p className="aw-note">
                {header.format.toUpperCase()}, {formatBytes(file.size)}
                {header.program ? `, made by ${header.program.name}${header.program.version ? ` ${header.program.version}` : ''}` : ''}.
                The reads&apos; bases are kept as their differences from each reference, so choose the sequence each one was aligned to.
                Alignments on a reference left out are skipped.
              </p>
              <div className="aw-field">
                <span>References</span>
                <div className="ngs-ref-list">
                  {header.refs.map((r, i) => {
                    const t = tabById.get(chosen[i])
                    const off = t && t.doc.sequence.length !== r.length
                    return (
                      <label key={i} className="ngs-ref-row">
                        <span className="ngs-ref-name" title={r.name}>{r.name} <span className="aw-muted">{nf.format(r.length)} bp</span></span>
                        <select className="select" value={chosen[i] ?? ''} disabled={running}
                          onChange={e => setChosen(c => c.map((x, k) => (k === i ? e.target.value : x)))}>
                          <option value="">Leave out</option>
                          {tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.doc.name} ({nf.format(tab.doc.sequence.length)} bp)</option>)}
                        </select>
                        {off && <span className="ngs-warn-note ngs-ref-warn">The file says {nf.format(r.length)} bp; this sequence has {nf.format(t.doc.sequence.length)}.</span>}
                      </label>
                    )
                  })}
                </div>
                {tabs.length === 0 && <p className="aw-note">Open the reference sequences first.</p>}
              </div>
            </>
          )}
          {running && (
            <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
          <button className="btn btn-primary" disabled={running || !header || given === 0} onClick={run}>
            {running ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
