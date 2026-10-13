import { ChevronRight } from 'lucide-react'

/**
 * A disclosure chevron: one icon that turns to point down when open, rather
 * than two icons swapped, so the turn can be seen (see .chevron in App.css).
 */
export default function Chevron({ open, size }: { open: boolean; size: number }) {
  return <ChevronRight size={size} className={`chevron${open ? ' open' : ''}`} aria-hidden="true" />
}
