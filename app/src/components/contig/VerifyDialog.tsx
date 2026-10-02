/**
 * Clone verification report for a contig mapped to its designed construct:
 * a verdict, coverage of the construct and of each feature, and every
 * difference from the design with what it does to a protein. Settings on
 * the right recompute the report live; it saves as CSV or prints to PDF.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCopy, Download, Printer, ShieldCheck, Tag, X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { notify } from '../../toast'
import { copyText } from '../../utils/clipboard'
import { downloadText } from '../../utils/download'
import type { ContigDoc } from '../../assembly/types'
import type { RefFeature, Variant } from '../../assembly/variants'
import {
  DEFAULT_VERIFY, describeChange, describeDifference, STATUS_LABEL, verifyClone, verifyCsv, verifyHtml, type VerifySettings,
} from '../../assembly/verify'

interface Props {
  doc: ContigDoc
  name: string
  consensus: string
  features: RefFeature[]
  canAnnotate: boolean
  onAnnotate: (differences: Variant[]) => void
  onGoto: (v: Variant) => void
  onClose: () => void
  onExportPrompt?: (defaultName: string, onConfirm: (name: string) => void) => void
}

const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

export default function VerifyDialog({ doc, name, consensus, features, canAnnotate, onAnnotate, onGoto, onClose, onExportPrompt }: Props) {
  const checkable = useMemo(() => features.filter(f => f.type !== 'source'), [features])
  const [settings, setSettings] = useState<VerifySettings>(() => ({
    ...DEFAULT_VERIFY,
    // By default check what matters in a construct: coding and regulatory features, not primer sites.
    featureIds: checkable.filter(f => f.type !== 'primer_bind' && f.type !== 'misc_feature').map(f => f.id),
  }))
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, true)
  const report = useMemo(() => verifyClone(doc, consensus, features, settings), [doc, consensus, features, settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!report) return null
  const base = name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_')
  const save = (text: string, def: string, mime?: string) => {
    const run = (n: string) => downloadText(text, n, mime)
    if (onExportPrompt) onExportPrompt(def, run)
    else run(def)
  }
  const print = () => {
    const w = window.open('', '_blank')
    if (!w) { notify.error('Could not open the print window', { detail: 'Allow pop-ups for this site to save a PDF.' }); return }
    w.document.write(verifyHtml(report, name).replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body>'))
    w.document.close()
  }
  const summary = () => [
    `${report.reference.name}: ${STATUS_LABEL[report.verdict]}`,
    `${pct(report.covered)} covered, ${pct(report.bothStrands)} on both strands, ${report.reads} reads`,
    ...report.features.map(f => `${f.feature.name}: ${STATUS_LABEL[f.status]}${f.differences.length ? ` (${f.differences.map(describeDifference).join('; ')})` : ''}`),
  ].join('\n')
  const toggle = (id: string) => setSettings(s => {
    const ids = new Set(s.featureIds ?? checkable.map(f => f.id))
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ...s, featureIds: [...ids] }
  })
  const chosen = new Set(settings.featureIds ?? checkable.map(f => f.id))
  const gaps = report.uncovered.map(g => (g.from === g.to ? `${g.from}` : `${g.from.toLocaleString()}–${g.to.toLocaleString()}`))

  return (
    <div className="aw-figure-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="aw-figure cw-verify" ref={ref} role="dialog" aria-modal="true" aria-label="Clone verification">
        <div className="aw-popover-head">
          <ShieldCheck size={14} /> <span>Clone verification · {report.reference.name}</span>
          <button className="aw-icon-btn" onClick={onClose} aria-label="Close"><X size={14} /></button>
        </div>
        <div className="aw-figure-body">
          <div className="cw-verify-report">
            <span className={`cw-verdict ${report.verdict}`}>{STATUS_LABEL[report.verdict]}</span>
            <p>
              {pct(report.covered)} of {report.reference.length.toLocaleString()} bp covered
              {settings.minDepth > 1 ? ` by at least ${settings.minDepth} reads` : ''}{settings.bothStrands ? ' on both strands' : ''};
              {' '}{pct(report.bothStrands)} read on both strands, from {report.reads} reads.
              {' '}{report.differences.length ? `${report.differences.length} ${report.differences.length === 1 ? 'difference' : 'differences'} from the design.` : 'No differences from the design.'}
            </p>
            {gaps.length > 0 && <p className="aw-muted">Not covered: {gaps.slice(0, 12).join(', ')}{gaps.length > 12 ? `, and ${gaps.length - 12} more` : ''}</p>}

            {report.features.length > 0 && (
              <>
                <h3>Features</h3>
                <table className="rs-table">
                  <thead><tr><th>Feature</th><th>Status</th><th className="num">Length</th><th className="num">Covered</th><th className="num">Both strands</th><th className="num">Lowest depth</th><th>Differences</th></tr></thead>
                  <tbody>
                    {report.features.map(f => (
                      <tr key={f.feature.id}>
                        <td className="rs-name" title={f.feature.type}>{f.feature.name}</td>
                        <td><span className={`cw-status ${f.status}`}>{STATUS_LABEL[f.status]}</span></td>
                        <td className="num">{f.length.toLocaleString()}</td>
                        <td className="num">{pct(f.covered)}</td>
                        <td className="num">{pct(f.bothStrands)}</td>
                        <td className="num">{f.minDepth}</td>
                        <td className="rs-issues" title={f.differences.map(describeDifference).join('\n')}>{f.differences.map(describeDifference).join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {report.differences.length > 0 && (
              <>
                <h3>Differences from the design</h3>
                <table className="rs-table">
                  <thead><tr><th className="num">Position</th><th>Change</th><th className="num">Reads</th><th className="num">P-value</th><th>Feature</th><th>Protein</th></tr></thead>
                  <tbody>
                    {report.differences.map((v, i) => (
                      <tr key={i} onClick={() => onGoto(v)} title="Show it in the contig" style={{ cursor: 'pointer' }}>
                        <td className="num">{v.position.toLocaleString()}</td>
                        <td className="cw-base">{describeChange(v)}</td>
                        <td className="num">{Math.round(v.frequency * 100)}% of {v.coverage}</td>
                        <td className="num" title={v.pValue > 1e-4 ? 'Low confidence: check the traces' : undefined}>{v.pValue.toExponential(1)}{v.pValue > 1e-4 ? ' ⚠' : ''}</td>
                        <td>{v.features.join(', ')}</td>
                        <td>{v.coding ? `${v.coding.protein} (${v.coding.effect.toLowerCase()})` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>

          <div className="aw-figure-options aw-stack">
            <div className="aw-section-label">Covered means</div>
            <label className="aw-field">
              <span>At least this many reads</span>
              <select className="select aw-select-full" value={settings.minDepth} onChange={e => setSettings(s => ({ ...s, minDepth: Number(e.target.value) }))}>
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="aw-check small">
              <input type="checkbox" checked={settings.bothStrands} onChange={e => setSettings(s => ({ ...s, bothStrands: e.target.checked }))} />
              Read on both strands
            </label>
            <div className="aw-section-label">Features to check</div>
            {checkable.length === 0
              ? <p className="aw-note">The reference has no features, so the whole construct is checked.</p>
              : (
                <div className="cw-feature-list">
                  {checkable.map(f => (
                    <label key={f.id} className="aw-check small" title={`${f.type} · ${f.start + 1}–${f.end}`}>
                      <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} />
                      {f.name} <span className="aw-muted">({f.type})</span>
                    </label>
                  ))}
                </div>
              )}
            <div className="aw-section-label">Save</div>
            <div className="aw-actions">
              <button className="aw-action" onClick={print}><Printer size={13} /> Print or save as PDF</button>
              <button className="aw-action" onClick={() => save(verifyCsv(report), `${base}_verification.csv`, 'text/csv')}><Download size={13} /> CSV</button>
              <button className="aw-action" onClick={() => copyText(summary(), 'Copied the summary')}><ClipboardCopy size={13} /> Copy summary</button>
              <button className="aw-action" disabled={!canAnnotate || !report.differences.length} onClick={() => onAnnotate(report.differences)}
                title={canAnnotate ? 'Add a "variation" feature for each difference to the construct' : 'Open the construct to annotate it'}>
                <Tag size={13} /> Annotate differences on the construct
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
