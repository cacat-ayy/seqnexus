/**
 * Web Worker: auto-annotate from a list of known annotation sequences. The
 * work is features/annotate-scan.ts; this file only answers messages.
 *
 * Input:  AnnotateListRequest
 * Output: { matches: AnnotationMatch[] }
 */

import { scanForReferences, type AnnotateListRequest } from '../features/annotate-scan'

self.onmessage = (e: MessageEvent<AnnotateListRequest>) => {
  self.postMessage({ matches: scanForReferences(e.data) })
}
