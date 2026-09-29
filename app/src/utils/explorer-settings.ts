/**
 * Explorer panel preferences: width, row density and which groups are folded.
 *
 * These are user preferences rather than session data, so they live in their
 * own small localStorage key, the same arrangement as the display settings.
 * The session restores asynchronously from IndexedDB, so a width read from
 * there would arrive after first paint and the sidebar would visibly jump on
 * every reload.
 *
 * This key replaces the ad-hoc `seqnexus:fe-sections` blob the old explorer
 * wrote its four section-collapse booleans into.
 */

import {
  DENSITIES, GROUP_BY_OPTIONS, SORT_OPTIONS,
  type Density, type GroupBy, type SortBy, type SortDir,
} from '../explorer/types'

const STORAGE_KEY = 'seqnexus:explorer-settings'

export const SIDEBAR_MIN = 180
export const SIDEBAR_MAX = 520
export const SIDEBAR_DEFAULT = 220

export interface ExplorerSettings {
  width: number
  density: Density
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  /** Draw alignments and contigs under the sequence they came from. */
  nestDerived: boolean
  /** Group keys the user has folded away. Folders keep their own flag. */
  collapsedGroups: string[]
}

export const DEFAULT_EXPLORER_SETTINGS: ExplorerSettings = {
  width: SIDEBAR_DEFAULT,
  // Comfortable rather than compact: the metadata line is the point of the
  // redesign, and a user who wants the old one-line list can say so.
  density: 'comfortable',
  // Type, not Folder, so an existing session opens looking like it did
  // before grouping was configurable. Folders are one click away.
  groupBy: 'type',
  sortBy: 'name',
  sortDir: 'asc',
  nestDerived: false,
  collapsedGroups: [],
}

const VALID_DENSITIES = new Set<string>(DENSITIES)
const VALID_GROUP_BY = new Set<string>(GROUP_BY_OPTIONS.map(o => o.id))
const VALID_SORT_BY = new Set<string>(SORT_OPTIONS.map(o => o.id))

export function clampWidth(n: number): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(n)))
}

/** Read preferences synchronously, before first paint. Never throws. */
export function loadExplorerSettings(): ExplorerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_EXPLORER_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<ExplorerSettings>
    return {
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? clampWidth(parsed.width)
        : DEFAULT_EXPLORER_SETTINGS.width,
      density: VALID_DENSITIES.has(parsed.density as string)
        ? parsed.density as Density
        : DEFAULT_EXPLORER_SETTINGS.density,
      groupBy: VALID_GROUP_BY.has(parsed.groupBy as string)
        ? parsed.groupBy as GroupBy
        : DEFAULT_EXPLORER_SETTINGS.groupBy,
      sortBy: VALID_SORT_BY.has(parsed.sortBy as string)
        ? parsed.sortBy as SortBy
        : DEFAULT_EXPLORER_SETTINGS.sortBy,
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
      nestDerived: parsed.nestDerived === true,
      collapsedGroups: Array.isArray(parsed.collapsedGroups)
        ? parsed.collapsedGroups.filter((k): k is string => typeof k === 'string')
        : [],
    }
  } catch {
    return { ...DEFAULT_EXPLORER_SETTINGS }
  }
}

export function saveExplorerSettings(settings: ExplorerSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Quota or a blocked storage API. A lost preference is not worth an error.
  }
}
