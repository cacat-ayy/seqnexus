/**
 * A contig: reads laid out in one shared column space, with or without a
 * reference.
 *
 * Each row stores only its own span (`start` plus a gapped string), never a
 * full-width padded copy, so memory grows with the bases actually there; a
 * pileup of many short reads stays cheap. Rows are copies: editing a base
 * here changes the contig, not the read it came from. `src` keeps the link
 * back to the read's trace, so the trace can be drawn under each row.
 */

export interface ContigRow {
  id: string
  /** The sequencing read this row was made from; null once that read is deleted, or for a plain sequence. */
  readId: string | null
  name: string
  /** Aligned as the reverse complement of the read. */
  reversed: boolean
  /** Column of seq[0]. */
  start: number
  /** Aligned bases; '-' is a gap inside the row. */
  seq: string
  /** The bases as assembled, before any edit in the contig (same length as seq). */
  orig: string
  /**
   * For each position: the called-base index in the read's trace data, or
   * -1 for a gap, -2 for a base typed by hand (no call under it).
   */
  src: number[]
  /** Phred quality per position (0 for gaps). */
  qual: number[]
}

export interface ContigReference {
  name: string
  /** The open sequence it came from, when there was one. */
  tabId: string | null
  /** Length of the reference itself (a circular one may be extended past its end). */
  length: number
  circular: boolean
  /** Reference bases across every column; '-' where reads have extra bases. */
  seq: string
}

export interface ContigDoc {
  method: 'reference' | 'de-novo'
  reference: ContigReference | null
  width: number
  rows: ContigRow[]
}

export interface AssemblyInput {
  readId: string | null
  name: string
  /** Edited, trimmed bases, forward. */
  seq: string
  qual: number[]
  src: number[]
  /** The user shows this read reverse complemented: a hint for de novo orientation. */
  preferReversed: boolean
}

export interface AssemblySettings {
  /** Lowest identity a read may align with. */
  minIdentity: number
  /** De novo: shortest overlap that joins two reads. */
  minOverlap: number
  /** k-mer length for seeding. */
  k: number
}

export const DEFAULT_ASSEMBLY: AssemblySettings = { minIdentity: 0.8, minOverlap: 30, k: 12 }

export interface AssemblyReport {
  contigs: { name: string; doc: ContigDoc }[]
  /** Reads that did not go into any contig, with why. */
  unplaced: { name: string; readId: string | null; reason: string }[]
}
