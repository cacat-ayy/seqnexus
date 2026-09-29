/**
 * NCBI genetic codes.
 *
 * Codon optimization has to know which codons are synonymous, and that is not
 * a universal fact: TGA is a stop in the standard code and a tryptophan in
 * every mitochondrial one, so optimizing a mitochondrial gene under the
 * standard code would truncate the protein.
 *
 * Tables are stored as diffs against the standard code, which is how NCBI
 * documents them and how they are easiest to check: the only lines here are
 * the ones that actually differ.
 *
 * Only the optimizer reads these today. The rest of the app still translates
 * with the standard code through utils/codon.ts, which now sources its table
 * from table 1 below so the two can never drift apart.
 */

export type GeneticCodeId = number

export interface GeneticCode {
  id: GeneticCodeId
  name: string
  /** Codon (uppercase, T not U) to single-letter amino acid, '*' for stop. */
  table: Record<string, string>
  /** Initiation codons, for reference and for the initiator lock. */
  starts: string[]
}

/** NCBI table 1. Every other table is this plus a handful of reassignments. */
const STANDARD: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M', GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*', CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R', GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
}

interface CodeSpec {
  id: number
  name: string
  diff: Record<string, string>
  starts: string[]
}

const SPECS: CodeSpec[] = [
  { id: 1, name: 'Standard', diff: {}, starts: ['ATG', 'TTG', 'CTG'] },
  {
    id: 2, name: 'Vertebrate mitochondrial',
    diff: { AGA: '*', AGG: '*', ATA: 'M', TGA: 'W' },
    starts: ['ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 3, name: 'Yeast mitochondrial',
    diff: { ATA: 'M', CTT: 'T', CTC: 'T', CTA: 'T', CTG: 'T', TGA: 'W' },
    starts: ['ATA', 'ATG', 'GTG'],
  },
  {
    id: 4, name: 'Mold / protozoan / coelenterate mitochondrial, Mycoplasma',
    diff: { TGA: 'W' },
    starts: ['TTA', 'TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 5, name: 'Invertebrate mitochondrial',
    diff: { AGA: 'S', AGG: 'S', ATA: 'M', TGA: 'W' },
    starts: ['TTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 6, name: 'Ciliate / dasycladacean / Hexamita nuclear',
    diff: { TAA: 'Q', TAG: 'Q' },
    starts: ['ATG'],
  },
  {
    id: 9, name: 'Echinoderm / flatworm mitochondrial',
    diff: { AAA: 'N', AGA: 'S', AGG: 'S', TGA: 'W' },
    starts: ['ATG', 'GTG'],
  },
  { id: 10, name: 'Euplotid nuclear', diff: { TGA: 'C' }, starts: ['ATG'] },
  {
    id: 11, name: 'Bacterial, archaeal and plant plastid',
    diff: {},
    starts: ['TTG', 'CTG', 'ATT', 'ATC', 'ATA', 'ATG', 'GTG'],
  },
  { id: 12, name: 'Alternative yeast nuclear', diff: { CTG: 'S' }, starts: ['CTG', 'ATG'] },
  {
    id: 13, name: 'Ascidian mitochondrial',
    diff: { AGA: 'G', AGG: 'G', ATA: 'M', TGA: 'W' },
    starts: ['TTG', 'ATA', 'ATG', 'GTG'],
  },
  {
    id: 14, name: 'Alternative flatworm mitochondrial',
    diff: { AAA: 'N', AGA: 'S', AGG: 'S', TAA: 'Y', TGA: 'W' },
    starts: ['ATG'],
  },
  { id: 16, name: 'Chlorophycean mitochondrial', diff: { TAG: 'L' }, starts: ['ATG'] },
  {
    id: 21, name: 'Trematode mitochondrial',
    diff: { AAA: 'N', AGA: 'S', AGG: 'S', ATA: 'M', TGA: 'W' },
    starts: ['ATG', 'GTG'],
  },
  {
    id: 22, name: 'Scenedesmus obliquus mitochondrial',
    diff: { TCA: '*', TAG: 'L' },
    starts: ['ATG'],
  },
  { id: 23, name: 'Thraustochytrium mitochondrial', diff: { TTA: '*' }, starts: ['ATT', 'ATG', 'GTG'] },
  {
    id: 24, name: 'Rhabdopleuridae mitochondrial',
    diff: { AGA: 'S', AGG: 'K', TGA: 'W' },
    starts: ['TTG', 'CTG', 'ATG', 'GTG'],
  },
  {
    id: 25, name: 'Candidate division SR1 and Gracilibacteria',
    diff: { TGA: 'G' },
    starts: ['TTG', 'ATG', 'GTG'],
  },
  { id: 26, name: 'Pachysolen tannophilus nuclear', diff: { CTG: 'A' }, starts: ['CTG', 'ATG'] },
]

export const GENETIC_CODES: GeneticCode[] = SPECS.map(spec => ({
  id: spec.id,
  name: spec.name,
  table: { ...STANDARD, ...spec.diff },
  starts: spec.starts,
}))

export const DEFAULT_GENETIC_CODE_ID = 1

const BY_ID = new Map(GENETIC_CODES.map(c => [c.id, c]))

/** Look up a code, falling back to the standard one for an unknown id. */
export function geneticCode(id: GeneticCodeId): GeneticCode {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_GENETIC_CODE_ID)!
}

/** The standard code's table, for callers that have no code selection. */
export const STANDARD_CODE_TABLE: Record<string, string> = geneticCode(1).table

/** Translate one codon. Anything not a plain ACGT triplet reads as unknown. */
export function translateCodonWith(code: GeneticCode, codon: string): string {
  return code.table[codon.toUpperCase()] ?? '?'
}

/** Translate a DNA string. A trailing partial codon is dropped. */
export function translateWith(code: GeneticCode, dna: string): string {
  const upper = dna.toUpperCase()
  const out: string[] = []
  for (let i = 0; i + 2 < upper.length; i += 3) {
    out.push(code.table[upper.slice(i, i + 3)] ?? '?')
  }
  return out.join('')
}

const SYNONYM_CACHE = new WeakMap<GeneticCode, Map<string, string[]>>()

/**
 * Every codon for one amino acid under this code.
 *
 * Cached per code: the optimizer asks once per residue and the answer only
 * depends on the table.
 */
export function synonymsFor(code: GeneticCode, aa: string): string[] {
  let map = SYNONYM_CACHE.get(code)
  if (!map) {
    map = new Map()
    for (const [codon, residue] of Object.entries(code.table)) {
      const list = map.get(residue)
      if (list) list.push(codon)
      else map.set(residue, [codon])
    }
    for (const list of map.values()) list.sort()
    SYNONYM_CACHE.set(code, map)
  }
  return map.get(aa) ?? []
}
