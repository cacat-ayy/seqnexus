/**
 * An editing analysis, shown.
 *
 * The spectrum is a bar per length change, because the shape of it is the
 * finding: one tall bar at a single length is a clean edit, a spread is a
 * pool, and a tall bar at zero is an experiment that did not work. The
 * numbers under it are deliberately few, and the quality of the reading sits
 * among them rather than in a footnote, since a high percentage from a poor
 * fit is not a result.
 */

import { ClipboardCopy } from 'lucide-react'
import { spectrumOf, headlineOf, type EditingAnalysis } from '../../crispr/analysis/types'
import { spectrumCsv } from '../../crispr/analysis/decompose'
import { alleleCsv } from '../../crispr/analysis/alleles'
import { notify } from '../../toast'

interface Props {
  analysis: EditingAnalysis
}

const CHART_HEIGHT = 70

export default function AnalysisResult({ analysis }: Props) {
  const spectrum = spectrumOf(analysis).filter(s => s.fraction > 0.001)
  const headline = headlineOf(analysis)
  const peak = Math.max(0.01, ...spectrum.map(s => s.fraction))
  const warnings = analysis.kind === 'traces' ? analysis.result.warnings : []

  const copy = () => {
    const text = analysis.kind === 'traces' ? spectrumCsv(analysis.result) : alleleCsv(analysis.table)
    navigator.clipboard.writeText(text)
      .then(() => notify.success('Result copied'))
      .catch(() => notify.error('Could not copy the result'))
  }

  return (
    <div className="gi">
      <div className="gi-head">
        <span className="gi-title">
          {analysis.kind === 'traces' ? 'From the traces' : 'From the reads'}
        </span>
        <div className="gi-actions">
          <button className="btn btn-sm" onClick={copy}>
            <ClipboardCopy size={12} /> Table
          </button>
        </div>
      </div>

      <p className="gi-caveat">
        {analysis.source.description}
        {analysis.kind === 'reads' && analysis.sample.sampled && (
          <> {analysis.sample.used.toLocaleString()} reads of {analysis.sample.available.toLocaleString()} were looked at.</>
        )}
      </p>

      <div className="ca-numbers">
        {headline.map(n => (
          <div key={n.label} className="ca-number" title={n.title}>
            <span className="ca-number-value">{n.value}</span>
            <span className="ca-number-label">{n.label}</span>
          </div>
        ))}
      </div>

      {spectrum.length > 0 && (
        <div className="ca-chart">
          <svg viewBox={`0 0 ${spectrum.length * 10} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            {spectrum.map((bar, i) => {
              const height = Math.max(1, (bar.fraction / peak) * (CHART_HEIGHT - 14))
              return (
                <rect
                  key={bar.size}
                  className={`ca-bar${bar.size === 0 ? ' zero' : bar.size % 3 !== 0 ? ' shift' : ''}`}
                  x={i * 10 + 1.5}
                  y={CHART_HEIGHT - 12 - height}
                  width={7}
                  height={height}
                />
              )
            })}
          </svg>
          <div className="ca-axis">
            {spectrum.map(bar => (
              <span key={bar.size} className={bar.size === 0 ? 'ca-tick zero' : 'ca-tick'}>
                {bar.size > 0 ? `+${bar.size}` : bar.size}
              </span>
            ))}
          </div>
          <div className="ca-legend">
            Length change, with the bars that shift the reading frame marked.
          </div>
        </div>
      )}

      {analysis.kind === 'reads' && analysis.table.alleles.length > 0 && (
        <div className="gi-section">
          <div className="gi-section-title">Alleles</div>
          <table className="gi-deletions">
            <thead>
              <tr>
                <th>Share</th>
                <th>Change</th>
                <th>Reads</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {analysis.table.alleles.slice(0, 8).map((allele, i) => (
                <tr key={i}>
                  <td>{(allele.fraction * 100).toFixed(1)}%</td>
                  <td className={allele.frameshift ? 'gi-shift' : undefined}>
                    {allele.kind === 'unmodified'
                      ? 'none'
                      : allele.indel !== 0
                        ? `${allele.indel > 0 ? '+' : ''}${allele.indel}${allele.frameshift ? ', shifts' : ''}`
                        : `${allele.substitutions} substituted`}
                  </td>
                  <td>{allele.reads.toLocaleString()}</td>
                  <td className="gi-mh ca-window">{allele.sequence.slice(0, 24)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(analysis.table.skipped.tooShort > 0 || analysis.table.skipped.unaligned > 0) && (
            <p className="gi-caveat">
              {analysis.table.skipped.tooShort.toLocaleString()} reads did not span the window and{' '}
              {analysis.table.skipped.unaligned.toLocaleString()} did not match the amplicon. Neither was counted.
            </p>
          )}
        </div>
      )}

      {analysis.kind === 'reads' && analysis.conversion && (
        <div className="gi-section">
          <div className="gi-section-title">Changed bases</div>
          <table className="gi-deletions">
            <tbody>
              {analysis.conversion
                .filter(row => Object.keys(row.converted).length > 0)
                .slice(0, 10)
                .map(row => (
                  <tr key={row.position}>
                    <td>{row.position + 1}</td>
                    <td className="gi-mh">{row.reference}</td>
                    <td>
                      {Object.entries(row.converted)
                        .sort((a, b) => b[1] - a[1])
                        .map(([base, share]) => `${base} ${(share * 100).toFixed(1)}%`)
                        .join(', ')}
                    </td>
                    <td>{row.depth.toLocaleString()} deep</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {warnings.map(w => (
        <p key={w} className="gi-flag"><span className="gp-chip">note</span> {w}</p>
      ))}
    </div>
  )
}
