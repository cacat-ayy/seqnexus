/**
 * Map a read set to one or more open sequences with minimap2. The result is
 * an assembly holding the mapping: its report, and its alignments stored for
 * the viewer and for export. Several references (a chromosome and its
 * plasmids) are mapped together, so each read lands on whichever fits it
 * best.
 *
 * Run again (`rerun`) maps the same reads into the same assembly, with the
 * references and preset of the last run chosen to start with. A reference
 * whose sequence is no longer open is offered from the copy the mapping
 * kept. The new mapping replaces the old one, with an Undo.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import { useEditorStore, type Assembly, type ReadSet } from '../../store'
import type { NgsMapping } from '../../assembly/container'
import PrimerClipField from './PrimerClipField'
import { usePrimerClip } from './usePrimerClip'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { PRESET_LABEL, presetFor, type MapPreset, type MappingReport, type MapReference } from '../../ngs/mapper'
import { NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import { readReferenceBases } from '../../ngs/sam'
import { startMap, CancelledError, wasmBase, type JobHandle } from '../../workers/readset'
import { deleteMappingStorage, getReadChunk } from '../../storage/idb'
import { tabReference } from '../../assembly/features'

interface Props {
  readSet: ReadSet
  /** Map this sample of a mapping again, in place. */
  rerun?: { assembly: Assembly; sample: NgsMapping }
  onClose: () => void
}

const nf = new Intl.NumberFormat()

/** A reference on offer: an open sequence, or the copy a mapping kept. */
interface Choice {
  key: string
  ref: MapReference
}

