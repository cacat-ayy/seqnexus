/**
 * Restriction enzyme database.
 *
 * Each enzyme has a recognition sequence (may contain IUPAC ambiguity codes),
 * cut positions on forward and reverse strands (relative to the recognition
 * site start, 0-based), and overhang type.
 *
 * Cut positions: fwd_cut is the position on the sense strand where the cut
 * occurs (between bases fwd_cut-1 and fwd_cut). rev_cut is the position on
 * the antisense strand (same coordinate system, measured from the 5' end of
 * the sense strand).
 */

export type OverhangType = 'blunt' | '5prime' | '3prime'

export type MethylationSensitivity = 'blocked' | 'impaired' | 'insensitive' | 'unknown'

export interface RestrictionEnzyme {
  name: string
  recognition: string       // IUPAC, always written 5'→3' on sense strand
  fwd_cut: number           // cut position on sense strand
  rev_cut: number           // cut position on antisense strand
  overhang: OverhangType
  suppliers: string[]       // e.g. ['NEB', 'Thermo']
  isoschizomers?: string[]
  /** Sensitivity to dam methylation (GATC) */
  dam?: MethylationSensitivity
  /** Sensitivity to dcm methylation (CCWGG) */
  dcm?: MethylationSensitivity
  /** Sensitivity to CpG methylation */
  cpg?: MethylationSensitivity
  /** Optimal incubation temperature in °C */
  temperature?: number
  /** Heat inactivation temperature in °C, or null if not heat-inactivatable */
  heatInactivation?: number | null
}

// IUPAC ambiguity code expansion
export const IUPAC: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T',
  R: 'AG', Y: 'CT', S: 'GC', W: 'AT',
  K: 'GT', M: 'AC', B: 'CGT', D: 'AGT',
  H: 'ACT', V: 'ACG', N: 'ACGT',
}

/**
 * Convert a recognition sequence with IUPAC codes to a regex pattern.
 * Returns a case-insensitive pattern string.
 */
export function recognitionToRegex(recognition: string): string {
  return recognition.split('').map(c => {
    const expanded = IUPAC[c.toUpperCase()]
    if (!expanded) return c
    if (expanded.length === 1) return expanded
    return `[${expanded}]`
  }).join('')
}

/**
 * Common restriction enzymes - curated set covering the most-used enzymes
 * in molecular cloning, ordered alphabetically.
 */
