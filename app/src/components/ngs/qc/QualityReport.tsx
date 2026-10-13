/**
 * A read set's quality report, laid out as FastQC lays out its report: a
 * Summary list of the modules with their pass, warn or fail mark on the
 * left, and the modules in FastQC's order on the right, each under its
 * FastQC name with the plot FastQC users know. One report per mate, as
 * FastQC makes one per file.
 *
 * The report is made while the reads are imported or trimmed
 * (ngs/qcreport) and stored beside them.
 */

import './QualityReport.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChartColumn, ChevronDown, CircleCheck, CircleHelp, CircleMinus, Copy, Download, ExternalLink, Info, OctagonX, Table2, TriangleAlert } from 'lucide-react'
import { useEditorStore, type ReadSet } from '../../../store'
import { notify } from '../../../toast'
import { getReadChunk } from '../../../storage/idb'
import { decodeQcReport, qcStorageId } from '../../../ngs/qcreport/storage'
import { DUPLICATION_LABELS, MODULES, type MateReport, type ModuleId, type ModuleStatus, type QcReport } from '../../../ngs/qcreport/types'
import { formatBp } from '../../../utils/format'
import { isLongRead } from '../../../ngs/types'
import { expectedNote, LIBRARY_LABEL, LIBRARY_TYPES, type ExpectedContext, type LibraryType } from '../../../ngs/qcreport/expected'
import { useWidth } from '../useWidth'
import { LineChart, QualityBoxChart, QualityTable, SeriesTable, TileHeatmap, TileTable, type Series } from './qcCharts'
import { MODULE_HELP } from './help'
import { fastqcDataText } from '../../../ngs/qcreport/fastqcData'
import { downloadBlob, downloadMany } from '../../../utils/download'
import { notifyFigureSaved } from '../../../utils/cite-notice'

const nf = new Intl.NumberFormat()
const pct = (v: number) => `${v.toFixed(v > 0 && v < 1 ? 2 : 1)}%`

const STATUS_LABEL: Record<ModuleStatus, string> = { pass: 'Passed', warn: 'Warning', fail: 'Failed', skip: 'Not run' }

export function StatusIcon({ status, size = 15, expected = false }: { status: ModuleStatus; size?: number; expected?: boolean }) {
  const Icon = status === 'pass' ? CircleCheck : status === 'warn' ? TriangleAlert : status === 'fail' ? OctagonX : CircleMinus
  return <Icon size={size} className={`qr-status ${status}${expected ? ' expected' : ''}`} aria-label={`${STATUS_LABEL[status]}${expected ? ', expected' : ''}`} role="img" />
}

type Load = { state: 'loading' } | { state: 'ready'; report: QcReport } | { state: 'missing' }

/** NCBI's nucleotide BLAST page with the sequence filled in, for an overrepresented sequence with no hit in the contaminant list. */
const blastUrl = (seq: string) => `https://blast.ncbi.nlm.nih.gov/Blast.cgi?PAGE_TYPE=BlastSearch&PROGRAM=blastn&QUERY=${encodeURIComponent(seq)}`

/** Modules whose content is already a table. */
const TABLE_ONLY = new Set<ModuleId>(['basic', 'overrepresented'])

