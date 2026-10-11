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
import {
  DEFAULT_PLASMID_STYLE, PLASMID_STYLES, type PlasmidStyleId,
  DEFAULT_PLASMID_LAYOUT, PLASMID_LAYOUTS, type PlasmidLayout,
} from '../plasmid/styles'
import {
  AMINO_ACID_STYLES, DEFAULT_AMINO_ACID_STYLE, DEFAULT_TRANSLATION_FRAME,
  TRANSLATION_FRAMES, type AminoAcidStyleId, type TranslationFrameId,
} from '../codon/translation-display'
import { DEFAULT_GENETIC_CODE_ID, GENETIC_CODES } from '../codon/genetic-codes'
import { DEFAULT_PROTEIN_SCHEME, PROTEIN_SCHEMES, type ProteinSchemeId } from './residue-colors'
import { DEFAULT_PKA_SET, PKA_SETS, type PkaSetId } from '../protein/properties'
import { DEFAULT_PROTEIN_SCALE, PROTEIN_SCALES, SCALE_WINDOWS, type ProteinScaleId } from '../protein/scales'
import { STORAGE_KEYS } from '../storage/keys'

const STORAGE_KEY = STORAGE_KEYS.displaySettings

export interface DisplaySettings {
  colorScheme: ColorSchemeId
  /** Whether the scheme tints the glyphs or fills the cell behind them. */
  colorTarget: ColorTarget
  /** Draw the reverse-complement strand under the forward one (letters zoom). */
  showComplement: boolean
  /** Draw the annotation bars beneath the sequence. */
  showAnnotationTracks: boolean
  /** Which predefined look the circular map is drawn in. */
  plasmidStyle: PlasmidStyleId
  /** Where features and cut sites go round the circular map. */
  plasmidLayout: PlasmidLayout
  /** Draw the GC content and GC skew tracks inside the plasmid backbone. */
  showGcRing: boolean
  /** Draw a feature-type colour key in the corner of the map. */
  showPlasmidLegend: boolean
  /** Draw amino acids under the sequence. */
  showTranslation: boolean
  /** Which reading frames, or whether to follow the annotated features. */
  translationFrame: TranslationFrameId
  /** The code the view translates with. The optimizer has its own. */
  translationCodeId: number
  /** How the residues are coloured. */
  aminoAcidStyle: AminoAcidStyleId
  /** Spell residues Ala rather than A. */
  threeLetterAminoAcids: boolean
  /** How a protein document's residues are coloured. Its own choice: a base scheme says nothing about residues. */
  proteinColorScheme: ProteinSchemeId
  /** Which pKa values the isoelectric point and charge are computed with. */
  proteinPkaSet: PkaSetId
  /** The graph track under a protein's features, or none. */
  proteinScale: ProteinScaleId | 'none'
  /** Residues the graph's window spans; 0 takes the scale's own default. */
  proteinScaleWindow: number
  /** Record replaced and deleted residues of a protein as variant features. */
  trackVariants: boolean
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  colorScheme: DEFAULT_COLOR_SCHEME,
  colorTarget: DEFAULT_COLOR_TARGET,
  // Both default on: this is what the app has always drawn, so an existing
  // user sees no change until they choose otherwise.
  showComplement: true,
  showAnnotationTracks: true,
  plasmidStyle: DEFAULT_PLASMID_STYLE,
  // The map the app has always drawn, until the ring layout is chosen.
  plasmidLayout: DEFAULT_PLASMID_LAYOUT,
  // Both off: they are additions, and an existing user should see the map
  // they already know until they ask for more on it.
  showGcRing: false,
  showPlasmidLegend: false,
  // On, following the features, which is exactly what the view drew before
  // any of this was configurable.
  showTranslation: true,
  translationFrame: DEFAULT_TRANSLATION_FRAME,
  translationCodeId: DEFAULT_GENETIC_CODE_ID,
  aminoAcidStyle: DEFAULT_AMINO_ACID_STYLE,
  threeLetterAminoAcids: false,
  proteinColorScheme: DEFAULT_PROTEIN_SCHEME,
  proteinPkaSet: DEFAULT_PKA_SET,
  // Off until asked for: the track takes a row's height from every row.
  proteinScale: DEFAULT_PROTEIN_SCALE,
  proteinScaleWindow: 0,
  // On: a mutation written into a protein is the thing most worth a record.
  trackVariants: true,
}

