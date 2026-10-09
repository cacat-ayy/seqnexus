/**
 * Physical properties of a protein from its sequence: mass, formula,
 * isoelectric point and charge, absorbance at 280 nm, and the sequence
 * indices (GRAVY, aliphatic, instability, aromaticity).
 *
 * Everything here is a pure function of the residues (plus the number of
 * disulfide bonds for the extinction coefficient), O(n), so the panel can
 * recompute it for every selection without a worker. The constants and the
 * methods follow ExPASy ProtParam, which is what the numbers are checked
 * against in the tests; the README says where each one comes from.
 */

import { KYTE_DOOLITTLE } from './scales'

// ---------------------------------------------------------------------------
// Masses and formulas
// ---------------------------------------------------------------------------

/**
 * Residue masses (the amino acid less one water), average and monoisotopic,
 * in Da. Selenocysteine and pyrrolysine included. The ambiguity codes take
 * the mean of what they stand for; X takes the mean of the twenty.
 */
const AVERAGE: Readonly<Record<string, number>> = {
  A: 71.0788, R: 156.1875, N: 114.1038, D: 115.0886, C: 103.1388, E: 129.1155, Q: 128.1307,
  G: 57.0519, H: 137.1411, I: 113.1594, L: 113.1594, K: 128.1741, M: 131.1926, F: 147.1766,
  P: 97.1167, S: 87.0782, T: 101.1051, W: 186.2132, Y: 163.1760, V: 99.1326,
  U: 150.0388, O: 237.3018,
}
const MONOISOTOPIC: Readonly<Record<string, number>> = {
  A: 71.03711, R: 156.10111, N: 114.04293, D: 115.02694, C: 103.00919, E: 129.04259, Q: 128.05858,
  G: 57.02146, H: 137.05891, I: 113.08406, L: 113.08406, K: 128.09496, M: 131.04049, F: 147.06841,
  P: 97.05276, S: 87.03203, T: 101.04768, W: 186.07931, Y: 163.06333, V: 99.06841,
  U: 150.95363, O: 237.14773,
}
const WATER_AVERAGE = 18.01524
const WATER_MONO = 18.01056

const STANDARD = 'ACDEFGHIKLMNPQRSTVWY'

function meanOf(table: Readonly<Record<string, number>>, letters: string): number {
  let s = 0
  for (const ch of letters) s += table[ch]
  return s / letters.length
}

/** The mass of one residue under a table, with the ambiguity codes resolved. */
function residueMass(table: Readonly<Record<string, number>>, ch: string): number | null {
  const m = table[ch]
  if (m !== undefined) return m
  switch (ch) {
    case 'B': return meanOf(table, 'DN')
    case 'Z': return meanOf(table, 'EQ')
    case 'J': return table.I
    case 'X': return meanOf(table, STANDARD)
    default: return null // a stop, a gap
  }
}

export interface Mass {
  /** Average mass in Da, water included. */
  average: number
  /** Monoisotopic mass in Da. */
  monoisotopic: number
}

/** Mass of a chain. Stops and gaps weigh nothing; an empty chain is one water. */
export function proteinMass(residues: string): Mass {
  let avg = 0
  let mono = 0
  let any = false
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    const a = residueMass(AVERAGE, ch)
    if (a === null) continue
    avg += a
    mono += residueMass(MONOISOTOPIC, ch) ?? 0
    any = true
  }
  if (!any) return { average: 0, monoisotopic: 0 }
  return { average: avg + WATER_AVERAGE, monoisotopic: mono + WATER_MONO }
}

