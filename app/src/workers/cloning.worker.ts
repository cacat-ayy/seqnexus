/// <reference lib="webworker" />
import { runBulkRequest, type BulkMessage, type BulkRequest } from '../cloning/bulk-run'

self.onmessage = (e: MessageEvent<BulkRequest>) => {
  let last = 0
  try {
    const result = runBulkRequest(e.data, (done, total) => {
      // A library can be hundreds of constructs; reporting every one would
      // post more messages than the UI can use.
      const now = Date.now()
      if (now - last < 80 && done < total) return
      last = now
      self.postMessage({ type: 'progress', done, total } satisfies BulkMessage)
    })
    self.postMessage({ type: 'done', result } satisfies BulkMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies BulkMessage)
  }
}
