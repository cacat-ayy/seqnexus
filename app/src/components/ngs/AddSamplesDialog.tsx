/**
 * More samples for an NGS mapping: other read sets mapped to the same
 * references, one after another, each added as a sample when it is done.
 * The references are the copies the mapping keeps, so every sample is
 * mapped to exactly the same bases whatever has happened to the open
 * sequences since.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Users, X } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { presetFor, PRESET_LABEL, type MapReference } from '../../ngs/mapper'
import { NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import { readReferenceBases } from '../../ngs/sam'
import { TECHNOLOGY_LABEL } from '../../ngs/types'
import { startMap, CancelledError, wasmBase, type JobHandle } from '../../workers/readset'
import { deleteMappingStorage, getReadChunk } from '../../storage/idb'
import type { MappingReport } from '../../ngs/builder'
import PrimerClipField from './PrimerClipField'
import { usePrimerClip } from './usePrimerClip'

const nf = new Intl.NumberFormat()

export default function AddSamplesDialog({ assembly, onClose }: { assembly: Assembly; onClose: () => void }) {
  const first = assembly.samples![0]
  const used = new Set((assembly.samples ?? []).flatMap(s => (s.readSetId ? [s.readSetId] : [])))
  const readSets = useEditorStore(s => s.readSets).filter(r => !r.discardedAt && !used.has(r.id))
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [refs, setRefs] = useState<MapReference[] | null>(null)
  const [progress, setProgress] = useState<{ at: number; of: number; name: string; frac: number } | null>(null)
  const handle = useRef<JobHandle<MappingReport> | null>(null)
  const stop = useRef(false)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => { stop.current = true; handle.current?.cancel() }, [])
  const blocked = openedAsFile()

  // The references, from the copies the mapping keeps.
  useEffect(() => {
    let live = true
    Promise.all(first.report.references.map(async (r, i) => ({
      name: r.name, tabId: r.tabId, circular: r.circular,
      bases: await readReferenceBases({ get: getReadChunk }, first.storageId, i),
    }))).then(x => { if (live) setRefs(x) }).catch(err => notify.error('The mapping\'s references could not be read', { detail: String(err) }))
    return () => { live = false }
  }, [first])
  const refList = useMemo(() => refs ?? [], [refs])
  const clip = usePrimerClip(refList)

  const run = async () => {
    if (!refs) return
    const store = useEditorStore.getState()
    const list = readSets.filter(r => picked.has(r.id))
    let added = 0
    stop.current = false
    for (let k = 0; k < list.length && !stop.current; k++) {
      const rs = list[k]
      const storageId = store.newAssemblyId()
      const preset = presetFor(rs.technology)
      setProgress({ at: k + 1, of: list.length, name: rs.name, frac: 0 })
      const h = startMap({
        type: 'map', storageId,
        readSet: { id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, maxLength: rs.stats.maxLength, bases: rs.stats.bases },
        refs, preset, wasmBase: wasmBase(),
        ...(clip.on && clip.info ? { primerSites: clip.info.sites } : {}),
      }, (d, t) => setProgress(p => (p ? { ...p, frac: t ? d / t : 0 } : p)))
      handle.current = h
      try {
        const report = await h.promise
        useEditorStore.getState().addSamples(assembly.id, [{ readSetId: rs.id, readSetName: rs.name, storageId, report }])
        added++
      } catch (err) {
        void deleteMappingStorage(storageId)
        if (err instanceof CancelledError) break
        notify.error(`Mapping ${rs.name} failed`, { detail: err instanceof Error ? err.message : String(err) })
      } finally { handle.current = null }
    }
    setProgress(null)
    if (added) notify.success(added === 1 ? 'Added a sample' : `Added ${added} samples`)
    onClose()
  }

  const cancel = () => {
    if (handle.current) { stop.current = true; handle.current.cancel(); return }
    onClose()
  }
  const running = progress !== null

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-trim" ref={ref} role="dialog" aria-modal="true" aria-label="Add samples"
        onKeyDown={e => { if (e.key === 'Escape') cancel() }}>
        <div className="aw-popover-head">
          <Users size={14} /> <span>Add samples to {assembly.name}</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          <p className="aw-note">
            Each read set is mapped to {first.report.references.map(r => r.name).join(', ')}, the copies the mapping keeps, with minimap2
            set for its kind of reads, and becomes a sample of the mapping.
          </p>
          <div className="aw-field">
            <span>Read sets</span>
            {readSets.length === 0 && <p className="aw-note">Every read set in the session is a sample here already, or has had its reads discarded. Import more reads first.</p>}
            <div className="ngs-ref-list">
              {readSets.map(r => (
                <label key={r.id} className="ngs-check">
                  <input type="checkbox" checked={picked.has(r.id)} disabled={running}
                    onChange={() => setPicked(p => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} />
                  {r.name}{' '}
                  <span className="aw-muted">{TECHNOLOGY_LABEL[r.technology]}, {nf.format(r.stats.reads)} reads, {PRESET_LABEL[presetFor(r.technology)]}</span>
                </label>
              ))}
            </div>
          </div>
          <PrimerClipField clip={clip} disabled={running} />
          {blocked && <p className="aw-note ngs-warn-note">{NEEDS_WEB('minimap2')}</p>}
          {progress && (
            <>
              <p className="aw-note">Mapping {progress.at} of {progress.of}: {progress.name}</p>
              <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress.frac * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${Math.round(progress.frac * 100)}%` }} />
              </div>
            </>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
            <button className="btn btn-sm btn-primary" disabled={running || blocked || picked.size === 0 || !refs} onClick={run}>
              {running ? 'Mapping…' : picked.size > 1 ? `Map ${picked.size} read sets` : 'Map'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
