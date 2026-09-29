/**
 * One item abstraction for everything the explorer lists.
 *
 * The explorer used to render five hand-written blocks, one per kind, and
 * recover the kind of a row by sniffing its id prefix (`id.startsWith('seq_')`).
 * That meant every per-row feature had to be written five times and every new
 * caller had to re-derive the same type switch.
 *
 * Instead each kind gets an adapter that flattens it into an `ExplorerItem`,
 * and the rest of the explorer never learns what it is looking at.
 */

import type { LucideIcon } from 'lucide-react'

export type ItemKind = 'sequence' | 'read' | 'alignment' | 'read-alignment' | 'contig'

export const ITEM_KINDS: readonly ItemKind[] = [
  'sequence', 'read', 'alignment', 'read-alignment', 'contig',
] as const

/**
 * A row's stable identity across kinds.
 *
 * Store ids are only unique within their own kind, so the explorer namespaces
 * them. `uid` is what selection, favourites and the DOM key are all keyed on.
 */
export function toUid(kind: ItemKind, id: string): string {
  return `${kind}:${id}`
}

export function parseUid(uid: string): { kind: ItemKind; id: string } | null {
  const sep = uid.indexOf(':')
  if (sep === -1) return null
  const kind = uid.slice(0, sep) as ItemKind
  if (!ITEM_KINDS.includes(kind)) return null
  return { kind, id: uid.slice(sep + 1) }
}

/** A short status chip. Quality colours are reserved for quality, not for kind. */
export interface ItemBadge {
  key: string
  /** Rendered as a tooltip; the badge itself is an icon. */
  label: string
  icon: LucideIcon
  tone: 'neutral' | 'warn' | 'danger'
}

export interface ExplorerItem {
  /** `${kind}:${id}` */
  uid: string
  kind: ItemKind
  /** The store's own id, unchanged, for handing back to store actions. */
  id: string
  name: string
  /** When it entered the session. 0 when the session predates the field. */
  createdAt: number
  /** Last edit, where the kind tracks one. Falls back to `createdAt`. */
  modifiedAt?: number
  /**
   * A single comparable magnitude for the sort: bases for a sequence or a
   * read, alignment columns for an alignment, reads for a contig. Comparing
   * a plasmid against a contig is meaningless, but sorting within a group is
   * exactly what this is for.
   */
  size: number
  /** Showing in the centre panel right now. At most one item is open. */
  isOpen: boolean
  /** Reads only: included in the multi-trace view alongside the open one. */
  isIncluded: boolean
  /** Edited since it was opened. */
  isDirty: boolean
  isReadOnly: boolean
  /** Sequences only: draws a pip on the kind icon. */
  isCircular: boolean
  /** Whether this kind supports duplication. */
  canDuplicate: boolean
  /** Short facts for the metadata line, already formatted. */
  stats: string[]
  badges: ItemBadge[]
  /**
   * Uids this item was derived from: a read alignment points at its read and
   * its reference. Unused by the current tree, populated so derived-item
   * nesting can be added without touching the adapters again.
   */
  derivedFrom: string[]
}

/** Per-item user metadata. Persisted with the session, keyed by uid. */
export interface ItemMeta {
  starred?: boolean
  note?: string
  /**
   * Tag names. The colour for a name lives once in the store's `tagColors`,
   * not here: it belongs to the tag, not to each item wearing it.
   */
  tags?: string[]
}

/**
 * How the tree is sectioned. Folders are a property of an item, not a level
 * of the tree, so every mode sees the same folder membership and only the
 * presentation changes.
 */
export type GroupBy = 'folder' | 'type' | 'tag' | 'date' | 'flat'

export const GROUP_BY_OPTIONS: readonly { id: GroupBy; label: string }[] = [
  { id: 'folder', label: 'Folders' },
  { id: 'type', label: 'Type' },
  { id: 'tag', label: 'Tag' },
  { id: 'date', label: 'Date added' },
  { id: 'flat', label: 'Flat list' },
] as const

export type SortBy = 'name' | 'created' | 'modified' | 'size' | 'kind'
export type SortDir = 'asc' | 'desc'

export const SORT_OPTIONS: readonly { id: SortBy; label: string }[] = [
  { id: 'name', label: 'Name' },
  { id: 'created', label: 'Date added' },
  { id: 'modified', label: 'Last modified' },
  { id: 'size', label: 'Size' },
  { id: 'kind', label: 'Type' },
] as const

export type Density = 'compact' | 'comfortable' | 'relaxed'

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'relaxed'] as const

/** Row heights, in px, per density. Fixed so the tree can be windowed. */
export const ROW_HEIGHT: Record<Density, number> = {
  compact: 22,
  comfortable: 30,
  relaxed: 40,
}

export const GROUP_ROW_HEIGHT = 26
export const FOLDER_ROW_HEIGHT = 24
export const EMPTY_ROW_HEIGHT = 26
