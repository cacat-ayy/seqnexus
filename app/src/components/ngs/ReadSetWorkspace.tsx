/**
 * A read set as a workspace: its QC verdict, the headline figures, the QC
 * charts, the first reads, and where it came from. Trimming makes a new read
 * set; export writes gzipped FASTQ. Discarding the reads frees their storage
 * and keeps the description and QC; mappings made from them keep the reads
 * they mapped.
 */

import './ReadSetWorkspace.css'
import '../alignment/AlignmentWorkspace.css'
import '../sanger/ReadWorkspace.css'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, FileStack, Layers, Scissors, Trash2, X, CircleCheck, TriangleAlert, OctagonAlert } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../store'
import { notify } from '../../toast'
import { readSetQc, QC_LABEL } from '../../ngs/qc'
import { compactCount, formatBaseCount, formatBytes, readShape } from '../../ngs/format'
import { isLongRead, TECHNOLOGY_LABEL } from '../../ngs/types'
import { decodeChunk } from '../../ngs/codec'
import { deleteReadChunks, getReadChunk } from '../../storage/idb'
import ConfirmDialog from '../ConfirmDialog'
import { startExport } from '../../workers/readset'
import { HistogramChart, PositionQualityChart } from './charts'

const TrimReadsDialog = lazy(() => import('./TrimReadsDialog'))
const MapReadsDialog = lazy(() => import('./MapReadsDialog'))

interface Props {
  readSet: ReadSet
  onClose: () => void
}

