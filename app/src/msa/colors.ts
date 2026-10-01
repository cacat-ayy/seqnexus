/**
 * Residue colour schemes for the alignment view.
 *
 * Some schemes colour a residue by what it is (Zappo, Taylor, nucleotides);
 * others by its column (Clustal X colours a residue only where the column is
 * conserved enough, percent identity shades by how many rows share it,
 * BLOSUM62 compares with the consensus). `cellColorer` hides the difference:
 * it takes a residue and its column and returns a colour or null.
 *
 * Colours are plain hex. The view blends them into the theme's canvas colour
 * for cell backgrounds, so one palette reads on light and dark themes.
 */

import { baseColorFor, type ColorSchemeId } from '../utils/base-colors'
import { scoreProtein } from '../alignment/matrices'
import type { AlnKind } from './model'
import { NSYM, type Profile } from './stats'
import type { AlnSchemeId } from './view'

export type CellColorer = (ch: string, col: number) => string | null

// ---------------------------------------------------------------------------
// Residue-only palettes
// ---------------------------------------------------------------------------

function palette(groups: [string, string][]): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const [letters, color] of groups) for (const ch of letters) out[ch] = color
  return out
}

/** Zappo: physicochemical groups. Also used for translations. */
export const ZAPPO = palette([
  ['ILVAM', '#ff9f9f'],
  ['FWY', '#ffc800'],
  ['KRH', '#7f7fff'],
  ['DE', '#ff3b3b'],
  ['STNQ', '#3fd63f'],
  ['PG', '#e055e0'],
  ['C', '#e6e600'],
  ['*', '#e11d48'],
])

export const TAYLOR = palette([
  ['A', '#ccff00'], ['R', '#0000ff'], ['N', '#cc00ff'], ['D', '#ff0000'], ['C', '#ffff00'],
  ['Q', '#ff00cc'], ['E', '#ff0066'], ['G', '#ff9900'], ['H', '#0066ff'], ['I', '#66ff00'],
  ['L', '#33ff00'], ['K', '#6600ff'], ['M', '#00ff00'], ['F', '#00ff66'], ['P', '#ffcc00'],
  ['S', '#ff3300'], ['T', '#ff6600'], ['W', '#00ccff'], ['Y', '#00ffcc'], ['V', '#99ff00'],
])

/** Kyte–Doolittle hydropathy. */
const KYTE_DOOLITTLE: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
}

const HYDROPHOBICITY: Record<string, string> = Object.create(null)
for (const [ch, v] of Object.entries(KYTE_DOOLITTLE)) {
  // Blue (hydrophilic) through grey to red (hydrophobic).
  const t = (v + 4.5) / 9
  const r = Math.round(60 + 195 * t)
  const b = Math.round(255 - 195 * t)
  HYDROPHOBICITY[ch] = rgbHex(r, 70, b)
}

const DNA_BASE_SCHEME: Partial<Record<AlnSchemeId, ColorSchemeId>> = {
  nucleotide: 'nucleotide',
  'clustal-dna': 'clustal',
  'purine-pyrimidine': 'purine-pyrimidine',
  'gc-at': 'gc-at',
}

// ---------------------------------------------------------------------------
// Clustal X
// ---------------------------------------------------------------------------

const CX = {
  blue: '#80a0f0', red: '#f01505', magenta: '#c048c0', green: '#15c015',
  pink: '#f08080', orange: '#f09048', yellow: '#c0c000', cyan: '#15a4a4',
}
const HYDROPHOBIC = 'WLVIMAFCYHP'

/**
 * Clustal X colours for one column (Jalview's rules): each residue type gets
 * its category colour only if the column meets one of that category's
 * conditions. "XY > t" is the share of rows that are X or Y together; "any
 * of X, Y > t" is any single one of them.
 */
