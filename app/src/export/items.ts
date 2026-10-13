/**
 * The files the Export dialog writes, one item at a time.
 *
 * Kept out of App so the rules can be tested: which writer a format uses,
 * what extension a file gets (a protein's GenBank is GenPept, .gp), which
 * formats can hold several items in one file, and what an export cannot
 * carry and should say so.
 */

import type { DocumentState } from '../models/Document'
import type { AlnDoc } from '../msa/model'
import type { SequencingRead } from '../sanger/read-edits'
import type { Contig } from '../store'
import type { ExportFormat } from '../components/exportFormats'
import { writeGenBank, unwrittenPrimers } from '../io/genbank'
import { writeSnapGene } from '../io/snapgene'
import { writeGff3 } from '../io/gff3'
import { writeCsv } from '../io/csv'
import { writeFastaRecord } from '../io/fasta'
import { writeEmbl } from '../io/embl'
import { editedRead, editedTrace, toFasta, toFastq } from '../sanger/edits'
import { writeScf } from '../io/scf'
import { writeAlignment, type AlnFormatId } from '../msa/formats'
import { contigToAlignment } from '../assembly/export'

/** One thing to export, resolved from the store. */
export type ExportItem =
  | { kind: 'sequence'; doc: DocumentState }
  | { kind: 'read'; read: SequencingRead }
  | { kind: 'alignment'; name: string; doc: AlnDoc }
  | { kind: 'contig'; contig: Contig }

/** An item written in a format: the file's contents, its base name and extension. */
export interface ItemFile {
  data: string | ArrayBuffer
  mime: string
  base: string
  ext: string
}

/** Export dialog format ids to alignment writers. */
const ALN_FORMAT: Partial<Record<ExportFormat, AlnFormatId>> = {
  'aligned-fasta': 'fasta', clustal: 'clustal', phylip: 'phylip', nexus: 'nexus',
  mega: 'mega', stockholm: 'stockholm', pir: 'pir', msf: 'msf',
}

const ALN_EXT: Record<AlnFormatId, string> = {
  fasta: '.fasta', clustal: '.aln', phylip: '.phy', nexus: '.nex', mega: '.meg', stockholm: '.sto', pir: '.pir', msf: '.msf',
}

/**
 * Formats that hold several items in one file and read back as several:
 * GenBank, EMBL and FASTA records, FASTQ reads. An alignment file holds one
 * alignment (two concatenated read back as the first, or as one unaligned
 * set), and GFF3 and CSV are offered for one sequence only.
 */
export function combinable(format: ExportFormat): boolean {
  return format === 'gb' || format === 'embl' || format === 'fasta' || format === 'fastq'
}

/** A name without the characters file systems refuse. */
const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export'
/** A name for formats and files where whitespace ends the name. */
const oneWord = (s: string) => fileSafe(s).replace(/\s+/g, '_')

/** The item's name, as it goes into a file name. */
export function itemBaseName(item: ExportItem): string {
  switch (item.kind) {
    case 'sequence': return fileSafe(item.doc.name)
    case 'read': return oneWord(item.read.data.name)
    case 'alignment': return oneWord(item.name)
    case 'contig': return oneWord(item.contig.name)
  }
}

function sequenceFile(d: DocumentState, format: ExportFormat): ItemFile {
  const base = fileSafe(d.name)
  const text = (data: string, ext: string, mime = 'text/plain'): ItemFile => ({ data, mime, base, ext })
  const protein = d.sequence.alphabet === 'protein'
  // SnapGene's .dna holds DNA; a protein goes out as GenPept instead.
  if (format === 'dna' && !protein) return { data: writeSnapGene(d), mime: 'application/octet-stream', base, ext: '.dna' }
  if (format === 'gb' || format === 'dna') return text(writeGenBank(d) + '\n', protein ? '.gp' : '.gb')
  if (format === 'gff3') return text(writeGff3(d), '.gff')
  if (format === 'gff3-seq') return text(writeGff3(d, { withSequence: true }), '.gff3')
  // EMBL holds nucleotides; a protein falls through to FASTA.
  if (format === 'embl' && !protein) return text(writeEmbl(d), '.embl')
  if (format === 'csv') return text(writeCsv(d), '.csv', 'text/csv')
  return text(writeFastaRecord(d.name, d.sequence.bases, d.description), '.fasta')
}

/** An item in a format. Formats that do not fit the kind fall back to the kind's FASTA. */
export function itemFile(item: ExportItem, format: ExportFormat): ItemFile {
  const base = itemBaseName(item)
  switch (item.kind) {
    case 'sequence':
      return sequenceFile(item.doc, format)
    case 'read': {
      // The trace in its recorded orientation; a reversed view is a view.
      if (format === 'scf') {
        return { data: writeScf(editedTrace(item.read.data, item.read.edits)), mime: 'application/octet-stream', base, ext: '.scf' }
      }
      const r = editedRead(item.read.data, item.read.edits, item.read.trimStart, item.read.trimEnd, { reversed: !!item.read.reversed })
      return format === 'fastq'
        ? { data: toFastq(base, r), mime: 'text/plain', base, ext: '.fastq' }
        : { data: toFasta(base, r.bases), mime: 'text/plain', base, ext: '.fasta' }
    }
    case 'alignment':
    case 'contig': {
      const id = ALN_FORMAT[format] ?? 'fasta'
      const doc = item.kind === 'alignment' ? item.doc : contigToAlignment(item.contig.doc, item.contig.name, item.contig.view.consensus)
      const title = item.kind === 'alignment' ? item.name : item.contig.name
      return { data: writeAlignment(doc, id, { title }), mime: 'text/plain', base, ext: ALN_EXT[id] }
    }
  }
}

/**
 * What the files will leave out that the user would not expect: primers a
 * GenBank or GFF3 file cannot place because they bind nowhere.
 */
export function exportWarnings(items: readonly ExportItem[], format: ExportFormat): string[] {
  if (format !== 'gb' && format !== 'embl' && format !== 'gff3' && format !== 'gff3-seq') return []
  const out: string[] = []
  for (const item of items) {
    if (item.kind !== 'sequence') continue
    const names = unwrittenPrimers(item.doc)
    if (names.length > 0) {
      out.push(`${item.doc.name}: ${names.length === 1 ? `the primer ${names[0]} binds` : `${names.length} primers (${names.join(', ')}) bind`} nowhere on the sequence, so the file has no place for ${names.length === 1 ? 'it' : 'them'}.`)
    }
  }
  return out
}
