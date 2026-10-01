/**
 * NEXUS: the DATA (or CHARACTERS) block of a NEXUS file.
 *
 * Handles [comments], 'quoted names', interleaved matrices, MATCHCHAR and
 * {AG} / (AG) polymorphisms. Other blocks (TREES, ASSUMPTIONS, ...) are
 * skipped.
 */

import { codeForBits, baseBits } from '../iupac'
import type { AlnDoc, AlnKind } from '../model'
import { expandMatchChar, RowCollector, stripBom } from './util'
import { AlignmentParseError, type AlnFormat, type ParsedAlignment } from './types'

/** Remove [comments], which may nest. Quoted text is left alone. */
function stripComments(text: string): string {
  let out = ''
  let depth = 0
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (depth === 0 && ch === "'") quoted = !quoted
    if (!quoted && ch === '[') { depth++; continue }
    if (!quoted && ch === ']' && depth > 0) { depth--; continue }
    if (depth === 0) out += ch
  }
  return out
}

/** Split into whitespace-separated tokens, keeping 'quoted words' (with '' as an escaped quote) whole. */
function tokens(line: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++
    if (i >= line.length) break
    if (line[i] === "'") {
      let s = ''
      i++
      while (i < line.length) {
        if (line[i] === "'" && line[i + 1] === "'") { s += "'"; i += 2; continue }
        if (line[i] === "'") { i++; break }
        s += line[i++]
      }
      out.push(s)
    } else {
      let s = ''
      while (i < line.length && !/\s/.test(line[i])) s += line[i++]
      out.push(s)
    }
  }
  return out
}

/** Turn {AG} / (AG) into one ambiguity code (or X for protein). */
function collapsePolymorphisms(seq: string, kind: AlnKind | undefined): string {
  return seq.replace(/[{(]([^})]*)[})]/g, (_, inner: string) => {
    if (kind === 'protein') return 'X'
    let bits = 0
    for (const ch of inner.toUpperCase()) bits |= baseBits(ch)
    return bits ? codeForBits(bits) : 'N'
  })
}

function option(format: string, key: string): string | undefined {
  const m = new RegExp(`\\b${key}\\s*=\\s*("[^"]*"|'[^']*'|\\S+)`, 'i').exec(format)
  if (!m) return undefined
  return m[1].replace(/^["']|["']$/g, '').replace(/;$/, '')
}

export function parseNexus(text: string): ParsedAlignment {
  const src = stripComments(stripBom(text))
  if (!/^\s*#NEXUS/i.test(src)) throw new AlignmentParseError('This is not a NEXUS file: it should start with "#NEXUS"')
  const block = /\bbegin\s+(data|characters)\s*;([\s\S]*?)\bend(block)?\s*;/i.exec(src)
  if (!block) throw new AlignmentParseError('This NEXUS file has no DATA or CHARACTERS block')
  const body = block[2]

  const dims = /\bdimensions\b([^;]*);/i.exec(body)?.[1] ?? ''
  const nchar = Number(option(dims, 'nchar') ?? NaN)
  const format = /\bformat\b([^;]*);/i.exec(body)?.[1] ?? ''
  const datatype = (option(format, 'datatype') ?? '').toLowerCase()
  const matchChar = option(format, 'matchchar') ?? ''
  const interleave = /\binterleave\b(?!\s*=\s*no)/i.test(format)
  let kind: AlnKind | undefined
  if (datatype === 'protein') kind = 'protein'
  else if (datatype === 'dna' || datatype === 'rna' || datatype === 'nucleotide') kind = 'dna'

  const matrix = /\bmatrix\b([\s\S]*?);/i.exec(body)?.[1]
  if (matrix === undefined) throw new AlignmentParseError('This NEXUS file has no MATRIX')

  const rows = new RowCollector()
  const lines = matrix.split(/\r\n|\r|\n/).map(tokens).filter(t => t.length > 0)
  if (interleave || !Number.isFinite(nchar)) {
    for (const t of lines) rows.add(t[0], t.slice(1).join(''))
  } else {
    // Sequential: a name, then sequence tokens (possibly over several lines) until nchar is reached.
    const flat = lines.flat()
    let i = 0
    while (i < flat.length) {
      const name = flat[i++]
      let seq = ''
      while (i < flat.length && collapsePolymorphisms(seq, kind).length < nchar) seq += flat[i++]
      rows.add(name, seq)
    }
  }
  const out = rows.rows().map(r => ({ name: r.name, seq: collapsePolymorphisms(r.seq, kind) }))
  if (out.length === 0) throw new AlignmentParseError('The MATRIX in this NEXUS file is empty')
  if (matchChar) expandMatchChar(out, matchChar)
  const warnings: string[] = []
  if (Number.isFinite(nchar) && out.some(r => r.seq.length !== nchar)) {
    warnings.push(`Not every sequence has the ${nchar} characters the file declares`)
  }
  return { rows: out, kind, warnings }
}

function quoteName(name: string): string {
  return /^[A-Za-z0-9_.|-]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

export function writeNexus(doc: AlnDoc): string {
  const w = doc.rows[0]?.seq.length ?? 0
  const names = doc.rows.map(r => quoteName(r.name))
  const pad = Math.max(...names.map(n => n.length), 0) + 2
  const out = [
    '#NEXUS',
    '',
    'BEGIN DATA;',
    `  DIMENSIONS NTAX=${doc.rows.length} NCHAR=${w};`,
    `  FORMAT DATATYPE=${doc.kind === 'protein' ? 'PROTEIN' : 'DNA'} MISSING=? GAP=-;`,
    '  MATRIX',
    ...doc.rows.map((r, i) => `    ${names[i].padEnd(pad)}${r.seq}`),
    '  ;',
    'END;',
  ]
  return out.join('\n') + '\n'
}

export const NEXUS: AlnFormat = {
  id: 'nexus',
  label: 'NEXUS',
  extensions: ['.nex', '.nexus', '.nxs'],
  description: 'For MrBayes, PAUP*, BEAST and SplitsTree',
  parse: parseNexus,
  write: writeNexus,
}
