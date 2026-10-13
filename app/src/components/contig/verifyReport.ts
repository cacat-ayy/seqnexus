/**
 * One clone's verification as a PDF: the verdict, how much was covered, a
 * row per feature and one per difference from the design. Written by the
 * shared report writer, like the plate's report (plateReport.ts), for the
 * Sanger contig's and the NGS sample's Verify dialogs.
 */

import { writeReportPdf, type ReportBlock } from '../../pdf/report-pdf'
import { describeChange, describeDifference, STATUS_LABEL, type VerifyReport } from '../../assembly/verify'
import { allCoding, codingLabel } from '../../assembly/effects'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

export function verifyReportPdf(r: VerifyReport, readsName: string, date = new Date()): Uint8Array {
  const gaps = r.uncovered.map(g => (g.from === g.to ? `${g.from}` : `${g.from}-${g.to}`)).join(', ')
  const covered = `${pct(r.covered)} of ${nf.format(r.reference.length)} bp covered`
    + `${r.settings.minDepth > 1 ? ` by at least ${r.settings.minDepth} reads` : ''}${r.settings.bothStrands ? ' on both strands' : ''}.`
  const blocks: ReportBlock[] = [
    {
      kind: 'tiles',
      tiles: [
        { label: 'Verdict', value: STATUS_LABEL[r.verdict] },
        { label: 'Covered', value: pct(r.covered) },
        { label: 'Both strands', value: pct(r.bothStrands) },
        { label: 'Reads', value: nf.format(r.reads) },
      ],
    },
    { kind: 'note', text: `${covered} ${r.differences.length ? `${r.differences.length} difference${r.differences.length === 1 ? '' : 's'} from the design.` : 'No differences from the design.'}` },
    ...(gaps ? [{ kind: 'note' as const, text: `Not covered: ${gaps}` }] : []),
  ]
  if (r.features.length) {
    blocks.push(
      { kind: 'heading', text: 'Features' },
      {
        kind: 'table',
        columns: [
          { label: 'Feature' }, { label: 'Type' }, { label: 'Status' }, { label: 'Length', numeric: true },
          { label: 'Covered', numeric: true }, { label: 'Both strands', numeric: true }, { label: 'Lowest depth', numeric: true }, { label: 'Differences' },
        ],
        rows: r.features.map(f => [
          f.feature.name, f.feature.type, STATUS_LABEL[f.status], nf.format(f.length), pct(f.covered), pct(f.bothStrands),
          String(f.minDepth), f.differences.map(d => describeDifference(d, f.feature)).join('; '),
        ]),
      },
    )
  }
  if (r.differences.length) {
    blocks.push(
      { kind: 'heading', text: 'Differences' },
      {
        kind: 'table',
        columns: [
          { label: 'Position', numeric: true }, { label: 'Change' }, { label: 'Reads', numeric: true }, { label: 'Coverage', numeric: true },
          { label: 'P-value', numeric: true }, { label: 'Features' }, { label: 'Protein' },
        ],
        rows: r.differences.map(v => [
          String(v.position), describeChange(v), `${Math.round(v.frequency * 100)}%`, String(v.coverage), v.pValue.toExponential(1),
          v.features.join(', '), allCoding(v).map(c => `${c.feature}: ${codingLabel(c)}`).join('; '),
        ]),
      },
    )
  }
  return writeReportPdf({
    title: `${r.reference.name}: clone verification`,
    subtitle: `${readsName}, ${nf.format(r.reads)} reads. Made with SeqNexus on ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    blocks,
  })
}
