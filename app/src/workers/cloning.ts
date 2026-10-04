/**
 * Run a library of constructs in a Web Worker, with progress and cancel.
 * Falls back to the main thread when a worker cannot start.
 */

import { runBulkRequest, type BulkMessage, type BulkRequest } from '../cloning/bulk-run'
import type { BulkResult } from '../cloning/bulk'

export interface BulkHandle {
  promise: Promise<BulkResult>
  cancel: () => void
}

export function startBulk(
  req: BulkRequest,
  onProgress?: (done: number, total: number) => void,
): BulkHandle {
  let worker: Worker | null = null
  let cancelled = false

  const promise = new Promise<BulkResult>((resolve, reject) => {
    const fallback = () => {
      // Without a worker the run blocks the page, so it is handed to the next
      // frame and checks `cancelled` between combinations.
      setTimeout(() => {
        if (cancelled) return
        try {
          resolve(runBulkRequest(req, onProgress, () => cancelled))
        } catch (err) {
          reject(err)
        }
      }, 0)
    }

    try {
      worker = new Worker(new URL('./cloning.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<BulkMessage>) => {
        if (cancelled) return
        const m = e.data
        if (m.type === 'progress') onProgress?.(m.done, m.total)
        else if (m.type === 'done') { worker?.terminate(); resolve(m.result) }
        else { worker?.terminate(); reject(new Error(m.message)) }
      }
      worker.onerror = () => { worker?.terminate(); worker = null; fallback() }
      worker.postMessage(req)
    } catch {
      fallback()
    }
  })

  return {
    promise,
    cancel: () => {
      cancelled = true
      worker?.terminate()
    },
  }
}
