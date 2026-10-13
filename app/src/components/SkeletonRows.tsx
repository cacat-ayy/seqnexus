/**
 * Placeholder rows while a list is still being worked out (a feature scan, a
 * guide scan, a BLAST search): the shape of what is coming, shimmering,
 * rather than an empty pane under a status line.
 */

/** Row lengths, varied so the placeholder reads as a list rather than a block. */
const WIDTHS = [92, 78, 86, 64, 82, 70]

export default function SkeletonRows({ count = 5, label }: { count?: number; label: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="skeleton-row" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
      ))}
    </div>
  )
}
