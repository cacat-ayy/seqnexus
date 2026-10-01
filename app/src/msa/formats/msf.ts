/**
 * GCG MSF. A header with one "Name:" line per sequence, a '//' line, then
 * blocks of named, space-grouped residues with '.' (or '~') for gaps.
 */

import type { AlnDoc } from '../model'
import { grouped, noSpaces, RowCollector, splitLines } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment, type WriteOptions } from './types'

/** GCG's checksum of one sequence as written. */
export function gcgChecksum(seq: string): number {
  const s = seq.toUpperCase()
  let check = 0
  for (let i = 0; i < s.length; i++) {
    check = (check + ((i % 57) + 1) * s.charCodeAt(i)) % 10000
  }
  return check
}

export function parseMsf(text: string): ParsedAlignment {
  const lines = splitLines(text)
  const sep = lines.findIndex(l => l.trim() === '//')
  if (sep === -1) throw new AlignmentParseError('This is not an MSF file: it has no "//" line ending the header')
  const header = lines.slice(0, sep)
  const names: string[] = []
  for (const l of header) {
    const m = /^\s*Name:\s+(\S+)/i.exec(l)
    if (m) names.push(m[1])
  }
  if (names.length === 0) throw new AlignmentParseError('This MSF file lists no sequences ("Name:" lines)')
  const known = new Set(names)
  const rows = new RowCollector()
  for (const n of names) rows.add(n, '')
  for (const l of lines.slice(sep + 1)) {
    const m = /^\s*(\S+)\s+(.*)$/.exec(l)
    if (!m || !known.has(m[1])) continue
    rows.add(m[1], m[2].replace(/\s+/g, ''))
  }
  const type = /\bType:\s*([NP])/i.exec(header.join('\n'))?.[1]?.toUpperCase()
  return { rows: rows.rows(), kind: type === 'P' ? 'protein' : type === 'N' ? 'dna' : undefined, warnings: [] }
}

export function writeMsf(doc: AlnDoc, opts: WriteOptions = {}): string {
  const w = doc.rows[0]?.seq.length ?? 0
  const names = doc.rows.map(r => noSpaces(r.name))
  const seqs = doc.rows.map(r => r.seq.replace(/-/g, '.'))
  const checks = seqs.map(gcgChecksum)
  const total = checks.reduce((a, b) => (a + b) % 10000, 0)
  const type = doc.kind === 'protein' ? 'P' : 'N'
  const pad = Math.max(10, ...names.map(n => n.length)) + 2
  const out = [
    doc.kind === 'protein' ? '!!AA_MULTIPLE_ALIGNMENT 1.0' : '!!NA_MULTIPLE_ALIGNMENT 1.0',
    '',
    ` ${noSpaces(opts.title ?? 'alignment')}.msf  MSF: ${w}  Type: ${type}  Check: ${total} ..`,
    '',
    ...names.map((n, i) => ` Name: ${n.padEnd(pad)} Len: ${w}  Check: ${checks[i]}  Weight: 1.00`),
    '',
    '//',
    '',
  ]
  const BLOCK = 50
  for (let start = 0; start < w; start += BLOCK) {
    names.forEach((n, i) => out.push(n.padEnd(pad) + grouped(seqs[i].slice(start, start + BLOCK), 10)))
    out.push('')
  }
  return out.join('\n')
}

export const MSF: AlnFormat = {
  id: 'msf',
  label: 'GCG MSF',
  extensions: ['.msf'],
  description: 'For GCG, Jalview and older tools',
  parse: parseMsf,
  write: writeMsf,
}
