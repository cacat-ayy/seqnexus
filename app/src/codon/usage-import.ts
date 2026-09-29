/**
 * Importing a codon usage table.
 *
 * People arrive with one of three things: a block copied off the Kazusa site,
 * a spreadsheet exported to CSV, or a two-column list. All three are the same
 * data in different punctuation, so rather than three parsers this scans for
 * "codon, then the first number after it" and normalises per amino acid
 * family afterwards.
 *
 * That normalisation is also why the column does not have to be identified:
 * counts, frequencies per thousand and fractions within a family are all
 * proportional to each other inside a family, so any of them produces the same
 * table. What the file cannot be is a mix of the three, and nothing can detect
 * that, which is why the import reports how many codons it read and the UI
 * shows the resulting table before it is used.
 */

import { geneticCode, synonymsFor } from './genetic-codes'
import type { CodonUsageTable } from './usage-tables'

export class UsageImportError extends Error {}

export interface ParsedUsageTable {
  table: CodonUsageTable
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

/**
 * Parse a usage table.
 *
 * `fileName` only supplies the default display name.
 */
export function parseUsageTable(fileName: string, text: string): ParsedUsageTable {
  if (text.length > MAX_USAGE_FILE_BYTES) {
    throw new UsageImportError('That file is too large to be a codon usage table.')
  }

  const values: Record<string, number> = {}
  const skipped: { text: string; reason: string }[] = []
  let codonsRead = 0

  ENTRY.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = ENTRY.exec(text)) !== null) {
    const codon = match[1].toUpperCase().replace(/U/g, 'T')
    const value = Number(match[2])
    if (!Number.isFinite(value) || value < 0) {
      skipped.push({ text: match[0].trim(), reason: 'not a number' })
      continue
    }
    if (codon in values) {
      // A second figure for the same codon is the giveaway that the scan has
      // wandered into a different column layout, so it is reported, not summed.
      skipped.push({ text: codon, reason: 'listed more than once' })
      continue
    }
    values[codon] = value
    codonsRead++
  }

  if (codonsRead < 20) {
    throw new UsageImportError(
      'That does not look like a codon usage table: expected a list of codons with a count or frequency for each.',
    )
  }

  const standard = geneticCode(1)
  const fractions: Record<string, number> = {}
  for (const aa of new Set(Object.values(standard.table))) {
    const family = synonymsFor(standard, aa)
    const total = family.reduce((sum, c) => sum + (values[c] ?? 0), 0)
    for (const c of family) {
      fractions[c] = total > 0 ? (values[c] ?? 0) / total : 0
    }
  }

  const missing = ALL_CODONS.filter(c => !(c in values))
  const base = fileName.replace(/\.[^.]+$/, '') || 'Imported table'

  return {
    table: {
      id: '', // assigned by the store when it is saved
      name: base,
      source: `Imported from ${fileName}`,
      approximate: false,
      fractions,
    },
    codonsRead,
    missing,
    skipped,
  }
}

/** One line telling the user what the import did. */
export function describeUsageImport(fileName: string, parsed: ParsedUsageTable): string {
  const parts = [`Read ${parsed.codonsRead} codons from "${fileName}"`]
  if (parsed.missing.length > 0) {
    parts.push(`${parsed.missing.length} not listed and left at zero`)
  }
  if (parsed.skipped.length > 0) {
    parts.push(`${parsed.skipped.length} skipped`)
  }
  return parts.join(', ')
}
