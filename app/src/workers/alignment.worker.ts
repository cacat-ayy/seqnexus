/**
 * Web Worker: sequence alignment.
 * Delegates to the shared executeAlignment function.
 */

import type { AlignmentRequest } from '../alignment/types'
import { executeAlignment } from '../alignment/run'

self.onmessage = (e: MessageEvent<AlignmentRequest>) => {
  try {
    const result = executeAlignment(e.data)
    self.postMessage(result)
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
}
