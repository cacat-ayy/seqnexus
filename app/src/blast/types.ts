/**
 * Types for NCBI BLAST search integration.
 */

export type BlastProgram = 'blastn' | 'megablast' | 'blastx' | 'tblastx' | 'blastp' | 'tblastn'

/** Programs that take a protein query. */
export const PROTEIN_QUERY_PROGRAMS: readonly BlastProgram[] = ['blastp', 'tblastn']

/**
 * Programs that search a protein database, so their hits are protein records.
 * tblastn and tblastx translate a nucleotide database: their hits are
 * nucleotide records.
 */
export function hitsAreProtein(program: string): boolean {
  return program === 'blastx' || program === 'blastp'
}

/** Programs that translate the query, so its coordinates step three bases per residue. */
export function translatesQuery(program: string): boolean {
  return program === 'blastx' || program === 'tblastx'
}

/** Programs that translate the database, so hit coordinates step three bases per residue. */
export function translatesHit(program: string): boolean {
  return program === 'tblastn' || program === 'tblastx'
}

/** Programs whose alignments are shown as residues. */
export function alignsAsProtein(program: string): boolean {
  return program === 'blastx' || program === 'tblastx' || program === 'blastp' || program === 'tblastn'
}

/** NCBI Taxonomy's taxon for synthetic constructs: cloning vectors, synthetic genes and the like. */
export const SYNTHETIC_CONSTRUCT_TAXID = 32630

/** The low-complexity filter: the service's default for the program, or forced. */
export type LowComplexity = 'default' | 'on' | 'off'

/**
 * Where a search ran. Searches run at EMBL-EBI, the one BLAST service that
 * lets a web page read its answers; a search run on NCBI's own site comes in
 * as the result file NCBI lets you download.
 */
export type BlastService = 'ebi' | 'ncbi'

/** What a search was asked for, kept with it so it can be read back and run again. */
export interface BlastSettings {
  program: BlastProgram
  database: string
  evalue: number
  maxHits: number
  /** Leave out synthetic constructs, which crowd the top of a search with a plasmid part. */
  excludeSynthetic: boolean
  /** Limit to an organism: a name or a taxid, empty for none. */
  organism: string
  /** Scoring matrix for the protein programs, empty for the default (BLOSUM62). */
  matrix: string
  lowComplexity: LowComplexity
}

export interface BlastParams extends BlastSettings {
  query: string
}

/** A job's state at EMBL-EBI's Job Dispatcher. */
export type EbiStatus = 'QUEUED' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'FAILURE' | 'NOT_FOUND'

export interface BlastHsp {
  bitScore: number
  evalue: number
  identity: number      // fraction 0-1
  positives: number     // fraction 0-1
  gaps: number
  alignLen: number
  // 1-based and inclusive, From <= To on either strand: the strand is
  // queryStrand and hitStrand
  queryFrom: number
  queryTo: number
  hitFrom: number
  hitTo: number
  /**
   * The strand each side is read on. A blastn hit on the minus strand of its
   * record has hitStrand -1; a translated side takes the sign of its frame;
   * a protein side is 1.
   */
  queryStrand: 1 | -1
  hitStrand: 1 | -1
  queryFrame: number
  hitFrame: number
  qseq: string          // aligned query string
  hseq: string          // aligned hit string
  midline: string       // midline (| for match, space for mismatch)
}

export interface BlastHit {
  accession: string
  description: string
  sciName: string
  length: number        // subject sequence length
  hsps: BlastHsp[]
  // The best HSP's values (hsps[0]: the highest bit score), for the table
  topScore: number
  topEvalue: number
  topIdentity: number
  queryCoverage: number // fraction 0-1
}

/**
 * Where a search's query came from in its document, so its hits can be
 * placed back on it.
 */
export interface BlastQuery {
  /** What the query was, for the search's label: "Whole sequence", "Selection 120..890", "lacZ (CDS)". */
  label: string
  /**
   * The query's parts in the document, 0-based half-open, in query order:
   * one, or two for a selection across the origin of a circular sequence.
   * For a translation, the coding parts in sequence order.
   */
  segments: [number, number][]
  /**
   * Set when the query was the translation of these bases (a CDS sent to
   * blastp) rather than the bases: query positions are then residues, read
   * on this strand; `protein` is what was sent.
   */
  translation?: { strand: 1 | -1; protein: string }
  /** The document's length when the search was run. */
  seqLength: number
  /** A fingerprint of the bases the query came from, to tell whether they were edited since. */
  fingerprint: string
}

export interface BlastResult {
  program: string
  database: string
  queryLen: number
  hits: BlastHit[]
  message?: string      // NCBI status/error message
}

/**
 * One search, as a document keeps it: what was asked, of which bases, and
 * what NCBI answered. Saved with the document's tab in the workspace.
 */
export interface BlastSearch {
  /**
   * The search's id: EMBL-EBI's job id, or one made up for a result file
   * from NCBI (which does not carry NCBI's request id).
   */
  rid: string
  service: BlastService
  createdAt: number
  /** The document's name when the search was run. */
  queryName: string
  settings: BlastSettings
  query: BlastQuery
  result: BlastResult
}
