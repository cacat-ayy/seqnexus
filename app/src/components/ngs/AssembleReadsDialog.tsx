/**
 * Assemble a read set de novo: contigs from the reads alone, then every read
 * mapped back to them. The result is an assembly like a mapping, with a
 * Contigs page on top (ngs/denovo/).
 *
 * Run again (`rerun`) assembles the same reads into the same assembly with
 * changed settings. The new contigs replace the old ones (and any samples
 * mapped to them), with an Undo.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { useEffect, useRef, useState } from 'react'
import { Shapes, X } from 'lucide-react'
import { useEditorStore, type Assembly, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { NEEDS_WEB, openedAsFile } from '../../ngs/jobs'
import { assembledMessage, defaultDeNovoSettings, denovoBlocked, denovoReadSet, type DeNovoResult } from '../../ngs/denovo/run'
import { DENOVO_METHOD_LABEL, type DeNovoMethod, type DeNovoSettings } from '../../ngs/denovo/types'
import { isLongRead } from '../../ngs/types'
import { K_CANDIDATES } from '../../ngs/denovo/short'
import { lineUpTargets, MAX_TARGET } from '../../ngs/denovo/lineup'
import { startAssemble, CancelledError, wasmBase, type JobHandle } from '../../workers/readset'
import { deleteMappingStorage } from '../../storage/idb'

interface Props {
  readSet: ReadSet
  /** Assemble the reads of this de novo assembly again, in place. */
  rerun?: Assembly
  onClose: () => void
}

const nf = new Intl.NumberFormat()

