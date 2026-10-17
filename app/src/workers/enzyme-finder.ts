/**
 * Main-thread API for the enzyme finder Web Worker.
 */

import type { RestrictionEnzyme } from '../enzymes/db'
import { MAX_LISTED_SITES, type CutSite, type EnzymeScan } from '../enzymes/finder'
import type { EnzymeFinderRequest, EnzymeFinderResponse } from './enzyme-finder.worker'

/** What a scan rejects with when a newer scan on the same channel replaces it. */
export class ScanCancelled extends Error {
  constructor() {
    super('Superseded by a newer scan')
    this.name = 'ScanCancelled'
  }
}

/**
 * The scan in flight per channel. Each caller scans on its own channel, so
 * one never cancels another's: the Restriction Enzymes dialog and the map's
 * rescan of the enzymes it shows used to share one worker, and on a genome
 * the map's rescan, started while the dialog's was still running, killed it
 * and left the dialog on "Scanning..." for good.
 */
const active = new Map<string, { worker: Worker; reject: (e: unknown) => void }>()

export interface ScanOptions {
  /** Scans on the same channel replace each other; the default is 'default'. */
  channel?: string
  /** Sites past which an enzyme is counted, not listed (see MAX_LISTED_SITES). */
  maxSites?: number
}

/**
 * Find restriction enzyme sites in a Web Worker, for display: an enzyme with
 * more than `maxSites` sites is counted, not listed. A newer scan on the same
 * channel cancels this one, which then rejects with ScanCancelled. Where a
 * module worker cannot start (app.html opened from disk), it runs on the main
 * thread instead.
 */
export function findEnzymeSitesAsync(
  bases: string,
  enzymes: RestrictionEnzyme[],
  topology: 'linear' | 'circular',
  { channel = 'default', maxSites = MAX_LISTED_SITES }: ScanOptions = {},
): Promise<EnzymeScan> {
  const previous = active.get(channel)
  if (previous) {
    active.delete(channel)
    previous.worker.terminate()
    previous.reject(new ScanCancelled())
  }

  const request: EnzymeFinderRequest = { bases, enzymes, topology, maxSites }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(
        new URL('./enzyme-finder.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // Fallback: run on the main thread. A throw in here must reach the
      // caller, or it waits for a result that never comes.
      import('../enzymes/finder')
        .then(({ scanEnzymes }) => resolve(scanEnzymes(bases, enzymes, topology, maxSites)))
        .catch(reject)
      return
    }

    const entry = { worker, reject }
    active.set(channel, entry)
    const done = () => {
      if (active.get(channel) === entry) active.delete(channel)
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<EnzymeFinderResponse>) => {
      // Rehydrate: attach full enzyme references
      const sites: CutSite[] = e.data.sites.map(({ enzymeIdx, ...s }) => ({ ...s, enzyme: enzymes[enzymeIdx] }))
      resolve({ sites, tooMany: new Map(e.data.tooMany) })
      done()
    }

    worker.onerror = (err) => {
      reject(err)
      done()
    }

    worker.postMessage(request)
  })
}
