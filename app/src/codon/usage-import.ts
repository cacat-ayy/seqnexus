/**
 * Importing a codon usage table.
 *
 * Two formats, because these are the two that tools actually emit:
 *
 *   EMBOSS cusp (.cusp)          #Codon AA Fraction Frequency Number
 *   GCG CodonFrequency (.cod)    AmAcid Codon Number /1000 Fraction ..
 *
 * Both are whitespace-aligned tables with a header naming their columns, so
 * the header is read and the columns are taken by name rather than by
 * position: the two formats order them differently, and a parser that assumed
 * one order would silently read counts as fractions for the other.
 *
 * Within an amino acid family the fraction, the frequency per thousand and the
 * raw count are all proportional to each other, so any of the three yields the
 * same normalised table. The preference order below is about robustness rather
 * than correctness: some GCG tables ship with the count column zeroed.
 *
 * Anything else with one codon and one number per line is still accepted as a
 * plain list, which covers a Kazusa block or a quick two-column paste, but the
 * dialog asks for cusp or .cod because those are the files people have.
 */

import { geneticCode, synonymsFor } from './genetic-codes'
import type { CodonUsageTable } from './usage-tables'

export class UsageImportError extends Error {}

export type UsageFormat = 'cusp' | 'gcg' | 'plain'

export const USAGE_FORMAT_LABELS: Record<UsageFormat, string> = {
  cusp: 'EMBOSS cusp',
  gcg: 'GCG CodonFrequency',
  plain: 'codon list',
}

export interface ParsedUsageTable {
  table: CodonUsageTable
  format: UsageFormat
  /** Which column the numbers came from, for the import summary. */
  column: string
  /** How many of the 64 codons the file actually listed. */
  codonsRead: number
  /** Codons the file did not mention. They end up at zero. */
  missing: string[]
  /** Lines that looked like data but could not be used. */
  skipped: { text: string; reason: string }[]
}

/** Codon, then the first number after it on the same line. */
const ENTRY = /\b([ACGTUacgtu]{3})\b[^0-9\n\r-]*(\d+(?:\.\d+)?)/g

const ALL_CODONS: string[] = []
for (const a of 'ACGT') for (const b of 'ACGT') for (const c of 'ACGT') ALL_CODONS.push(a + b + c)

export const MAX_USAGE_FILE_BYTES = 1024 * 1024

/** Fewer codons than this and the file is not a usage table. */
const MIN_CODONS = 20

const CODON_RE = /^[ACGTU]{3}$/

function normaliseCodon(raw: string): string {
  return raw.toUpperCase().replace(/U/g, 'T')
}

/** Header cell to the kind of number it holds. */
function columnKind(cell: string): 'fraction' | 'frequency' | 'number' | null {
  const c = cell.toLowerCase().replace(/[^a-z0-9/]/g, '')
  if (c === 'fraction' || c === 'frac') return 'fraction'
  if (c === '/1000' || c === 'per1000' || c === 'frequency' || c === 'freq') return 'frequency'
  if (c === 'number' || c === 'num' || c === 'count' || c === 'obs') return 'number'
  return null
}

interface Header {
  cells: string[]
  codonAt: number
  /** Column index per kind, where the file has one. */
  value: { kind: 'fraction' | 'frequency' | 'number'; at: number }[]
}

