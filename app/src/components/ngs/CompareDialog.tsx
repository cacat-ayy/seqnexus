/**
 * A de novo contig against the expected sequence (the designed plasmid, the
 * reference amplicon), as a clone verification report: the strand it is on
 * and where its start lies, every difference with what it does to a
 * protein, and for each feature whether the contig has it whole, covered by
 * enough reads, and unchanged (ngs/denovo/compare.ts, verifyContig.ts).
 *
 * From here the contig can be opened as a sequence lined up with the
 * expected one (same strand, same start) with the expected features carried
 * over, or turned in place: the reads are mapped to the turned contig,
 * which is linked to that new sequence, so the Reads page shows its
 * features and translation over the reads.
 */

import '../contig/ContigWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import './ReadSetWorkspace.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { inflateSync } from 'fflate'
import { ClipboardCopy, Download, FilePlus2, FileText, GitCompareArrows, RotateCw, X } from 'lucide-react'
import { useEditorStore, type Assembly } from '../../store'
import { notify } from '../../toast'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { copyText } from '../../utils/clipboard'
import { downloadBlob, saveText } from '../../utils/download'
import { verifyReportPdf } from '../contig/verifyReport'
import { getReadChunk } from '../../storage/idb'
import { mappingStorageIds } from '../../ngs/builder'
import { readReferenceBases } from '../../ngs/sam'
import { openedAsFile } from '../../ngs/jobs'
import { refFeatures, variantAnnotations } from '../../assembly/features'
import { DEFAULT_VERIFY, describeChange, describeDifference, STATUS_LABEL, verifyCsv, type VerifySettings } from '../../assembly/verify'
import { codingLabel } from '../../assembly/effects'
import { compareToExpected, liftFeatures, type Comparison } from '../../ngs/denovo/compare'
import { verifyContig } from '../../ngs/denovo/verifyContig'
import type { DeNovoReport } from '../../ngs/denovo/types'
import { remapContigs } from './remapContigs'
import { notifyFigureSaved } from '../../utils/cite-notice'

