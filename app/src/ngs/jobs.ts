/**
 * The read set jobs (import, trim or filter, export), runnable in a worker
 * or, where no worker can start, on the page itself.
 *
 * Chrome will not start a module worker from a page opened as a file
 * (file://), so there the jobs run on the page. Import, export and the
 * long-read filter are plain JavaScript and work either way; fastp is a
 * WebAssembly program fetched from wasm/, which a file:// page may not fetch,
 * so short-read trimming needs SeqNexus opened from a web address.
 */

import { importReads, type ReadLayout } from './importer'
import { trimReads, type FastpRunner } from './trimmer'
import { exportFastq, type ExportLayout } from './exporter'
import { mapReads, type MapPreset, type MapReference } from './mapper'
import { exportMapping } from './sam'
import { importAlignments } from './alignmentImport'
import { callMapping } from './calls'
import { findJunctions } from './junctions'
import type { PrimerSite } from './primerClip'
import type { MappingReport, MappingStorage } from './builder'
import { deleteReadChunks, getReadChunk, putReadChunk } from '../storage/idb'
import { runTool } from '../msa/engines/emscripten'
import { isLongRead, type Technology, type TrimSettings } from './types'

export type ReadSetJob =
  | { type: 'import'; id: string; files: File[]; layout: ReadLayout; technology: Technology }
  | { type: 'trim'; fromId: string; toId: string; chunks: number; paired: boolean; technology: Technology; settings: TrimSettings; wasmBase: string }
  | { type: 'export'; id: string; chunks: number; paired: boolean; layout: ExportLayout }
  | {
      type: 'map'
      /** Where the mapping is stored (see mappingStorageIds in builder.ts). */
      storageId: string
      readSet: { id: string; chunks: number; paired: boolean; technology: Technology; maxLength: number; bases: number }
      refs: MapReference[]
      preset: MapPreset
      wasmBase: string
      /** Clip primers at these sites, per reference (primerClip.ts). */
      primerSites?: PrimerSite[][]
    }
  | {
      type: 'export-mapping'
      format: 'sam' | 'bam'
      storageId: string
      references: { name: string; length: number; circular: boolean }[]
      program: MappingReport['program']
    }
  | {
      type: 'call-variants'
      storageId: string
      references: { name: string; length: number; circular: boolean }[]
    }
  | {
      type: 'find-junctions'
      storageId: string
      references: { name: string; length: number; circular: boolean }[]
    }
  | {
      type: 'import-alignments'
      file: File
      storageId: string
      /** Per reference in the file's header: the sequence to use, or null. */
      refs: (MapReference | null)[]
    }

export class CancelledError extends Error {
  constructor() { super('Cancelled') }
}

/** True when the page was opened from disk, where fastp cannot be loaded. */
export function openedAsFile(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'file:'
}

/** A mapping's storage: the read chunk store in IndexedDB. */
const idbStorage: MappingStorage = { put: putReadChunk, get: getReadChunk, remove: deleteReadChunks }

export const NEEDS_WEB = (tool: string) => `${tool} cannot run while SeqNexus is opened as a file (file://): the browser does not let such a page load the program. Start serve.bat in the SeqNexus folder and open http://localhost:8080/app.html, or open SeqNexus from its web address.`

export const FASTP_NEEDS_WEB = NEEDS_WEB('fastp')

async function fetchOk(url: string): Promise<Response> {
  let r: Response
  try {
    r = await fetch(url)
  } catch {
    throw new Error(url.startsWith('file:') ? NEEDS_WEB(url.split('/').slice(-2, -1)[0] ?? 'This tool') : `Could not load ${url.split('/').pop()}`)
  }
  if (!r.ok) throw new Error(`Could not load ${url.split('/').pop()} (${r.status})`)
  return r
}

