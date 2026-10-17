/**
 * Mapping a read set to reference sequences with minimap2 (WebAssembly).
 *
 * Reads go to minimap2 in batches (by bases, so long and short reads both
 * keep memory bounded), with the references written as one FASTA each run;
 * indexing a few megabases takes a moment against minutes of mapping. Each
 * batch's SAM output goes straight to the MappingBuilder (builder.ts), which
 * counts it, stores it sorted, and writes the report.
 *
 * Each batch is mapped twice when a reference is circular. The first pass is
 * against the references as they are. The reads that may lie across an
 * origin (unmapped, split, stopped at a reference end with bases left over,
 * or a pair that is not proper on a circular reference) go to a second pass
 * against the references with their start appended (as long as the longest
 * read could need, at most their own length), so a read across the origin
 * maps in one piece; positions past the end are folded back. Only those
 * reads see the appended stretch: in it the same sequence is there twice,
 * and a read mapped inside it gets mapping quality 0 from minimap2, which
 * the variant caller leaves out. Mapping every read against the extended
 * references gave a third of a small plasmid's reads mapping quality 0.
 */

import { decodeChunk } from './codec'
import { MappingBuilder, type MappingReport, type MappingStorage, type MapReference } from './builder'
import type { PrimerSite } from './primerClip'
import { cigarSpan, type SamFields } from './alignments'
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
 * minimap2's SAM records grouped by read, in input order: each group is a
 * read's primary record followed by its supplementary ones, which minimap2
 * writes straight after it.
 */
export function* samByRead(sam: string): Generator<SamFields[]> {
  let cur: SamFields[] | null = null
  for (const line of sam.split('\n')) {
    if (!line || line[0] === '@') continue
    const f = parseSamLine(line, minimapRef)
    if ((f.flag & 0x900) === 0) {
      if (cur) yield cur
      cur = [f]
    } else if (cur) cur.push(f)
  }
  if (cur) yield cur
}

/** Soft-clipped bases at the two ends of a CIGAR. */
function softClips(cigar: string): [number, number] {
  const ops = cigar.match(/\d+[MIDNSHP=X]/g) ?? []
  const at = (i: number) => (ops[i]?.endsWith('S') ? Number(ops[i].slice(0, -1)) : 0)
  const first = ops[0]?.endsWith('H') ? 1 : 0
  const last = ops.length - 1 - (ops[ops.length - 1]?.endsWith('H') ? 1 : 0)
  return [at(first), last > first ? at(last) : 0]
}

/**
 * Does a read's alignment stop short of an end of its reference with more
 * bases clipped than fit before the start or after the end? Such a read may
 * continue across the origin of a circular reference. (minimap2 may start
 * the alignment a few bases in rather than at base 1, so the test is on
 * the room for the clipped bases, not on the position alone.)
 */
function clippedAtEnd(f: SamFields, length: number): boolean {
  const [l, r] = softClips(f.cigar)
  return (l > 0 && f.pos < l) || (r > 0 && f.pos + cigarSpan(f.cigar) + r > length)
}

/**
 * Should a read (or a pair) mapped against the plain references be mapped
 * again against the extended ones? Yes when it may lie across the origin of
 * a circular reference: it is unmapped, split, or stops at an end of a
 * circular reference with bases left over; or the pair is not proper on a
 * circular reference (its mates may face each other across the origin).
 */
export function needsOriginPass(group: readonly (readonly SamFields[])[], refs: readonly { length: number; circular: boolean }[]): boolean {
  const circular = (f: SamFields) => f.ref >= 0 && f.ref < refs.length && refs[f.ref].circular
  for (const recs of group) {
    const p = recs[0]
    if (p.flag & 4) return true
    if (!circular(p)) continue
    if (recs.length > 1) return true
    if (clippedAtEnd(p, refs[p.ref].length)) return true
  }
  if (group.length === 2) {
    const [a, b] = [group[0][0], group[1][0]]
    if (!(a.flag & 4) && !(b.flag & 4) && a.ref === b.ref && circular(a)) {
      if (!(a.flag & 2)) return true
      if (Math.abs(a.tlen) > refs[a.ref].length / 2) return true
    }
  }
  return false
}

