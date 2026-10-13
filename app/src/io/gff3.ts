/**
 * GFF3 writer and reader.
 *
 * Exports annotations as GFF3 (Generic Feature Format version 3).
 * Coordinates are converted from 0-based half-open to 1-based inclusive.
 * See: https://github.com/The-Sequence-Ontology/Specifications/blob/master/gff3.md
 */

import type { DocumentState } from '../models/Document'
import { Annotation, type AnnotationData, type Strand } from '../models/Annotation'
import { Sequence } from '../models/Sequence'
import { guessAlphabet } from '../models/alphabet'
import { readFasta, recordName, writeFastaRecord } from './fasta'
import { resolveForward } from './location'
import { idSource } from './ids'
import { primerFeatures, primersFromFeatures } from './genbank'
import type { PrimerData } from '../primers/oligo'

const gffIds = idSource('gff')

/** Characters that must be percent-encoded in GFF3 column 9 values. */
function encodeGff3(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/;/g, '%3B')
    .replace(/=/g, '%3D')
    .replace(/&/g, '%26')
    .replace(/,/g, '%2C')
    .replace(/\t/g, '%09')
    .replace(/\n/g, '%0A')
    .replace(/\r/g, '%0D')
}

/**
 * The phase of each part of a CDS, in the order of `parts` (top strand):
 * the bases to skip at the start of the part, read in the direction of
 * transcription, to reach the first base of a codon. /codon_start moves the
 * first codon. GFF3 requires a phase on every CDS line.
 */
function cdsPhases(parts: readonly [number, number][], strand: number, codonStart: number): number[] {
  const order = strand === -1 ? [...parts.keys()].reverse() : [...parts.keys()]
  const phases = new Array<number>(parts.length)
  let before = -(codonStart - 1)
  for (const k of order) {
    phases[k] = ((3 - (before % 3)) % 3 + 3) % 3
    before += parts[k][1] - parts[k][0]
  }
  return phases
}

/**
 * The document as GFF3. A whole-sequence region carries the topology
 * (Is_circular=true), so the file reopens onto the right kind of sequence.
 * A feature in several parts is one line per part sharing an ID, as the
 * specification has it; a part list that crosses the origin is marked
 * Is_circular=true so the reader keeps the parts in file order. A feature
 * crossing the origin in one piece runs to the end with circular_end
 * giving where it stops. A site between two bases (start = end) is written
 * on the base before it, the specification's way, with zero_length=true so
 * it is not read as a one-base feature. Primers go out as primer_bind
 * lines carrying their oligo, as in GenBank.
 */
