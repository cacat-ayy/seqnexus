/**
 * The verdicts of a whole-plasmid sequencing result, one card per sample:
 * whether it is the construct, whether the tube looks mixed, how the
 * consensus was turned onto the construct, every difference with what it
 * does, and what to do next. The record is the one kept when the drop was
 * verified (plasmidverify/result.ts); the alignment of each consensus is
 * its contig, a click away. Exports a PDF report and a CSV, per sample and
 * for the whole drop.
 */

import './PlasmidVerify.css'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Download, FileText, Layers, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useEditorStore, type Assembly, type Contig } from '../../store'
import { notify } from '../../toast'
import { describeChange, STATUS_LABEL } from '../../assembly/verify'
import { allCoding, codingLabel } from '../../assembly/effects'
import { variantKey } from '../../assembly/variants'
import { nextStep, plasmidCsv, rotationText, sampleCsv, type PlasmidSample, type PlasmidVerification } from '../../plasmidverify/result'
import { downloadBlob, saveText } from '../../utils/download'
import { notifyFigureSaved } from '../../utils/cite-notice'
import { plasmidReportPdf } from './report'

const nf = new Intl.NumberFormat('en-US')
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`
const fileStem = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')

interface Props {
  assembly: Assembly
  plasmid: PlasmidVerification
  contigs: readonly Contig[]
}

function savePdf(name: string, v: PlasmidVerification, only?: PlasmidSample) {
  const file = `${fileStem(only ? only.name : name)}_verification.pdf`
  try {
    downloadBlob(new Blob([plasmidReportPdf(name, v, only) as BlobPart], { type: 'application/pdf' }), file)
    notifyFigureSaved(file)
  } catch (err) {
    notify.error('Could not make the PDF', { detail: err instanceof Error ? err.message : String(err) })
  }
}

function ExportMenu({ label, items }: { label: string; items: { label: string; desc?: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <div className="aw-export" ref={ref}>
      <button className="aw-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={label}>
        <Download size={13} /> Export <ChevronDown size={12} />
      </button>
      {open && (
        <div className="aw-menu" role="menu">
          {items.map(it => (
            <button key={it.label} role="menuitem" className="aw-menu-item" onClick={() => { setOpen(false); it.run() }}>
              <span className="aw-menu-label">{it.label}</span>
              {it.desc && <span className="aw-menu-desc">{it.desc}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SampleCard({ s, assembly, plasmid, contig }: { s: PlasmidSample; assembly: Assembly; plasmid: PlasmidVerification; contig: Contig | undefined }) {
  const tabs = useEditorStore(st => st.tabs)
  const mapping = useEditorStore(st => (s.reads ? st.assemblies.find(a => a.id === s.reads!.mappingId) ?? null : null))
  const tab = s.construct.tabId ? tabs.find(t => t.id === s.construct.tabId) : undefined
  const r = s.report
  const low = new Map(s.lowConfidence.map(x => [x.key, x.reason]))
  const Icon = r.verdict === 'verified' ? ShieldCheck : ShieldAlert
  const sitesAt = new Map(s.mixed.sites.map(m => [m.position, m]))
  return (
    <section className="pv-card" aria-label={`${s.name}: ${STATUS_LABEL[r.verdict]}`}>
      <header className="pv-card-head">
        <Icon size={16} className={`pv-icon ${r.verdict}`} aria-hidden />
        <h3 className="pv-name">{s.name}</h3>
        <span className="aw-muted">against</span>
        <span className="pv-construct">{s.construct.name}</span>
        <span className={`cw-status ${r.verdict}`}>{STATUS_LABEL[r.verdict]}</span>
        {s.mixed.flagged && <span className="pv-flag" title="Some positions are read as two bases: more than one plasmid in the tube"><TriangleAlert size={12} /> Mixed population</span>}
        <span className="aw-spacer" />
        <ExportMenu label={`Export ${s.name}`} items={[
          { label: 'Report as PDF', desc: 'This sample\'s verdict and differences', run: () => savePdf(assembly.name, plasmid, s) },
          { label: 'Report as CSV', desc: 'The verdict, then a row per feature and per difference', run: () => saveText(sampleCsv(s), `${fileStem(s.name)}_verification.csv`, 'text/csv') },
        ]} />
      </header>

      <p className="pv-next">{nextStep(s)}</p>

      <dl className="pv-facts">
        <div><dt>Evidence</dt><dd>{s.tier === 'reads' && s.reads
          ? `${nf.format(s.reads.mapped)} reads mapped, ${Math.round(s.reads.meanDepth)}x mean, ${s.reads.minDepth}x lowest`
          : 'The consensus, aligned to the construct'}</dd></div>
        <div><dt>Rotation</dt><dd>{rotationText(s)}</dd></div>
        <div><dt>Identity</dt><dd>{pct(s.identity)} · {nf.format(s.consensusLength)} bp consensus, {nf.format(s.construct.length)} bp construct</dd></div>
        <div><dt>Files</dt><dd className="pv-files">{s.files.join(', ')}</dd></div>
        {s.closeTo.length > 0 && <div><dt>Close call</dt><dd>{s.closeTo.join(', ')} matched almost as well; chosen by aligning to each</dd></div>}
      </dl>

      {s.readsNote && <p className="aw-note ngs-warn-note pv-reads-note">{s.readsNote}</p>}

      {r.differences.length > 0 ? (
        <div className="ao-table-wrap">
          <table className="rs-table ao-table pv-table" aria-label={`Differences of ${s.name}`}>
            <thead>
              <tr>
                <th className="num">Position</th>
                <th>Change</th>
                <th className="num">{s.tier === 'reads' ? 'Reads' : 'From'}</th>
                <th>Feature</th>
                <th>Protein</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {r.differences.map(d => {
                const k = variantKey(d)
                const m = sitesAt.get(d.position)
                return (
                  <tr key={k} className="ao-static">
                    <td className="num">{nf.format(d.position)}</td>
                    <td className="pv-mono">{describeChange(d)}</td>
                    <td className="num">{s.tier === 'reads' ? `${Math.round(d.frequency * 100)}% of ${nf.format(d.coverage)}` : 'consensus'}</td>
                    <td>{d.features.join(', ')}</td>
                    <td>{allCoding(d).map(c => `${c.feature}: ${codingLabel(c)}`).join('; ')}</td>
                    <td className="pv-note">{[low.get(k), m ? `mixed: ${m.change} ${Math.round(m.fraction * 100)}%` : ''].filter(Boolean).join('; ')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="aw-muted pv-none">No differences from the construct.</p>}

      {s.mixed.sites.length > 0 && (
        <p className="pv-mixed">
          <b>Mixed positions</b> ({s.mixed.source === 'reads' ? 'from the reads' : 'from the chromatogram'}):{' '}
          {s.mixed.sites.slice(0, 12).map(m => `${nf.format(m.position)} ${m.change} ${Math.round(m.fraction * 100)}%${m.depth !== null ? ` of ${nf.format(m.depth)}` : ''}`).join('; ')}
          {s.mixed.sites.length > 12 ? `; and ${s.mixed.sites.length - 12} more` : ''}
        </p>
      )}

      <div className="pv-actions">
        <button className="aw-btn" disabled={!contig} onClick={() => contig && useEditorStore.getState().setActiveContig(contig.id)}
          title={contig ? 'The consensus aligned to the construct, base by base' : 'The alignment has been deleted'}>
          <Layers size={13} /> Alignment
        </button>
        {s.reads && (
          <button className="aw-btn" disabled={!mapping} onClick={() => mapping && useEditorStore.getState().setActiveAssembly(mapping.id)}
            title={mapping ? 'The reads mapped to the construct' : 'The mapping has been deleted'}>
            <FileText size={13} /> Reads
          </button>
        )}
        <button className="aw-btn" disabled={!tab} onClick={() => tab && useEditorStore.getState().setActiveTab(tab.id)}
          title={tab ? `Open ${s.construct.name}` : `${s.construct.name} is no longer open`}>
          {s.construct.name}
        </button>
      </div>
    </section>
  )
}

export default function PlasmidVerifyPage({ assembly, plasmid, contigs }: Props) {
  const samples = plasmid.samples
  const count = (k: PlasmidSample['report']['verdict']) => samples.filter(s => s.report.verdict === k).length
  const byId = new Map(contigs.map(c => [c.id, c]))
  const stem = fileStem(assembly.name)
  return (
    <div className="pv-page">
      <div className="pv-summary">
        <div className="pv-tiles" role="list" aria-label="Summary">
          <div className="pv-tile" role="listitem"><span className="pv-tile-n">{nf.format(samples.length + plasmid.unmatched.length)}</span><span className="pv-tile-l">{samples.length + plasmid.unmatched.length === 1 ? 'sample' : 'samples'}</span></div>
          <div className="pv-tile verified" role="listitem"><span className="pv-tile-n">{nf.format(count('verified'))}</span><span className="pv-tile-l">verified</span></div>
          <div className="pv-tile differences" role="listitem"><span className="pv-tile-n">{nf.format(count('differences'))}</span><span className="pv-tile-l">differences found</span></div>
          <div className="pv-tile incomplete" role="listitem"><span className="pv-tile-n">{nf.format(count('incomplete'))}</span><span className="pv-tile-l">not fully covered</span></div>
          <div className="pv-tile mixed" role="listitem"><span className="pv-tile-n">{nf.format(samples.filter(s => s.mixed.flagged).length)}</span><span className="pv-tile-l">mixed</span></div>
        </div>
        <span className="aw-spacer" />
        <ExportMenu label="Export all samples" items={[
          { label: 'Report as PDF', desc: 'Every sample: verdict, differences, mixed positions, how it was checked', run: () => savePdf(assembly.name, plasmid) },
          { label: 'Summary as CSV', desc: 'A row per sample, then a row per difference', run: () => saveText(plasmidCsv(plasmid), `${stem}_verification.csv`, 'text/csv') },
        ]} />
      </div>

      {samples.map(s => <SampleCard key={s.contigId} s={s} assembly={assembly} plasmid={plasmid} contig={byId.get(s.contigId)} />)}

      {plasmid.unmatched.length > 0 && (
        <section className="pv-card" aria-label="Samples not verified">
          <header className="pv-card-head"><ShieldAlert size={16} className="pv-icon incomplete" aria-hidden /><h3 className="pv-name">Not verified</h3></header>
          <ul className="pv-unmatched">
            {plasmid.unmatched.map(u => (
              <li key={u.name}><b>{u.name}</b>: {u.reason}</li>
            ))}
          </ul>
          <p className="aw-note">
            Open the construct it was meant to be and drop the files again, or import the reads and use Assemble NGS Reads de novo
            (command palette) to see what the tube holds.
          </p>
        </section>
      )}
    </div>
  )
}
