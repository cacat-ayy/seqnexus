/**
 * Sequence motifs: PROSITE patterns, a curated library of them, and the scan
 * that finds every (overlapping) occurrence in a protein.
 *
 * The library is deliberately short. PROSITE's full pattern set finds a
 * "site" every few residues of any protein, which is why its own tools hide
 * the frequent patterns by default. What is kept here is what a lab looks
 * for on a construct: modification and processing sites, targeting signals,
 * the classic binding and catalytic signatures, and the sequence liabilities
 * a developability review flags. Each entry names where its pattern comes
 * from.
 */

export const MOTIF_CATEGORIES = [
  'Modification site',
  'Processing site',
  'Targeting signal',
  'Binding and catalytic',
  'Structural',
  'Liability',
] as const

export type MotifCategory = typeof MOTIF_CATEGORIES[number]

export interface MotifDefinition {
  id: string
  name: string
  category: MotifCategory
  /** PROSITE notation. */
  pattern: string
  /** The PROSITE accession, or the paper the pattern is taken from. */
  source: string
  /** The feature type a hit becomes. */
  type: string
  /** Feature colour: data, as in the DNA library. */
  color: string
  description: string
}

export interface MotifHit {
  motifId: string
  name: string
  category: MotifCategory
  type: string
  color: string
  /** 0-based, half-open residues. */
  start: number
  end: number
  /** The residues matched. */
  sequence: string
}

// Colours per category, as the DNA library gives each class its own.
const MODIFICATION = '#3bc9db'
const PROCESSING = '#ff922b'
const TARGETING = '#845ef7'
const BINDING = '#fab005'
const STRUCTURAL = '#74b816'
const LIABILITY = '#ff6b6b'

type Row = [id: string, name: string, category: MotifCategory, pattern: string, source: string, type: string, description: string]

