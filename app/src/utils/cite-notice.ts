/**
 * The toast after a figure or report is saved without a dialog: the file,
 * and the citation to copy. Exports with a dialog show the same request in
 * it (components/CiteHint.tsx).
 */

import { CITATION_TEXT } from '../citation'
import { copyText } from './clipboard'
import { notify } from '../toast'

export const copyCitation = (): void => { void copyText(CITATION_TEXT, 'Citation copied') }

export function notifyFigureSaved(filename: string): void {
  notify.success(`Exported ${filename}`, {
    detail: 'Using this in a publication? Please cite SeqNexus.',
    action: { label: 'Copy citation', onClick: copyCitation },
  })
}
