/**
 * Run an assembly in a Web Worker, with progress and cancel. Falls back to
 * the main thread when a worker cannot start.
 */

import { runAssembly, type AssemblyMessage, type AssemblyRequest } from '../assembly/run'
import type { AssemblyReport } from '../assembly/types'

export interface AssemblyHandle {
  promise: Promise<AssemblyReport>
  cancel: () => void
}

export function startAssembly(req: AssemblyRequest, onProgress?: (done: number, total: number) => void): AssemblyHandle {
  let worker: Worker | null = null
  let cancelled = false
  const promise = new Promise<AssemblyReport>((resolve, reject) => {
    const fallback = () => {
      setTimeout(() => {
        if (cancelled) return
        try { resolve(runAssembly(req, onProgress)) } catch (err) { reject(err) }
      }, 0)
    }
    try {
      worker = new Worker(new URL('./assembly.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<AssemblyMessage>) => {
        if (cancelled) return
        const m = e.data
        if (m.type === 'progress') onProgress?.(m.done, m.total)
        else if (m.type === 'done') { worker?.terminate(); resolve(m.report) }
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
