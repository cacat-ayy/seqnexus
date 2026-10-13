/**
 * What the export dialog can write, per kind of item. Kept apart from the
 * dialog so that menus and the explorer can ask for a kind's formats without
 * importing a component.
 */

import { FileText, Database, Dna, Table, List, Activity, AlignLeft } from 'lucide-react'

export type ExportFormat =
  | 'gb' | 'fasta' | 'dna' | 'embl' | 'gff3' | 'gff3-seq' | 'csv' // sequences
  | 'fastq' | 'scf'                                     // sequencing reads
  | 'aligned-fasta' | 'clustal' | 'phylip' | 'nexus'   // alignments
  | 'mega' | 'stockholm' | 'pir' | 'msf'

/** What kind of item is being exported. */
export type ExportItemKind = 'sequence' | 'read' | 'alignment' | 'read-alignment' | 'contig'

/** One thing a file keeps or leaves out, for the dialog's summary. */
export interface Kept {
  label: string
  kept: boolean
  /** Said on hover. */
  detail?: string
}

export interface FormatOption {
  id: ExportFormat
  label: string
  ext: string
  description: string
  icon: typeof FileText
  annotationsOnly?: boolean
  /** A file holds one item: several are always written as separate files. */
  separateOnly?: boolean
  /** What the file keeps and leaves out, as checked by reading it back (see the README). */
  keeps?: Kept[]
}

const k = (label: string, kept: boolean, detail?: string): Kept => ({ label, kept, ...(detail ? { detail } : {}) })

const SEQUENCE_FORMATS: FormatOption[] = [
  {
    id: 'gb', label: 'GenBank', ext: '.gb', description: 'Sequence with its features and primers; opens in every editor', icon: Database,
    keeps: [k('Sequence', true), k('Features', true), k('Joined features', true), k('Primers', true, 'Where they bind; a primer that binds nowhere has no place'), k('Colours', true, "As ApE's colour qualifiers"), k('Topology', true), k('Description', true)],
  },
  {
    id: 'fasta', label: 'FASTA', ext: '.fasta', description: 'Sequence only, for BLAST, aligners and pipelines', icon: FileText,
    keeps: [k('Sequence', true), k('Features', false), k('Primers', false), k('Topology', false), k('Description', true)],
  },
  {
    id: 'dna', label: 'SnapGene', ext: '.dna', description: "SnapGene's own file, with features and primers", icon: Dna, separateOnly: true,
    keeps: [k('Sequence', true), k('Features', true), k('Joined features', true), k('Primers', true), k('Colours', true), k('Topology', true), k('Description', true)],
  },
  {
    id: 'embl', label: 'EMBL', ext: '.embl', description: "ENA's flat file, with the same features as GenBank", icon: Database,
    keeps: [k('Sequence', true), k('Features', true), k('Joined features', true), k('Primers', true, 'Where they bind; a primer that binds nowhere has no place'), k('Colours', true, "As ApE's colour qualifiers"), k('Topology', true), k('Description', true)],
  },
  {
    id: 'gff3', label: 'GFF3', ext: '.gff', description: 'Features without the sequence, for genome browsers', icon: List, annotationsOnly: true,
    keeps: [k('Sequence', false), k('Features', true), k('Joined features', true), k('Primers', true), k('Colours', true), k('Topology', true)],
  },
  {
    id: 'gff3-seq', label: 'GFF3 with sequence', ext: '.gff3', description: 'Features and the sequence in one file, which opens as a sequence again', icon: List, separateOnly: true,
    keeps: [k('Sequence', true), k('Features', true), k('Joined features', true), k('Primers', true), k('Colours', true), k('Topology', true), k('Description', false)],
  },
  {
    id: 'csv', label: 'CSV', ext: '.csv', description: 'Feature table for a spreadsheet', icon: Table, annotationsOnly: true,
    keeps: [k('Sequence', false), k('Features', true), k('Joined features', false, 'Each feature as one span'), k('Primers', false), k('Colours', true)],
  },
]