export function writeGff3(doc: DocumentState, opts: { withSequence?: boolean } = {}): string {
  const seqLen = doc.sequence.bases.length
  const circular = doc.sequence.topology === 'circular'
  const seqId = encodeGff3(doc.name.trim().replace(/\s+/g, '_') || 'sequence')
  const lines: string[] = ['##gff-version 3', `##sequence-region ${seqId} 1 ${seqLen}`]
  // seqid  source  type  start  end  score  strand  phase  attributes
  const row = (type: string, start: number, end: number, strand: string, phase: string, attrs: string[]) =>
    lines.push(`${seqId}\tSeqNexus\t${type}\t${start}\t${end}\t.\t${strand}\t${phase}\t${attrs.join(';')}`)

  if (seqLen > 0) row('region', 1, seqLen, '.', '.', [`ID=${seqId}_region`, ...(circular ? ['Is_circular=true'] : [])])

  for (const ann of [...doc.annotations, ...primerFeatures(doc)]) {
    const strand = ann.strand === 1 ? '+' : ann.strand === -1 ? '-' : '.'
    const type = ann.type || 'region'
    const attrs: string[] = [`ID=${encodeGff3(ann.id)}`, `Name=${encodeGff3(ann.name)}`]
    if (ann.color) attrs.push(`color=${encodeGff3(ann.color)}`)
    // Name carries the current name; any further labels are kept as they are.
    for (const [key, values] of Object.entries(ann.qualifiers ?? {})) {
      for (const val of key === 'label' ? values.slice(1) : values) attrs.push(`${encodeGff3(key)}=${encodeGff3(val)}`)
    }

    if (ann.start === ann.end) {
      const base = ann.start > 0 ? ann.start : circular ? seqLen : 1
      row(type, base, base, strand, '.', [...attrs, 'zero_length=true'])
      continue
    }
    const parts: [number, number][] = ann.segments
      ? ann.segments.map(([s, e]) => [s, e])
      : ann.start < ann.end ? [[ann.start, ann.end]] : [[ann.start, seqLen]]
    const wrapped = ann.start > ann.end
    const marks = wrapped ? (ann.segments ? ['Is_circular=true'] : ['Is_circular=true', `circular_end=${ann.end}`]) : []
    const codonStart = Number(ann.qualifiers?.codon_start?.[0]) || 1
    const phases = type === 'CDS'
      ? cdsPhases(ann.segments ? parts : [[ann.start, wrapped ? ann.end + seqLen : ann.end]], ann.strand, codonStart)
      : null
    parts.forEach(([s, e], k) => row(type, s + 1, e, strand, phases ? String(phases[k]) : '.', [...attrs, ...marks]))
  }

  // The sequence in a ##FASTA section, so the file opens as a sequence again
  // rather than needing one open to land on. Its header is the seqid, then
  // the name in full, which the reader takes back as a name with spaces.
  if (opts.withSequence) lines.push('##FASTA', writeFastaRecord(doc.name, doc.sequence.bases).trimEnd())
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Sequence Ontology terms GFF3 uses, mapped to the GenBank feature keys the
 * app draws and exports. A term not listed is kept as written: it still
 * shows, and goes back out under the same name.
 */
const SO_TO_KEY: Record<string, string> = {
  five_prime_UTR: "5'UTR",
  three_prime_UTR: "3'UTR",
  origin_of_replication: 'rep_origin',
  primer_binding_site: 'primer_bind',
  signal_peptide: 'sig_peptide',
  transit_peptide: 'transit_peptide',
  mature_protein_region: 'mat_peptide',
  polyA_signal_sequence: 'polyA_signal',
  polyA_site: 'polyA_site',
  binding_site: 'misc_binding',
  protein_binding_site: 'protein_bind',
  sequence_feature: 'misc_feature',
  biological_region: 'misc_feature',
  region: 'misc_feature',
  repeat_region: 'repeat_region',
  pseudogene: 'gene',
}

/** Column 9 keys that are GFF3 structure, not qualifiers to keep. */
const RESERVED_ATTRS = new Set(['ID', 'Name', 'Parent', 'color', 'Is_circular', 'circular_end', 'zero_length', 'Alias', 'Target', 'Gap', 'Derives_from'])

/** Qualifier names GFF3 spells differently from GenBank. */
const ATTR_TO_QUALIFIER: Record<string, string> = {
  Note: 'note',
  Dbxref: 'db_xref',
  Ontology_term: 'ontology_term',
}

export interface Gff3Read {
  /** Features by seqid, in file order. */
  features: Map<string, AnnotationData[]>
  /** Primers by seqid: primer_bind lines that carry their oligo (/primer_sequence). */
  primers: Map<string, PrimerData[]>
  /** Sequences from a ##FASTA section, by the first word of their header. */
  sequences: Map<string, { bases: string; description?: string }>
  /** Lengths from ##sequence-region lines. */
  lengths: Map<string, number>
  /** Seqids a whole-sequence region marks Is_circular=true. */
  circular: Set<string>
  /** Lines that could not be read, said in words. */
  warnings: string[]
}

const decodeGff3 = (s: string): string => {
  try { return decodeURIComponent(s) } catch { return s }
}

/** Is this text GFF3? Its first line says so. */
export function looksLikeGff3(text: string): boolean {
  return /^##gff-version\s+3/.test(text.trimStart())
}

/**
 * Read GFF3: its features, grouped by seqid, and the sequences of a
 * ##FASTA section when there is one.
 *
 * Lines that share an ID are one feature in several parts (the exons of a
 * CDS), as the GFF3 specification has it, and become one feature with
 * segments. Coordinates go from 1-based inclusive to 0-based half-open. A
 * feature the writer marked as crossing the origin (Is_circular=true with
 * circular_end) is put back across the origin. A region spanning a whole
 * sequence is that sequence's source and is not kept as a feature; its
 * Is_circular=true makes the sequence circular.
 */
export function readGff3(text: string): Gff3Read {
  gffIds.reset()
  const out: Gff3Read = { features: new Map(), primers: new Map(), sequences: new Map(), lengths: new Map(), circular: new Set(), warnings: [] }
  const lines = text.split(/\r?\n/)
  type Part = { type: string; start: number; end: number; strand: Strand; attrs: Map<string, string[]> }
  const groups = new Map<string, Map<string, Part[]>>()
  const order: [string, string][] = []
  let anonymous = 0

  let i = 0
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('##FASTA')) { i++; break }
    if (line.startsWith('##sequence-region')) {
      const [, seqid, , end] = line.trim().split(/\s+/)
      if (seqid && Number(end) > 0) out.lengths.set(seqid, Number(end))
      continue
    }
    if (!line.trim() || line.startsWith('#')) continue
    const cols = line.split('\t')
    if (cols.length < 9) {
      out.warnings.push(`Line ${i + 1} has ${cols.length} columns, not 9, so it was skipped`)
      continue
    }
    const [seqid, , type, startCol, endCol, , strandCol, , attrCol] = cols
    const start = Number(startCol)
    const end = Number(endCol)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      out.warnings.push(`Line ${i + 1}: positions ${startCol}..${endCol} could not be read, so it was skipped`)
      continue
    }
    const attrs = new Map<string, string[]>()
    for (const pair of attrCol.split(';')) {
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      attrs.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).split(',').map(decodeGff3))
    }
    const strand: Strand = strandCol === '+' ? 1 : strandCol === '-' ? -1 : 0
    const id = attrs.get('ID')?.[0] ?? `#${++anonymous}`
    const sid = decodeGff3(seqid)
    let bySeq = groups.get(sid)
    if (!bySeq) groups.set(sid, bySeq = new Map())
    const parts = bySeq.get(id)
    if (parts) parts.push({ type, start, end, strand, attrs })
    else { bySeq.set(id, [{ type, start, end, strand, attrs }]); order.push([sid, id]) }
  }

  // ##FASTA: the sequences, named as the seqids are.
  if (i < lines.length) {
    const read = readFasta(lines.slice(i).join('\n'), 'sequence')
    for (const rec of [...read.records, ...read.proteins]) {
      out.sequences.set(rec.name, { bases: rec.bases, ...(rec.description ? { description: rec.description } : {}) })
    }
  }

  for (const [seqid, id] of order) {
    const parts = groups.get(seqid)!.get(id)!
    const first = parts[0]
    const seqLen = out.sequences.get(seqid)?.bases.length ?? out.lengths.get(seqid) ?? 0
    const circularMark = first.attrs.get('Is_circular')?.[0] === 'true'
    // The whole-sequence region is the record itself.
    if (parts.length === 1 && (first.type === 'region' || first.type === 'source') && seqLen > 0 && first.start === 1 && first.end === seqLen) {
      if (circularMark) out.circular.add(seqid)
      continue
    }
    const wrapEnd = Number(first.attrs.get('circular_end')?.[0])
    let start: number
    let end: number
    let segments: [number, number][] | undefined
    if (parts.length === 1 && first.attrs.get('zero_length')?.[0] === 'true') {
      // A site between two bases, written on the base before it.
      start = end = first.end === seqLen && out.circular.has(seqid) ? 0 : first.end
    } else if (parts.length === 1 && circularMark && Number.isInteger(wrapEnd)) {
      // Written by writeGff3 as [start, seqLen] with the true end alongside.
      start = first.start - 1
      end = wrapEnd
    } else {
      // Parts marked as crossing the origin are in order along the top
      // strand from the feature's start; any others are sorted.
      const pieces = parts.map(p => [p.start - 1, p.end] as [number, number])
      if (!circularMark) pieces.sort((a, b) => a[0] - b[0])
      const resolved = resolveForward(pieces, first.strand, seqLen, circularMark)
      if (!resolved) continue
      start = resolved.start
      end = resolved.end
      segments = resolved.segments
    }
    const qualifiers: Record<string, string[]> = {}
    for (const [key, values] of first.attrs) {
      if (RESERVED_ATTRS.has(key)) continue
      qualifiers[ATTR_TO_QUALIFIER[key] ?? key] = values
    }
    const name = first.attrs.get('Name')?.[0] ?? qualifiers.gene?.[0] ?? qualifiers.product?.[0]
      ?? (id.startsWith('#') ? undefined : id) ?? first.type
    const color = first.attrs.get('color')?.[0]
    const feature: AnnotationData = {
      id: gffIds.next(),
      name,
      type: SO_TO_KEY[first.type] ?? first.type,
      start,
      end,
      strand: first.strand,
      ...(Object.keys(qualifiers).length > 0 ? { qualifiers } : {}),
      ...(color ? { color } : {}),
      ...(segments ? { segments } : {}),
    }
    const list = out.features.get(seqid)
    if (list) list.push(feature)
    else out.features.set(seqid, [feature])
  }
  // Primers written as primer_bind lines with their oligo are primers again.
  for (const [seqid, features] of out.features) {
    const { primers, rest } = primersFromFeatures(features)
    if (primers.length === 0) continue
    out.primers.set(seqid, primers)
    if (rest.length > 0) out.features.set(seqid, rest)
    else out.features.delete(seqid)
  }
  return out
}