export default function AssembleReadsDialog({ readSet: rs, rerun, onClose }: Props) {
  const [settings, setSettings] = useState<DeNovoSettings>(rerun?.denovo?.settings ?? defaultDeNovoSettings(rs))
  const short = settings.method === 'short-dbg'
  const genome = settings.method === 'long-olc' || settings.method === 'long-auto'
  const [name, setName] = useState('')
  const tabs = useEditorStore(s => s.tabs)
  const readSets = useEditorStore(s => s.readSets)
  // Short read sets with their reads kept, to polish a long-read genome with.
  const shortSets = readSets.filter(r => r.id !== rs.id && !isLongRead(r.technology) && !r.discardedAt && r.stats.reads > 0 && r.stats.meanLength < 1000)
  const [genomeMb, setGenomeMb] = useState(() => (settings.genomeSize ? String(settings.genomeSize / 1e6) : ''))
  const offered = tabs.filter(t => t.doc.sequence.length >= 100 && t.doc.sequence.length <= MAX_TARGET)
  // Line the contigs up with the open sequences, unless none is open.
  const [lineUp, setLineUp] = useState<string>(() => (offered.length ? 'auto' : 'none'))
  const [progress, setProgress] = useState<number | null>(null)
  const handle = useRef<JobHandle<DeNovoResult> | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  useEffect(() => () => handle.current?.cancel(), [])
  const asFile = openedAsFile()
  const unfit = denovoBlocked(rs)
  const running = progress !== null
  const defaultName = `${rs.name} assembly`

  const run = () => {
    const store = useEditorStore.getState()
    const assemblyId = rerun?.id ?? store.newAssemblyId()
    // A run again is stored apart until it is done, so the old one stays whole if it fails.
    const storageId = rerun ? store.newAssemblyId() : assemblyId
    setProgress(0)
    const polishSet = genome && settings.polishWith ? shortSets.find(r => r.id === settings.polishWith!.id) : undefined
    const mb = Number(genomeMb)
    const used: DeNovoSettings = {
      ...settings,
      genomeSize: genome && genomeMb.trim() && Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1e6) : null,
      polishWith: polishSet ? { id: polishSet.id, name: polishSet.name } : null,
    }
    const h = startAssemble({
      type: 'assemble', storageId, settings: used, wasmBase: wasmBase(), lineUp: lineUpTargets(useEditorStore.getState().tabs, lineUp),
      readSet: denovoReadSet(rs),
      shortReads: polishSet ? { ...denovoReadSet(polishSet), name: polishSet.name } : undefined,
    }, (d, t) => setProgress(t ? d / t : 0))
    handle.current = h
    h.promise.then(res => {
      const sample = { readSetId: rs.id, readSetName: rs.name, storageId, report: res.mapping }
      if (rerun) {
        const undo = store.replaceDeNovo(rerun.id, sample, res.denovo)
        notify.success(assembledMessage(res), undo ? { action: { label: 'Undo', onClick: undo } } : undefined)
      } else {
        const now = Date.now()
        store.addMapping({
          id: assemblyId, name: name.trim() || defaultName, createdAt: now, modifiedAt: now,
          contigIds: [], method: 'de-novo', settings: null, inputs: { readIds: [], reference: null }, unplaced: [],
          samples: [sample], denovo: res.denovo,
        })
        notify.success(assembledMessage(res))
      }
      onClose()
    }).catch(err => {
      void deleteMappingStorage(storageId)
      setProgress(null)
      if (err instanceof CancelledError) return
      notify.error('Assembly failed', { detail: err instanceof Error ? err.message : String(err) })
    }).finally(() => { handle.current = null })
  }

  const cancel = () => {
    if (handle.current) { handle.current.cancel(); return }
    onClose()
  }
  const num = (key: 'minReads' | 'rounds' | 'minContig', lo: number, hi: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.round(Number(e.target.value))
    if (Number.isFinite(v)) setSettings(s => ({ ...s, [key]: Math.min(hi, Math.max(lo, v)) }))
  }

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !running) onClose() }}>
      <div className="aw-figure ngs-trim" ref={ref} role="dialog" aria-modal="true" aria-label="Assemble reads de novo"
        onKeyDown={e => { if (e.key === 'Escape') cancel() }}>
        <div className="aw-popover-head">
          <Shapes size={14} /> <span>{rerun ? `Assemble ${rs.name} again` : `Assemble ${rs.name} de novo`}</span>
          <button className="aw-icon-btn" onClick={cancel} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="ngs-trim-body aw-stack">
          <p className="aw-note">
            {short
              ? 'Contigs from the reads alone, with no reference. The reads\' k-mers make a de Bruijn graph, built at several k and cleaned of sequencing errors; the k giving the longest contigs is kept, and read pairs join contigs across short repeats. For plasmids, amplicons, phages and bacterial genomes.'
              : settings.method === 'long-seed'
                ? 'Contigs from the reads alone, with no reference. Each peak in the read lengths is taken as a product sequenced whole (a plasmid, an amplicon); one of its reads is the first draft, which all the reads then polish until it stops changing.'
                : settings.method === 'long-olc'
                  ? 'Contigs from the reads alone, with no reference. The longest reads (about 40x) are overlapped all against all, laid out in a string graph and polished by the reads; plasmids too small for the overlaps come from their length peaks.'
                  : 'Contigs from the reads alone, with no reference. When many reads are full-length copies of a product (peaks in the read lengths), each product is assembled whole from its peak; otherwise the reads are taken for a genome and assembled by their overlaps.'}
            {' '}Every read is then mapped back to the contigs, so the result opens like a mapping, with its variants.
          </p>
          <dl className="ngs-facts">
            {short && <><dt>Method</dt><dd>{DENOVO_METHOD_LABEL[settings.method]}</dd></>}
            <dt>Reads</dt><dd>{nf.format(rs.stats.reads)} reads, {nf.format(Math.round(rs.stats.meanLength))} bp on average</dd>
          </dl>
          {short ? (
            <>
            <div className="ngs-field-row">
              <label className="aw-field" title="Longer k spans longer repeats but needs more coverage. Automatic tries 21 up to what the reads allow and keeps the best.">
                <span>k</span>
                <select className="select aw-select-full" value={settings.k ?? ''} disabled={running}
                  onChange={e => setSettings(s => ({ ...s, k: e.target.value ? Number(e.target.value) : null }))}>
                  <option value="">Automatic (best of several)</option>
                  {K_CANDIDATES.filter(k => k <= rs.stats.meanLength * 0.8).map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
              <label className="aw-field" title="Shorter pieces of the graph are left out of the contigs">
                <span>Shortest contig, bp</span>
                <input className="aw-text" type="number" min={50} max={100000} value={settings.minContig ?? 200} disabled={running} onChange={num('minContig', 50, 100000)} />
              </label>
            </div>
            {rs.paired && (
              <label className="ngs-check" title="Pairs whose mates lie on two contigs join them through the graph, where a single path fits the insert size, so repeats shorter than the insert no longer break contigs">
                <input type="checkbox" checked={settings.pairs !== false} disabled={running} onChange={e => setSettings(s => ({ ...s, pairs: e.target.checked }))} />
                Join contigs across short repeats with the read pairs
              </label>
            )}
            </>
          ) : (
          <>
          <label className="aw-field">
            <span>What was sequenced</span>
            <select className="select aw-select-full" value={settings.method} disabled={running}
              onChange={e => setSettings(s => ({ ...s, method: e.target.value as DeNovoMethod }))}>
              <option value="long-auto">Decide from the read lengths (automatic)</option>
              <option value="long-seed">Whole plasmids or amplicons (seed and polish)</option>
              <option value="long-olc">A genome (overlaps, layout, consensus)</option>
            </select>
          </label>
          {genome && (
            <div className="ngs-field-row">
              <label className="aw-field" title="Used to take about 40x of the longest reads. Left empty, up to 200 Mb of the longest reads are used.">
                <span>Genome length, Mb (optional)</span>
                <input className="aw-text" type="number" min={0.01} max={50} step={0.1} value={genomeMb} placeholder="Unknown" disabled={running}
                  onChange={e => setGenomeMb(e.target.value)} />
              </label>
              <label className="aw-field" title="Illumina reads of the same sample correct the errors a long-read consensus keeps, mostly homopolymer lengths. A position changes where more than half of the short reads there disagree with it.">
                <span>Polish with short reads</span>
                <select className="select aw-select-full" value={shortSets.some(r => r.id === settings.polishWith?.id) ? settings.polishWith!.id : ''} disabled={running || shortSets.length === 0}
                  onChange={e => { const r = shortSets.find(x => x.id === e.target.value); setSettings(s => ({ ...s, polishWith: r ? { id: r.id, name: r.name } : null })) }}>
                  <option value="">{shortSets.length ? 'None' : 'None (no short read set is open)'}</option>
                  {shortSets.map(r => <option key={r.id} value={r.id}>{r.name} ({nf.format(r.stats.reads)} reads)</option>)}
                </select>
              </label>
            </div>
          )}
          <div className="ngs-field-row">
            <label className="aw-field" title={settings.method === 'long-olc' ? 'A contig needs this many reads behind it' : 'A length peak needs this many reads, and as many reads lined up with its contig end to end, to become a contig'}>
              <span>{settings.method === 'long-olc' ? 'Fewest reads per contig' : 'Fewest reads per product'}</span>
              <input className="aw-text" type="number" min={2} max={1000} value={settings.minReads} disabled={running} onChange={num('minReads', 2, 1000)} />
            </label>
            <label className="aw-field" title="Rounds of mapping the reads to the drafts and taking their consensus. They stop early once a round changes nothing.">
              <span>Polishing rounds at most</span>
              <input className="aw-text" type="number" min={1} max={10} value={settings.rounds} disabled={running} onChange={num('rounds', 1, 10)} />
            </label>
          </div>
          </>
          )}
          <label className="aw-field" title="Each contig that matches an open sequence is put on its strand and, if circular, started where it starts. One that is the same length with no insertion or deletion is linked to it, so its features show over the reads.">
            <span>Line the contigs up with</span>
            <select className="select aw-select-full" value={lineUp} disabled={running} onChange={e => setLineUp(e.target.value)}>
              <option value="auto">{offered.length ? 'The open sequence each matches (automatic)' : 'An open sequence it matches (none is open)'}</option>
              {offered.map(t => <option key={t.id} value={t.id}>{t.doc.name} ({t.doc.sequence.length.toLocaleString()} bp{t.doc.sequence.topology === 'circular' ? ', circular' : ''})</option>)}
              <option value="none">Nothing: leave them as assembled</option>
            </select>
          </label>
          {!rerun && (
            <label className="aw-field">
              <span>Name of the assembly</span>
              <input className="aw-text" value={name} placeholder={defaultName} disabled={running} onChange={e => setName(e.target.value)} />
            </label>
          )}
          {rerun && <p className="aw-note">The new contigs replace the old ones{(rerun.samples?.length ?? 0) > 1 ? ', and the other samples mapped to them are taken out' : ''}. Undo puts them back.</p>}
          {unfit && <p className="aw-note ngs-warn-note">{unfit}</p>}
          {!unfit && asFile && <p className="aw-note ngs-warn-note">{NEEDS_WEB('minimap2')}</p>}
          {running && (
            <div className="ngs-progress" role="progressbar" aria-valuenow={Math.round(progress! * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${Math.round(progress! * 100)}%` }} />
            </div>
          )}
          <div className="tw-trim-actions">
            <button className="btn btn-sm" onClick={cancel}>{running ? 'Stop' : 'Cancel'}</button>
            <button className="btn btn-sm btn-primary" disabled={running || asFile || !!unfit} onClick={run}>
              {running ? 'Assembling…' : rerun ? 'Assemble again' : 'Assemble'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
