/**
 * When a FastQC flag is expected rather than a problem.
 *
 * FastQC's thresholds assume a random library of short reads: whole-genome
 * DNA on Illumina. Many libraries break those assumptions by design (an
 * amplicon is a few sequences, so it is duplicated and overrepresented;
 * bisulfite conversion turns C into T), and long reads break others. The
 * report keeps FastQC's mark, so it still reads as FastQC would, and shows
 * it muted with the reason when the read set's library type or technology
 * explains it. Nothing here changes the read set's own QC verdict.
 */

import type { ModuleId, ModuleStatus } from './types'

export type LibraryType = 'genomic' | 'amplicon' | 'rnaseq' | 'smallrna' | 'bisulfite' | 'other'

export const LIBRARY_LABEL: Record<LibraryType, string> = {
  genomic: 'Whole genome (DNA)',
  amplicon: 'Amplicons',
  rnaseq: 'RNA-seq',
  smallrna: 'Small RNA',
  bisulfite: 'Bisulfite',
  other: 'Other',
}

export const LIBRARY_TYPES = Object.keys(LIBRARY_LABEL) as LibraryType[]

export interface ExpectedContext {
  library?: LibraryType
  /** Nanopore or PacBio reads. */
  long: boolean
  /** Made by trimming or filtering another read set. */
  trimmed: boolean
}

const BY_LIBRARY: Partial<Record<LibraryType, Partial<Record<ModuleId, string>>>> = {
  amplicon: {
    baseContent: 'Every read of an amplicon starts at the same primer, so the bases at each position are far from random.',
    seqGc: 'An amplicon library is a few sequences, each with its own GC content, so the reads do not form one normal peak.',
    duplication: 'An amplicon library is a few sequences read many times over, so nearly every read is a duplicate.',
    overrepresented: 'Each amplicon is a large share of the reads, so the amplicons are listed here.',
  },
  rnaseq: {
    baseContent: 'Random hexamer priming biases the first dozen or so bases of RNA-seq reads.',
    seqGc: 'Transcripts differ in GC content and in how often they are read, so the reads need not form one normal peak.',
    duplication: 'Highly expressed transcripts are read many times over, which reads as duplication.',
    overrepresented: 'Highly expressed transcripts (and any rRNA left in) make up a large share of the reads.',
  },
  smallrna: {
    baseContent: 'A small RNA library is a limited set of short sequences, so the bases at each position are far from random.',
    seqGc: 'A small RNA library is a limited set of sequences, so the reads do not form one normal peak.',
    lengths: 'Small RNAs differ in length, so once the adapter is cut the reads do too.',
    duplication: 'Abundant small RNAs are read many times over, which reads as duplication.',
    overrepresented: 'Abundant small RNAs make up a large share of the reads.',
    adapters: 'Small RNAs are shorter than the reads, so the reads run into the 3\' adapter by design; trimming removes it.',
  },
  bisulfite: {
    baseContent: 'Bisulfite conversion reads unmethylated C as T, so C is nearly absent and T dominates.',
    seqGc: 'Bisulfite conversion lowers the GC content of the reads, away from FastQC\'s model.',
  },
}

/**
 * The reason a module's warning or failure is expected for these reads, or
 * null when it is not (or the module passed).
 */
export function expectedNote(id: ModuleId, status: ModuleStatus, ctx: ExpectedContext): string | null {
  if (status !== 'warn' && status !== 'fail') return null
  if (ctx.long) {
    if (id === 'lengths') return 'Long reads always differ in length.'
    if (id === 'seqQuality') return 'FastQC\'s limits (Q27 and Q20) are set for Illumina reads. For long reads, see the read quality verdict on the Summary page.'
    if (id === 'seqGc') return 'Long reads average their GC over thousands of bases, so their spread differs from the short reads FastQC\'s model is made for.'
  }
  if (id === 'lengths' && ctx.trimmed) return 'Trimming cuts reads to different lengths.'
  return (ctx.library && BY_LIBRARY[ctx.library]?.[id]) ?? null
}

/** The worst mark that is not expected, over the given module results. */
export function worstUnexpected(statuses: Record<ModuleId, ModuleStatus>[], ctx: ExpectedContext): ModuleStatus {
  let worst: ModuleStatus = 'pass'
  for (const m of statuses) {
    for (const [id, s] of Object.entries(m) as [ModuleId, ModuleStatus][]) {
      if (expectedNote(id, s, ctx)) continue
      if (s === 'fail') return 'fail'
      if (s === 'warn') worst = 'warn'
    }
  }
  return worst
}