/** How well a read or pair came out: mapped, proper, in one piece, and not stopped at a reference end. */
function placementScore(group: readonly (readonly SamFields[])[], refs: readonly { length: number; circular: boolean }[]): number {
  let s = 0
  for (const recs of group) {
    const p = recs[0]
    if (p.flag & 4) continue
    s += 4
    if (p.flag & 2) s += 2
    if (recs.length === 1) s += 1
    if (p.ref >= 0 && p.ref < refs.length && !clippedAtEnd(p, refs[p.ref].length)) s += 1
  }
  return s
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
  // Two sets of references: the plain ones for every read, and the extended
  // ones for the reads that may lie across the origin of a circular one. In
  // the extended stretch the sequence is there twice, so a read mapped inside
  // it gets mapping quality 0 from minimap2; mapping every read against the
  // extended references gave a third of a small plasmid's reads MAPQ 0, which
  // the variant caller leaves out. Only reads that need the origin see it.
  const plainText = referenceFasta(refs, 0)
  const extendedText = referenceFasta(refs, extend)
  const plainRefs = refs.map(r => ({ length: r.bases.length, circular: r.circular }))
  const extendedRefs = refs.map(r => ({ length: r.bases.length + (r.circular ? Math.min(r.bases.length, extend) : 0), circular: r.circular }))
  const anyCircular = refs.some(r => r.circular)
  const builder = new MappingBuilder({ storageId: o.storageId, refs, paired: rs.paired, storage: o.storage, expectedBases: rs.bases, primerSites: o.primerSites })
  const total = rs.chunks + builder.bucketCount
  const groupSize = rs.paired ? 2 : 1
  let r1: string[] = []
  let r2: string[] = []
  let bases = 0
  let firstRead = 0
  let pending = 0
  let withQuality = true
  const minimap = async (refFasta: string, fq1: string, fq2: string | null): Promise<string> => {
    const files: Record<string, string> = { 'ref.fa': refFasta, 'r1.fq': fq1 }
    if (fq2 !== null) files['r2.fq'] = fq2
    const res = await o.minimap2(minimap2Args(preset, fq2 !== null), files, ['out.sam'])
    const sam = res.files['out.sam']
    if (res.exitCode !== 0 || sam === null) {
      throw new Error(`minimap2 failed: ${res.stderr.split('\n').filter(Boolean).slice(-3).join(' ') || `exit code ${res.exitCode}`}`)
    }
    return sam
  }
  // minimap2 writes the two mates of a pair one after the other, so read
  // indices follow the read set's own interleaved order: group g of this
  // batch holds reads firstRead + g * groupSize onward.
  const addGroup = async (group: readonly (readonly SamFields[])[], g: number) => {
    for (let m = 0; m < group.length; m++) {
      for (const f of group[m]) {
        // Reads without qualities went to minimap2 with made-up ones; they are not kept.
        if (!withQuality) f.qual = '*'
        await builder.add(f, firstRead + g * groupSize + m)
      }
    }
  }
  const runBatch = async () => {
    if (pending === 0) return
    const reads1 = r1
    const reads2 = r2
    r1 = []
    r2 = []
    bases = 0
    const groups = pending / groupSize
    // Pass 1: every read against the plain references.
    const sam1 = await minimap(plainText, reads1.join(''), rs.paired ? reads2.join('') : null)
    const retry: { g: number; group: SamFields[][] }[] = []
    let g = 0
    let group: SamFields[][] = []
    for (const recs of samByRead(sam1)) {
      group.push(recs)
      if (group.length < groupSize) continue
      if (anyCircular && needsOriginPass(group, plainRefs)) retry.push({ g, group })
      else await addGroup(group, g)
      group = []
      g++
    }
    if (g !== groups) throw new Error(`minimap2 gave alignments for ${g} of ${groups} ${rs.paired ? 'pairs' : 'reads'}`)
    // Pass 2: the reads that may lie across an origin, against the extended references.
    if (retry.length) {
      const sam2 = await minimap(extendedText, retry.map(x => reads1[x.g]).join(''), rs.paired ? retry.map(x => reads2[x.g]).join('') : null)
      let i = 0
      group = []
      for (const recs of samByRead(sam2)) {
        group.push(recs)
        if (group.length < groupSize) continue
        const x = retry[i++]
        if (!x) throw new Error('minimap2 gave more alignments than reads were mapped again')
        await addGroup(placementScore(group, extendedRefs) > placementScore(x.group, plainRefs) ? group : x.group, x.g)
        group = []
      }
      if (i !== retry.length) throw new Error(`minimap2 gave alignments for ${i} of ${retry.length} reads mapped again`)
    }
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
