/**
 * A plate's verification as a PDF: the counts, one row per clone, every
 * difference from the designs, and how it was checked. Laid out by the
 * shared report writer (pdf/report-pdf.ts), so it pages and repeats table
 * headers on its own.
 */

import { writeReportPdf, type ReportBlock } from '../../pdf/report-pdf'
import { failedFeatures, lowestDepth, plateCounts, type CloneResult, type PlateVerifySettings } from '../../assembly/plate'
import { describeChange, STATUS_LABEL } from '../../assembly/verify'
import { codingLabel } from '../../assembly/effects'
import { describeGrouping, type NameGrouping } from '../../assembly/groups'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

export function plateReportPdf(o: {
  name: string
  results: readonly CloneResult[]
  settings: PlateVerifySettings
  grouping: NameGrouping | null
  references: readonly string[]
  date?: Date
}): Uint8Array {
  const { results, settings: s } = o
  const counts = plateCounts(results)
  const blocks: ReportBlock[] = [
    {
      kind: 'tiles',
      tiles: [
        { label: 'Clones', value: nf.format(counts.all) },
        { label: 'Verified', value: nf.format(counts.verified), detail: counts.all ? pct(counts.verified / counts.all) : undefined },
        { label: 'Differences found', value: nf.format(counts.differences) },
        { label: 'Not fully covered', value: nf.format(counts.incomplete) },
      ],
    },
    { kind: 'heading', text: 'Clones' },
    {
      kind: 'table',
      columns: [
        { label: 'Clone' }, { label: 'Reference' }, { label: 'Verdict' }, { label: 'Reads', numeric: true },
        { label: 'Covered', numeric: true }, { label: 'Lowest depth', numeric: true }, { label: 'Not verified' },
      ],
      rows: results.map(r => {
        const v = r.report
        return [
          r.name, r.reference ?? '', v ? STATUS_LABEL[v.verdict] : 'Not mapped', nf.format(r.reads),
          v ? pct(v.covered) : '', v ? String(lowestDepth(v) ?? '') : '', v ? failedFeatures(v) : '',
        ]
      }),
    },
  ]
  const diffs = results.flatMap(r => (r.report?.differences ?? []).map(d => ({ r, d })))
  if (diffs.length) {
    blocks.push(
      { kind: 'heading', text: 'Differences from the designs' },
      {
        kind: 'table',
        columns: [{ label: 'Clone' }, { label: 'Position', numeric: true }, { label: 'Change' }, { label: 'Reads', numeric: true }, { label: 'Feature' }, { label: 'Protein' }],
        rows: diffs.map(({ r, d }) => [
          r.name, nf.format(d.position), describeChange(d), `${Math.round(d.frequency * 100)}% of ${d.coverage}`,
          d.features.join(', '), d.coding ? codingLabel(d.coding) : '',
        ]),
      },
    )
  }
  blocks.push(
    { kind: 'heading', text: 'How it was checked' },
    {
      kind: 'facts',
      items: [
        { term: 'Verified', text: 'Every feature checked is covered from end to end and the reads\' consensus matches the design there. A construct with no feature to check is checked whole.' },
        { term: 'Covered means', text: `At least ${s.minDepth} ${s.minDepth === 1 ? 'read' : 'reads'} over each base${s.bothStrands ? ', with reads on both strands' : ''}.` },
        { term: 'Not checked', text: s.skipTypes.length ? `Features of type ${s.skipTypes.join(', ')}.` : 'Every feature is checked.' },
        { term: 'Differences', text: 'Positions where at least half of the reads disagree with the design, with what that does to a protein.' },
        ...(o.grouping ? [{ term: 'Clones', text: `Reads grouped by ${describeGrouping(o.grouping)}.` }] : []),
        ...(o.references.length ? [{ term: o.references.length === 1 ? 'Reference' : 'References', text: o.references.length === 1 ? o.references[0] : `${o.references.join(', ')}; each clone mapped to the one its reads match best.` }] : []),
      ],
    },
  )
  return writeReportPdf({
    title: `${o.name}: clone verification`,
    subtitle: `${nf.format(counts.all)} clones · ${(o.date ?? new Date()).toISOString().slice(0, 10)}`,
    blocks,
  })
}
