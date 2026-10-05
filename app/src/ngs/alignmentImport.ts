/**
 * Alignments from a SAM or BAM file, stored as a mapping.
 *
 * The file is read as a stream (BAM's blocks inflated one at a time, see
 * bam.ts), each record goes to the MappingBuilder as minimap2's output does,
 * and the result is a mapping like any other, with its report, pages and
 * coverage. The bases the file stores are kept as differences from the
 * reference, so each reference named in the file's header has to be given
 * as an open sequence; alignments on a reference that is not given are left
 * out and counted. The file need not be sorted. Secondary alignments are
 * left out, as a mapping made here has none.
 */

import { parseSamLine } from './mapper'
import { BamParser, inflateBgzf, parseHeaderText, type AlignmentHeader } from './bam'
import { MappingBuilder, type MappingReport, type MappingStorage, type MapReference } from './builder'

export interface AlignmentFileHeader extends AlignmentHeader {
  format: 'sam' | 'bam'
}

async function* fileChunks(file: Blob, onBytes?: (n: number) => void): AsyncGenerator<Uint8Array> {
  const reader = file.stream().getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      onBytes?.(value.length)
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}

async function isGzip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  return head[0] === 31 && head[1] === 139
}

/** The references and program a SAM or BAM file names, read from its header only. */
export async function readAlignmentHeader(file: Blob): Promise<AlignmentFileHeader> {
  if (await isGzip(file)) {
    const parser = new BamParser()
    for await (const block of inflateBgzf(fileChunks(file))) {
      parser.push(block)
      if (parser.readHeader()) return { format: 'bam', ...parser.header! }
    }
    throw new Error('The BAM file ends inside its header')
  }
  const dec = new TextDecoder()
  let text = ''
  for await (const c of fileChunks(file)) {
    text += dec.decode(c, { stream: true })
    const firstRecord = text.search(/(^|\n)[^@\n]/)
    if (firstRecord >= 0) { text = text.slice(0, firstRecord); break }
  }
  const header = parseHeaderText(text)
  if (header.refs.length === 0) throw new Error('The SAM file has no @SQ lines naming its references')
  return { format: 'sam', ...header }
}

export async function importAlignments(o: {
  file: Blob
  fileName: string
  storageId: string
  storage: MappingStorage
  /** For each reference in the file's header, in order: the sequence to use, or null to leave its alignments out. */
  refs: (MapReference | null)[]
  onProgress?: (done: number, total: number) => void
}): Promise<MappingReport> {
  const used = o.refs.filter((r): r is MapReference => r !== null)
  if (used.length === 0) throw new Error('Choose a sequence for at least one of the references')
  // File order to builder order; references not given go past the end, where the builder counts and skips them.
  const remap: number[] = []
  let k = 0
  for (const r of o.refs) remap.push(r ? k++ : used.length)
  const bam = await isGzip(o.file)
  const builder = new MappingBuilder({
    storageId: o.storageId, refs: used, paired: false, storage: o.storage,
    expectedBases: o.file.size * (bam ? 1.5 : 0.5),
  })
  // Reading the file is most of the work; sorting and storing is put at a tenth.
  const total = Math.ceil(o.file.size * 1.1)
  let read = 0
  const onBytes = (n: number) => { read += n; o.onProgress?.(read, total) }
  let header: AlignmentHeader | null = null
  const add = async (f: ReturnType<typeof parseSamLine>) => {
    f.ref = f.ref < 0 ? -1 : remap[f.ref] ?? used.length
    f.mateRef = f.mateRef < 0 ? -1 : remap[f.mateRef] ?? -1
    if (f.mateRef >= used.length) f.mateRef = -1
    await builder.add(f, -1)
  }
  try {
    if (bam) {
      const parser = new BamParser()
      for await (const block of inflateBgzf(fileChunks(o.file, onBytes))) {
        parser.push(block)
        if (!parser.readHeader()) continue
        header ??= parser.header
        for (let f = parser.next(); f; f = parser.next()) await add(f)
      }
      if (!parser.header) throw new Error('The BAM file ends inside its header')
    } else {
      const dec = new TextDecoder()
      let rest = ''
      const headerLines: string[] = []
      let index: Map<string, number> | null = null
      const line = async (l: string) => {
        if (!l) return
        if (l[0] === '@') { if (!index) headerLines.push(l); return }
        if (!index) {
          header = parseHeaderText(headerLines.join('\n'))
          index = new Map(header.refs.map((r, i) => [r.name, i]))
        }
        const names = index
        await add(parseSamLine(l.replace(/\r$/, ''), n => names.get(n) ?? -1))
      }
      for await (const c of fileChunks(o.file, onBytes)) {
        const text = rest + dec.decode(c, { stream: true })
        const parts = text.split('\n')
        rest = parts.pop() ?? ''
        for (const l of parts) await line(l)
      }
      await line(rest + dec.decode())
    }
    const h = header as AlignmentHeader | null
    return await builder.finish({
      preset: null,
      program: h?.program ?? { id: 'imported', name: 'unknown', version: '', command: '' },
      importedFrom: o.fileName,
    }, (d, t) => o.onProgress?.(Math.round(o.file.size + (d / t) * (total - o.file.size)), total))
  } catch (err) {
    await builder.discard().catch(() => {})
    throw err
  }
}