export default function MapReadsDialog({ readSet: rs, rerun, onClose }: Props) {
  const allTabs = useEditorStore(s => s.tabs)
  const tabs = allTabs.filter(t => t.doc.sequence.length >= 100)
  const last = rerun?.sample.report
  const [kept, setKept] = useState<Choice[]>([])
  const [picked, setPicked] = useState<Set<string>>(() => {
    if (last) return new Set(last.references.flatMap(r => (r.tabId && tabs.some(t => t.id === r.tabId) ? [r.tabId] : [])))
    return new Set(tabs[0] ? [tabs[0].id] : [])
  })
  const [preset, setPreset] = useState<MapPreset>(last?.preset ?? presetFor(rs.technology))
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<JobHandle<MappingReport> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => handle.current?.cancel(), [])
  const blocked = openedAsFile()
  // Samples of one mapping share its references.
  const locked = (rerun?.assembly.samples?.length ?? 0) > 1
  const running = progress !== null

  // References of the last run that are no longer open: offer the copies the mapping kept.
  useEffect(() => {
    const ngs = rerun?.sample
    if (!ngs || ngs.report.version !== 2) return
    const missing = ngs.report.references.flatMap((r, i) => (r.tabId && allTabs.some(t => t.id === r.tabId) ? [] : [{ r, i }]))
    if (missing.length === 0) return
    let live = true
    Promise.all(missing.map(async ({ r, i }) => ({
      key: `kept:${i}`,
      ref: { name: r.name, tabId: null, circular: r.circular, bases: await readReferenceBases({ get: getReadChunk }, ngs.storageId, i), features: r.features },
    }))).then(choices => {
      if (!live) return
      setKept(choices)
      setPicked(p => new Set([...p, ...choices.map(c => c.key)]))
    }).catch(() => {})
    return () => { live = false }
    // The open tabs are read once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerun])

  const choices: Choice[] = [
    ...tabs.map(t => ({
      key: t.id,
      ref: { name: t.doc.name, tabId: t.id, bases: t.doc.sequence.bases, circular: t.doc.sequence.topology === 'circular' },
    })),
    ...kept,
  ]
  const pickedKey = [...picked].sort().join('|') + '|' + kept.length
  // An open sequence's features are read only once it is picked.
  const refOf = (c: Choice): MapReference => {
    const t = tabs.find(x => x.id === c.key)
    return t ? tabReference(t) : c.ref
  }
  const pickedRefs = useMemo(() => choices.filter(c => picked.has(c.key)).map(refOf), [pickedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const clip = usePrimerClip(pickedRefs)

  const run = () => {
    const store = useEditorStore.getState()
    const refs = choices.filter(c => picked.has(c.key)).map(refOf)
    if (refs.length === 0) { notify.info('Choose a reference sequence, or open one first'); return }
    const assemblyId = rerun?.assembly.id ?? store.newAssemblyId()
    // A run again is stored apart until it is done, so the old mapping stays whole if it fails.
    const storageId = rerun ? store.newAssemblyId() : assemblyId
    setProgress(0)
    const h = startMap({
      type: 'map', storageId,
      readSet: { id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology, maxLength: rs.stats.maxLength, bases: rs.stats.bases },
      refs, preset, wasmBase: wasmBase(),
      ...(clip.on && clip.info ? { primerSites: clip.info.sites } : {}),
    }, (d, t) => setProgress(t ? d / t : 0))
    handle.current = h
    h.promise.then(report => {
      const now = Date.now()
      const ngs = { readSetId: rs.id, readSetName: rs.name, storageId, report }
      const inputs = { readIds: [], reference: { tabId: refs[0].tabId, name: refs[0].name } }
      const pct = report.reads ? (report.mapped / report.reads) * 100 : 0
      const msg = `Mapped ${pct.toFixed(1)}% of ${nf.format(report.reads)} reads`
      if (rerun) {
        // The first sample sets what the mapping says it was mapped to.
        const first = rerun.assembly.samples?.[0]?.storageId === rerun.sample.storageId
        const undo = store.replaceSample(rerun.assembly.id, rerun.sample.storageId, ngs, first ? inputs : undefined)
        notify.success(msg, undo ? { action: { label: 'Undo', onClick: undo } } : undefined)
      } else {
        store.addMapping({
          id: assemblyId, name: `${rs.name} vs ${refs.map(r => r.name).join(', ')}`, createdAt: now, modifiedAt: now,
          contigIds: [], method: 'reference', settings: null, inputs, unplaced: [], samples: [ngs],
        })
        notify.success(msg)
      }
      onClose()
    }).catch(err => {
      void deleteMappingStorage(storageId)
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
          <Layers size={14} /> <span>{rerun ? `Map ${rs.name} again` : `Map ${rs.name} to a reference`}</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          <p className="aw-note">
            minimap2 places each read on the reference it fits best. Pick every replicon of a genome (a chromosome and its plasmids)
            so reads are not forced onto the wrong one. Circular sequences are mapped across their origin.
          </p>
          <div className="aw-field">
            <span>References</span>
            {choices.length === 0 && <p className="aw-note">Open the reference sequence first (it needs at least 100 bp).</p>}
            <div className="ngs-ref-list">
              {choices.map(c => (
                <label key={c.key} className="ngs-check">
                  <input type="checkbox" checked={picked.has(c.key)} disabled={running || locked} onChange={() => toggle(c.key)} />
                  {c.ref.name}{' '}
                  <span className="aw-muted">
                    {nf.format(c.ref.bases.length)} bp{c.ref.circular ? ', circular' : ''}{c.ref.tabId ? '' : ', the copy kept with the mapping'}
                  </span>
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
          <PrimerClipField clip={clip} disabled={running} />
          {rerun && <p className="aw-note">{locked ? 'The references are shared by every sample of the mapping, so they stay as they are. ' : ''}The new mapping of {rs.name} replaces the old one. Undo puts it back.</p>}
          {blocked && <p className="aw-note ngs-warn-note">{NEEDS_WEB('minimap2')}</p>}
          {running && (
            <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
            <button className="btn btn-sm btn-primary" disabled={running || blocked || picked.size === 0} onClick={run}>
              {running ? 'Mapping…' : rerun ? 'Map again' : 'Map'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
