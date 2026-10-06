/**
 * An assembly's overview: what one run of the assembler made and left out.
 *
 * Lists the contigs with their figures, the reads that went in but are in no
 * contig (each with why), and how the run was made, with Run again to repeat
 * it with changed settings. An assembly with several contigs opens here; one
 * with a single contig opens on the contig and reaches this page from the
 * contig's header.
 *
 * An NGS mapping has three pages: the reads of one sample along a
 * reference, that sample's report, and its samples side by side (with the
 * samples x variants matrix). A mapping of one sample and one reference
 * opens on its reads; otherwise on its report, or its samples when it has
 * several.
 */

import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import './ContigWorkspace.css'
import { lazy, Suspense, useMemo, useState } from 'react'
import { ExternalLink, Layers, RotateCcw, SquareArrowOutUpRight, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { contigSummary } from '../../assembly/container'
import { computeConsensus, consensusSequence } from '../../assembly/consensus'
import MappingReport from '../ngs/MappingReport'
import { revealOnOpen } from '../ngs/reveal'

const AssembleDialog = lazy(() => import('./AssembleDialog'))
const MappingViewer = lazy(() => import('../ngs/MappingViewer'))
const SamplesPage = lazy(() => import('../ngs/SamplesPage'))
const AddSamplesDialog = lazy(() => import('../ngs/AddSamplesDialog'))
const MapReadsDialog = lazy(() => import('../ngs/MapReadsDialog'))

type MappingPageId = 'reads' | 'report' | 'samples'
/** Which page of each mapping was open, on which reference and sample, for coming back to it. */
const mappingPage = new Map<string, { page: MappingPageId; ref: number; sample: string | null }>()

interface Props {
  assembly: Assembly
  onClose: () => void
}

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${Math.round(x * 100)}%`

export default function AssemblyOverview({ assembly, onClose }: Props) {
  const allContigs = useEditorStore(s => s.contigs)
  const reads = useEditorStore(s => s.sequencingReads)
  const tabs = useEditorStore(s => s.tabs)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ readIds: string[]; rerun: boolean } | null>(null)
  const [remap, setRemap] = useState(false)
  const [adding, setAdding] = useState(false)
  const samples = assembly.samples ?? []
  const [mapping, setMapping] = useState<{ page: MappingPageId; ref: number; sample: string | null }>(() => mappingPage.get(assembly.id) ?? {
    page: samples.length > 1 ? 'samples' : samples[0]?.report.version === 2 && samples[0].report.references.length === 1 ? 'reads' : 'report',
    ref: 0,
    sample: null,
  })
  const showMapping = (next: Partial<typeof mapping>) => {
    const n = { ...mapping, ...next }
    mappingPage.set(assembly.id, n)
    setMapping(n)
  }
  // The sample shown on the reads and report pages.
  const ngs = samples.find(x => x.storageId === mapping.sample) ?? samples[0]
  const mappedSet = useEditorStore(st => (ngs?.readSetId ? st.readSets.find(r => r.id === ngs.readSetId) ?? null : null))
  const viewable = ngs?.report.version === 2
  const page: MappingPageId = !ngs ? 'report' : !viewable && mapping.page === 'reads' ? 'report' : mapping.page
  const openSample = (storageId: string, pg: 'reads' | 'report', refIndex?: number, pos?: number) => {
    if (pos !== undefined) revealOnOpen(storageId, refIndex ?? 0, pos)
    showMapping({ page: pg, sample: storageId, ...(refIndex !== undefined ? { ref: refIndex } : {}) })
  }

  const contigs = useMemo(() => {
    const byId = new Map(allContigs.map(c => [c.id, c]))
    return assembly.contigIds.map(id => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c)
  }, [allContigs, assembly.contigIds])
  const rows = useMemo(() => contigs.map(c => ({
    contig: c,
    summary: contigSummary(c.doc),
    consensus: consensusSequence(computeConsensus(c.doc, c.view.consensus)).length,
    edited: c.undoStack.length > 0 || c.doc.rows.some(r => r.seq !== r.orig),
  })), [contigs])

  const readById = useMemo(() => new Map(reads.map(r => [r.id, r])), [reads])
  const inputCount = assembly.inputs.readIds.length
  const present = assembly.inputs.readIds.filter(id => readById.has(id)).length
  const placed = rows.reduce((n, r) => n + r.summary.reads, 0)
  const left = assembly.unplaced
  const leftHere = left.flatMap(u => (u.readId && readById.has(u.readId) ? [u.readId] : []))
  const ref = assembly.inputs.reference
  const refTab = ref?.tabId ? tabs.find(t => t.id === ref.tabId) : undefined
  const s = assembly.settings

  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== assembly.name) useEditorStore.getState().renameAssembly(assembly.id, name)
    setNameDraft(null)
  }

  return (
    <div className="aw ao">
      <div className="aw-header">
        <Layers size={14} className="aw-header-icon" />
        <input
          className="aw-title-input"
          value={nameDraft ?? assembly.name}
          aria-label="Assembly name"
          title="Rename the assembly"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? assembly.name).length)}
        />
        <span className="aw-chip">{ngs && samples.length === 1 && ngs.report.importedFrom ? 'Imported' : assembly.method === 'reference' ? `Mapped to ${ref?.name ?? 'a reference'}` : 'De novo'}</span>
        <span className="aw-muted">
          {ngs
            ? samples.length > 1
              ? `${nf.format(samples.length)} samples`
              : `${nf.format(ngs.report.mapped)} of ${nf.format(ngs.report.reads)} reads mapped`
            : <>{nf.format(contigs.length)} {contigs.length === 1 ? 'contig' : 'contigs'} · {nf.format(placed)} of {nf.format(inputCount || placed)} reads placed</>}
        </span>
        {ngs && (
          <div className="aw-seg mv-switch" role="radiogroup" aria-label="Page">
            {(['reads', 'report', 'samples'] as const).map(pg => (
              <button key={pg} role="radio" aria-checked={page === pg} className={page === pg ? 'active' : ''} disabled={pg === 'reads' && !viewable}
                onClick={() => showMapping({ page: pg })}
                title={pg === 'reads' ? 'The reads along the reference' : pg === 'report' ? 'Figures, coverage charts, how it was made, and export' : 'Every sample side by side: figures, verification and variants'}>
                {pg === 'reads' ? 'Reads' : pg === 'report' ? 'Report' : `Samples${samples.length > 1 ? ` (${samples.length})` : ''}`}
              </button>
            ))}
          </div>
        )}
        {ngs && samples.length > 1 && page !== 'samples' && (
          <select className="select aw-select" value={ngs.storageId} aria-label="Sample" title="The sample shown"
            onChange={e => showMapping({ sample: e.target.value })}>
            {samples.map(x => <option key={x.storageId} value={x.storageId}>{x.readSetName}</option>)}
          </select>
        )}
        <span className="aw-spacer" />
        {!ngs && <button className="aw-btn" onClick={() => setDialog({ readIds: assembly.inputs.readIds, rerun: true })}
          disabled={present === 0}
          title={present === 0 ? 'None of the reads that went in are in the session any more' : 'Assemble the same reads again, with changed settings. The new contigs replace these.'}>
          <RotateCcw size={13} /> Run again…
        </button>}
        {ngs && !ngs.report.importedFrom && page !== 'samples' && (
          <button className="aw-btn" onClick={() => setRemap(true)} disabled={!mappedSet || !!mappedSet.discardedAt}
            title={!mappedSet ? 'The read set that was mapped has been deleted'
              : mappedSet.discardedAt ? 'The reads that were mapped have been discarded'
                : samples.length > 1 ? `Map ${ngs.readSetName} again, with a changed read type or primer clipping. The new mapping replaces this sample.`
                  : 'Map the same reads again, with changed references or read type. The new mapping replaces this one.'}>
            <RotateCcw size={13} /> Run again…
          </button>
        )}
        <button className="aw-icon-btn" onClick={onClose} title="Close the assembly" aria-label="Close the assembly"><X size={15} /></button>
      </div>

      {ngs && page === 'reads' ? (
        <div className="ao-body-flush">
          <Suspense fallback={null}>
            <MappingViewer key={ngs.storageId} ngs={ngs} assemblyId={assembly.id}
              name={samples.length > 1 ? `${assembly.name} ${ngs.readSetName}` : assembly.name}
              refIndex={mapping.ref} onRefIndex={i => showMapping({ ref: i })} />
          </Suspense>
        </div>
      ) : ngs && page === 'samples' ? (
        <Suspense fallback={null}>
          <SamplesPage assembly={assembly} onOpen={openSample} onAdd={() => setAdding(true)} />
        </Suspense>
      ) : ngs ? <div className="ao-body"><MappingReport key={ngs.storageId} ngs={ngs} onOpenReference={viewable ? i => showMapping({ page: 'reads', ref: i }) : undefined} /></div> : <div className="ao-body">
        <section className="ao-section">
          <h3 className="ao-title">Contigs</h3>
          <div className="ao-table-wrap">
            <table className="rs-table ao-table">
              <thead>
                <tr>
                  <th>Contig</th>
                  <th className="num">Reads</th>
                  <th className="num" title="Length of the consensus">Consensus</th>
                  <th className="num" title="Mean number of reads over the columns some read spans">Mean depth</th>
                  {assembly.method === 'reference' && <th className="num" title="Share of the reference's bases some read spans">Reference covered</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ contig, summary, consensus, edited }) => (
                  <tr key={contig.id} onClick={() => useEditorStore.getState().setActiveContig(contig.id)} title="Open the contig">
                    <td className="rs-name">
                      {contig.name}
                      {edited && <span className="ao-tag">edited</span>}
                    </td>
                    <td className="num">{nf.format(summary.reads)}</td>
                    <td className="num">{nf.format(consensus)} bp</td>
                    <td className="num">{summary.meanDepth.toFixed(1)}×</td>
                    {assembly.method === 'reference' && <td className="num">{summary.referenceCovered === null ? '-' : pct(summary.referenceCovered)}</td>}
                    <td className="ao-actions" onClick={e => e.stopPropagation()}>
                      {contigs.length > 1 && (
                        <button className="aw-icon-btn" onClick={() => useEditorStore.getState().extractContig(contig.id)}
                          title="Move to an assembly of its own" aria-label={`Move ${contig.name} to an assembly of its own`}>
                          <SquareArrowOutUpRight size={13} />
                        </button>
                      )}
                      <button className="aw-icon-btn" onClick={() => useEditorStore.getState().removeContig(contig.id)}
                        title={contigs.length > 1 ? 'Delete the contig' : 'Delete the contig, and with it the assembly'}
                        aria-label={`Delete ${contig.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ao-section">
          <h3 className="ao-title">
            {left.length > 0 && <TriangleAlert size={13} className="ao-warn-icon" />}
            Reads not placed{left.length > 0 ? ` (${nf.format(left.length)})` : ''}
          </h3>
          {left.length === 0 ? (
            <p className="aw-note">Every read that went in is in a contig.</p>
          ) : (
            <>
              <div className="ao-table-wrap">
                <table className="rs-table ao-table">
                  <thead><tr><th>Read</th><th>Why</th><th /></tr></thead>
                  <tbody>
                    {left.map((u, i) => {
                      const here = !!u.readId && readById.has(u.readId)
                      return (
                        <tr key={`${u.readId ?? u.name}:${i}`} className={here ? undefined : 'ao-static'}
                          onClick={here ? () => useEditorStore.getState().setActiveSequencingRead(u.readId) : undefined}
                          title={here ? 'Open the read' : 'This read is no longer in the session'}>
                          <td className="rs-name">{u.name}</td>
                          <td className="rs-issues ao-why">{u.reason}</td>
                          <td className="ao-actions">{here && <ExternalLink size={12} aria-hidden />}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {leftHere.length > 0 && (
                <div className="ao-row-actions">
                  <button className="aw-btn" onClick={() => setDialog({ readIds: leftHere, rerun: false })}
                    title="Map these reads elsewhere, or assemble them on their own, as a new assembly">
                    Assemble these reads…
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="ao-section">
          <h3 className="ao-title">How it was made</h3>
          <dl className="ao-facts">
            <dt>Method</dt>
            <dd>{assembly.method === 'reference' ? 'Mapped to a reference' : 'De novo, reads joined where they overlap'}</dd>
            {assembly.method === 'reference' && (
              <>
                <dt>Reference</dt>
                <dd>
                  {ref?.name ?? 'Unknown'}
                  {refTab
                    ? <button className="ao-link" onClick={() => useEditorStore.getState().setActiveTab(refTab.id)}>Open</button>
                    : <span className="aw-muted"> (not open; the contig keeps its own copy)</span>}
                </dd>
              </>
            )}
            <dt>Reads that went in</dt>
            <dd>
              {nf.format(inputCount)}
              {present < inputCount && <span className="aw-muted"> ({nf.format(inputCount - present)} no longer in the session)</span>}
            </dd>
            {s ? (
              <>
                <dt>Lowest identity</dt><dd>{pct(s.minIdentity)}</dd>
                {assembly.method === 'de-novo' && <><dt>Shortest overlap</dt><dd>{nf.format(s.minOverlap)} bases</dd></>}
                <dt>Seed length</dt><dd>{s.k} bases</dd>
              </>
            ) : (
              <>
                <dt>Settings</dt>
                <dd className="aw-muted">Not recorded: this assembly was made before settings were kept.</dd>
              </>
            )}
            <dt>Made</dt>
            <dd>{assembly.createdAt ? new Date(assembly.createdAt).toLocaleString() : 'Unknown'}</dd>
          </dl>
        </section>
      </div>}

      {remap && mappedSet && ngs && (
        <Suspense fallback={null}>
          <MapReadsDialog readSet={mappedSet} rerun={{ assembly, sample: ngs }} onClose={() => setRemap(false)} />
        </Suspense>
      )}
      {adding && samples.length > 0 && (
        <Suspense fallback={null}>
          <AddSamplesDialog assembly={assembly} onClose={() => setAdding(false)} />
        </Suspense>
      )}
      {dialog && (
        <Suspense fallback={null}>
          <AssembleDialog
            readIds={dialog.readIds}
            rerunId={dialog.rerun ? assembly.id : undefined}
            referenceTabId={!dialog.rerun ? refTab?.id : undefined}
            onClose={() => setDialog(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