/** Residue formulas (amino acid less water): [C, H, N, O, S, Se]. */
const FORMULA: Readonly<Record<string, [number, number, number, number, number, number]>> = {
  A: [3, 5, 1, 1, 0, 0], R: [6, 12, 4, 1, 0, 0], N: [4, 6, 2, 2, 0, 0], D: [4, 5, 1, 3, 0, 0],
  C: [3, 5, 1, 1, 1, 0], E: [5, 7, 1, 3, 0, 0], Q: [5, 8, 2, 2, 0, 0], G: [2, 3, 1, 1, 0, 0],
  H: [6, 7, 3, 1, 0, 0], I: [6, 11, 1, 1, 0, 0], L: [6, 11, 1, 1, 0, 0], K: [6, 12, 2, 1, 0, 0],
  M: [5, 9, 1, 1, 1, 0], F: [9, 9, 1, 1, 0, 0], P: [5, 7, 1, 1, 0, 0], S: [3, 5, 1, 2, 0, 0],
  T: [4, 7, 1, 2, 0, 0], W: [11, 10, 2, 1, 0, 0], Y: [9, 9, 1, 2, 0, 0], V: [5, 9, 1, 1, 0, 0],
  U: [3, 5, 1, 1, 0, 1], O: [12, 19, 3, 2, 0, 0],
}

export interface Formula { C: number; H: number; N: number; O: number; S: number; Se: number; atoms: number }

/**
 * Elemental composition, water included. Residues without a fixed formula
 * (B, Z, X, J) are left out, so a sequence with them is reported short.
 */
export function proteinFormula(residues: string): Formula {
  const f: Formula = { C: 0, H: 2, N: 0, O: 1, S: 0, Se: 0, atoms: 0 }
  let any = false
  for (const raw of residues) {
    const ch = raw.toUpperCase() === 'J' ? 'I' : raw.toUpperCase()
    const r = FORMULA[ch]
    if (!r) continue
    any = true
    f.C += r[0]; f.H += r[1]; f.N += r[2]; f.O += r[3]; f.S += r[4]; f.Se += r[5]
  }
  if (!any) { f.H = 0; f.O = 0 }
  f.atoms = f.C + f.H + f.N + f.O + f.S + f.Se
  return f
}

/** "C606H972N168O178S7", elements with a count of zero left out. */
export function formatFormula(f: Formula): string {
  return (['C', 'H', 'N', 'O', 'S', 'Se'] as const).filter(e => f[e] > 0).map(e => `${e}${f[e]}`).join('')
}

// ---------------------------------------------------------------------------
// Charge and isoelectric point
// ---------------------------------------------------------------------------

export type PkaSetId = 'emboss' | 'bjellqvist' | 'lehninger' | 'grimsley'

export interface PkaSet {
  id: PkaSetId
  label: string
  description: string
  /** N-terminal amine, C-terminal carboxyl, then the ionisable side chains. */
  nTerm: number
  cTerm: number
  C: number; D: number; E: number; H: number; K: number; R: number; Y: number
}

/**
 * The pKa sets on offer. Which one a tool uses is most of why two pI
 * calculators disagree, so the set is a visible choice, EMBOSS by default
 * since that is what the `iep` program every lab has used reports.
 */
export const PKA_SETS: readonly PkaSet[] = [
  {
    id: 'emboss', label: 'EMBOSS', description: 'The pKa values of the EMBOSS iep program',
    nTerm: 8.6, cTerm: 3.6, C: 8.5, D: 3.9, E: 4.1, H: 6.5, K: 10.8, R: 12.5, Y: 10.1,
  },
  {
    id: 'bjellqvist', label: 'Bjellqvist (ExPASy)', description: 'Bjellqvist et al. (1993), as ExPASy Compute pI uses them',
    nTerm: 7.5, cTerm: 3.55, C: 9.0, D: 4.05, E: 4.45, H: 5.98, K: 10.0, R: 12.0, Y: 10.0,
  },
  {
    id: 'lehninger', label: 'Lehninger', description: 'Textbook values of the free amino acids',
    nTerm: 9.69, cTerm: 2.34, C: 8.18, D: 3.65, E: 4.25, H: 6.00, K: 10.53, R: 12.48, Y: 10.07,
  },
  {
    id: 'grimsley', label: 'Grimsley', description: 'Grimsley et al. (2009): averages measured in folded proteins',
    nTerm: 7.7, cTerm: 3.3, C: 6.8, D: 3.5, E: 4.2, H: 6.6, K: 10.5, R: 12.04, Y: 10.3,
  },
]

