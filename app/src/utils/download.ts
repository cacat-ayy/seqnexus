/**
 * Trigger a browser file download.
 *
 * Was a local useCallback in App.tsx and hand-rolled again in GelView and two
 * workers, each with its own idea of whether to revoke the object URL. The
 * revoke matters: without it the blob is pinned in memory for the life of the
 * tab, which is noticeable when the blob is a multi-megabyte GenBank export.
 */

import { notify } from '../toast'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Deferred: revoking immediately races the click in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Convenience for the common text-export case. */
export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename)
}

export interface DownloadFile {
  blob: Blob
  name: string
}

/** Time between the downloads of one action. */
const DOWNLOAD_GAP_MS = 250

/**
 * Several files from one action (separate files, R1 and R2, a BAM and its
 * index). Started in the same moment, browsers keep only some of them, so
 * they go one after another. Chrome also asks once whether the page may save
 * several files, and refusing keeps only the first, so the user is told to
 * expect the question.
 */
export async function downloadMany(files: readonly DownloadFile[]): Promise<void> {
  if (files.length > 1) {
    notify.info(`Saving ${files.length} files`, {
      detail: 'Your browser may ask whether this page can download several files. Allow it, or only the first one is saved.',
      key: 'download-many',
    })
  }
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise(resolve => setTimeout(resolve, DOWNLOAD_GAP_MS))
    downloadBlob(files[i].blob, files[i].name)
  }
}

/**
 * Save a text file and say so. Exports used to differ: some confirmed with a
 * toast and some saved without a word, which leaves the user checking the
 * downloads folder to see whether anything happened.
 */
export function saveText(text: string, filename: string, mime = 'text/plain'): void {
  downloadText(text, filename, mime)
  notify.success(`Exported ${filename}`, { key: 'export-saved' })
}
