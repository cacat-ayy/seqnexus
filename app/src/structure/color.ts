/**
 * The colour of each residue of the matched chain, for the structure
 * viewer. Pure, so the choices are testable without WebGL.
 *
 * - Features: a residue takes the colour of the smallest visible feature
 *   covering it (a site inside a domain shows the site), others are
 *   neutral.
 * - Residues: the protein residue colour scheme of the sequence view.
 * - Spectrum: blue at the N terminus to red at the C terminus, along the
 *   chain's residues, the usual way to read a fold's topology.
 * - Confidence: AlphaFold's pLDDT bands in the AlphaFold database's own
 *   colours, read from the B-factor column where AlphaFold writes it.
 *
 * Colours here are data encodings (feature colours, a published palette, a
 * computed hue), not theme decoration; the neutral grey comes from the
 * theme through the caller.
 */

import type { Annotation } from '../models/Annotation'
import type { StructureChain } from './model'
import type { ChainMapping } from './align'

export type StructureColorMode = 'features' | 'residues' | 'chain' | 'spectrum' | 'confidence'

/** AlphaFold DB pLDDT bands: very high, confident, low, very low. */
export const PLDDT_BANDS: readonly { min: number; color: string; label: string }[] = [
  { min: 90, color: '#0053d6', label: 'Very high (pLDDT > 90)' },
  { min: 70, color: '#65cbf3', label: 'Confident (90 > pLDDT > 70)' },
  { min: 50, color: '#ffdb13', label: 'Low (70 > pLDDT > 50)' },
  { min: -Infinity, color: '#ff7d45', label: 'Very low (pLDDT < 50)' },
]

export function plddtColor(b: number): string {
  return PLDDT_BANDS.find(band => b > band.min || band.min === -Infinity)!.color
}

/** Hue 240 (blue) to 0 (red) at full saturation, as hex. */
export function spectrumColor(t: number): string {
  const h = 240 * (1 - Math.max(0, Math.min(1, t)))
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const v = 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export interface ColorInput {
  mode: Exclude<StructureColorMode, 'chain'>
  chain: StructureChain
  mapping: ChainMapping | null
  features: readonly Annotation[]
  /** Protein residue scheme: one-letter code to colour; empty for none. */
  palette: Readonly<Record<string, string>>
  protein: string
  neutral: string
}

/** One colour per residue of the chain, in its residue order. */
export function chainColors(input: ColorInput): string[] {
  const { mode, chain, mapping, neutral } = input
  const n = chain.residues.length
  if (mode === 'confidence') return chain.residues.map(r => plddtColor(r.b))
  if (mode === 'spectrum') return chain.residues.map((_, i) => spectrumColor(n > 1 ? i / (n - 1) : 0))
  if (mode === 'residues') return chain.residues.map(r => input.palette[r.aa] ?? neutral)
  // Features: smallest covering feature of the mapped protein residue.
  const byResidue: (string | null)[] = new Array(input.protein.length).fill(null)
  const span: number[] = new Array(input.protein.length).fill(Infinity)
  for (const a of input.features) {
    const parts = a.segments ?? [[a.start, a.end] as [number, number]]
    const len = a.end - a.start
    for (const [s, e] of parts) {
      for (let i = Math.max(0, s); i < Math.min(e, input.protein.length); i++) {
        if (len < span[i]) { span[i] = len; byResidue[i] = a.color }
      }
    }
  }
  return chain.residues.map((_, j) => {
    const i = mapping ? mapping.toProtein[j] : -1
    return i >= 0 ? byResidue[i] ?? neutral : neutral
  })
}
