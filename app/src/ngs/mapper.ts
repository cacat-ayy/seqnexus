/**
 * Mapping a read set to reference sequences with minimap2 (WebAssembly).
 *
 * Reads go to minimap2 in batches (by bases, so long and short reads both
 * keep memory bounded), with the references written as one FASTA each run;
 * indexing a few megabases takes a moment against minutes of mapping. Each
 * batch's SAM output goes straight to the MappingBuilder (builder.ts), which
 * counts it, stores it sorted, and writes the report.
 *
 * A circular reference gets its start appended (as long as the longest read
 * could need, at most its own length), so reads across the origin map in one
 * piece; positions past the end are folded back. In the appended stretch the
 * same sequence is there twice, so minimap2 gives reads there mapping quality
 * 0; coverage counts every alignment whatever its mapping quality, so the
 * origin is not left uncovered.
 */

import { decodeChunk } from './codec'
import { MappingBuilder, type MappingReport, type MappingStorage, type MapReference } from './builder'
import type { PrimerSite } from './primerClip'
import type { SamFields } from './alignments'
import type { Technology } from './types'

export type { MapReference, MappingReport } from './builder'

export type MapPreset = 'sr' | 'map-ont' | 'map-hifi'

export const PRESET_LABEL: Record<MapPreset, string> = {
  'sr': 'Short reads (sr)',
  'map-ont': 'Nanopore (map-ont)',
  'map-hifi': 'PacBio HiFi (map-hifi)',
}

export function presetFor(t: Technology): MapPreset {
  return t === 'nanopore' ? 'map-ont' : t === 'pacbio' ? 'map-hifi' : 'sr'
}

export type ToolRunner = (
  args: string[],
  files: Record<string, string>,
  outputs: string[],
) => Promise<{ exitCode: number; stderr: string; files: Record<string, string | null> }>

/** Bases per minimap2 run. */
export const MAP_BATCH_BASES = 40_000_000

export function minimap2Args(preset: MapPreset, paired: boolean): string[] {
  return ['-a', '-x', preset, '--secondary=no', '-t', '1', '-o', 'out.sam', 'ref.fa', 'r1.fq', ...(paired ? ['r2.fq'] : [])]
}

/** The references as FASTA, circular ones extended past their end by `extend` bases (at most their length). */
export function referenceFasta(refs: readonly MapReference[], extend: number): string {
  return refs.map((r, i) => {
    const b = r.bases.toUpperCase()
    const seq = r.circular ? b + b.slice(0, Math.min(b.length, extend)) : b
    return `>ref${i}\n${seq}\n`
  }).join('')
}

/** One SAM line; `refIndex` turns a reference name into its index (-1 for '*' or an unknown name). */
export function parseSamLine(line: string, refIndex: (name: string) => number): SamFields {
  const f = line.split('\t', 11)
  const ref = f[2] === '*' ? -1 : refIndex(f[2])
  const mateRef = f[6] === '=' ? ref : f[6] === '*' ? -1 : refIndex(f[6])
  return {
    qname: f[0], flag: Number(f[1]), ref, pos: Number(f[3]) - 1, mapq: Number(f[4]), cigar: f[5],
    mateRef, matePos: Number(f[7]) - 1, tlen: Number(f[8]), seq: f[9] ?? '*', qual: f[10] ?? '*',
  }
}

/** minimap2's names for the references: ref0, ref1, ... */
const minimapRef = (name: string) => (name.startsWith('ref') ? Number(name.slice(3)) : -1)

/**
 * Feed one batch of minimap2's SAM to the builder. Primary records come in
 * input order, one per read, so the n-th primary record is read
 * `firstRead + n`; minimap2 writes a read's supplementary alignments straight
 * after its primary one, so they take the same read.
 */
export async function addMinimap2Sam(builder: MappingBuilder, sam: string, firstRead: number, withQuality = true): Promise<void> {
  let readIndex = firstRead - 1
  for (const line of sam.split('\n')) {
    if (!line || line[0] === '@') continue
    const f = parseSamLine(line, minimapRef)
    // Reads without qualities went to minimap2 with made-up ones; they are not kept.
    if (!withQuality) f.qual = '*'
    if ((f.flag & 0x900) === 0) readIndex++
    await builder.add(f, readIndex)
  }
}

export interface MapOptions {
  storageId: string
  readSet: { id: string; chunks: number; paired: boolean; technology: Technology; maxLength: number; bases: number }
  refs: readonly MapReference[]
  preset: MapPreset
  minimap2: ToolRunner
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  storage: MappingStorage
  batchBases?: number
  /** Primer sites per reference: each alignment's primer is clipped (primerClip.ts). */
  primerSites?: PrimerSite[][]
  onProgress?: (done: number, total: number) => void
}

export async function mapReads(o: MapOptions): Promise<MappingReport> {
  const { readSet: rs, refs, preset } = o
  if (refs.length === 0) throw new Error('Choose a reference to map to')
  const extend = Math.max(1000, rs.maxLength + 100)
  const refText = referenceFasta(refs, extend)
  const builder = new MappingBuilder({ storageId: o.storageId, refs, paired: rs.paired, storage: o.storage, expectedBases: rs.bases, primerSites: o.primerSites })
  const total = rs.chunks + builder.bucketCount
  let r1: string[] = []
  let r2: string[] = []
  let bases = 0
  let firstRead = 0
  let pending = 0
  let withQuality = true
  const runBatch = async () => {
    if (pending === 0) return
    const files: Record<string, string> = { 'ref.fa': refText, 'r1.fq': r1.join('') }
    if (rs.paired) files['r2.fq'] = r2.join('')
    r1 = []
    r2 = []
    bases = 0
    const res = await o.minimap2(minimap2Args(preset, rs.paired), files, ['out.sam'])
    const sam = res.files['out.sam']
    if (res.exitCode !== 0 || sam === null) {
      throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    // minimap2 writes the two mates of a pair one after the other, so read
    // indices follow the read set's own interleaved order.
    await addMinimap2Sam(builder, sam, firstRead, withQuality)
    firstRead += pending
    pending = 0
  }

  try {
    for (let c = 0; c < rs.chunks; c++) {
      const packed = await o.getChunk(c)
      if (!packed) throw new Error(`Part ${c + 1} of the reads is missing from storage`)
      const chunk = decodeChunk(packed)
      if (!chunk.hasQuality) withQuality = false
      for (let i = 0; i < chunk.count; i++) {
        const rec = `@${chunk.ids[i]}\n${chunk.seq(i)}\n+\n${chunk.hasQuality ? chunk.qualText(i) : 'I'.repeat(chunk.length(i))}\n`
        if (rs.paired && i & 1) r2.push(rec)
        else r1.push(rec)
        bases += chunk.length(i)
        pending++
      }
      if (bases >= (o.batchBases ?? MAP_BATCH_BASES) && (!rs.paired || pending % 2 === 0)) await runBatch()
      o.onProgress?.(c + 1, total)
    }
    await runBatch()
    return await builder.finish({
      preset,
      program: { id: 'minimap2', name: 'minimap2', version: '2.22', command: ['minimap2', ...minimap2Args(preset, rs.paired)].join(' ') },
    }, d => o.onProgress?.(rs.chunks + d, total))
  } catch (err) {
    await builder.discard().catch(() => {})
    throw err
  }
}
