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
import { getReadChunk, putReadChunk } from '../storage/idb'
import { runTool } from '../msa/engines/emscripten'
import { isLongRead, type Technology, type TrimSettings } from './types'

export type ReadSetJob =
  | { type: 'import'; id: string; files: File[]; layout: ReadLayout; technology: Technology }
  | { type: 'trim'; fromId: string; toId: string; chunks: number; paired: boolean; technology: Technology; settings: TrimSettings; wasmBase: string }
  | { type: 'export'; id: string; chunks: number; paired: boolean; layout: ExportLayout }
  | {
      type: 'map'
      /** Where the alignments and coverage are stored (see mappingStorageIds). */
      storageId: string
      readSet: { id: string; chunks: number; paired: boolean; technology: Technology; maxLength: number }
      refs: MapReference[]
      preset: MapPreset
      wasmBase: string
    }

export class CancelledError extends Error {
  constructor() { super('Cancelled') }
}

/** True when the page was opened from disk, where fastp cannot be loaded. */
export function openedAsFile(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'file:'
}

/** The read set ids under which a mapping stores its alignments and its coverage. */
export function mappingStorageIds(storageId: string): { alignments: string; coverage: string } {
  return { alignments: `${storageId}-aln`, coverage: `${storageId}-cov` }
}

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

async function toolRunner(base: string, dir: string, program: string): Promise<FastpRunner> {
  const [glue, wasm, data] = await Promise.all([
    fetchOk(`${base}${dir}${program}.js`).then(r => r.text()),
    fetchOk(`${base}${dir}${program}.wasm`).then(r => r.arrayBuffer()),
    fetchOk(`${base}${dir}${program}.data`).then(r => r.arrayBuffer()),
  ])
  return (args, files, outputs) => runTool(glue, wasm, { args, files, outputs, dataPackage: data })
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
    const minimap2 = await toolRunner(job.wasmBase, 'minimap2/2.22/', 'minimap2')
    const ids = mappingStorageIds(job.storageId)
    return mapReads({
      readSet: job.readSet,
      refs: job.refs,
      preset: job.preset,
      minimap2,
      getChunk: i => { check(); return getReadChunk(job.readSet.id, i) },
      putAlignments: (i, d) => putReadChunk(ids.alignments, i, d),
      putCoverage: (i, d) => putReadChunk(ids.coverage, i, d),
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
