/**
 * A look at the first reads of a file, for the import dialog to guess the
 * technology and spot interleaved mates before anything is imported.
 */

import { Gunzip } from 'fflate'
import { ReadStreamParser, type RawRead } from './fastq-stream'
import { isReadFile } from './detect'

export interface Peek {
  reads: RawRead[]
  gz: boolean
  /** Why the file could not be read as reads. */
  error?: string
}

/** The whole records within the first `bytes` of the file (inflated first if gzipped). */
/** Bytes peekReads looks at: a file no larger than this is read whole, so a peek with no reads means the file has none. */
export const PEEK_BYTES = 512 * 1024

export async function peekReads(file: Blob, bytes = PEEK_BYTES): Promise<Peek> {
  const head = new Uint8Array(await file.slice(0, bytes).arrayBuffer())
  const gz = head[0] === 0x1f && head[1] === 0x8b
  let text = ''
  try {
    if (gz) {
      const parts: Uint8Array[] = []
      const g = new Gunzip(chunk => { parts.push(chunk) })
      // Not final: the file goes on past this slice.
      g.push(head, false)
      const dec = new TextDecoder()
      text = parts.map(p => dec.decode(p, { stream: true })).join('')
    } else {
      text = new TextDecoder().decode(head)
    }
    const parser = new ReadStreamParser()
    const reads: RawRead[] = []
    // Only whole records: the last one is probably cut off by the slice.
    parser.push(text.slice(0, text.lastIndexOf('\n') + 1), reads)
    if (head.length < bytes || file.size <= bytes) parser.end(reads)
    return { reads, gz }
  } catch (err) {
    return { reads: [], gz, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Files to import as read sets rather than open as sequences. */
export const NGS_SMALL_BYTES = 256 * 1024
export const NGS_FEW_RECORDS = 20

/** Gzipped reads, or a FASTQ file too big to be a handful of sequences. */
export function isNgsByName(file: { name: string; size: number }): boolean {
  if (!isReadFile(file.name)) return false
  if (/\.gz$/i.test(file.name)) return true
  return /\.(f(ast)?q)$/i.test(file.name) && file.size > NGS_SMALL_BYTES
}

/** How many records a FASTQ or FASTA text holds; -1 if it does not parse. */
export function countRecords(text: string): number {
  try {
    const parser = new ReadStreamParser()
    const out: RawRead[] = []
    parser.push(text, out)
    parser.end(out)
    return out.length
  } catch {
    return -1
  }
}
