/**
 * The explorer's right-click menu, for one item, one folder, or a selection.
 *
 * The old version reimplemented outside-click dismissal and viewport clamping
 * inline, duplicating what ContextMenuPopup and usePopoverDismiss already do.
 */

import { useRef } from 'react'
import {
  Pencil, Copy, Trash2, Download, AlignLeft, Layers, Dna, Star, StickyNote, Tag,
} from 'lucide-react'
import ContextMenuPopup from '../ContextMenuPopup'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import type { ExplorerItem } from '../../explorer/types'

export type ExplorerMenuTarget =
  | { type: 'item'; item: ExplorerItem; x: number; y: number }
  | { type: 'folder'; folderId: string; name: string; x: number; y: number }
  | { type: 'selection'; count: number; x: number; y: number }

export interface SelectionCapabilities {
  /** Two or more sequences and reads together: they can be aligned. */
  canAlign: boolean
  /** At least one read: it can be aligned to a reference. */
  canAlignToRef: boolean
  /** Two or more read alignments sharing one reference: they can form a contig. */
  canMakeContig: boolean
  canExport: boolean
}

interface Props {
  target: ExplorerMenuTarget
  starred: boolean
  onClose: () => void
  onRename: () => void
  onDuplicate: () => void
  onProperties: () => void
  onExport: () => void
  onDelete: () => void
  onToggleStar: () => void
  onEditNote: () => void
  onEditTags: () => void
  onAlignToRef: () => void
  onAlignSelected: () => void
  onCreateContig: () => void
  selection: SelectionCapabilities
  /** Whether the host wired up each optional action. */
  has: { properties: boolean; exportItems: boolean; alignToRef: boolean; quickAlign: boolean }
}

export default function ExplorerContextMenu({
  target, starred, onClose, onRename, onDuplicate, onProperties, onExport, onDelete,
  onToggleStar, onEditNote, onEditTags, onAlignToRef, onAlignSelected, onCreateContig, selection, has,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  usePopoverDismiss(true, onClose, ref)

  return (
    <div ref={ref}>
      <ContextMenuPopup x={target.x} y={target.y} onClose={onClose} label="Item actions">
        {target.type === 'selection' ? (
          <>
            <div className="ctx-menu-header">{target.count} selected</div>
            {has.quickAlign && selection.canAlign && (
              <button className="ctx-menu-item" onClick={onAlignSelected}>
                <AlignLeft size={13} /> Align Selected
              </button>
            )}
            {has.alignToRef && selection.canAlignToRef && (
              <button className="ctx-menu-item" onClick={onAlignToRef}>
                <AlignLeft size={13} /> Align to Reference…
              </button>
            )}
            {selection.canMakeContig && (
              <button className="ctx-menu-item" onClick={onCreateContig}>
                <Layers size={13} /> Create Contig
              </button>
            )}
            {has.exportItems && selection.canExport && (
              <button className="ctx-menu-item" onClick={onExport}>
                <Download size={13} /> Export Selected…
              </button>
            )}
            <button className="ctx-menu-item ctx-menu-danger" onClick={onDelete}>
              <Trash2 size={13} /> Delete Selected
            </button>
          </>
        ) : target.type === 'folder' ? (
          <>
            <button className="ctx-menu-item" onClick={onRename}>
              <Pencil size={13} /> Rename
            </button>
            <div className="ctx-menu-sep" />
            <button className="ctx-menu-item ctx-menu-danger" onClick={onDelete}>
              <Trash2 size={13} /> Delete
            </button>
          </>
        ) : (
          <>
            <button className="ctx-menu-item" onClick={onToggleStar}>
              <Star size={13} /> {starred ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
            <button className="ctx-menu-item" onClick={onEditTags}>
              <Tag size={13} /> Tags…
            </button>
            <button className="ctx-menu-item" onClick={onEditNote}>
              <StickyNote size={13} /> Note…
            </button>
            <div className="ctx-menu-sep" />
            <button className="ctx-menu-item" onClick={onRename}>
              <Pencil size={13} /> Rename
            </button>
            {target.item.canDuplicate && (
              <button className="ctx-menu-item" onClick={onDuplicate}>
                <Copy size={13} /> Duplicate
              </button>
            )}
            {has.properties && target.item.kind === 'sequence' && (
              <button className="ctx-menu-item" onClick={onProperties}>
                <Dna size={13} /> Properties
              </button>
            )}
            {has.alignToRef && target.item.kind === 'read' && (
              <button className="ctx-menu-item" onClick={onAlignToRef}>
                <AlignLeft size={13} /> Align to Reference…
              </button>
            )}
            {has.exportItems && (
              <button className="ctx-menu-item" onClick={onExport}>
                <Download size={13} /> Export…
              </button>
            )}
            <div className="ctx-menu-sep" />
            <button className="ctx-menu-item ctx-menu-danger" onClick={onDelete}>
              <Trash2 size={13} /> Delete
            </button>
          </>
        )}
      </ContextMenuPopup>
    </div>
  )
}
