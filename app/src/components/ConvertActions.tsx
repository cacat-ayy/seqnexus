/**
 * "Add these to the document" for an overlay that proposes things.
 *
 * Both the ORF overlay and the auto-annotation overlay draw candidates the
 * user can pick with Ctrl-click and then convert into real features. The
 * buttons sit in the panel bar right after the toggle that produced them, as
 * one group, because picking happens on the canvas: sending the user to a
 * modal to commit what they just picked there would break the loop.
 *
 * "Add all" is a quiet button: it is a bulk write offered beside a display
 * toggle, and should not be the loudest thing in the bar. Only "Add picked",
 * which follows a deliberate pick, is filled.
 */

interface Props {
  /** How many candidates a conversion would add right now. */
  total: number
  /** How many of those the user has picked. */
  picked: number
  /** Shown once per bar, and dropped as soon as the user has clearly found it. */
  showHint: boolean
  addAllTitle: string
  onAddPicked: () => void
  onAddAll: () => void
}

export default function ConvertActions({
  total, picked, showHint, addAllTitle, onAddPicked, onAddAll,
}: Props) {
  if (total === 0) return null
  return (
    <span className="panel-bar-actions">
      {showHint && <span className="panel-bar-hint">Ctrl-click to pick</span>}
      {picked > 0 && (
        <button
          className="panel-bar-btn panel-bar-btn-accent"
          onClick={onAddPicked}
          title="Add the picked ones as features"
        >
          Add picked ({picked})
        </button>
      )}
      <button className="panel-bar-btn panel-bar-btn-quiet" onClick={onAddAll} title={addAllTitle}>
        Add all ({total})
      </button>
    </span>
  )
}
