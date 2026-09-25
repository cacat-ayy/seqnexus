/**
 * Inline empty state for an active-but-empty analysis overlay.
 *
 * The ORF, enzyme and primer overlays each rendered their own copy of this
 * markup, which is how they drifted into phrasing three different shapes of
 * the same sentence. One component means one shape: what was not found, and
 * the single action most likely to fix it.
 */

import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  /** What came back empty, e.g. "No ORFs found". No trailing punctuation. */
  message: string
  /** Label for the corrective action, e.g. "adjust parameters". */
  actionLabel: string
  onAction: () => void
}

export default function EmptyState({ icon: Icon, message, actionLabel, onAction }: Props) {
  return (
    <div className="panel-hint">
      <Icon size={12} />
      {message} – <button className="panel-hint-link" onClick={onAction}>{actionLabel}</button>
    </div>
  )
}
