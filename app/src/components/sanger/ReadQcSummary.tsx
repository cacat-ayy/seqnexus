/**
 * A read's QC at a glance: verdict, the three numbers a sequencing core
 * reports (trace score, contiguous read length, QV20+), what is wrong when
 * something is, and where the read came from.
 */

import './ReadQcSummary.css'
import { runLine, type TraceData } from '../../io/trace'
import { readQc, VERDICT_LABEL } from '../../sanger/qc'

const nf = new Intl.NumberFormat()

export default function ReadQcSummary({ data, compact = false }: { data: TraceData; compact?: boolean }) {
  const qc = readQc(data)
  const run = runLine(data)
  return (
    <div className={`read-qc${compact ? ' compact' : ''}`}>
      <div className="read-qc-head">
        <span className={`read-qc-verdict ${qc.verdict}`}>{VERDICT_LABEL[qc.verdict]}</span>
        <dl className="read-qc-metrics">
          <div title="Mean quality after quality trimming">
            <dt>{compact ? 'Score' : 'Trace score'}</dt>
            <dd>{qc.traceScore === null ? '–' : Math.round(qc.traceScore)}</dd>
          </div>
          <div title="Contiguous read length: longest stretch where every 20-base window averages Q20 or better">
            <dt>CRL</dt>
            <dd>{data.metadata.qualityMissing ? '–' : nf.format(qc.crl.length)}</dd>
          </div>
          <div title="Bases called at Q20 or better">
            <dt>QV20+</dt>
            <dd>{data.metadata.qualityMissing ? '–' : nf.format(qc.qv20)}</dd>
          </div>
        </dl>
      </div>
      {qc.issues.length > 0 && (
        <ul className="read-qc-issues">
          {qc.issues.slice(0, compact ? 2 : undefined).map(issue => <li key={issue}>{issue}</li>)}
        </ul>
      )}
      {run && <div className="read-qc-run">{run}</div>}
    </div>
  )
}
