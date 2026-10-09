/**
 * The quality report as files: a self-contained HTML page laid out as
 * FastQC's report (a Summary list of the modules, then each module with its
 * plot), a PDF of the same, and FastQC's data files for MultiQC
 * (ngs/qcreport/fastqcData.ts).
 *
 * The page and the PDF are fixed output: the light theme's colours on white,
 * whatever theme the app is in (figures.ts), so the HTML carries its own
 * small style sheet of plain colours rather than the app's tokens.
 */

import { DUPLICATION_LABELS, MODULES, type MateReport, type ModuleId, type ModuleStatus, type QcReport } from '../../../ngs/qcreport/types'
import { expectedNote, LIBRARY_LABEL, type ExpectedContext } from '../../../ngs/qcreport/expected'
import { formatBaseCount } from '../../../ngs/format'
import { writeReportPdf, type ReportBlock } from '../../../pdf/report-pdf'
import { figurePalette, lineFigure, qualityFigure, tileFigure, type FigurePalette } from './figures'

const nf = new Intl.NumberFormat()
const STATUS_TEXT: Record<ModuleStatus, string> = { pass: 'Passed', warn: 'Warning', fail: 'Failed', skip: 'Not run' }
const positions = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1))

export interface ExportInput {
  name: string
  report: QcReport
  /** The file each mate came from (one name for a single or interleaved file). */
  fileNames: string[]
  ctx: ExpectedContext
}

/** A module's figure as SVG, or null for the modules that are tables or were not run. */
export function moduleFigure(id: ModuleId, m: MateReport, pal: FigurePalette): string | null {
  if (m.status[id] === 'skip') return null
  switch (id) {
    case 'baseQuality':
      return qualityFigure(m.baseQuality, pal)
    case 'tileQuality':
      return m.tiles && tileFigure(m.tiles.ids, m.tiles.deviation, pal)
    case 'seqQuality':
      return lineFigure({ labels: m.seqQuality.counts.map((_, i) => String(m.seqQuality.from + i)), series: [{ name: 'Average quality per read', color: pal.accent, values: m.seqQuality.counts }], xTitle: 'Mean sequence quality (Phred score)', yTitle: 'Reads' }, pal)
    case 'baseContent':
      return lineFigure({
        labels: positions(m.baseContent.a.length), yMax: 100, xTitle: 'Position in read (bp)', yTitle: 'Percent',
        series: [
          { name: '%T', color: pal.base.t, values: m.baseContent.t }, { name: '%C', color: pal.base.c, values: m.baseContent.c },
          { name: '%A', color: pal.base.a, values: m.baseContent.a }, { name: '%G', color: pal.base.g, values: m.baseContent.g },
        ],
      }, pal)
    case 'seqGc':
      return lineFigure({
        labels: m.seqGc.observed.map((_, i) => String(i)), zeroBased: true, xTitle: 'Mean GC content (%)', yTitle: 'Reads',
        series: [
          { name: 'GC count per read', color: pal.series[0], values: m.seqGc.observed },
          { name: 'Theoretical distribution', color: pal.series[1], values: m.seqGc.theoretical, dashed: true },
        ],
      }, pal)
    case 'baseN':
      return lineFigure({ labels: positions(m.baseN.length), yMax: 100, series: [{ name: '%N', color: pal.accent, values: m.baseN }], xTitle: 'Position in read (bp)', yTitle: 'Percent' }, pal)
    case 'lengths': {
      const h = m.lengths
      let labels = h.counts.map((_, i) => (h.edges[i + 1] - h.edges[i] <= 1 ? String(h.edges[i]) : `${h.edges[i]}-${h.edges[i + 1] - 1}`))
      let values = h.counts
      if (labels.length === 1) { labels = [String(h.edges[0] - 1), labels[0], String(h.edges[0] + 1)]; values = [0, values[0], 0] }
      return lineFigure({ labels, series: [{ name: 'Sequence length', color: pal.accent, values }], xTitle: 'Sequence length (bp)', yTitle: 'Reads', everyLabel: labels.length <= 12 }, pal)
    }
    case 'duplication':
      return lineFigure({ labels: [...DUPLICATION_LABELS], yMax: 100, everyLabel: true, series: [{ name: '% Total sequences', color: pal.accent, values: m.duplication.levels }], xTitle: 'Sequence duplication level', yTitle: 'Percent of all reads' }, pal)
    case 'adapters':
      return m.adapters.length ? lineFigure({
        labels: positions(m.adapters[0].percent.length), yMax: 100, xTitle: 'Position in read (bp)', yTitle: '% Adapter',
        series: m.adapters.map((a, i) => ({ name: a.name, color: pal.series[i % pal.series.length], values: a.percent })),
      }, pal) : null
    default:
      return null
  }
}