export default function QualityReport({ readSet: rs }: { readSet: ReadSet }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [mate, setMate] = useState(0)
  const [tables, setTables] = useState<ReadonlySet<ModuleId>>(new Set())
  const [help, setHelp] = useState<ReadonlySet<ModuleId>>(new Set())
  const [active, setActive] = useState<ModuleId>('basic')
  const body = useRef<HTMLDivElement>(null)
  const sections = useRef(new Map<ModuleId, HTMLElement>())
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  useEffect(() => {
    let live = true
    setLoad({ state: 'loading' })
    getReadChunk(qcStorageId(rs.id), 0)
      .then(data => {
        if (!live) return
        const report = rs.qc ? decodeQcReport(data) : null
        setLoad(report ? { state: 'ready', report } : { state: 'missing' })
      })
      .catch(() => { if (live) setLoad({ state: 'missing' }) })
    return () => { live = false }
  }, [rs.id, rs.qc])

  const report = load.state === 'ready' ? load.report : null
  const m = report?.mates[Math.min(mate, report.mates.length - 1)] ?? null
  const ctx: ExpectedContext = { library: rs.library, long: isLongRead(rs.technology), trimmed: !!rs.origin }
  const expected = (id: ModuleId) => (m ? expectedNote(id, m.status[id], ctx) : null)

  // The module in view, for the Summary list.
  const onScroll = () => {
    const el = body.current
    if (!el) return
    const top = el.getBoundingClientRect().top + 72
    let current: ModuleId = 'basic'
    for (const { id } of MODULES) {
      const s = sections.current.get(id)
      if (s && s.getBoundingClientRect().top <= top) current = id
    }
    // At the bottom the last modules never reach the top: the last one in view is the one being read.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
      const bottom = el.getBoundingClientRect().bottom
      for (const { id } of MODULES) {
        const s = sections.current.get(id)
        if (s && s.getBoundingClientRect().top < bottom - 80) current = id
      }
    }
    setActive(current)
  }

  const goTo = (id: ModuleId) => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    sections.current.get(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }

  const toggle = (set: ReadonlySet<ModuleId>, id: ModuleId) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const counts = useMemo(() => {
    const c = { pass: 0, warn: 0, fail: 0, skip: 0, expected: 0 }
    if (m) {
      for (const { id } of MODULES) {
        c[m.status[id]]++
        if (expectedNote(id, m.status[id], ctx)) c.expected++
      }
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx is rebuilt each render from these
  }, [m, rs.library, rs.technology, rs.origin])

  if (!report || !m) {
    return (
      <div className="ngs-body">
        <div className="ngs-card qr-empty">
          <div className="ngs-card-title">Quality report</div>
          {load.state === 'loading' && <p className="aw-note">Loading the report…</p>}
          {load.state === 'missing' && <p className="aw-note">The quality report could not be read from this browser's storage.</p>}
        </div>
      </div>
    )
  }

  // The file each mate came from, as Basic Statistics and the exports name it; mates of one file (interleaved, or made in SeqNexus) are told apart by R1 and R2.
  const mateFile = (k: number) => (rs.files.length === 2
    ? rs.files[k].name
    : `${rs.files[0]?.name ?? rs.name}${report.mates.length === 2 ? ` (R${k + 1})` : ''}`)
  const fileName = mateFile(Math.min(mate, report.mates.length - 1))
  const exportAs = async (kind: 'html' | 'pdf' | 'data') => {
    setMenu(false)
    const base = rs.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
    try {
      if (kind === 'data') {
        const files = report.mates.map((mm, k) => ({
          blob: new Blob([fastqcDataText(mm, mateFile(k))], { type: 'text/plain' }),
          name: `${base}${report.mates.length === 2 ? `_R${k + 1}` : ''}_fastqc_data.txt`,
        }))
        await downloadMany(files)
        notify.success(`Exported ${files.map(f => f.name).join(' and ')}`)
        return
      }
      const { reportHtml, reportPdf } = await import('./exportReport')
      const input = { name: rs.name, report, fileNames: report.mates.map((_, k) => mateFile(k)), ctx }
      const name = `${base}_quality_report.${kind}`
      downloadBlob(kind === 'html' ? new Blob([reportHtml(input)], { type: 'text/html' }) : new Blob([reportPdf(input) as BlobPart], { type: 'application/pdf' }), name)
      notifyFigureSaved(name)
    } catch (err) {
      notify.error('Export failed', { detail: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <div className="ngs-body qr-body" ref={body} onScroll={onScroll}>
      <div className="qr">
        <nav className="qr-rail" aria-label="Summary">
          <div className="qr-rail-title">Summary</div>
          {MODULES.map(({ id, name }) => (
            <button key={id} className={`qr-rail-item${active === id ? ' active' : ''}${m.status[id] === 'skip' ? ' skipped' : ''}`}
              onClick={() => goTo(id)} aria-current={active === id ? 'true' : undefined}
              title={expected(id) ?? undefined}>
              <StatusIcon status={m.status[id]} size={14} expected={!!expected(id)} />
              <span>{name}</span>
            </button>
          ))}
        </nav>

        <div className="qr-main">
          <div className="qr-head">
            <div>
              <div className="qr-head-title">Quality report{report.mates.length === 2 ? `, R${mate + 1}` : ''}</div>
              <div className="qr-head-sub">FastQC's modules and default thresholds, computed by SeqNexus</div>
            </div>
            <div className="qr-counts" aria-label="Module results">
              {(['pass', 'warn', 'fail'] as const).map(s => counts[s] > 0 && (
                <span key={s} className="qr-count"><StatusIcon status={s} size={13} /> {counts[s]} {s === 'pass' ? 'passed' : s === 'warn' ? (counts[s] === 1 ? 'warning' : 'warnings') : 'failed'}</span>
              ))}
              {counts.skip > 0 && <span className="qr-count"><StatusIcon status="skip" size={13} /> {counts.skip} not run</span>}
              {counts.expected > 0 && <span className="qr-count qr-muted">({counts.expected} expected for {ctx.long ? 'long reads' : ctx.library ? LIBRARY_LABEL[ctx.library].toLowerCase() : 'these reads'})</span>}
            </div>
            <label className="qr-library" title="What kind of library the reads are. FastQC's marks stay as they are; flags that are expected for the library are shown muted, with the reason.">
              <span>Library</span>
              <select className="select aw-select" value={rs.library ?? ''}
                onChange={e => useEditorStore.getState().setReadSetLibrary(rs.id, (e.target.value || undefined) as LibraryType | undefined)}>
                <option value="">Not set</option>
                {LIBRARY_TYPES.map(t => <option key={t} value={t}>{LIBRARY_LABEL[t]}</option>)}
              </select>
            </label>
            <div className="aw-export" ref={menuRef}>
              <button className="aw-btn" onClick={() => setMenu(o => !o)} aria-expanded={menu}>
                <Download size={13} /> Export report <ChevronDown size={12} />
              </button>
              {menu && (
                <div className="aw-menu" role="menu">
                  <button role="menuitem" className="aw-menu-item" onClick={() => void exportAs('html')}>
                    <span className="aw-menu-label">Report, HTML</span>
                    <span className="aw-menu-desc">One page for any browser, laid out as FastQC's{report.mates.length === 2 ? ', R1 and R2' : ''}</span>
                  </button>
                  <button role="menuitem" className="aw-menu-item" onClick={() => void exportAs('pdf')}>
                    <span className="aw-menu-label">Report, PDF</span>
                    <span className="aw-menu-desc">The same report on A4 pages, the charts as vectors</span>
                  </button>
                  <button role="menuitem" className="aw-menu-item" onClick={() => void exportAs('data')}>
                    <span className="aw-menu-label">FastQC data for MultiQC</span>
                    <span className="aw-menu-desc">fastqc_data.txt{report.mates.length === 2 ? ', one per mate' : ''}: MultiQC reads it with other samples' FastQC results</span>
                  </button>
                </div>
              )}
            </div>
            {report.mates.length === 2 && (
              <div className="aw-seg" role="radiogroup" aria-label="Mate">
                {['R1', 'R2'].map((label, i) => (
                  <button key={label} role="radio" aria-checked={mate === i} className={mate === i ? 'active' : ''} onClick={() => setMate(i)}
                    title={`The report of the ${i ? 'second' : 'first'} reads of the pairs${rs.files.length === 2 ? ` (${rs.files[i].name})` : ''}`}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {MODULES.map(({ id, name }) => {
            const status = m.status[id]
            const asTable = tables.has(id)
            const showHelp = help.has(id)
            const h = MODULE_HELP[id]
            const why = expected(id)
            return (
              <section key={id} className={`qr-module ${status}${why ? ' expected' : ''}`} ref={el => { if (el) sections.current.set(id, el); else sections.current.delete(id) }}
                aria-labelledby={`qr-${id}`}>
                <div className="qr-module-head">
                  <StatusIcon status={status} expected={!!why} />
                  <h3 id={`qr-${id}`} className="qr-module-title">{name}</h3>
                  <span className={`qr-status-text ${status}${why ? ' expected' : ''}`}>{STATUS_LABEL[status]}{why ? ', expected' : ''}</span>
                  <span className="aw-spacer" />
                  <button className="aw-icon-btn" onClick={() => setHelp(s => toggle(s, id))} aria-pressed={showHelp}
                    title="What this module shows" aria-label={`What ${name} shows`}>
                    <CircleHelp size={13} />
                  </button>
                  {!TABLE_ONLY.has(id) && status !== 'skip' && (
                    <button className="aw-icon-btn" onClick={() => setTables(s => toggle(s, id))} aria-pressed={asTable}
                      title={asTable ? 'Show as a chart' : 'Show as a table'} aria-label={asTable ? 'Show as a chart' : 'Show as a table'}>
                      {asTable ? <ChartColumn size={13} /> : <Table2 size={13} />}
                    </button>
                  )}
                </div>
                {why && <p className="qr-expected"><Info size={13} aria-hidden /> <span>{why}</span></p>}
                {showHelp && (
                  <div className="qr-help">
                    <p>{h.about}</p>
                    <p><strong>Flags:</strong> {h.flags}</p>
                    {h.expected && <p><strong>When it is expected:</strong> {h.expected}</p>}
                  </div>
                )}
                {status === 'skip'
                  ? <p className="qr-note">{m.notes[id]}</p>
                  : (
                    <>
                      <ModuleBody id={id} m={m} asTable={asTable} fileName={fileName ?? rs.name} />
                      {m.notes[id] && <p className="qr-note">{m.notes[id]}</p>}
                    </>
                  )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** A chart at the width of its module, or its table. */
function Plot({ asTable, table, chart }: { asTable: boolean; table: ReactNode; chart: (width: number) => ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  return (
    <div ref={ref} className="qr-plot">
      {asTable ? <div className="qr-table">{table}</div> : width > 0 && chart(width)}
    </div>
  )
}

function ModuleBody({ id, m, asTable, fileName }: { id: ModuleId; m: MateReport; asTable: boolean; fileName: string }) {
  const positions = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1))
  const line = (labels: string[], series: Series[], xTitle: string, yTitle: string, o: { yMax?: number; format?: (v: number) => string; everyLabel?: boolean; zeroBased?: boolean } = {}) => (
    <Plot asTable={asTable}
      table={<SeriesTable labels={labels} series={series} xTitle={xTitle} format={o.format} />}
      chart={w => <LineChart width={w} labels={labels} series={series} xTitle={xTitle} yTitle={yTitle} {...o} />} />
  )
  switch (id) {
    case 'basic':
      return (
        <table className="rs-table qr-basic">
          <thead><tr><th>Measure</th><th>Value</th></tr></thead>
          <tbody>
            <tr className="ngs-static"><td>Filename</td><td>{fileName}</td></tr>
            <tr className="ngs-static"><td>File type</td><td>Conventional base calls</td></tr>
            <tr className="ngs-static"><td>Encoding</td><td>{m.lowestQuality === null ? 'No qualities' : 'Sanger / Illumina 1.9 (Phred+33)'}</td></tr>
            <tr className="ngs-static"><td>Total Sequences</td><td>{nf.format(m.reads)}</td></tr>
            <tr className="ngs-static"><td>Total Bases</td><td>{formatBp(m.bases)}</td></tr>
            <tr className="ngs-static"><td>Sequences flagged as poor quality</td><td>0</td></tr>
            <tr className="ngs-static"><td>Sequence length</td><td>{m.minLength === m.maxLength ? m.maxLength : `${m.minLength}-${m.maxLength}`}</td></tr>
            <tr className="ngs-static"><td>%GC</td><td>{Math.round(m.gc)}</td></tr>
          </tbody>
        </table>
      )
    case 'baseQuality':
      return <Plot asTable={asTable} table={<QualityTable positions={m.baseQuality} />} chart={w => <QualityBoxChart width={w} positions={m.baseQuality} />} />
    case 'tileQuality':
      return m.tiles && (
        <Plot asTable={asTable} table={<TileTable ids={m.tiles.ids} deviation={m.tiles.deviation} />}
          chart={w => <TileHeatmap width={w} ids={m.tiles!.ids} deviation={m.tiles!.deviation} />} />
      )
    case 'seqQuality':
      return line(m.seqQuality.counts.map((_, i) => String(m.seqQuality.from + i)), [{ name: 'Average quality per read', color: 'accent', values: m.seqQuality.counts }],
        'Mean sequence quality (Phred score)', 'Reads', { format: v => `${nf.format(v)} reads` })
    case 'baseContent':
      return line(positions(m.baseContent.a.length), [
        { name: '%T', color: 'base-t', values: m.baseContent.t },
        { name: '%C', color: 'base-c', values: m.baseContent.c },
        { name: '%A', color: 'base-a', values: m.baseContent.a },
        { name: '%G', color: 'base-g', values: m.baseContent.g },
      ], 'Position in read (bp)', 'Percent', { yMax: 100, format: pct })
    case 'seqGc':
      return line(m.seqGc.observed.map((_, i) => String(i)), [
        { name: 'GC count per read', color: 's1', values: m.seqGc.observed },
        { name: 'Theoretical distribution', color: 's2', values: m.seqGc.theoretical, dashed: true },
      ], 'Mean GC content (%)', 'Reads', { format: v => nf.format(Math.round(v)), zeroBased: true })
    case 'baseN':
      return line(positions(m.baseN.length), [{ name: '%N', color: 'accent', values: m.baseN }], 'Position in read (bp)', 'Percent', { yMax: 100, format: pct })
    case 'lengths': {
      const h = m.lengths
      let labels = h.counts.map((_, i) => (h.edges[i + 1] - h.edges[i] <= 1 ? String(h.edges[i]) : `${h.edges[i]}-${h.edges[i + 1] - 1}`))
      let values = h.counts
      // One length: FastQC draws its neighbours at zero, so the spike reads as one.
      if (labels.length === 1) {
        labels = [String(h.edges[0] - 1), labels[0], String(h.edges[0] + 1)]
        values = [0, values[0], 0]
      }
      return line(labels, [{ name: 'Sequence length', color: 'accent', values }], 'Sequence length (bp)', 'Reads',
        { format: v => `${nf.format(v)} reads`, everyLabel: labels.length <= 12 })
    }
    case 'duplication':
      return (
        <>
          <p className="qr-lead">Percent of sequences remaining if deduplicated: <strong>{m.duplication.remaining.toFixed(2)}%</strong></p>
          {line([...DUPLICATION_LABELS], [{ name: '% Total sequences', color: 'accent', values: m.duplication.levels }], 'Sequence duplication level', 'Percent of all reads',
            { yMax: 100, format: pct, everyLabel: true })}
        </>
      )
    case 'overrepresented':
      return m.overrepresented.length === 0
        ? <p className="qr-lead">No overrepresented sequences.</p>
        : (
          <div className="qr-table tall">
            <table className="rs-table">
              <thead><tr><th>Sequence</th><th className="num">Count</th><th className="num">Percentage</th><th>Possible Source</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {m.overrepresented.map(o => (
                  <tr key={o.seq} className="ngs-static">
                    <td className="qr-seq">{o.seq}</td>
                    <td className="num">{nf.format(o.count)}</td>
                    <td className="num">{o.percent.toFixed(2)}</td>
                    <td>{o.source ?? 'No Hit'}</td>
                    <td className="qr-row-actions">
                      <button className="aw-icon-btn" title="Copy the sequence" aria-label="Copy the sequence"
                        onClick={() => navigator.clipboard?.writeText(o.seq).then(() => notify.success('Copied the sequence'), () => notify.error('Could not copy'))}>
                        <Copy size={13} />
                      </button>
                      <a className="aw-icon-btn" href={blastUrl(o.seq)} target="_blank" rel="noreferrer noopener"
                        title="Search it with BLAST at NCBI (opens in a new tab and sends the sequence to NCBI)" aria-label="BLAST the sequence at NCBI">
                        <ExternalLink size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    case 'adapters':
      return m.adapters.length > 0 && line(positions(m.adapters[0].percent.length),
        m.adapters.map((a, i) => ({ name: a.name, color: `s${i + 1}`, values: a.percent })), 'Position in read (bp)', '% Adapter', { yMax: 100, format: pct })
  }
}
