/**
 * Web Worker: the guide site scan.
 *
 * Finding sites is a regular-expression sweep, but scoring them is not: the
 * repair prediction walks a window either side of every cut, and a relaxed
 * PAM on a long sequence can produce tens of thousands of sites. Both run
 * here so a scan never holds the UI.
 *
 * The nuclease travels as a plain record and the candidates come back as
 * plain objects, so nothing needs rehydrating on the main thread.
 */

import { findGuideSites, type GuideScanOptions } from '../crispr/finder'
import { scoreSites } from '../crispr/score/guide'
import type { GuideCandidate, Nuclease, PromoterId } from '../crispr/types'

export interface CrisprScanRequest {
  bases: string
  nuclease: Nuclease
  topology: 'linear' | 'circular'
  options?: GuideScanOptions
  promoter?: PromoterId
  /** Leave unset to let the scorer decide from the number of sites. */
  repair?: boolean
}

export interface CrisprScanResponse {
  candidates: GuideCandidate[]
  truncated: boolean
  skippedAmbiguous: number
}

export function runScan(request: CrisprScanRequest): CrisprScanResponse {
  const { bases, nuclease, topology, options, promoter, repair } = request
  const scan = findGuideSites(bases, nuclease, topology, options)
  const candidates = scoreSites(scan.sites, nuclease, bases, topology, { promoter, repair })
  return { candidates, truncated: scan.truncated, skippedAmbiguous: scan.skippedAmbiguous }
}

self.onmessage = (e: MessageEvent<CrisprScanRequest>) => {
  const response = runScan(e.data)
  self.postMessage(response)
}
