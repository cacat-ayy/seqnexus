/**
 * The ORF table as files: the proteins or the coding bases as FASTA, or the
 * table itself as CSV.
 *
 * Positions are written as the table shows them: 1-based, from the
 * sequence's display origin, first..last base. Frames are written in ASCII
 * (+1, -1): a FASTA header or a CSV cell is read by tools that may not take
 * the minus sign the app draws.
 */

import { Annotation } from '../models/Annotation'
import { displayPosition } from '../models/Document'
import type { Sequence } from '../models/Sequence'
import { annotationCodingBases, annotationProtein } from '../utils/annotation-sequence'
import { orfCodons, orfOverlayData } from '../utils/orf-features'
import { csvRow } from '../utils/csv-cell'
import { writeFastaRecord } from '../io/fasta'
import { proteinMass } from '../protein/properties'
import { orfAminoAcids, type ORFResult } from './finder'

export interface OrfExportSource {
  /** The sequence's name, which every record id starts with. */
  name: string
  sequence: Sequence
  geneticCodeId: number
  /** The display origin positions are counted from (0 = none). */
  origin: number
}

/** The protein an ORF encodes, without its stop, read as the overlay reads it. */
export function orfProtein(orf: ORFResult, sequence: Sequence, geneticCodeId: number): string {
  return annotationProtein(new Annotation(orfOverlayData(orf, geneticCodeId)), sequence).replace(/\*$/, '')
}

/** An ORF's bases on its own strand, 5' to 3', the stop codon included when it has one. */
export function orfBases(orf: ORFResult, sequence: Sequence): string {
  return annotationCodingBases(new Annotation(orfOverlayData(orf)), sequence)
}

/** The ORF's length in bases, across the origin if it wraps. */
export function orfLengthBp(orf: ORFResult, seqLength: number): number {
  return orf.end > orf.start ? orf.end - orf.start : seqLength - orf.start + orf.end
}

const asciiFrame = (orf: ORFResult) => `${orf.strand === 1 ? '+' : '-'}${orf.frame + 1}`

function partialWord(orf: ORFResult): string {
  if (orf.partialStart && orf.partialEnd) return "5' and 3'"
  if (orf.partialStart) return "5'"
  return orf.partialEnd ? "3'" : ''
}

function span(orf: ORFResult, src: OrfExportSource): [number, number] {
  const L = src.sequence.length
  return [displayPosition(orf.start, src.origin, L), displayPosition(orf.end - 1, src.origin, L)]
}

/**
 * One FASTA record per ORF, numbered in the order given: the protein (one
 * letter per residue, no stop) or the coding bases (the stop included).
 * The header says the frame, the place, the length and whether it is partial.
 */
export function orfsFasta(orfs: readonly ORFResult[], src: OrfExportSource, kind: 'protein' | 'bases'): string {
  return orfs.map((orf, i) => {
    const [first, last] = span(orf, src)
    const partial = partialWord(orf)
    const description = [
      `frame ${asciiFrame(orf)}`,
      `${first}..${last}`,
      `${orfAminoAcids(orf)} aa`,
      ...(partial ? [`partial ${partial}`] : []),
    ].join(' ')
    const seq = kind === 'protein' ? orfProtein(orf, src.sequence, src.geneticCodeId) : orfBases(orf, src.sequence)
    return writeFastaRecord(`${src.name}_ORF${i + 1}`, seq, description)
  }).join('')
}

const CSV_HEADER = [
  'ORF', 'Frame', 'Strand', 'First', 'Last', 'Residues', 'Bases',
  'Start codon', 'Stop codon', 'Partial', 'Mass (Da)', 'Protein',
]

/** The table as CSV: a row per ORF, numbered as the FASTA records are. */
export function orfsCsv(orfs: readonly ORFResult[], src: OrfExportSource): string {
  const L = src.sequence.length
  const rows = orfs.map((orf, i) => {
    const [first, last] = span(orf, src)
    const codons = orfCodons(orf, src.sequence)
    const protein = orfProtein(orf, src.sequence, src.geneticCodeId)
    return csvRow([
      `ORF${i + 1}`,
      asciiFrame(orf),
      orf.strand === 1 ? '+' : '-',
      first,
      last,
      orfAminoAcids(orf),
      orfLengthBp(orf, L),
      codons.start ?? '',
      codons.stop ?? '',
      partialWord(orf),
      proteinMass(protein).average.toFixed(1),
      protein,
    ])
  })
  return [csvRow(CSV_HEADER), ...rows].join('\n') + '\n'
}