export const DEFAULT_PKA_SET: PkaSetId = 'emboss'

export function pkaSet(id: PkaSetId): PkaSet {
  return PKA_SETS.find(s => s.id === id) ?? PKA_SETS[0]
}

/**
 * Bjellqvist's N-terminal pKa depends on the first residue, and the
 * C-terminal one on the last (ExPASy applies these; the main table is the
 * generic value).
 */
const BJELLQVIST_NTERM: Readonly<Record<string, number>> = { A: 7.59, M: 7.0, S: 6.93, P: 8.36, T: 6.82, V: 7.44, E: 7.7 }
const BJELLQVIST_CTERM: Readonly<Record<string, number>> = { D: 4.55, E: 4.75 }

/** Counts of the ionisable residues, and the terminal residues. */
export interface ChargeGroups {
  C: number; D: number; E: number; H: number; K: number; R: number; Y: number
  first: string
  last: string
  /** No residues at all: no termini either. */
  empty: boolean
}

export function chargeGroups(residues: string): ChargeGroups {
  const g: ChargeGroups = { C: 0, D: 0, E: 0, H: 0, K: 0, R: 0, Y: 0, first: '', last: '', empty: true }
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    if (ch === '*' || ch === '-') continue
    if (g.empty) { g.first = ch; g.empty = false }
    g.last = ch
    if (ch in g && ch.length === 1 && 'CDEHKRY'.includes(ch)) g[ch as 'C']++
  }
  return g
}

/**
 * Net charge at a pH by Henderson-Hasselbalch over every ionisable group:
 * each basic group contributes its fraction protonated, each acidic group
 * minus its fraction deprotonated.
 */
export function netCharge(groups: ChargeGroups, pH: number, set: PkaSet): number {
  if (groups.empty) return 0
  const positive = (n: number, pKa: number) => n / (1 + 10 ** (pH - pKa))
  const negative = (n: number, pKa: number) => -n / (1 + 10 ** (pKa - pH))
  const nTerm = set.id === 'bjellqvist' ? (BJELLQVIST_NTERM[groups.first] ?? set.nTerm) : set.nTerm
  const cTerm = set.id === 'bjellqvist' ? (BJELLQVIST_CTERM[groups.last] ?? set.cTerm) : set.cTerm
  return positive(1, nTerm) + positive(groups.K, set.K) + positive(groups.R, set.R) + positive(groups.H, set.H)
    + negative(1, cTerm) + negative(groups.D, set.D) + negative(groups.E, set.E)
    + negative(groups.C, set.C) + negative(groups.Y, set.Y)
}