const ROWS: Row[] = [
  // Modification sites
  ['n-glyc', 'N-glycosylation site', 'Modification site', 'N-{P}-[ST]-{P}', 'PROSITE PS00001', 'glycosylation',
    'The Asn-X-Ser/Thr sequon, X not Pro; glycosylated when accessible in the ER'],
  ['gag', 'Glycosaminoglycan attachment site', 'Modification site', 'S-G-x-G', 'PROSITE PS00002', 'modified_residue',
    'Ser-Gly-X-Gly, where a proteoglycan chain may be attached'],
  ['pka', 'cAMP/cGMP kinase phosphorylation site', 'Modification site', '[RK](2)-x-[ST]', 'PROSITE PS00004', 'modified_residue',
    'Two basic residues, one spacer, then the Ser or Thr phosphorylated by PKA or PKG'],
  ['pkc', 'Protein kinase C phosphorylation site', 'Modification site', '[ST]-x-[RK]', 'PROSITE PS00005', 'modified_residue',
    'Ser or Thr with a basic residue two positions on'],
  ['ck2', 'Casein kinase II phosphorylation site', 'Modification site', '[ST]-x(2)-[DE]', 'PROSITE PS00006', 'modified_residue',
    'Ser or Thr with an acidic residue at +3'],
  ['tyr-kinase', 'Tyrosine kinase phosphorylation site', 'Modification site', '[RK]-x(2,3)-[DE]-x(2,3)-Y', 'PROSITE PS00007', 'modified_residue',
    'A basic residue, an acidic one, then the Tyr'],
  ['myr', 'N-myristoylation site', 'Modification site', 'G-{EDRKHPFYW}-x(2)-[STAGCN]-{P}', 'PROSITE PS00008', 'modified_residue',
    'Gly in a context N-myristoyltransferase accepts; only an N-terminal Gly (after Met removal) is modified'],
  ['amid', 'Amidation site', 'Modification site', 'x-G-[RK]-[RK]', 'PROSITE PS00009', 'modified_residue',
    'The residue before Gly-basic-basic is amidated in peptide hormones'],
  ['sumo', 'Sumoylation site', 'Modification site', '[VILMAFP]-K-x-[DE]', 'Rodriguez et al. (2001)', 'modified_residue',
    'The psi-Lys-X-Asp/Glu consensus'],
  ['caax', 'Prenylation site (CAAX box)', 'Modification site', 'C-{DENQ}-[LIVM]-x>', 'PROSITE PS00294', 'modified_residue',
    'C-terminal Cys-aliphatic-aliphatic-X, farnesylated or geranylgeranylated'],
  // Processing sites
  ['furin', 'Furin cleavage site', 'Processing site', 'R-x-[KR]-R', 'Hosaka et al. (1991)', 'Site',
    'Arg-X-Lys/Arg-Arg, cut after the last Arg by furin and related convertases'],
  ['caspase3', 'Caspase-3/7 cleavage site', 'Processing site', 'D-E-V-D', 'Thornberry et al. (1997)', 'Site',
    'DEVD, cut after the second Asp'],
  ['dp-acid', 'Acid-labile Asp-Pro bond', 'Processing site', 'D-P', 'Piszkiewicz et al. (1970)', 'Site',
    'Asp-Pro, hydrolysed at low pH and in heated samples'],
  // Targeting signals
  ['nls-mono', 'Monopartite nuclear localization signal', 'Targeting signal', 'K-[KR]-x-[KR]', 'Chelsky et al. (1989)', 'Motif',
    'The classic K-K/R-X-K/R of SV40 large T type signals'],
  ['nls-bi', 'Bipartite nuclear localization signal', 'Targeting signal', '[KR](2)-x(10,12)-[KR](3,5)', 'Dingwall and Laskey (1991)', 'Motif',
    'Two basic residues, a ten to twelve residue spacer, then three to five basic residues'],
  ['er-ret', 'ER retention signal', 'Targeting signal', '[KRHQSA]-[DENQ]-E-L>', 'PROSITE PS00014', 'Motif',
    'C-terminal KDEL and its variants, retrieved to the ER'],
  ['pts1', 'Peroxisomal targeting signal (PTS1)', 'Targeting signal', '[STAGCN]-[RKH]-[LIVMAFY]>', 'PROSITE PS00342', 'Motif',
    'The C-terminal SKL tripeptide and its variants'],
  ['rgd', 'Cell attachment sequence (RGD)', 'Targeting signal', 'R-G-D', 'PROSITE PS00016', 'Motif',
    'Arg-Gly-Asp, bound by integrins'],
  // Binding and catalytic
  ['p-loop', 'ATP/GTP-binding site motif A (P-loop)', 'Binding and catalytic', '[AG]-x(4)-G-K-[ST]', 'PROSITE PS00017', 'binding_site',
    'The Walker A motif of nucleotide-binding proteins'],
  ['ef-hand', 'EF-hand calcium-binding domain', 'Binding and catalytic', 'D-x-[DNS]-{ILVFYW}-[DENSTG]-[DNQGHRK]-{GP}-[LIVMC]-[DENQSTAGC]-x(2)-[DE]-[LIVMFYW]', 'PROSITE PS00018', 'binding_site',
    'The twelve-residue calcium-binding loop'],
  ['zf-c2h2', 'Zinc finger, C2H2 type', 'Binding and catalytic', 'C-x(2,4)-C-x(3)-[LIVMFYWC]-x(8)-H-x(3,5)-H', 'PROSITE PS00028', 'Domain',
    'Two Cys and two His around a zinc ion'],
  ['trypsin-his', 'Serine protease, trypsin family, His active site', 'Binding and catalytic', '[LIVM]-[ST]-A-[STAG]-H-C', 'PROSITE PS00134', 'active_site',
    'The histidine of the catalytic triad'],
  ['trypsin-ser', 'Serine protease, trypsin family, Ser active site', 'Binding and catalytic', '[DNSTAGC]-[GSTAPIMVQH]-x(2)-G-[DE]-S-G-[GS]-[SAPHV]-[LIVMFYWH]-[LIVMFYSTANQ]', 'PROSITE PS00135', 'active_site',
    'The GDSGG serine of the catalytic triad'],
  ['cys-protease', 'Cysteine protease, Cys active site', 'Binding and catalytic', 'Q-x(3)-[GE]-x-C-[YW]-x(2)-[STAGC]-[STAGCV]', 'PROSITE PS00139', 'active_site',
    'The catalytic cysteine of papain-like proteases'],
  // Structural
  ['leucine-zipper', 'Leucine zipper', 'Structural', 'L-x(6)-L-x(6)-L-x(6)-L', 'PROSITE PS00029', 'Motif',
    'Leucines every seventh residue over four heptads'],
  // Liabilities
  ['deamid', 'Deamidation site (Asn-Gly)', 'Liability', 'N-[GS]', 'Robinson and Robinson (2001)', 'Site',
    'Asn before Gly or Ser deamidates fastest; a charge change and a heterogeneity source'],
  ['isoasp', 'Asp isomerization site', 'Liability', 'D-[GS]', 'Geiger and Clarke (1987)', 'Site',
    'Asp before Gly or Ser forms isoaspartate through a succinimide'],
  ['oxidation', 'Oxidation-prone Met-Trp', 'Liability', '[MW]-[MW]', 'Developability reviews', 'Site',
    'Adjacent Met or Trp: a pair is more often exposed and oxidised than a lone residue'],
  ['glycation', 'Glycation-prone lysine', 'Liability', 'K-[KRDE]', 'Developability reviews', 'Site',
    'Lys beside a basic or acidic residue reacts with reducing sugars'],
]

