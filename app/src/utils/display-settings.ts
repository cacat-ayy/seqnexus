/**
 * Global sequence-view display preferences.
 *
 * These are user preferences, not document state, so they live in their own
 * small localStorage key rather than in the session blob alongside the tabs.
 * Two reasons that matters:
 *
 *  - The session restores asynchronously from IndexedDB. A colour scheme read
 *    from there would arrive after the first paint, so every reload would
 *    flash the default palette before correcting itself.
 *  - Clearing or failing to restore a session should not silently reset how
 *    the user has chosen to read sequences.
 *
 * Same pattern as the primer and BLAST panels, which already keep their own
 * settings keys.
 */

import {
  DEFAULT_COLOR_SCHEME, DEFAULT_COLOR_TARGET, COLOR_SCHEMES, COLOR_TARGETS,
  type ColorSchemeId, type ColorTarget,
} from './base-colors'

const STORAGE_KEY = 'seqnexus:display-settings'

export interface DisplaySettings {
  colorScheme: ColorSchemeId
  /** Whether the scheme tints the glyphs or fills the cell behind them. */
  colorTarget: ColorTarget
  /** Draw the reverse-complement strand under the forward one (letters zoom). */
  showComplement: boolean
  /** Draw the annotation bars beneath the sequence. */
  showAnnotationTracks: boolean
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  colorScheme: DEFAULT_COLOR_SCHEME,
  colorTarget: DEFAULT_COLOR_TARGET,
  // Both default on: this is what the app has always drawn, so an existing
  // user sees no change until they choose otherwise.
  showComplement: true,
  showAnnotationTracks: true,
}

const VALID_SCHEMES = new Set(COLOR_SCHEMES.map(s => s.id))
const VALID_TARGETS = new Set(COLOR_TARGETS.map(t => t.id))

/**
 * Read preferences synchronously, before first paint.
 *
 * Every field is validated individually: a scheme id removed in a later
 * version, or a hand-edited value, must degrade to the default rather than
 * leaving the canvas asking a palette for a key that is not there.
 */
export function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>
    return {
      colorScheme: VALID_SCHEMES.has(parsed.colorScheme as ColorSchemeId)
        ? parsed.colorScheme as ColorSchemeId
        : DEFAULT_DISPLAY_SETTINGS.colorScheme,
      colorTarget: VALID_TARGETS.has(parsed.colorTarget as ColorTarget)
        ? parsed.colorTarget as ColorTarget
        : DEFAULT_DISPLAY_SETTINGS.colorTarget,
      showComplement: typeof parsed.showComplement === 'boolean'
        ? parsed.showComplement
        : DEFAULT_DISPLAY_SETTINGS.showComplement,
      showAnnotationTracks: typeof parsed.showAnnotationTracks === 'boolean'
        ? parsed.showAnnotationTracks
        : DEFAULT_DISPLAY_SETTINGS.showAnnotationTracks,
    }
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS }
  }
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Quota or private-browsing. Losing a preference is not worth an error.
  }
}
