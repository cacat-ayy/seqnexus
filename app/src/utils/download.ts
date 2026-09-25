/**
 * Trigger a browser file download.
 *
 * Was a local useCallback in App.tsx and hand-rolled again in GelView and two
 * workers, each with its own idea of whether to revoke the object URL. The
 * revoke matters: without it the blob is pinned in memory for the life of the
 * tab, which is noticeable when the blob is a multi-megabyte GenBank export.
 */
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
