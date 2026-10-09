/**
 * What each quality report module shows, how it is flagged, and when a
 * warning is expected rather than a problem. Written for SeqNexus; the
 * thresholds are FastQC's defaults (ngs/qcreport/types.ts).
 */

import type { ModuleId } from '../../../ngs/qcreport/types'

export interface ModuleHelp {
  about: string
  flags: string
  expected?: string
}

export const MODULE_HELP: Record<ModuleId, ModuleHelp> = {
  basic: {
    about: 'The file and its reads in figures: how many, how long, their GC share, and how the qualities are encoded.',
    flags: 'Never flagged.',
  },
  baseQuality: {
    about: 'The spread of base qualities at each position in the read. Quality usually falls towards the end of Illumina reads; the question is how far.',
    flags: 'Warns when the lower quartile at any position is below Q10 or the median below Q25; fails below Q5 or a median below Q20.',
    expected: 'A drop at the last few positions of long reads is common and is what quality trimming removes.',
  },
  tileQuality: {
    about: 'Mean quality of each flow cell tile at each position, against the mean of all tiles. A tile worse than the rest points to a bubble, dirt or an edge effect on the flow cell, not to the library.',
    flags: 'Warns when any tile is more than 5 Phred units from the average at any position; fails beyond 10. Read names must carry tile numbers, as Illumina names do.',
    expected: 'Short streaks are usually harmless; consistent bad tiles across positions are worth a look.',
  },
  seqQuality: {
    about: 'Reads by their mean quality. A good run is one peak at high quality; a second peak lower down is a group of poor reads.',
    flags: 'Warns when the most common mean quality is Q27 or lower; fails at Q20 or lower. The mean here is FastQC\'s: the whole-number average of the scores. The read quality on the Summary page is the more accurate mean from error probabilities, and reads lower.',
  },
  baseContent: {
    about: 'The share of A, C, G and T at each position. In a random library the four lines run flat and parallel, following the genome\'s base composition.',
    flags: 'Warns when A and T, or G and C, differ by more than 10 percentage points at any position; fails above 20.',
    expected: 'Amplicons, RNA-seq (random hexamer priming biases the first dozen bases), Nextera and other transposase libraries, and bisulfite libraries all fail this by design.',
  },
  seqGc: {
    about: 'Reads by their GC share, with a normal distribution fitted to it. One genome gives one smooth peak at its GC content; extra peaks or shoulders are contamination or adapter dimers.',
    flags: 'Warns when the reads differ from the fitted curve by more than 15% of the reads in total; fails above 30%.',
    expected: 'Amplicons and libraries of a few sequences give narrow or several peaks; a mix of organisms gives several.',
  },
  baseN: {
    about: 'The share of N calls at each position: bases the instrument could not call.',
    flags: 'Warns when more than 5% of calls at any position are N; fails above 20%.',
    expected: 'A short spike of Ns usually means a few bad cycles; it often comes with low quality at the same positions.',
  },
  lengths: {
    about: 'Reads by length.',
    flags: 'Warns when the reads are not all one length; fails when any read is empty.',
    expected: 'Trimmed reads and long reads always vary in length, so a warning here is expected for them.',
  },
  duplication: {
    about: 'How often each read sequence occurs: the share of all reads that come from sequences seen once, twice, and so on. Reads are compared by their first 50 bases.',
    flags: 'Warns when deduplicating would leave less than 70% of the reads; fails below 50%.',
    expected: 'Amplicons, small genomes sequenced deeply, and RNA-seq of highly expressed genes are duplicated by nature. Only the first 100,000 distinct sequences are tracked, so the levels for very large files are estimates.',
  },
  overrepresented: {
    about: 'Sequences that make up more than 0.1% of the reads, with the adapter or primer they match, if any.',
    flags: 'Warns when any sequence is over 0.1% of the reads; fails above 1%.',
    expected: 'Amplicon libraries are made of a few sequences, so they are listed here. Adapter dimers and primers are worth trimming.',
  },
  adapters: {
    about: 'For each adapter, the share of reads that contain its first 12 bases by each position, counted from where it starts to the end of the read. A curve rising towards the end of the reads is adapter read-through.',
    flags: 'Warns when any adapter is in more than 5% of reads at any position; fails above 10%.',
    expected: 'Libraries with inserts shorter than the reads show adapters; trimming removes them. PolyG at the ends of two-colour (NextSeq, NovaSeq) reads is a lack of signal, not an adapter.',
  },
}
