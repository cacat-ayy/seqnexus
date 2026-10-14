/**
 * Main-thread API for the ORF finder Web Worker.
 */

import { findOrfs, type ORFResult, type ORFRequest } from '../orfs/finder'

export type { ORFResult, ORFRequest }

export interface ORFOptions {
  /** The fewest residues an ORF must encode, the stop not counted. */
  minAminoAcids: number
  maxAminoAcids: number   // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean
  topology?: 'linear' | 'circular'
  /** NCBI translation table id for the stop codons; standard code when absent. */
  geneticCode?: number
  /** Also report ORFs cut off by the ends of a linear sequence. */
  includePartial?: boolean
}

export const DEFAULT_ORF_OPTIONS: ORFOptions = {
  minAminoAcids: 100,
  maxAminoAcids: 0,
  startCodons: ['ATG'],
  allowInterior: true,
}

// Color palette for ORF annotations by frame
export const ORF_COLORS: Record<string, string> = {
  '1_0': '#4dabf7',
  '1_1': '#69db7c',
  '1_2': '#ffd43b',
  '-1_0': '#ff8787',
  '-1_1': '#da77f2',
  '-1_2': '#ffa94d',
}

export function orfColor(strand: 1 | -1, frame: number): string {
  return ORF_COLORS[`${strand}_${frame}`] ?? '#adb5bd'
}

/** The scan still running. A new one stops it: only the latest answer is wanted. */
let activeWorker: Worker | null = null

/**
 * Run the ORF finder in a Web Worker. A scan started before this one is
 * stopped, and its promise never settles; edits made while typing would
 * otherwise leave a worker running for every pause.
 */
export function findORFs(bases: string, options: ORFOptions = DEFAULT_ORF_OPTIONS): Promise<ORFResult[]> {
  const request: ORFRequest = {
    bases,
    minAminoAcids: options.minAminoAcids,
    maxAminoAcids: options.maxAminoAcids,
    startCodons: options.startCodons,
    allowInterior: options.allowInterior,
    topology: options.topology,
    geneticCode: options.geneticCode,
    includePartial: options.includePartial,
  }

  if (activeWorker) {
    activeWorker.terminate()
    activeWorker = null
  }

  return new Promise((resolve, reject) => {
    let worker: Worker

    try {
      worker = new Worker(
        new URL('./orf-finder.worker.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      // No workers here: run the same finder on the main thread.
      try {
        resolve(findOrfs(request))
      } catch (err) {
        reject(err)
      }
      return
    }

    activeWorker = worker
    const done = () => {
      if (activeWorker === worker) activeWorker = null
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<{ orfs: ORFResult[] }>) => {
      resolve(e.data.orfs)
      done()
    }

    worker.onerror = (err) => {
      // A worker that can't load (a page opened from disk) is not a reason to
      // show no ORFs: run the same finder here instead.
      err.preventDefault?.()
      done()
      try {
        resolve(findOrfs(request))
      } catch {
        reject(err)
      }
    }

    worker.postMessage(request)
  })
}
