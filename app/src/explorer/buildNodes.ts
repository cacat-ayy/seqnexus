/**
 * Flattens items, folders and groups into the single ordered array the tree
 * renders.
 *
 * Two things fall out of building the tree as a flat list rather than as
 * nested JSX. Shift-click range selection gets its ordering for free, instead
 * of the separate hand-maintained id list the old explorer kept in sync by
 * hand. And because every node declares a fixed height, the list can be
 * windowed, which is what keeps a few hundred reads scrolling smoothly.
 *
 * Grouping is a presentation choice here, not a property of the data. A
 * folder holds whatever it holds; whether it shows as one node or as several
 * per-kind sub-groups is up to `groupBy`, and switching modes never moves
 * anything.
 */

import type { ExplorerFolder } from '../store'
import type { ExplorerItem, GroupBy, ItemKind, SortBy, SortDir } from './types'
import { KIND_GROUP_LABEL, KIND_ORDER, ALWAYS_SHOWN_KINDS } from './kinds'

/**
 * `key` is the React key, so it has to be unique across the whole list. The
 * same folder or item can be drawn more than once (a folder under every kind
 * it holds, an item in Favorites and in its group, under each of its tags),
 * so non-group keys are the node's path from its group down. Duplicates left
 * a deleted folder's row mounted over its neighbours until a reload.
 *
 * A group's key is its identity (collapse state, the Favorites check), and
 * each group appears once, so group keys stay bare.
 */
export type ExplorerNode =
  | { type: 'group'; key: string; label: string; count: number; collapsed: boolean; depth: 0 }
  | { type: 'folder'; key: string; folder: ExplorerFolder; count: number; depth: number }
  | { type: 'item'; key: string; item: ExplorerItem; depth: number }
  | { type: 'empty'; key: string; message: string; depth: number }

export const FAVORITES_KEY = 'favorites'
export const UNGROUPED_KEY = 'ungrouped'
export const UNTAGGED_KEY = 'untagged'

/** Deepest folder nesting the tree will draw, as a backstop against a cycle. */
const MAX_FOLDER_DEPTH = 12

export interface BuildNodesInput {
  byKind: Record<ItemKind, ExplorerItem[]>
  folders: ExplorerFolder[]
  /** Uids the user has starred. */
  starred: ReadonlySet<string>
  /** Tags per uid, for the tag grouping mode. */
  tagsByUid: Readonly<Record<string, string[] | undefined>>
  /** Group keys the user has collapsed. Folders carry their own flag. */
  collapsedGroups: ReadonlySet<string>
  /** Already lower-cased and trimmed. Matched against `searchText`. */
  query: string
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  /** Draw alignments and contigs under the sequence they were built from. */
  nestDerived?: boolean
  /** Extra text per uid to match the query against (notes, tags, features). */
  searchText?: Readonly<Record<string, string | undefined>>
  /** Predicate applied before grouping. Undefined means everything passes. */
  filter?: (item: ExplorerItem) => boolean
}

export interface BuildNodesResult {
  nodes: ExplorerNode[]
  /** Item uids in visual order, for shift-click range selection. */
  itemUids: string[]
  /** Distinct items passing the query and filter. Zero means "no matches". */
  matchCount: number
}

const EMPTY_MESSAGE: Partial<Record<ItemKind, string>> = {
  'sequence': 'No sequences open',
  'read': 'No sequencing reads imported',
}

const KIND_RANK: Record<ItemKind, number> = {
  'sequence': 0, 'read': 1, 'alignment': 2, 'read-alignment': 3, 'contig': 4, 'gel': 5, 'oligo': 6,
}

/** Compare two items by the active sort. Name is the tiebreak throughout. */
function comparator(sortBy: SortBy, dir: SortDir) {
  const sign = dir === 'asc' ? 1 : -1
  return (a: ExplorerItem, b: ExplorerItem): number => {
    let d = 0
    switch (sortBy) {
      case 'name': d = a.name.localeCompare(b.name); break
      case 'created': d = a.createdAt - b.createdAt; break
      case 'modified': d = (a.modifiedAt ?? a.createdAt) - (b.modifiedAt ?? b.createdAt); break
      case 'size': d = a.size - b.size; break
      case 'kind': d = KIND_RANK[a.kind] - KIND_RANK[b.kind]; break
    }
    if (d !== 0) return d * sign
    return a.name.localeCompare(b.name)
  }
}

/** Today / This week / This month / Earlier, for the date grouping mode. */
function dateBucket(createdAt: number, now: number): { key: string; label: string; rank: number } {
  if (createdAt <= 0) return { key: 'date-unknown', label: 'Earlier', rank: 4 }
  const day = 86_400_000
  const age = now - createdAt
  if (age < day) return { key: 'date-today', label: 'Today', rank: 0 }
  if (age < 7 * day) return { key: 'date-week', label: 'This week', rank: 1 }
  if (age < 30 * day) return { key: 'date-month', label: 'This month', rank: 2 }
  return { key: 'date-earlier', label: 'Earlier', rank: 3 }
}

