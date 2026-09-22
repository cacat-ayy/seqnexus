/**
 * Main-thread API for the alignment Web Worker.
 * Tries a module worker first; falls back to running alignment
 * directly on the main thread (via setTimeout to allow UI updates).
 *
 * For MAFFT (WASM), runs async on the main thread — the WASM execution
 * is non-blocking so no worker is needed.
 */

import type { AlignmentRequest, AlignmentResult } from '../alignment/types'
import { executeAlignment } from '../alignment/run'
import { runMafft } from '../wasm/mafft'

export type { AlignmentRequest, AlignmentResult }

export interface AlignmentHandle {
  promise: Promise<AlignmentResult>
  cancel: () => void
  /** Which MSA engine is actually being used (resolved from 'auto'). */
  engineUsed?: 'mafft' | 'builtin'
}

/**
 * Check if MAFFT should be used for this request.
 * Returns true for MSA (3+ seqs) when engine is 'auto' or 'mafft'.
 */
function shouldUseMafft(request: AlignmentRequest): boolean {
  const engine = request.engine ?? 'auto'
  if (engine === 'builtin') return false
  if (request.sequences.length < 3) return false
  return engine === 'mafft' || engine === 'auto'
}

/**
 * Run sequence alignment.
 *
 * For MSA with MAFFT engine: runs async on main thread via WASM.
 * For built-in algorithms: tries Web Worker, falls back to main thread.
 *
 * @param onMafftProgress Optional callback for MAFFT download progress (first use only)
 */
export function runAlignment(
  request: AlignmentRequest,
  onMafftProgress?: (fraction: number) => void,
): AlignmentHandle {
  let cancelled = false

  // MAFFT path: async on main thread
  if (shouldUseMafft(request)) {
    const promise = runMafftAlignment(request, cancelled, onMafftProgress)
    return {
      promise,
      cancel: () => { cancelled = true },
      engineUsed: 'mafft',
    }
  }

  // Built-in path: Web Worker with main-thread fallback
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
        runOnMainThread(request, cancelled, resolve, reject)
      }

      worker.postMessage(request)
    } catch {
      runOnMainThread(request, cancelled, resolve, reject)
    }
  })

  const cancel = () => {
    cancelled = true
    worker?.terminate()
  }

  return { promise, cancel, engineUsed: 'builtin' }
}

/**
 * Resolve which MSA engine to use.
 * 'auto' always prefers MAFFT — it will be downloaded from CDN on first use.
 */
export async function resolveEngine(
  engine: 'auto' | 'mafft' | 'builtin',
  seqCount: number,
): Promise<'mafft' | 'builtin'> {
  if (engine === 'builtin' || seqCount < 3) return 'builtin'
  return 'mafft'
}

async function runMafftAlignment(
  request: AlignmentRequest,
  cancelled: boolean,
  onProgress?: (fraction: number) => void,
): Promise<AlignmentResult> {
  try {
    const result = await runMafft(request.sequences, request.seqType, onProgress)
    if (cancelled) throw new Error('Cancelled')
    return result
  } catch (err) {
    if (cancelled) throw new Error('Cancelled')
    // If MAFFT fails and engine is 'auto', fall back to built-in
    if ((request.engine ?? 'auto') === 'auto') {
      console.warn('MAFFT failed, falling back to built-in MSA:', err)
      const errMsg = err instanceof Error ? err.message : String(err)
      const result = executeAlignment({ ...request, engine: 'builtin' })
      result.warning = `MAFFT failed (${errMsg}), used built-in alignment instead.`
      return result
    }
    throw err
  }
}

function runOnMainThread(
  request: AlignmentRequest,
  cancelled: boolean,
  resolve: (r: AlignmentResult) => void,
  reject: (e: Error) => void,
) {
  setTimeout(() => {
    if (cancelled) return
    try {
      const result = executeAlignment(request)
      if (!cancelled) resolve(result)
    } catch (err) {
      if (!cancelled) reject(err instanceof Error ? err : new Error(String(err)))
    }
  }, 50)
}
