/**
 * Where the app's chrome sits: the toolbar along the top or down the left,
 * and the features panel on the right or along the bottom.
 *
 * A preference of its own key, like the display settings, and read
 * synchronously for the same reason: the layout has to be right on the first
 * paint, or every reload would show the default and then jump.
 */

import { STORAGE_KEYS } from '../storage/keys'

export type ToolbarPlacement = 'top' | 'left'
export type PanelPlacement = 'right' | 'bottom'

export interface LayoutSettings {
  toolbar: ToolbarPlacement
  panel: PanelPlacement
}

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = { toolbar: 'top', panel: 'right' }

/** Each field checked on its own: a stray value falls back to the default. */
export function loadLayoutSettings(): LayoutSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.layout)
    if (!raw) return { ...DEFAULT_LAYOUT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<LayoutSettings> | null
    return {
      toolbar: parsed?.toolbar === 'left' ? 'left' : 'top',
      panel: parsed?.panel === 'bottom' ? 'bottom' : 'right',
    }
  } catch {
    return { ...DEFAULT_LAYOUT_SETTINGS }
  }
}

export function saveLayoutSettings(settings: LayoutSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(settings))
  } catch {
    // Quota or private browsing: the layout still applies for this visit.
  }
}
