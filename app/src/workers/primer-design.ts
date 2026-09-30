/**
 * Main-thread API for the primer design worker.
 *
 * The workbench re-designs as the target and settings change, so requests
 * arrive in bursts. One worker is kept and reused while idle; a request that
 * arrives while another is still running supersedes it. A running search
 * cannot be interrupted from outside, so superseding means terminating that
 * worker and starting a fresh one. The superseded promise resolves to null
 * rather than rejecting: being replaced is not an error.
 */

import { designPrimers } from '../primers/design/design'
import type { DesignRequest, DesignResult } from '../primers/design/types'
import type { PrimerDesignMessage, PrimerDesignResponse } from './primer-design.worker'

let worker: Worker | null = null
let nextId = 0
let inFlight: { id: number; resolve: (r: DesignResult | null) => void } | null = null

function spawn(): Worker | null {
  try {
    const w = new Worker(new URL('./primer-design.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<PrimerDesignResponse>) => {
      if (inFlight && inFlight.id === e.data.id) {
        const { resolve } = inFlight
        inFlight = null
        resolve(e.data.result)
      }
    }
    w.onerror = () => {
      // A crashed worker is dropped; the next request spawns a new one.
      const pending = inFlight
      inFlight = null
      worker?.terminate()
      worker = null
      pending?.resolve(null)
    }
    return w
  } catch {
    return null
  }
}

export function designPrimersAsync(request: DesignRequest): Promise<DesignResult | null> {
  if (inFlight) {
    worker?.terminate()
    worker = null
    inFlight.resolve(null)
    inFlight = null
  }
  if (!worker) worker = spawn()

  // No Worker support (tests, very old browsers): run inline.
  if (!worker) return Promise.resolve(designPrimers(request))

  const id = ++nextId
  return new Promise(resolve => {
    inFlight = { id, resolve }
    const message: PrimerDesignMessage = { id, request }
    worker!.postMessage(message)
  })
}

/** Abandon whatever is running, e.g. when the workbench closes. */
export function cancelPrimerDesign(): void {
  if (!inFlight) return
  worker?.terminate()
  worker = null
  inFlight.resolve(null)
  inFlight = null
}
