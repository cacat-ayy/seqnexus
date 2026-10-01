/**
 * Alignment file formats: detection, reading into a document, writing.
 *
 * The format is decided by the file's content first and its extension only
 * when the content does not say (a bare PHYLIP header is the main case).
 */

import { makeDoc, type AlnDoc } from '../model'
import { CLUSTAL } from './clustal'
import { FASTA } from './fasta'
import { MEGA } from './mega'
import { MSF } from './msf'
import { NEXUS } from './nexus'
import { PHYLIP } from './phylip'
import { PIR } from './pir'
import { STOCKHOLM } from './stockholm'
import { AlignmentParseError, type AlnFormat, type AlnFormatId, type WriteOptions } from './types'
import { stripBom } from './util'

export type { AlnFormat, AlnFormatId, WriteOptions } from './types'
export { AlignmentParseError } from './types'

/** In the order offered for export. */
export const ALN_FORMATS: readonly AlnFormat[] = [FASTA, CLUSTAL, PHYLIP, NEXUS, MEGA, STOCKHOLM, PIR, MSF]

const BY_ID = new Map(ALN_FORMATS.map(f => [f.id, f]))

export function alnFormat(id: AlnFormatId): AlnFormat {
  return BY_ID.get(id)!
}

/** Every extension an alignment file might have, for file pickers. */
export const ALN_EXTENSIONS: readonly string[] = [...new Set(ALN_FORMATS.flatMap(f => f.extensions))]

/** Extensions that only ever mean an alignment (unlike .fasta or .txt). */
export const ALIGNMENT_ONLY_EXTENSIONS: readonly string[] = ALN_FORMATS
  .filter(f => f.id !== 'fasta')
  .flatMap(f => f.extensions)

function extensionOf(fileName: string | undefined): string {
  const m = /\.[^./\\]+$/.exec(fileName ?? '')
  return m ? m[0].toLowerCase() : ''
}

/** Which format a file is in, from its content, then its name. Null if it is none of them. */
export function detectFormat(text: string, fileName?: string): AlnFormatId | null {
  const head = stripBom(text).trimStart().slice(0, 4000)
  if (/^#NEXUS/i.test(head)) return 'nexus'
  if (/^#mega\b/i.test(head)) return 'mega'
  if (/^#\s*STOCKHOLM/i.test(head)) return 'stockholm'
  if (/^(CLUSTAL|MUSCLE|PROBCONS|MSAPROBS|KALIGN)/i.test(head)) return 'clustal'
  if (/^!!(NA|AA)_MULTIPLE_ALIGNMENT/i.test(head) || (/MSF:\s*\d+/i.test(head) && /^\s*\/\/\s*$/m.test(head))) return 'msf'
  if (/^>[A-Z][A-Z0-9];/i.test(head)) return 'pir'
  if (head.startsWith('>')) return 'fasta'
  if (/^\d+\s+\d+/.test(head)) return 'phylip'
  const ext = extensionOf(fileName)
  return ALN_FORMATS.find(f => f.id !== 'fasta' && f.extensions.includes(ext))?.id ?? null
}

export interface ReadResult {
  doc: AlnDoc
  format: AlnFormat
  warnings: string[]
  /**
   * False when the rows were of different lengths: a FASTA file of unaligned
   * sequences, most likely, which the caller may offer to align.
   */
  aligned: boolean
}

/** Read an alignment file. Throws AlignmentParseError with a readable message. */
export function readAlignment(text: string, fileName?: string): ReadResult {
  const id = detectFormat(text, fileName)
  if (!id) throw new AlignmentParseError('This file is not in an alignment format SeqNexus can read')
  const format = alnFormat(id)
  const parsed = format.parse(text)
  const rows = parsed.rows.filter(r => r.seq.length > 0 || parsed.rows.length === 1)
  if (rows.length === 0) throw new AlignmentParseError(`No sequences found in this ${format.label} file`)
  const lengths = new Set(rows.map(r => r.seq.replace(/\s+/g, '').length))
  const aligned = lengths.size === 1
  const warnings = [...parsed.warnings]
  if (!aligned && id !== 'fasta' && warnings.length === 0) {
    warnings.push('The sequences have different lengths; the shorter ones were padded with gaps')
  }
  const doc = makeDoc(rows, {
    method: 'import',
    format: format.label,
    file: fileName,
    at: Date.now(),
  }, parsed.kind)
  if (!fileName) delete doc.origin.file
  return { doc, format, warnings, aligned }
}

export function writeAlignment(doc: AlnDoc, id: AlnFormatId, opts?: WriteOptions): string {
  return alnFormat(id).write(doc, opts)
}

/**
 * Whether a FASTA text is an alignment rather than a set of sequences: at
 * least two records, all the same length, with at least one gap.
 */
export function fastaLooksAligned(text: string): boolean {
  const recs = FASTA.parse(text).rows
  if (recs.length < 2) return false
  const len = recs[0].seq.length
  return recs.every(r => r.seq.length === len) && recs.some(r => /[-.]/.test(r.seq))
}
