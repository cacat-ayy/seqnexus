/**
 * A protein's 3D structure, as the document refers to it, and the parts of
 * a coordinate file the app reads for itself (the viewer reads the rest).
 *
 * The document keeps only a reference: where the structure came from, its
 * id, the chain the protein was matched to, and the key its text is cached
 * under in IndexedDB. Coordinates are a cache, not document state: a fetched
 * structure is fetched again when the cache is gone, a dropped file is asked
 * for again.
 */

export type StructureSource = 'pdb' | 'alphafold' | 'file'
export type StructureFormat = 'pdb' | 'mmcif'

export interface StructureRef {
  source: StructureSource
  /** The PDB id, the UniProt accession of an AlphaFold model, or the file's name. */
  id: string
  /** The IndexedDB key its text is cached under (see cacheKey). */
  key: string
  format: StructureFormat
  /** The chain (author chain id) the protein is aligned to. */
  chain: string
  /** The entry's title or the model's description, for the panel. */
  title?: string
}

export function cacheKey(source: StructureSource, id: string): string {
  return `${source === 'alphafold' ? 'afdb' : source}:${id.toUpperCase()}`
}

/** One residue of a chain, in the order the file lists them. */
export interface StructureResidue {
  /** Author residue number, and insertion code (usually ''). */
  num: number
  icode: string
  /** One-letter code. */
  aa: string
  /** Mean B-factor of its atoms: the pLDDT in an AlphaFold model. */
  b: number
}

export interface StructureChain {
  id: string
  residues: StructureResidue[]
  /** The residues' one-letter codes, joined. */
  sequence: string
}

export interface ParsedStructure {
  format: StructureFormat
  title?: string
  /** Protein chains of the first model, in file order. */
  chains: StructureChain[]
}

/**
 * Three-letter to one-letter codes, with the modified residues structures
 * use for standard ones (selenomethionine, phosphorylated Ser/Thr/Tyr and
 * the like) read as their parent, as SEQRES conventions do.
 */
export const THREE_TO_ONE: Readonly<Record<string, string>> = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  SEC: 'U', PYL: 'O', ASX: 'B', GLX: 'Z', UNK: 'X',
  MSE: 'M', SEP: 'S', TPO: 'T', PTR: 'Y', HYP: 'P', MLY: 'K', CSO: 'C', CME: 'C', KCX: 'K', LLP: 'K',
  CSD: 'C', HIC: 'H', M3L: 'K', OCS: 'C', PCA: 'E', SAC: 'S', NEP: 'H', TYS: 'Y',
}

/** A PDB id: a digit, then three letters or digits. */
export function isPdbId(text: string): boolean {
  return /^[0-9][A-Za-z0-9]{3}$/.test(text.trim())
}

/** FNV-1a over the text, as hex: the cache key of a dropped file. */
export function textHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}