export function buildNodes(input: BuildNodesInput, now = Date.now()): BuildNodesResult {
  const {
    byKind, folders, starred, tagsByUid, collapsedGroups, query,
    groupBy, sortBy, sortDir, nestDerived, searchText, filter,
  } = input

  const nodes: ExplorerNode[] = []
  const itemUids: string[] = []
  const sort = comparator(sortBy, sortDir)

  // A folder whose own name matches shows all of its contents, so searching
  // for a folder is a way to pull up everything filed in it.
  const matchedFolders = new Set(
    query ? folders.filter(f => f.name.toLowerCase().includes(query)).map(f => f.id) : [],
  )
  const uidsInMatchedFolders = new Set<string>()
  for (const f of folders) {
    if (matchedFolders.has(f.id)) for (const uid of f.itemUids) uidsInMatchedFolders.add(uid)
  }

  const matches = (item: ExplorerItem): boolean => {
    if (filter && !filter(item)) return false
    if (!query) return true
    if (uidsInMatchedFolders.has(item.uid)) return true
    if (item.name.toLowerCase().includes(query)) return true
    return (searchText?.[item.uid] ?? '').includes(query)
  }

  const visible: ExplorerItem[] = []
  for (const kind of KIND_ORDER) for (const item of byKind[kind]) if (matches(item)) visible.push(item)
  const matchCount = visible.length
  const visibleByUid = new Map(visible.map(i => [i.uid, i]))

  /**
   * Provenance nesting: an alignment or contig drawn under the sequence it
   * was built from rather than in its own group.
   *
   * The parent is the first entry in `derivedFrom` that resolves to a visible
   * sequence. A read alignment names both its read and its reference, and the
   * reference is the useful home: the question this answers is "which of
   * these six alignments came from this plasmid".
   */
  const childrenOfItem = new Map<string, ExplorerItem[]>()
  const nested = new Set<string>()
  if (nestDerived) {
    for (const item of visible) {
      const parent = item.derivedFrom.find(uid => {
        const candidate = visibleByUid.get(uid)
        return candidate !== undefined && candidate.kind === 'sequence'
      })
      if (!parent) continue
      nested.add(item.uid)
      const list = childrenOfItem.get(parent)
      if (list) list.push(item)
      else childrenOfItem.set(parent, [item])
    }
  }

  /** Items that get a row of their own in a group, as opposed to under a parent. */
  const topLevel = (items: ExplorerItem[]) =>
    nested.size === 0 ? items : items.filter(i => !nested.has(i.uid))

  /** `path` is the key of whatever the items are drawn under. */
  const pushItems = (items: ExplorerItem[], depth: number, path: string) => {
    for (const item of items) {
      const key = `${path}/${item.uid}`
      nodes.push({ type: 'item', key, item, depth })
      itemUids.push(item.uid)
      // Depth-capped rather than cycle-guarded: a child can only be a
      // non-sequence and a parent can only be a sequence, so a cycle cannot
      // form, but the cap keeps a future change from hanging the tree.
      const children = childrenOfItem.get(item.uid)
      if (children && depth < MAX_FOLDER_DEPTH) pushItems(children.sort(sort), depth + 1, key)
    }
  }

  const pushGroup = (key: string, label: string, count: number): boolean => {
    const collapsed = collapsedGroups.has(key)
    nodes.push({ type: 'group', key, label, count, collapsed, depth: 0 })
    return !collapsed
  }

  // --- Favourites, pinned above everything and spanning kinds ---
  // Favourites are always top level: a starred item must be findable there
  // whether or not its parent happens to be on screen.
  const favorites = visible.filter(i => starred.has(i.uid)).sort(sort)
  if (favorites.length > 0 && pushGroup(FAVORITES_KEY, 'Favorites', favorites.length)) {
    pushItems(favorites, 1, FAVORITES_KEY)
  }

  /**
   * Draw a folder and its descendants.
   *
   * `pool` is the set of items eligible for this part of the tree, which is
   * everything in folder mode and one kind's items in type mode. That is the
   * whole difference between the two: the same folder, filtered differently.
   */
  const childrenOf = new Map<string | null, ExplorerFolder[]>()
  for (const f of folders) {
    const list = childrenOf.get(f.parentId ?? null)
    if (list) list.push(f)
    else childrenOf.set(f.parentId ?? null, [f])
  }

  function pushFolderTree(
    parentId: string | null,
    pool: Map<string, ExplorerItem>,
    depth: number,
    seen: Set<string>,
    path: string,
  ): number {
    let drawn = 0
    if (depth > MAX_FOLDER_DEPTH) return 0
    const children = (childrenOf.get(parentId) ?? []).slice()
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const folder of children) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)

      // A nested child is drawn under its parent, wherever that parent is
      // filed, so it does not also get a row of its own inside the folder.
      const own = folder.itemUids
        .map(uid => pool.get(uid))
        .filter((i): i is ExplorerItem => i !== undefined && !nested.has(i.uid))
        .sort(sort)

      // Count what the subtree holds before deciding to draw it, or an empty
      // parent of a full child would be hidden along with its contents.
      const subtreeCount = own.length + countSubtree(folder.id, pool, depth + 1, new Set(seen))
      if (query && subtreeCount === 0 && !matchedFolders.has(folder.id)) continue

      const key = `${path}/${folder.id}`
      nodes.push({ type: 'folder', key, folder, count: subtreeCount, depth })
      drawn += subtreeCount
      if (folder.collapsed) continue

      const drawnBelow = pushFolderTree(folder.id, pool, depth + 1, seen, key)
      pushItems(own, depth + 1, key)
      if (own.length === 0 && drawnBelow === 0) {
        nodes.push({ type: 'empty', key: `${key}:empty`, message: 'Drag items here', depth: depth + 1 })
      }
    }
    return drawn
  }

  function countSubtree(
    parentId: string,
    pool: Map<string, ExplorerItem>,
    depth: number,
    seen: Set<string>,
  ): number {
    if (depth > MAX_FOLDER_DEPTH) return 0
    let n = 0
    for (const folder of childrenOf.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue
      seen.add(folder.id)
      n += folder.itemUids.filter(uid => pool.has(uid)).length
      n += countSubtree(folder.id, pool, depth + 1, seen)
    }
    return n
  }

  const filedUids = new Set<string>()
  for (const f of folders) for (const uid of f.itemUids) filedUids.add(uid)

  // --- The main body, per mode ---
  if (groupBy === 'flat') {
    pushItems(topLevel(visible).slice().sort(sort), 0, '')

  } else if (groupBy === 'folder') {
    const drawn = pushFolderTree(null, visibleByUid, 0, new Set(), '')
    const loose = topLevel(visible).filter(i => !filedUids.has(i.uid)).sort(sort)
    if (loose.length > 0) {
      if (pushGroup(UNGROUPED_KEY, drawn > 0 ? 'Ungrouped' : 'All items', loose.length)) {
        pushItems(loose, 1, UNGROUPED_KEY)
      }
    }

  } else if (groupBy === 'tag') {
    const byTag = new Map<string, ExplorerItem[]>()
    const untagged: ExplorerItem[] = []
    for (const item of topLevel(visible)) {
      const tags = tagsByUid[item.uid]
      if (!tags || tags.length === 0) { untagged.push(item); continue }
      // An item with three tags is listed under all three: that is what a
      // tag is for, and hiding it under one would make the others lie.
      for (const tag of tags) {
        const list = byTag.get(tag)
        if (list) list.push(item)
        else byTag.set(tag, [item])
      }
    }
    for (const tag of [...byTag.keys()].sort((a, b) => a.localeCompare(b))) {
      const items = byTag.get(tag)!.sort(sort)
      if (pushGroup(`tag:${tag}`, tag, items.length)) pushItems(items, 1, `tag:${tag}`)
    }
    if (untagged.length > 0 && pushGroup(UNTAGGED_KEY, 'Untagged', untagged.length)) {
      pushItems(untagged.sort(sort), 1, UNTAGGED_KEY)
    }

  } else if (groupBy === 'date') {
    const buckets = new Map<string, { label: string; rank: number; items: ExplorerItem[] }>()
    for (const item of topLevel(visible)) {
      const b = dateBucket(item.createdAt, now)
      const entry = buckets.get(b.key)
      if (entry) entry.items.push(item)
      else buckets.set(b.key, { label: b.label, rank: b.rank, items: [item] })
    }
    for (const [key, bucket] of [...buckets.entries()].sort((a, b) => a[1].rank - b[1].rank)) {
      if (pushGroup(key, bucket.label, bucket.items.length)) pushItems(bucket.items.sort(sort), 1, key)
    }

  } else {
    // groupBy === 'type': a group per kind, with folders nested inside each
    // one and listed only where they hold items of that kind.
    for (const kind of KIND_ORDER) {
      const all = byKind[kind]
      const shown = topLevel(visible).filter(i => i.kind === kind)
      const pool = new Map(shown.map(i => [i.uid, i]))
      const loose = shown.filter(i => !filedUids.has(i.uid)).sort(sort)
      const hasContent = shown.length > 0

      // Empty groups stay visible for the kinds work starts from, but never
      // while searching: an empty "Sequences" header under a query that
      // matched nothing reads as a result.
      if (!hasContent && (query || filter || !ALWAYS_SHOWN_KINDS.has(kind))) continue
      if (!pushGroup(kind, KIND_GROUP_LABEL[kind], all.length)) continue

      const drawn = pushFolderTree(null, pool, 1, new Set(), kind)
      if (loose.length > 0) {
        pushItems(loose, 1, kind)
      } else if (drawn === 0) {
        const message = EMPTY_MESSAGE[kind]
        if (message) nodes.push({ type: 'empty', key: `${kind}:empty`, message, depth: 1 })
      }
    }
  }

  return { nodes, itemUids, matchCount }
}
