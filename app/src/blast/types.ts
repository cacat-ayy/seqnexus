/**
 * Types for NCBI BLAST search integration.
 */

export type BlastProgram = 'blastn' | 'megablast' | 'blastx' | 'tblastx' | 'blastp' | 'tblastn'

/** Programs that take a protein query. */
export const PROTEIN_QUERY_PROGRAMS: readonly BlastProgram[] = ['blastp', 'tblastn']

/** Programs whose hits are protein records (the others hit nucleotide records). */
export function hitsAreProtein(program: string): boolean {
  return program === 'blastx' || program === 'tblastx' || program === 'blastp'
}

/** Programs whose alignments are shown as residues. */
export function alignsAsProtein(program: string): boolean {
  return program === 'blastx' || program === 'tblastx' || program === 'blastp' || program === 'tblastn'
}

export interface BlastParams {
  query: string
  program: BlastProgram
  database: string
  evalue: number
  maxHits: number
}

export interface BlastSubmitResult {
  rid: string
  rtoe: number // estimated seconds until results ready
}

export type BlastStatus = 'WAITING' | 'READY' | 'FAILED' | 'UNKNOWN'

export interface BlastHsp {
  bitScore: number
  evalue: number
  identity: number      // fraction 0-1
  positives: number     // fraction 0-1
  gaps: number
  alignLen: number
  queryFrom: number     // 1-based
  queryTo: number       // 1-based
  hitFrom: number       // 1-based
  hitTo: number         // 1-based
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
  // Convenience: best HSP values for table display
  topScore: number
  topEvalue: number
  topIdentity: number
  queryCoverage: number // fraction 0-1
}

export interface BlastResult {
  program: string
  database: string
  queryLen: number
  queryName?: string    // source sequence name for display in persisted results
  hits: BlastHit[]
  message?: string      // NCBI status/error message
}
