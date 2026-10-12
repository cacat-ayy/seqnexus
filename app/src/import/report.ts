/**
 * How an import tells the user what happened.
 *
 * One file reports as it always did, a toast per outcome. Several files at
 * once report once: the readers write into a batch, and when the last file
 * is done a single summary says how many items were opened from how many
 * files, with what went wrong listed underneath. A toast per file used to
 * bury the summary of a plate or a folder under its own noise.
 *
 * Identical sequences that were already open are not opened again. The
 * notice says so and offers to open them anyway.
 */

import { notify, type ToastOptions } from '../toast'
import type { DocumentState } from '../models/Document'

export interface Reporter {
  success(message: string, opts?: ToastOptions): void
  info(message: string, opts?: ToastOptions): void
  warning(message: string, opts?: ToastOptions): void
  error(message: string, opts?: ToastOptions): void
  /** Items a file opened, for the batch count. */
  opened(count: number): void
  /** Documents left unopened because the same ones are open; `openAnyway` opens them. */
  duplicates(docs: readonly DocumentState[], openAnyway: () => void): void
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Say that documents were already open, with a way to open them anyway. */
function duplicateNotice(docs: readonly DocumentState[], openAnyway: () => void): void {
  if (docs.length === 0) return
  notify.info(
    docs.length === 1 ? `"${docs[0].name}" is already open` : `${count(docs.length, 'sequence was', 'sequences were')} already open`,
    {
      detail: docs.length === 1 ? 'Showing the open one.' : 'They were not opened again.',
      action: { label: docs.length === 1 ? 'Open a Copy' : 'Open Copies', onClick: openAnyway },
    },
  )
}

/** One file: every outcome is its own toast. */
export const directReporter: Reporter = {
  success: (m, o) => notify.success(m, o),
  info: (m, o) => notify.info(m, o),
  warning: (m, o) => notify.warning(m, o),
  error: (m, o) => notify.error(m, o),
  opened: () => {},
  duplicates: duplicateNotice,
}

interface Issue {
  severity: 'info' | 'warning' | 'error'
  message: string
}

/**
 * Several files: outcomes are collected and said once, by finish(). After
 * finish, anything still to come (a file whose many records waited on a
 * question) reports directly.
 */
export function batchReporter(): Reporter & { finish(files: number): void } {
  let opened = 0
  let finished = false
  const issues: Issue[] = []
  const twins: { docs: readonly DocumentState[]; openAnyway: () => void }[] = []
  const collect = (severity: Issue['severity']) => (message: string, opts?: ToastOptions) => {
    if (finished) { notify[severity](message, opts); return }
    issues.push({ severity, message })
  }
  return {
    // A file's own success line is what the summary replaces.
    success: (m, o) => { if (finished) notify.success(m, o) },
    info: collect('info'),
    warning: collect('warning'),
    error: collect('error'),
    opened: n => { opened += n },
    duplicates: (docs, openAnyway) => {
      if (finished) { duplicateNotice(docs, openAnyway); return }
      if (docs.length > 0) twins.push({ docs, openAnyway })
    },
    finish(files) {
      if (finished) return
      finished = true
      const already = twins.reduce((n, t) => n + t.docs.length, 0)
      if (opened === 0 && issues.length === 0 && already === 0) return
      const lines = issues.map(i => i.message)
      if (already > 0) lines.push(`${count(already, 'sequence was', 'sequences were')} already open and not opened again`)
      const message = opened > 0
        ? `Opened ${count(opened, 'item', 'items')} from ${count(files, 'file', 'files')}`
        : already > 0 && !issues.some(i => i.severity === 'error')
          ? `Nothing new in ${count(files, 'file', 'files')}`
          : `Nothing could be opened from ${count(files, 'file', 'files')}`
      const opts: ToastOptions = {
        ...(lines.length > 0 ? { detail: lines.join('\n') } : {}),
        ...(already > 0 ? { action: { label: 'Open Copies', onClick: () => { for (const t of twins) t.openAnyway() } } } : {}),
      }
      const errors = issues.some(i => i.severity === 'error')
      if (opened === 0 && errors) notify.error(message, opts)
      else if (issues.some(i => i.severity !== 'info')) notify.warning(message, opts)
      else if (opened === 0) notify.info(message, opts)
      else notify.success(message, opts)
    },
  }
}
