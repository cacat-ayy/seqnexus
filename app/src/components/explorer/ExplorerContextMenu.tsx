/**
 * The explorer's right-click menu, for one item, one folder, or a selection.
 *
 * The old version reimplemented outside-click dismissal and viewport clamping
 * inline, duplicating what ContextMenuPopup and usePopoverDismiss already do.
 */

import { useRef } from 'react'
import {
  Pencil, Copy, Trash2, Download, AlignLeft, Layers, Dna, Star, StickyNote, Tag, Combine, FileUp,
} from 'lucide-react'
import ContextMenuPopup from '../ContextMenuPopup'
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss'
import { isDocumentKind, type ExplorerItem } from '../../explorer/types'

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
  /** Two or more alignments of one kind: they can be joined end to end. */
  canJoinAlignments: boolean
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
  onJoinAlignments: () => void
  /** A folder's: pick files to import into it. */
  onImportHere: () => void
  /** A folder's: a new sequence filed into it. */
  onNewSequenceHere: () => void
  /** A folder's: everything in it as one ZIP. */
  onExportFolder?: () => void
  /** How many Sanger reads a folder holds, subfolders included; Assemble shows when there are any. */
  folderReads?: number
  /** A folder's: map its reads to a reference, or assemble them de novo. */
  onAssembleFolder?: () => void
  selection: SelectionCapabilities
  /** Whether the host wired up each optional action. */
  has: { properties: boolean; exportItems: boolean; alignToRef: boolean; quickAlign: boolean; importHere: boolean; newSequenceHere: boolean; exportFolder?: boolean }
}

export default function ExplorerContextMenu({
  target, starred, onClose, onRename, onDuplicate, onProperties, onExport, onDelete,
  onToggleStar, onEditNote, onEditTags, onAlignToRef, onAlignSelected, onJoinAlignments, onImportHere, onNewSequenceHere,
  onExportFolder, folderReads = 0, onAssembleFolder, selection, has,
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
              <button className="ctx-menu-item" onClick={onAlignToRef} title="Map the reads to a reference, or assemble them de novo">
                <Layers size={13} /> Assemble…
              </button>
            )}
            {selection.canJoinAlignments && (
              <button className="ctx-menu-item" onClick={onJoinAlignments} title="Concatenate the alignments, matching rows by name">
                <Combine size={13} /> Join Alignments End to End
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
            {folderReads > 0 && onAssembleFolder && (
              <>
                <button className="ctx-menu-item" onClick={onAssembleFolder}
                  title={`Map the ${folderReads === 1 ? 'read' : `${folderReads} reads`} in this folder to a reference, or assemble them de novo`}>
                  <Layers size={13} /> Assemble {folderReads === 1 ? 'Read' : `${folderReads} Reads`}…
                </button>
                <div className="ctx-menu-sep" />
              </>
            )}
            {has.newSequenceHere && (
              <button className="ctx-menu-item" onClick={onNewSequenceHere}>
                <Dna size={13} /> New Sequence Here…
              </button>
            )}
            {has.importHere && (
              <button className="ctx-menu-item" onClick={onImportHere}>
                <FileUp size={13} /> Import Files Here…
              </button>
            )}
            {has.exportFolder && (
              <button className="ctx-menu-item" onClick={onExportFolder} title="Everything in it and its subfolders, as GenBank, FASTQ and FASTA files">
                <Download size={13} /> Export Folder as ZIP…
              </button>
            )}
            {(has.newSequenceHere || has.importHere || has.exportFolder) && <div className="ctx-menu-sep" />}
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
            {has.properties && isDocumentKind(target.item.kind) && (
              <button className="ctx-menu-item" onClick={onProperties}>
                <Dna size={13} /> Properties
              </button>
            )}
            {has.alignToRef && target.item.kind === 'read' && (
              <button className="ctx-menu-item" onClick={onAlignToRef} title="Map the read to a reference">
                <Layers size={13} /> Map to Reference…
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
