/**
 * Keyboard navigation over the flat node array.
 *
 * Roving tabindex rather than `aria-activedescendant`: the rows are real
 * elements, the arrow-key model is the standard tree pattern, and focus being
 * an index into `nodes` rather than a DOM walk is what makes this tractable
 * at all next to windowing. The window renders whatever slice it likes; this
 * only ever moves an integer and asks the tree to scroll it into view.
 *
 * The wrap-and-skip move helper follows the one in CommandPalette.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExplorerNode } from './buildNodes'
import type { ExplorerItem } from './types'

/** How long a type-ahead buffer survives without another keystroke. */
const TYPE_AHEAD_MS = 500

export interface TreeKeyboardActions {
  open: (item: ExplorerItem) => void
  toggleStar: (uid: string) => void
  startRename: (node: ExplorerNode) => void
  remove: (item: ExplorerItem) => void
  /** Expand or collapse whatever kind of header this is. */
  setExpanded: (node: ExplorerNode, expanded: boolean) => void
  /** Plain move: select just this one. Shift: extend from the anchor. */
  select: (index: number, mode: 'replace' | 'extend' | 'toggle') => void
}

export interface TreeKeyboard {
  focusIndex: number
  setFocusIndex: (i: number) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

/** Is this node one the user can land on? Every node is, including headers. */
function isFocusable(node: ExplorerNode): boolean {
  return node.type !== 'empty'
}

function isExpanded(node: ExplorerNode): boolean | null {
  if (node.type === 'group') return !node.collapsed
  if (node.type === 'folder') return !node.folder.collapsed
  return null
}

export function useTreeKeyboard(
  nodes: ExplorerNode[],
  actions: TreeKeyboardActions,
  onFocusChange?: (index: number) => void,
): TreeKeyboard {
  const [focusIndex, setFocusIndexRaw] = useState(-1)
  const typeAhead = useRef({ buffer: '', at: 0 })

  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // The focused row can vanish under the cursor: a delete, a filter, or a
  // collapsed parent. Clamping rather than resetting keeps the cursor near
  // where the user left it instead of jumping to the top.
  useEffect(() => {
    if (focusIndex >= nodes.length) setFocusIndexRaw(Math.max(-1, nodes.length - 1))
  }, [nodes.length, focusIndex])

  const setFocusIndex = useCallback((i: number) => {
    setFocusIndexRaw(i)
    onFocusChange?.(i)
  }, [onFocusChange])

  const move = useCallback((delta: number) => {
    const list = nodesRef.current
    if (list.length === 0) return
    let next = focusIndex
    for (let step = 0; step < list.length; step++) {
      next = next + delta
      if (next < 0) next = list.length - 1
      if (next >= list.length) next = 0
      if (isFocusable(list[next])) {
        setFocusIndex(next)
        return next
      }
    }
  }, [focusIndex, setFocusIndex])

  const jumpTo = useCallback((predicate: (n: ExplorerNode) => boolean, from: number) => {
    const list = nodesRef.current
    for (let i = 0; i < list.length; i++) {
      const index = (from + i) % list.length
      if (isFocusable(list[index]) && predicate(list[index])) {
        setFocusIndex(index)
        return
      }
    }
  }, [setFocusIndex])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const list = nodesRef.current
    const act = actionsRef.current
    if (list.length === 0) return

    // Never steal keys from an inline rename field.
    if ((e.target as HTMLElement).tagName === 'INPUT') return

    const node = focusIndex >= 0 ? list[focusIndex] : undefined
    const item = node?.type === 'item' ? node.item : undefined

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = move(1)
        if (next !== undefined) act.select(next, e.shiftKey ? 'extend' : 'replace')
        return
      }
      case 'ArrowUp': {
        e.preventDefault()
        const next = move(-1)
        if (next !== undefined) act.select(next, e.shiftKey ? 'extend' : 'replace')
        return
      }
      case 'Home':
        e.preventDefault()
        jumpTo(() => true, 0)
        return
      case 'End':
        e.preventDefault()
        setFocusIndex(list.length - 1)
        return
      case 'ArrowRight': {
        if (!node) return
        e.preventDefault()
        const expanded = isExpanded(node)
        if (expanded === false) act.setExpanded(node, true)
        // Already open, or a leaf: step into it, which is what the tree
        // pattern does and what makes Right feel like "go deeper".
        else move(1)
        return
      }
      case 'ArrowLeft': {
        if (!node) return
        e.preventDefault()
        const expanded = isExpanded(node)
        if (expanded === true) { act.setExpanded(node, false); return }
        // On a leaf or a closed header, go up to the nearest shallower row,
        // which is that row's parent.
        for (let i = focusIndex - 1; i >= 0; i--) {
          if (isFocusable(list[i]) && list[i].depth < node.depth) { setFocusIndex(i); return }
        }
        return
      }
      case 'Enter':
        if (!node) return
        e.preventDefault()
        if (item) act.open(item)
        else act.setExpanded(node, isExpanded(node) === false)
        return
      case ' ':
        if (!item) return
        e.preventDefault()
        act.toggleStar(item.uid)
        return
      case 'F2':
        if (!node) return
        e.preventDefault()
        act.startRename(node)
        return
      case 'Delete':
      case 'Backspace':
        if (!item) return
        e.preventDefault()
        act.remove(item)
        return
      case 'Escape':
        act.select(-1, 'replace')
        return
    }

    // Type-ahead. Single printable characters only, so modifier combinations
    // still reach the app's own shortcuts.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      const buffer = now - typeAhead.current.at > TYPE_AHEAD_MS
        ? e.key.toLowerCase()
        : typeAhead.current.buffer + e.key.toLowerCase()
      typeAhead.current = { buffer, at: now }
      e.preventDefault()
      // A repeat of one character walks matches rather than filtering to a
      // doubled prefix, which is what a file list does everywhere.
      const needle = buffer.length > 1 && buffer.split('').every(c => c === buffer[0])
        ? buffer[0]
        : buffer
      jumpTo(
        n => n.type === 'item' && n.item.name.toLowerCase().startsWith(needle),
        needle.length === 1 ? focusIndex + 1 : focusIndex,
      )
    }
  }, [focusIndex, move, jumpTo, setFocusIndex])

  return { focusIndex, setFocusIndex, onKeyDown }
}
