/**
 * Several files as one ZIP, for exports that would otherwise start a
 * download per file (separate files, a whole explorer folder). fflate,
 * already shipped for Geneious files, writes it.
 *
 * Paths are made unique ("name (2).gb") so two items with one name both
 * survive, and files that are already compressed (.gz, .png, .pdf) are
 * stored rather than squeezed a second time.
 */

import { zipSync, type Zippable } from 'fflate'

export interface ZipEntry {
  /** Path inside the archive, folders separated by "/". */
  path: string
  data: string | Uint8Array | ArrayBuffer
}

/** Already compressed: stored as they are. */
const STORED = /\.(gz|zip|png|jpe?g|pdf|bam|dna)$/i

/** A path inside the archive without what archive tools refuse (\ : * ? " < > |), parts never empty. */
function cleanPath(path: string): string {
  return path.split('/').map(p => p.replace(/[\\:*?"<>|]+/g, '_').trim() || '_').join('/')
}

/** `path`, or "name (2).ext" and so on when it is taken. */
function unique(path: string, taken: Set<string>): string {
  if (!taken.has(path.toLowerCase())) return path
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, '']
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`
    if (!taken.has(next.toLowerCase())) return next
  }
}

export function zipFiles(entries: readonly ZipEntry[]): Blob {
  const tree: Zippable = {}
  const taken = new Set<string>()
  const enc = new TextEncoder()
  for (const e of entries) {
    const path = unique(cleanPath(e.path), taken)
    taken.add(path.toLowerCase())
    // Copied into this realm's Uint8Array: fflate tells file data from a
    // folder by instanceof, which bytes made elsewhere (a worker, a test
    // environment's TextEncoder) fail.
    const bytes = new Uint8Array(typeof e.data === 'string' ? enc.encode(e.data) : e.data)
    tree[path] = [bytes, { level: STORED.test(path) ? 0 : 6 }]
  }
  return new Blob([zipSync(tree) as BlobPart], { type: 'application/zip' })
}