/** The pH at which the net charge is zero, by bisection on [0, 14] to 0.001. */
export function isoelectricPoint(groups: ChargeGroups, set: PkaSet): number | null {
  if (groups.empty) return null
  let lo = 0
  let hi = 14
  // Charge falls monotonically with pH.
  if (netCharge(groups, lo, set) < 0) return lo
  if (netCharge(groups, hi, set) > 0) return hi
  while (hi - lo > 0.001) {
    const mid = (lo + hi) / 2
    if (netCharge(groups, mid, set) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Net charge at each pH from 0 to 14, for the titration curve. */
export function chargeCurve(groups: ChargeGroups, set: PkaSet, step = 0.1): { pH: number; charge: number }[] {
  const out: { pH: number; charge: number }[] = []
  for (let i = 0; i <= Math.round(14 / step); i++) {
    const pH = i * step
    out.push({ pH, charge: netCharge(groups, pH, set) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Absorbance at 280 nm
// ---------------------------------------------------------------------------

/** Pace et al. (1995): per Trp, per Tyr, per cystine, in M⁻¹ cm⁻¹. */
const EPS_W = 5500
const EPS_Y = 1490
const EPS_CYSTINE = 125

export interface Extinction {
  /** Every Cys reduced: Trp and Tyr only. */
  reduced: number
  /** Every pair of Cys as a cystine. */
  allCystine: number
  /** The disulfides the document annotates. */
  annotated: number
  /** Absorbance of a 1 mg/mL (0.1 percent) solution for each, 1 cm path. */
  a280Reduced: number
  a280AllCystine: number
  a280Annotated: number
}

export function extinction(residues: string, disulfides: number, averageMass: number): Extinction {
  let w = 0, y = 0, c = 0
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    if (ch === 'W') w++
    else if (ch === 'Y') y++
    else if (ch === 'C') c++
  }
  const base = w * EPS_W + y * EPS_Y
  const reduced = base
  const allCystine = base + Math.floor(c / 2) * EPS_CYSTINE
  const annotated = base + Math.min(Math.floor(c / 2), disulfides) * EPS_CYSTINE
  const a = (eps: number) => (averageMass > 0 ? eps / averageMass : 0)
  return {
    reduced, allCystine, annotated,
    a280Reduced: a(reduced), a280AllCystine: a(allCystine), a280Annotated: a(annotated),
  }
}

// ---------------------------------------------------------------------------
// Indices
// ---------------------------------------------------------------------------

/** Grand average of hydropathy: the mean Kyte-Doolittle value over the residues that have one. */
export function gravy(residues: string): number | null {
  let s = 0
  let n = 0
  for (const raw of residues) {
    const v = KYTE_DOOLITTLE[raw.toUpperCase()]
    if (v === undefined) continue
    s += v
    n++
  }
  return n === 0 ? null : s / n
}

/**
 * Aliphatic index (Ikai 1980): the relative volume of aliphatic side chains,
 * X(Ala) + 2.9 X(Val) + 3.9 (X(Ile) + X(Leu)) in mole percent.
 */
export function aliphaticIndex(residues: string): number | null {
  let a = 0, v = 0, il = 0, n = 0
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    if (!STANDARD.includes(ch)) continue
    n++
    if (ch === 'A') a++
    else if (ch === 'V') v++
    else if (ch === 'I' || ch === 'L') il++
  }
  if (n === 0) return null
  return (100 / n) * (a + 2.9 * v + 3.9 * il)
}

/** Fraction of Phe, Trp and Tyr. */
export function aromaticity(residues: string): number | null {
  let k = 0, n = 0
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    if (!STANDARD.includes(ch)) continue
    n++
    if (ch === 'F' || ch === 'W' || ch === 'Y') k++
  }
  return n === 0 ? null : k / n
}

/**
 * Dipeptide instability weight values of Guruprasad, Reddy and Pandit
 * (1990), first residue by row. A pair not in the table weighs 1.
 */
const DIWV: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  A: { C: 44.94, D: -7.49, H: -7.49, P: 20.26 },
  C: { D: 20.26, H: 33.60, L: 20.26, M: 33.60, P: 20.26, Q: -6.54, T: 33.60, V: -6.54, W: 24.68 },
  D: { F: -6.54, K: -7.49, R: -6.54, S: 20.26, T: -14.03 },
  E: { C: 44.94, D: 20.26, E: 33.60, H: -6.54, I: 20.26, P: 20.26, Q: 20.26, S: 20.26, W: -14.03 },
  F: { D: 13.34, K: -14.03, P: 20.26, Y: 33.601 },
  G: { A: -7.49, E: -6.54, G: 13.34, I: -7.49, K: -7.49, N: -7.49, T: -7.49, W: 13.34, Y: -7.49 },
  H: { F: -9.37, G: -9.37, I: 44.94, K: 24.68, N: 24.68, P: -1.88, T: -6.54, W: -1.88, Y: 44.94 },
  I: { E: 44.94, H: 13.34, K: -7.49, L: 20.26, P: -1.88, V: -7.49 },
  K: { G: -7.49, I: -7.49, L: -7.49, M: 33.60, P: -6.54, Q: 24.64, R: 33.60, V: -7.49 },
  L: { K: -7.49, P: 20.26, Q: 33.60, R: 20.26, W: 24.68 },
  M: { A: 13.34, H: 58.28, M: -1.88, P: 44.94, Q: -6.54, R: -6.54, S: 44.94, T: -1.88, Y: 24.68 },
  N: { C: -1.88, F: -14.03, G: -14.03, I: 44.94, K: 24.68, P: -1.88, Q: -6.54, T: -7.49, W: -9.37 },
  P: { A: 20.26, C: -6.54, D: -6.54, E: 18.38, F: 20.26, M: -6.54, P: 20.26, Q: 20.26, R: -6.54, S: 20.26, V: 20.26, W: -1.88 },
  Q: { C: -6.54, D: 20.26, E: 20.26, F: -6.54, P: 20.26, Q: 20.26, S: 44.94, V: -6.54, Y: -6.54 },
  R: { G: -7.49, H: 20.26, N: 13.34, P: 20.26, Q: 20.26, R: 58.28, S: 44.94, W: 58.28, Y: -6.54 },
  S: { C: 33.60, E: 20.26, P: 44.94, Q: 20.26, R: 20.26, S: 20.26 },
  T: { E: 20.26, F: 13.34, G: -7.49, N: -14.03, Q: -6.54, W: -14.03 },
  V: { D: -14.03, G: -7.49, K: -1.88, P: 20.26, T: -7.49, Y: -6.54 },
  W: { A: -14.03, G: -9.37, H: 24.68, L: 13.34, M: 24.68, N: 13.34, T: -14.03, V: -7.49 },
  Y: { A: 24.68, D: 24.68, E: -6.54, G: -7.49, H: 13.34, M: 44.94, P: 13.34, R: -15.91, T: -7.49, W: -9.37, Y: 13.34 },
}

/**
 * Instability index (Guruprasad et al. 1990): 10/L times the sum of the
 * dipeptide weights. Below 40 predicts a stable protein in vivo. Residues
 * outside the twenty break the chain of dipeptides and are skipped.
 */
export function instabilityIndex(residues: string): number | null {
  const chain: string[] = []
  for (const raw of residues) {
    const ch = raw.toUpperCase()
    if (STANDARD.includes(ch)) chain.push(ch)
  }
  if (chain.length < 2) return null
  let sum = 0
  for (let i = 0; i + 1 < chain.length; i++) sum += DIWV[chain[i]]?.[chain[i + 1]] ?? 1
  return (10 / chain.length) * sum
}

// ---------------------------------------------------------------------------
// Everything at once, for the panel
// ---------------------------------------------------------------------------

export interface ProteinProperties {
  length: number
  mass: Mass
  formula: Formula
  groups: ChargeGroups
  pI: number | null
  chargeAt7: number
  extinction: Extinction
  gravy: number | null
  aliphatic: number | null
  instability: number | null
  aromaticity: number | null
  /** Asp + Glu, Arg + Lys. */
  negative: number
  positive: number
}

export function proteinProperties(residues: string, disulfides: number, set: PkaSet): ProteinProperties {
  const mass = proteinMass(residues)
  const groups = chargeGroups(residues)
  let length = 0
  for (const ch of residues) if (ch !== '*' && ch !== '-') length++
  return {
    length,
    mass,
    formula: proteinFormula(residues),
    groups,
    pI: isoelectricPoint(groups, set),
    chargeAt7: netCharge(groups, 7, set),
    extinction: extinction(residues, disulfides, mass.average),
    gravy: gravy(residues),
    aliphatic: aliphaticIndex(residues),
    instability: instabilityIndex(residues),
    aromaticity: aromaticity(residues),
    negative: groups.D + groups.E,
    positive: groups.K + groups.R,
  }
}

/** "13.7 kDa" or "856.9 Da". */
export function formatMass(daltons: number, digits = 1): string {
  if (daltons >= 1000) return `${(daltons / 1000).toFixed(digits)} kDa`
  return `${daltons.toFixed(1)} Da`
}
