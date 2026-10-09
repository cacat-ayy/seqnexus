/**
 * The report in FastQC's data format, `fastqc_data.txt` (every module's
 * mark and values, one table per module), so that MultiQC and other tools
 * that read FastQC output can read a SeqNexus report.
 *
 * The columns and module names are FastQC 0.12's. The first line names
 * SeqNexus rather than FastQC: MultiQC takes a version from a `##FastQC` (or
 * `##Falco`) line and reads the modules whatever that line says, so the
 * file loads without claiming to be FastQC's. Modules not run for these
 * reads are left out, as FastQC leaves out the modules it does not run.
 */

import { DUPLICATION_LABELS, MODULES, type MateReport, type ModuleId } from './types'

/** FastQC's way of writing a base count: 3 Mbp, 1.2 Gbp. */
export function fastqcBases(n: number): string {
  const units = ['bp', 'kbp', 'Mbp', 'Gbp', 'Tbp']
  let v = n
  let u = 0
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++ }
  const text = u === 0 ? String(v) : v.toFixed(1).replace(/\.0$/, '')
  return `${text} ${units[u]}`
}

/** Numbers as FastQC writes them: always with a decimal point. */
const dec = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v))

function table(header: string[], rows: (string | number)[][]): string {
  return `#${header.join('\t')}\n${rows.map(r => r.map(v => (typeof v === 'number' ? dec(v) : v)).join('\t')).join('\n')}${rows.length ? '\n' : ''}`
}

function moduleTable(id: ModuleId, m: MateReport, fileName: string): string {
  switch (id) {
    case 'basic':
      return table(['Measure', 'Value'], [
        ['Filename', fileName],
        ['File type', 'Conventional base calls'],
        ['Encoding', 'Sanger / Illumina 1.9'],
        ['Total Sequences', String(m.reads)],
        ['Total Bases', fastqcBases(m.bases)],
        ['Sequences flagged as poor quality', '0'],
        ['Sequence length', m.minLength === m.maxLength ? String(m.maxLength) : `${m.minLength}-${m.maxLength}`],
        ['%GC', String(Math.round(m.gc))],
      ])
    case 'baseQuality':
      return table(['Base', 'Mean', 'Median', 'Lower Quartile', 'Upper Quartile', '10th Percentile', '90th Percentile'],
        m.baseQuality.map((q, i) => [String(i + 1), Math.round(q.mean * 1000) / 1000, q.p50, q.p25, q.p75, q.p10, q.p90]))
    case 'tileQuality': {
      const t = m.tiles
      if (!t) return table(['Tile', 'Base', 'Mean'], [])
      const rows: (string | number)[][] = []
      t.ids.forEach((id, k) => t.deviation[k].forEach((d, p) => rows.push([String(id), String(p + 1), d])))
      return table(['Tile', 'Base', 'Mean'], rows)
    }
    case 'seqQuality':
      return table(['Quality', 'Count'], m.seqQuality.counts.map((c, i) => [String(m.seqQuality.from + i), c]))
    case 'baseContent':
      return table(['Base', 'G', 'A', 'T', 'C'],
        m.baseContent.a.map((_, i) => [String(i + 1), m.baseContent.g[i], m.baseContent.a[i], m.baseContent.t[i], m.baseContent.c[i]]))
    case 'seqGc':
      return table(['GC Content', 'Count'], m.seqGc.observed.map((c, i) => [String(i), c]))
    case 'baseN':
      return table(['Base', 'N-Count'], m.baseN.map((v, i) => [String(i + 1), v]))
    case 'lengths': {
      const h = m.lengths
      return table(['Length', 'Count'], h.counts.map((c, i) => [
        h.edges[i + 1] - h.edges[i] <= 1 ? String(h.edges[i]) : `${h.edges[i]}-${h.edges[i + 1] - 1}`, c,
      ]))
    }
    case 'duplication':
      return `#Total Deduplicated Percentage\t${m.duplication.remaining}\n`
        + table(['Duplication Level', 'Percentage of total'], m.duplication.levels.map((v, i) => [DUPLICATION_LABELS[i], v]))
    case 'overrepresented':
      return table(['Sequence', 'Count', 'Percentage', 'Possible Source'],
        m.overrepresented.map(o => [o.seq, String(o.count), o.percent, o.source ?? 'No Hit']))
    case 'adapters':
      return table(['Position', ...m.adapters.map(a => a.name)],
        (m.adapters[0]?.percent ?? []).map((_, p) => [String(p + 1), ...m.adapters.map(a => a.percent[p])]))
  }
}

/** One mate's report as FastQC's fastqc_data.txt. */
export function fastqcDataText(m: MateReport, fileName: string): string {
  let out = '##SeqNexus\tquality report, FastQC modules and thresholds\n'
  for (const { id, name } of MODULES) {
    const status = m.status[id]
    if (status === 'skip') continue
    out += `>>${name}\t${status}\n${moduleTable(id, m, fileName)}>>END_MODULE\n`
  }
  return out
}
