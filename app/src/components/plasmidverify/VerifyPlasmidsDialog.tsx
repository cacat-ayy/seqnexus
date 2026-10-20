/**
 * Verifying the samples of a whole-plasmid sequencing result, offered when
 * one is dropped (plasmidverify/detect.ts).
 *
 * The dialog lists the samples with the files found for each and the open
 * sequence each consensus matches best (plasmidverify/compare.ts,
 * chooseConstruct), saying so when another came close; any open sequence
 * can be chosen instead, and a construct file opened from here joins the
 * choices. Declining imports the files as any drop would. Files of the drop
 * that belong to no sample (a construct dropped with the results) are
 * imported straight away, so they can be chosen.
 *
 * Verifying runs per sample: the consensus tier (always), then, with reads
 * and SeqNexus served from a web address, the read tier: the reads are
 * imported as a read set, mapped to the construct with minimap2 (map-ont)
 * and their variants called, the same jobs as the guided NGS pipeline. The
 * result is kept as an assembly with a contig per sample, which opens on
 * its verdicts, and each construct is marked with its latest verdict.
 */

import './PlasmidVerify.css'
import '../ngs/ReadSetWorkspace.css'
import '../sanger/ReadWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, CircleX, FolderOpen, Loader2, ShieldCheck, X } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { useEscapeClose } from '../../hooks/useEscapeClose'
import { readFasta } from '../../io/fasta'
import { parseGenBankMulti } from '../../io/genbank'
import { parseTraceFile } from '../../sanger/import'
import type { TraceData } from '../../io/trace'
import { tabReference } from '../../assembly/features'
import { toUid } from '../../explorer/types'
import { NEEDS_WEB, openedAsFile } from '../../utils/opened-as-file'
import { startCallVariants, startImport, startMap, wasmBase, CancelledError, type JobHandle } from '../../workers/readset'
import { MappingSource } from '../../ngs/view'
import { siteVariants } from '../../ngs/calls'
import { getReadChunk, deleteMappingStorage, deleteReadChunks } from '../../storage/idb'
import { sampleFiles, type ResultSample } from '../../plasmidverify/detect'
import { chooseConstruct, CONSTRUCT_MAX_LENGTH } from '../../plasmidverify/compare'
import { consensusEvidence, sampleRecord, type Construct, type ReadEvidence } from '../../plasmidverify/sample'
import { constructStatus, type PlasmidSample, type PlasmidUnmatched } from '../../plasmidverify/result'
import { STATUS_LABEL } from '../../assembly/verify'
import type { ContigDoc } from '../../assembly/types'

const nf = new Intl.NumberFormat('en-US')

interface Props {
  samples: ResultSample[]
  /** Import files the ordinary way. */
  importFiles: (files: File[]) => void
  onClose: () => void
}

interface Row {
  sample: ResultSample
  /** The consensus bases, once read; null while reading, '' when it could not be read. */
  consensus: string | null
  error?: string
  /** The open sequence chosen, or null for none. */
  tabId: string | null
  /** Chosen by hand: a new guess does not replace it. */
  picked: boolean
  /** Other open sequences it matched almost as well. */
  close: string[]
  status: 'idle' | 'run' | 'done' | 'fail' | 'skip'
  step?: string
  frac?: number
  message?: string
}

function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error ?? new Error('The file could not be read'))
    r.readAsText(file)
  })
}

/** The consensus of a sample: its FASTA's first record, or its GenBank's bases. Never the GenBank's features. */
async function readConsensus(s: ResultSample): Promise<string> {
  if (s.consensus) {
    const read = readFasta(await readText(s.consensus), s.name)
    const rec = read.records[0]
    if (!rec) throw new Error(`No sequence in ${s.consensus.name}`)
    return rec.bases
  }
  if (s.genbank) {
    const doc = parseGenBankMulti(await readText(s.genbank))[0]
    if (!doc) throw new Error(`No sequence in ${s.genbank.name}`)
    return doc.sequence.bases
  }
  throw new Error('No consensus')
}

