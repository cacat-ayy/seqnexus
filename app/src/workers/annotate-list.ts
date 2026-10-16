/**
 * Main-thread API for the annotation list matcher.
 *
 * The worker is inlined into the page as a blob, so it also starts on a page
 * opened from disk (file://), where the browser refuses module workers. If
 * even that fails, the scan runs on the page.
 */

import AnnotateListWorker from './annotate-list.worker.ts?worker&inline'
import {
  scanForReferences,
  type ReferenceAnnotation,
  type AnnotateListRequest,
  type AnnotationMatch,
} from '../features/annotate-scan'
import { proposalName } from '../utils/auto-annotations'

export type { ReferenceAnnotation, AnnotateListRequest, AnnotationMatch }

let _nextId = 0

export function matchToAnnotationData(match: AnnotationMatch) {
  const id = `ref_${++_nextId}`
  return {
    id,
    // The name the suggestion was drawn with, so a conversion does not rename it.
    name: proposalName(match),
    type: match.refType,
    start: match.start,
    end: match.end,
    strand: match.strand as 1 | -1,
    color: match.color ?? '#20c997',
    ...(match.coverage !== undefined ? { truncated: true } : {}),
  }
}

export function annotateFromList(
  documentBases: string,
  references: ReferenceAnnotation[],
  minSimilarity: number,
  bestMatchOnly: boolean,
  protein = false,
  circular = false,
): Promise<AnnotationMatch[]> {
  const request: AnnotateListRequest = {
    documentBases,
    references,
    minSimilarity,
    bestMatchOnly,
    protein,
    circular,
  }

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new AnnotateListWorker()
    } catch {
      resolve(scanForReferences(request))
      return
    }

    worker.onmessage = (e: MessageEvent<{ matches: AnnotationMatch[] }>) => {
      worker.terminate()
      resolve(e.data.matches)
    }

    worker.onerror = () => {
      // A worker that could not run: do the work here instead.
      worker.terminate()
      try {
        resolve(scanForReferences(request))
      } catch (err) {
        reject(err)
      }
    }

    worker.postMessage(request)
  })
}
