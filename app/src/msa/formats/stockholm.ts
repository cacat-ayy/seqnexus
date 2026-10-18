/**
 * Stockholm, the Pfam / Rfam / HMMER format. Annotation lines (#=GF, #=GS,
 * #=GR, #=GC) are skipped; '//' ends the alignment. Only the first alignment
 * of a multi-alignment file is read.
 *
 * A row cut from the middle of its source keeps its numbering the way Pfam
 * writes it, as `name/start-end` (1-based, inclusive, residues not gaps).
 * The reader takes such a suffix off the name and back into the row's start
 * when its numbers agree with the row's residue count.
 */

import { consensus, docProfile } from '../stats'
import { ungapped, type AlnDoc } from '../model'
import { noSpaces, RowCollector, splitLines, uniqueNames } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment, type WriteOptions } from './types'

/** A name's `/start-end` numbering, when it has one. */
const NUMBERED = /^(.+)\/(\d+)-(\d+)$/

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
  return {
    rows: rows.rows().map(r => {
      const m = NUMBERED.exec(r.name)
      if (!m) return r
      const start = Number(m[2])
      const end = Number(m[3])
      const residues = ungapped(r.seq.replace(/\./g, '-')).length
      return end - start + 1 === residues ? { name: m[1], seq: r.seq, start } : r
    }),
    warnings,
  }
}

export function writeStockholm(doc: AlnDoc, opts: WriteOptions = {}): string {
  // Names must be unique within a block; a row cut from a longer
  // sequence carries its numbering, which often tells two apart by itself.
  const plain = uniqueNames(doc.rows.map(r => r.name))
  const names = doc.rows.map((r, i) => {
    if (r.start === undefined || r.start === 1) return plain[i]
    const residues = ungapped(r.seq).length
    return `${plain[i]}/${r.start}-${r.start + residues - 1}`
  })
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
