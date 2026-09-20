/**
 * Main-thread API for the primer finder Web Worker.
 */

import type { PrimerPairRequest, PrimerPair } from '../primers/finder'
import { findPrimerPairs } from '../primers/finder'
import type { PrimerFinderResponse } from './primer-finder.worker'

let activeWorker: Worker | null = null

/**
 * Find primer pairs in a Web Worker.
 * Cancels any previous in-flight request.
 */
export function findPrimerPairsAsync(
  request: PrimerPairRequest,
): Promise<PrimerPair[]> {
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL('./primer-finder.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // Fallback: run synchronously on main thread
      try {
        resolve(findPrimerPairs(request))
      } catch (err) {
        reject(err)
      }
      return
    }

    activeWorker = worker

    worker.onmessage = (e: MessageEvent<PrimerFinderResponse>) => {
      resolve(e.data.pairs)
      activeWorker = null
      worker.terminate()
    }

    worker.onerror = (err) => {
      reject(err)
      activeWorker = null
      worker.terminate()
    }

    worker.postMessage(request)
  })
}
