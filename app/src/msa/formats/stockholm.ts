/**
 * Stockholm, the Pfam / Rfam / HMMER format. Annotation lines (#=GF, #=GS,
 * #=GR, #=GC) are skipped; '//' ends the alignment. Only the first alignment
 * of a multi-alignment file is read.
 */

import { consensus, docProfile } from '../stats'
import type { AlnDoc } from '../model'
import { noSpaces, RowCollector, splitLines } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment, type WriteOptions } from './types'

export function parseStockholm(text: string): ParsedAlignment {
  const lines = splitLines(text)
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (!/^#\s*STOCKHOLM/i.test(lines[i] ?? '')) {
    throw new AlignmentParseError('This is not a Stockholm file: it should start with "# STOCKHOLM 1.0"')
  }
  const rows = new RowCollector()
  const warnings: string[] = []
  for (i++; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '//') {
      if (lines.slice(i + 1).some(l => /^#\s*STOCKHOLM/i.test(l))) {
        warnings.push('The file holds more than one alignment; only the first was opened')
      }
      break
    }
    if (!line || line.startsWith('#')) continue
    const m = /^(\S+)\s+(\S+)$/.exec(line)
    if (m) rows.add(m[1], m[2])
  }
  if (rows.size === 0) throw new AlignmentParseError('No sequences found in this Stockholm file')
  return { rows: rows.rows(), warnings }
}

export function writeStockholm(doc: AlnDoc, opts: WriteOptions = {}): string {
  const names = doc.rows.map(r => noSpaces(r.name))
  const pad = Math.max(12, ...names.map(n => n.length)) + 2
  const out = ['# STOCKHOLM 1.0']
  if (opts.title) out.push(`#=GF ID ${noSpaces(opts.title)}`)
  out.push('')
  doc.rows.forEach((r, i) => out.push(names[i].padEnd(pad) + r.seq))
  out.push('#=GC seq_cons'.padEnd(pad) + consensus(docProfile(doc), doc.kind).replace(/-/g, '.'))
  out.push('//')
  return out.join('\n') + '\n'
}

export const STOCKHOLM: AlnFormat = {
  id: 'stockholm',
  label: 'Stockholm',
  extensions: ['.sto', '.stk', '.stockholm'],
  description: 'For HMMER, Pfam and Rfam',
  parse: parseStockholm,
  write: writeStockholm,
}
