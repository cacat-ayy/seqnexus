/**
 * Per-residue scales, the windowed profiles drawn as graph tracks, and the
 * transmembrane rule that reads one of them.
 *
 * One table per scale, keyed by one-letter code; a residue a scale does not
 * know (X, B, Z, stops) is simply absent, and the callers average over the
 * residues that are present.
 */

import { pkaSet } from './properties'
import { CF_HELIX, CF_SHEET, CF_TURN } from './secondary'

/** Kyte J, Doolittle RF (1982) hydropathy. Positive is hydrophobic. */
export const KYTE_DOOLITTLE: Readonly<Record<string, number>> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
}

/** Hopp TP, Woods KR (1981) hydrophilicity. Positive is hydrophilic: the antigenic surface. */
export const HOPP_WOODS: Readonly<Record<string, number>> = {
  R: 3.0, D: 3.0, E: 3.0, K: 3.0, S: 0.3, N: 0.2, Q: 0.2, G: 0.0, P: 0.0, T: -0.4,
  A: -0.5, H: -0.5, C: -1.0, M: -1.3, V: -1.5, I: -1.8, L: -1.8, Y: -2.3, F: -2.5, W: -3.4,
}

/** Eisenberg D, Schwarz E, Komaromy M, Wall R (1984) consensus hydrophobicity. */
export const EISENBERG: Readonly<Record<string, number>> = {
  A: 0.62, R: -2.53, N: -0.78, D: -0.90, C: 0.29, Q: -0.85, E: -0.74, G: 0.48, H: -0.40, I: 1.38,
  L: 1.06, K: -1.50, M: 0.64, F: 1.19, P: 0.12, S: -0.18, T: -0.05, W: 0.81, Y: 0.26, V: 1.08,
}

/** Vihinen M, Torkkila E, Riikonen P (1994) flexibility: normalized B-factors, 1 is average. */
export const VIHINEN_FLEXIBILITY: Readonly<Record<string, number>> = {
  A: 0.984, C: 0.906, D: 1.068, E: 1.094, F: 0.915, G: 1.031, H: 0.950, I: 0.927, K: 1.102, L: 0.935,
  M: 0.952, N: 1.048, P: 1.049, Q: 1.037, R: 1.008, S: 1.046, T: 0.997, V: 0.931, W: 0.904, Y: 0.929,
}

export type ProteinScaleId = 'kd' | 'hopp-woods' | 'eisenberg' | 'charge' | 'flexibility' | 'cf-helix' | 'cf-sheet' | 'cf-turn'

export interface ProteinScale {
  id: ProteinScaleId
  label: string
  /** The caption on the track. */
  short: string
  description: string
  /** Residues the smoothing window spans, by default; always odd. */
  window: number
  /** The guide line's value. */
  mid: number
  /** The plot's extent; values outside are clipped. */
  min: number
  max: number
  /** Above the guide means this. */
  above: string
  below: string
  /** Per-residue values; the charge scale computes its own. */
  table?: Readonly<Record<string, number>>
}

/**
 * The scales on offer. ProtScale's defaults for the windows: 9 for the
 * hydropathy scales (Kyte and Doolittle used 7 to 11 and 19 for membrane
 * spans), 7 for Hopp-Woods (their antigenicity window was 6), 9 for
 * flexibility (Vihinen's window).
 */
export const PROTEIN_SCALES: readonly ProteinScale[] = [
  {
    id: 'kd', label: 'Hydropathy (Kyte-Doolittle)', short: 'Hydropathy',
    description: 'Kyte and Doolittle (1982). Above the line is hydrophobic; a 19-residue window above 1.6 is a membrane span',
    window: 9, mid: 0, min: -4.5, max: 4.5, above: 'hydrophobic', below: 'hydrophilic', table: KYTE_DOOLITTLE,
  },
  {
    id: 'hopp-woods', label: 'Hydrophilicity (Hopp-Woods)', short: 'Hydrophilicity',
    description: 'Hopp and Woods (1981). Peaks are the exposed, likely antigenic stretches',
    window: 7, mid: 0, min: -3.4, max: 3.0, above: 'hydrophilic', below: 'hydrophobic', table: HOPP_WOODS,
  },
  {
    id: 'eisenberg', label: 'Hydrophobicity (Eisenberg)', short: 'Hydrophobicity',
    description: 'Eisenberg consensus scale (1984), normalized; above the line is hydrophobic',
    window: 9, mid: 0, min: -2.53, max: 1.38, above: 'hydrophobic', below: 'hydrophilic', table: EISENBERG,
  },
  {
    id: 'charge', label: 'Charge at pH 7', short: 'Charge',
    description: 'Mean side-chain charge per residue at pH 7 with the EMBOSS pKa values; above the line is positive',
    window: 9, mid: 0, min: -1, max: 1, above: 'positive', below: 'negative',
  },
  {
    id: 'flexibility', label: 'Flexibility (Vihinen)', short: 'Flexibility',
    description: 'Vihinen et al. (1994) normalized B-factors; above 1 is more mobile than average',
    window: 9, mid: 1, min: 0.9, max: 1.1, above: 'flexible', below: 'rigid', table: VIHINEN_FLEXIBILITY,
  },
  // Chou-Fasman propensities. Odd windows centred on each residue, near
  // the 6, 5 and 4 the method nucleates on.
  {
    id: 'cf-helix', label: 'Helix propensity (Chou-Fasman)', short: 'Helix',
    description: 'Chou and Fasman (1978) P(alpha); above 1 favours a helix',
    window: 7, mid: 1, min: 0.5, max: 1.5, above: 'helix-favouring', below: 'helix-breaking', table: CF_HELIX,
  },
  {
    id: 'cf-sheet', label: 'Strand propensity (Chou-Fasman)', short: 'Strand',
    description: 'Chou and Fasman (1978) P(beta); above 1 favours a beta strand',
    window: 5, mid: 1, min: 0.3, max: 1.7, above: 'strand-favouring', below: 'strand-breaking', table: CF_SHEET,
  },
  {
    id: 'cf-turn', label: 'Turn propensity (Chou-Fasman)', short: 'Turn',
    description: 'Chou and Fasman (1978) P(turn); above 1 favours a beta turn',
    window: 5, mid: 1, min: 0.4, max: 1.6, above: 'turn-favouring', below: 'turn-avoiding', table: CF_TURN,
  },
]

