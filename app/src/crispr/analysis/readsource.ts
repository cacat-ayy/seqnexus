/**
 * Getting amplicon reads out of a read set.
 *
 * Every read is aligned against the amplicon, which is accurate and not
 * cheap, so a run takes a sample rather than the lot. A few thousand reads
 * settle the shares of an allele table to well inside the uncertainty of the
 * experiment, and the panel says how many it used so the number is never
 * mistaken for the whole file.
 */

import { decodeChunk } from '../../ngs/codec'
import { getReadChunk } from '../../storage/idb'

export interface ReadSample {
  reads: string[]
  /** Reads in the set, when it is known. */
  available: number
  /** Whether the sample stopped short of the whole set. */
  sampled: boolean
}

export const DEFAULT_SAMPLE = 2000
export const MAX_SAMPLE = 20000

/**
 * Read up to `limit` reads from a stored read set.
 *
 * Reads shorter than `minLength` are left out here rather than in the
 * caller: a read too short to span the window around the cut cannot say
 * anything about it, and carrying it further only inflates the count of
 * reads thrown away later.
 */
export async function sampleReadSet(
  id: string,
  chunks: number,
  limit = DEFAULT_SAMPLE,
  minLength = 0,
): Promise<ReadSample> {
  const reads: string[] = []
  let available = 0
  for (let i = 0; i < chunks; i++) {
    const packed = await getReadChunk(id, i)
    if (!packed) continue
    const chunk = decodeChunk(packed)
    available += chunk.count
    for (let k = 0; k < chunk.count; k++) {
      if (reads.length >= limit) continue
      if (chunk.length(k) < minLength) continue
      reads.push(chunk.seq(k))
    }
    // Keep counting what is there even once the sample is full, so the panel
    // can say what share of the set it looked at.
    if (reads.length >= limit && i === chunks - 1) break
  }
  return { reads, available, sampled: reads.length < available }
}

/** Reads from pasted text: FASTA, FASTQ or one sequence per line. */
export function readsFromText(text: string, minLength = 0): string[] {
  const lines = text.split(/\r?\n/)
  const reads: string[] = []
  let current = ''
  let inFastqSequence = false
  let skipQuality = 0

  const flush = () => {
    const seq = current.toUpperCase().replace(/[^ACGTN]/g, '')
    if (seq.length >= minLength && seq.length > 0) reads.push(seq)
    current = ''
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (skipQuality > 0) { skipQuality--; continue }
    if (line.startsWith('@') && !inFastqSequence) {
      flush()
      inFastqSequence = true
      continue
    }
    if (line.startsWith('+') && inFastqSequence) {
      flush()
      inFastqSequence = false
      skipQuality = 1
      continue
    }
    if (line.startsWith('>')) {
      flush()
      inFastqSequence = false
      continue
    }
    current += line
  }
  flush()
  return reads
}
