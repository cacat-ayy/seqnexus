/**
 * EMBL flat files (ENA's format), read by rewriting them in GenBank's layout
 * and handing that to the GenBank reader.
 *
 * The two formats carry the same INSDC feature table: the same feature keys,
 * location syntax and qualifiers. Only the line prefixes differ. An EMBL
 * feature line is "FT   CDS             join(..)" where GenBank has five
 * spaces, and a qualifier line is "FT" plus 19 spaces where GenBank has 21,
 * so swapping "FT" for two spaces gives GenBank's columns exactly. Reusing
 * the GenBank reader means locations, joins, origin-spanning features and
 * qualifier quoting behave identically for both formats, which a second
 * parser could only approximate.
 *
 * Mapped: ID (name, topology, length and molecule) to LOCUS, DE to
 * DEFINITION, FT to the feature table, SQ to ORIGIN. Everything else (AC,
 * OS, references, cross-references) is left out, as the GenBank reader
 * leaves its own counterparts out.
 * See: https://ftp.ebi.ac.uk/pub/databases/embl/doc/usrman.txt
 */

import type { DocumentState } from '../models/Document'
import { parseGenBankMulti, writeGenBank } from './genbank'

/** Does this text start like an EMBL record? */
export function looksLikeEmbl(text: string): boolean {
  return /^ID {3}\S/.test(text.trimStart())
}

/** Rewrite EMBL records as GenBank text. */
export function emblToGenBank(text: string): string {
  const out: string[] = []
  let inFeatures = false
  /** The record has had its first DE line; later ones continue it. */
  let described = false
  for (const raw of text.split(/\r?\n/)) {
    const tag = raw.slice(0, 2)
    const body = raw.slice(5)
    if (tag === 'ID') {
      // "ID   X56734; SV 1; linear; mRNA; STD; PLN; 1859 BP."
      const fields = body.split(';').map(f => f.trim())
      const name = fields[0] || 'Untitled'
      const circular = fields.some(f => /^circular$/i.test(f))
      const len = /(\d+)\s+(BP|AA)\b/i.exec(body)
      const protein = len?.[2].toUpperCase() === 'AA'
      const length = len ? len[1] : '0'
      out.push(`LOCUS       ${name} ${length} ${protein ? 'aa' : 'bp'}    ${protein ? '' : 'DNA     '}${circular ? 'circular' : 'linear'}`)
      inFeatures = false
      described = false
    } else if (tag === 'DE') {
      out.push(`${described ? '            ' : 'DEFINITION  '}${body.trim()}`)
      described = true
    } else if (tag === 'FT') {
      if (!inFeatures) {
        out.push('FEATURES             Location/Qualifiers')
        inFeatures = true
      }
      out.push(`  ${raw.slice(2)}`)
    } else if (tag === 'SQ') {
      out.push('ORIGIN')
    } else if (raw.startsWith('//')) {
      out.push('//')
      inFeatures = false
    } else if (/^\s/.test(raw) && raw.trim()) {
      // Sequence lines: residues in blocks with a count at the end, which
      // the GenBank reader strips along with the spaces.
      out.push(raw)
    }
  }
  return out.join('\n')
}

/** Read every record of an EMBL file. */
export function parseEmbl(text: string, warnings?: string[]): DocumentState[] {
  return parseGenBankMulti(emblToGenBank(text), warnings)
}

/** Text after a two-letter line code, wrapped at 80 columns. */
function tagged(tag: string, text: string): string[] {
  const out: string[] = []
  const room = 80 - 5
  let line = ''
  // A word longer than a line of its own is broken: every line of an EMBL
  // record has to fit 80 columns, and a description is free text, so a
  // break in an unbroken 200-character run costs nothing a reader minds.
  const words = text.split(/\s+/).filter(Boolean).flatMap(w => (w.length <= room ? [w] : w.match(new RegExp(`.{1,${room}}`, 'g')) ?? [w]))
  for (const word of words) {
    if (line && 5 + line.length + 1 + word.length > 80) { out.push(`${tag}   ${line}`); line = word }
    else line = line ? `${line} ${word}` : word
  }
  out.push(`${tag}   ${line}`)
  return out
}

/**
 * A DNA document as an EMBL record. The feature table is the GenBank
 * writer's, with its five-space prefix turned into EMBL's "FT   " (the same
 * columns, the reverse of what the reader does), so features, joins,
 * primers and colours are written exactly as in a GenBank export.
 *
 * The ID line gives the name, topology, molecule (the source's /mol_type,
 * or "other DNA"), data class STD and division SYN; SQ counts the bases,
 * and sequence lines hold sixty in blocks of ten with the count of the last
 * one in columns 73 to 80.
 */
export function writeEmbl(doc: DocumentState): string {
  const seq = doc.sequence
  const bases = seq.bases
  const name = doc.name.trim().replace(/\s+/g, '_') || 'Untitled'
  const molType = doc.metadata?.source?.[0]?.mol_type?.[0] ?? 'other DNA'
  const out: string[] = [
    `ID   ${name}; SV 1; ${seq.topology === 'circular' ? 'circular' : 'linear'}; ${molType}; STD; SYN; ${bases.length} BP.`,
    'XX',
    // An AC line is required exactly once (ENA's flat-file checker, FF.5).
    // A sequence of one's own has no accession, so the list is empty, which
    // is what ENA's own submission template writes.
    'AC   ;',
    'XX',
    ...tagged('DE', (doc.description || doc.name).replace(/[\r\n\t]+/g, ' ')),
    'XX',
  ]

  // The feature table as GenBank writes it, between FEATURES and ORIGIN.
  const gb = writeGenBank(doc).split('\n')
  const from = gb.findIndex(l => l.startsWith('FEATURES'))
  const to = gb.findIndex(l => l.startsWith('ORIGIN'))
  const table = gb.slice(from + 1, to)
  if (table.length > 0) {
    out.push('FH   Key             Location/Qualifiers', 'FH')
    for (const line of table) out.push(`FT${line.slice(2)}`)
    out.push('XX')
  }

  const counts = { A: 0, C: 0, G: 0, T: 0 }
  for (const b of bases.toUpperCase()) if (b in counts) counts[b as keyof typeof counts]++
  const other = bases.length - counts.A - counts.C - counts.G - counts.T
  out.push(`SQ   Sequence ${bases.length} BP; ${counts.A} A; ${counts.C} C; ${counts.G} G; ${counts.T} T; ${other} other;`)
  const lower = bases.toLowerCase()
  for (let i = 0; i < lower.length; i += 60) {
    const blocks: string[] = []
    for (let j = i; j < Math.min(i + 60, lower.length); j += 10) blocks.push(lower.slice(j, j + 10))
    out.push(`     ${blocks.join(' ').padEnd(65)}${String(Math.min(i + 60, lower.length)).padStart(10)}`)
  }
  out.push('//')
  return out.join('\n') + '\n'
}
