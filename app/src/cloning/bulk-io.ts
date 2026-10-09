/**
 * Part lists in, product tables out.
 *
 * A library is usually already written down somewhere (a spreadsheet of
 * promoters, or a plate of synthesised fragments), so the bins can be read
 * from a file rather than clicked together one part at a time. What comes
 * back out is a table with a row per construct, which is what goes into a
 * lab notebook or an ordering form.
 */

import type { BulkResult, BulkRow, DesignBin } from './bulk'
import { newPartId, type DesignPart, type PartRole } from './design'

/** Split a delimited line, honouring quotes around a field. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === delimiter) {
      out.push(field)
      field = ''
    } else {
      field += c
    }
  }
  out.push(field)
  return out.map(f => f.trim())
}

/** Comma or tab, whichever the header line uses more of. */
function sniffDelimiter(header: string): string {
  const commas = (header.match(/,/g) ?? []).length
  const tabs = (header.match(/\t/g) ?? []).length
  return tabs > commas ? '\t' : ','
}

export interface ParsedParts {
  bins: DesignBin[]
  /** Lines that could not be used, with the reason. */
  skipped: { line: number; reason: string }[]
}

const HEADERS: Record<string, string[]> = {
  bin: ['bin', 'position', 'slot', 'group', 'pos'],
  name: ['name', 'part', 'label', 'id'],
  sequence: ['sequence', 'bases', 'seq', 'dna'],
  topology: ['topology', 'form', 'shape'],
  role: ['role', 'kind', 'type'],
}

function columnIndexes(header: string[]): Record<string, number> {
  const found: Record<string, number> = {}
  header.forEach((cell, i) => {
    const key = cell.toLowerCase().replace(/[^a-z]/g, '')
    for (const [field, names] of Object.entries(HEADERS)) {
      if (found[field] === undefined && names.includes(key)) found[field] = i
    }
  })
  return found
}

/**
 * Read a part list.
 *
 * One row per part, with a `sequence` and a `bin` saying which position it
 * belongs to. Bins come out in the order they first appear, so the file's own
 * order decides the order of the assembly. A row with no bin goes into one
 * named after itself, which is what a plain list of inserts should do.
 */
export function parsePartList(text: string): ParsedParts {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { bins: [], skipped: [] }

  const delimiter = sniffDelimiter(lines[0])
  const header = splitLine(lines[0], delimiter)
  const columns = columnIndexes(header)
  const skipped: { line: number; reason: string }[] = []

  if (columns.sequence === undefined) {
    return { bins: [], skipped: [{ line: 1, reason: 'No sequence column: expected a column called "sequence".' }] }
  }

  const order: string[] = []
  const byBin = new Map<string, DesignPart[]>()

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter)
    const bases = (cells[columns.sequence] ?? '').replace(/\s/g, '').toUpperCase()
    if (bases.length === 0) {
      skipped.push({ line: i + 1, reason: 'No sequence' })
      continue
    }
    if (!/^[ACGTRYSWKMBDHVN]+$/.test(bases)) {
      skipped.push({ line: i + 1, reason: 'Sequence has characters that are not DNA' })
      continue
    }

    const name = (columns.name !== undefined ? cells[columns.name] : '') || `Part ${i}`
    const binName = (columns.bin !== undefined ? cells[columns.bin] : '') || name
    const topology = (columns.topology !== undefined ? cells[columns.topology] : '').toLowerCase()
    const roleText = (columns.role !== undefined ? cells[columns.role] : '').toLowerCase()
    const circular = topology.startsWith('c')
    const role: PartRole = roleText.startsWith('v') ? 'vector' : circular ? 'vector' : 'insert'

    const part: DesignPart = {
      id: newPartId(),
      name,
      role,
      bases,
      topology: circular ? 'circular' : 'linear',
      annotations: [],
      orientation: 'auto',
    }

    if (!byBin.has(binName)) { byBin.set(binName, []); order.push(binName) }
    byBin.get(binName)!.push(part)
  }

  return {
    bins: order.map((name, i) => ({ id: `bin_${i}_${name.replace(/\W+/g, '')}`, name, parts: byBin.get(name)! })),
    skipped,
  }
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The results table as CSV: a row per construct, a column per position. */
export function productTableCsv(result: BulkResult): string {
  const header = ['Name', ...result.binNames, 'Size (bp)', 'Topology', 'Outcome', 'Notes']
  const verdictText: Record<BulkRow['verdict'], string> = {
    ok: 'As designed',
    ambiguous: 'Forms, but not as designed',
    none: 'No product',
  }

  const lines = [header.map(csvCell).join(',')]
  for (const row of result.rows) {
    lines.push([
      row.name,
      ...result.binNames.map((_, i) => row.partNames[i] ?? ''),
      row.size > 0 ? String(row.size) : '',
      row.topology ?? '',
      verdictText[row.verdict],
      row.notes.join('; '),
    ].map(csvCell).join(','))
  }
  return lines.join('\n')
}

/** The constructs themselves, as multi-FASTA, for ordering or handing on. */
export function productsFasta(rows: readonly BulkRow[]): string {
  const out: string[] = []
  for (const row of rows) {
    if (!row.product) continue
    out.push(`>${row.name} ${row.size} bp ${row.topology}`)
    const seq = row.product.sequence
    for (let i = 0; i < seq.length; i += 70) out.push(seq.slice(i, i + 70))
  }
  return out.join('\n')
}