/** A name for the verification: what the samples' names begin with ("JPY6QT verification"). */
function verificationName(samples: readonly ResultSample[], today = new Date()): string {
  if (samples.length === 1) return `${samples[0].name} verification`
  let prefix = samples[0]?.name ?? ''
  for (const s of samples) {
    let i = 0
    while (i < prefix.length && i < s.name.length && prefix[i] === s.name[i]) i++
    prefix = prefix.slice(0, i)
  }
  prefix = prefix.replace(/[\s_.-]+$/, '')
  return prefix.length >= 3 ? `${prefix} verification` : `Plasmid verification ${today.toISOString().slice(0, 10)}`
}

const ROLE_LABEL: { key: 'consensus' | 'genbank' | 'reads' | 'trace'; label: string }[] = [
  { key: 'consensus', label: 'FASTA' }, { key: 'genbank', label: 'GenBank' }, { key: 'reads', label: 'reads' }, { key: 'trace', label: 'ab1' },
]

export default function VerifyPlasmidsDialog({ samples, importFiles, onClose }: Props) {
  const allTabs = useEditorStore(s => s.tabs)
  const candidates = useMemo(() => allTabs.filter(t => t.doc.sequence.alphabet !== 'protein'
    && t.doc.sequence.length >= 100 && t.doc.sequence.length <= CONSTRUCT_MAX_LENGTH), [allTabs])
  const [rows, setRows] = useState<Row[]>(() => samples.map(sample => ({ sample, consensus: null, tabId: null, picked: false, close: [], status: 'idle' })))
  const [running, setRunning] = useState(false)
  const handle = useRef<JobHandle<unknown> | null>(null)
  const stop = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  // Escape closes the offer; while it runs, Stop is the way out.
  useEscapeClose(!running, onClose)
  useEffect(() => () => { stop.current = true; handle.current?.cancel() }, [])

  // Read every consensus once.
  useEffect(() => {
    let live = true
    samples.forEach((s, i) => {
      readConsensus(s).then(
        bases => { if (live) setRows(rs => rs.map((r, k) => (k === i ? { ...r, consensus: bases } : r))) },
        err => { if (live) setRows(rs => rs.map((r, k) => (k === i ? { ...r, consensus: '', error: err instanceof Error ? err.message : String(err), status: 'skip' } : r))) },
      )
    })
    return () => { live = false }
  }, [samples])

  // Guess each sample's construct, again whenever the open sequences change.
  const tabKey = candidates.map(t => `${t.id}:${t.doc.sequence.length}`).join(',')
  const consensusKey = rows.map(r => (r.consensus === null ? 'n' : r.consensus.length)).join(',')
  useEffect(() => {
    setRows(rs => rs.map(r => {
      if (!r.consensus || r.picked || r.status !== 'idle') return r
      const choice = chooseConstruct(r.consensus, candidates.map(t => t.doc.sequence.bases))
      return {
        ...r,
        tabId: choice.index === null ? null : candidates[choice.index].id,
        close: choice.close.map(i => candidates[i].doc.name),
      }
    }))
    // Keyed on what the guess depends on, not on the arrays' identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, consensusKey])

  const asFile = openedAsFile()
  const withReads = rows.filter(r => r.sample.reads).length
  const ready = rows.filter(r => r.consensus && r.tabId && r.status === 'idle')
  const finished = rows.length > 0 && rows.every(r => r.status !== 'idle' && r.status !== 'run')

  const update = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))

  const decline = () => {
    importFiles(samples.flatMap(s => [...sampleFiles(s), ...s.extras]))
    onClose()
  }

  const job = async <T,>(h: JobHandle<T>): Promise<T> => {
    handle.current = h as JobHandle<unknown>
    try { return await h.promise } finally { handle.current = null }
  }

  /** The read tier for one sample; throws to fall back on the consensus. */
  const readTier = async (i: number, row: Row, construct: Construct, made: { readSets: string[]; mappings: string[] }): Promise<ReadEvidence> => {
    const store = useEditorStore.getState()
    const file = row.sample.reads!
    const progress = (d: number, t: number) => update(i, { frac: t ? d / t : 0 })
    update(i, { step: 'Importing the reads', frac: 0 })
    const id = store.newReadSetId()
    let rs: ReadSet
    try {
      const res = await job(startImport({ type: 'import', id, files: [file], layout: 'single', technology: 'nanopore' }, progress))
      if (res.stats.reads === 0) throw new Error(`No reads in ${file.name}`)
      const now = Date.now()
      rs = {
        id, name: row.sample.name, createdAt: now, modifiedAt: now, technology: 'nanopore', paired: false,
        files: [{ name: file.name, bytes: file.size }], stats: res.stats, qc: res.qc, chunks: res.chunks, storedBytes: res.storedBytes,
      }
    } catch (err) {
      void deleteReadChunks([id])
      throw err
    }
    useEditorStore.getState().addReadSet(rs, false)
    made.readSets.push(rs.id)

    update(i, { step: 'Mapping the reads', frac: 0 })
    const storageId = store.newAssemblyId()
    const refs = [{ name: construct.name, tabId: construct.tabId, bases: construct.bases, circular: true, features: construct.features }]
    let report
    try {
      report = await job(startMap({
        type: 'map', storageId,
        readSet: { id: rs.id, chunks: rs.chunks, paired: false, technology: 'nanopore', maxLength: rs.stats.maxLength, bases: rs.stats.bases },
        refs, preset: 'map-ont', wasmBase: wasmBase(),
      }, progress))
    } catch (err) {
      void deleteMappingStorage(storageId)
      throw err
    }
    const now = Date.now()
    useEditorStore.getState().addMapping({
      id: storageId, name: `${row.sample.name} reads vs ${construct.name}`, createdAt: now, modifiedAt: now, contigIds: [],
      method: 'reference', settings: null, inputs: { readIds: [], reference: { tabId: construct.tabId, name: construct.name } },
      unplaced: [], samples: [{ readSetId: rs.id, readSetName: rs.name, storageId, report }],
    }, false)
    made.mappings.push(storageId)

    update(i, { step: 'Calling variants', frac: 0 })
    const references = [{ name: construct.name, length: construct.bases.length, circular: true }]
    await job(startCallVariants({ type: 'call-variants', storageId, references }, progress))
    const src = new MappingSource({ get: getReadChunk }, storageId, report.references)
    const [calls, coverage, levels, bases] = await Promise.all([src.calls(0), src.coverage(0), src.summaries(0), src.reference(0)])
    return {
      readSetId: rs.id, mappingId: storageId, mapped: report.mapped, coverage, levels,
      candidates: siteVariants(calls ?? [], bases, construct.features, 'nanopore', true),
    }
  }

  const run = async () => {
    setRunning(true)
    stop.current = false
    const docs: { name: string; doc: ContigDoc }[] = []
    const records: PlasmidSample[] = []
    const unmatched: PlasmidUnmatched[] = []
    const made = { readSets: [] as string[], mappings: [] as string[] }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const files = sampleFiles(row.sample).map(f => f.name)
      if (stop.current) break
      if (!row.consensus) {
        if (row.error) unmatched.push({ name: row.sample.name, files, reason: row.error })
        continue
      }
      const tab = row.tabId ? useEditorStore.getState().tabs.find(t => t.id === row.tabId) : undefined
      if (!tab) {
        update(i, { status: 'skip', message: 'No construct chosen' })
        unmatched.push({ name: row.sample.name, files, reason: 'No open sequence matches its consensus' })
        continue
      }
      const ref = tabReference(tab)
      const construct: Construct = { tabId: ref.tabId, name: ref.name, bases: ref.bases, features: ref.features }
      update(i, { status: 'run', step: 'Aligning the consensus', frac: 0 })
      // Let the row's status paint before the alignment takes the thread.
      await new Promise(r => setTimeout(r, 0))
      let trace: TraceData | null = null
      let traceNote = ''
      if (row.sample.trace) {
        try { trace = await parseTraceFile(row.sample.trace) } catch (err) { traceNote = ` The chromatogram could not be read (${err instanceof Error ? err.message : String(err)}).` }
      }
      const ev = consensusEvidence(row.sample.name, row.consensus, construct, trace)
      if (!ev) {
        update(i, { status: 'fail', message: `The consensus does not line up with ${construct.name}` })
        unmatched.push({ name: row.sample.name, files, reason: `The consensus does not line up with ${construct.name}` })
        continue
      }
      let reads: ReadEvidence | null = null
      let readsNote: string | null = null
      if (row.sample.reads) {
        if (asFile) readsNote = `${NEEDS_WEB('minimap2')} Without the reads, the verdict comes from the consensus alone.`
        else {
          try {
            reads = await readTier(i, row, construct, made)
          } catch (err) {
            if (err instanceof CancelledError) { stop.current = true; readsNote = 'Mapping the reads was stopped; the verdict comes from the consensus.' }
            else readsNote = `The reads could not be used (${err instanceof Error ? err.message : String(err)}); the verdict comes from the consensus.`
          }
        }
      }
      if (traceNote) readsNote = `${readsNote ?? ''}${traceNote}`.trim()
      const rec = sampleRecord({
        contigId: '', name: row.sample.name, files, construct, closeTo: row.close.filter(n => n !== construct.name),
        consensus: ev, consensusLength: row.consensus.length, reads, readsNote,
      })
      docs.push({ name: row.sample.name, doc: ev.doc })
      records.push(rec)
      update(i, { status: 'done', step: undefined, message: `${rec.report.verdict === 'verified' ? 'Verified' : rec.report.verdict === 'differences' ? `${rec.report.differences.length} ${rec.report.differences.length === 1 ? 'difference' : 'differences'}` : 'Not fully covered'}${rec.mixed.flagged ? ', mixed' : ''}` })
    }

    setRunning(false)
    if (records.length === 0) {
      notify.warning('No sample could be verified', { detail: unmatched.map(u => `${u.name}: ${u.reason}`).join('\n') || undefined })
      return
    }
    const store = useEditorStore.getState()
    const name = verificationName(samples)
    const checkedAt = Date.now()
    const id = store.addPlasmidVerification(name, docs, { checkedAt, samples: records, unmatched })
    if (!id) return
    // Each construct carries its latest verdict.
    const byTab = new Map<string, PlasmidSample[]>()
    for (const r of records) if (r.construct.tabId) byTab.set(r.construct.tabId, [...(byTab.get(r.construct.tabId) ?? []), r])
    for (const [tabId, list] of byTab) store.setVerifiedBy(tabId, { itemId: id, date: checkedAt, status: constructStatus(list) })
    // The read sets and mappings made go into one folder with the verification.
    if (made.readSets.length) {
      const folder = store.createFolder(name)
      for (const uid of [toUid('assembly', id), ...made.readSets.map(x => toUid('readset', x)), ...made.mappings.map(x => toUid('assembly', x))]) store.moveItemToFolder(uid, folder)
    }
    const tally = (k: PlasmidSample['report']['verdict']) => records.filter(r => r.report.verdict === k).length
    const said = records.length === 1
      ? `${records[0].name}: ${STATUS_LABEL[records[0].report.verdict].toLowerCase()}`
      : `Checked ${records.length} plasmids: ${[
        `${tally('verified')} verified`,
        ...(tally('differences') ? [`${tally('differences')} with differences`] : []),
        ...(tally('incomplete') ? [`${tally('incomplete')} not fully covered`] : []),
      ].join(', ')}`
    notify[tally('verified') === records.length && !unmatched.length ? 'success' : 'info'](said, {
      ...(unmatched.length ? { detail: `${unmatched.length} not verified: ${unmatched.map(u => u.name).join(', ')}` } : {}),
    })
    onClose()
  }

  const cancel = () => {
    if (running) { stop.current = true; handle.current?.cancel(); return }
    onClose()
  }

  const openConstruct = (files: FileList | null) => {
    if (!files?.length) return
    importFiles(Array.from(files))
  }

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure pv-dialog" ref={ref} role="dialog" aria-modal="true" aria-label="Verify plasmids">
        <div className="aw-popover-head">
          <ShieldCheck size={14} /> <span>Whole-plasmid sequencing results</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="pv-dialog-body">
          <p className="aw-note">
            {rows.length === 1 ? 'This looks like the result of whole-plasmid sequencing.' : `These look like the results of whole-plasmid sequencing: ${rows.length} samples.`}{' '}
            Each consensus is turned to its construct's origin and compared base by base{withReads ? ', and the reads, where there are any, are mapped to it' : ''}.
            The construct is the open sequence it matches best.
          </p>
          <div className="ao-table-wrap">
            <table className="rs-table pv-samples">
              <thead>
                <tr><th>Sample</th><th>Files</th><th>Construct</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.sample.name} className="ao-static">
                    <td className="rs-name">{r.sample.name}</td>
                    <td>
                      <span className="pv-roles">
                        {ROLE_LABEL.filter(x => r.sample[x.key]).map(x => <span key={x.key} className="pv-role">{x.label}</span>)}
                      </span>
                    </td>
                    <td>
                      <select className="select aw-select-sm" value={r.tabId ?? ''} disabled={running || r.status !== 'idle' || !r.consensus}
                        aria-label={`Construct for ${r.sample.name}`}
                        onChange={e => update(i, { tabId: e.target.value || null, picked: true, close: [] })}>
                        <option value="">{candidates.length ? 'None' : 'No open sequence'}</option>
                        {candidates.map(t => <option key={t.id} value={t.id}>{t.doc.name} ({nf.format(t.doc.sequence.length)} bp)</option>)}
                      </select>
                      {r.consensus === null && <span className="pv-hint">Reading the consensus…</span>}
                      {r.error && <span className="pv-hint warn">{r.error}</span>}
                      {r.consensus && !r.tabId && !r.picked && <span className="pv-hint warn">No open sequence matches its consensus</span>}
                      {r.close.length > 0 && !r.picked && <span className="pv-hint warn">Close call: {r.close.join(', ')} matched almost as well; chosen by aligning to each</span>}
                      {r.tabId && candidates.find(t => t.id === r.tabId)?.doc.sequence.topology === 'linear' && <span className="pv-hint">Linear in SeqNexus; compared as a circle</span>}
                    </td>
                    <td>
                      <span className={`pv-status${r.status === 'fail' ? ' fail' : ''}`}>
                        {r.status === 'run' && <><Loader2 size={12} className="spinner" aria-label="running" /> {r.step}</>}
                        {r.status === 'done' && <><CircleCheck size={12} /> {r.message}</>}
                        {(r.status === 'fail' || r.status === 'skip') && r.message && <><CircleX size={12} /> {r.message}</>}
                        {r.status === 'run' && r.frac !== undefined && r.frac > 0 && (
                          <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(r.frac * 100)} aria-valuemin={0} aria-valuemax={100}>
                            <div style={{ width: `${Math.round(r.frac * 100)}%` }} />
                          </div>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {withReads > 0 && asFile && (
            <p className="aw-note ngs-warn-note">
              {NEEDS_WEB('minimap2')} The reads will not be mapped: each verdict comes from the consensus, and the chromatogram, where there is one, shows mixed positions.
            </p>
          )}
          {rows.some(r => r.consensus && !r.tabId) && (
            <p className="aw-note">
              Open the construct a sample was meant to be and it is matched again. With no construct, import the files instead and
              assemble the reads de novo (Assemble NGS Reads de novo) to see what the tube holds.
            </p>
          )}
          <div className="pv-dialog-actions">
            <input ref={fileInput} type="file" hidden multiple accept=".gb,.gbk,.genbank,.dna,.fasta,.fa,.embl,.ape" onChange={e => { openConstruct(e.target.files); e.target.value = '' }} />
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={running} title="Open the designed construct from a file; it joins the choices">
              <FolderOpen size={13} /> Open a construct…
            </button>
            <span className="aw-spacer" />
            {!finished && <button className="btn btn-sm" onClick={running ? cancel : decline}>{running ? 'Stop' : 'Import the files instead'}</button>}
            {finished
              ? <button className="btn btn-sm btn-primary" onClick={onClose}>Close</button>
              : (
                <button className="btn btn-sm btn-primary" disabled={running || ready.length === 0} onClick={() => { void run() }}>
                  {running ? 'Verifying…' : `Verify ${ready.length || rows.length} ${(ready.length || rows.length) === 1 ? 'plasmid' : 'plasmids'} against a construct`}
                </button>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}
