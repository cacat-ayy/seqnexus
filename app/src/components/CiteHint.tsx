import './CiteHint.css'
/**
 * The request to cite SeqNexus, shown in the dialogs a figure or a report is
 * saved from: the citation and a button to copy it. A one-click export says
 * the same in its toast (utils/cite-notice.ts).
 */

import { Copy } from 'lucide-react'
import { CITATION_TEXT } from '../citation'
import { copyCitation } from '../utils/cite-notice'

export default function CiteHint() {
  return (
    <div className="cite-hint">
      <p>Using this in a publication? Please cite SeqNexus:</p>
      <p className="cite-hint-text">{CITATION_TEXT}</p>
      <button type="button" className="btn btn-sm" onClick={copyCitation}>
        <Copy size={12} /> Copy citation
      </button>
    </div>
  )
}
