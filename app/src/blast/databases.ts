/**
 * The databases a search can run against, and where a hit's record lives.
 *
 * Searches run at EMBL-EBI, whose nucleotide databases are ENA's (the
 * European member of the INSDC, so the same records, under the same
 * accessions, as GenBank and DDBJ) and whose protein databases are UniProt's
 * and the structure archives'. NCBI's own collections (core_nt, RefSeq, nr)
 * are reached by handing the search to NCBI's site.
 */

import { hitsAreProtein, type BlastProgram } from './types'

export interface DatabaseOption {
  id: string
  label: string
  group: string
}

/** ENA, for blastn, megablast, tblastn and tblastx. The first is the default. */
export const NUCLEOTIDE_DATABASES: DatabaseOption[] = [
  { id: 'em_std', label: 'ENA standard: annotated records', group: 'ENA' },
  { id: 'em_all', label: 'ENA all: every record, with WGS and patents', group: 'ENA' },
  { id: 'em_syn', label: 'ENA synthetic: vectors and synthetic constructs', group: 'ENA' },
  { id: 'em_cds', label: 'ENA coding sequences', group: 'ENA' },
  { id: 'em_pro', label: 'Prokaryotes', group: 'ENA by taxon' },
  { id: 'em_vrl', label: 'Viruses', group: 'ENA by taxon' },
  { id: 'em_phg', label: 'Phages', group: 'ENA by taxon' },
  { id: 'em_fun', label: 'Fungi', group: 'ENA by taxon' },
  { id: 'em_pln', label: 'Plants', group: 'ENA by taxon' },
  { id: 'em_inv', label: 'Invertebrates', group: 'ENA by taxon' },
  { id: 'em_vrt', label: 'Vertebrates', group: 'ENA by taxon' },
  { id: 'em_mam', label: 'Mammals', group: 'ENA by taxon' },
  { id: 'em_hum', label: 'Human', group: 'ENA by taxon' },
  { id: 'em_mus', label: 'Mouse', group: 'ENA by taxon' },
  { id: 'em_rod', label: 'Rodents', group: 'ENA by taxon' },
]

/** UniProt and the structure archives, for blastp and blastx. The first is the default. */
export const PROTEIN_DATABASES: DatabaseOption[] = [
  { id: 'uniprotkb_swissprot', label: 'UniProtKB/Swiss-Prot: reviewed', group: 'UniProt' },
  { id: 'uniprotkb', label: 'UniProtKB: Swiss-Prot and TrEMBL', group: 'UniProt' },
  { id: 'uniref90', label: 'UniRef90: clusters at 90% identity', group: 'UniProt' },
  { id: 'uniref50', label: 'UniRef50: clusters at 50% identity', group: 'UniProt' },
  { id: 'uniprotkb_bacteria', label: 'UniProtKB bacteria', group: 'UniProt by taxon' },
  { id: 'uniprotkb_human', label: 'UniProtKB human', group: 'UniProt by taxon' },
  { id: 'uniprotkb_viruses', label: 'UniProtKB viruses', group: 'UniProt by taxon' },
  { id: 'pdb', label: 'PDB: experimental structures', group: 'Structures' },
  { id: 'afdb', label: 'AlphaFold DB: predicted structures', group: 'Structures' },
]

/** The databases a program can search: a protein database for blastp and blastx, nucleotide ones otherwise. */
export function databasesFor(program: BlastProgram): DatabaseOption[] {
  return hitsAreProtein(program) ? PROTEIN_DATABASES : NUCLEOTIDE_DATABASES
}

/** A database's name as the drawer writes it; an unknown one (an NCBI database from a result file) as it is. */
export function databaseLabel(id: string): string {
  return [...NUCLEOTIDE_DATABASES, ...PROTEIN_DATABASES].find(d => d.id === id)?.label.split(':')[0] ?? id
}

/** NCBI's standard collection for a program, for a search handed to NCBI's site. */
export function ncbiDatabaseFor(program: BlastProgram): string {
  return hitsAreProtein(program) ? 'nr' : 'core_nt'
}

/** The record a hit points to: ENA (or NCBI, for an NCBI search), UniProt, PDBe or AlphaFold DB. */
export function recordUrl(accession: string, database: string, program: string, service: 'ebi' | 'ncbi'): string {
  const acc = encodeURIComponent(accession)
  if (service === 'ncbi') return `https://www.ncbi.nlm.nih.gov/${hitsAreProtein(program) ? 'protein' : 'nuccore'}/${acc}`
  if (database === 'pdb') return `https://www.ebi.ac.uk/pdbe/entry/pdb/${encodeURIComponent(accession.split(/[_:]/)[0].toLowerCase())}`
  if (database === 'afdb') return `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(uniprotFromAlphaFold(accession))}`
  if (hitsAreProtein(program)) return `https://www.uniprot.org/uniprotkb/${acc}/entry`
  return `https://www.ebi.ac.uk/ena/browser/view/${acc}`
}

/** "AF-P12345-F1" to "P12345"; anything else as it is. */
export function uniprotFromAlphaFold(accession: string): string {
  return /^AF-([A-Z0-9]+)-F\d+/.exec(accession)?.[1] ?? accession
}

/** A hit's accession as a GenBank /db_xref, by the database it came from. */
export function dbXref(accession: string, database: string, program: string, service: 'ebi' | 'ncbi'): string {
  if (service === 'ncbi') return `NCBI:${accession}`
  if (database === 'pdb') return `PDB:${accession}`
  if (database === 'afdb') return `AlphaFoldDB:${uniprotFromAlphaFold(accession)}`
  if (hitsAreProtein(program)) return `UniProtKB:${accession}`
  return `ENA:${accession}`
}
