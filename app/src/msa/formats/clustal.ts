/**
 * Clustal ALN, as written by Clustal W/X/Omega, MUSCLE and MAFFT.
 *
 * Blocks of "name  residues [count]" lines, each block followed by a line of
 * conservation marks that starts with whitespace.
 */

import { docProfile, clustalMark } from '../stats'
import type { AlnDoc } from '../model'
import { noSpaces, splitLines } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment } from './types'

const HEADER = /^(CLUSTAL|MUSCLE|PROBCONS|MSAPROBS|KALIGN)/i

export function parseClustal(text: string): ParsedAlignment {
  const lines = splitLines(text)
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (i >= lines.length || !HEADER.test(lines[i].trim())) {
    throw new AlignmentParseError('This is not a Clustal file: it should start with a "CLUSTAL" line')
  }
  i++
  const rows: { name: string; parts: string[] }[] = []
  let block = 0       // which block we are in
  let pos = 0         // row position within the block
  let inBlock = false
  for (; i < lines.length; i++) {
    const line = lines[i]
    // Blank lines and conservation lines (which start with whitespace) end a block.
    if (!line.trim() || /^\s/.test(line)) {
      if (inBlock) { block++; pos = 0; inBlock = false }
      continue
    }
    const fields = line.trim().split(/\s+/)
    if (fields.length < 2) continue
    const [name, seq] = fields
    inBlock = true
    if (block === 0) {
      rows.push({ name, parts: [seq] })
    } else {
      // Rows come in the same order in every block; fall back to the name if a block is ragged.
      const row = rows[pos]?.name === name ? rows[pos] : rows.find(r => r.name === name)
      if (row) row.parts.push(seq)
    }
    pos++
  }
  if (rows.length === 0) throw new AlignmentParseError('No sequences found in this Clustal file')
  return { rows: rows.map(r => ({ name: r.name, seq: r.parts.join('') })), warnings: [] }
}

export function writeClustal(doc: AlnDoc): string {
  const BLOCK = 60
  const names = doc.rows.map(r => noSpaces(r.name))
  const pad = Math.max(10, ...names.map(n => n.length)) + 4
  const w = doc.rows[0]?.seq.length ?? 0
  const p = docProfile(doc)
  const out: string[] = ['CLUSTAL multiple sequence alignment (SeqNexus)', '', '']
  for (let start = 0; start < w; start += BLOCK) {
    const end = Math.min(w, start + BLOCK)
    doc.rows.forEach((r, i) => out.push(names[i].padEnd(pad) + r.seq.slice(start, end)))
    let marks = ''
    for (let c = start; c < end; c++) marks += clustalMark(p, c, doc.kind)
    out.push(' '.repeat(pad) + marks)
    out.push('')
  }
  return out.join('\n') + '\n'
}

export const CLUSTAL: AlnFormat = {
  id: 'clustal',
  label: 'Clustal',
  extensions: ['.aln', '.clustal', '.clw'],
  description: 'Blocks with conservation marks; Clustal, MUSCLE, MAFFT, Jalview',
  parse: parseClustal,
  write: writeClustal,
}
