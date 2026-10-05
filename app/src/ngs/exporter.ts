/**
 * Writing a read set back out as gzipped FASTQ.
 *
 * Each stored chunk becomes one gzip member, and the members are simply
 * placed one after another: a gzip file may hold several members, and every
 * gzip reader inflates them as one stream. That keeps memory to one chunk.
 */

import { gzipSync } from 'fflate'
import { decodeChunk } from './codec'

export type ExportLayout = 'pair' | 'interleaved'

/**
 * The FASTQ files' gzip members: one file for single reads or interleaved
 * mates, two (R1, R2) for a pair split into mates.
 */
export async function exportFastq(opts: {
  chunks: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  paired: boolean
  layout: ExportLayout
  onProgress?: (done: number, total: number) => void
}): Promise<Uint8Array[][]> {
  const split = opts.paired && opts.layout === 'pair'
  const files: Uint8Array[][] = split ? [[], []] : [[]]
  const enc = new TextEncoder()
  for (let c = 0; c < opts.chunks; c++) {
    const packed = await opts.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const chunk = decodeChunk(packed)
    const text: string[][] = files.map(() => [])
    for (let i = 0; i < chunk.count; i++) {
      const out = split ? text[i & 1] : text[0]
      out.push(`@${chunk.ids[i]}\n${chunk.seq(i)}\n+\n${chunk.qualText(i)}\n`)
    }
    text.forEach((t, f) => { if (t.length) files[f].push(gzipSync(enc.encode(t.join('')), { level: 6 })) })
    opts.onProgress?.(c + 1, opts.chunks)
  }
  return files
}
