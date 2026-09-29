/**
 * Pick a destination folder for a multi-selection.
 *
 * Dragging works for one item or a handful, but filing thirty reads by drag
 * into a folder that is scrolled off screen does not, which is why this
 * exists alongside the drop targets rather than instead of them.
 */

import { useCallback, useRef } from 'react'
import { X, Folder, FolderMinus } from 'lucide-react'
import { useExitAnimation } from '../../hooks/useExitAnimation'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import type { ExplorerFolder } from '../../store'

interface Props {
  open: boolean
  count: number
  folders: ExplorerFolder[]
  onPick: (folderId: string | null) => void
  onCancel: () => void
}

/** Folder names with their ancestry, so two "Round 1" folders are tellable apart. */
function pathOf(folder: ExplorerFolder, byId: Map<string, ExplorerFolder>): string {
  const parts = [folder.name]
  let current = folder.parentId ? byId.get(folder.parentId) : undefined
  // Bounded walk: a cycle in parentId cannot be created through the UI, but
  // a hand-edited session should not hang the dialog.
  for (let i = 0; current && i < 12; i++) {
    parts.unshift(current.name)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return parts.join(' / ')
}

export default function ExplorerFolderPicker({ open, count, folders, onPick, onCancel }: Props) {
  const backdropRef = useRef<HTMLDivElement>(null)
  useFocusTrap(backdropRef, open)

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onCancel()
  }, [onCancel])

  const { visible, closing, onAnimationEnd } = useExitAnimation(open)
  if (!visible) return null

  const byId = new Map(folders.map(f => [f.id, f]))

  return (
    <div
      ref={backdropRef}
      className={closing ? 'modal-backdrop closing' : 'modal-backdrop'}
      onAnimationEnd={onAnimationEnd}
      onClick={handleBackdrop}
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      tabIndex={-1}
    >
      <div className="modal-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="ex-pick-title">
        <div className="modal-header">
          <h3 className="modal-title" id="ex-pick-title">
            Move {count} item{count === 1 ? '' : 's'}
          </h3>
          <button className="modal-close" onClick={onCancel} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">
          <ul className="ex-pick-list">
            <li>
              <button className="ex-pick-row" onClick={() => onPick(null)}>
                <FolderMinus size={13} /> Top level (no folder)
              </button>
            </li>
            {folders.map(f => (
              <li key={f.id}>
                <button className="ex-pick-row" onClick={() => onPick(f.id)}>
                  <Folder size={13} style={f.color ? { color: f.color } : undefined} />
                  {pathOf(f, byId)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
