/**
 * The reference library a protein is scanned against.
 *
 * Two parts. The coding entries of the built-in DNA library (resistance
 * markers, reporters, fusion partners) translated, so the same GFP that is
 * found on a plasmid is found on its protein. And a curated list of the
 * short peptides a construct carries that no DNA library names as such:
 * epitope and purification tags, protease sites, linkers, localization
 * signals and 2A peptides. Short peptides are matched exactly (a 6-residue
 * tag with one mismatch is not that tag); the long entries take the
 * similarity threshold like DNA features.
 */

import { getCommonFeatures } from './common-features'
import { translateWith, geneticCode } from '../codon/genetic-codes'
import type { ReferenceAnnotation } from './annotate-scan'

export interface ProteinReference extends ReferenceAnnotation {
  category: string
}

/** References shorter than this are matched exactly. */
export const EXACT_BELOW = 10

export const PROTEIN_FEATURE_CATEGORIES = [
  'Tag / Fusion',
  'Protease site',
  'Linker',
  'Localization signal',
  '2A peptide',
  'Reporter',
  'Resistance',
  'Selection Marker',
  'Other',
] as const

// Colours are feature data, as in the DNA library: tags teal, protease
// sites orange, linkers grey, signals violet, 2A peptides pink.
const TAG = '#20c997'
const PROTEASE = '#ff922b'
const LINKER = '#adb5bd'
const SIGNAL = '#845ef7'
const P2A = '#f06595'

type Curated = [name: string, sequence: string, category: string, color: string, type?: string]

const CURATED: Curated[] = [
  // Tags
  ['6xHis', 'HHHHHH', 'Tag / Fusion', TAG],
  ['FLAG', 'DYKDDDDK', 'Tag / Fusion', TAG],
  ['3xFLAG', 'DYKDHDGDYKDHDIDYKDDDDK', 'Tag / Fusion', TAG],
  ['HA', 'YPYDVPDYA', 'Tag / Fusion', TAG],
  ['Myc', 'EQKLISEEDL', 'Tag / Fusion', TAG],
  ['V5', 'GKPIPNPLLGLDST', 'Tag / Fusion', TAG],
  ['Strep-tag II', 'WSHPQFEK', 'Tag / Fusion', TAG],
  ['Twin-Strep-tag', 'WSHPQFEKGGGSGGGSGGSAWSHPQFEK', 'Tag / Fusion', TAG],
  ['S-tag', 'KETAAAKFERQHMDS', 'Tag / Fusion', TAG],
  ['T7 tag', 'MASMTGGQQMG', 'Tag / Fusion', TAG],
  ['AviTag', 'GLNDIFEAQKIEWHE', 'Tag / Fusion', TAG],
  ['ALFA-tag', 'SRLEEELRRRLTE', 'Tag / Fusion', TAG],
  ['HiBiT', 'VSGWRLFKKIS', 'Tag / Fusion', TAG],
  ['SpyTag', 'AHIVMVDAYKPTK', 'Tag / Fusion', TAG],
  ['SnoopTag', 'KLGDIEFIKVNK', 'Tag / Fusion', TAG],
  ['E-tag', 'GAPVPYPDPLEPR', 'Tag / Fusion', TAG],
  ['Spot-tag', 'PDRVRAVSHWSS', 'Tag / Fusion', TAG],
  ['VSV-G tag', 'YTDIEMNRLGK', 'Tag / Fusion', TAG],
  ['Softag 3', 'TQDPSRVG', 'Tag / Fusion', TAG],
  ['Xpress tag', 'DLYDDDDK', 'Tag / Fusion', TAG],
  // Protease sites
  ['TEV site', 'ENLYFQG', 'Protease site', PROTEASE, 'Site'],
  ['TEV site (S)', 'ENLYFQS', 'Protease site', PROTEASE, 'Site'],
  ['Thrombin site', 'LVPRGS', 'Protease site', PROTEASE, 'Site'],
  ['HRV 3C / PreScission site', 'LEVLFQGP', 'Protease site', PROTEASE, 'Site'],
  ['Enterokinase site', 'DDDDK', 'Protease site', PROTEASE, 'Site'],
  ['Factor Xa site', 'IEGR', 'Protease site', PROTEASE, 'Site'],
  ['Factor Xa site (IDGR)', 'IDGR', 'Protease site', PROTEASE, 'Site'],
  // Linkers
  ['(GGGGS)3 linker', 'GGGGSGGGGSGGGGS', 'Linker', LINKER],
  ['(GGGGS)2 linker', 'GGGGSGGGGS', 'Linker', LINKER],
  ['(EAAAK)3 linker', 'EAAAKEAAAKEAAAK', 'Linker', LINKER],
  // Localization signals
  ['SV40 NLS', 'PKKKRKV', 'Localization signal', SIGNAL],
  ['Nucleoplasmin NLS', 'KRPAATKKAGQAKKKK', 'Localization signal', SIGNAL],
  ['c-Myc NLS', 'PAAKRVKLD', 'Localization signal', SIGNAL],
  ['HIV-1 Rev NES', 'LQLPPLERLTL', 'Localization signal', SIGNAL],
  ['PKI NES', 'LALKLAGLDI', 'Localization signal', SIGNAL],
  ['KDEL', 'KDEL', 'Localization signal', SIGNAL],
  ['HDEL', 'HDEL', 'Localization signal', SIGNAL],
  ['SKL (PTS1)', 'SKL', 'Localization signal', SIGNAL],
  // 2A peptides
  ['P2A', 'ATNFSLLKQAGDVEENPGP', '2A peptide', P2A],
  ['T2A', 'EGRGSLLTCGDVEENPGP', '2A peptide', P2A],
  ['E2A', 'QCTNYALLKLAGDVESNPGP', '2A peptide', P2A],
  ['F2A', 'VKQTLNFDLLKLAGDVESNPGP', '2A peptide', P2A],
]

let _cache: ProteinReference[] | null = null

/** The protein library: curated peptides first, then the translated coding entries. */
export function getProteinFeatures(): ProteinReference[] {
  if (_cache) return _cache
  const out: ProteinReference[] = CURATED.map(([name, sequence, category, color, type]) => ({
    name, sequence, category, color, type: type ?? 'Region',
  }))
  const seen = new Set(out.map(r => r.sequence))
  const code = geneticCode(1)
  for (const f of getCommonFeatures()) {
    if (f.type !== 'CDS') continue
    let aa = translateWith(code, f.sequence)
    if (aa.endsWith('*')) aa = aa.slice(0, -1)
    // A reading frame with a stop or an ambiguous codon is not a protein.
    if (aa.length < EXACT_BELOW || aa.includes('*') || aa.includes('?')) continue
    if (seen.has(aa)) continue
    seen.add(aa)
    out.push({ name: f.name, type: 'Region', sequence: aa, color: f.color, category: f.category })
  }
  _cache = out
  return out
}

/** The category of a reference by name and type, for the results filter. */
export function proteinCategoryOf(name: string, type: string): string | undefined {
  return getProteinFeatures().find(r => r.name === name && r.type === type)?.category
}
