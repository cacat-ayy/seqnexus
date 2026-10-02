/**
 * Web Worker: 6-frame ORF finder. A thin wrapper around orfs/finder.ts.
 *
 * Input message:  ORFRequest
 * Output message: { orfs: ORFResult[] }
 */

import { findOrfs, type ORFRequest } from '../orfs/finder'

self.onmessage = (e: MessageEvent<ORFRequest>) => {
  self.postMessage({ orfs: findOrfs(e.data) })
}