export const ENZYME_DB: RestrictionEnzyme[] = [
  // --- 6-cutters (common cloning enzymes) ---
  { name: 'BamHI',    recognition: 'GGATCC', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'BglII',    recognition: 'AGATCT', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'ClaI',     recognition: 'ATCGAT', fwd_cut: 2, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'blocked', dcm: 'insensitive', cpg: 'blocked', temperature: 37, heatInactivation: 65 },
  { name: 'EcoRI',    recognition: 'GAATTC', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'EcoRV',    recognition: 'GATATC', fwd_cut: 3, rev_cut: 3, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'impaired', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'HindIII',  recognition: 'AAGCTT', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'KpnI',     recognition: 'GGTACC', fwd_cut: 5, rev_cut: 1, overhang: '3prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'NcoI',     recognition: 'CCATGG', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'blocked', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'NdeI',     recognition: 'CATATG', fwd_cut: 2, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'NheI',     recognition: 'GCTAGC', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'NotI',     recognition: 'GCGGCCGC', fwd_cut: 2, rev_cut: 6, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked', temperature: 37, heatInactivation: 65 },
  { name: 'PstI',     recognition: 'CTGCAG', fwd_cut: 5, rev_cut: 1, overhang: '3prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'SacI',     recognition: 'GAGCTC', fwd_cut: 5, rev_cut: 1, overhang: '3prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'SalI',     recognition: 'GTCGAC', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'SmaI',     recognition: 'CCCGGG', fwd_cut: 3, rev_cut: 3, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'blocked', cpg: 'blocked', temperature: 25, heatInactivation: 65 },
  { name: 'SpeI',     recognition: 'ACTAGT', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'SphI',     recognition: 'GCATGC', fwd_cut: 5, rev_cut: 1, overhang: '3prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'XbaI',     recognition: 'TCTAGA', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'XhoI',     recognition: 'CTCGAG', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'XmaI',     recognition: 'CCCGGG', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB'], isoschizomers: ['SmaI'], dam: 'insensitive', dcm: 'blocked', cpg: 'blocked', temperature: 37, heatInactivation: 65 },

  // --- 8-cutters (rare cutters) ---
  { name: 'AscI',     recognition: 'GGCGCGCC', fwd_cut: 2, rev_cut: 6, overhang: '5prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked', temperature: 37, heatInactivation: 65 },
  { name: 'FseI',     recognition: 'GGCCGGCC', fwd_cut: 6, rev_cut: 2, overhang: '3prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'PacI',     recognition: 'TTAATTAA', fwd_cut: 5, rev_cut: 3, overhang: '3prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'PmeI',     recognition: 'GTTTAAAC', fwd_cut: 4, rev_cut: 4, overhang: 'blunt',  suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'SbfI',     recognition: 'CCTGCAGG', fwd_cut: 6, rev_cut: 2, overhang: '3prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'SwaI',     recognition: 'ATTTAAAT', fwd_cut: 4, rev_cut: 4, overhang: 'blunt',  suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 25, heatInactivation: null },

  // --- 4-cutters (frequent cutters) ---
  { name: 'AluI',     recognition: 'AGCT',   fwd_cut: 2, rev_cut: 2, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'DpnI',     recognition: 'GATC',   fwd_cut: 2, rev_cut: 2, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'HaeIII',   recognition: 'GGCC',   fwd_cut: 2, rev_cut: 2, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 80 },
  { name: 'HhaI',     recognition: 'GCGC',   fwd_cut: 3, rev_cut: 1, overhang: '3prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', cpg: 'blocked', temperature: 37, heatInactivation: 65 },
  { name: 'MboI',     recognition: 'GATC',   fwd_cut: 0, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'blocked', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'MspI',     recognition: 'CCGG',   fwd_cut: 1, rev_cut: 3, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'RsaI',     recognition: 'GTAC',   fwd_cut: 2, rev_cut: 2, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'Sau3AI',   recognition: 'GATC',   fwd_cut: 0, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], isoschizomers: ['MboI'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'TaqI',     recognition: 'TCGA',   fwd_cut: 1, rev_cut: 3, overhang: '5prime', suppliers: ['NEB', 'Thermo'], dam: 'insensitive', dcm: 'insensitive', cpg: 'insensitive', temperature: 65, heatInactivation: 80 },

  // --- Ambiguous recognition (IUPAC) ---
  { name: 'ApoI',     recognition: 'RAATTY', fwd_cut: 1, rev_cut: 5, overhang: '5prime', suppliers: ['NEB'], temperature: 50, heatInactivation: 65 },
  { name: 'BsaBI',    recognition: 'GATNNNNATC', fwd_cut: 5, rev_cut: 5, overhang: 'blunt', suppliers: ['NEB'], temperature: 60, heatInactivation: 80 },
  { name: 'BstNI',    recognition: 'CCWGG',  fwd_cut: 2, rev_cut: 3, overhang: '5prime', suppliers: ['NEB'], dcm: 'insensitive', temperature: 60, heatInactivation: 80 },
  { name: 'DdeI',     recognition: 'CTNAG',  fwd_cut: 1, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], temperature: 37, heatInactivation: 65 },
  { name: 'HincII',   recognition: 'GTYRAC', fwd_cut: 3, rev_cut: 3, overhang: 'blunt',  suppliers: ['NEB', 'Thermo'], temperature: 37, heatInactivation: 65 },
  { name: 'HinfI',    recognition: 'GANTC',  fwd_cut: 1, rev_cut: 4, overhang: '5prime', suppliers: ['NEB', 'Thermo'], temperature: 37, heatInactivation: 65 },

  // --- Golden Gate / Type IIS ---
  { name: 'BbsI',     recognition: 'GAAGAC', fwd_cut: 8, rev_cut: 12, overhang: '5prime', suppliers: ['NEB'], temperature: 37, heatInactivation: 65 },
  { name: 'BsaI',     recognition: 'GGTCTC', fwd_cut: 7, rev_cut: 11, overhang: '5prime', suppliers: ['NEB'], dam: 'insensitive', dcm: 'insensitive', temperature: 37, heatInactivation: 65 },
  { name: 'BsmBI',    recognition: 'CGTCTC', fwd_cut: 7, rev_cut: 11, overhang: '5prime', suppliers: ['NEB'], temperature: 55, heatInactivation: 80 },
  { name: 'BpiI',     recognition: 'GAAGAC', fwd_cut: 8, rev_cut: 12, overhang: '5prime', suppliers: ['Thermo'], isoschizomers: ['BbsI'], temperature: 37, heatInactivation: 65 },
  { name: 'Esp3I',    recognition: 'CGTCTC', fwd_cut: 7, rev_cut: 11, overhang: '5prime', suppliers: ['Thermo'], isoschizomers: ['BsmBI'], temperature: 37, heatInactivation: 65 },
  { name: 'SapI',     recognition: 'GCTCTTC', fwd_cut: 8, rev_cut: 11, overhang: '5prime', suppliers: ['NEB'], temperature: 37, heatInactivation: 65 },
]

