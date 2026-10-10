/**
 * Main-thread API for the guide scan worker.
 *
 * One scan at a time: a new request cancels the one in flight, since the
 * panel only ever shows the latest. When a module worker cannot be created,
 * which is the case for the built page opened straight from disk, the scan
 * runs on the main thread instead of failing.
 */

import type { CrisprScanRequest, CrisprScanResponse } from './crispr.worker'

let activeWorker: Worker | null = null

export function scanGuidesAsync(request: CrisprScanRequest): Promise<CrisprScanResponse> {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./crispr.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      import('./crispr.worker').then(({ runScan }) => resolve(runScan(request))).catch(reject)
      return
    }

    activeWorker = worker

    worker.onmessage = (e: MessageEvent<CrisprScanResponse>) => {
      resolve(e.data)
      activeWorker = null
      worker.terminate()
    }

    worker.onerror = (err) => {
      // A worker that fails to load at all (file:// again) still has to answer.
      activeWorker = null
      worker.terminate()
      import('./crispr.worker').then(({ runScan }) => resolve(runScan(request))).catch(() => reject(err))
    }

    worker.postMessage(request)
  })
}

/** Drop the scan in flight, when the panel closes or the document changes. */
export function cancelGuideScan(): void {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }
}
