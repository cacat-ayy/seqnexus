/**
 * Assemble reads: map them to a reference, or join them to each other de
 * novo. Reads are listed with their QC (failed reads start unticked); the
 * assembly runs in a worker with progress and can be cancelled. The result
 * is one assembly holding its contigs, the settings used and the reads that
 * did not make it into a contig, each with why.
 *
 * A plate of clones is assembled in one go: reads are grouped into clones
 * by name (the grouping suggested from the names, shown as a Clone column
 * in the reads table), each clone becomes a contig of its own, and with
 * several references each clone goes to the one its reads match best.
 *
 * Given `rerunId`, the dialog runs an existing assembly again: it starts
 * from that assembly's reads, references, grouping and settings, and the
 * result replaces its contigs (with an Undo).
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
import { tabReference } from '../../assembly/features'
import { groupByName, groupKey, NAME_SEPARATORS, SEPARATOR_LABEL, suggestGrouping, type NameGrouping, type NameSeparator } from '../../assembly/groups'
import type { MapReference } from '../../assembly/map'
import { guessReferences } from '../../assembly/batch'
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
/** A reference kept in the assembly's own contigs, for when its sequence is no longer open: `stored:` and its name. */
const STORED = 'stored:'
/** Most parts offered to name a clone by. */
const MAX_PARTS = 6

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

  // Running again with a reference closed: map to the copy its contigs keep.
  const storedRefs = useMemo(() => {
    const out = new Map<string, MapReference>()
    if (!rerun || rerun.method !== 'reference') return out
    for (const c of own) {
      const r = c.doc.reference
      const bases = r ? referenceSource(c.doc) : null
      if (r && bases && !out.has(r.name)) out.set(r.name, { name: r.name, tabId: r.tabId, bases, circular: r.circular, features: r.features })
    }
    return out
  }, [rerun, own])
  const rerunRefs = rerun ? rerun.inputs.references ?? (rerun.inputs.reference ? [rerun.inputs.reference] : []) : []
  const refOptions = useMemo(() => [
    ...usableTabs.map(t => ({
      key: t.id, label: t.doc.name,
      detail: `${nf.format(t.doc.sequence.length)} bp${t.doc.sequence.topology === 'circular' ? ', circular' : ''}`,
    })),
    // Copies kept by the assembly whose sequence is not open (an open one is offered as itself).
    ...[...storedRefs.values()]
      .filter(r => !(r.tabId && usableTabs.some(t => t.id === r.tabId)))
      .map(r => ({ key: STORED + r.name, label: r.name, detail: `as kept in the assembly, ${nf.format(r.bases.length)} bp` })),
  ], [usableTabs, storedRefs])
  // The references ticked at first, and whether the reads were found to match one.
  const [initialRefs] = useState<{ keys: string[]; matched: boolean }>(() => {
    if (rerun) {
      return {
        keys: rerunRefs.flatMap(r => (r.tabId && usableTabs.some(t => t.id === r.tabId) ? [r.tabId]
          : storedRefs.has(r.name) ? [STORED + r.name] : [])),
        matched: false,
      }
    }
    if (referenceTabId) return { keys: [referenceTabId], matched: true }
    // The open sequences the reads match, or the first one when they match none.
    const sample = candidates.filter(r => readQc(r.data).verdict !== 'fail')
    const hits = guessReferences(sample.map(readInput), usableTabs.map(t => ({ bases: t.doc.sequence.bases, circular: t.doc.sequence.topology === 'circular' })))
    const matched = usableTabs.filter((_, i) => hits[i]).map(t => t.id)
    return { keys: matched.length ? matched : usableTabs[0] ? [usableTabs[0].id] : [], matched: matched.length > 0 }
  })
  const [refKeys, setRefKeys] = useState<string[]>(initialRefs.keys)

  // Grouping into clones: suggested from the names, or as the run being repeated had it.
  const suggested = useMemo(() => suggestGrouping(candidates.map(r => r.data.name)), [candidates])
  const [grouping, setGrouping] = useState<NameGrouping>(() => rerun?.grouping ?? suggested ?? { separator: '_', take: 'first', parts: 1 })
  const [grouped, setGrouped] = useState(() => {
    if (rerun) return !!rerun.grouping
    if (!suggested) return false
    // On when the names make two or more clones: a plate, not one clone's reads.
    return groupByName(candidates, r => r.data.name, suggested).filter(g => g.items.length >= 2).length >= 2
  })
  const pickedReads = useMemo(() => candidates.filter(r => picked.has(r.id)), [candidates, picked])
  const groups = useMemo(() => (grouped ? groupByName(pickedReads, r => r.data.name, grouping) : null), [grouped, pickedReads, grouping])
  const alone = groups ? groups.filter(g => g.items.length === 1).length : 0

  const [mode, setMode] = useState<'reference' | 'de-novo'>(
    // Mapping when the reads match an open sequence (or there is one read, or a plate to verify).
    rerun ? rerun.method : initialRefs.matched || (usableTabs.length > 0 && (candidates.length === 1 || grouped)) ? 'reference' : 'de-novo',
  )
  const [identity, setIdentity] = useState<number | null>(rerun?.settings?.minIdentity ?? null)
  const [overlap, setOverlap] = useState(rerun?.settings?.minOverlap ?? DEFAULT_ASSEMBLY.minOverlap)
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<AssemblyHandle | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const minIdentity = identity ?? (mode === 'reference' ? 0.8 : 0.9)
  const missing = rerun ? rerun.inputs.readIds.length - candidates.length : 0
  const edited = own.some(c => c.undoStack.length > 0 || c.doc.rows.some(r => r.seq !== r.orig))
  const lostRefs = rerun ? rerunRefs.filter(r => !(r.tabId && usableTabs.some(t => t.id === r.tabId)) && !storedRefs.has(r.name)) : []

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

  /** The chosen references with their bases and features, in the order offered. */
  const chosenReferences = (): MapReference[] => refOptions.flatMap(o => {
    if (!refKeys.includes(o.key)) return []
    if (o.key.startsWith(STORED)) {
      const r = storedRefs.get(o.key.slice(STORED.length))
      return r ? [r] : []
    }
    const t = tabs.find(x => x.id === o.key)
    return t ? [tabReference(t)] : []
  })

  const run = () => {
    const reads = pickedReads
    const references = mode === 'reference' ? chosenReferences() : []
    if (mode === 'reference' && references.length === 0) { notify.info('Choose a reference sequence, or open one first'); return }
    if (mode === 'de-novo' && reads.length < 2) { notify.info('De novo assembly needs at least two reads'); return }
    const settings = { ...DEFAULT_ASSEMBLY, minIdentity, minOverlap: overlap }
    setProgress(0)
    const h = startAssembly({
      mode, reference: references[0] ?? null, references, grouping: grouped ? grouping : null,
      inputs: reads.map(readInput), settings,
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
      const refNames = references.map(r => ({ tabId: r.tabId, name: r.name }))
      const runInfo: AssemblyRun = {
        method: mode,
        settings,
        inputs: { readIds: reads.map(r => r.id), reference: refNames[0] ?? null, ...(refNames.length > 1 ? { references: refNames } : {}) },
        unplaced,
        ...(grouped ? { grouping } : {}),
      }
      let undo: (() => void) | null = null
      const names = reads.map(r => r.data.name)
      if (rerun) undo = store.replaceAssemblyRun(rerun.id, runInfo, report.contigs)
      else store.addAssembly({ ...runInfo, name: assemblyName(names, grouped || references.length !== 1 ? null : references[0].name), contigs: report.contigs })
      const placed = reads.length - unplaced.length
      const what = grouped ? (report.contigs.length === 1 ? 'clone' : 'clones') : 'contigs'
      const msg = report.contigs.length === 1 && !grouped
        ? `Assembled ${placed} of ${reads.length} reads`
        : `Assembled ${placed} of ${reads.length} reads into ${report.contigs.length} ${what}`
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
  const toggleRef = (key: string) => setRefKeys(k => (k.includes(key) ? k.filter(x => x !== key) : [...k, key]))
  const running = progress !== null
  const title = rerun ? `Run ${rerun.name} again` : 'Assemble reads'
  const clones = groups?.length ?? 0
  const groupSize = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of groups ?? []) m.set(g.key, g.items.length)
    return m
  }, [groups])
  const action = `${rerun ? 'Run again with' : 'Assemble'} ${picked.size} ${picked.size === 1 ? 'read' : 'reads'}${grouped && clones > 0 ? ` as ${clones} ${clones === 1 ? 'clone' : 'clones'}` : ''}`

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
                  <th>Read</th>
                  {grouped && <th title="The clone the read's name puts it in">Clone</th>}
                  <th>QC</th><th className="num">Kept</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(r => {
                  const v = readQc(r.data).verdict
                  const key = grouped ? groupKey(r.data.name, grouping) : ''
                  const single = grouped && picked.has(r.id) && groupSize.get(key) === 1
                  return (
                    <tr key={r.id} onClick={() => toggle(r.id)}>
                      <td><input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} onClick={e => e.stopPropagation()} aria-label={`Include ${r.data.name}`} /></td>
                      <td className="rs-name">{r.reversed ? '◀ ' : ''}{r.data.name}</td>
                      {grouped && (
                        <td className={`rs-name${single ? ' cw-warn-note' : ''}`} title={single ? 'No other read has this clone name: it is assembled alone' : undefined}>{key}</td>
                      )}
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

            <label className="aw-check small" title="Reads whose names give the same clone are assembled together, each clone into a contig of its own">
              <input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)} />
              Group reads into clones by name
            </label>
            {grouped && (
              <>
                <div className="tw-trim-pair">
                  <label className="aw-field">
                    <span>Clone is</span>
                    <select className="select aw-select-full" value={`${grouping.take}:${grouping.parts}`} aria-label="Which parts of the name"
                      onChange={e => { const [take, parts] = e.target.value.split(':'); setGrouping(g => ({ ...g, take: take as NameGrouping['take'], parts: Number(parts) })) }}>
                      {Array.from({ length: MAX_PARTS }, (_, i) => i + 1).map(n => (
                        <option key={`f${n}`} value={`first:${n}`}>{n === 1 ? 'the first part' : `the first ${n} parts`}</option>
                      ))}
                      {Array.from({ length: 3 }, (_, i) => i + 1).map(n => (
                        <option key={`a${n}`} value={`all-but-last:${n}`}>{n === 1 ? 'all but the last part' : `all but the last ${n} parts`}</option>
                      ))}
                    </select>
                  </label>
                  <label className="aw-field">
                    <span>split at</span>
                    <select className="select aw-select-full" value={grouping.separator} aria-label="Separator"
                      onChange={e => setGrouping(g => ({ ...g, separator: e.target.value as NameSeparator }))}>
                      {NAME_SEPARATORS.map(s => <option key={s} value={s}>{SEPARATOR_LABEL[s]}</option>)}
                    </select>
                  </label>
                </div>
                <p className="aw-note">
                  {nf.format(picked.size)} {picked.size === 1 ? 'read' : 'reads'} in {nf.format(clones)} {clones === 1 ? 'clone' : 'clones'}, each assembled on its own (see the Clone column).
                  {alone > 0 && <span className="cw-warn-note"> {nf.format(alone)} {alone === 1 ? 'clone has' : 'clones have'} only one read.</span>}
                </p>
              </>
            )}

            {mode === 'reference' ? (
              <>
                <div className="aw-section-label">{refKeys.length > 1 ? `References (${refKeys.length})` : 'Reference'}</div>
                {refOptions.length === 0
                  ? <p className="aw-note">Open a sequence to map to.</p>
                  : (
                    <div className="cw-feature-list" role="group" aria-label="References">
                      {refOptions.map(o => (
                        <label key={o.key} className="aw-check small" title={o.detail}>
                          <input type="checkbox" checked={refKeys.includes(o.key)} onChange={() => toggleRef(o.key)} />
                          {o.label} <span className="aw-muted">({o.detail})</span>
                        </label>
                      ))}
                    </div>
                  )}
                <p className="aw-note">
                  {refKeys.length > 1
                    ? grouped
                      ? 'Each clone goes to the reference its reads match best; designs that differ in a base or two are told apart by aligning to each.'
                      : 'Each read goes to the reference it matches best, making one contig per reference.'
                    : 'Each read is placed on the reference, on whichever strand it matches. Bases the reads have that the reference lacks get columns of their own.'}
                </p>
              </>
            ) : (
              <>
                <p className="aw-note">
                  Reads that overlap are joined into contigs and turned to a common strand, keeping as many as possible the way you show them.
                  {grouped ? ' Reads of different clones are never joined.' : ' Reads that overlap nothing are listed afterwards.'}
                </p>
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
            {lostRefs.length > 0 && (
              <p className="aw-note cw-warn-note">
                {lostRefs.map(r => r.name).join(', ')} {lostRefs.length === 1 ? 'is' : 'are'} not open and no contig keeps a copy: open {lostRefs.length === 1 ? 'it' : 'them'} to map to {lostRefs.length === 1 ? 'it' : 'them'} again.
              </p>
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
              <button className="btn btn-sm btn-primary" disabled={running || picked.size === 0 || (mode === 'reference' && refKeys.length === 0)} onClick={run}>
                {running ? 'Assembling…' : action}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
