/**
 * Map a read set to one or more open sequences with minimap2. The result is
 * an assembly holding the mapping: its report now, its alignments stored for
 * the viewer. Several references (a chromosome and its plasmids) are mapped
 * together, so each read lands on whichever fits it best.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { PRESET_LABEL, presetFor, type MapPreset, type MappingReport } from '../../ngs/mapper'
import { NEEDS_WEB, openedAsFile, mappingStorageIds } from '../../ngs/jobs'
import { startMap, CancelledError, wasmBase, type JobHandle } from '../../workers/readset'
import { deleteReadChunks } from '../../storage/idb'

interface Props {
  readSet: ReadSet
  onClose: () => void
}

const nf = new Intl.NumberFormat()

export default function MapReadsDialog({ readSet: rs, onClose }: Props) {
  const tabs = useEditorStore(s => s.tabs).filter(t => t.doc.sequence.length >= 100)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(tabs[0] ? [tabs[0].id] : []))
  const [preset, setPreset] = useState<MapPreset>(presetFor(rs.technology))
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<JobHandle<MappingReport> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => handle.current?.cancel(), [])
  const blocked = openedAsFile()
  const running = progress !== null

  const run = () => {
    const store = useEditorStore.getState()
    const refs = tabs.filter(t => picked.has(t.id)).map(t => ({
      name: t.doc.name, tabId: t.id, bases: t.doc.sequence.bases, circular: t.doc.sequence.topology === 'circular',
    }))
    if (refs.length === 0) { notify.info('Choose a reference sequence, or open one first'); return }
    const id = store.newAssemblyId()
    setProgress(0)
    const h = startMap({
      type: 'map', storageId: id,
      readSet: { id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, maxLength: rs.stats.maxLength },
      refs, preset, wasmBase: wasmBase(),
    }, (d, t) => setProgress(t ? d / t : 0))
    handle.current = h
    h.promise.then(report => {
      const now = Date.now()
      store.addMapping({
        id, name: `${rs.name} vs ${refs.map(r => r.name).join(', ')}`, createdAt: now, modifiedAt: now,
        contigIds: [], method: 'reference', settings: null,
        inputs: { readIds: [], reference: { tabId: refs[0].tabId, name: refs[0].name } },
        unplaced: [],
        ngs: { readSetId: rs.id, readSetName: rs.name, storageId: id, report },
      })
      const pct = report.reads ? (report.mapped / report.reads) * 100 : 0
      notify.success(`Mapped ${pct.toFixed(1)}% of ${nf.format(report.reads)} reads`)
      onClose()
    }).catch(err => {
      const ids = mappingStorageIds(id)
      void deleteReadChunks([ids.alignments, ids.coverage])
      setProgress(null)
      if (err instanceof CancelledError) return
      notify.error('Mapping failed', { detail: err instanceof Error ? err.message : String(err) })
    }).finally(() => { handle.current = null })
  }

  const cancel = () => {
    if (handle.current) { handle.current.cancel(); return }
    onClose()
  }
  const toggle = (id: string) => setPicked(p => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-trim" ref={ref} role="dialog" aria-modal="true" aria-label="Map reads to a reference">
        <div className="aw-popover-head">
          <Layers size={14} /> <span>Map {rs.name} to a reference</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          <p className="aw-note">
            minimap2 places each read on the reference it fits best. Pick every replicon of a genome (a chromosome and its plasmids)
            so reads are not forced onto the wrong one. Circular sequences are mapped across their origin.
          </p>
          <div className="aw-field">
            <span>References</span>
            {tabs.length === 0 && <p className="aw-note">Open the reference sequence first (it needs at least 100 bp).</p>}
            <div className="ngs-ref-list">
              {tabs.map(t => (
                <label key={t.id} className="ngs-check">
                  <input type="checkbox" checked={picked.has(t.id)} disabled={running} onChange={() => toggle(t.id)} />
                  {t.doc.name} <span className="aw-muted">{nf.format(t.doc.sequence.length)} bp{t.doc.sequence.topology === 'circular' ? ', circular' : ''}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="aw-field">
            <span>Read type</span>
            <select className="select aw-select-full" value={preset} disabled={running} onChange={e => setPreset(e.target.value as MapPreset)}>
              {(Object.keys(PRESET_LABEL) as MapPreset[]).map(p => <option key={p} value={p}>{PRESET_LABEL[p]}</option>)}
            </select>
          </label>
          {blocked && <p className="aw-note ngs-warn-note">{NEEDS_WEB('minimap2')}</p>}
          {running && (
            <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
            <button className="btn btn-sm btn-primary" disabled={running || blocked || picked.size === 0} onClick={run}>
              {running ? 'Mapping…' : 'Map'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
