/**
 * A mapping's per-base coverage written out as bedGraph, for IGV, the UCSC
 * browser and bedtools: one line per run of bases at the same depth,
 * 0-based and half-open, zero-depth runs included, as
 * `bedtools genomecov -bga` writes it. Depth is the stored per-base
 * coverage, the aligned bases of every primary and supplementary alignment
 * (deletions not counted), the same figure the coverage track draws.
 */

import { inflateSync } from 'fflate'
import { mappingStorageIds, type MappingStorage } from './builder'

/** Lines per string handed back, so a genome's millions of lines are never one string. */
const LINES_PER_PART = 65536

/** One reference's coverage as bedGraph text, in parts to be joined (a Blob takes them as they are). */
export function coverageBedGraph(refName: string, depth: ArrayLike<number>): string[] {
  const parts: string[] = []
  let lines: string[] = []
  let start = 0
  for (let i = 1; i <= depth.length; i++) {
    if (i < depth.length && depth[i] === depth[start]) continue
    lines.push(`${refName}\t${start}\t${i}\t${depth[start]}`)
    if (lines.length === LINES_PER_PART) { parts.push(lines.join('\n') + '\n'); lines = [] }
    start = i
  }
  if (lines.length) parts.push(lines.join('\n') + '\n')
  return parts
}

/** The stored per-base coverage of one reference of a mapping. */
export async function readCoverage(storage: Pick<MappingStorage, 'get'>, storageId: string, ref: number): Promise<Uint32Array> {
  const data = await storage.get(mappingStorageIds(storageId).coverage, ref)
  if (!data) throw new Error('The mapping\'s coverage is missing from this browser\'s storage')
  const raw = inflateSync(data)
  return new Uint32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
}

/** Every reference of a mapping as one bedGraph file, with a track line naming it. */
export async function mappingBedGraph(
  storage: Pick<MappingStorage, 'get'>, storageId: string, refNames: readonly string[], trackName: string,
): Promise<Blob> {
  const parts: string[] = [`track type=bedGraph name="${trackName.replace(/"/g, "'")}" description="Read depth"\n`]
  for (let r = 0; r < refNames.length; r++) parts.push(...coverageBedGraph(refNames[r], await readCoverage(storage, storageId, r)))
  return new Blob(parts, { type: 'text/plain' })
}
