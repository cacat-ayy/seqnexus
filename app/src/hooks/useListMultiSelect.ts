import { useState, useRef, useCallback, useEffect, useMemo } from 'react'

/**
 * Shift/Ctrl-click multi-selection over an ordered list.
 *
 * Extracted from the file explorer, which had the only implementation of this
 * in the app. The annotation sidebar needs the same behaviour, and two hand-
 * rolled copies would drift — range selection is exactly the kind of thing
 * that ends up subtly different in each place.
 *
 * Conventions follow the platform: Ctrl/Cmd toggles one item, Shift extends
 * from the last clicked anchor, a plain click clears the selection and
 * activates the item.
 */

export interface ListMultiSelectOptions {
  /** Supply to drive the selection from outside (e.g. a store slice). */
  selected?: Set<string>
  /** Required when `selected` is supplied. */
  onSelectedChange?: (next: Set<string>) => void
  /**
   * On the first Ctrl-click, also pull in a related already-active item — the
   * file explorer treats the open document as implicitly selected so that
   * Ctrl-clicking a second one selects both, not just the second.
   */
  resolveActivePeer?: (itemId: string) => string | null
}

export function useListMultiSelect(
  orderedIds: string[],
  opts: ListMultiSelectOptions = {},
) {
  const { selected, onSelectedChange, resolveActivePeer } = opts

  const [internal, setInternal] = useState<Set<string>>(() => new Set())
  const isControlled = selected !== undefined
  const selectedIds = isControlled ? selected : internal

  // Kept in a ref so the callbacks below can stay stable while still reading
  // the current selection — they are passed to every row in a long list.
  const selectedRef = useRef(selectedIds)
  selectedRef.current = selectedIds

  const apply = useCallback((update: (prev: Set<string>) => Set<string>) => {
    if (isControlled) onSelectedChange?.(update(selectedRef.current))
    else setInternal(update)
  }, [isControlled, onSelectedChange])

  /** Anchor for Shift-range selection. */
  const lastClickedId = useRef<string | null>(null)

  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds

  // Drop ids that have left the list — deleting a selected row must not leave
  // a phantom in the selection that later bulk actions would act on.
  const idsKey = orderedIds.join('\u0000')
  useEffect(() => {
    const present = new Set(orderedRef.current)
    const current = selectedRef.current
    let stale = false
    for (const id of current) {
      if (!present.has(id)) { stale = true; break }
    }
    if (!stale) return
    apply(prev => new Set([...prev].filter(id => present.has(id))))
    if (lastClickedId.current && !present.has(lastClickedId.current)) {
      lastClickedId.current = null
    }
  }, [idsKey, apply])

  const clear = useCallback(() => {
    if (selectedRef.current.size === 0) return
    apply(() => new Set())
  }, [apply])

  const selectAll = useCallback(() => {
    apply(() => new Set(orderedRef.current))
  }, [apply])

  const handleItemClick = useCallback((
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    itemId: string,
    activate?: () => void,
  ) => {
    if (e.ctrlKey || e.metaKey) {
      apply(prev => {
        const next = new Set(prev)
        if (next.has(itemId)) next.delete(itemId)
        else next.add(itemId)
        if (prev.size === 0) {
          const peer = resolveActivePeer?.(itemId)
          if (peer && peer !== itemId) next.add(peer)
        }
        return next
      })
      lastClickedId.current = itemId
      return
    }

    if (e.shiftKey && lastClickedId.current) {
      const ids = orderedRef.current
      const from = ids.indexOf(lastClickedId.current)
      const to = ids.indexOf(itemId)
      if (from !== -1 && to !== -1) {
        const lo = Math.min(from, to)
        const hi = Math.max(from, to)
        apply(prev => {
          const next = new Set(prev)
          for (let i = lo; i <= hi; i++) next.add(ids[i])
          return next
        })
        // The anchor deliberately stays put, so repeated Shift-clicks grow or
        // shrink the same range rather than chaining new ones.
        return
      }
    }

    // Plain click: selection collapses and the item is opened.
    apply(() => new Set())
    lastClickedId.current = itemId
    activate?.()
  }, [apply, resolveActivePeer])

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const allSelected = useMemo(
    () => orderedIds.length > 0 && orderedIds.every(id => selectedIds.has(id)),
    [orderedIds, selectedIds],
  )

  return { selectedIds, handleItemClick, clear, selectAll, isSelected, allSelected }
}
