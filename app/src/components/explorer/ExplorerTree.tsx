/**
 * The scrolling tree: one container, one scrollbar, windowed rows.
 *
 * Rows are positioned absolutely inside a spacer the height of the whole
 * list, and only the visible slice is mounted. Sessions here run to hundreds
 * of items once a plate of reads and their alignments are open, and the old
 * panel mounted every row in both of its two scroll regions.
 *
 * Windowing is only this simple because every node declares a fixed height
 * for the current density, which is why the density steps are three discrete
 * settings rather than a free-form zoom.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ExplorerNode } from '../../explorer/buildNodes'
import type { Density, ExplorerItem } from '../../explorer/types'
import {
  ROW_HEIGHT, GROUP_ROW_HEIGHT, FOLDER_ROW_HEIGHT, EMPTY_ROW_HEIGHT,
} from '../../explorer/types'
import ExplorerRow from './ExplorerRow'
import { ExplorerGroupHeader, ExplorerFolderHeader, ExplorerEmptyRow } from './ExplorerGroupRow'
import { FAVORITES_KEY } from '../../explorer/buildNodes'

/** How many rows to mount beyond the viewport, so a fast scroll is not blank. */
const OVERSCAN = 6

/** Shared empty array, so an untagged row's props keep their identity and
 *  the memoised row does not re-render on every scroll. */
const EMPTY_TAGS: string[] = []

function nodeHeight(node: ExplorerNode, density: Density): number {
  switch (node.type) {
    case 'group': return GROUP_ROW_HEIGHT
    case 'folder': return FOLDER_ROW_HEIGHT
    case 'empty': return EMPTY_ROW_HEIGHT
    case 'item': return ROW_HEIGHT[density]
  }
}

