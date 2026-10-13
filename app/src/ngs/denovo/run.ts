/**
 * A de novo assembly from start to end: the contigs made from the reads
 * (long.ts for long reads, short.ts for short ones), every read mapped back
 * to them (mapper.ts) and the candidate variant sites recounted (calls.ts),
 * so the result opens like any mapping, its variant table ready.
 */

import { mapReads, type MapPreset, type MappingReport, type ToolRunner } from '../mapper'
import type { MappingStorage } from '../builder'
import { callMapping } from '../calls'
import { assembleLongReads, scanReads, type ReadScan } from './long'
import { assembleLongGenome } from './genome'
import { lengthPeaks } from './clusters'
import { assembleShortReads } from './short'
import { contigGraph, encodeGraph, type StoredGraph } from './graph'
import { lineUpContigs, type LineUpTarget } from './lineup'
import { mappingStorageIds } from '../builder'
import { DEFAULT_DENOVO_SETTINGS, DEFAULT_SHORT_SETTINGS, type AssembledContig, type DeNovoMethod, type DeNovoReport, type DeNovoSettings } from './types'
import { isLongRead, type Technology } from '../types'

export interface DeNovoResult {
  denovo: DeNovoReport
  mapping: MappingReport
}

const nf = new Intl.NumberFormat('en-US')

/** The summary toast of a finished assembly. */
export function assembledMessage(r: DeNovoResult): string {
  const c = r.denovo.contigs
  const what = c.length === 1
    ? `1 contig, ${nf.format(c[0].length)} bp${c[0].circular ? ' circular' : ''}`
    : `${c.length} contigs`
  const pct = r.mapping.reads ? (r.mapping.mapped / r.mapping.reads) * 100 : 0
  return `Assembled ${what}; ${pct.toFixed(1)}% of the reads map to ${c.length === 1 ? 'it' : 'them'}`
}

/** Shortest mean read length taken for long reads when the technology is not known. */
export const LONG_READ_LENGTH = 1000

/** The method for a read set: long reads choose by their lengths (longMethod), short ones take a de Bruijn graph. */
export function denovoMethodFor(rs: { technology: Technology; stats: { meanLength: number } }): DeNovoMethod {
  return isLongRead(rs.technology) || (rs.technology === 'other' && rs.stats.meanLength >= LONG_READ_LENGTH) ? 'long-auto' : 'short-dbg'
}

/**
 * Share of the read bases in length peaks above which long reads are taken
 * for whole products (plasmids, amplicons) rather than a genome. Sequencing a
 * plasmid whole gives a large share of full-length reads; a genome library's
 * reads are broken at random, with at most a small plasmid's peak or two.
 */
export const PRODUCT_SHARE = 0.15

/** Whole products or a genome, by the share of the read bases in length peaks. */
export function longMethod(scan: ReadScan, minReads: number): { method: 'long-seed' | 'long-olc'; share: number } {
  const peaks = lengthPeaks(scan.lengths, { minReads })
  let inPeaks = 0
  for (const p of peaks) for (const i of p.members) inPeaks += scan.lengths[i]
  let all = 0
  for (const l of scan.lengths) all += l
  const share = all ? inPeaks / all : 0
  return { method: share >= PRODUCT_SHARE ? 'long-seed' : 'long-olc', share }
}

/** Can this read set be assembled? Null when it can, else why not. */
export function denovoBlocked(rs: { technology: Technology; stats: { meanLength: number; reads: number } }): string | null {
  if (rs.stats.reads === 0) return 'The read set has no reads.'
  if (denovoMethodFor(rs) === 'short-dbg' && rs.stats.meanLength < 30) return 'The reads are too short to assemble (30 bases or more needed).'
  return null
}

/** minimap2's preset for mapping the reads back. */
export function denovoPreset(t: Technology, method: DeNovoMethod): MapPreset {
  if (method === 'short-dbg') return 'sr'
  return t === 'pacbio' ? 'map-hifi' : 'map-ont'
}

export interface DeNovoReadSet {
  id: string
  chunks: number
  paired: boolean
  technology: Technology
  maxLength: number
  bases: number
  reads: number
  meanLength: number
}

/** Map the reads back to contigs and recount the variant sites: the result as a mapping. */
export async function mapToContigs(o: {
  storageId: string
  readSet: DeNovoReadSet
  contigs: readonly AssembledContig[]
  preset: MapPreset
  minimap2: ToolRunner
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  storage: MappingStorage
  onProgress?: (done: number, total: number) => void
}): Promise<MappingReport> {
  const part = (from: number, width: number) => (d: number, t: number) => o.onProgress?.(Math.round(1000 * (from + (t ? (d / t) * width : 0))), 1000)
  const mapping = await mapReads({
    storageId: o.storageId,
    readSet: o.readSet,
    refs: o.contigs.map(c => ({ name: c.name, tabId: c.tabId ?? null, bases: c.bases, circular: c.circular, features: c.features })),
    preset: o.preset,
    minimap2: o.minimap2,
    getChunk: o.getChunk,
    storage: o.storage,
    onProgress: part(0, 0.9),
  })
  await callMapping({
    storageId: o.storageId,
    storage: o.storage,
    references: o.contigs.map(c => ({ name: c.name, length: c.bases.length, circular: c.circular })),
    onProgress: part(0.9, 0.1),
  })
  return mapping
}

