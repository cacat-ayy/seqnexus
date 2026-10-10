import './GenomeLinksDialog.css'
/**
 * The genome links an imported Geneious file listed.
 *
 * Geneious lists genomes by their NCBI accession and length without the
 * sequence, which can be a whole chromosome. Nothing is downloaded on
 * import: each link here opens the Fetch dialog with its accession filled
 * in, and that dialog asks before downloading a record of many megabases.
 */

import { useRef } from 'react'
import { X } from 'lucide-react'
import type { GeneiousSkipped } from '../io/geneious'
import { useExitAnimation } from '../hooks/useExitAnimation'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { useBackdropDismiss } from '../hooks/useBackdropDismiss'
import { formatBp } from '../utils/format'

interface Props {
  /** The file the links came from, and the links; null when closed. */
  links: { source: string; links: GeneiousSkipped[] } | null
  onClose: () => void
  onFetch: (accession: string) => void
}

export default function GenomeLinksDialog({ links, onClose, onFetch }: Props) {
  const open = links !== null
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)
  const { onMouseDown, onClick } = useBackdropDismiss(onClose)
  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  // Kept while the dialog animates out, so its list does not empty first.
  const shown = useRef(links)
  if (links) shown.current = links
  if (!visible || !shown.current) return null
  const { source, links: list } = shown.current

  return (
    <div
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd} ref={backdropRef}
      onMouseDown={onMouseDown} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Escape') onClose() }} tabIndex={-1}
    >
      <div className="modal-dialog genome-links-modal" role="dialog" aria-modal="true" aria-labelledby="genome-links-title">
        <div className="modal-header">
          <h3 className="modal-title" id="genome-links-title">Genome links in "{source}"</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <p className="gl-intro">
            The file names these genomes but does not hold their sequences. Fetch one from NCBI by its accession.
          </p>
          <ul className="gl-list">
            {list.map((link, i) => (
              <li key={`${link.accession}-${i}`} className="gl-row">
                <span className="gl-name">{link.name}</span>
                <span className="gl-accession">{link.accession}</span>
                <span className="gl-length">{link.length ? formatBp(link.length) : ''}</span>
                <button className="btn btn-sm" onClick={() => onFetch(link.accession!)}>Fetch…</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
