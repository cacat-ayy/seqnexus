/**
 * A stored mapping written out as SAM or BAM (with its BAI index), sorted by
 * position, for IGV, samtools and the rest.
 *
 * The pages are already sorted, so the file is written page by page, each
 * alignment's bases written back from the reference and its differences
 * (alignments.ts). Nothing is held whole: SAM text and BAM blocks are
 * gathered into Blobs as they are made. On a circular reference, a read
 * across the origin keeps the position where it starts, so its alignment
 * runs past the end of the reference, as minimap2 itself writes it against
 * an extended reference.
 */

import { inflateSync } from 'fflate'
import { decodePage, editDistance, sequenceOf, type RefBases, type SamFields } from './alignments'
import { BaiBuilder, bamHeader, bamRecord, BgzfWriter } from './bam'
import { mappingStorageIds, type MappingIndex, type MappingReport, type MappingStorage } from './builder'
import { samNames } from './refNames'

export { samName, samNames } from './refNames'

export async function readMappingIndex(storage: Pick<MappingStorage, 'get'>, storageId: string): Promise<MappingIndex> {
  const data = await storage.get(mappingStorageIds(storageId).index, 0)
  if (!data) throw new Error('The mapping\'s alignments are missing from this browser\'s storage')
  return JSON.parse(new TextDecoder().decode(inflateSync(data))) as MappingIndex
}

export async function readReferenceBases(storage: Pick<MappingStorage, 'get'>, storageId: string, ref: number): Promise<string> {
  const data = await storage.get(mappingStorageIds(storageId).reference, ref)
  if (!data) throw new Error('The mapping\'s reference is missing from this browser\'s storage')
  return new TextDecoder().decode(inflateSync(data))
}

/** A read group's ID or SM value: SAM header values end at a tab or a line break. */
const headerValue = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim() || 'sample'

/**
 * The @RG platform. SAMv1 1.3 takes PL from a fixed list, and a read group
 * without one is an error to Picard's ValidateSamFile, so each minimap2
 * preset names the platform it is for. An imported mapping (no preset) says
 * nothing rather than guessing.
 */
const PLATFORM: Record<string, string> = { sr: 'ILLUMINA', 'map-ont': 'ONT', 'map-hifi': 'PACBIO' }

export function samHeaderText(
  names: readonly string[], lengths: readonly number[], program: MappingReport['program'],
  readGroup?: { id: string; sample: string; platform?: string },
  /** Which references are circular, for the @SQ TP tag. */
  circular: readonly boolean[] = [],
): string {
  return [
    '@HD\tVN:1.6\tSO:coordinate',
    // TP:circular says the reference is a circle, which is what lets an
    // alignment run past LN (SAMv1 2.7.1, "Circular reference sequences").
    ...names.map((n, i) => `@SQ\tSN:${n}\tLN:${lengths[i]}${circular[i] ? '\tTP:circular' : ''}`),
    ...(readGroup ? [`@RG\tID:${headerValue(readGroup.id)}\tSM:${headerValue(readGroup.sample)}${readGroup.platform ? `\tPL:${readGroup.platform}` : ''}`] : []),
    `@PG\tID:${program.id || program.name}\tPN:${program.name}${program.version ? `\tVN:${program.version}` : ''}${program.command ? `\tCL:${program.command}` : ''}`,
  ].join('\n') + '\n'
}

export async function exportMapping(o: {
  format: 'sam' | 'bam'
  storageId: string
  storage: Pick<MappingStorage, 'get'>
  references: readonly { name: string; length: number; circular: boolean }[]
  program: MappingReport['program']
  /** The sample as a read group: an @RG header line and an RG tag on every record. */
  readGroup?: { id: string; sample: string }
  /** minimap2's preset, which names the platform for @RG PL; absent for an imported mapping. */
  preset?: string | null
  onProgress?: (done: number, total: number) => void
}): Promise<{ file: Blob; index: Blob | null }> {
  const ids = mappingStorageIds(o.storageId)
  const index = await readMappingIndex(o.storage, o.storageId)
  const names = samNames(o.references.map(r => r.name))
  const rgroup = o.readGroup && { ...o.readGroup, platform: o.preset ? PLATFORM[o.preset] : undefined }
  const header = samHeaderText(names, o.references.map(r => r.length), o.program, rgroup, o.references.map(r => r.circular))
  const rg = o.readGroup ? headerValue(o.readGroup.id) : undefined
  const total = index.refs.reduce((n, r) => n + r.pages.length, 0)
  let done = 0

  const bam = o.format === 'bam'
  const writer = bam ? new BgzfWriter() : null
  const bai = bam ? new BaiBuilder(o.references.length) : null
  const textParts: BlobPart[] = []
  let lines: string[] = []
  let lineBytes = 0
  if (writer) {
    writer.write(bamHeader(header, names.map((n, i) => ({ name: n, length: o.references[i].length }))))
    // Records start in a block of their own after the header, as samtools writes it.
    writer.flush()
  } else textParts.push(header)

  for (let r = 0; r < index.refs.length; r++) {
    const ref: RefBases = { bases: await readReferenceBases(o.storage, o.storageId, r), circular: o.references[r].circular }
    for (const page of index.refs[r].pages) {
      const data = await o.storage.get(ids.pages, page.index)
      if (!data) throw new Error(`Page ${page.index + 1} of the alignments is missing from storage`)
      for (const a of decodePage(data)) {
        const f: SamFields = {
          qname: a.name, flag: a.flag, ref: r, pos: a.start, mapq: a.mapq, cigar: a.cigar,
          mateRef: a.mateRef, matePos: a.matePos, tlen: a.tlen, seq: sequenceOf(ref, a), qual: a.qual || '*',
        }
        const nm = editDistance(a.diff)
        if (writer && bai) {
          const vbeg = writer.voffset
          writer.write(bamRecord(f, a.end, rg, nm))
          bai.add(r, a.start, a.end, vbeg, writer.voffset)
        } else {
          const rnext = f.mateRef < 0 ? '*' : f.mateRef === r ? '=' : names[f.mateRef]
          const pnext = f.mateRef < 0 || f.matePos < 0 ? 0 : f.matePos + 1
          const line = `${f.qname}\t${f.flag}\t${names[r]}\t${f.pos + 1}\t${f.mapq}\t${f.cigar}\t${rnext}\t${pnext}\t${f.tlen}\t${f.seq}\t${f.qual}${rg ? `\tRG:Z:${rg}` : ''}${nm === null ? '' : `\tNM:i:${nm}`}\n`
          lines.push(line)
          lineBytes += line.length
          if (lineBytes > 8_000_000) { textParts.push(lines.join('')); lines = []; lineBytes = 0 }
        }
      }
      o.onProgress?.(++done, total)
    }
  }
  if (writer && bai) return { file: writer.finish(), index: new Blob([bai.finish() as BlobPart], { type: 'application/octet-stream' }) }
  textParts.push(lines.join(''))
  return { file: new Blob(textParts, { type: 'text/plain' }), index: null }
}