// --- Merge with REBASE-generated database ---
import { REBASE_ENZYMES } from './db-generated'

/**
 * Merged enzyme database: hand-curated entries take precedence (they have
 * methylation sensitivity, temperature, and heat inactivation data).
 * REBASE entries are added for enzymes not already in the curated list.
 */
const _curatedNames = new Set(ENZYME_DB.map(e => e.name.toLowerCase()))
for (const re of REBASE_ENZYMES) {
  if (!_curatedNames.has(re.name.toLowerCase())) {
    ENZYME_DB.push(re)
  }
}
ENZYME_DB.sort((a, b) => a.name.localeCompare(b.name))

/** Enzyme groups for the UI filter. */
export const ENZYME_GROUPS: Record<string, string[]> = {
  'Common (6-cutters)': [
    'BamHI', 'BglII', 'ClaI', 'EcoRI', 'EcoRV', 'HindIII', 'KpnI',
    'NcoI', 'NdeI', 'NheI', 'NotI', 'PstI', 'SacI', 'SalI', 'SmaI',
    'SpeI', 'SphI', 'XbaI', 'XhoI',
  ],
  'Rare (8-cutters)': ['AscI', 'FseI', 'NotI', 'PacI', 'PmeI', 'SbfI', 'SwaI'],
  'Frequent (4-cutters)': ['AluI', 'DpnI', 'HaeIII', 'HhaI', 'MboI', 'MspI', 'RsaI', 'Sau3AI', 'TaqI'],
  'Golden Gate (Type IIS)': ['BbsI', 'BsaI', 'BsmBI', 'BpiI', 'Esp3I', 'SapI'],
  'All 6-cutters': ENZYME_DB.filter(e => e.recognition.replace(/[^A-Z]/gi, '').length === 6 && e.fwd_cut <= e.recognition.length).map(e => e.name),
  'All 4-cutters': ENZYME_DB.filter(e => e.recognition.replace(/[^A-Z]/gi, '').length === 4).map(e => e.name),
  'All 8+ cutters': ENZYME_DB.filter(e => e.recognition.replace(/[^A-Z]/gi, '').length >= 8).map(e => e.name),
  'Blunt cutters': ENZYME_DB.filter(e => e.overhang === 'blunt').map(e => e.name),
  "5' overhang": ENZYME_DB.filter(e => e.overhang === '5prime').map(e => e.name),
  "3' overhang": ENZYME_DB.filter(e => e.overhang === '3prime').map(e => e.name),
  'Type IIS': ENZYME_DB.filter(e => e.fwd_cut > e.recognition.length || e.rev_cut > e.recognition.length).map(e => e.name),
}

/** Look up an enzyme by name (case-insensitive). */
export function getEnzyme(name: string): RestrictionEnzyme | undefined {
  return ENZYME_DB.find(e => e.name.toLowerCase() === name.toLowerCase())
}

/**
 * Check if an enzyme's activity is affected by the document's methylation state.
 * Returns 'blocked' if the enzyme cannot cut, 'impaired' if activity is reduced,
 * or null if unaffected.
 */
export function methylationEffect(
  enzyme: RestrictionEnzyme,
  damMethylated?: boolean,
  dcmMethylated?: boolean,
): 'blocked' | 'impaired' | null {
  let dominated: 'blocked' | 'impaired' | null = null
  if (damMethylated && enzyme.dam === 'blocked') return 'blocked'
  if (dcmMethylated && enzyme.dcm === 'blocked') return 'blocked'
  if (damMethylated && enzyme.dam === 'impaired') dominated = 'impaired'
  if (dcmMethylated && enzyme.dcm === 'impaired') dominated = 'impaired'
  return dominated
}