function basicRows(m: MateReport, fileName: string): [string, string][] {
  return [
    ['Filename', fileName],
    ['File type', 'Conventional base calls'],
    ['Encoding', m.lowestQuality === null ? 'No qualities' : 'Sanger / Illumina 1.9 (Phred+33)'],
    ['Total Sequences', nf.format(m.reads)],
    ['Total Bases', formatBaseCount(m.bases)],
    ['Sequences flagged as poor quality', '0'],
    ['Sequence length', m.minLength === m.maxLength ? String(m.maxLength) : `${m.minLength}-${m.maxLength}`],
    ['%GC', String(Math.round(m.gc))],
  ]
}

const OVERREP_COLUMNS = ['Sequence', 'Count', 'Percentage', 'Possible Source']
const overrepRows = (m: MateReport) => m.overrepresented.map(o => [o.seq, nf.format(o.count), o.percent.toFixed(2), o.source ?? 'No Hit'])

function libraryText(ctx: ExpectedContext): string {
  return ctx.library ? LIBRARY_LABEL[ctx.library] : 'not set'
}

const mateLabel = (input: ExportInput, k: number) => (input.report.mates.length === 2 ? `R${k + 1}` : '')

// ---- HTML ----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* The page's own palette: fixed output that does not follow the app's theme (AGENTS.md, case 3). */
const HTML_STYLE = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1f2937;background:#f5f6f8}
header{padding:16px 24px;background:#fff;border-bottom:1px solid #e5e7eb}
header h1{margin:0;font-size:19px}
header p{margin:2px 0 0;color:#6b7280;font-size:12px}
.mate{display:grid;grid-template-columns:240px minmax(0,1fr);gap:24px;max-width:1100px;margin:0 auto;padding:16px 24px}
nav{position:sticky;top:12px;align-self:start}
nav h2{margin:0 0 6px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}
nav a{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:6px;color:#374151;text-decoration:none;font-size:13px}
nav a:hover{background:#eef0f4}
.mark{display:inline-block;width:10px;height:10px;border-radius:999px;flex-shrink:0}
.pass{background:#16a34a}.warn{background:#d97706}.fail{background:#dc2626}.skip{background:#d1d5db}
.muted{opacity:.45}
section{margin-bottom:14px;padding:14px 16px;background:#fff;border:1px solid #e5e7eb;border-left:3px solid #e5e7eb;border-radius:10px;break-inside:avoid}
section.s-pass{border-left-color:#16a34a}section.s-warn{border-left-color:#d97706}section.s-fail{border-left-color:#dc2626}section.s-expected{border-left-color:#9ca3af}
section h3{display:flex;gap:8px;align-items:center;margin:0 0 8px;font-size:15px}
.chip{padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;background:#f3f4f6;color:#4b5563}
.chip.pass{background:#dcfce7;color:#166534}.chip.warn{background:#fef3c7;color:#92400e}.chip.fail{background:#fee2e2;color:#991b1b}
.note{margin:6px 0 0;font-size:12px;color:#6b7280}
.why{margin:0 0 8px;font-size:12px;color:#4b5563}
svg{display:block;max-width:100%;height:auto}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{padding:4px 8px;border-bottom:1px solid #eef0f3;text-align:left}
th{color:#6b7280;font-weight:600}
td.seq{font-family:Menlo,Consolas,monospace;font-size:11px;word-break:break-all}
.mate-title{max-width:1100px;margin:16px auto 0;padding:0 24px;font-size:17px}
footer{max-width:1100px;margin:0 auto;padding:8px 24px 24px;color:#6b7280;font-size:12px}
@media (max-width:760px){.mate{grid-template-columns:1fr}nav{position:static}}
@media print{body{background:#fff}nav{display:none}.mate{display:block}}
`

function htmlTable(columns: string[], rows: string[][], seqColumn = -1): string {
  return `<table><thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    rows.map(r => `<tr>${r.map((v, i) => `<td${i === seqColumn ? ' class="seq"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`
}

export function reportHtml(input: ExportInput, pal: FigurePalette = figurePalette()): string {
  const { report, ctx } = input
  const parts = report.mates.map((m, k) => {
    const id = (mod: ModuleId) => `m${k}-${mod}`
    const fileName = input.fileNames[k] ?? input.fileNames[0] ?? input.name
    const nav = MODULES.map(({ id: mod, name }) => {
      const why = expectedNote(mod, m.status[mod], ctx)
      return `<a href="#${id(mod)}"><span class="mark ${m.status[mod]}${why ? ' muted' : ''}" title="${STATUS_TEXT[m.status[mod]]}${why ? ', expected' : ''}"></span>${esc(name)}</a>`
    }).join('')
    const sections = MODULES.map(({ id: mod, name }) => {
      const st = m.status[mod]
      const why = expectedNote(mod, st, ctx)
      let body = ''
      if (st === 'skip') body = `<p class="note">${esc(m.notes[mod] ?? '')}</p>`
      else {
        if (mod === 'basic') body = htmlTable(['Measure', 'Value'], basicRows(m, fileName))
        else if (mod === 'overrepresented') body = m.overrepresented.length ? htmlTable(OVERREP_COLUMNS, overrepRows(m), 0) : '<p class="note">No overrepresented sequences.</p>'
        else {
          if (mod === 'duplication') body += `<p class="why">Percent of sequences remaining if deduplicated: <b>${m.duplication.remaining.toFixed(2)}%</b></p>`
          body += moduleFigure(mod, m, pal) ?? ''
        }
        if (m.notes[mod]) body += `<p class="note">${esc(m.notes[mod]!)}</p>`
      }
      return `<section id="${id(mod)}" class="s-${why ? 'expected' : st}"><h3><span class="mark ${st}${why ? ' muted' : ''}"></span>${esc(name)} <span class="chip ${why ? '' : st}">${STATUS_TEXT[st]}${why ? ', expected' : ''}</span></h3>${why ? `<p class="why">${esc(why)}</p>` : ''}${body}</section>`
    }).join('')
    const title = mateLabel(input, k)
    return `${title ? `<h2 class="mate-title">${title}: ${esc(fileName)}</h2>` : ''}<div class="mate"><nav><h2>Summary</h2>${nav}</nav><main>${sections}</main></div>`
  }).join('')
  const sub = `${report.mates.length === 2 ? 'Paired reads' : 'Reads'} · library ${libraryText(ctx).toLowerCase()} · ${new Date().toLocaleString()}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.name)} quality report</title><style>${HTML_STYLE}</style></head><body>`
    + `<header><h1>${esc(input.name)}: quality report</h1><p>${esc(sub)}</p></header>${parts}`
    + `<footer>Made by SeqNexus. The modules, their names and their default pass, warn and fail thresholds follow FastQC (S. Andrews, Babraham Bioinformatics); the values were computed by SeqNexus, not by FastQC. Marks shown faded are expected for the library type or the technology, with the reason under the module's title.</footer></body></html>`
}

// ---- PDF ----

const TONE: Record<ModuleStatus, 'good' | 'warning' | 'danger' | 'muted'> = { pass: 'good', warn: 'warning', fail: 'danger', skip: 'muted' }

export function reportPdf(input: ExportInput, pal: FigurePalette = figurePalette()): Uint8Array {
  const { report, ctx } = input
  const blocks: ReportBlock[] = []
  report.mates.forEach((m, k) => {
    const fileName = input.fileNames[k] ?? input.fileNames[0] ?? input.name
    const label = mateLabel(input, k)
    blocks.push({ kind: 'heading', text: `${label ? `${label}: ` : ''}Summary` })
    blocks.push({
      kind: 'table',
      columns: [{ label: 'Module' }, { label: 'Result' }],
      rows: MODULES.map(({ id, name }) => [name, `${STATUS_TEXT[m.status[id]]}${expectedNote(id, m.status[id], ctx) ? ', expected' : ''}`]),
    })
    for (const { id, name } of MODULES) {
      const st = m.status[id]
      const why = expectedNote(id, st, ctx)
      blocks.push({ kind: 'heading', text: `${label ? `${label}: ` : ''}${name}`, status: { text: `${STATUS_TEXT[st]}${why ? ', expected' : ''}`, tone: why ? 'muted' : TONE[st] } })
      if (why) blocks.push({ kind: 'note', text: why })
      if (st === 'skip') { blocks.push({ kind: 'note', text: m.notes[id] ?? '' }); continue }
      if (id === 'basic') blocks.push({ kind: 'table', columns: [{ label: 'Measure' }, { label: 'Value' }], rows: basicRows(m, fileName) })
      else if (id === 'overrepresented') {
        blocks.push(m.overrepresented.length
          ? { kind: 'table', columns: [{ label: 'Sequence' }, { label: 'Count', numeric: true }, { label: 'Percentage', numeric: true }, { label: 'Possible Source' }], rows: overrepRows(m) }
          : { kind: 'note', text: 'No overrepresented sequences.' })
      } else {
        if (id === 'duplication') blocks.push({ kind: 'note', text: `Percent of sequences remaining if deduplicated: ${m.duplication.remaining.toFixed(2)}%` })
        const svg = moduleFigure(id, m, pal)
        if (svg) blocks.push({ kind: 'figure', svg })
      }
      if (m.notes[id]) blocks.push({ kind: 'note', text: m.notes[id]! })
    }
  })
  blocks.push({ kind: 'note', text: 'The modules, their names and their default thresholds follow FastQC (S. Andrews, Babraham Bioinformatics); the values were computed by SeqNexus, not by FastQC.' })
  return writeReportPdf({
    title: `${input.name}: quality report`,
    subtitle: `${report.mates.length === 2 ? 'Paired reads' : 'Reads'}, library ${libraryText(ctx).toLowerCase()}, ${new Date().toLocaleString()}`,
    blocks,
  })
}