async function toolRunner(base: string, dir: string, program: string, dataName = program): Promise<FastpRunner> {
  const [glue, wasm, data] = await Promise.all([
    fetchOk(`${base}${dir}${program}.js`).then(r => r.text()),
    fetchOk(`${base}${dir}${program}.wasm`).then(r => r.arrayBuffer()),
    fetchOk(`${base}${dir}${dataName}.data`).then(r => r.arrayBuffer()),
  ])
  return (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage: data })
}

/**
 * Can this browser run WebAssembly SIMD? A minimal module using a v128
 * instruction, as wasm-feature-detect tests it.
 */
export function wasmSimd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]))
  } catch {
    return false
  }
}

/**
 * minimap2's SIMD build where the browser has SIMD: the same alignments
 * (tested identical) about thirty times faster on short reads, its ksw2
 * extension being written for SIMD. Both builds share one data package.
 */
function minimap2Runner(base: string): Promise<FastpRunner> {
  return toolRunner(base, 'minimap2/2.22/', wasmSimd() ? 'minimap2-simd' : 'minimap2', 'minimap2')
}

function fastpRunner(base: string): Promise<FastpRunner> {
  return toolRunner(base, 'fastp/0.20.1/', 'fastp')
}

/**
 * Run a job. `stopped` is asked between chunks; when it says yes the job
 * stops with a CancelledError (a worker is simply terminated instead).
 */
export async function runReadSetJob(
  job: ReadSetJob,
  onProgress: (done: number, total: number) => void,
  stopped: () => boolean = () => false,
): Promise<unknown> {
  const check = () => { if (stopped()) throw new CancelledError() }
  const progress = (d: number, t: number) => { check(); onProgress(d, t) }
  if (job.type === 'import') {
    return importReads({
      sources: job.files,
      layout: job.layout,
      technology: job.technology,
      put: (i, d) => { check(); return putReadChunk(job.id, i, d) },
      onProgress: progress,
    })
  }
  if (job.type === 'trim') {
    const fastp = isLongRead(job.technology) ? undefined : await fastpRunner(job.wasmBase)
    return trimReads({
      chunks: job.chunks,
      getChunk: i => { check(); return getReadChunk(job.fromId, i) },
      paired: job.paired,
      technology: job.technology,
      settings: job.settings,
      put: (i, d) => putReadChunk(job.toId, i, d),
      fastp,
      onProgress: progress,
    })
  }
  if (job.type === 'map') {
    const minimap2 = await minimap2Runner(job.wasmBase)
    return mapReads({
      storageId: job.storageId,
      readSet: job.readSet,
      refs: job.refs,
      preset: job.preset,
      primerSites: job.primerSites,
      minimap2,
      getChunk: i => { check(); return getReadChunk(job.readSet.id, i) },
      storage: idbStorage,
      onProgress: progress,
    })
  }
  if (job.type === 'import-alignments') {
    return importAlignments({
      file: job.file,
      fileName: job.file.name,
      storageId: job.storageId,
      storage: idbStorage,
      refs: job.refs,
      onProgress: progress,
    })
  }
  if (job.type === 'call-variants') {
    return callMapping({
      storageId: job.storageId,
      storage: { get: (id, i) => { check(); return getReadChunk(id, i) }, put: putReadChunk },
      references: job.references,
      onProgress: progress,
    })
  }
  if (job.type === 'find-junctions') {
    return findJunctions({
      storageId: job.storageId,
      storage: { get: (id, i) => { check(); return getReadChunk(id, i) }, put: putReadChunk },
      references: job.references,
      onProgress: progress,
    })
  }
  if (job.type === 'export-mapping') {
    return exportMapping({
      format: job.format,
      storageId: job.storageId,
      storage: { get: (id, i) => { check(); return getReadChunk(id, i) } },
      references: job.references,
      program: job.program,
      onProgress: progress,
    })
  }
  const files = await exportFastq({
    chunks: job.chunks,
    getChunk: i => { check(); return getReadChunk(job.id, i) },
    paired: job.paired,
    layout: job.layout,
    onProgress: progress,
  })
  return files.map(parts => new Blob(parts as BlobPart[], { type: 'application/gzip' }))
}
