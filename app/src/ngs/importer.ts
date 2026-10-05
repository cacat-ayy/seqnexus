/**
 * Importing read files into a read set: stream each file, decompress it if
 * it is gzipped, parse the records, check that mates match, gather QC
 * figures, and store the reads in chunks. Nothing holds more than one
 * chunk of reads at a time, so file size is bounded by storage, not memory.
 *
 * Gzip is inflated with fflate, which handles files made of several gzip
 * members one after another. Illumina's .fastq.gz files are usually BGZF,
 * which is exactly that.
 */

import { Gunzip } from 'fflate'
import { ReadStreamParser, readId, type RawRead } from './fastq-stream'
import { encodeChunk, type ReadInput } from './codec'
import { StatsAccumulator } from './stats'
import { areMates } from './detect'
import { isLongRead, type ReadSetStats, type Technology } from './types'

/** Reads per stored chunk (an even number, so a pair never straddles two). */
export const CHUNK_READS = 16384

/** A file, or anything else with a name, a size and a byte stream. */
export interface ReadSource {
  name: string
  size: number
  stream(): ReadableStream<Uint8Array>
}

export type ReadLayout = 'single' | 'pair' | 'interleaved'

/** Where finished chunks go. */
export type PutChunk = (index: number, data: Uint8Array) => Promise<void>

export interface ImportResult {
  stats: ReadSetStats
  chunks: number
  storedBytes: number
}

/** Records from one source, a batch at a time. `onBytes` reports compressed bytes read. */
export async function* readBatches(src: ReadSource, onBytes?: (n: number) => void): AsyncGenerator<RawRead[]> {
  const reader = src.stream().getReader()
  const parser = new ReadStreamParser()
  const decoder = new TextDecoder()
  let gunzip: Gunzip | null = null
  let first = true
  let out: RawRead[] = []
  const takeText = (bytes: Uint8Array, final: boolean) => {
    parser.push(decoder.decode(bytes, { stream: !final }), out)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value || value.length === 0) continue
    onBytes?.(value.length)
    if (first) {
      first = false
      if (value[0] === 0x1f && value[1] === 0x8b) gunzip = new Gunzip(chunk => takeText(chunk, false))
    }
    if (gunzip) gunzip.push(value, false)
    else takeText(value, false)
    if (out.length) { yield out; out = [] }
  }
  if (gunzip) gunzip.push(new Uint8Array(0), true)
  takeText(new Uint8Array(0), true)
  parser.end(out)
  if (out.length) yield out
}

/** Reads of a layout, mates next to each other, a batch at a time. */
async function* layoutReads(
  sources: readonly ReadSource[],
  layout: ReadLayout,
  onBytes: (n: number) => void,
): AsyncGenerator<RawRead[]> {
  if (layout === 'pair') {
    const [a, b] = [readBatches(sources[0], onBytes), readBatches(sources[1], onBytes)]
    let qa: RawRead[] = []
    let qb: RawRead[] = []
    let ia = 0
    let ib = 0
    let doneA = false
    let doneB = false
    let pairs = 0
    for (;;) {
      if (ia >= qa.length && !doneA) { const r = await a.next(); if (r.done) doneA = true; else { qa = r.value; ia = 0 } }
      if (ib >= qb.length && !doneB) { const r = await b.next(); if (r.done) doneB = true; else { qb = r.value; ib = 0 } }
      const leftA = qa.length - ia
      const leftB = qb.length - ib
      if (leftA === 0 && leftB === 0 && doneA && doneB) return
      if ((leftA === 0 && doneA) || (leftB === 0 && doneB)) {
        throw new Error(`${sources[0].name} and ${sources[1].name} have different numbers of reads`)
      }
      const n = Math.min(leftA, leftB)
      // One side is empty but not finished: refill it first.
      if (n === 0) continue
      const batch: RawRead[] = []
      for (let k = 0; k < n; k++, ia++, ib++) {
        const r1 = qa[ia]
        const r2 = qb[ib]
        if (!areMates(r1, r2)) {
          throw new Error(`Read ${pairs + k + 1} is "${readId(r1.header)}" in ${sources[0].name} but "${readId(r2.header)}" in ${sources[1].name}: the files are not two mates of one run in the same order`)
        }
        batch.push(r1, r2)
      }
      pairs += n
      yield batch
    }
  }
  let pending: RawRead | null = null
  let index = 0
  for await (const batch of readBatches(sources[0], onBytes)) {
    if (layout === 'interleaved') {
      const out: RawRead[] = []
      for (const r of batch) {
        index++
        if (!pending) { pending = r; continue }
        if (!areMates(pending, r)) {
          throw new Error(`Reads ${index - 1} and ${index} ("${readId(pending.header)}", "${readId(r.header)}") are not mates: the file is not interleaved`)
        }
        out.push(pending, r)
        pending = null
      }
      if (out.length) yield out
    } else {
      yield batch
    }
  }
  if (pending) throw new Error(`The last read, "${readId(pending.header)}", has no mate: the file is not interleaved`)
}

/** Collects reads into chunks and stores each one as it fills. */
export class ChunkWriter {
  private buffer: ReadInput[] = []
  chunks = 0
  storedBytes = 0
  private readonly put: PutChunk
  private readonly size: number

  constructor(put: PutChunk, size = CHUNK_READS) {
    this.put = put
    this.size = size
  }

  async add(r: ReadInput): Promise<void> {
    this.buffer.push(r)
    if (this.buffer.length >= this.size) await this.flush()
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const data = encodeChunk(this.buffer)
    this.buffer = []
    await this.put(this.chunks++, data)
    this.storedBytes += data.length
  }
}

export async function importReads(opts: {
  sources: readonly ReadSource[]
  layout: ReadLayout
  technology: Technology
  put: PutChunk
  chunkReads?: number
  onProgress?: (bytes: number, total: number) => void
}): Promise<ImportResult> {
  const total = opts.sources.reduce((n, s) => n + s.size, 0)
  let read = 0
  const paired = opts.layout !== 'single'
  const stats = new StatsAccumulator(isLongRead(opts.technology), paired ? 2 : 1)
  const writer = new ChunkWriter(opts.put, opts.chunkReads)
  let k = 0
  for await (const batch of layoutReads(opts.sources, opts.layout, n => { read += n; opts.onProgress?.(read, total) })) {
    for (const r of batch) {
      stats.add(r.seq, r.qual, paired ? k & 1 : 0)
      k++
      await writer.add({ id: readId(r.header), seq: r.seq, qual: r.qual })
    }
  }
  await writer.flush()
  return { stats: stats.finish(), chunks: writer.chunks, storedBytes: writer.storedBytes }
}
