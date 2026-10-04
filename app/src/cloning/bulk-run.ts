/**
 * The message shapes a bulk run uses, shared by the worker and its caller.
 *
 * Kept apart from ./bulk so the worker entry point can import the request
 * type without dragging the UI's own modules in with it.
 */

import type { CloningDesign } from './design'
import type { BulkOptions, BulkResult, DesignBin } from './bulk'
import { runBulk } from './bulk'

export interface BulkRequest {
  design: CloningDesign
  bins: DesignBin[]
  nameTemplate?: string
  limit?: number
}

export type BulkMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: BulkResult }
  | { type: 'error'; message: string }

/** Run a request. Used directly on the main thread when no worker starts. */
export function runBulkRequest(
  req: BulkRequest,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): BulkResult {
  const options: BulkOptions = {
    ...(req.nameTemplate !== undefined ? { nameTemplate: req.nameTemplate } : {}),
    ...(req.limit !== undefined ? { limit: req.limit } : {}),
    ...(onProgress ? { onProgress } : {}),
    ...(shouldStop ? { shouldStop } : {}),
  }
  return runBulk(req.design, req.bins, options)
}
