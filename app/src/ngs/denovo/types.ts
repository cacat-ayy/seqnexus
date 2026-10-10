/**
 * De novo assembly of NGS reads: settings, and what a run reports.
 *
 * An assembly is made in two steps. The assembler makes contigs from the
 * reads alone; then every read is mapped back to the contigs (mapper.ts),
 * as to any reference, so the result is a mapping like the others: the same
 * reads view, coverage, variants (here, reads that disagree with the
 * contig), report and BAM export. The contigs are kept with the mapping as
 * its references.
 */

import { DEFAULT_LONG_TRIM, type Histogram, type TrimSettings } from '../types'
import type { KmerSpectrum } from './spectrum'
import type { LongGenomeReport } from './genome'
import type { RefFeature } from '../../assembly/variants'

/**
 * How the contigs are made.
 * - 'long-seed': whole plasmids and amplicons from long reads. Each peak in
 *   the read lengths is a product; one of its reads is the first draft,
 *   which the reads polish over a few rounds (long.ts).
 * - 'long-olc': a genome from long reads, by their overlaps: a string graph
 *   laid out and polished (genome.ts, olc.ts).
 * - 'long-auto': one of the two, by the read lengths (run.ts). Only a
 *   setting: a finished assembly records the one used.
 * - 'short-dbg': short reads, with a de Bruijn graph of their k-mers at the
 *   best of several k (short.ts, dbg.ts).
 */
export type DeNovoMethod = 'long-auto' | 'long-seed' | 'long-olc' | 'short-dbg'

export const DENOVO_METHOD_LABEL: Record<DeNovoMethod, string> = {
  'long-auto': 'Long reads: whole products or a genome, by the read lengths',
  'long-seed': 'Whole products from long reads (seed and polish)',
  'long-olc': 'Genome from long reads (overlaps, layout, consensus)',
  'short-dbg': 'Short reads, de Bruijn graph',
}

export interface DeNovoSettings {
  method: DeNovoMethod
  /** Fewest reads a product needs: in its length peak, and lined up with its contig end to end. Genomes: fewest reads behind a contig. */
  minReads: number
  /** Polishing rounds at most; they stop early once a round changes nothing. */
  rounds: number
  /** Short reads: the k to use, or null to try several and keep the best. */
  k?: number | null
  /** Short reads: shortest contig kept, bp. */
  minContig?: number
  /** Long-read genomes: the expected genome length, bp, to choose about 40x of reads; null takes up to 200 Mb. */
  genomeSize?: number | null
  /** Long-read genomes: a short read set to polish the contigs with. */
  polishWith?: { id: string; name: string } | null
  /** Short reads: join contigs across short repeats with the read pairs. */
  pairs?: boolean
}

export const DEFAULT_DENOVO_SETTINGS: DeNovoSettings = { method: 'long-auto', minReads: 5, rounds: 5, genomeSize: null, polishWith: null }
export const DEFAULT_SHORT_SETTINGS: DeNovoSettings = { method: 'short-dbg', minReads: 5, rounds: 5, k: null, minContig: 200 }

/** How a short-read assembly went. */
export interface ShortAssemblyReport {
  /** The k kept. */
  k: number
  /** Its solid threshold: k-mers seen fewer times were taken for errors. */
  threshold: number
  /** Every k tried, with what it gave. */
  tried: { k: number; threshold: number; contigs: number; n50: number; total: number }[]
  /** The read set's 21-mer spectrum, with its genome length estimate. */
  spectrum: KmerSpectrum
  /** Reads and bases assembled (sampled down to about 100x). */
  readsUsed: number
  basesUsed: number
  /** Tips, bubbles and low-coverage pieces removed from the graph. */
  cleaned: number
  minContig: number
  /** Paired reads: their insert size, and the contigs they joined across repeats (pairs.ts). */
  pairs?: PairJoinReport
}

export interface PairJoinReport {
  /** Pairs placed with both mates on one unitig, from which the insert size is taken. */
  placed: number
  /** Median insert size and its spread (median absolute deviation, scaled to a standard deviation). */
  insert: number
  insertSd: number
  /** Pairs linking two contig ends. */
  linking: number
  /** Joins made: a single path through the graph fits the pairs' distance. */
  joins: number
  /** Contig ends linked by pairs where no single path fits (left apart). */
  unresolved: number
}

/**
 * The read filter before assembling (guided pipeline): read quality as for
 * mapping, but reads kept down to 100 bp, since the product may be a short
 * amplicon and the usual 1000 bp floor would throw all its reads away.
 */
export const DENOVO_LONG_FILTER: TrimSettings = { ...DEFAULT_LONG_TRIM, minLength: 100 }

/** One length peak and what became of it. */
export interface DeNovoPeak {
  /** Median length of the reads in the peak. */
  length: number
  reads: number
  /** Index of the contig made from it, or null when it was dropped. */
  contig: number | null
  /** Why it was dropped. */
  dropped?: string
}

export interface DeNovoContigInfo {
  name: string
  length: number
  circular: boolean
  /** Long reads: length of the peak it came from. */
  peak?: number
  /** Long reads: the read it was started from. */
  seed?: string
  /** Long reads: polishing reads lined up with the contig over at least 90% of it, in the last round. */
  fullLength?: number
  /** Long reads: their share of all such reads in the assembly, the product's share of the sample. */
  share?: number
  /** Long reads: positions changed in each polishing round. */
  changes?: number[]
  /** Short reads: mean count of its k-mers. */
  kmerCoverage?: number
  /** Linear contigs: bases trimmed off and added at the ends, over all rounds. */
  trimmed?: number
  extended?: number
  /** Long-read genomes: reads in the layout, those inside them included. */
  layoutReads?: number
  /** Long-read genomes: a small replicon assembled from its length peak. */
  fromPeak?: boolean
  /** Long-read genomes: positions short reads changed in each round. */
  hybridChanges?: number[]
}

export interface DeNovoReport {
  version: 1
  settings: DeNovoSettings
  /** Reads in the read set. */
  reads: number
  contigs: DeNovoContigInfo[]
  /** Long reads: reads used for polishing (the best ones, up to POLISH_BASES). */
  polishReads?: number
  /** Long reads: read lengths, for the chart with the peaks. */
  lengths?: Histogram
  /** Long reads: the length peaks and what became of them. */
  peaks?: DeNovoPeak[]
  /** Short reads: how the graph was built. */
  short?: ShortAssemblyReport
  /** Long-read genomes: how the layout was made. */
  genome?: LongGenomeReport
  /** The method was chosen from the read lengths: the share of read bases in length peaks. */
  chosen?: { method: DeNovoMethod; share: number }
  /** Contigs turned to line up with an expected sequence (CompareDialog): on its strand, from its start. */
  matched?: {
    contig: number
    expected: string
    reversed: boolean
    shift: number
    at: number
    /** Lined up as the assembly was made, rather than turned afterwards. */
    auto?: boolean
    /** Same length and no insertion or deletion: linked to the sequence, whose features show over the reads. */
    linked?: boolean
  }[]
  /** The contigs were replaced by polished ones from a file (medaka or another polisher run outside). */
  polished?: { file: string; at: number; replaced: number }
}

/** A contig as the assembler hands it on, to be mapped to. */
export interface AssembledContig {
  name: string
  bases: string
  circular: boolean
  /** An open sequence it is linked to (lined up with it exactly), whose features show over its reads. */
  tabId?: string | null
  /** That sequence's features, kept with the mapping. */
  features?: RefFeature[]
}
