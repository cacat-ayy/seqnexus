/**
 * Web Worker: the guide scan, and the off-target search.
 *
 * Finding sites is a regular-expression sweep, but scoring them is not: the
 * repair prediction walks a window either side of every cut, and a relaxed
 * PAM on a long sequence can produce tens of thousands of sites. The
 * off-target search is heavier again, since it reads every target the user
 * named. Both run here so neither holds the UI.
 *
 * The scan answers once. The search reports progress as it moves from target
 * to target and then answers, so a search over a genome-sized file can say
 * where it has got to.
 *
 * Nucleases and targets travel as plain records and the results come back as
 * plain objects, so nothing needs rehydrating on the main thread.
 */

import { findGuideSites, type GuideScanOptions } from '../crispr/finder'
import { scoreSites } from '../crispr/score/guide'
import { findOffTargets, type OffTargetReport, type OffTargetSettings, type SearchTarget } from '../crispr/offtarget'
import type { GuideCandidate, Nuclease, PromoterId } from '../crispr/types'

export interface CrisprScanRequest {
  kind: 'scan'
  bases: string
  nuclease: Nuclease
  topology: 'linear' | 'circular'
  options?: GuideScanOptions
  promoter?: PromoterId
  /** Leave unset to let the scorer decide from the number of sites. */
  repair?: boolean
}

export interface OffTargetRequest {
  kind: 'offtarget'
  /** One entry per guide to check, so a batch is one trip. */
  spacers: { key: string; spacer: string }[]
  nuclease: Nuclease
  targets: SearchTarget[]
  settings: OffTargetSettings
  /** The site each spacer was designed against, so its own site is not a hit. */
  excludes?: Record<string, { targetId: string; start: number; strand: 1 | -1 }>
}

export type CrisprRequest = CrisprScanRequest | OffTargetRequest

export interface CrisprScanResponse {
  kind: 'scan'
  candidates: GuideCandidate[]
  truncated: boolean
  skippedAmbiguous: number
}

export interface OffTargetResponse {
  kind: 'offtarget'
  reports: Record<string, OffTargetReport>
}

export interface CrisprProgress {
  kind: 'progress'
  /** Guides finished, of the batch. */
  guidesDone: number
  guidesTotal: number
  /** Targets finished within the guide being searched. */
  targetsDone: number
  targetsTotal: number
  targetName: string
}

export type CrisprResponse = CrisprScanResponse | OffTargetResponse

export function runScan(request: CrisprScanRequest): CrisprScanResponse {
  const { bases, nuclease, topology, options, promoter, repair } = request
  const scan = findGuideSites(bases, nuclease, topology, options)
  const candidates = scoreSites(scan.sites, nuclease, bases, topology, { promoter, repair })
  return { kind: 'scan', candidates, truncated: scan.truncated, skippedAmbiguous: scan.skippedAmbiguous }
}

export function runOffTarget(
  request: OffTargetRequest,
  onProgress?: (progress: CrisprProgress) => void,
): OffTargetResponse {
  const { spacers, nuclease, targets, settings, excludes } = request
  const reports: Record<string, OffTargetReport> = {}
  spacers.forEach((entry, i) => {
    reports[entry.key] = findOffTargets(
      entry.spacer,
      nuclease,
      targets,
      settings,
      excludes?.[entry.key],
      p => onProgress?.({
        kind: 'progress',
        guidesDone: i,
        guidesTotal: spacers.length,
        targetsDone: p.done,
        targetsTotal: p.total,
        targetName: p.name,
      }),
    )
  })
  return { kind: 'offtarget', reports }
}

export function runRequest(
  request: CrisprRequest,
  onProgress?: (progress: CrisprProgress) => void,
): CrisprResponse {
  return request.kind === 'scan' ? runScan(request) : runOffTarget(request, onProgress)
}

self.onmessage = (e: MessageEvent<CrisprRequest>) => {
  const response = runRequest(e.data, progress => self.postMessage(progress))
  self.postMessage(response)
}