export async function assembleReadSet(o: {
  storageId: string
  readSet: DeNovoReadSet
  settings: DeNovoSettings
  /** Long-read genomes: short reads of the same sample to polish with. */
  shortReads?: { readSet: DeNovoReadSet & { name: string }; getChunk: (index: number) => Promise<Uint8Array | undefined> }
  /** Sequences to line the contigs up with (lineup.ts); none leaves them as made. */
  lineUp?: LineUpTarget[]
  minimap2: ToolRunner
  getChunk: (index: number) => Promise<Uint8Array | undefined>
  storage: MappingStorage
  onProgress?: (done: number, total: number) => void
}): Promise<DeNovoResult> {
  let method = o.settings.method
  let scan: ReadScan | undefined
  if (method === 'long-auto' || method === 'long-olc') {
    scan = await scanReads(o.readSet.chunks, o.getChunk)
    if (method === 'long-auto') method = longMethod(scan, o.settings.minReads).method
  }
  const preset = denovoPreset(o.readSet.technology, method)
  // Progress: assembling 60%, mapping back and variants 40%.
  const part = (from: number, width: number) => (d: number, t: number) => o.onProgress?.(Math.round(1000 * (from + (t ? (d / t) * width : 0))), 1000)
  let contigs: AssembledContig[]
  let denovo: DeNovoReport
  let graph: StoredGraph | null = null
  if (method === 'short-dbg') {
    const r = await assembleShortReads({
      readSet: { chunks: o.readSet.chunks, bases: o.readSet.bases, meanLength: o.readSet.meanLength, paired: o.readSet.paired },
      settings: o.settings, getChunk: o.getChunk, onProgress: part(0, 0.6),
    })
    contigs = r.contigs
    graph = r.graph
    denovo = { version: 1, settings: o.settings, reads: o.readSet.reads, contigs: r.info, short: r.report }
  } else if (method === 'long-olc') {
    const sr = o.shortReads
    const r = await assembleLongGenome({
      readSet: { chunks: o.readSet.chunks, getChunk: o.getChunk, technology: o.readSet.technology },
      settings: o.settings, preset, minimap2: o.minimap2, scan: scan!, onProgress: part(0, 0.6),
      shortReads: sr ? { chunks: sr.readSet.chunks, getChunk: sr.getChunk, name: sr.readSet.name, paired: sr.readSet.paired, bases: sr.readSet.bases } : undefined,
    })
    contigs = r.contigs
    graph = r.graph
    denovo = r.report
  } else {
    const r = await assembleLongReads({
      readSet: o.readSet, settings: { ...o.settings, method: 'long-seed' }, preset, minimap2: o.minimap2, getChunk: o.getChunk, scan, onProgress: part(0, 0.6),
    })
    contigs = r.contigs
    denovo = r.report
  }
  if (o.settings.method === 'long-auto' && scan) denovo = { ...denovo, chosen: longMethod(scan, o.settings.minReads) }
  if (o.lineUp?.length) {
    const lined = lineUpContigs(contigs, o.lineUp)
    contigs = lined.contigs
    if (lined.matched.length) denovo = { ...denovo, matched: lined.matched }
  }
  const mapping = await mapToContigs({ ...o, contigs, preset, onProgress: part(0.6, 0.4) })
  // Long-read contigs are their own graph, with the depth the reads mapped back give.
  graph ??= contigGraph(contigs.map((c, i) => ({ ...c, depth: mapping.references[i]?.meanDepth ?? 0 })))
  if (method === 'long-olc') {
    // A genome's contigs show the depth of the reads mapped back too; the other unitigs keep the layout's.
    for (const seg of graph.segments) if (seg.contig !== null) seg.coverage = Math.round((mapping.references[seg.contig]?.meanDepth ?? 0) * 10) / 10
  }
  await o.storage.put(mappingStorageIds(o.storageId).graph, 0, encodeGraph(graph))
  return { denovo, mapping }
}

/** What the assemble job needs of a read set. */
export function denovoReadSet(rs: { id: string; chunks: number; paired: boolean; technology: Technology; stats: { maxLength: number; bases: number; reads: number; meanLength: number } }): DeNovoReadSet {
  return {
    id: rs.id, chunks: rs.chunks, paired: rs.paired, technology: rs.technology,
    maxLength: rs.stats.maxLength, bases: rs.stats.bases, reads: rs.stats.reads, meanLength: rs.stats.meanLength,
  }
}

/** The settings to start from for a read set: the defaults of its method. */
export function defaultDeNovoSettings(rs: { technology: Technology; stats: { meanLength: number } }): DeNovoSettings {
  return denovoMethodFor(rs) === 'short-dbg' ? DEFAULT_SHORT_SETTINGS : DEFAULT_DENOVO_SETTINGS
}
