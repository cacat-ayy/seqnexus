/**
 * MEGA sequence data (.meg). MEGA also uses .meg for distance matrices,
 * which are not alignments and are refused with a clear message.
 *
 * "#label" starts a row; its residues follow on the same and later lines. A
 * label that comes back continues its row (interleaved files). "..." are
 * comments; "!command ...;" lines set the title and format.
 */

import type { AlnDoc, AlnKind } from '../model'
import { expandMatchChar, noSpaces, RowCollector, splitLines, stripBom, wrap } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment, type WriteOptions } from './types'

function stripQuotedComments(text: string): string {
  return text.replace(/"[^"]*"/g, ' ')
}

export function parseMega(text: string): ParsedAlignment {
  const src = stripQuotedComments(stripBom(text))
  if (!/^\s*#mega\b/i.test(src)) throw new AlignmentParseError('This is not a MEGA file: it should start with "#MEGA"')

  // Commands run from '!' to ';' and may span lines. Take them out first.
  const commands: string[] = []
  const data = src.replace(/^\s*#mega\b/i, '').replace(/!([^;]*);/g, (_, cmd: string) => {
    commands.push(cmd.trim())
    return '\n'
  })
  const format = commands.find(c => /^format\b/i.test(c)) ?? ''
  const opt = (key: string) => new RegExp(`\\b${key}\\s*=\\s*(\\S+)`, 'i').exec(format)?.[1]
  const dataType = (opt('datatype') ?? opt('data') ?? '').toLowerCase()
  if (dataType.startsWith('dist')) {
    throw new AlignmentParseError('This MEGA file holds a distance matrix, not sequences')
  }
  let kind: AlnKind | undefined
  if (dataType.startsWith('prot')) kind = 'protein'
  else if (dataType.startsWith('dna') || dataType.startsWith('rna') || dataType.startsWith('nuc')) kind = 'dna'
  const identical = opt('identical') ?? opt('matchchar') ?? '.'

  const rows = new RowCollector()
  let current: string | null = null
  for (const raw of splitLines(data)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const m = /^#(\S+)\s*(.*)$/.exec(line)
      if (!m) continue
      current = m[1].replace(/_/g, ' ')
      rows.add(current, m[2].replace(/\s+/g, ''))
    } else if (current) {
      rows.add(current, line.replace(/\s+/g, ''))
    }
  }
  const out = rows.rows()
  if (out.length === 0) throw new AlignmentParseError('No sequences found in this MEGA file')
  expandMatchChar(out, identical)
  return { rows: out, kind, warnings: [] }
}

export function writeMega(doc: AlnDoc, opts: WriteOptions = {}): string {
  const title = (opts.title ?? 'Alignment').replace(/[;\r\n]+/g, ' ')
  const out = [
    '#MEGA',
    `!Title ${title};`,
    `!Format DataType=${doc.kind === 'protein' ? 'Protein' : 'Nucleotide'} indel=-;`,
    '',
  ]
  for (const r of doc.rows) {
    out.push(`#${noSpaces(r.name)}`)
    out.push(...wrap(r.seq, 60))
    out.push('')
  }
  return out.join('\n')
}

export const MEGA: AlnFormat = {
  id: 'mega',
  label: 'MEGA',
  extensions: ['.meg', '.mega'],
  description: 'For MEGA phylogenetics',
  parse: parseMega,
  write: writeMega,
}
