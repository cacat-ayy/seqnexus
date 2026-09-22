/**
 * CSV writer for annotation/feature export.
 *
 * Exports annotations as a comma-separated table with columns:
 * Name, Type, Start, End, Length, Strand, Color, Notes
 *
 * Coordinates are 1-based inclusive (matching the UI display).
 */

import type { DocumentState } from '../models/Document'

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function writeCsv(doc: DocumentState): string {
  const seqLen = doc.sequence.bases.length
  const rows: string[] = []

  rows.push('Name,Type,Start,End,Length (bp),Strand,Color,Notes')

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

    rows.push([
      escapeCsv(ann.name),
      escapeCsv(ann.type),
      String(start),
      String(end),
      String(length),
      strand,
      ann.color ?? '',
      escapeCsv(notes.join('; ')),
    ].join(','))
  }

  rows.push('')
  return rows.join('\n')
}
