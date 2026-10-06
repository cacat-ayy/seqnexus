/**
 * Start a read set job and follow it: in a worker (readset.worker.ts), or on
 * the page when no worker can start, as on a page opened from disk
 * (file://), where Chrome refuses module workers. On the page the job runs
 * in chunk-sized steps between awaits, so the page stays usable.
 */

import type { ReadSetMessage } from './readset.worker'
import { CancelledError, runReadSetJob, type ReadSetJob } from '../ngs/jobs'
import type { ImportResult } from '../ngs/importer'
import type { TrimResult } from '../ngs/trimmer'
import type { MappingReport } from '../ngs/builder'

export { CancelledError } from '../ngs/jobs'

export interface JobHandle<T> {
  promise: Promise<T>
  cancel: () => void
}

/** Where the WebAssembly builds are served: /wasm next to the app page. */
export function wasmBase(): string {
  return new URL('wasm/', document.baseURI).href
}

function runHere<T>(job: ReadSetJob, onProgress?: (done: number, total: number) => void): JobHandle<T> {
  let stop = false
  return {
    promise: runReadSetJob(job, (d, t) => onProgress?.(d, t), () => stop) as Promise<T>,
    cancel: () => { stop = true },
  }
}

function run<T>(job: ReadSetJob, onProgress?: (done: number, total: number) => void): JobHandle<T> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./readset.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return runHere<T>(job, onProgress)
  }
  let here: JobHandle<T> | null = null
  let heard = false
  let fail: ((err: Error) => void) | null = null
  const promise = new Promise<T>((resolve, reject) => {
    fail = reject
    worker.onmessage = (e: MessageEvent<ReadSetMessage>) => {
      heard = true
      const m = e.data
      if (m.type === 'progress') onProgress?.(m.done, m.total)
      else if (m.type === 'done') { worker.terminate(); resolve(m.result as T) }
      else { worker.terminate(); reject(new Error(m.message)) }
    }
    worker.onerror = ev => {
      worker.terminate()
      // A worker that failed to load before saying anything: run on the page.
      if (!heard) {
        here = runHere<T>(job, onProgress)
        here.promise.then(resolve, reject)
        return
      }
      reject(new Error(ev.message || 'The background worker failed'))
    }
    worker.postMessage(job)
  })
  return {
    promise,
    cancel: () => {
      worker.terminate()
      if (here) here.cancel()
      else fail?.(new CancelledError())
    },
  }
}

export function startImport(job: Extract<ReadSetJob, { type: 'import' }>, onProgress?: (done: number, total: number) => void) {
  return run<ImportResult>(job, onProgress)
}

export function startTrim(job: Extract<ReadSetJob, { type: 'trim' }>, onProgress?: (done: number, total: number) => void) {
  return run<TrimResult>(job, onProgress)
}

export function startExport(job: Extract<ReadSetJob, { type: 'export' }>, onProgress?: (done: number, total: number) => void) {
  return run<Blob[]>(job, onProgress)
}

export function startMap(job: Extract<ReadSetJob, { type: 'map' }>, onProgress?: (done: number, total: number) => void) {
  return run<MappingReport>(job, onProgress)
}

export function startExportMapping(job: Extract<ReadSetJob, { type: 'export-mapping' }>, onProgress?: (done: number, total: number) => void) {
  return run<{ file: Blob; index: Blob | null }>(job, onProgress)
}

export function startCallVariants(job: Extract<ReadSetJob, { type: 'call-variants' }>, onProgress?: (done: number, total: number) => void) {
  return run<{ sites: number }>(job, onProgress)
}

export function startFindJunctions(job: Extract<ReadSetJob, { type: 'find-junctions' }>, onProgress?: (done: number, total: number) => void) {
  return run<{ junctions: number }>(job, onProgress)
}

export function startImportAlignments(job: Extract<ReadSetJob, { type: 'import-alignments' }>, onProgress?: (done: number, total: number) => void) {
  return run<MappingReport>(job, onProgress)
}