/** Read a header row into the column positions the parser needs. */
function readHeader(line: string): Header | null {
  const cells = line.replace(/^[#!\s]+/, '').trim().split(/\s+/).filter(c => c !== '..')
  const codonAt = cells.findIndex(c => c.toLowerCase() === 'codon')
  if (codonAt === -1) return null

  const value: Header['value'] = []
  for (let i = 0; i < cells.length; i++) {
    const kind = columnKind(cells[i])
    if (kind && !value.some(v => v.kind === kind)) value.push({ kind, at: i })
  }
  if (value.length === 0) return null

  // Fraction first: it is already normalised, so it survives a table whose
  // count column was zeroed on export. Then per-thousand, then raw counts.
  const order = { fraction: 0, frequency: 1, number: 2 }
  value.sort((a, b) => order[a.kind] - order[b.kind])
  return { cells, codonAt, value }
}

function detectFormat(fileName: string, text: string): UsageFormat {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.cusp')) return 'cusp'
  if (lower.endsWith('.cod')) return 'gcg'
  if (/^#.*\bcodon\b.*\bfraction\b/im.test(text)) return 'cusp'
  if (/^\s*amacid\s+codon\b/im.test(text)) return 'gcg'
  return 'plain'
}

interface Extracted {
  values: Record<string, number>
  codonsRead: number
  column: string
  skipped: { text: string; reason: string }[]
}

/** Columnar read, for the two formats that name their columns. */
function extractColumnar(text: string): Extracted | null {
  const lines = text.split(/\r?\n/)
  let header: Header | null = null
  let headerAt = -1
  for (let i = 0; i < lines.length; i++) {
    const found = readHeader(lines[i])
    if (found) { header = found; headerAt = i; break }
  }
  if (!header) return null

  const values: Record<string, number> = {}
  const skipped: { text: string; reason: string }[] = []
  let codonsRead = 0
  let column = header.value[0].kind

  for (let i = headerAt + 1; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue
    const cells = trimmed.split(/\s+/)
    const codonCell = cells[header.codonAt]
    if (!codonCell || !CODON_RE.test(codonCell.toUpperCase())) {
      // The trailing "End" of a GCG file and any prose after the table.
      if (/^[A-Za-z]/.test(trimmed)) continue
      skipped.push({ text: trimmed.slice(0, 40), reason: 'no codon in the codon column' })
      continue
    }
    const codon = normaliseCodon(codonCell)

    // Take the best column that actually holds a usable number on this row.
    let picked: number | null = null
    for (const candidate of header.value) {
      const raw = cells[candidate.at]
      const n = raw === undefined ? NaN : Number(raw)
      if (Number.isFinite(n) && n >= 0) { picked = n; column = candidate.kind; break }
    }
    if (picked === null) {
      skipped.push({ text: trimmed.slice(0, 40), reason: 'no number to read' })
      continue
    }
    if (codon in values) {
      skipped.push({ text: codon, reason: 'listed more than once' })
      continue
    }
    values[codon] = picked
    codonsRead++
  }

  if (codonsRead === 0) return null
  return { values, codonsRead, column, skipped }
}

/** Fallback: one codon and one number per line, in any punctuation. */
function extractPlain(text: string): Extracted {
  const values: Record<string, number> = {}
  const skipped: { text: string; reason: string }[] = []
  let codonsRead = 0

  ENTRY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ENTRY.exec(text)) !== null) {
    const codon = normaliseCodon(match[1])
    const value = Number(match[2])
    if (!Number.isFinite(value) || value < 0) {
      skipped.push({ text: match[0].trim(), reason: 'not a number' })
      continue
    }
    if (codon in values) {
      // A second figure for the same codon means the scan has wandered into a
      // different column layout, so it is reported rather than summed.
      skipped.push({ text: codon, reason: 'listed more than once' })
      continue
    }
    values[codon] = value
    codonsRead++
  }
  return { values, codonsRead, column: 'first number', skipped }
}

/**
 * Parse a usage table.
 *
 * `fileName` picks the format and supplies the default display name.
 */
export function parseUsageTable(fileName: string, text: string): ParsedUsageTable {
  if (text.length > MAX_USAGE_FILE_BYTES) {
    throw new UsageImportError('That file is too large to be a codon usage table.')
  }

  const format = detectFormat(fileName, text)
  const columnar = format === 'plain' ? null : extractColumnar(text)
  // A columnar read that comes up short means the header was recognised but
  // the rows underneath are not laid out the way it promised. The generic scan
  // handles that better than failing does.
  const extracted = columnar && columnar.codonsRead >= MIN_CODONS
    ? columnar
    : extractPlain(text)

  if (extracted.codonsRead < MIN_CODONS) {
    throw new UsageImportError(
      'That does not look like a codon usage table. Expected an EMBOSS cusp file, '
      + 'a GCG CodonFrequency file, or a list of codons with a count or frequency for each.',
    )
  }

  const standard = geneticCode(1)
  const fractions: Record<string, number> = {}
  for (const aa of new Set(Object.values(standard.table))) {
    const family = synonymsFor(standard, aa)
    const total = family.reduce((sum, c) => sum + (extracted.values[c] ?? 0), 0)
    for (const c of family) {
      fractions[c] = total > 0 ? (extracted.values[c] ?? 0) / total : 0
    }
  }

  const missing = ALL_CODONS.filter(c => !(c in extracted.values))
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported table'

  return {
    table: {
      id: '', // assigned by the store when it is saved
      name: base,
      source: `${USAGE_FORMAT_LABELS[format]} file "${fileName}"`,
      approximate: false,
      fractions,
    },
    format,
    column: extracted.column,
    codonsRead: extracted.codonsRead,
    missing,
    skipped: extracted.skipped,
  }
}

/** One line telling the user what the import did. */
export function describeUsageImport(fileName: string, parsed: ParsedUsageTable): string {
  const parts = [
    `Read ${parsed.codonsRead} codons from "${fileName}"`
    + ` (${USAGE_FORMAT_LABELS[parsed.format]}, ${parsed.column})`,
  ]
  if (parsed.missing.length > 0) {
    parts.push(`${parsed.missing.length} not listed and left at zero`)
  }
  if (parsed.skipped.length > 0) {
    parts.push(`${parsed.skipped.length} skipped`)
  }
  return parts.join(', ')
}
