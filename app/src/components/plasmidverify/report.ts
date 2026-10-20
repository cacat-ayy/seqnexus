/**
 * A whole-plasmid verification as a PDF: the counts, a row per sample, and
 * for each sample its verdict, how the consensus was turned onto the
 * construct, what to do next, its differences (with what they do to a
 * protein and why some are doubtful) and its mixed positions. Laid out by
 * the shared report writer (pdf/report-pdf.ts), like a plate's report.
 * One sample's report is the same with only that sample.
 */

import { writeReportPdf, type ReportBlock } from '../../pdf/report-pdf'
import { describeChange, STATUS_LABEL } from '../../assembly/verify'
import { allCoding, codingLabel } from '../../assembly/effects'
import { variantKey } from '../../assembly/variants'
import { MIXED_MAX, MIXED_MIN, MIXED_MIN_DEPTH, LONG_HOMOPOLYMER, TRACE_MIXED_RATIO } from '../../plasmidverify/flags'
import { nextStep, READ_MIN_DEPTH, rotationText, type PlasmidSample, type PlasmidVerification } from '../../plasmidverify/result'

const nf = new Intl.NumberFormat('en-US')
const pct = (x: number) => `${(x * 100).toFixed(x === 1 || x === 0 ? 0 : 1)}%`

function evidence(s: PlasmidSample): string {
  if (s.tier === 'reads' && s.reads) return `${nf.format(s.reads.mapped)} reads, ${Math.round(s.reads.meanDepth)}x on average, ${s.reads.minDepth}x at the least`
  return 'the consensus'
}

function sampleBlocks(s: PlasmidSample): ReportBlock[] {
  const r = s.report
  const low = new Map(s.lowConfidence.map(x => [x.key, x.reason]))
  const blocks: ReportBlock[] = [
    { kind: 'heading', text: `${s.name}: ${STATUS_LABEL[r.verdict]}`, status: s.mixed.flagged ? { text: 'mixed population', tone: 'warning' } : undefined },
    {
      kind: 'facts',
      items: [
        { term: 'Construct', text: `${s.construct.name}, ${nf.format(s.construct.length)} bp${s.closeTo.length ? ` (${s.closeTo.join(', ')} matched almost as well)` : ''}` },
        { term: 'Evidence', text: evidence(s) },
        { term: 'Rotation', text: rotationText(s) },
        { term: 'Identity', text: `${pct(s.identity)} over ${nf.format(s.consensusLength)} bp of consensus` },
        ...(s.readsNote ? [{ term: 'Reads', text: s.readsNote }] : []),
        { term: 'Next', text: nextStep(s) },
      ],
    },
  ]
  if (r.differences.length) {
    blocks.push({
      kind: 'table',
      columns: [{ label: 'Position', numeric: true }, { label: 'Change' }, { label: 'Reads', numeric: true }, { label: 'Feature' }, { label: 'Protein' }, { label: 'Note' }],
      rows: r.differences.map(d => [
        nf.format(d.position), describeChange(d), s.tier === 'reads' ? `${Math.round(d.frequency * 100)}% of ${d.coverage}` : 'consensus',
        d.features.join(', '), allCoding(d).map(c => `${c.feature}: ${codingLabel(c)}`).join('; '), low.get(variantKey(d)) ?? '',
      ]),
    })
  } else {
    blocks.push({ kind: 'note', text: 'No differences from the construct.' })
  }
  if (r.uncovered.length && s.tier === 'reads') {
    blocks.push({ kind: 'note', text: `Fewer than ${READ_MIN_DEPTH} reads: ${r.uncovered.map(g => (g.from === g.to ? `${g.from}` : `${g.from}-${g.to}`)).join(', ')}` })
  }
  if (s.mixed.sites.length) {
    blocks.push({
      kind: 'table',
      columns: [{ label: 'Mixed position', numeric: true }, { label: 'Bases' }, { label: 'Minor share', numeric: true }, { label: 'Reads', numeric: true }, { label: 'At a difference' }],
      rows: s.mixed.sites.map(m => [nf.format(m.position), m.change, pct(m.fraction), m.depth === null ? 'chromatogram' : nf.format(m.depth), m.atDifference ? 'yes' : '']),
    })
  }
  return blocks
}

export function plasmidReportPdf(name: string, v: PlasmidVerification, only?: PlasmidSample): Uint8Array {
  const samples = only ? [only] : v.samples
  const count = (k: PlasmidSample['report']['verdict']) => samples.filter(s => s.report.verdict === k).length
  const blocks: ReportBlock[] = [
    {
      kind: 'tiles',
      tiles: [
        { label: 'Samples', value: nf.format(samples.length + (only ? 0 : v.unmatched.length)) },
        { label: 'Verified', value: nf.format(count('verified')) },
        { label: 'Differences found', value: nf.format(count('differences')) },
        { label: 'Mixed', value: nf.format(samples.filter(s => s.mixed.flagged).length) },
      ],
    },
  ]
  if (samples.length > 1 || (!only && v.unmatched.length)) {
    blocks.push(
      { kind: 'heading', text: 'Samples' },
      {
        kind: 'table',
        columns: [{ label: 'Sample' }, { label: 'Construct' }, { label: 'Verdict' }, { label: 'Evidence' }, { label: 'Differences', numeric: true }, { label: 'Mixed' }],
        rows: [
          ...samples.map(s => [s.name, s.construct.name, STATUS_LABEL[s.report.verdict], s.tier === 'reads' ? 'reads' : 'consensus', nf.format(s.report.differences.length), s.mixed.flagged ? 'yes' : '']),
          ...(only ? [] : v.unmatched.map(u => [u.name, '', 'No construct matched', '', '', ''])),
        ],
      },
    )
  }
  for (const s of samples) blocks.push(...sampleBlocks(s))
  blocks.push(
    { kind: 'heading', text: 'How it was checked' },
    {
      kind: 'facts',
      items: [
        { term: 'Verified', text: 'The consensus (or, with the reads, most reads) matches the construct at every base, and every base is covered. Every difference counts, inside a feature or not.' },
        { term: 'Rotation', text: 'The consensus is turned to the construct\'s strand and origin before it is compared: both circles are cut at a 16-base stretch found once in each, and aligned from there.' },
        { term: 'Reads', text: `Mapped with minimap2 (map-ont) and called with the nanopore settings. Covered means at least ${READ_MIN_DEPTH} reads; a difference is what at least half of them carry.` },
        { term: 'Mixed', text: `With the reads: ${pct(MIXED_MIN)} to ${pct(MIXED_MAX)} of at least ${MIXED_MIN_DEPTH} reads carry another allele. Without them: a second peak at least ${pct(TRACE_MIXED_RATIO)} of the first in the service's chromatogram.` },
        { term: 'Low confidence', text: `Differences in a homopolymer of ${LONG_HOMOPOLYMER} or more, or at a Dam (GATC) or Dcm (CCWGG) site: nanopore's known error modes.` },
      ],
    },
  )
  const date = new Date(v.checkedAt || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return writeReportPdf({
    title: `${only ? only.name : name}: whole-plasmid verification`,
    subtitle: `Checked with SeqNexus on ${date}.`,
    blocks,
  })
}
