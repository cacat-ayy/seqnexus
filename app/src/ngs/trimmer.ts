/**
 * Trimming and filtering a read set into a new one.
 *
 * Short reads go through fastp (WebAssembly, one batch of reads at a time):
 * adapters found by overlapping the two mates of a pair, or by fastp's
 * adapter detection for single reads; quality trimmed from both ends with a
 * 4-base sliding window; reads shorter than the minimum dropped, with their
 * mate. fastp's own defaults stay on: reads with more than 40% of bases below
 * Q15 or more than 5 N are dropped, and poly-G tails are cut on NovaSeq and
 * NextSeq data (two-colour chemistry calls G where there is no signal).
 *
 * Long reads are filtered here instead, by length and mean read quality:
 * fastp's short-read model does not fit them, and current basecallers
 * already cut the sequencing adapters.
 */

import { decodeChunk } from './codec'
import { ChunkWriter, type ImportResult, type PutChunk } from './importer'
import { ReadStreamParser, readId, type RawRead } from './fastq-stream'
import { StatsAccumulator } from './stats'
import { QcAccumulator } from './qcreport/accumulator'
import { isLongRead, type Technology, type TrimSettings } from './types'

export type FastpRunner = (
  args: string[],
  files: Record<string, string>,
  outputs: string[],
) => Promise<{ exitCode: number; stderr: string; files: Record<string, string | null> }>

/** Reads per fastp run: large enough for adapter detection, small enough for memory. */
export const FASTP_BATCH = 100_000

export function fastpArgs(s: TrimSettings, paired: boolean): string[] {
  const args = ['-i', 'in1.fq', '-o', 'out1.fq']
  if (paired) args.push('-I', 'in2.fq', '-O', 'out2.fq')
  args.push('-j', 'report.json', '-h', 'report.html', '-w', '1')
  if (!s.adapters) args.push('-A')
  else if (paired) args.push('--detect_adapter_for_pe')
  if (s.windowQuality > 0) args.push('--cut_front', '--cut_tail', '-W', '4', '-M', String(s.windowQuality))
  args.push('-l', String(Math.max(1, s.minLength)))
  return args
}

/** Mean read quality from error probabilities (see stats.ts). */
function meanReadQuality(qual: Uint8Array, from: number, to: number): number {
  if (to <= from) return 0
  let err = 0
  for (let p = from; p < to; p++) err += 10 ** (-qual[p] / 10)
  return -10 * Math.log10(err / (to - from))
}

export interface TrimResult extends ImportResult {
  readsBefore: number
  basesBefore: number
  adapterTrimmedReads?: number
}

export async function trimReads(opts: {
  chunks: number
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  paired: boolean
  technology: Technology
  settings: TrimSettings
  put: PutChunk
  fastp?: FastpRunner
  batchReads?: number
  onProgress?: (done: number, total: number) => void
}): Promise<TrimResult> {
  const { settings: s, paired } = opts
  const stats = new StatsAccumulator(isLongRead(opts.technology), paired ? 2 : 1)
  const qc = new QcAccumulator(isLongRead(opts.technology), paired ? 2 : 1)
  const writer = new ChunkWriter(opts.put)
  let readsBefore = 0
  let basesBefore = 0
  let adapterTrimmedReads = 0
  const useFastp = !isLongRead(opts.technology)
  if (useFastp && !opts.fastp) throw new Error('fastp is not available')

  let r1: string[] = []
  let r2: string[] = []
  let batched = 0
  const runBatch = async () => {
    if (batched === 0) return
    const files: Record<string, string> = { 'in1.fq': r1.join('') }
    if (paired) files['in2.fq'] = r2.join('')
    r1 = []
    r2 = []
    batched = 0
    const outputs = paired ? ['out1.fq', 'out2.fq', 'report.json'] : ['out1.fq', 'report.json']
    const res = await opts.fastp!(fastpArgs(s, paired), files, outputs)
    if (res.exitCode !== 0 || res.files['out1.fq'] === null) {
      throw new Error(`fastp failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    try {
      const report = JSON.parse(res.files['report.json'] ?? '{}') as { adapter_cutting?: { adapter_trimmed_reads?: number } }
      adapterTrimmedReads += report.adapter_cutting?.adapter_trimmed_reads ?? 0
    } catch { /* the report is extra; the reads are what matter */ }
    const parse = (text: string) => {
      const p = new ReadStreamParser()
      const out: RawRead[] = []
      p.push(text, out)
      p.end(out)
      return out
    }
    const a = parse(res.files['out1.fq']!)
    const b = paired ? parse(res.files['out2.fq'] ?? '') : []
    if (paired && a.length !== b.length) throw new Error('fastp returned mates out of step')
    for (let i = 0; i < a.length; i++) {
      for (const [r, mate] of paired ? [[a[i], 0], [b[i], 1]] as const : [[a[i], 0]] as const) {
        const id = readId(r.header)
        stats.add(r.seq, r.qual, mate)
        qc.add(id, r.seq, r.qual, mate)
        await writer.add({ id, seq: r.seq, qual: r.qual })
      }
    }
  }

  for (let c = 0; c < opts.chunks; c++) {
    const packed = await opts.getChunk(c)
    if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
    const chunk = decodeChunk(packed)
    readsBefore += chunk.count
    basesBefore += chunk.offsets[chunk.count]
    const step = paired ? 2 : 1
    for (let i = 0; i + step - 1 < chunk.count; i += step) {
      if (useFastp) {
        r1.push(`@${chunk.ids[i]}\n${chunk.seq(i)}\n+\n${chunk.qualText(i)}\n`)
        if (paired) r2.push(`@${chunk.ids[i + 1]}\n${chunk.seq(i + 1)}\n+\n${chunk.qualText(i + 1)}\n`)
        batched += step
        if (batched >= (opts.batchReads ?? FASTP_BATCH)) await runBatch()
        continue
      }
      let keep = true
      for (let m = 0; m < step; m++) {
        const len = chunk.length(i + m)
        if (len < s.minLength) keep = false
        else if (s.minReadQuality > 0 && chunk.hasQuality
          && meanReadQuality(chunk.qual, chunk.offsets[i + m], chunk.offsets[i + m + 1]) < s.minReadQuality) keep = false
      }
      if (!keep) continue
      for (let m = 0; m < step; m++) {
        const seq = chunk.seq(i + m)
        const qual = chunk.hasQuality ? chunk.qualText(i + m) : ''
        stats.add(seq, qual, m)
        qc.add(chunk.ids[i + m], seq, qual, m)
        await writer.add({ id: chunk.ids[i + m], seq, qual })
      }
    }
    opts.onProgress?.(c + 1, opts.chunks)
  }
  if (useFastp) await runBatch()
  await writer.flush()
  const finished = stats.finish()
  return {
    stats: finished,
    qc: qc.finish(finished),
    chunks: writer.chunks,
    storedBytes: writer.storedBytes,
    readsBefore,
    basesBefore,
    ...(useFastp ? { adapterTrimmedReads } : {}),
  }
}
