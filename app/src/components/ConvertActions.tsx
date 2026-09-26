/**
 * "Add these to the document" for an overlay that proposes things.
 *
 * Both the ORF overlay and the auto-annotation overlay draw candidates the
 * user can pick with Ctrl-click and then convert into real features. The
 * buttons sit in the panel bar next to the toggle that produced them, because
 * picking happens on the canvas — sending the user to a modal to commit what
 * they just picked there would break the loop.
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
    <>
      <div className="panel-bar-sep" />
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
      <button
        className={`panel-bar-btn ${picked === 0 ? 'panel-bar-btn-accent' : ''}`}
        onClick={onAddAll}
        title={addAllTitle}
      >
        Add all ({total})
      </button>
    </>
  )
}