/** The sequences of a GFF3 file with a ##FASTA section, each with its features. */
export function gff3Documents(read: Gff3Read): DocumentState[] {
  return [...read.sequences].map(([seqid, seq]) => {
    const alphabet = guessAlphabet(seq.bases)
    return {
      // A seqid written with underscores for a name with spaces comes back with them.
      ...recordName({ name: seqid, bases: seq.bases, ...(seq.description ? { description: seq.description } : {}) }),
      sequence: new Sequence(seq.bases, read.circular.has(seqid) && alphabet !== 'protein' ? 'circular' : 'linear', alphabet),
      annotations: (read.features.get(seqid) ?? []).map(d => new Annotation(d)),
      ...(read.primers.get(seqid)?.length ? { primers: read.primers.get(seqid) } : {}),
    }
  })
}

/**
 * The open sequence a seqid names: by name, or by the name as the writer
 * spells it (spaces as underscores), ignoring case.
 */
export function matchSeqid<T extends { doc: { name: string } }>(seqid: string, tabs: readonly T[]): T | undefined {
  const key = seqid.toLowerCase()
  return tabs.find(t => t.doc.name.toLowerCase() === key)
    ?? tabs.find(t => t.doc.name.replace(/\s+/g, '_').toLowerCase() === key)
}