interface Props {
  assembly: Assembly
  contig: number
  onClose: () => void
}

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`
const DEPTHS = [1, 3, 5, 10, 20, 30]

/** Runs of bases longer than a dozen (a large deletion or insertion) as their length. */
const shorten = (s: string) => s.replace(/[ACGTN]{13,}/gi, m => `${nf.format(m.length)} bp`)

export default function CompareDialog({ assembly, contig: initial, onClose }: Props) {
  const d = assembly.denovo!
  const sample = assembly.samples![0]
  const tabs = useEditorStore(s => s.tabs).filter(t => t.doc.sequence.length >= 50)
  const readSet = useEditorStore(s => (sample.readSetId ? s.readSets.find(r => r.id === sample.readSetId) ?? null : null))
  const [ci, setCi] = useState(initial)
  // The expected sequence: one already linked to this contig, else one of about its length, else the first.
  const [tabId, setTabId] = useState<string | null>(() => {
    const linked = sample.report.references[initial]?.tabId
    if (linked && tabs.some(t => t.id === linked)) return linked
    const len = d.contigs[initial]?.length ?? 0
    const near = [...tabs].sort((a, b) => Math.abs(a.doc.sequence.length - len) - Math.abs(b.doc.sequence.length - len))[0]
    return near?.id ?? null
  })
  const [minDepth, setMinDepth] = useState(10)
  const [featureIds, setFeatureIds] = useState<string[] | null>(null)
  const [loaded, setLoaded] = useState<{ ci: number; bases: string; depth: Uint32Array | null } | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [markDiffs, setMarkDiffs] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)

  useEffect(() => {
    let live = true
    setLoaded(null)
    Promise.all([
      readReferenceBases({ get: getReadChunk }, sample.storageId, ci),
      getReadChunk(mappingStorageIds(sample.storageId).coverage, ci).then(data => {
        if (!data) return null
        const raw = inflateSync(data)
        return new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
      }),
    ]).then(([bases, depth]) => { if (live) setLoaded({ ci, bases, depth }) })
      .catch(err => notify.error('Could not read the contig', { detail: err instanceof Error ? err.message : String(err) }))
    return () => { live = false }
  }, [sample.storageId, ci])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && busy === null) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const tab = tabs.find(t => t.id === tabId) ?? null
  const annotations = useMemo(() => (tab ? tab.doc.annotations.map(a => a.toData()) : []), [tab])
  const features = useMemo(() => refFeatures(annotations), [annotations])
  const checkable = useMemo(() => features.filter(f => f.type !== 'source'), [features])
  const c = d.contigs[ci]

  const result = useMemo((): { cmp: Comparison; depth: Uint32Array | null } | { error: string } | null => {
    if (!tab || !loaded || loaded.ci !== ci) return null
    try {
      const cmp = compareToExpected({
        contig: loaded.bases, contigCircular: c.circular,
        expected: tab.doc.sequence.bases, expectedCircular: tab.doc.sequence.topology === 'circular',
      })
      // Depth along the turned contig: back through the turn and the strand to the stored contig.
      let depth: Uint32Array | null = null
      if (loaded.depth) {
        const C = loaded.bases.length
        depth = new Uint32Array(C)
        for (let t = 0; t < C; t++) {
          const oriented = (t + cmp.shift) % C
          depth[t] = loaded.depth[cmp.reversed ? C - 1 - oriented : oriented] ?? 0
        }
      }
      return { cmp, depth }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }, [tab, loaded, ci, c.circular])

  const settings: VerifySettings = useMemo(() => ({
    ...DEFAULT_VERIFY, minDepth,
    featureIds: featureIds ?? checkable.filter(f => f.type !== 'primer_bind' && f.type !== 'misc_feature').map(f => f.id),
  }), [minDepth, featureIds, checkable])

  const report = useMemo(() => {
    if (!result || 'error' in result || !tab) return null
    return verifyContig({
      cmp: result.cmp,
      expected: { name: tab.doc.name, bases: tab.doc.sequence.bases, circular: tab.doc.sequence.topology === 'circular' },
      features, depth: result.depth, reads: sample.report.mapped, settings,
    })
  }, [result, tab, features, sample.report.mapped, settings])

  const cmp = result && !('error' in result) ? result.cmp : null
  const title = `${assembly.name} ${c.name}`
  const base = title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')

  /** Open the turned contig as a sequence with the expected features (and the differences) on it; returns its tab. */
  const openMatching = (): string | null => {
    if (!cmp || !tab || !report) return null
    const store = useEditorStore.getState()
    const lifted = liftFeatures(annotations.filter(a => a.type !== 'source'), cmp, c.circular)
    const id = store.openDocument(`${title} (as ${tab.doc.name})`, cmp.bases, c.circular ? 'circular' : 'linear',
      `${c.name} of ${assembly.name}, on the strand of ${tab.doc.name} and starting where it starts; features carried over from it`, 'consensus')
    // Differences are in expected coordinates; each is marked where it sits on the contig: a
    // substitution on its base, an insertion over the inserted bases, a deletion across the join it leaves.
    const C = cmp.bases.length
    const L = cmp.toContig.length
    const marks = !markDiffs ? [] : report.differences.flatMap(v => {
      const ann = variantAnnotations([v], L)[0]
      if (!ann) return []
      const p = v.position - 1
      let start: number
      let end: number
      if (v.type === 'SNP') { start = cmp.toContig[p]; end = start + 1 }
      else if (v.type === 'Insertion') { start = p >= 0 ? cmp.toContig[p] + 1 : 0; end = start + v.alt.length }
      else { start = cmp.toContig[(p + L - 1) % L]; end = start + 2 }
      if (start < 0) return []
      return [{ ...ann, start, end: Math.min(C, end) }]
    })
    store.addAnnotations([...lifted.features, ...marks])
    const extra = [
      lifted.dropped.length ? `left out (not in the contig): ${lifted.dropped.join(', ')}` : '',
      lifted.changed.length ? `length changed: ${lifted.changed.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    notify.success(`Opened ${title} lined up with ${tab.doc.name}, with ${lifted.features.length} features`, extra ? { detail: extra } : undefined)
    return id
  }

  const turnInPlace = async () => {
    if (!cmp || !tab || !readSet) return
    const tabOpened = openMatching()
    if (!tabOpened) return
    useEditorStore.getState().setActiveAssembly(assembly.id)
    setBusy(0)
    try {
      const old = await Promise.all(d.contigs.map((_, i) => (i === ci ? Promise.resolve(cmp.bases) : readReferenceBases({ get: getReadChunk }, sample.storageId, i))))
      const denovo: DeNovoReport = {
        ...d,
        contigs: d.contigs.map((x, i) => (i === ci ? { ...x, length: cmp.bases.length } : x)),
        matched: [...(d.matched ?? []).filter(m => m.contig !== ci), { contig: ci, expected: tab.doc.name, reversed: cmp.reversed, shift: cmp.shift, at: Date.now() }],
      }
      const opened = useEditorStore.getState().tabs.find(t => t.id === tabOpened)
      const undo = await remapContigs({
        assembly, readSet, denovo, onProgress: setBusy,
        contigs: d.contigs.map((x, i) => (i === ci
          ? { name: x.name, bases: old[i], circular: x.circular, tabId: tabOpened, features: opened ? refFeatures(opened.doc.annotations.map(a => a.toData())) : undefined }
          : { name: x.name, bases: old[i], circular: x.circular, tabId: sample.report.references[i]?.tabId ?? null, features: sample.report.references[i]?.features })),
      })
      notify.success(`Turned ${c.name} to match ${tab.doc.name}; its reads now show its features`, undo ? { action: { label: 'Undo', onClick: undo } } : undefined)
      onClose()
    } catch (err) {
      notify.error('Could not turn the contig', { detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const savePdf = () => {
    if (!report) return
    try {
      downloadBlob(new Blob([verifyReportPdf(report, title) as BlobPart], { type: 'application/pdf' }), `${base}_verification.pdf`)
      notifyFigureSaved(`${base}_verification.pdf`)
    } catch (err) {
      notify.error('Could not make the PDF', { detail: err instanceof Error ? err.message : String(err) })
    }
  }
  const summary = () => report ? [
    `${title} against ${report.reference.name}: ${STATUS_LABEL[report.verdict]}`,
    ...report.features.map(f => `${f.feature.name}: ${STATUS_LABEL[f.status]}${f.differences.length ? ` (${f.differences.map(d => describeDifference(d, f.feature)).join('; ')})` : ''}`),
  ].join('\n') : ''
  const chosen = new Set(settings.featureIds ?? [])
  const toggle = (id: string) => setFeatureIds(() => {
    const ids = new Set(chosen)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return [...ids]
  })
  // Differences in none of the features checked: they do not count toward the verdict.
  const outside = report && report.features.length ? report.differences.filter(v => !report.features.some(f => f.differences.includes(v))).length : 0
  const gaps = report ? report.uncovered.map(g => (g.from === g.to ? nf.format(g.from) : `${nf.format(g.from)} to ${nf.format(g.to)}`)) : []
  const canTurn = !!cmp && !!readSet && !readSet.discardedAt && !openedAsFile() && (cmp.reversed || cmp.shift !== 0 || sample.report.references[ci]?.tabId !== tabId)

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && busy === null) onClose() }}>
      <div className="aw-figure cw-verify-dialog" ref={ref} role="dialog" aria-modal="true" aria-label="Compare to the expected sequence">
        <div className="aw-popover-head">
          <GitCompareArrows size={14} /> <span>Compare {c.name} to the expected sequence</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close" disabled={busy !== null}><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="cw-verify-report">
            {!tab ? (
              <p className="aw-note">Open the expected sequence first (the designed plasmid, or the reference the amplicon comes from), then pick it on the right.</p>
            ) : !result ? (
              <p className="aw-note">Comparing…</p>
            ) : 'error' in result ? (
              <p className="aw-note ngs-warn-note">{result.error}</p>
            ) : report && cmp && (
              <>
                <span className={`cw-verdict ${report.verdict}`}>{STATUS_LABEL[report.verdict]}</span>
                <p>
                  {c.name} ({nf.format(c.length)} bp{c.circular ? ', circular' : ''}) lies on {cmp.reversed ? 'the other strand of' : 'the same strand as'} {tab.doc.name}
                  {c.circular ? (cmp.shift ? `, with its start ${nf.format(cmp.shift)} bases from where ${tab.doc.name} starts` : ', starting where it starts') : `, over ${nf.format(cmp.from + 1)} to ${nf.format(cmp.to)}`}.
                  {' '}{pct(cmp.matches / Math.max(1, cmp.matches + cmp.mismatches))} of the aligned bases are identical; {report.differences.length ? `${report.differences.length} ${report.differences.length === 1 ? 'difference' : 'differences'}` : 'no differences'}
                  {outside > 0 ? ` (${outside} outside the features checked, so not in the verdict)` : ''}.
                  {' '}{pct(report.covered)} of {tab.doc.name} is in the contig with at least {minDepth} {minDepth === 1 ? 'read' : 'reads'} over it.
                </p>
                {gaps.length > 0 && <p className="aw-muted">Not covered: {gaps.slice(0, 12).join(', ')}{gaps.length > 12 ? `, and ${gaps.length - 12} more` : ''}</p>}

                {report.features.length > 0 && (
                  <>
                    <h3>Features</h3>
                    <table className="rs-table">
                      <thead><tr><th>Feature</th><th>Status</th><th className="num">Length</th><th className="num">Covered</th><th className="num">Lowest depth</th><th>Differences</th></tr></thead>
                      <tbody>
                        {report.features.map(f => (
                          <tr key={f.feature.id} className="ngs-static">
                            <td className="rs-name" title={f.feature.type}>{f.feature.name}</td>
                            <td><span className={`cw-status ${f.status}`}>{STATUS_LABEL[f.status]}</span></td>
                            <td className="num">{nf.format(f.length)}</td>
                            <td className="num">{pct(f.covered)}</td>
                            <td className="num">{nf.format(f.minDepth)}</td>
                            <td className="rs-issues" title={f.differences.map(d => describeDifference(d, f.feature)).join('\n')}>{shorten(f.differences.map(d => describeDifference(d, f.feature)).join('; '))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {report.differences.length > 0 && (
                  <>
                    <h3>Differences from {tab.doc.name}</h3>
                    <table className="rs-table">
                      <thead><tr><th className="num">Position</th><th>Change</th><th className="num">Reads over it</th><th>Feature</th><th>Protein</th></tr></thead>
                      <tbody>
                        {report.differences.map((v, i) => (
                          <tr key={i} className="ngs-static">
                            <td className="num">{nf.format(v.position)}</td>
                            <td className="cw-base" title={describeChange(v).length > 60 ? describeChange(v) : undefined}>{shorten(describeChange(v))}</td>
                            <td className="num">{nf.format(v.coverage)}</td>
                            <td>{v.features.join(', ')}</td>
                            <td>{v.coding ? codingLabel(v.coding) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="aw-note">
                      The contig is what most reads say, so these are differences in the clone. To see whether a part of the reads
                      disagrees (a mixed clone), look at the contig&apos;s variants on the Reads page.
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          <div className="aw-figure-options aw-stack">
            <label className="aw-field">
              <span>Contig</span>
              <select className="select aw-select-full" value={ci} onChange={e => setCi(Number(e.target.value))} disabled={busy !== null}>
                {d.contigs.map((x, i) => <option key={x.name} value={i}>{x.name} ({nf.format(x.length)} bp{x.circular ? ', circular' : ''})</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Expected sequence</span>
              <select className="select aw-select-full" value={tabId ?? ''} onChange={e => { setTabId(e.target.value || null); setFeatureIds(null) }} disabled={busy !== null}>
                {tabs.length === 0 && <option value="">No sequence is open</option>}
                {tabs.map(t => <option key={t.id} value={t.id}>{t.doc.name} ({nf.format(t.doc.sequence.length)} bp{t.doc.sequence.topology === 'circular' ? ', circular' : ''})</option>)}
              </select>
            </label>
            <label className="aw-field">
              <span>Covered means at least</span>
              <select className="select aw-select-full" value={minDepth} onChange={e => setMinDepth(Number(e.target.value))}>
                {DEPTHS.map(n => <option key={n} value={n}>{n} {n === 1 ? 'read' : 'reads'}</option>)}
              </select>
            </label>
            <div className="aw-section-label">Features to check</div>
            {checkable.length === 0
              ? <p className="aw-note">{tab ? 'The expected sequence has no features, so the whole of it is checked.' : ''}</p>
              : (
                <div className="cw-feature-list">
                  {checkable.map(f => (
                    <label key={f.id} className="aw-check small" title={`${f.type} · ${nf.format(f.start + 1)} to ${nf.format(f.end)}`}>
                      <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} />
                      {f.name} <span className="aw-muted">({f.type})</span>
                    </label>
                  ))}
                </div>
              )}
            <div className="aw-section-label">Line it up</div>
            <label className="aw-check small">
              <input type="checkbox" checked={markDiffs} onChange={e => setMarkDiffs(e.target.checked)} />
              Mark the differences as features
            </label>
            <div className="aw-actions">
              <button className="aw-action" disabled={!cmp || busy !== null} onClick={() => { openMatching() }}
                title="A new sequence: the contig on the expected sequence's strand and from its start, with its features carried over">
                <FilePlus2 size={13} /> Open lined up, with its features
              </button>
              <button className="aw-action" disabled={!canTurn || busy !== null} onClick={() => void turnInPlace()}
                title={openedAsFile() ? 'Needs SeqNexus opened from a web address (minimap2)' : 'Also turn the contig in this assembly and map its reads again, so the Reads page shows the features and translation over them. Undo puts it back.'}>
                <RotateCw size={13} /> {busy !== null ? `Mapping ${Math.round(busy * 100)}%` : 'Turn the contig to match, and map again'}
              </button>
            </div>
            <div className="aw-section-label">Save</div>
            <div className="aw-actions">
              <button className="aw-action" disabled={!report} onClick={savePdf}><FileText size={13} /> PDF</button>
              <button className="aw-action" disabled={!report} onClick={() => report && saveText(verifyCsv(report), `${base}_vs_${tab?.doc.name.replace(/\s+/g, '_') ?? 'expected'}.csv`, 'text/csv')}><Download size={13} /> CSV</button>
              <button className="aw-action" disabled={!report} onClick={() => copyText(summary(), 'Copied the summary')}><ClipboardCopy size={13} /> Copy summary</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
