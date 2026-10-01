/**
 * PIR / NBRF, also used for MODELLER alignments:
 *
 *   >P1;name
 *   description line
 *   RESIDUES...*
 *
 * The two-letter code says what the sequence is (P1 protein, DL linear DNA, ...).
 */

import type { AlnDoc, AlnKind } from '../model'
import { noSpaces, splitLines, wrap } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment } from './types'

const HEADER = /^>([A-Z][A-Z0-9]);(.*)$/i
const PROTEIN_CODES = new Set(['P1', 'F1'])

export function parsePir(text: string): ParsedAlignment {
  const lines = splitLines(text)
  const rows: { name: string; seq: string }[] = []
  const codes = new Set<string>()
  let i = 0
  while (i < lines.length) {
    const m = HEADER.exec(lines[i].trim())
    if (!m) { i++; continue }
    codes.add(m[1].toUpperCase())
    const name = m[2].trim() || `Sequence ${rows.length + 1}`
    i += 2 // skip the description line
    let seq = ''
    while (i < lines.length && !lines[i].trim().startsWith('>')) seq += lines[i++].replace(/\s+/g, '')
    // The last '*' ends the record; any others are stop codons.
    rows.push({ name, seq: seq.replace(/\*$/, '') })
  }
  if (rows.length === 0) throw new AlignmentParseError('No ">P1;name" records found in this PIR file')
  let kind: AlnKind | undefined
  if ([...codes].every(c => PROTEIN_CODES.has(c))) kind = 'protein'
  else if ([...codes].every(c => !PROTEIN_CODES.has(c) && c !== 'XX')) kind = 'dna'
  return { rows, kind, warnings: [] }
}

export function writePir(doc: AlnDoc): string {
  const code = doc.kind === 'protein' ? 'P1' : 'DL'
  const out: string[] = []
  for (const r of doc.rows) {
    out.push(`>${code};${noSpaces(r.name)}`)
    out.push(r.source?.name && r.source.name !== r.name ? r.source.name : r.name)
    const lines = wrap(r.seq, 60)
    lines[lines.length - 1] += '*'
    out.push(...lines)
    out.push('')
  }
  return out.join('\n')
}

export const PIR: AlnFormat = {
  id: 'pir',
  label: 'PIR / NBRF',
  extensions: ['.pir', '.nbrf', '.ali'],
  description: 'For MODELLER and older protein tools',
  parse: parsePir,
  write: writePir,
}
