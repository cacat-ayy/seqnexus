/**
 * Read set jobs off the main thread (see ngs/jobs.ts). Each job runs in a
 * worker of its own, reading and writing chunks in IndexedDB directly, so the
 * reads never pass through the page. Cancelling terminates the worker; the
 * caller deletes any chunks a cancelled job had already written.
 */

import { runReadSetJob, type ReadSetJob } from '../ngs/jobs'

export type ReadSetMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: unknown }
  | { type: 'error'; message: string }

const post = (m: ReadSetMessage) => self.postMessage(m)

self.onmessage = async (e: MessageEvent<ReadSetJob>) => {
  try {
    const result = await runReadSetJob(e.data, (done, total) => post({ type: 'progress', done, total }))
    post({ type: 'done', result })
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
