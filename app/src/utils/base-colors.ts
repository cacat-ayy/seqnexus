/**
 * Nucleotide colour schemes for the sequence view.
 *
 * Each scheme is a convention from a different tool or a different way of
 * grouping bases, so users coming from Clustal or MacClade can keep reading
 * sequences the way they already do. All six are pure functions of the base
 * letter, which keeps them cheap enough to call per character in the draw loop.
 *
 * `textColor` is the theme's canvas foreground. Schemes use it wherever the
 * convention says "black" — MacClade's G, and every base under "None". Baking
 * in an actual black would make those bases invisible on the dark themes.
 */

export type ColorSchemeId =
  | 'none'
  | 'nucleotide'
  | 'clustal'
  | 'macclade'
  | 'gc-at'
  | 'purine-pyrimidine'

/**
 * Where a scheme's colour lands.
 *
 * `letters` tints the glyph; `background` fills the cell behind it and draws
 * the glyph in whatever contrasts. Background is the stronger signal — colour
 * blocks are readable at a glance and at small sizes where a thin glyph's hue
 * is hard to judge — which is why alignment viewers default to it. Letters
 * stay easier to read as text.
 */
export type ColorTarget = 'letters' | 'background'

export const COLOR_TARGETS: { id: ColorTarget; label: string }[] = [
  { id: 'letters', label: 'Letters' },
  { id: 'background', label: 'Background' },
]

export const DEFAULT_COLOR_TARGET: ColorTarget = 'letters'

export interface ColorScheme {
  id: ColorSchemeId
  label: string
  description: string
}

export const COLOR_SCHEMES: ColorScheme[] = [
  { id: 'none', label: 'None', description: 'Plain text, no base colouring' },
  { id: 'nucleotide', label: 'Nucleotide', description: 'A green, C amber, G blue, T red' },
  { id: 'clustal', label: 'Clustal', description: 'Clustal X nucleotide colours' },
  { id: 'macclade', label: 'MacClade', description: 'A green, C blue, G black, T red' },
  { id: 'gc-at', label: 'GC vs AT', description: 'Strong and weak base pairs' },
  { id: 'purine-pyrimidine', label: 'Purine vs Pyrimidine', description: 'A/G against C/T/U' },
]

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = 'nucleotide'

/** A scheme entry of `null` means "use the theme's text colour". */
type Palette = Record<string, string | null>

/**
 * The app's long-standing default. Kept byte-identical to the previous
 * hardcoded baseColor() so switching to it changes nothing on screen.
 */
const NUCLEOTIDE: Palette = { A: '#2d8a4e', C: '#d4a017', G: '#2874a6', T: '#c0392b', U: '#c0392b' }

/** Clustal X nucleotide colouring, darkened enough to stay legible on white. */
const CLUSTAL: Palette = { A: '#3ba82c', C: '#d18a1f', G: '#cc3b36', T: '#2f74c9', U: '#2f74c9' }

/** MacClade. Its G is black, which here means the theme foreground. */
const MACCLADE: Palette = { A: '#1a9850', C: '#2b56c4', G: null, T: '#d7301f', U: '#d7301f' }

/** Three hydrogen bonds versus two — the property that drives melting behaviour. */
const GC_AT: Palette = { G: '#2874a6', C: '#2874a6', A: '#c0392b', T: '#c0392b', U: '#c0392b' }

/** Two-ring versus one-ring bases. */
const PURINE_PYRIMIDINE: Palette = { A: '#7b4fa8', G: '#7b4fa8', C: '#1a9850', T: '#1a9850', U: '#1a9850' }

const PALETTES: Record<ColorSchemeId, Palette | null> = {
  none: null,
  nucleotide: NUCLEOTIDE,
  clustal: CLUSTAL,
  macclade: MACCLADE,
  'gc-at': GC_AT,
  'purine-pyrimidine': PURINE_PYRIMIDINE,
}

/**
 * Resolve one base to a colour under a scheme.
 *
 * Unrecognised characters (N, gaps, IUPAC ambiguity codes) fall back to the
 * theme foreground rather than a warning colour — they are common in real
 * records and highlighting them would be noise, not information.
 */
export function baseColorFor(
  scheme: ColorSchemeId,
  base: string,
  textColor: string,
): string {
  const palette = PALETTES[scheme]
  if (!palette) return textColor
  return palette[base.toUpperCase()] ?? textColor
}

/**
 * Build a lookup for one scheme and theme, for use inside a draw loop.
 *
 * The draw loop touches every visible base, so resolving through the palette
 * and the uppercase conversion each time is measurable on a full screen of
 * letters. This resolves the handful of possible characters once instead.
 */
export function buildBasePalette(
  scheme: ColorSchemeId,
  textColor: string,
): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const ch of 'ACGTUNRYSWKMBDHV-.') {
    const color = baseColorFor(scheme, ch, textColor)
    out[ch] = color
    out[ch.toLowerCase()] = color
  }
  return out
}
