/**
 * The report of an NGS mapping as a PDF: the same figures, table, charts
 * and account of how it was made as the Report page (MappingReport.tsx),
 * laid out for paper by pdf/report-pdf.ts.
 */

import type { NgsMapping } from '../../assembly/container'
import type { MappingReport } from '../../ngs/builder'
import { PRESET_LABEL } from '../../ngs/mapper'
import { formatBytes } from '../../utils/format'
import { MIN_BASE_QUALITY, MIN_INDEL_FRACTION, MIN_SNV_FRACTION } from '../../ngs/pileup'
import { writeReportPdf, type ReportBlock, type ReportTile } from '../../pdf/report-pdf'

const nf = new Intl.NumberFormat()
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

/** The program that aligned the reads, as the report states it. */
export function mapperText(r: MappingReport): string {
  return r.importedFrom
    ? `${r.program.name}${r.program.version ? ` ${r.program.version}` : ''}, imported from ${r.importedFrom}`
    : `minimap2 2.22, ${r.preset ? PRESET_LABEL[r.preset] : ''}, primary and supplementary alignments, no secondary`
}

/** The alignments left out, or '' when none were. */
export function skippedText(r: MappingReport): string {
  return [
    r.skipped.secondary ? `${nf.format(r.skipped.secondary)} secondary` : '',
    r.skipped.otherReference ? `${nf.format(r.skipped.otherReference)} on references not given` : '',
  ].filter(Boolean).join(', ')
}

export const COVERAGE_NOTE = 'Aligned bases of every alignment, whatever its mapping quality; deletions not counted.'

export function sitesNote(): string {
  return `Positions where at least two reads, and ${Math.round(MIN_SNV_FRACTION * 100)}% of the reads there (${Math.round(MIN_INDEL_FRACTION * 100)}% for `
    + `insertions and deletions), differ from the reference; bases below Q${MIN_BASE_QUALITY} not counted.`
}

export function mappingReportPdf(ngs: NgsMapping, opts: { title: string; readsName: string }): Uint8Array {
  const r = ngs.report
  const one = r.references.length === 1 ? r.references[0] : null
  const stored = r.version === 2

  const tiles: ReportTile[] = [{ label: 'Reads mapped', value: pct(r.reads ? r.mapped / r.reads : 0), detail: `${nf.format(r.mapped)} of ${nf.format(r.reads)}` }]
  if (r.properlyPaired !== null) tiles.push({ label: 'Properly paired', value: pct(r.properlyPaired), detail: 'of mapped reads' })
  if (one) {
    tiles.push({ label: 'Mean depth', value: `${one.meanDepth.toFixed(1)}×` })
    tiles.push({ label: 'Covered', value: pct(one.breadth1), detail: `${pct(one.breadth10)} at 10× or more` })
  }

  const blocks: ReportBlock[] = [
    { kind: 'tiles', tiles },
    { kind: 'heading', text: 'References' },
    {
      kind: 'table',
      columns: [
        { label: 'Reference' }, { label: 'Length', numeric: true }, { label: 'Reads', numeric: true },
        { label: 'Mean depth', numeric: true }, { label: 'Covered', numeric: true }, { label: 'At 10×+', numeric: true },
        ...(stored ? [{ label: 'Sites', numeric: true }] : []),
      ],
      rows: r.references.map(x => [
        `${x.name}${x.circular ? ' (circular)' : ''}`, `${nf.format(x.length)} bp`, nf.format(x.mappedReads),
        `${x.meanDepth.toFixed(1)}×`, pct(x.breadth1), pct(x.breadth10),
        ...(stored ? [nf.format(x.sites)] : []),
      ]),
    },
    { kind: 'heading', text: 'Coverage and quality' },
  ]
  for (const x of r.references) {
    blocks.push({
      kind: 'histogram', title: `Coverage along ${x.name}`, subtitle: `Mean depth in ${nf.format(x.binSize)} bp windows`,
      edges: [...x.coverageBins.map((_, i) => i * x.binSize + 1), x.length + 1], counts: x.coverageBins,
    })
  }
  if (r.insertSizes && r.insertSizes.counts.length > 0) {
    blocks.push({ kind: 'histogram', title: 'Fragment length', subtitle: 'Proper pairs, outer distance between the mates (bp)', edges: r.insertSizes.edges, counts: r.insertSizes.counts })
  }
  if (r.mapq.counts.length > 0) {
    blocks.push({ kind: 'histogram', title: 'Mapping quality', subtitle: 'Primary alignments by MAPQ', edges: r.mapq.edges, counts: r.mapq.counts, tickLabel: v => String(v) })
  }

  const items = [
    { term: r.importedFrom ? 'Alignments' : 'Reads', text: r.importedFrom ?? opts.readsName },
    { term: 'Mapper', text: mapperText(r) },
  ]
  if (r.supplementary > 0) items.push({ term: 'Split reads', text: `${nf.format(r.supplementary)} supplementary alignments (the other parts of reads that map in pieces)` })
  const skipped = skippedText(r)
  if (skipped) items.push({ term: 'Left out', text: skipped })
  items.push({ term: 'Coverage', text: COVERAGE_NOTE })
  if (stored) {
    items.push({ term: 'Sites', text: sitesNote() })
    items.push({ term: 'Stored', text: `${formatBytes(r.storedBytes)} in the browser, in ${nf.format(r.pages)} ${r.pages === 1 ? 'page' : 'pages'}, with each read's name, bases and qualities` })
  }
  blocks.push({ kind: 'heading', text: 'How it was made' }, { kind: 'facts', items })

  const refs = r.references.map(x => x.name).join(', ')
  return writeReportPdf({
    title: opts.title,
    subtitle: `${opts.readsName} mapped to ${refs}. Made with SeqNexus on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
    blocks,
  })
}
