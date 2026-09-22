/**
 * Web Worker: primer pair finder.
 *
 * Runs the primer pair search off the main thread to avoid blocking
 * the UI on large search spaces.
 */

import { findPrimerPairs, type PrimerPairRequest, type PrimerPair } from '../primers/finder'

export interface PrimerFinderResponse {
  pairs: PrimerPair[]
}

self.onmessage = (e: MessageEvent<PrimerPairRequest>) => {
  const pairs = findPrimerPairs(e.data)
  const response: PrimerFinderResponse = { pairs }
  self.postMessage(response)
}
