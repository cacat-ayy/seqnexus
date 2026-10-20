/**
 * ZIP archives in a drop, opened as the files inside them.
 *
 * A sequencing service hands its results over as a ZIP (a whole-plasmid
 * service as `<order>_results.zip`, with the reads in a `.fastq.zip` of
 * their own), and a ZIP used to be refused as a format SeqNexus cannot
 * open. Now each one is unpacked with fflate (already shipped for Geneious
 * files) and its files take its place, with their paths inside it under a
 * folder named after the archive, so they import as a dropped folder would.
 * A ZIP inside a ZIP is unpacked too. Folders and the side files macOS adds
 * (`__MACOSX/`, `._name`) are left out.
 *
 * The whole archive is read into memory, which is fine for the tens or a
 * few hundreds of megabytes of a plasmid order.
 */

import { unzipSync } from 'fflate'

export const ZIP_FILE = /\.zip$/i

/** Deepest a ZIP inside a ZIP is followed. */
const MAX_DEPTH = 3

function readBuffer(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'))
    reader.readAsArrayBuffer(file)
  })
}

const skipped = (path: string) => path.endsWith('/') || path.split('/').some(p => p === '__MACOSX' || p.startsWith('._'))

/** The files in an archive, each with its path under `prefix`. */
function unpack(bytes: Uint8Array, prefix: string, depth: number, out: { files: File[]; paths: Map<File, string> }): void {
  const entries = unzipSync(bytes, { filter: f => !skipped(f.name) })
  for (const [path, data] of Object.entries(entries)) {
    const full = `${prefix}/${path}`
    const name = path.split('/').pop()!
    if (ZIP_FILE.test(name) && depth < MAX_DEPTH) {
      unpack(data, full.replace(ZIP_FILE, ''), depth + 1, out)
      continue
    }
    const file = new File([data as BlobPart], name)
    out.files.push(file)
    out.paths.set(file, full)
  }
}

/**
 * The files of a drop with every ZIP replaced by what it holds. `paths`
 * are the paths of files that came from a dropped folder; an archive's
 * files go under its own path without ".zip". An archive that cannot be
 * read is reported in `failed` and left out.
 */
export async function expandZips(
  files: readonly File[],
  paths: ReadonlyMap<File, string> = new Map(),
): Promise<{ files: File[]; paths: Map<File, string>; failed: { name: string; reason: string }[] }> {
  const out = { files: [] as File[], paths: new Map(paths) }
  const failed: { name: string; reason: string }[] = []
  for (const f of files) {
    if (!ZIP_FILE.test(f.name)) { out.files.push(f); continue }
    out.paths.delete(f)
    try {
      const where = (paths.get(f) ?? f.name).replace(ZIP_FILE, '')
      unpack(new Uint8Array(await readBuffer(f)), where, 1, out)
    } catch (err) {
      failed.push({ name: f.name, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { ...out, failed }
}
