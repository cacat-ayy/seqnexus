/**
 * Main-thread API for the built-in alignment Web Worker (Needleman–Wunsch,
 * Smith–Waterman and the simple progressive aligner). Falls back to running
 * on the main thread when a worker cannot start.
 *
 * Multiple alignment with MAFFT, MUSCLE or Kalign goes through
 * msa/engines/runner instead.
 */

import type { AlignmentRequest, AlignmentResult } from '../alignment/types'
import { executeAlignment } from '../alignment/run'

export type { AlignmentRequest, AlignmentResult }

export interface AlignmentHandle {
  promise: Promise<AlignmentResult>
  cancel: () => void
}

export function runAlignment(request: AlignmentRequest): AlignmentHandle {
  let cancelled = false
  let worker: Worker | null = null

  const promise = new Promise<AlignmentResult>((resolve, reject) => {
    try {
      worker = new Worker(
        new URL('./alignment.worker.ts', import.meta.url),
        { type: 'module' },
      )

      worker.onmessage = (e: MessageEvent<AlignmentResult | { error: string }>) => {
        worker?.terminate()
        if (cancelled) return
        if ('error' in e.data && typeof e.data.error === 'string') {
          reject(new Error(e.data.error))
        } else {
          resolve(e.data as AlignmentResult)
        }
      }

      worker.onerror = () => {
        worker?.terminate()
        worker = null
        runOnMainThread(request, () => cancelled, resolve, reject)
      }

      worker.postMessage(request)
    } catch {
      runOnMainThread(request, () => cancelled, resolve, reject)
    }
  })

  const cancel = () => {
    cancelled = true
    worker?.terminate()
  }

  return { promise, cancel }
}

function runOnMainThread(
  request: AlignmentRequest,
  isCancelled: () => boolean,
  resolve: (r: AlignmentResult) => void,
  reject: (e: Error) => void,
) {
  setTimeout(() => {
    if (isCancelled()) return
    try {
      const result = executeAlignment(request)
      if (!isCancelled()) resolve(result)
    } catch (err) {
      if (!isCancelled()) reject(err instanceof Error ? err : new Error(String(err)))
    }
  }, 50)
}
