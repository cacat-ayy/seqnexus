/**
 * Web Worker: primer design.
 *
 * Long-lived: it answers one request after another and only dies when the
 * client terminates it to abandon a run that has been superseded.
 */

import { designPrimers } from '../primers/design/design'
import type { DesignRequest, DesignResult } from '../primers/design/types'

export interface PrimerDesignMessage {
  id: number
  request: DesignRequest
}

export interface PrimerDesignResponse {
  id: number
  result: DesignResult
}

self.onmessage = (e: MessageEvent<PrimerDesignMessage>) => {
  const response: PrimerDesignResponse = { id: e.data.id, result: designPrimers(e.data.request) }
  self.postMessage(response)
}
