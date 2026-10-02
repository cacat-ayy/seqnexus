/**
 * Several reads at once: a QC table, one row per read, sortable, with each
 * read's quality along its length. The usual first look at a plate: which
 * reads worked, which need a look, which failed. Click a row to open it.
 */

import '../alignment/AlignmentWorkspace.css'
import './ReadWorkspace.css'
import './ReadQcSummary.css'
import { useMemo, useState } from 'react'
import { ClipboardCopy, Download, Layers, Scissors, X } from 'lucide-react'
import { useEditorStore, type SequencingRead } from '../../store'
import { readQc, VERDICT_LABEL, type QcVerdict } from '../../sanger/qc'
import { editedRead, toFasta, toFastq } from '../../sanger/edits'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import { QualitySparkline } from '../explorer/ExplorerPreview'
import TrimCallDialog from './TrimCallDialog'
import AssembleDialog from '../contig/AssembleDialog'

interface Props {
  readIds: string[]
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

type SortKey = 'name' | 'verdict' | 'well' | 'length' | 'kept' | 'score' | 'crl' | 'qv20' | 'mixed' | 'edits'

const nf = new Intl.NumberFormat()
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const VERDICT_ORDER: Record<QcVerdict, number> = { fail: 0, check: 1, good: 2 }

interface Row {
  read: SequencingRead
  name: string
  verdict: QcVerdict
  issues: string[]
  well: string
  length: number
  kept: number
  score: number | null
  crl: number | null
  qv20: number | null
  mixed: number
  edits: number
}

export default function ReadSetView({ readIds, onClose, onExportPrompt }: Props) {
  const reads = useEditorStore(s => s.sequencingReads)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [trimOpen, setTrimOpen] = useState(false)
  const [assembleOpen, setAssembleOpen] = useState(false)

  const rows = useMemo((): Row[] => {
    const ids = new Set(readIds)
    return reads.filter(r => ids.has(r.id)).map(read => {
      const qc = readQc(read.data)
      const noQ = !!read.data.metadata.qualityMissing
      return {
        read,
        name: read.data.name,
        verdict: qc.verdict,
        issues: qc.issues,
        well: read.data.metadata.well ?? '',
        length: read.data.bases.length,
        kept: Math.max(0, read.trimEnd - read.trimStart),
        score: qc.traceScore,
        crl: noQ ? null : qc.crl.length,
        qv20: noQ ? null : qc.qv20,
        mixed: qc.mixedPeaks,
        edits: read.edits.length,
      }
    })
  }, [reads, readIds])

  const sorted = useMemo(() => {
    const k = sort.key
    const val = (r: Row): number | string => {
      switch (k) {
        case 'name': return r.name
        case 'well': return wellKey(r.well)
        case 'verdict': return VERDICT_ORDER[r.verdict]
        default: return r[k] ?? -1
      }
    }
    return [...rows].sort((a, b) => {
      const x = val(a)
      const y = val(b)
      const c = typeof x === 'string' && typeof y === 'string' ? collator.compare(x, y) : (x as number) - (y as number)
      return c * sort.dir
    })
  }, [rows, sort])

  const counts = { good: 0, check: 0, fail: 0 }
  for (const r of rows) counts[r.verdict]++

  const header = (key: SortKey, label: string, num = false, title?: string) => (
    <th
      className={num ? 'num' : undefined}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort(s => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: num || key === 'verdict' ? -1 : 1 }))}
      title={title}
    >
      {label}
    </th>
  )

  const all = (fmt: 'fasta' | 'fastq') => sorted.map(r => {
    const e = editedRead(r.read.data, r.read.edits, r.read.trimStart, r.read.trimEnd, { reversed: !!r.read.reversed })
    const name = r.name.replace(/\s+/g, '_')
    return fmt === 'fastq' ? toFastq(name, e) : toFasta(name, e.bases)
  }).join('')

  const save = (fmt: 'fasta' | 'fastq') => {
    const text = all(fmt)
    const def = `reads.${fmt}`
    const run = (name: string) => downloadText(text, name)
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }

  return (
    <div className="aw rs">
      <div className="aw-header">
        <Layers size={14} className="aw-header-icon" />
        <span className="aw-title-static">{rows.length} reads</span>
        <span className="aw-muted">
          {counts.good} good{counts.check ? ` · ${counts.check} to check` : ''}{counts.fail ? ` · ${counts.fail} failed` : ''}
        </span>
        <span className="aw-spacer" />
        <button className="aw-btn" onClick={() => setTrimOpen(true)} title="Trim and call mixed bases on every read in the table, with a preview first">
          <Scissors size={13} /> Trim &amp; call…
        </button>
        <button className="aw-btn" onClick={() => setAssembleOpen(true)} title="Map the reads to a reference, or assemble them de novo">
          <Layers size={13} /> Assemble…
        </button>
        <button className="aw-btn" onClick={() => copyText(all('fasta'), `Copied ${rows.length} reads as FASTA`)} title="The trimmed, edited reads, as shown (reverse complemented where set)">
          <ClipboardCopy size={13} /> Copy FASTA
        </button>
        <button className="aw-btn" onClick={() => save('fasta')}><Download size={13} /> FASTA</button>
        <button className="aw-btn" onClick={() => save('fastq')}><Download size={13} /> FASTQ</button>
        <button className="aw-icon-btn" onClick={onClose} title="Close" aria-label="Close"><X size={15} /></button>
      </div>
      {trimOpen && <TrimCallDialog readIds={readIds} onClose={() => setTrimOpen(false)} />}
      {assembleOpen && <AssembleDialog readIds={readIds} onClose={() => setAssembleOpen(false)} />}
      <div className="rs-scroll">
        <table className="rs-table">
          <thead>
            <tr>
              {header('verdict', 'QC')}
              {header('name', 'Read')}
              {header('well', 'Well')}
              <th title="Quality along the read; the trimmed ends are shaded">Quality</th>
              {header('length', 'Length', true)}
              {header('kept', 'Kept', true, 'Bases left after trimming')}
              {header('score', 'Trace score', true, 'Mean quality after quality trimming')}
              {header('crl', 'CRL', true, 'Contiguous read length: longest stretch where every 20-base window averages Q20 or better')}
              {header('qv20', 'QV20+', true, 'Bases called at Q20 or better')}
              {header('mixed', 'Second peaks', true, 'Calls in the high-quality stretch whose second peak reaches a third of the called one')}
              {header('edits', 'Edits', true)}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.read.id} onClick={() => useEditorStore.getState().setActiveSequencingRead(r.read.id)} title={`Open ${r.name}`}>
                <td><span className={`read-qc-verdict ${r.verdict}`}>{VERDICT_LABEL[r.verdict]}</span></td>
                <td className="rs-name">{r.name}</td>
                <td>{r.well}</td>
                <td><span className="rs-spark"><QualitySparkline data={r.read.data} trimStart={r.read.trimStart} trimEnd={r.read.trimEnd} /></span></td>
                <td className="num">{nf.format(r.length)}</td>
                <td className="num">{nf.format(r.kept)}</td>
                <td className="num">{r.score === null ? '–' : Math.round(r.score)}</td>
                <td className="num">{r.crl === null ? '–' : nf.format(r.crl)}</td>
                <td className="num">{r.qv20 === null ? '–' : nf.format(r.qv20)}</td>
                <td className="num">{nf.format(r.mixed)}</td>
                <td className="num">{r.edits ? nf.format(r.edits) : ''}</td>
                <td className="rs-issues" title={r.issues.join('\n')}>{r.issues[0] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Wells sort by row then column: A1, A2 … A12, B1. */
function wellKey(well: string): string {
  const m = /^([A-Pa-p])0*(\d{1,2})$/.exec(well.trim())
  return m ? `${m[1].toUpperCase()}${m[2].padStart(2, '0')}` : `~${well}`
}
