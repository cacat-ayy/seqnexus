/**
 * The report of an NGS mapping, shown on its assembly's overview: how many
 * reads mapped and paired properly, depth and breadth of coverage per
 * reference, coverage along each reference, fragment lengths and mapping
 * qualities, how the mapping was made, and SAM or BAM export.
 */

import './ReadSetWorkspace.css'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { useEditorStore } from '../../store'
import { notify } from '../../toast'
import { startExportMapping } from '../../workers/readset'
import type { NgsMapping } from '../../assembly/container'
import { formatBytes } from '../../utils/format'
import { mappingBedGraph } from '../../ngs/coverageExport'
import { getReadChunk } from '../../storage/idb'
import { COVERAGE_NOTE, mapperText, mappingReportPdf, sitesNote, skippedText } from './mappingReportPdf'
import { HistogramChart } from './charts'
import { downloadBlob, downloadMany } from '../../utils/download'
import { notifyFigureSaved } from '../../utils/cite-notice'

const nf = new Intl.NumberFormat('en-US')
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '_')


export default function MappingReport({ ngs, name, onOpenReference }: {
  ngs: NgsMapping
  /** What the mapping is called, for the PDF report's title and file name. */
  name: string
  onOpenReference?: (i: number) => void
}) {
  const r = ngs.report
  const readSet = useEditorStore(s => (ngs.readSetId ? s.readSets.find(x => x.id === ngs.readSetId) ?? null : null))
  const one = r.references.length === 1 ? r.references[0] : null
  const stored = r.version === 2
  const [exporting, setExporting] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  const runExport = (format: 'sam' | 'bam') => {
    setMenu(false)
    setExporting(0)
    const h = startExportMapping({
      type: 'export-mapping', format, storageId: ngs.storageId,
      references: r.references.map(x => ({ name: x.name, length: x.length, circular: x.circular })),
      program: r.program,
      readGroup: { id: safe(ngs.readSetName), sample: ngs.readSetName },
      preset: r.preset,
    }, (d, t) => setExporting(t ? d / t : 0))
    h.promise.then(({ file, index }) => {
      // An imported mapping is named after its file, which already says what it was mapped to.
      const stem = r.importedFrom ? safe(ngs.readSetName) : `${safe(ngs.readSetName)}_vs_${safe(r.references.map(x => x.name).join('_'))}`
      const name = `${stem}.${format}`
      void downloadMany([{ blob: file, name }, ...(index ? [{ blob: index, name: `${name}.bai` }] : [])])
      notify.success(index ? `Exported ${name} and its index` : `Exported ${name}`)
    }).catch(err => notify.error('Export failed', { detail: err instanceof Error ? err.message : String(err) }))
      .finally(() => setExporting(null))
  }

  const saveCoverage = () => {
    setMenu(false)
    const stem = r.importedFrom ? safe(ngs.readSetName) : `${safe(ngs.readSetName)}_vs_${safe(r.references.map(x => x.name).join('_'))}`
    mappingBedGraph({ get: getReadChunk }, ngs.storageId, r.references.map(x => x.name), `${name} depth`)
      .then(blob => { downloadBlob(blob, `${stem}_depth.bedgraph`); notify.success(`Exported ${stem}_depth.bedgraph`) })
      .catch(err => notify.error('Could not export the coverage', { detail: err instanceof Error ? err.message : String(err) }))
  }

  const savePdf = () => {
    setMenu(false)
    try {
      const bytes = mappingReportPdf(ngs, { title: `${name} mapping report`, readsName: r.importedFrom ?? readSet?.name ?? ngs.readSetName })
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${safe(name)}_report.pdf`)
      notifyFigureSaved(`${safe(name)}_report.pdf`)
    } catch (err) {
      notify.error('Could not make the PDF', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const mapper = mapperText(r)
  const skipped = skippedText(r)

  return (
    <>
      <div className="ngs-actions">
        <div className="aw-export" ref={menuRef}>
          <button className="aw-btn" onClick={() => setMenu(o => !o)} aria-expanded={menu} disabled={exporting !== null}>
            <Download size={13} /> {exporting !== null ? `Exporting ${Math.round(exporting * 100)}%` : 'Export'} <ChevronDown size={12} />
          </button>
          {menu && (
            <div className="aw-menu" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={savePdf}>
                <span className="aw-menu-label">Report as PDF</span>
                <span className="aw-menu-desc">This page: figures, charts and how it was made</span>
              </button>
              {stored && (
                <>
                  <div className="aw-menu-sep" />
                  <button role="menuitem" className="aw-menu-item" onClick={() => runExport('bam')}>
                    <span className="aw-menu-label">BAM with index (.bam, .bai)</span>
                    <span className="aw-menu-desc">Sorted by position, for IGV, samtools and variant callers</span>
                  </button>
                  <button role="menuitem" className="aw-menu-item" onClick={() => runExport('sam')}>
                    <span className="aw-menu-label">SAM</span>
                    <span className="aw-menu-desc">The same alignments as text</span>
                  </button>
                  <button role="menuitem" className="aw-menu-item" onClick={saveCoverage}>
                    <span className="aw-menu-label">Coverage as bedGraph</span>
                    <span className="aw-menu-desc">Read depth at every base, for IGV, bedtools or a spreadsheet</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {!stored && (
        <p className="aw-note ngs-warn-note">
          This mapping was made by an earlier version of SeqNexus, which kept its figures but not its reads&apos; bases, so its reads
          cannot be viewed or exported. Run it again to store it in full.
        </p>
      )}
      <div className="ngs-tiles">
        <Tile label="Reads mapped" value={pct(r.reads ? r.mapped / r.reads : 0)} detail={`${nf.format(r.mapped)} of ${nf.format(r.reads)}`} />
        {r.properlyPaired !== null && <Tile label="Properly paired" value={pct(r.properlyPaired)} detail="of mapped reads" />}
        {one && <Tile label="Mean depth" value={`${one.meanDepth.toFixed(1)}×`} />}
        {one && <Tile label="Covered" value={pct(one.breadth1)} detail={`${pct(one.breadth10)} at 10× or more`} />}
      </div>

      <section className="ngs-card">
        <div className="ngs-card-title">References</div>
        <table className="rs-table">
          <thead>
            <tr>
              <th>Reference</th><th className="num">Length</th><th className="num">Reads</th>
              <th className="num">Mean depth</th><th className="num">Covered</th><th className="num">At 10×+</th>
              {stored && <th className="num" title="Positions where some reads differ from the reference (candidate variants)">Sites</th>}
            </tr>
          </thead>
          <tbody>
            {r.references.map((x, i) => (
              <tr key={x.name} className={onOpenReference ? 'ngs-open-row' : 'ngs-static'}
                onClick={onOpenReference ? () => onOpenReference(i) : undefined}
                title={onOpenReference ? 'Show the reads along this reference' : undefined}>
                <td className="rs-name">{x.name}{x.circular ? <span className="aw-muted"> circular</span> : null}</td>
                <td className="num">{nf.format(x.length)} bp</td>
                <td className="num">{nf.format(x.mappedReads)}</td>
                <td className="num">{x.meanDepth.toFixed(1)}×</td>
                <td className="num">{pct(x.breadth1)}</td>
                <td className="num">{pct(x.breadth10)}</td>
                {stored && <td className="num">{nf.format(x.sites)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="ngs-charts">
        {r.references.map(x => (
          <HistogramChart key={x.name} title={`Coverage along ${x.name}`} subtitle={`Mean depth in ${nf.format(x.binSize)} bp windows`}
            hist={{ edges: [...x.coverageBins.map((_, i) => i * x.binSize + 1), x.length + 1], counts: x.coverageBins }}
            binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(Math.min(hi - 1, x.length))}`}
            unit="× mean depth" share={false} format={v => v.toFixed(1)} />
        ))}
        {r.insertSizes && r.insertSizes.counts.length > 0 && (
          <HistogramChart title="Fragment length" subtitle="Proper pairs, outer distance between the mates" hist={r.insertSizes}
            binLabel={(lo, hi) => `${nf.format(lo)} to ${nf.format(hi - 1)} bp`} unit="pairs" />
        )}
        {r.mapq.counts.length > 0 && (
          <HistogramChart title="Mapping quality" subtitle="Primary alignments by MAPQ" hist={r.mapq}
            binLabel={lo => `MAPQ ${lo}`} tickLabel={v => String(v)} />
        )}
      </div>

      <section className="ngs-card">
        <div className="ngs-card-title">How it was made</div>
        <dl className="ngs-facts">
          <dt>{r.importedFrom ? 'Alignments' : 'Reads'}</dt>
          <dd>{r.importedFrom
            ? <span>{r.importedFrom}</span>
            : readSet
              ? <><button className="ngs-link" onClick={() => useEditorStore.getState().setActiveReadSet(readSet.id)}>{readSet.name}</button>
                {readSet.discardedAt ? <span className="aw-muted"> (reads discarded)</span> : null}</>
              : <span>{ngs.readSetName} <span className="aw-muted">(deleted)</span></span>}</dd>
          <dt>Mapper</dt><dd>{mapper}</dd>
          {r.supplementary > 0 && <><dt>Split reads</dt><dd>{nf.format(r.supplementary)} supplementary alignments (the other parts of reads that map in pieces)</dd></>}
          {skipped && <><dt>Left out</dt><dd>{skipped}</dd></>}
          <dt>Coverage</dt><dd className="aw-muted">{COVERAGE_NOTE}</dd>
          {stored && (
            <>
              <dt>Sites</dt>
              <dd className="aw-muted">{sitesNote()}</dd>
              <dt>Stored</dt>
              <dd>{formatBytes(r.storedBytes)} in this browser, in {nf.format(r.pages)} {r.pages === 1 ? 'page' : 'pages'}, with each read&apos;s name, bases and qualities</dd>
            </>
          )}
        </dl>
      </section>
    </>
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