export const MOTIF_LIBRARY: readonly MotifDefinition[] = ROWS.map(([id, name, category, pattern, source, type, description]) => ({
  id, name, category, pattern, source, type, description,
  color: category === 'Modification site' ? MODIFICATION
    : category === 'Processing site' ? PROCESSING
    : category === 'Targeting signal' ? TARGETING
    : category === 'Binding and catalytic' ? BINDING
    : category === 'Structural' ? STRUCTURAL
    : LIABILITY,
}))

export function motifDefinition(id: string): MotifDefinition | undefined {
  return MOTIF_LIBRARY.find(m => m.id === id)
}

/**
 * A PROSITE pattern as a regular expression source.
 *
 * Elements are separated by hyphens; `x` is any residue, `[ABC]` one of,
 * `{ABC}` none of, `(n)` and `(n,m)` repeat the element, `<` and `>` anchor
 * to the ends. A trailing full stop is allowed. Residues are matched in
 * upper case. Returns null for anything that does not parse.
 */
export function prositeToRegExp(pattern: string): string | null {
  let p = pattern.trim().replace(/\.$/, '')
  if (p.length === 0) return null
  let prefix = ''
  let suffix = ''
  if (p.startsWith('<')) { prefix = '^'; p = p.slice(1) }
  if (p.endsWith('>')) { suffix = '$'; p = p.slice(0, -1) }
  const out: string[] = []
  for (const raw of p.split('-')) {
    const m = /^(x|[A-Z]|\[[A-Z]+\]|\{[A-Z]+\})(?:\((\d+)(?:,(\d+))?\))?$/.exec(raw.trim())
    if (!m) return null
    const [, el, n, k] = m
    let atom: string
    if (el === 'x') atom = '.'
    else if (el.startsWith('[')) atom = el
    else if (el.startsWith('{')) atom = `[^${el.slice(1, -1)}]`
    else atom = el
    if (n !== undefined) atom += k !== undefined ? `{${n},${k}}` : `{${n}}`
    out.push(atom)
  }
  return prefix + out.join('') + suffix
}

/**
 * Every occurrence of a pattern, overlaps included: a lookahead matches at
 * each position without consuming, and the capture reports what it saw.
 */
export function scanPattern(residues: string, source: string): [number, number][] {
  const re = new RegExp(`(?=(${source}))`, 'g')
  const text = residues.toUpperCase()
  const out: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const len = m[1].length
    if (len > 0) out.push([m.index, m.index + len])
    re.lastIndex = m.index + 1
  }
  return out
}

/** The hits of a library of motifs, in sequence order. */
export function scanMotifs(residues: string, library: readonly MotifDefinition[] = MOTIF_LIBRARY): MotifHit[] {
  const hits: MotifHit[] = []
  for (const motif of library) {
    const source = prositeToRegExp(motif.pattern)
    if (!source) continue
    for (const [start, end] of scanPattern(residues, source)) {
      hits.push({
        motifId: motif.id, name: motif.name, category: motif.category, type: motif.type, color: motif.color,
        start, end, sequence: residues.slice(start, end).toUpperCase(),
      })
    }
  }
  return hits.sort((a, b) => a.start - b.start || a.end - b.end)
}
