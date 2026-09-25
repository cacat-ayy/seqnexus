import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useListMultiSelect } from './useListMultiSelect'

const IDS = ['a', 'b', 'c', 'd', 'e']

const plain = { ctrlKey: false, metaKey: false, shiftKey: false }
const ctrl = { ctrlKey: true, metaKey: false, shiftKey: false }
const shift = { ctrlKey: false, metaKey: false, shiftKey: true }

const sorted = (s: Set<string>) => [...s].sort()

describe('useListMultiSelect', () => {
  it('starts with nothing selected', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('plain click activates and does not select', () => {
    const activate = vi.fn()
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(plain, 'b', activate))
    expect(activate).toHaveBeenCalledOnce()
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('ctrl-click toggles an item on and off', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(ctrl, 'b'))
    expect(sorted(result.current.selectedIds)).toEqual(['b'])
    act(() => result.current.handleItemClick(ctrl, 'b'))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('cmd-click works the same as ctrl-click', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick({ ctrlKey: false, metaKey: true, shiftKey: false }, 'c'))
    expect(sorted(result.current.selectedIds)).toEqual(['c'])
  })

  it('ctrl-click does not activate the item', () => {
    const activate = vi.fn()
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(ctrl, 'b', activate))
    expect(activate).not.toHaveBeenCalled()
  })

  it('shift-click selects the range from the anchor, forwards', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(plain, 'b'))
    act(() => result.current.handleItemClick(shift, 'd'))
    expect(sorted(result.current.selectedIds)).toEqual(['b', 'c', 'd'])
  })

  it('shift-click selects the range backwards too', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(plain, 'd'))
    act(() => result.current.handleItemClick(shift, 'b'))
    expect(sorted(result.current.selectedIds)).toEqual(['b', 'c', 'd'])
  })

  it('keeps the anchor so a second shift-click re-ranges from the same point', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(plain, 'a'))
    act(() => result.current.handleItemClick(shift, 'e'))
    act(() => result.current.handleItemClick(shift, 'b'))
    // Still anchored at 'a', so a..b is added on top of the existing range.
    expect(sorted(result.current.selectedIds)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('shift-click with no anchor behaves as a plain click', () => {
    const activate = vi.fn()
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(shift, 'c', activate))
    expect(activate).toHaveBeenCalledOnce()
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('plain click collapses an existing selection', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.handleItemClick(ctrl, 'a'))
    act(() => result.current.handleItemClick(ctrl, 'b'))
    expect(result.current.selectedIds.size).toBe(2)
    act(() => result.current.handleItemClick(plain, 'e'))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('pulls in the active peer on the first ctrl-click only', () => {
    const { result } = renderHook(() =>
      useListMultiSelect(IDS, { resolveActivePeer: () => 'a' }))
    act(() => result.current.handleItemClick(ctrl, 'c'))
    expect(sorted(result.current.selectedIds)).toEqual(['a', 'c'])
    // Second ctrl-click: selection is no longer empty, so no peer is added.
    act(() => result.current.handleItemClick(ctrl, 'd'))
    expect(sorted(result.current.selectedIds)).toEqual(['a', 'c', 'd'])
  })

  it('ignores a peer that is the clicked item itself', () => {
    const { result } = renderHook(() =>
      useListMultiSelect(IDS, { resolveActivePeer: id => id }))
    act(() => result.current.handleItemClick(ctrl, 'c'))
    expect(sorted(result.current.selectedIds)).toEqual(['c'])
  })

  it('selectAll and clear cover the whole list', () => {
    const { result } = renderHook(() => useListMultiSelect(IDS))
    act(() => result.current.selectAll())
    expect(result.current.allSelected).toBe(true)
    act(() => result.current.clear())
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.allSelected).toBe(false)
  })

  it('prunes ids that leave the list', () => {
    // A deleted row must not linger in the selection and get acted on later.
    const { result, rerender } = renderHook(
      ({ ids }) => useListMultiSelect(ids),
      { initialProps: { ids: IDS } },
    )
    act(() => result.current.handleItemClick(ctrl, 'd'))
    act(() => result.current.handleItemClick(ctrl, 'e'))
    expect(sorted(result.current.selectedIds)).toEqual(['d', 'e'])

    rerender({ ids: ['a', 'b', 'c', 'd'] })
    expect(sorted(result.current.selectedIds)).toEqual(['d'])
  })

  it('does not disturb the selection when the list is merely reordered', () => {
    const { result, rerender } = renderHook(
      ({ ids }) => useListMultiSelect(ids),
      { initialProps: { ids: IDS } },
    )
    act(() => result.current.handleItemClick(ctrl, 'b'))
    rerender({ ids: ['e', 'd', 'c', 'b', 'a'] })
    expect(sorted(result.current.selectedIds)).toEqual(['b'])
  })

  it('supports controlled mode', () => {
    let external = new Set<string>()
    const onSelectedChange = vi.fn((next: Set<string>) => { external = next })
    const { result, rerender } = renderHook(() =>
      useListMultiSelect(IDS, { selected: external, onSelectedChange }))

    act(() => result.current.handleItemClick(ctrl, 'b'))
    expect(sorted(external)).toEqual(['b'])

    rerender()
    expect(sorted(result.current.selectedIds)).toEqual(['b'])
  })
})
