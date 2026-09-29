import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTreeKeyboard, type TreeKeyboardActions } from './useTreeKeyboard'
import type { ExplorerNode } from './buildNodes'
import type { ExplorerItem, ItemKind } from './types'
import { toUid } from './types'

function item(kind: ItemKind, id: string, name: string): ExplorerItem {
  return {
    uid: toUid(kind, id), kind, id, name,
    createdAt: 0, size: 0, isOpen: false, isIncluded: false, isDirty: false,
    isReadOnly: false, isCircular: false, canDuplicate: false,
    stats: [], badges: [], derivedFrom: [],
  }
}

/** Group header, two items, then a nested folder holding one more. */
function sampleNodes(): ExplorerNode[] {
  return [
    { type: 'group', key: 'sequence', label: 'Sequences', count: 3, collapsed: false, depth: 0 },
    { type: 'item', key: 'a', item: item('sequence', 'a', 'alpha'), depth: 1 },
    { type: 'item', key: 'b', item: item('sequence', 'b', 'beta'), depth: 1 },
    {
      type: 'folder', key: 'f1', depth: 1, count: 1,
      folder: { id: 'f1', name: 'Cloning', itemUids: [], parentId: null, collapsed: false },
    },
    { type: 'item', key: 'c', item: item('sequence', 'c', 'gamma'), depth: 2 },
  ]
}

function key(k: string, mods: Partial<KeyboardEvent> = {}) {
  return {
    key: k,
    preventDefault: vi.fn(),
    target: { tagName: 'DIV' },
    ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
    ...mods,
  } as unknown as React.KeyboardEvent
}

describe('useTreeKeyboard', () => {
  let actions: TreeKeyboardActions

  beforeEach(() => {
    actions = {
      open: vi.fn(),
      toggleStar: vi.fn(),
      startRename: vi.fn(),
      remove: vi.fn(),
      setExpanded: vi.fn(),
      select: vi.fn(),
    }
  })

  const setup = (nodes = sampleNodes()) =>
    renderHook(() => useTreeKeyboard(nodes, actions))

  it('starts with nothing focused', () => {
    expect(setup().result.current.focusIndex).toBe(-1)
  })

  it('moves down and wraps at the end', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    expect(result.current.focusIndex).toBe(0)

    for (let i = 0; i < 4; i++) act(() => result.current.onKeyDown(key('ArrowDown')))
    expect(result.current.focusIndex).toBe(4)

    act(() => result.current.onKeyDown(key('ArrowDown')))
    expect(result.current.focusIndex).toBe(0)
  })

  it('moves up and wraps at the start', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowUp')))
    expect(result.current.focusIndex).toBe(4)
  })

  it('skips empty-state rows', () => {
    const nodes: ExplorerNode[] = [
      { type: 'group', key: 'read', label: 'Sequencing', count: 0, collapsed: false, depth: 0 },
      { type: 'empty', key: 'read:empty', message: 'none', depth: 1 },
      { type: 'item', key: 'a', item: item('read', 'a', 'alpha'), depth: 1 },
    ]
    const { result } = renderHook(() => useTreeKeyboard(nodes, actions))
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowDown')))
    expect(result.current.focusIndex).toBe(2)
  })

  it('Home and End jump to the ends', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('End')))
    expect(result.current.focusIndex).toBe(4)
    act(() => result.current.onKeyDown(key('Home')))
    expect(result.current.focusIndex).toBe(0)
  })

  it('Left collapses an expanded header, Right expands a collapsed one', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowLeft')))
    expect(actions.setExpanded).toHaveBeenCalledWith(expect.objectContaining({ key: 'sequence' }), false)
  })

  // The tree pattern: Left on a leaf goes to its parent rather than nowhere.
  it('Left on a leaf moves to the nearest shallower row', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('End')))     // the nested item, depth 2
    act(() => result.current.onKeyDown(key('ArrowLeft')))
    expect(result.current.focusIndex).toBe(3)           // its folder, depth 1
  })

  it('Right on an open header steps into it', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowRight')))
    expect(result.current.focusIndex).toBe(1)
  })

  it('Enter opens the focused item', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('Enter')))
    expect(actions.open).toHaveBeenCalledWith(expect.objectContaining({ name: 'alpha' }))
  })

  it('Space stars, F2 renames, Delete removes', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowDown')))

    act(() => result.current.onKeyDown(key(' ')))
    expect(actions.toggleStar).toHaveBeenCalledWith('sequence:a')

    act(() => result.current.onKeyDown(key('F2')))
    expect(actions.startRename).toHaveBeenCalled()

    act(() => result.current.onKeyDown(key('Delete')))
    expect(actions.remove).toHaveBeenCalledWith(expect.objectContaining({ name: 'alpha' }))
  })

  it('shift-arrow extends the selection instead of replacing it', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    act(() => result.current.onKeyDown(key('ArrowDown', { shiftKey: true })))
    expect(actions.select).toHaveBeenLastCalledWith(1, 'extend')
  })

  it('type-ahead jumps to the next name with that prefix', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('g')))
    expect(result.current.focusIndex).toBe(4) // gamma
  })

  it('type-ahead builds a prefix across keystrokes', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('b')))
    act(() => result.current.onKeyDown(key('e')))
    expect(result.current.focusIndex).toBe(2) // beta
  })

  // Modifier combinations belong to the app's own shortcuts.
  it('ignores ctrl and meta combinations', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('g', { ctrlKey: true })))
    expect(result.current.focusIndex).toBe(-1)
  })

  it('leaves an inline rename field alone', () => {
    const { result } = setup()
    act(() => result.current.onKeyDown(key('ArrowDown')))
    const before = result.current.focusIndex
    act(() => result.current.onKeyDown({
      ...key('ArrowDown'), target: { tagName: 'INPUT' },
    } as unknown as React.KeyboardEvent))
    expect(result.current.focusIndex).toBe(before)
  })

  // Deleting the focused row must not leave the cursor past the end.
  it('clamps focus when the list shrinks', () => {
    const nodes = sampleNodes()
    const { result, rerender } = renderHook(
      ({ n }) => useTreeKeyboard(n, actions),
      { initialProps: { n: nodes } },
    )
    act(() => result.current.onKeyDown(key('End')))
    expect(result.current.focusIndex).toBe(4)

    rerender({ n: nodes.slice(0, 2) })
    expect(result.current.focusIndex).toBe(1)
  })
})