const VALID_SCHEMES = new Set(COLOR_SCHEMES.map(s => s.id))
const VALID_TARGETS = new Set(COLOR_TARGETS.map(t => t.id))
const VALID_PLASMID_STYLES = new Set(PLASMID_STYLES.map(s => s.id))
const VALID_PLASMID_LAYOUTS = new Set(PLASMID_LAYOUTS.map(l => l.id))
const VALID_FRAMES = new Set(TRANSLATION_FRAMES.map(f => f.id))
const VALID_AA_STYLES = new Set(AMINO_ACID_STYLES.map(s => s.id))
const VALID_CODES = new Set(GENETIC_CODES.map(c => c.id))
const VALID_PROTEIN_SCHEMES = new Set(PROTEIN_SCHEMES.map(s => s.id))
const VALID_PKA_SETS = new Set(PKA_SETS.map(s => s.id))
const VALID_SCALES = new Set(PROTEIN_SCALES.map(s => s.id))
const VALID_WINDOWS = new Set<number>(SCALE_WINDOWS)

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
      plasmidStyle: VALID_PLASMID_STYLES.has(parsed.plasmidStyle as PlasmidStyleId)
        ? parsed.plasmidStyle as PlasmidStyleId
        : DEFAULT_DISPLAY_SETTINGS.plasmidStyle,
      plasmidLayout: VALID_PLASMID_LAYOUTS.has(parsed.plasmidLayout as PlasmidLayout)
        ? parsed.plasmidLayout as PlasmidLayout
        : DEFAULT_DISPLAY_SETTINGS.plasmidLayout,
      showGcRing: typeof parsed.showGcRing === 'boolean'
        ? parsed.showGcRing
        : DEFAULT_DISPLAY_SETTINGS.showGcRing,
      showPlasmidLegend: typeof parsed.showPlasmidLegend === 'boolean'
        ? parsed.showPlasmidLegend
        : DEFAULT_DISPLAY_SETTINGS.showPlasmidLegend,
      showTranslation: typeof parsed.showTranslation === 'boolean'
        ? parsed.showTranslation
        : DEFAULT_DISPLAY_SETTINGS.showTranslation,
      translationFrame: VALID_FRAMES.has(parsed.translationFrame as TranslationFrameId)
        ? parsed.translationFrame as TranslationFrameId
        : DEFAULT_DISPLAY_SETTINGS.translationFrame,
      translationCodeId: VALID_CODES.has(parsed.translationCodeId as number)
        ? parsed.translationCodeId as number
        : DEFAULT_DISPLAY_SETTINGS.translationCodeId,
      aminoAcidStyle: VALID_AA_STYLES.has(parsed.aminoAcidStyle as AminoAcidStyleId)
        ? parsed.aminoAcidStyle as AminoAcidStyleId
        : DEFAULT_DISPLAY_SETTINGS.aminoAcidStyle,
      threeLetterAminoAcids: typeof parsed.threeLetterAminoAcids === 'boolean'
        ? parsed.threeLetterAminoAcids
        : DEFAULT_DISPLAY_SETTINGS.threeLetterAminoAcids,
      proteinColorScheme: VALID_PROTEIN_SCHEMES.has(parsed.proteinColorScheme as ProteinSchemeId)
        ? parsed.proteinColorScheme as ProteinSchemeId
        : DEFAULT_DISPLAY_SETTINGS.proteinColorScheme,
      proteinPkaSet: VALID_PKA_SETS.has(parsed.proteinPkaSet as PkaSetId)
        ? parsed.proteinPkaSet as PkaSetId
        : DEFAULT_DISPLAY_SETTINGS.proteinPkaSet,
      proteinScale: parsed.proteinScale === 'none' || VALID_SCALES.has(parsed.proteinScale as ProteinScaleId)
        ? parsed.proteinScale as ProteinScaleId | 'none'
        : DEFAULT_DISPLAY_SETTINGS.proteinScale,
      proteinScaleWindow: parsed.proteinScaleWindow === 0 || VALID_WINDOWS.has(parsed.proteinScaleWindow as number)
        ? parsed.proteinScaleWindow as number
        : DEFAULT_DISPLAY_SETTINGS.proteinScaleWindow,
      trackVariants: typeof parsed.trackVariants === 'boolean'
        ? parsed.trackVariants
        : DEFAULT_DISPLAY_SETTINGS.trackVariants,
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
