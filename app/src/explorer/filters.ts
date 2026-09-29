/**
 * Explorer filter state.
 *
 * Deliberately not persisted. A saved filter that hides items is a trap: the
 * next session opens with work apparently missing and no visible cause. The
 * panel shows a count badge whenever anything is active so the current state
 * is always accounted for on screen.
 */

import type { ExplorerItem, ItemKind } from './types'

export interface ExplorerFilters {
  /** Empty means every kind. */
  kinds: ReadonlySet<ItemKind>
  /** Empty means any tag. An item matches if it carries any listed tag. */
  tags: ReadonlySet<string>
  starredOnly: boolean
  modifiedOnly: boolean
}

export const NO_FILTERS: ExplorerFilters = {
  kinds: new Set(),
  tags: new Set(),
  starredOnly: false,
  modifiedOnly: false,
}

export function isFiltered(f: ExplorerFilters): boolean {
  return f.kinds.size > 0 || f.tags.size > 0 || f.starredOnly || f.modifiedOnly
}

/** How many filters are switched on, for the badge on the filter button. */
export function filterCount(f: ExplorerFilters): number {
  return f.kinds.size + f.tags.size + (f.starredOnly ? 1 : 0) + (f.modifiedOnly ? 1 : 0)
}

/**
 * Compile the filter state into a predicate, or undefined when nothing is
 * filtered so `buildNodes` can skip the call entirely.
 *
 * Starred is not handled here: it is read from the same set the Favorites
 * group uses, and passing it in keeps this pure.
 */
export function buildFilter(
  f: ExplorerFilters,
  tagsByUid: Readonly<Record<string, string[] | undefined>>,
  starred?: ReadonlySet<string>,
): ((item: ExplorerItem) => boolean) | undefined {
  if (!isFiltered(f)) return undefined
  return (item: ExplorerItem) => {
    if (f.kinds.size > 0 && !f.kinds.has(item.kind)) return false
    if (f.starredOnly && !starred?.has(item.uid)) return false
    if (f.modifiedOnly && !item.isDirty) return false
    if (f.tags.size > 0) {
      const tags = tagsByUid[item.uid]
      if (!tags?.some(t => f.tags.has(t))) return false
    }
    return true
  }
}

export function toggleIn<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
