/**
 * The clones of a plate, verified at once: one row per contig mapped to its
 * designed construct, with its verdict, coverage, lowest depth and
 * differences from the design. One set of settings for the whole plate
 * (saved with the assembly); filters by verdict; exports a CSV summary, the
 * consensus sequences as FASTA (all, or the verified ones) and a PDF report.
 * A row opens its contig, where the single-contig verification shows the
 * detail.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { useEditorStore, type Assembly, type Contig } from '../../store'
import { notify } from '../../toast'
import { computeConsensus, consensusSequence } from '../../assembly/consensus'
import { refFeatures } from '../../assembly/features'
import {
  checkableTypes, DEFAULT_PLATE_VERIFY, lowestDepth, plateCounts, plateCsv, plateFasta, verifyPlateContig,
  type CloneResult, type PlateFilter, type PlateVerifySettings,
} from '../../assembly/plate'
import { describeDifference, STATUS_LABEL } from '../../assembly/verify'
import type { RefFeature } from '../../assembly/variants'
import { downloadBlob, saveText } from '../../utils/download'
import { plateReportPdf } from './plateReport'
import { notifyFigureSaved } from '../../utils/cite-notice'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`
const FILTER_LABEL: Record<PlateFilter, string> = { all: 'All', verified: 'Verified', differences: 'Differences', incomplete: 'Not fully covered' }

interface Props {
  assembly: Assembly
  contigs: readonly Contig[]
}

export default function ClonesSection({ assembly, contigs }: Props) {
  const tabs = useEditorStore(s => s.tabs)
  const settings = assembly.verify ?? DEFAULT_PLATE_VERIFY
  const setSettings = (patch: Partial<PlateVerifySettings>) => useEditorStore.getState().setAssemblyVerify(assembly.id, { ...settings, ...patch })
  const [filter, setFilter] = useState<PlateFilter>('all')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menu])

  // Each construct's features: the open sequence's, or the copy its contig kept.
  const features = useMemo(() => contigs.map((c): RefFeature[] => {
    const r = c.doc.reference
    const tab = r?.tabId ? tabs.find(t => t.id === r.tabId) : undefined
    return tab ? refFeatures(tab.doc.annotations.map(a => a.toData())) : r?.features ?? []
  }), [contigs, tabs])
  const consensus = useMemo(() => contigs.map(c => computeConsensus(c.doc, c.view.consensus)), [contigs])
  const results = useMemo((): CloneResult[] => contigs.map((c, i) => ({
    contigId: c.id,
    name: c.name,
    reference: c.doc.reference?.name ?? null,
    reads: c.doc.rows.length,
    report: c.doc.reference ? verifyPlateContig(c.doc, consensus[i].bases, features[i], settings) : null,
    consensus: consensusSequence(consensus[i]),
  })), [contigs, consensus, features, settings])
  const counts = plateCounts(results)
  const shown = filter === 'all' ? results : results.filter(r => r.report?.verdict === filter)
  const types = useMemo(() => checkableTypes(features), [features])
  const refNames = [...new Set(results.map(r => r.reference).filter((n): n is string => !!n))]
  const stem = assembly.name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const several = contigs.length > 1

  const exportCsv = () => { setMenu(false); saveText(plateCsv(results, settings), `${stem}_clones.csv`, 'text/csv') }
  const exportFasta = (onlyVerified: boolean) => {
    setMenu(false)
    const list = onlyVerified ? results.filter(r => r.report?.verdict === 'verified') : results
    if (!list.length) { notify.info('No clone is verified yet'); return }
    saveText(plateFasta(list), `${stem}_${onlyVerified ? 'verified' : 'consensus'}.fasta`)
  }
  const exportPdf = () => {
    setMenu(false)
    try {
      const bytes = plateReportPdf({ name: assembly.name, results, settings, grouping: assembly.grouping ?? null, references: refNames })
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${stem}_verification.pdf`)
      notifyFigureSaved(`${stem}_verification.pdf`)
    } catch (err) {
      notify.error('Could not make the PDF', { detail: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <section className="ao-section" aria-label="Clones">
      <div className="ao-clones-head">
        <h3 className="ao-title">{assembly.grouping ? 'Clones' : 'Contigs'}</h3>
        <div className="aw-seg" role="radiogroup" aria-label="Show">
          {(['all', 'verified', 'differences', 'incomplete'] as PlateFilter[]).map(f => (
            <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}
              disabled={f !== 'all' && counts[f] === 0 && filter !== f}>
              {FILTER_LABEL[f]} {nf.format(counts[f])}
            </button>
          ))}
        </div>
        <span className="aw-spacer" />
        <div className="aw-export" ref={menuRef}>
          <button className="aw-btn" onClick={() => setMenu(o => !o)} aria-expanded={menu}>
            <Download size={13} /> Export <ChevronDown size={12} />
          </button>
          {menu && (
            <div className="aw-menu" role="menu">
              <button role="menuitem" className="aw-menu-item" onClick={exportPdf}>
                <span className="aw-menu-label">Report as PDF</span>
                <span className="aw-menu-desc">Counts, a row per clone, every difference, how it was checked</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={exportCsv}>
                <span className="aw-menu-label">Summary as CSV</span>
                <span className="aw-menu-desc">A row per clone, for a spreadsheet or LIMS</span>
              </button>
              <div className="aw-menu-sep" />
              <button role="menuitem" className="aw-menu-item" onClick={() => exportFasta(false)}>
                <span className="aw-menu-label">Consensus of every clone (FASTA)</span>
              </button>
              <button role="menuitem" className="aw-menu-item" onClick={() => exportFasta(true)} disabled={counts.verified === 0}>
                <span className="aw-menu-label">Consensus of the verified clones (FASTA)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ao-clones-controls">
        <label className="aw-check small">
          Covered by at least
          <select className="select aw-select-sm" value={settings.minDepth} aria-label="Reads needed over a base"
            onChange={e => setSettings({ minDepth: Number(e.target.value) })}>
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          {settings.minDepth === 1 ? 'read' : 'reads'}
        </label>
        <label className="aw-check small">
          <input type="checkbox" checked={settings.bothStrands} onChange={e => setSettings({ bothStrands: e.target.checked })} />
          on both strands
        </label>
        {types.length > 0 && (
          <span className="ao-clones-types" role="group" aria-label="Feature types checked">
            <span className="aw-muted">Check</span>
            {types.map(t => (
              <label key={t} className="aw-check small">
                <input type="checkbox" checked={!settings.skipTypes.includes(t)}
                  onChange={e => setSettings({ skipTypes: e.target.checked ? settings.skipTypes.filter(x => x !== t) : [...settings.skipTypes, t] })} />
                {t}
              </label>
            ))}
          </span>
        )}
      </div>

      <div className="ao-table-wrap">
        <table className="rs-table ao-table">
          <thead>
            <tr>
              <th>{assembly.grouping ? 'Clone' : 'Contig'}</th>
              {refNames.length > 1 && <th>Reference</th>}
              <th className="num">Reads</th>
              <th>Verdict</th>
              <th className="num" title="Share of the construct covered as set above">Covered</th>
              <th className="num" title="Fewest reads over any base of the features checked">Lowest depth</th>
              <th>Differences from the design</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className="ao-static"><td colSpan={8} className="aw-muted">No clone here.</td></tr>
            )}
            {shown.map(r => {
              const v = r.report
              const diffs = v?.differences.map(d => describeDifference(d)) ?? []
              const contig = contigs.find(c => c.id === r.contigId)!
              const edited = contig.undoStack.length > 0 || contig.doc.rows.some(x => x.seq !== x.orig)
              return (
                <tr key={r.contigId} onClick={() => useEditorStore.getState().setActiveContig(r.contigId)} title="Open the contig">
                  <td className="rs-name">
                    {r.name}
                    {edited && <span className="ao-tag">edited</span>}
                  </td>
                  {refNames.length > 1 && <td className="rs-name">{r.reference ?? ''}</td>}
                  <td className="num">{nf.format(r.reads)}</td>
                  <td>{v ? <span className={`cw-status ${v.verdict}`}>{STATUS_LABEL[v.verdict]}</span> : <span className="aw-muted">No reference</span>}</td>
                  <td className="num">{v ? pct(v.covered) : ''}</td>
                  <td className="num">{v ? (lowestDepth(v) ?? '') : ''}</td>
                  <td className="ao-why" title={diffs.join('\n')}>
                    {diffs.slice(0, 2).join('; ')}{diffs.length > 2 ? `; and ${diffs.length - 2} more` : ''}
                  </td>
                  <td className="ao-actions" onClick={e => e.stopPropagation()}>
                    {several && (
                      <button className="aw-icon-btn" onClick={() => useEditorStore.getState().extractContig(r.contigId)}
                        title="Move to an assembly of its own" aria-label={`Move ${r.name} to an assembly of its own`}>
                        <SquareArrowOutUpRight size={13} />
                      </button>
                    )}
                    <button className="aw-icon-btn" onClick={() => useEditorStore.getState().removeContig(r.contigId)}
                      title={several ? 'Delete the contig' : 'Delete the contig, and with it the assembly'} aria-label={`Delete ${r.name}`}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
