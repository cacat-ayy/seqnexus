/**
 * Aligned FASTA (also reads A2M: lower-case and '.' become ordinary residues and gaps).
 */

import type { AlnDoc } from '../model'
import { splitLines, wrap } from './util'
import type { AlnFormat, ParsedAlignment } from './types'

export function parseFasta(text: string): ParsedAlignment {
  const rows: { name: string; seq: string }[] = []
  let cur: { name: string; parts: string[] } | null = null
  const flush = () => { if (cur) rows.push({ name: cur.name, seq: cur.parts.join('') }) }
  for (const line of splitLines(text)) {
    if (line.startsWith('>')) {
      flush()
      // The whole header is the name, so a row called "Homo sapiens" comes back as itself.
      cur = { name: line.slice(1).trim() || `Sequence ${rows.length + 1}`, parts: [] }
    } else if (cur && !line.startsWith(';')) {
      cur.parts.push(line.replace(/\s+/g, ''))
    }
  }
  flush()
  return { rows, warnings: [] }
}

export function writeFasta(doc: AlnDoc): string {
  const out: string[] = []
  for (const r of doc.rows) {
    out.push(`>${r.name.replace(/[\r\n]+/g, ' ')}`)
    out.push(...wrap(r.seq, 60))
  }
  return out.join('\n') + '\n'
}

export const FASTA: AlnFormat = {
  id: 'fasta',
  label: 'Aligned FASTA',
  extensions: ['.fasta', '.fas', '.fa', '.afa', '.a2m', '.fna', '.faa', '.mfa'],
  description: 'Sequences with gap characters; read by nearly every tool',
  parse: parseFasta,
  write: writeFasta,
}
