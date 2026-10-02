/**
 * Main-thread API for the ORF finder Web Worker.
 */

import { findOrfs, type ORFResult, type ORFRequest } from '../orfs/finder'

export type { ORFResult, ORFRequest }

export interface ORFOptions {
  minCodons: number
  maxCodons: number       // 0 = no limit
  startCodons: string[]   // e.g. ['ATG'] or ['ATG', 'GTG', 'TTG']
  allowInterior: boolean
  topology?: 'linear' | 'circular'
  /** NCBI translation table id for the stop codons; standard code when absent. */
  geneticCode?: number
}

export const DEFAULT_ORF_OPTIONS: ORFOptions = {
  minCodons: 100,
  maxCodons: 0,
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

/**
 * Run the ORF finder in a Web Worker.
 */
export function findORFs(bases: string, options: ORFOptions = DEFAULT_ORF_OPTIONS): Promise<ORFResult[]> {
  const request: ORFRequest = {
    bases,
    minCodons: options.minCodons,
    maxCodons: options.maxCodons,
    startCodons: options.startCodons,
    allowInterior: options.allowInterior,
    topology: options.topology,
    geneticCode: options.geneticCode,
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

    worker.onmessage = (e: MessageEvent<{ orfs: ORFResult[] }>) => {
      resolve(e.data.orfs)
      worker.terminate()
    }

    worker.onerror = (err) => {
      reject(err)
      worker.terminate()
    }

    worker.postMessage(request)
  })
}
