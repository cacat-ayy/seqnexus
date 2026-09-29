/**
 * One item row, whatever kind it holds.
 *
 * The row grid has three fixed slots (icon, name, actions) so a sequence, a
 * chromatogram and a contig line up with each other. What differs between
 * kinds is the glyph and the words in the metadata line, both of which the
 * adapters already resolved.
 */

import { memo, useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Star, Layers } from 'lucide-react'
import type { Density, ExplorerItem } from '../../explorer/types'
import { KIND_ICON, KIND_LABEL } from '../../explorer/kinds'

export interface ExplorerRowProps {
  index: number
  focused: boolean
  item: ExplorerItem
  depth: number
  density: Density
  /** Absolute offset inside the windowed viewport. */
  top: number
  height: number
  selected: boolean
  dragging: boolean
  starred: boolean
  note?: string
  tags: string[]
  tagColors: Record<string, string>
  renaming: boolean
  onClick: (e: React.MouseEvent, item: ExplorerItem) => void
  onContextMenu: (e: React.MouseEvent, item: ExplorerItem) => void
  onToggleStar: (uid: string) => void
  onOpenMenu: (e: React.MouseEvent, item: ExplorerItem) => void
  onRenameSubmit: (item: ExplorerItem, name: string) => void
  onRenameCancel: () => void
  onStartRename: (item: ExplorerItem) => void
  onDragStart: (e: React.DragEvent, item: ExplorerItem) => void
  onDragEnd: () => void
  onHover: (item: ExplorerItem, e: React.MouseEvent) => void
  onHoverEnd: () => void
}

/**
 * Name, facts, tags and note in one string, for the native tooltip.
 *
 * The tags matter here: at compact and comfortable density they are drawn as
 * coloured dots, and a dot that means nothing without the tooltip would be
 * decoration rather than information.
 */
function tooltip(item: ExplorerItem, note: string | undefined, tags: string[]): string {
  const lines = [item.name, `${KIND_LABEL[item.kind]} · ${item.stats.join(' · ')}`]
  if (tags.length > 0) lines.push(tags.join(', '))
  if (note) lines.push(note)
  return lines.join('\n')
}

function ExplorerRow({
  index, focused, item, depth, density, top, height, selected, dragging, starred, note, tags, tagColors, renaming,
  onClick, onContextMenu, onToggleStar, onOpenMenu,
  onRenameSubmit, onRenameCancel, onStartRename, onDragStart, onDragEnd, onHover, onHoverEnd,
}: ExplorerRowProps) {
  const Icon = KIND_ICON[item.kind]
  const stats = item.stats.join(' · ')
  const [draft, setDraft] = useState(item.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      setDraft(item.name)
      // Select the name but not any extension-like suffix it may carry: the
      // whole thing is the name here, so a plain select-all is right.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }, [renaming, item.name])

  const classes = [
    'ex-row', density,
    item.isOpen ? 'open' : '',
    selected ? 'selected' : '',
    dragging ? 'dragging' : '',
  ].filter(Boolean).join(' ')

  return (
    <div
      className={`ex-node ${classes}`}
      style={{
        top,
        height,
        // Indent is driven by depth rather than a per-level class, so nested
        // folders need no new CSS.
        paddingLeft: `calc(var(--space-2) + ${depth} * 12px)`,
      }}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      data-uid={item.uid}
      data-index={index}
      tabIndex={focused ? 0 : -1}
      title={renaming ? undefined : tooltip(item, note, tags)}
      onClick={e => { if (!renaming) onClick(e, item) }}
      onContextMenu={e => onContextMenu(e, item)}
      onMouseMove={e => onHover(item, e)}
      onMouseLeave={onHoverEnd}
      draggable={!renaming}
      onDragStart={e => onDragStart(e, item)}
      onDragEnd={onDragEnd}
    >
      <span className="ex-icon">
        <Icon size={13} />
        {item.isCircular && <span className="ex-topo-pip" title="Circular" />}
      </span>

      {renaming ? (
        <input
          ref={inputRef}
          className="ex-rename-input"
          value={draft}
          autoFocus
          onChange={e => setDraft(e.target.value)}
          onBlur={() => onRenameSubmit(item, draft)}
          onKeyDown={e => {
            if (e.key === 'Enter') onRenameSubmit(item, draft)
            else if (e.key === 'Escape') onRenameCancel()
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span
          className="ex-name"
          onDoubleClick={e => { e.stopPropagation(); onStartRename(item) }}
        >
          {density === 'comfortable' ? (
            <>
              <span className="ex-name-text">{item.name}</span>
              <span className="ex-stats-inline">{stats}</span>
            </>
          ) : item.name}
        </span>
      )}

      {density === 'relaxed' && !renaming && <span className="ex-stats">{stats}</span>}

      <span className="ex-actions">
        {tags.length > 0 && (
          <span className="ex-tags">
            {density === 'relaxed'
              ? tags.slice(0, 2).map(tag => (
                  <span
                    key={tag}
                    className="ex-tag-chip"
                    style={{ '--tag-color': tagColors[tag] } as React.CSSProperties}
                  >
                    {tag}
                  </span>
                ))
              : tags.slice(0, 3).map(tag => (
                  <span
                    key={tag}
                    className="ex-tag-dot"
                    style={{ '--tag-color': tagColors[tag] } as React.CSSProperties}
                  />
                ))}
          </span>
        )}
        {item.isIncluded && (
          <span className="ex-included" title="Shown in the multi-trace view">
            <Layers size={11} />
          </span>
        )}
        {item.isDirty && <span className="ex-dirty" title="Edited" />}
        {item.badges.map(b => (
          <span key={b.key} className={`ex-badge ${b.tone}`} title={b.label}>
            <b.icon size={11} />
          </span>
        ))}
        <button
          className={`ex-abtn ${starred ? 'starred' : 'on-hover'}`}
          title={starred ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={starred}
          onClick={e => { e.stopPropagation(); onToggleStar(item.uid) }}
        >
          <Star size={12} fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button
          className="ex-abtn on-hover"
          title="More actions"
          onClick={e => { e.stopPropagation(); onOpenMenu(e, item) }}
        >
          <MoreHorizontal size={13} />
        </button>
      </span>
    </div>
  )
}

export default memo(ExplorerRow)
