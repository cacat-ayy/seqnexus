/**
 * Group and folder headers.
 *
 * Both are real buttons. The old panel used clickable divs, which is why the
 * Sequencing header had to check `closest('.fe-seq-add')` on every click to
 * avoid swallowing its own add button, and why nothing in the tree was
 * reachable from the keyboard.
 */

import { memo } from 'react'
import { ChevronRight, Folder, Star } from 'lucide-react'
import type { ExplorerFolder } from '../../store'

interface GroupProps {
  index: number
  focused: boolean
  label: string
  count: number
  collapsed: boolean
  isFavorites: boolean
  top: number
  height: number
  onToggle: () => void
}

export const ExplorerGroupHeader = memo(function ExplorerGroupHeader({
  index, focused, label, count, collapsed, isFavorites, top, height, onToggle,
}: GroupProps) {
  return (
    <button
      type="button"
      className="ex-node ex-group"
      style={{ top, height }}
      data-index={index}
      tabIndex={focused ? 0 : -1}
      role="treeitem"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className={`ex-chevron ${collapsed ? '' : 'open'}`}><ChevronRight size={12} /></span>
      {isFavorites && <Star size={11} fill="currentColor" />}
      <span className="ex-group-title">{label}</span>
      <span className="ex-count">{count}</span>
    </button>
  )
})

interface FolderProps {
  index: number
  focused: boolean
  folder: ExplorerFolder
  count: number
  depth: number
  top: number
  height: number
  dragOver: boolean
  renaming: boolean
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onStartRename: () => void
  onRenameSubmit: (name: string) => void
  onRenameCancel: () => void
}

export const ExplorerFolderHeader = memo(function ExplorerFolderHeader({
  index, focused, folder, count, depth, top, height, dragOver, renaming,
  onToggle, onContextMenu, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd,
  onStartRename, onRenameSubmit, onRenameCancel,
}: FolderProps) {
  return (
    <button
      type="button"
      className={`ex-node ex-folder ${dragOver ? 'drag-over' : ''}`}
      style={{
        top,
        height,
        paddingLeft: `calc(var(--space-2) + ${depth} * 12px)`,
        // The accent is optional, so the variable is simply absent when the
        // folder has no colour and the CSS falls back to the muted default.
        ...(folder.color ? { '--folder-color': folder.color } as React.CSSProperties : {}),
      }}
      data-index={index}
      tabIndex={focused ? 0 : -1}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={!folder.collapsed}
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => { if (!renaming) onToggle() }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className={`ex-chevron ${folder.collapsed ? '' : 'open'}`}><ChevronRight size={12} /></span>
      <Folder size={12} className={folder.color ? 'ex-folder-icon-colored' : undefined} />
      {renaming ? (
        <input
          className="ex-rename-input"
          defaultValue={folder.name}
          autoFocus
          onBlur={e => onRenameSubmit(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onRenameSubmit((e.target as HTMLInputElement).value)
            else if (e.key === 'Escape') onRenameCancel()
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span
          className="ex-folder-name"
          title={folder.name}
          onDoubleClick={e => { e.stopPropagation(); onStartRename() }}
        >
          {folder.name}
        </span>
      )}
      <span className="ex-count">{count}</span>
    </button>
  )
})

export const ExplorerEmptyRow = memo(function ExplorerEmptyRow({
  message, depth, top, height,
}: { message: string; depth: number; top: number; height: number }) {
  return (
    <div
      className="ex-node ex-empty-row"
      style={{ top, height, paddingLeft: `calc(var(--space-4) + ${depth} * 12px)` }}
    >
      {message}
    </div>
  )
})
