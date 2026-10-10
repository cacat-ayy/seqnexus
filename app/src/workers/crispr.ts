/**
 * Main-thread API for the guide worker.
 *
 * One job at a time: a new request cancels the one in flight, since the panel
 * only ever shows the latest. When a module worker cannot be created, which
 * is the case for the built page opened straight from disk, the job runs on
 * the main thread instead of failing. It then blocks until it is done, so
 * progress arrives in one piece at the end rather than along the way, which
 * the panel copes with because progress is only ever advisory.
 */

import type {
  AlleleRequest,
  AlleleResponse,
  CrisprProgress,
  CrisprRequest,
  CrisprResponse,
  CrisprScanRequest,
  CrisprScanResponse,
  OffTargetRequest,
  OffTargetResponse,
} from './crispr.worker'

let activeWorker: Worker | null = null

function run(
  request: CrisprRequest,
  onProgress?: (progress: CrisprProgress) => void,
): Promise<CrisprResponse> {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./crispr.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      import('./crispr.worker').then(({ runRequest }) => resolve(runRequest(request, onProgress))).catch(reject)
      return
    }

    activeWorker = worker

    worker.onmessage = (e: MessageEvent<CrisprResponse | CrisprProgress>) => {
      if (e.data.kind === 'progress') {
        onProgress?.(e.data)
        return
      }
      resolve(e.data)
      activeWorker = null
      worker.terminate()
    }

    worker.onerror = (err) => {
      // A worker that fails to load at all (file:// again) still has to answer.
      activeWorker = null
      worker.terminate()
      import('./crispr.worker')
        .then(({ runRequest }) => resolve(runRequest(request, onProgress)))
        .catch(() => reject(err))
    }

    worker.postMessage(request)
  })
}

export function scanGuidesAsync(request: Omit<CrisprScanRequest, 'kind'>): Promise<CrisprScanResponse> {
  return run({ ...request, kind: 'scan' }) as Promise<CrisprScanResponse>
}

export function callAllelesAsync(request: Omit<AlleleRequest, 'kind'>): Promise<AlleleResponse> {
  return run({ ...request, kind: 'alleles' }) as Promise<AlleleResponse>
}

export function findOffTargetsAsync(
  request: Omit<OffTargetRequest, 'kind'>,
  onProgress?: (progress: CrisprProgress) => void,
): Promise<OffTargetResponse> {
  return run({ ...request, kind: 'offtarget' }, onProgress) as Promise<OffTargetResponse>
}

/** Drop the job in flight, when the panel closes or the document changes. */
export function cancelGuideScan(): void {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
}