/** Index of the last offset that is still at or before `y`. */
function findStart(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface TreeHandlers {
  onItemClick: (e: React.MouseEvent, item: ExplorerItem) => void
  onItemContextMenu: (e: React.MouseEvent, item: ExplorerItem) => void
  onToggleStar: (uid: string) => void
  onOpenMenu: (e: React.MouseEvent, item: ExplorerItem) => void
  onRenameSubmit: (item: ExplorerItem, name: string) => void
  onStartRename: (item: ExplorerItem) => void
  onRenameCancel: () => void
  onToggleGroup: (key: string) => void
  onToggleFolder: (id: string) => void
  onFolderContextMenu: (e: React.MouseEvent, folderId: string, name: string) => void
  onFolderRenameSubmit: (folderId: string, name: string) => void
  onStartFolderRename: (folderId: string) => void
  onDropOnFolder: (folderId: string | null) => void
  /** Reports which row started the drag; the panel widens it to the selection. */
  onDragStart: (uid: string) => void
  onHover: (item: ExplorerItem, e: React.MouseEvent) => void
  onHoverEnd: () => void
  /** A folder header started a drag, so the drop re-parents rather than files. */
  onFolderDragStart: (folderId: string) => void
  onDragEnd: () => void
}

interface Props {
  nodes: ExplorerNode[]
  density: Density
  selected: ReadonlySet<string>
  starred: ReadonlySet<string>
  notes: Record<string, string | undefined>
  tagsByUid: Readonly<Record<string, string[] | undefined>>
  tagColors: Record<string, string>
  /** uid or folder id currently being renamed inline. */
  renamingKey: string | null
  /** Uids of the items being dragged, for the drag-out styling. */
  draggingUids: ReadonlySet<string>
  handlers: TreeHandlers
  /** Uid to bring into view, e.g. when a tab is opened from elsewhere. */
  scrollToUid?: string | null
  /** Roving-tabindex cursor, -1 when nothing is focused. */
  focusIndex: number
  onKeyDown: (e: React.KeyboardEvent) => void
  onFocusIndex: (index: number) => void
}

const DRAG_MIME = 'application/x-seqnexus-tab'

export default function ExplorerTree({
  nodes, density, selected, starred, notes, tagsByUid, tagColors, renamingKey, draggingUids,
  handlers, scrollToUid, focusIndex, onKeyDown, onFocusIndex,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const draggingRef = useRef(false)
  const autoScrollDir = useRef(0)

  const { offsets, total } = useMemo(() => {
    const out: number[] = new Array(nodes.length)
    let y = 0
    for (let i = 0; i < nodes.length; i++) {
      out[i] = y
      y += nodeHeight(nodes[i], density)
    }
    return { offsets: out, total: y }
  }, [nodes, density])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setViewport(el.clientHeight)
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** Scroll a node index into view, accounting for the pinned heading. */
  const revealIndex = useCallback((index: number) => {
    const el = ref.current
    if (!el || index < 0 || index >= nodes.length) return
    const top = offsets[index]
    const bottom = top + nodeHeight(nodes[index], density)
    // The pinned heading floats over the first GROUP_ROW_HEIGHT px, so a row
    // scrolled flush to the top would sit underneath it.
    if (top - GROUP_ROW_HEIGHT < el.scrollTop) el.scrollTop = Math.max(0, top - GROUP_ROW_HEIGHT)
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [nodes, offsets, density])

  // Bring a row into view when it is opened from outside the explorer, such
  // as from the command palette. Nothing did this before, so opening a tab
  // that way left the tree wherever it happened to be scrolled.
  useEffect(() => {
    if (!scrollToUid) return
    const index = nodes.findIndex(n => n.type === 'item' && n.item.uid === scrollToUid)
    if (index !== -1) revealIndex(index)
  }, [scrollToUid, nodes, revealIndex])

  // Keyboard focus has to survive windowing: moving the cursor can scroll a
  // row that was not mounted into view, so DOM focus is (re)applied after the
  // new window has rendered rather than at the moment the index changed.
  useEffect(() => {
    if (focusIndex < 0) return
    revealIndex(focusIndex)
  }, [focusIndex, revealIndex])

  useEffect(() => {
    if (focusIndex < 0) return
    const el = ref.current?.querySelector<HTMLElement>(`[data-index="${focusIndex}"]`)
    // Only steal focus if it is already inside the tree, so arrowing here
    // never yanks the caret out of the sequence view or the search box.
    if (el && ref.current?.contains(document.activeElement)) el.focus({ preventScroll: true })
  })

  const start = nodes.length === 0 ? 0 : Math.max(0, findStart(offsets, scrollTop) - OVERSCAN)
  const end = nodes.length === 0 ? 0 : Math.min(nodes.length, findStart(offsets, scrollTop + viewport) + 1 + OVERSCAN)

  /**
   * The group heading for whatever is at the top of the viewport.
   *
   * Rows are absolutely positioned, so `position: sticky` cannot do this on
   * its own. Instead the heading is drawn a second time as a pinned copy.
   * Scrolled past 40 reads, the column otherwise gives no clue which group
   * you are in.
   */
  const pinned = useMemo(() => {
    if (nodes.length === 0) return null
    const first = findStart(offsets, scrollTop)
    for (let i = first; i >= 0; i--) {
      const node = nodes[i]
      if (node.type === 'group') return node.collapsed ? null : node
    }
    return null
  }, [nodes, offsets, scrollTop])

  // Autoscroll while dragging near an edge. One container means this now
  // covers the whole tree rather than only its top half.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const tick = () => {
      if (autoScrollDir.current !== 0) el.scrollTop += autoScrollDir.current * 8
      raf = requestAnimationFrame(tick)
    }
    const onDragOver = (e: DragEvent) => {
      if (!draggingRef.current) return
      const rect = el.getBoundingClientRect()
      const y = e.clientY - rect.top
      autoScrollDir.current = y < 40 ? -1 : y > rect.height - 40 ? 1 : 0
    }
    el.addEventListener('dragover', onDragOver)
    raf = requestAnimationFrame(tick)
    return () => {
      el.removeEventListener('dragover', onDragOver)
      cancelAnimationFrame(raf)
    }
  }, [])

  const isInternal = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_MIME)

  const handleDragStart = useCallback((e: React.DragEvent, item: ExplorerItem) => {
    e.dataTransfer.setData(DRAG_MIME, item.uid)
    e.dataTransfer.effectAllowed = 'move'
    draggingRef.current = true
    handlers.onDragStart(item.uid)
  }, [handlers])

  const handleDragEnd = useCallback(() => {
    draggingRef.current = false
    autoScrollDir.current = 0
    setDragOverFolder(null)
    handlers.onDragEnd()
  }, [handlers])

  return (
    <div
      className="ex-tree"
      ref={ref}
      role="tree"
      aria-label="Explorer items"
      aria-multiselectable="true"
      // The container is the tab stop when nothing inside has focus yet, so
      // Tab reaches the tree and the arrow keys take over from there.
      tabIndex={focusIndex < 0 ? 0 : -1}
      onKeyDown={onKeyDown}
      onFocus={e => { if (e.target === e.currentTarget && focusIndex < 0) onFocusIndex(0) }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      onDragOver={e => {
        if (!isInternal(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={e => {
        if (!isInternal(e)) return
        e.preventDefault()
        handlers.onDropOnFolder(null)
        handleDragEnd()
      }}
    >
      {pinned && (
        <div className="ex-pinned" style={{ height: GROUP_ROW_HEIGHT }}>
          <ExplorerGroupHeader
            // The pinned copy is decoration over the real row, so it stays
            // out of the roving tabindex: two tab stops for one heading.
            index={-1}
            focused={false}
            label={pinned.label}
            count={pinned.count}
            collapsed={pinned.collapsed}
            isFavorites={pinned.key === FAVORITES_KEY}
            top={0}
            height={GROUP_ROW_HEIGHT}
            onToggle={() => handlers.onToggleGroup(pinned.key)}
          />
        </div>
      )}
      <div
        className="ex-viewport"
        style={{ height: total, marginTop: pinned ? -GROUP_ROW_HEIGHT : 0 }}
      >
        {nodes.slice(start, end).map((node, i) => {
          const index = start + i
          const top = offsets[index]
          const height = nodeHeight(node, density)

          if (node.type === 'group') {
            return (
              <ExplorerGroupHeader
                key={node.key}
                index={index}
                focused={focusIndex === index}
                label={node.label}
                count={node.count}
                collapsed={node.collapsed}
                isFavorites={node.key === FAVORITES_KEY}
                top={top}
                height={height}
                onToggle={() => handlers.onToggleGroup(node.key)}
              />
            )
          }

          if (node.type === 'folder') {
            return (
              <ExplorerFolderHeader
                key={node.key}
                index={index}
                focused={focusIndex === index}
                folder={node.folder}
                count={node.count}
                depth={node.depth}
                top={top}
                height={height}
                dragOver={dragOverFolder === node.folder.id}
                renaming={renamingKey === node.folder.id}
                onToggle={() => handlers.onToggleFolder(node.folder.id)}
                onContextMenu={e => handlers.onFolderContextMenu(e, node.folder.id, node.folder.name)}
                onDragOver={e => {
                  if (!isInternal(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverFolder(node.folder.id)
                }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={e => {
                  if (!isInternal(e)) return
                  e.preventDefault()
                  e.stopPropagation()
                  handlers.onDropOnFolder(node.folder.id)
                  handleDragEnd()
                }}
                onDragStart={e => {
                  e.dataTransfer.setData(DRAG_MIME, node.folder.id)
                  e.dataTransfer.effectAllowed = 'move'
                  draggingRef.current = true
                  handlers.onFolderDragStart(node.folder.id)
                }}
                onDragEnd={handleDragEnd}
                onStartRename={() => handlers.onStartFolderRename(node.folder.id)}
                onRenameSubmit={name => handlers.onFolderRenameSubmit(node.folder.id, name)}
                onRenameCancel={handlers.onRenameCancel}
              />
            )
          }

          if (node.type === 'empty') {
            return (
              <ExplorerEmptyRow
                key={node.key} message={node.message} depth={node.depth}
                top={top} height={height}
              />
            )
          }

          const item = node.item
          return (
            <ExplorerRow
              key={node.key}
              index={index}
              focused={focusIndex === index}
              item={item}
              depth={node.depth}
              density={density}
              top={top}
              height={height}
              selected={selected.has(item.uid)}
              dragging={draggingUids.has(item.uid)}
              starred={starred.has(item.uid)}
              note={notes[item.uid]}
              tags={tagsByUid[item.uid] ?? EMPTY_TAGS}
              tagColors={tagColors}
              renaming={renamingKey === item.uid}
              onClick={handlers.onItemClick}
              onContextMenu={handlers.onItemContextMenu}
              onToggleStar={handlers.onToggleStar}
              onOpenMenu={handlers.onOpenMenu}
              onRenameSubmit={handlers.onRenameSubmit}
              onRenameCancel={handlers.onRenameCancel}
              onStartRename={handlers.onStartRename}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onHover={handlers.onHover}
              onHoverEnd={handlers.onHoverEnd}
            />
          )
        })}
      </div>
    </div>
  )
}
