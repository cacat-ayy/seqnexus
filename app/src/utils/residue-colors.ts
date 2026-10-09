/**
 * Residue colour schemes for a protein document's sequence view.
 *
 * The same palettes the translation strip under a DNA sequence offers, plus
 * the two alignment-view conventions (Taylor, Zappo) that colour a residue
 * on its own rather than by its column. Nothing here is new colour: a
 * palette looks the same wherever the app draws residues.
 *
 * `textColor` is the theme's canvas foreground, used wherever a palette has
 * no colour for a letter, so an X or a gap stays legible on dark themes.
 */

import { AMINO_ACID_STYLES, aminoAcidFill, type AminoAcidStyleId } from '../codon/translation-display'
import { TAYLOR, ZAPPO } from '../msa/colors'
import { PROTEIN_RESIDUES } from '../models/alphabet'

export type ProteinSchemeId =
  | 'none'
  | 'hydrophobicity'
  | 'polarity'
  | 'rasmol'
  | 'clustal'
  | 'macclade'
  | 'taylor'
  | 'zappo'

export interface ProteinScheme {
  id: ProteinSchemeId
  label: string
  description: string
}

/** The translation palettes, minus "by annotation", which needs a feature to take a colour from. */
const SHARED: ProteinScheme[] = AMINO_ACID_STYLES
  .filter(s => s.id !== 'annotation')
  .map(s => ({ id: s.id as ProteinSchemeId, label: s.id === 'none' ? 'None' : s.label, description: s.description }))

export const PROTEIN_SCHEMES: ProteinScheme[] = [
  ...SHARED,
  { id: 'taylor', label: 'Taylor', description: 'Taylor (1997): one hue per residue, neighbours in the wheel are similar' },
  { id: 'zappo', label: 'Zappo', description: 'Physicochemical groups, as Jalview draws them' },
]

export const DEFAULT_PROTEIN_SCHEME: ProteinSchemeId = 'polarity'

const SHARED_IDS = new Set<string>(SHARED.map(s => s.id))

/** Resolve one residue to a colour under a scheme, or the text colour. */
export function residueColorFor(scheme: ProteinSchemeId, residue: string, textColor: string): string {
  const aa = residue.toUpperCase()
  if (scheme === 'none') return textColor
  if (scheme === 'taylor') return TAYLOR[aa] ?? textColor
  if (scheme === 'zappo') return ZAPPO[aa] ?? textColor
  if (SHARED_IDS.has(scheme)) return aminoAcidFill(scheme as AminoAcidStyleId, aa) ?? textColor
  return textColor
}

/**
 * A lookup for one scheme and theme, for the draw loop. Resolved once per
 * letter rather than per cell, as the base palette is.
 */
export function buildResiduePalette(scheme: ProteinSchemeId, textColor: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const ch of PROTEIN_RESIDUES + '-.') {
    const color = residueColorFor(scheme, ch, textColor)
    out[ch] = color
    out[ch.toLowerCase()] = color
  }
  return out
}
