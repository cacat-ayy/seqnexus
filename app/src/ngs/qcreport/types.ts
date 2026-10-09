/**
 * The quality report of a read set: FastQC's modules, in FastQC's order and
 * under FastQC's names, with its pass, warn and fail rules, so that anyone
 * who reads FastQC reports can read this one. See the README for how each
 * module is computed and where SeqNexus differs from FastQC.
 *
 * Like FastQC, which reports each file on its own, the report is made per
 * mate: R1 and R2 of a pair each get their own modules.
 */

import type { Histogram, PositionQuality } from '../types'

export type ModuleId =
  | 'basic' | 'baseQuality' | 'tileQuality' | 'seqQuality' | 'baseContent' | 'seqGc'
  | 'baseN' | 'lengths' | 'duplication' | 'overrepresented' | 'adapters'

/** `skip`: not run for these reads (no qualities, no tile numbers, long reads); a note says why. */
export type ModuleStatus = 'pass' | 'warn' | 'fail' | 'skip'

/** FastQC's modules in its order, with its names. K-mer Content is left out, as FastQC leaves it out by default. */
export const MODULES: readonly { id: ModuleId; name: string }[] = [
  { id: 'basic', name: 'Basic Statistics' },
  { id: 'baseQuality', name: 'Per base sequence quality' },
  { id: 'tileQuality', name: 'Per tile sequence quality' },
  { id: 'seqQuality', name: 'Per sequence quality scores' },
  { id: 'baseContent', name: 'Per base sequence content' },
  { id: 'seqGc', name: 'Per sequence GC content' },
  { id: 'baseN', name: 'Per base N content' },
  { id: 'lengths', name: 'Sequence Length Distribution' },
  { id: 'duplication', name: 'Sequence Duplication Levels' },
  { id: 'overrepresented', name: 'Overrepresented sequences' },
  { id: 'adapters', name: 'Adapter Content' },
]

/** FastQC's default thresholds (its limits.txt): above `warn` warns, above `error` fails, in the direction each module checks. */
export const FASTQC_LIMITS = {
  /** Lower quartile and median at any position (below). */
  baseLower: { warn: 10, error: 5 },
  baseMedian: { warn: 25, error: 20 },
  /** Any tile's mean quality this far from the mean of all tiles at a position. */
  tile: { warn: 5, error: 10 },
  /** The most common mean read quality (at or below). */
  seqQuality: { warn: 27, error: 20 },
  /** Difference between A and T, or G and C, at any position, in percent. */
  baseContent: { warn: 10, error: 20 },
  /** Sum of the deviations from the fitted normal, as a percentage of reads. */
  seqGc: { warn: 15, error: 30 },
  /** N calls at any position, in percent. */
  baseN: { warn: 5, error: 20 },
  /** Share of reads left after deduplication, in percent (below). */
  duplication: { warn: 70, error: 50 },
  /** Any one sequence, as a percentage of all reads. */
  overrepresented: { warn: 0.1, error: 1 },
  /** Any adapter at any position, cumulative percentage of reads. */
  adapters: { warn: 5, error: 10 },
} as const

/** FastQC's duplication level bins. */
export const DUPLICATION_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '>10', '>50', '>100', '>500', '>1k', '>5k', '>10k+'] as const

export interface OverrepresentedSequence {
  seq: string
  count: number
  /** Percentage of the mate's reads. */
  percent: number
  /** The best contaminant hit, as FastQC writes it ("TruSeq Adapter, Index 1 (100% over 50bp)"), or null for no hit. */
  source: string | null
}

export interface MateReport {
  reads: number
  bases: number
  minLength: number
  maxLength: number
  /** G and C among A, C, G and T calls, in percent. */
  gc: number
  /** The lowest Phred score in the reads (read as Phred+33), or null without qualities. */
  lowestQuality: number | null
  /** Per position, up to the longest read (at most MAX_POSITION). */
  baseQuality: PositionQuality[]
  /** Percentage of A, C, G and T among the calls at each position (N left out). */
  baseContent: { a: number[]; c: number[]; g: number[]; t: number[] }
  /** Percentage of N calls at each position. */
  baseN: number[]
  /** Reads by mean quality, FastQC's way (whole-number mean of the scores): counts[i] reads at Q(from + i). */
  seqQuality: { from: number; counts: number[] }
  /** Reads by GC percentage, 0 to 100, and the normal distribution fitted to them. */
  seqGc: { observed: number[]; theoretical: number[]; deviation: number }
  lengths: Histogram
  /** Reads of length 0. */
  emptyReads: number
  duplication: {
    /** Percentage of all reads at each duplication level (DUPLICATION_LABELS). */
    levels: number[]
    /** Percentage of reads left if deduplicated. */
    remaining: number
  }
  overrepresented: OverrepresentedSequence[]
  /** Cumulative percentage of reads with each adapter by this position; positions run to the longest read less the probe length. */
  adapters: { name: string; percent: number[] }[]
  /** Mean quality of each tile at each position less the mean of all tiles there; null when the read names have no tile numbers. */
  tiles: { ids: number[]; deviation: number[][]; maxDeviation: number } | null
  status: Record<ModuleId, ModuleStatus>
  /** Why a module was skipped, or something to know about its result. */
  notes: Partial<Record<ModuleId, string>>
}

export const QC_REPORT_VERSION = 1

export interface QcReport {
  version: number
  long: boolean
  mates: MateReport[]
}

/** What the read set record keeps of its report: the status of each module, per mate. The report itself is stored beside the reads. */
export interface QcSummary {
  version: number
  status: Record<ModuleId, ModuleStatus>[]
}

export function summarize(r: QcReport): QcSummary {
  return { version: r.version, status: r.mates.map(m => m.status) }
}
