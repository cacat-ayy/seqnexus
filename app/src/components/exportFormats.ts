/**
 * What the export dialog can write, per kind of item. Kept apart from the
 * dialog so that menus and the explorer can ask for a kind's formats without
 * importing a component.
 */

import { FileText, Database, Dna, Table, List, Activity, AlignLeft } from 'lucide-react'

export type ExportFormat =
  | 'gb' | 'fasta' | 'dna' | 'gff3' | 'csv'           // sequences
  | 'fastq'                                             // sequencing reads
  | 'aligned-fasta' | 'clustal' | 'phylip' | 'nexus'   // alignments
  | 'mega' | 'stockholm' | 'pir' | 'msf'

/** What kind of item is being exported. */
export type ExportItemKind = 'sequence' | 'read' | 'alignment' | 'read-alignment' | 'contig'

export interface FormatOption {
  id: ExportFormat
  label: string
  ext: string
  description: string
  icon: typeof FileText
  annotationsOnly?: boolean
  separateOnly?: boolean
}

const SEQUENCE_FORMATS: FormatOption[] = [
  { id: 'gb', label: 'GenBank', ext: '.gb', description: 'Sequence, annotations, and features', icon: Database },
  { id: 'fasta', label: 'FASTA', ext: '.fasta', description: 'Sequence only, no annotations', icon: FileText },
  { id: 'dna', label: 'SnapGene', ext: '.dna', description: 'Binary format compatible with SnapGene', icon: Dna, separateOnly: true },
  { id: 'gff3', label: 'GFF3', ext: '.gff', description: 'Annotations for use in other tools', icon: List, annotationsOnly: true },
  { id: 'csv', label: 'CSV', ext: '.csv', description: 'Feature table as a spreadsheet', icon: Table, annotationsOnly: true },
]

const READ_FORMATS: FormatOption[] = [
  { id: 'fasta', label: 'FASTA', ext: '.fasta', description: 'Trimmed sequence only', icon: FileText },
  { id: 'fastq', label: 'FASTQ', ext: '.fastq', description: 'Trimmed sequence with quality scores', icon: Activity },
]

const ALIGNMENT_FORMATS: FormatOption[] = [
  { id: 'aligned-fasta', label: 'Aligned FASTA', ext: '.fasta', description: 'Aligned sequences with gap characters', icon: FileText },
  { id: 'clustal', label: 'Clustal', ext: '.aln', description: 'Clustal ALN format with conservation', icon: AlignLeft },
  { id: 'phylip', label: 'PHYLIP', ext: '.phy', description: 'For RAxML, IQ-TREE, PhyML and PHYLIP', icon: FileText },
  { id: 'nexus', label: 'NEXUS', ext: '.nex', description: 'For MrBayes, PAUP*, BEAST and SplitsTree', icon: FileText },
  { id: 'mega', label: 'MEGA', ext: '.meg', description: 'For MEGA phylogenetics', icon: FileText },
  { id: 'stockholm', label: 'Stockholm', ext: '.sto', description: 'For HMMER, Pfam and Rfam', icon: FileText },
  { id: 'pir', label: 'PIR / NBRF', ext: '.pir', description: 'For MODELLER and older protein tools', icon: FileText },
  { id: 'msf', label: 'GCG MSF', ext: '.msf', description: 'For GCG, Jalview and older tools', icon: FileText },
]

export function formatsForKind(kind: ExportItemKind): FormatOption[] {
  switch (kind) {
    case 'sequence': return SEQUENCE_FORMATS
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
    case 'read': return 'fasta'
    case 'alignment':
    case 'read-alignment':
    case 'contig':
      return 'aligned-fasta'
  }
}