const nf = new Intl.NumberFormat()
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`
const PREVIEW = 20

interface PreviewRow { id: string; length: number; meanQ: number | null; seq: string }

export default function ReadSetWorkspace({ readSet: rs, onClose }: Props) {
  const s = rs.stats
  const long = isLongRead(rs.technology)
  const qc = useMemo(() => readSetQc(s, rs.technology), [s, rs.technology])
  const source = useEditorStore(st => (rs.origin ? st.readSets.find(r => r.id === rs.origin!.fromId) ?? null : null))
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [trimOpen, setTrimOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [exporting, setExporting] = useState<number | null>(null)
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const discarded = !!rs.discardedAt
  const mappings = useEditorStore(st => st.assemblies).filter(a => a.samples?.some(x => x.readSetId === rs.id))
  const menuRef = useRef<HTMLDivElement>(null)

  // The first reads, from the first chunk.
  useEffect(() => {
    let live = true
    setPreview(null)
    setPreviewError(null)
    if (discarded) return
    getReadChunk(rs.id, 0).then(packed => {
      if (!live) return
      if (!packed) { setPreviewError('The reads are missing from this browser\'s storage.'); return }
      const c = decodeChunk(packed)
      const rows: PreviewRow[] = []
      for (let i = 0; i < Math.min(PREVIEW, c.count); i++) {
        let meanQ: number | null = null
        if (c.hasQuality && c.length(i) > 0) {
          let err = 0
          for (let p = c.offsets[i]; p < c.offsets[i + 1]; p++) err += 10 ** (-c.qual[p] / 10)
          meanQ = -10 * Math.log10(err / c.length(i))
        }
        rows.push({ id: c.ids[i], length: c.length(i), meanQ, seq: c.seq(i).slice(0, 80) })
      }
      setPreview(rows)
    }).catch(err => { if (live) setPreviewError(err instanceof Error ? err.message : String(err)) })
    return () => { live = false }
  }, [rs.id, discarded])

  useEffect(() => {
    if (!exportMenu) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setExportMenu(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [exportMenu])

  const commitName = () => {
    const name = nameDraft?.trim()
    if (name && name !== rs.name) useEditorStore.getState().renameReadSet(rs.id, name)
    setNameDraft(null)
  }

  const fileBase = rs.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const runExport = (layout: 'pair' | 'interleaved') => {
    setExportMenu(false)
    setExporting(0)
    const h = startExport({ type: 'export', id: rs.id, chunks: rs.chunks, paired: rs.paired, layout }, (d, t) => setExporting(t ? d / t : 0))
    h.promise.then(blobs => {
      const names = blobs.length === 2 ? [`${fileBase}_R1.fastq.gz`, `${fileBase}_R2.fastq.gz`] : [`${fileBase}.fastq.gz`]
      blobs.forEach((b, i) => {
        const url = URL.createObjectURL(b)
        const a = document.createElement('a')
        a.href = url
        a.download = names[i]
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      })
      notify.success(`Exported ${names.join(' and ')}`)
    }).catch(err => notify.error('Export failed', { detail: err instanceof Error ? err.message : String(err) }))
      .finally(() => setExporting(null))
  }

  const VerdictIcon = qc.verdict === 'good' ? CircleCheck : qc.verdict === 'check' ? TriangleAlert : OctagonAlert
  const mates = s.positionQuality.length

  return (
    <div className="aw ngs">
      <div className="aw-header">
        <FileStack size={14} className="aw-header-icon" />
        <input
          className="aw-title-input"
          value={nameDraft ?? rs.name}
          aria-label="Read set name"
          title="Rename the read set"
          onChange={e => setNameDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            else if (e.key === 'Escape') { setNameDraft(null); (e.target as HTMLInputElement).blur() }
          }}
          size={Math.max(6, (nameDraft ?? rs.name).length)}
        />
        <span className="aw-chip">{TECHNOLOGY_LABEL[rs.technology]}</span>
        <span className="aw-chip">{rs.paired ? 'Paired' : 'Single reads'}</span>
        <span className="aw-muted">{rs.paired ? `${compactCount(s.reads / 2)} pairs` : `${compactCount(s.reads)} reads`} · {formatBaseCount(s.bases)} · {readShape(rs)}</span>
        <span className="aw-spacer" />
        <button className="aw-btn" onClick={() => setTrimOpen(true)} disabled={discarded}
          title={long ? 'Filter reads by length and read quality, into a new read set' : 'Trim adapters and low-quality ends with fastp, into a new read set'}>
          <Scissors size={13} /> {long ? 'Filter…' : 'Trim & filter…'}
        </button>
        <button className="aw-btn" onClick={() => setMapOpen(true)} disabled={discarded} title="Map the reads to open sequences with minimap2">
          <Layers size={13} /> Map to reference…
        </button>
        <div className="aw-export" ref={menuRef}>
          <button className="aw-btn" onClick={() => setExportMenu(o => !o)} aria-expanded={exportMenu} disabled={exporting !== null || discarded}>
            <Download size={13} /> {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : 'Export'} <ChevronDown size={12} />
          </button>
          {exportMenu && (
            <div className="aw-menu" role="menu">
              {rs.paired && (
                <button role="menuitem" className="aw-menu-item" onClick={() => runExport('pair')}>
                  <span className="aw-menu-label">FASTQ.gz, R1 and R2</span>
                  <span className="aw-menu-desc">Two files, one per mate</span>
                </button>
              )}
              <button role="menuitem" className="aw-menu-item" onClick={() => runExport('interleaved')}>
                <span className="aw-menu-label">{rs.paired ? 'FASTQ.gz, interleaved' : 'FASTQ.gz'}</span>
                <span className="aw-menu-desc">{rs.paired ? 'One file, mates one after the other' : 'The reads as stored'}</span>
              </button>
            </div>
          )}
        </div>
        <button className="aw-icon-btn" onClick={onClose} title="Close the read set" aria-label="Close the read set"><X size={15} /></button>
      </div>

      <div className="ngs-body">
        <div className={`ngs-verdict ${qc.verdict}`}>
          <VerdictIcon size={15} aria-hidden />
          <div>
            <div className="ngs-verdict-title">QC: {QC_LABEL[qc.verdict]}</div>
            {qc.issues.length > 0
              ? <ul className="ngs-issues">{qc.issues.map(i => <li key={i}>{i}</li>)}</ul>
              : <div className="ngs-verdict-sub">{long ? `Median read quality Q${s.medianReadQuality.toFixed(1)}` : `${pct(s.q30, 0)} of bases at Q30 or above`}, few N calls.</div>}
          </div>
        </div>

        <div className="ngs-tiles">
          <Tile label={rs.paired ? 'Pairs' : 'Reads'} value={nf.format(rs.paired ? s.reads / 2 : s.reads)} />
          <Tile label="Bases" value={formatBaseCount(s.bases)} />
          {long
            ? <Tile label="Read N50" value={formatBaseCount(s.n50)} detail={`mean ${formatBaseCount(Math.round(s.meanLength))}, longest ${formatBaseCount(s.maxLength)}`} />
            : <Tile label="Read length" value={s.minLength === s.maxLength ? `${s.maxLength} bp` : `${s.minLength} to ${s.maxLength} bp`} detail={`mean ${s.meanLength.toFixed(1)}`} />}
          {s.qualityMissing
            ? <Tile label="Quality" value="None" detail="no qualities in the file" />
            : long
              ? <Tile label="Median read quality" value={`Q${s.medianReadQuality.toFixed(1)}`} detail={`${pct(s.q20, 0)} of bases at Q20+`} />
              : <Tile label="Bases at Q30+" value={pct(s.q30)} detail={`${pct(s.q20)} at Q20+`} />}
          <Tile label="GC" value={pct(s.gc)} />
          <Tile label="N calls" value={pct(s.nFraction, 2)} />
        </div>

        {rs.origin && (
          <div className="ngs-card ngs-origin">
            <div className="ngs-card-title">Made from {source
              ? <button className="ngs-link" onClick={() => useEditorStore.getState().setActiveReadSet(source.id)}>{rs.origin.fromName}</button>
              : <span>{rs.origin.fromName}</span>}</div>
            <div className="ngs-origin-text">
              {rs.origin.method === 'fastp'
                ? `fastp: ${[
                  rs.origin.settings.adapters ? 'adapters trimmed' : 'adapters kept',
                  rs.origin.settings.windowQuality > 0 ? `ends trimmed below Q${rs.origin.settings.windowQuality} (4-base window)` : 'ends not quality-trimmed',
                  `reads under ${rs.origin.settings.minLength} bp dropped`,
                ].join(', ')}.`
                : `Filtered: reads under ${formatBaseCount(rs.origin.settings.minLength)}${rs.origin.settings.minReadQuality > 0 ? ` or below Q${rs.origin.settings.minReadQuality} mean quality` : ''} dropped.`}
              {' '}{nf.format(rs.origin.readsAfter)} of {nf.format(rs.origin.readsBefore)} reads kept ({pct(rs.origin.readsBefore ? rs.origin.readsAfter / rs.origin.readsBefore : 0)}),
              {' '}{nf.format(rs.origin.basesAfter)} of {nf.format(rs.origin.basesBefore)} bases.
              {rs.origin.adapterTrimmedReads !== undefined && ` Adapter found and cut in ${nf.format(rs.origin.adapterTrimmedReads)} reads.`}
            </div>
          </div>
        )}

        <div className="ngs-charts">
          {!long && s.positionQuality.map((pq, m) => (
            <PositionQualityChart key={m} positions={pq}
              title={mates === 2 ? `Quality by position, R${m + 1}` : 'Quality by position'}
              subtitle="Phred score of the bases at each read position" />
          ))}
          {/* Reads of one length (untrimmed Illumina) would be a one-bar chart: the tile says it. */}
          {s.minLength !== s.maxLength && (
            <HistogramChart title="Read length" subtitle={long ? 'Reads by length (log-spaced bins)' : 'Reads by length'} hist={s.lengths}
              binLabel={(lo, hi) => (hi - lo <= 1 ? `${lo} bp` : `${nf.format(lo)} to ${nf.format(hi - 1)} bp`)}
              tickLabel={v => (v >= 10_000 ? `${Math.round(v / 1000)}k` : nf.format(v))} />
          )}
          {!s.qualityMissing && (
            <HistogramChart title="Read quality" subtitle="Reads by mean quality (from error probabilities)" hist={s.readQuality}
              binLabel={lo => `Q${lo.toFixed(1)}`} tickLabel={v => `Q${Math.round(v)}`} />
          )}
          <HistogramChart title="GC content" subtitle="Reads by share of G and C" hist={s.gcContent}
            binLabel={lo => `${lo}% GC`} tickLabel={v => `${v}%`} />
        </div>

        {!discarded && <div className="ngs-card">
          <div className="ngs-card-title">First reads</div>
          {previewError && <p className="aw-note">{previewError}</p>}
          {preview && (
            <div className="ngs-preview">
              <table className="rs-table">
                <thead><tr><th>Read</th><th className="num">Length</th><th className="num">Mean Q</th><th>Sequence</th></tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="ngs-static">
                      <td className="rs-name ngs-read-id" title={r.id}>{rs.paired ? <span className="aw-muted">R{(i % 2) + 1} </span> : null}{r.id}</td>
                      <td className="num">{nf.format(r.length)}</td>
                      <td className="num">{r.meanQ === null ? '-' : r.meanQ.toFixed(1)}</td>
                      <td className="ngs-seq">{r.seq}{r.length > r.seq.length ? '…' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>}

        <div className="ngs-card">
          <div className="ngs-card-title">Files and storage</div>
          <dl className="ngs-facts">
            <dt>Imported from</dt>
            <dd>{rs.files.length ? rs.files.map(f => `${f.name} (${formatBytes(f.bytes)})`).join(', ') : 'Made in SeqNexus'}</dd>
            <dt>Stored</dt>
            <dd>
              {discarded
                ? <>Reads discarded {new Date(rs.discardedAt!).toLocaleString()}; the figures and charts here are kept.</>
                : <>{formatBytes(rs.storedBytes)} in this browser, compressed, in {nf.format(rs.chunks)} {rs.chunks === 1 ? 'part' : 'parts'}</>}
            </dd>
            {mappings.length > 0 && (
              <>
                <dt>Mapped in</dt>
                <dd>
                  {mappings.map((a, i) => (
                    <span key={a.id}>{i > 0 && ', '}
                      <button className="ngs-link" onClick={() => useEditorStore.getState().setActiveAssembly(a.id)}>{a.name}</button>
                    </span>
                  ))}
                  <span className="aw-muted"> (each keeps the reads it mapped)</span>
                </dd>
              </>
            )}
            <dt>Backups</dt>
            <dd className="aw-muted">Read sets are not part of session files. Export them as FASTQ to keep a copy elsewhere.</dd>
          </dl>
          {!discarded && (
            <div className="ngs-actions ngs-card-actions">
              <button className="aw-btn" onClick={() => setDiscardOpen(true)}
                title="Delete the reads from this browser's storage, keeping this page's figures">
                <Trash2 size={13} /> Discard reads…
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={discardOpen}
        title="Discard the reads"
        message={`Delete the reads of ${rs.name} from this browser, freeing ${formatBytes(rs.storedBytes)}? The QC figures stay${mappings.length ? ', and the mappings made from them keep every read they mapped' : ''}. Trimming, mapping and FASTQ export need the reads, and reads not mapped are lost. This cannot be undone: export the reads as FASTQ first to keep a copy.`}
        buttons={[
          { label: 'Cancel', value: 'cancel' },
          { label: 'Discard reads', value: 'discard', variant: 'danger' },
        ]}
        onResult={value => {
          setDiscardOpen(false)
          if (value !== 'discard') return
          const freed = rs.storedBytes
          useEditorStore.getState().discardReads(rs.id)
          deleteReadChunks([rs.id])
            .then(() => notify.success(`Discarded the reads, freeing ${formatBytes(freed)}`))
            .catch(err => notify.error('Could not delete the reads', { detail: err instanceof Error ? err.message : String(err) }))
        }}
      />
      {mapOpen && (
        <Suspense fallback={null}>
          <MapReadsDialog readSet={rs} onClose={() => setMapOpen(false)} />
        </Suspense>
      )}
      {trimOpen && (
        <Suspense fallback={null}>
          <TrimReadsDialog readSet={rs} onClose={() => setTrimOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="ngs-tile">
      <div className="ngs-tile-label">{label}</div>
      <div className="ngs-tile-value">{value}</div>
      {detail && <div className="ngs-tile-detail">{detail}</div>}
    </div>
  )
}
