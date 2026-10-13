/**
 * CSV writer for annotation/feature export.
 *
 * Exports annotations as a comma-separated table with columns:
 * Name, Type, Start, End, Length, Strand, Color, Notes
 *
 * Coordinates are 1-based inclusive (matching the UI display).
 */

import type { DocumentState } from '../models/Document'
import { csvRow } from '../utils/csv-cell'

export function writeCsv(doc: DocumentState): string {
  const seqLen = doc.sequence.bases.length
  const unit = doc.sequence.alphabet === 'protein' ? 'aa' : 'bp'
  const rows: string[] = []

  rows.push(`Name,Type,Start,End,Length (${unit}),Strand,Color,Notes`)

  for (const ann of doc.annotations) {
    const start = ann.start + 1 // 1-based
    const end = ann.end          // inclusive (half-open → inclusive)
    const length = ann.start <= ann.end
      ? ann.end - ann.start
      : seqLen - ann.start + ann.end
    const strand = ann.strand === 1 ? 'Forward' : ann.strand === -1 ? 'Reverse' : 'None'

    // Collect notes from qualifiers
    const notes: string[] = []
    if (ann.qualifiers) {
      const noteVals = ann.qualifiers['note'] ?? ann.qualifiers['product'] ?? []
      notes.push(...noteVals)
    }

    rows.push(csvRow([ann.name, ann.type, start, end, length, strand, ann.color ?? '', notes.join('; ')]))
  }

  rows.push('')
  return rows.join('\n')
}
