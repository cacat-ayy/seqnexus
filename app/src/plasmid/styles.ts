/**
 * Predefined looks for the circular map.
 *
 * Everything the renderer used to hardcode at its draw site lives here instead,
 * which is what lets one setting change the whole drawing rather than forty
 * conditionals scattered through it.
 */

export type PlasmidStyleId = 'modern' | 'classic' | 'minimal' | 'publication'

/** Where feature names go when they do not fit inside their own arc. */
export type LabelPlacement = 'outside' | 'inside'

export interface PlasmidStyle {
  id: PlasmidStyleId
  label: string
  description: string

  /** Fraction of the canvas size used for the backbone radius. */
  radiusFactor: number
  arcWidth: number
  arcGap: number
  backboneWidth: number

  /** Opacity of a feature's fill. 1 means print-solid. */
  featureAlpha: number
  outlineWidth: number
  /** Force every outline to this colour instead of a shade of the fill. */
  outlineColor: string | null

  fontFamily: string
  labelSize: number
  tickSize: number
  enzymeSize: number
  centreNameSize: number
  centreMetaSize: number

  labelPlacement: LabelPlacement
  showTicks: boolean
  showTickLabels: boolean
  showEnzymeLabels: boolean
  /** Paint a background-coloured halo behind label text. */
  labelHalo: boolean

  /** Ignore the app theme and draw on white with black ink. */
  forcePrintPalette: boolean
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export const PLASMID_STYLES: PlasmidStyle[] = [
  {
    id: 'modern',
    label: 'Modern',
    description: 'Solid features, labels outside, subtle ruler',
    radiusFactor: 0.32,
    arcWidth: 16,
    arcGap: 3,
    backboneWidth: 2,
    featureAlpha: 1,
    outlineWidth: 1,
    outlineColor: null,
    fontFamily: SANS,
    labelSize: 11,
    tickSize: 9,
    enzymeSize: 9,
    centreNameSize: 15,
    centreMetaSize: 11,
    labelPlacement: 'outside',
    showTicks: true,
    showTickLabels: true,
    showEnzymeLabels: true,
    labelHalo: true,
    forcePrintPalette: false,
  },
  {
    id: 'classic',
    label: 'Classic',
    description: 'Heavier backbone, feature names inside on leader lines',
    radiusFactor: 0.34,
    arcWidth: 12,
    arcGap: 2,
    backboneWidth: 4,
    featureAlpha: 0.9,
    outlineWidth: 1,
    outlineColor: null,
    fontFamily: SANS,
    labelSize: 10,
    tickSize: 9,
    enzymeSize: 9,
    centreNameSize: 14,
    centreMetaSize: 11,
    labelPlacement: 'inside',
    showTicks: true,
    showTickLabels: true,
    showEnzymeLabels: true,
    labelHalo: true,
    forcePrintPalette: false,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'No ruler or cut-site names, thin bars. For slides',
    radiusFactor: 0.3,
    arcWidth: 9,
    arcGap: 3,
    backboneWidth: 1.5,
    featureAlpha: 1,
    outlineWidth: 0,
    outlineColor: null,
    fontFamily: SANS,
    labelSize: 11,
    tickSize: 9,
    enzymeSize: 9,
    centreNameSize: 15,
    centreMetaSize: 11,
    labelPlacement: 'outside',
    showTicks: false,
    showTickLabels: false,
    showEnzymeLabels: false,
    labelHalo: false,
    forcePrintPalette: false,
  },
  {
    id: 'publication',
    label: 'Publication',
    description: 'White background and black ink whatever the app theme',
    radiusFactor: 0.31,
    arcWidth: 17,
    arcGap: 3,
    backboneWidth: 2,
    // Opaque throughout: a figure printed at 300 dpi should not be carrying
    // the editor's translucency, and alpha over white shifts every hue.
    featureAlpha: 1,
    outlineWidth: 1,
    outlineColor: '#000000',
    fontFamily: SANS,
    labelSize: 12,
    tickSize: 10,
    enzymeSize: 10,
    centreNameSize: 17,
    centreMetaSize: 12,
    labelPlacement: 'outside',
    showTicks: true,
    showTickLabels: true,
    showEnzymeLabels: true,
    labelHalo: true,
    forcePrintPalette: true,
  },
]

export const DEFAULT_PLASMID_STYLE: PlasmidStyleId = 'modern'

const BY_ID = new Map(PLASMID_STYLES.map(s => [s.id, s]))

/** Look up a style, falling back to the default for an unknown id. */
export function getPlasmidStyle(id: PlasmidStyleId | undefined): PlasmidStyle {
  return BY_ID.get(id as PlasmidStyleId) ?? BY_ID.get(DEFAULT_PLASMID_STYLE)!
}

export interface PlasmidColors {
  bg: string
  backbone: string
  text: string
  textMuted: string
  tickMinor: string
  accent: string
  selection: string
  enzyme: string
  primer: string
  gc: string
  gcSkewPos: string
  gcSkewNeg: string
  dam: string
  dcm: string
}

/** Ink for the Publication style, independent of the app theme. */
const PRINT_COLORS: PlasmidColors = {
  bg: '#ffffff',
  backbone: '#000000',
  text: '#000000',
  textMuted: '#444444',
  tickMinor: '#999999',
  accent: '#000000',
  selection: 'rgba(0,0,0,0.12)',
  enzyme: '#333333',
  primer: '#555555',
  gc: '#666666',
  gcSkewPos: '#777777',
  gcSkewNeg: '#bbbbbb',
  dam: '#666666',
  dcm: '#999999',
}

/**
 * Resolve the palette for a style.
 *
 * Non-print styles read the theme tokens off the container, which is how the
 * map follows the app's eight themes. The methylation dot colours used to be
 * hardcoded hex at their draw site and are now tokens like everything else.
 */
export function resolvePlasmidColors(
  style: PlasmidStyle,
  container: HTMLElement | null,
): PlasmidColors {
  // No container means there is nothing to read theme tokens off, which
  // happens in tests and when building a scene for export before mount.
  // Print ink is the safe answer in both cases.
  if (style.forcePrintPalette || !container) return { ...PRINT_COLORS }
  const s = getComputedStyle(container)
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
  return {
    bg: v('--canvas-bg', '#ffffff'),
    backbone: v('--canvas-backbone', '#555555'),
    text: v('--canvas-text', '#333333'),
    textMuted: v('--canvas-ruler', '#888888'),
    tickMinor: v('--canvas-ruler-tick', '#cccccc'),
    accent: v('--accent', '#3b82f6'),
    selection: v('--selection-bg', 'rgba(59,130,246,0.3)'),
    enzyme: v('--canvas-enzyme', '#e53e3e'),
    primer: v('--success', '#16a34a'),
    gc: v('--text-muted', '#94a3b8'),
    gcSkewPos: v('--accent', '#6366f1'),
    gcSkewNeg: v('--warning', '#b45309'),
    dam: v('--accent', '#3b82f6'),
    dcm: v('--warning', '#f59e0b'),
  }
}
