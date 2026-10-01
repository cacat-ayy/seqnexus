/**
 * PHYLIP: a "taxa characters" header, then the rows, either one after the
 * other (sequential) or in blocks (interleaved), with names either padded to
 * exactly ten characters (strict) or ended by whitespace (relaxed).
 *
 * Files rarely say which of the four they are, so the reader tries each and
 * keeps the first reading in which every row has the declared length.
 */

import type { AlnDoc } from '../model'
import { grouped, noSpaces, residuesOnly, splitLines, uniqueNames } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment, type WriteOptions } from './types'

type Row = { name: string; seq: string }

function splitName(line: string, strict: boolean): Row {
  if (strict) return { name: line.slice(0, 10).trim(), seq: residuesOnly(line.slice(10)) }
  const m = /^\s*(\S+)\s*(.*)$/.exec(line)
  return m ? { name: m[1], seq: residuesOnly(m[2]) } : { name: '', seq: '' }
}

function readInterleaved(lines: string[], ntax: number, strict: boolean): Row[] | null {
  if (lines.length < ntax) return null
  const rows = lines.slice(0, ntax).map(l => splitName(l, strict))
  for (let i = ntax; i < lines.length; i++) rows[(i - ntax) % ntax].seq += residuesOnly(lines[i])
  return rows
}

function readSequential(lines: string[], ntax: number, nchar: number, strict: boolean): Row[] | null {
  const rows: Row[] = []
  let i = 0
  while (rows.length < ntax && i < lines.length) {
    const row = splitName(lines[i++], strict)
    while (row.seq.length < nchar && i < lines.length) row.seq += residuesOnly(lines[i++])
    rows.push(row)
  }
  return rows.length === ntax ? rows : null
}

export function parsePhylip(text: string): ParsedAlignment {
  const all = splitLines(text)
  let h = 0
  while (h < all.length && !all[h].trim()) h++
  const header = /^\s*(\d+)\s+(\d+)/.exec(all[h] ?? '')
  if (!header) throw new AlignmentParseError('This is not a PHYLIP file: the first line should give the number of sequences and their length')
  const ntax = Number(header[1])
  const nchar = Number(header[2])
  if (ntax === 0) throw new AlignmentParseError('This PHYLIP file has no sequences')
  const lines = all.slice(h + 1).filter(l => l.trim())

  const fits = (rows: Row[] | null): rows is Row[] =>
    !!rows && rows.every(r => r.name && r.seq.length === nchar)
  const attempts: (() => Row[] | null)[] = [
    () => readInterleaved(lines, ntax, false),
    () => readSequential(lines, ntax, nchar, false),
    () => readInterleaved(lines, ntax, true),
    () => readSequential(lines, ntax, nchar, true),
  ]
  for (const attempt of attempts) {
    const rows = attempt()
    if (fits(rows)) return { rows, warnings: [] }
  }
  const rows = readSequential(lines, ntax, nchar, false) ?? readInterleaved(lines, ntax, false)
  if (!rows || rows.length === 0) throw new AlignmentParseError('Could not read the sequences in this PHYLIP file')
  return {
    rows,
    warnings: [`The sequences do not all have the ${nchar} characters the header promises; they were padded to the longest`],
  }
}

export function writePhylip(doc: AlnDoc, opts: WriteOptions = {}): string {
  const strict = opts.phylipNames === 'strict'
  const interleaved = opts.phylipLayout === 'interleaved'
  const w = doc.rows[0]?.seq.length ?? 0
  const names = strict ? uniqueNames(doc.rows.map(r => r.name), 10) : doc.rows.map(r => noSpaces(r.name))
  const pad = strict ? 10 : Math.max(...names.map(n => n.length), 0) + 2
  const out = [`${doc.rows.length} ${w}`]
  if (!interleaved) {
    doc.rows.forEach((r, i) => out.push(names[i].padEnd(pad) + r.seq))
    return out.join('\n') + '\n'
  }
  const BLOCK = 60
  for (let start = 0; start < w; start += BLOCK) {
    if (start > 0) out.push('')
    doc.rows.forEach((r, i) => {
      const chunk = grouped(r.seq.slice(start, start + BLOCK), 10)
      out.push(start === 0 ? names[i].padEnd(pad) + chunk : ' '.repeat(pad) + chunk)
    })
  }
  return out.join('\n') + '\n'
}

export const PHYLIP: AlnFormat = {
  id: 'phylip',
  label: 'PHYLIP',
  extensions: ['.phy', '.phylip', '.ph'],
  description: 'For RAxML, IQ-TREE, PhyML and PHYLIP',
  parse: parsePhylip,
  write: writePhylip,
}
