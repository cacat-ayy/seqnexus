/**
 * Read sets: next-generation sequencing reads, kept as one item per sample.
 *
 * A read set holds a FASTQ file, an R1/R2 pair or a long-read run. Only its
 * description lives in the store (name, technology, QC figures); the reads
 * themselves are stored in IndexedDB in compressed chunks (see codec.ts) and
 * are read a chunk at a time by the workers that need them, so a sample of
 * millions of reads never has to be held in memory.
 */

import type { KmerSpectrum } from './denovo/spectrum'

export type Technology = 'illumina' | 'nanopore' | 'pacbio' | 'other'

export const TECHNOLOGY_LABEL: Record<Technology, string> = {
  illumina: 'Illumina',
  nanopore: 'Nanopore',
  pacbio: 'PacBio',
  other: 'Other',
}

/** Long reads: QC by read length and read quality rather than by position. */
export function isLongRead(t: Technology): boolean {
  return t === 'nanopore' || t === 'pacbio'
}

/** Quality spread at one read position: mean and percentiles of the Phred scores. */
export interface PositionQuality {
  mean: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

/** A histogram: `counts[i]` values fell in [edges[i], edges[i + 1]). */
export interface Histogram {
  edges: number[]
  counts: number[]
}

export interface ReadSetStats {
  reads: number
  bases: number
  minLength: number
  maxLength: number
  meanLength: number
  /** Half the bases are in reads at least this long. */
  n50: number
  /** Share of bases at Q20 and above, and at Q30 and above. */
  q20: number
  q30: number
  /** Share of bases called N. */
  nFraction: number
  gc: number
  /** Median of the reads' mean quality (computed from error probabilities, see stats.ts). */
  medianReadQuality: number
  /** No quality in the file (FASTA, or all qualities zero). */
  qualityMissing: boolean
  lengths: Histogram
  readQuality: Histogram
  /** Reads by GC content, in 1% bins. */
  gcContent: Histogram
  /**
   * Quality by position, one list per mate (one for single reads). Short
   * reads only: along a long read, position says little.
   */
  positionQuality: PositionQuality[][]
}

export interface QcResult {
  verdict: 'good' | 'check' | 'fail'
  issues: string[]
}

export interface TrimSettings {
  /** Short reads: trim adapters (fastp detects them). */
  adapters: boolean
  /** Short reads: cut from both ends while a 4-base window's mean quality is below this. 0 = off. */
  windowQuality: number
  /** Drop reads (pairs, if a mate is dropped) shorter than this after trimming. */
  minLength: number
  /** Long reads: drop reads whose mean quality is below this. 0 = off. */
  minReadQuality: number
}

export const DEFAULT_TRIM: TrimSettings = { adapters: true, windowQuality: 20, minLength: 20, minReadQuality: 0 }
export const DEFAULT_LONG_TRIM: TrimSettings = { adapters: false, windowQuality: 0, minLength: 1000, minReadQuality: 10 }

/** How a read set was made from another one. */
export interface ReadSetOrigin {
  fromId: string
  fromName: string
  method: 'fastp' | 'filter'
  settings: TrimSettings
  /** Reads (counting both mates) before and after. */
  readsBefore: number
  readsAfter: number
  basesBefore: number
  basesAfter: number
  /** fastp only: reads in which an adapter was found and cut. */
  adapterTrimmedReads?: number
}

/** The stored description of a read set. The reads are in IndexedDB. */
export interface ReadSetRecord {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  technology: Technology
  /** Mates are stored interleaved: reads 2i and 2i+1 are a pair. */
  paired: boolean
  /** The files it was imported from. */
  files: { name: string; bytes: number }[]
  stats: ReadSetStats
  /** Number of stored chunks. */
  chunks: number
  /** Bytes the chunks take in storage. */
  storedBytes: number
  origin?: ReadSetOrigin
  /** When its reads were discarded to free storage; the description and QC are kept. */
  discardedAt?: number
  /** Its k-mer spectrum and genome length estimate, once counted (denovo/spectrum.ts). */
  kmers?: KmerSpectrum
}