function clustalxColumn(p: Profile, col: number): Record<string, string> {
  const o = col * NSYM
  const n = p.rows || 1
  const share = (letters: string) => {
    let k = 0
    for (const ch of letters) k += p.counts[o + ch.charCodeAt(0) - 65]
    return k / n
  }
  const any = (letters: string, t: number) => [...letters].some(ch => p.counts[o + ch.charCodeAt(0) - 65] / n > t)
  const hyd = share(HYDROPHOBIC) > 0.6
  const kr = share('KR') > 0.6
  const qe = share('QE') > 0.5
  const out: Record<string, string> = Object.create(null)
  if (hyd) for (const ch of 'AILMFWV') out[ch] = CX.blue
  if (any('C', 0.85)) out.C = CX.pink
  else if (hyd) out.C = CX.blue
  if (kr || any('KRQ', 0.85)) out.K = out.R = CX.red
  if (kr || qe || share('ED') > 0.5 || any('EQD', 0.85)) out.E = out.D = CX.magenta
  if (share('N') > 0.5 || any('ND', 0.85)) out.N = CX.green
  if (kr || qe || any('QTKR', 0.85)) out.Q = CX.green
  if (hyd || share('TS') > 0.5 || any('ST', 0.85)) out.S = out.T = CX.green
  out.G = CX.orange
  out.P = CX.yellow
  if (hyd || any('WYACPQFHILMV', 0.85)) out.H = out.Y = CX.cyan
  return out
}

// ---------------------------------------------------------------------------
// Colourers
// ---------------------------------------------------------------------------

const IDENTITY_SHADES = ['#5b6cff', '#8f9bff', '#c3c9ff'] // ≥80%, ≥60%, ≥40%

/**
 * A colouring function for one scheme over one profile. `consensusAt` gives
 * the consensus residue of a column, for the schemes that compare with it.
 * The translation scheme is drawn per codon by the view and returns null here.
 */
export function cellColorer(
  scheme: AlnSchemeId,
  kind: AlnKind,
  p: Profile,
  consensusAt: (col: number) => string,
): CellColorer {
  switch (scheme) {
    case 'none':
    case 'translation':
      return () => null
    case 'zappo':
      return ch => ZAPPO[ch] ?? null
    case 'taylor':
      return ch => TAYLOR[ch] ?? null
    case 'hydrophobicity':
      return ch => HYDROPHOBICITY[ch] ?? null
    case 'identity':
      return (ch, col) => {
        if (ch === '-' || p.rows === 0) return null
        const s = ch.charCodeAt(0) - 65
        if (s < 0 || s >= 26) return null
        const f = p.counts[col * NSYM + s] / p.rows
        return f >= 0.8 ? IDENTITY_SHADES[0] : f >= 0.6 ? IDENTITY_SHADES[1] : f >= 0.4 ? IDENTITY_SHADES[2] : null
      }
    case 'blosum62':
      return (ch, col) => {
        if (ch === '-') return null
        const c = consensusAt(col)
        if (c === '-') return null
        if (ch === c) return IDENTITY_SHADES[0]
        return scoreProtein(ch, c) > 0 ? IDENTITY_SHADES[2] : null
      }
    case 'clustalx': {
      const cache = new Map<number, Record<string, string>>()
      return (ch, col) => {
        let cols = cache.get(col)
        if (!cols) { cols = clustalxColumn(p, col); cache.set(col, cols) }
        return cols[ch] ?? null
      }
    }
    default: {
      const base = DNA_BASE_SCHEME[scheme]
      if (kind === 'dna' && base) return ch => baseColorFor(base, ch, '') || null
      return ch => ZAPPO[ch] ?? null
    }
  }
}

/** Colour of an amino acid in the translation strip and "by translation" scheme. */
export function aminoAcidColor(aa: string): string | null {
  return ZAPPO[aa] ?? null
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

function rgbHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** A CSS colour (#rgb, #rrggbb, rgb(), rgba()) as [r, g, b], or null. */
export function parseColor(css: string): [number, number, number] | null {
  const s = css.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return [...m[1]].map(h => parseInt(h + h, 16)) as [number, number, number]
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number]
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

/** `fg` laid over `bg` at `alpha`, as hex. Unparseable input returns `fg`. */
export function blend(fg: string, bg: string, alpha: number): string {
  const a = parseColor(fg)
  const b = parseColor(bg)
  if (!a || !b) return fg
  return rgbHex(a[0] * alpha + b[0] * (1 - alpha), a[1] * alpha + b[1] * (1 - alpha), a[2] * alpha + b[2] * (1 - alpha))
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(css: string): number {
  const c = parseColor(css)
  if (!c) return 1
  const [r, g, b] = c.map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
