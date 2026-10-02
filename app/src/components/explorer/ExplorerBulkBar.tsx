/**
 * Actions for a multi-selection, at the foot of the panel.
 *
 * These existed only inside the right-click menu, which meant the one place
 * the app tells you something is selected was also the place you had to
 * guess to find out what you could do with it. Mirrors FeatureBulkBar.
 */

import { memo } from 'react'
import { AlignLeft, Layers, Download, Trash2, X, FolderInput, Combine } from 'lucide-react'
import type { SelectionCapabilities } from './ExplorerContextMenu'

interface Props {
  count: number
  selection: SelectionCapabilities
  has: { exportItems: boolean; alignToRef: boolean; quickAlign: boolean }
  /** Whether there is anywhere to file a selection. */
  hasFolders: boolean
  onAlignSelected: () => void
  onAlignToRef: () => void
  onJoinAlignments: () => void
  onFile: () => void
  onExport: () => void
  onDelete: () => void
  onClear: () => void
}

function ExplorerBulkBar({
  count, selection, has, hasFolders,
  onAlignSelected, onAlignToRef, onJoinAlignments, onFile, onExport, onDelete, onClear,
}: Props) {
  return (
    <div className="ex-bulk" role="toolbar" aria-label={`${count} items selected`}>
      <span className="ex-bulk-count">{count} selected</span>
      <span className="ex-bulk-spacer" />

      {has.quickAlign && selection.canAlign && (
        <button className="ex-bulk-btn" title="Align selected" onClick={onAlignSelected}>
          <AlignLeft size={13} />
        </button>
      )}
      {has.alignToRef && selection.canAlignToRef && (
        <button className="ex-bulk-btn" title="Assemble…" onClick={onAlignToRef}>
          <Layers size={13} />
        </button>
      )}
      {selection.canJoinAlignments && (
        <button className="ex-bulk-btn" title="Join alignments end to end" onClick={onJoinAlignments}>
          <Combine size={13} />
        </button>
      )}
      {hasFolders && (
        <button className="ex-bulk-btn" title="Move to folder…" onClick={onFile}>
          <FolderInput size={13} />
        </button>
      )}
      {has.exportItems && (
        <button className="ex-bulk-btn" title="Export selected…" onClick={onExport}>
          <Download size={13} />
        </button>
      )}
      <button className="ex-bulk-btn danger" title="Delete selected" onClick={onDelete}>
        <Trash2 size={13} />
      </button>
      <button className="ex-bulk-btn" title="Clear selection" onClick={onClear}>
        <X size={13} />
      </button>
    </div>
  )
}

export default memo(ExplorerBulkBar)