/** A protein: its GenBank record is GenPept, SnapGene's .dna and EMBL hold nucleotides only, and a protein has no topology. */
const PROTEIN_FORMATS: FormatOption[] = SEQUENCE_FORMATS
  .filter(f => f.id !== 'dna' && f.id !== 'embl')
  .map(f => ({
    ...f,
    ...(f.id === 'gb' ? { label: 'GenPept', ext: '.gp', description: 'Protein with its features; opens in every editor' } : {}),
    keeps: f.keeps?.filter(x => x.label !== 'Topology' && x.label !== 'Primers'),
  }))

const READ_FORMATS: FormatOption[] = [
  {
    id: 'fastq', label: 'FASTQ', ext: '.fastq', description: 'Trimmed and edited read with its quality scores', icon: Activity,
    keeps: [k('Bases', true), k('Edits', true), k('Trimming', true), k('Quality scores', true), k('Trace', false)],
  },
  {
    id: 'fasta', label: 'FASTA', ext: '.fasta', description: 'Trimmed and edited read, bases only', icon: FileText,
    keeps: [k('Bases', true), k('Edits', true), k('Trimming', true), k('Quality scores', false), k('Trace', false)],
  },
  {
    id: 'scf', label: 'SCF trace', ext: '.scf', description: 'The chromatogram with the edited calls, for any trace viewer', icon: Activity, separateOnly: true,
    keeps: [k('Bases', true), k('Edits', true), k('Trimming', false, 'The whole read: trace viewers ignore a clip'), k('Quality scores', true), k('Trace', true)],
  },
]

/** Formats that end a name at whitespace write it with underscores; Stockholm alone numbers a row from its source. */
const names = (kept: boolean, numbering = false) => [
  k('Names with spaces', kept, kept ? undefined : 'Spaces in names become underscores'),
  k('Row numbering', numbering, numbering ? 'As name/start-end' : 'A row cut from its source is numbered from 1'),
]

const ALIGNMENT_FORMATS: FormatOption[] = [
  { id: 'aligned-fasta', label: 'Aligned FASTA', ext: '.fasta', description: 'Aligned sequences with gap characters', icon: FileText, separateOnly: true, keeps: names(true) },
  { id: 'clustal', label: 'Clustal', ext: '.aln', description: 'Clustal ALN format with conservation', icon: AlignLeft, separateOnly: true, keeps: names(false) },
  { id: 'phylip', label: 'PHYLIP', ext: '.phy', description: 'For RAxML, IQ-TREE, PhyML and PHYLIP', icon: FileText, separateOnly: true, keeps: names(false) },
  { id: 'nexus', label: 'NEXUS', ext: '.nex', description: 'For MrBayes, PAUP*, BEAST and SplitsTree', icon: FileText, separateOnly: true, keeps: names(true) },
  { id: 'mega', label: 'MEGA', ext: '.meg', description: 'For MEGA phylogenetics', icon: FileText, separateOnly: true, keeps: names(true) },
  { id: 'stockholm', label: 'Stockholm', ext: '.sto', description: 'For HMMER, Pfam and Rfam', icon: FileText, separateOnly: true, keeps: names(false, true) },
  { id: 'pir', label: 'PIR / NBRF', ext: '.pir', description: 'For MODELLER and older protein tools', icon: FileText, separateOnly: true, keeps: names(false) },
  { id: 'msf', label: 'GCG MSF', ext: '.msf', description: 'For GCG, Jalview and older tools', icon: FileText, separateOnly: true, keeps: names(false) },
]

/**
 * The formats a kind can be written in. A protein document is a sequence
 * for export purposes, written as GenPept and FASTA; SnapGene's .dna is a
 * DNA format, so it is left out for one.
 */
export function formatsForKind(kind: ExportItemKind, protein = false): FormatOption[] {
  switch (kind) {
    case 'sequence': return protein ? PROTEIN_FORMATS : SEQUENCE_FORMATS
    case 'read': return READ_FORMATS
    case 'alignment':
    case 'read-alignment':
    case 'contig':
      return ALIGNMENT_FORMATS
  }
}

export function defaultFormatForKind(kind: ExportItemKind): ExportFormat {
  switch (kind) {
    case 'sequence': return 'gb'
    case 'read': return 'fastq'
    case 'alignment':
    case 'read-alignment':
    case 'contig':
      return 'aligned-fasta'
  }
}