export const DEFAULT_PROTEIN_SCALE: ProteinScaleId | 'none' = 'none'

/** The windows a user may pick; every scale defaults to one of them. */
export const SCALE_WINDOWS = [1, 3, 5, 7, 9, 11, 13, 15, 19, 21] as const

export function proteinScale(id: ProteinScaleId): ProteinScale {
  return PROTEIN_SCALES.find(s => s.id === id) ?? PROTEIN_SCALES[0]
}

/** The charge pH every per-residue charge is taken at. */
const CHARGE_PH = 7

/**
 * Each residue's own value on a scale, NaN where the scale has none. The
 * charge scale is Henderson-Hasselbalch on the side chain alone, so a
 * lysine is +1, a histidine about +0.2 at pH 7, an aspartate -1.
 */
export function residueValues(residues: string, scale: ProteinScale): Float32Array {
  const n = residues.length
  const out = new Float32Array(n)
  if (scale.id === 'charge') {
    const set = pkaSet('emboss')
    const positive = (pKa: number) => 1 / (1 + 10 ** (CHARGE_PH - pKa))
    const negative = (pKa: number) => -1 / (1 + 10 ** (pKa - CHARGE_PH))
    const table: Record<string, number> = {
      K: positive(set.K), R: positive(set.R), H: positive(set.H),
      D: negative(set.D), E: negative(set.E), C: negative(set.C), Y: negative(set.Y),
    }
    for (let i = 0; i < n; i++) {
      const ch = residues[i].toUpperCase()
      // Residues without an ionisable side chain are zero, not unknown:
      // the window's mean has to count them.
      out[i] = ch === '*' || ch === '-' || ch === 'X' ? NaN : (table[ch] ?? 0)
    }
    return out
  }
  const table = scale.table!
  for (let i = 0; i < n; i++) {
    const v = table[residues[i].toUpperCase()]
    out[i] = v === undefined ? NaN : v
  }
  return out
}

/**
 * The mean of a scale over a window centred on each residue. The window is
 * cut short at the ends so every residue gets a value (ProtScale leaves the
 * first and last half-windows blank instead), and residues the scale does
 * not know are left out of the mean rather than counted as zero. Two prefix
 * sums make it O(n) whatever the window.
 */
export function windowedProfile(values: Float32Array, window: number): Float32Array {
  const n = values.length
  const out = new Float32Array(n)
  const half = Math.floor(Math.max(1, window) / 2)
  const sum = new Float64Array(n + 1)
  const count = new Uint32Array(n + 1)
  for (let i = 0; i < n; i++) {
    const v = values[i]
    const known = !Number.isNaN(v)
    sum[i + 1] = sum[i] + (known ? v : 0)
    count[i + 1] = count[i] + (known ? 1 : 0)
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    const c = count[b] - count[a]
    out[i] = c > 0 ? (sum[b] - sum[a]) / c : NaN
  }
  return out
}

/** `windowedProfile` of a scale over a protein, in one call. */
export function scaleProfile(residues: string, scale: ProteinScale, window = scale.window): Float32Array {
  return windowedProfile(residueValues(residues, scale), window)
}

/** Kyte and Doolittle's membrane-span rule: this window, above this mean. */
export const TM_WINDOW = 19
export const TM_THRESHOLD = 1.6
/** Spans shorter than this after trimming are not reported. */
const TM_MIN_LENGTH = 15

/**
 * Putative membrane-spanning segments by the rule of Kyte and Doolittle
 * (1982): a 19-residue window whose mean hydropathy exceeds 1.6. Every
 * residue whose window passes marks a candidate; runs of them, widened to
 * the window they were judged by, are the segments, merged where they
 * touch. Provisional by construction: the rule finds the hydrophobic
 * stretches, not whether the protein is in a membrane at all.
 */
export function transmembraneSegments(residues: string): [number, number][] {
  const n = residues.length
  if (n < TM_WINDOW) return []
  const profile = windowedProfile(residueValues(residues, proteinScale('kd')), TM_WINDOW)
  const half = Math.floor(TM_WINDOW / 2)
  const runs: [number, number][] = []
  let i = 0
  while (i < n) {
    if (!(profile[i] > TM_THRESHOLD)) { i++; continue }
    let j = i
    while (j < n && profile[j] > TM_THRESHOLD) j++
    // Only windows that are whole count, so the ends of the protein do not
    // pass on a half window of leucines.
    const a = Math.max(0, i - half)
    const b = Math.min(n, j + half)
    if (i - half >= 0 || j + half <= n) runs.push([a, b])
    i = j
  }
  const merged: [number, number][] = []
  for (const [a, b] of runs) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged.filter(([a, b]) => b - a >= TM_MIN_LENGTH)
}
