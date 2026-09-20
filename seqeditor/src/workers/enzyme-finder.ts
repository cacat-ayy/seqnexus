/**
 * Main-thread API for the enzyme finder Web Worker.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import type { CutSite } from '../enzymes/finder'
import type { EnzymeFinderRequest, SerializedCutSite } from './enzyme-finder.worker'

let activeWorker: Worker | null = null

/**
 * Find restriction enzyme sites in a Web Worker.
 * Cancels any previous in-flight request.
 * Returns CutSite[] with full enzyme references restored.
 */
export function findEnzymeSitesAsync(
  bases: string,
  enzymes: RestrictionEnzyme[],
  topology: 'linear' | 'circular',
): Promise<CutSite[]> {
  // Cancel previous worker if still running
  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  const request: EnzymeFinderRequest = { bases, enzymes, topology }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL('./enzyme-finder.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // Fallback: run synchronously on main thread
      import('../enzymes/finder').then(({ findAllSites }) => {
        resolve(findAllSites(bases, enzymes, topology))
      })
      return
    }

    activeWorker = worker

    worker.onmessage = (e: MessageEvent<{ sites: SerializedCutSite[] }>) => {
      // Rehydrate: attach full enzyme references
      const sites: CutSite[] = e.data.sites.map(s => ({
        enzyme: enzymes[s.enzymeIdx],
        position: s.position,
        end: s.end,
        fwdCut: s.fwdCut,
        revCut: s.revCut,
        strand: s.strand,
      }))
      resolve(sites)
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
