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
import { parseGenBankMulti } from './genbank'

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
