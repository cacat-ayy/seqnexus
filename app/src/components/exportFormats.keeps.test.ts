/**
 * The export dialog tells the user what each file keeps and what it leaves
 * out. This measures every one of those claims by writing a probe item and
 * reading it back, so the table in `exportFormats.ts` cannot drift from what
 * the writers actually do.
 *
 * A claim is measured, never assumed: the probe carries one feature of each
 * awkward shape (joined, origin-crossing, coloured), a primer, a
 * description and a topology, and each label has a measure that says whether
 * that property survived. Formats this app does not read back (the feature
 * table as CSV, GFF3 without the sequence) are measured on the text of the
 * file instead, which is all a claim about them can mean.
 */
import { describe, it, expect } from 'vitest'
import { formatsForKind, type ExportFormat, type Kept } from './exportFormats'
import { itemFile } from '../export/items'
import { parseGenBank } from '../io/genbank'
import { parseEmbl } from '../io/embl'
import { readFasta } from '../io/fasta'
import { parseSnapGene } from '../io/snapgene'
import { gff3Documents, readGff3 } from '../io/gff3'
import { parseScf } from '../io/scf'
import { parseFastq } from '../io/fastq'
import { readAlignment } from '../msa/formats'
import { Sequence } from '../models/Sequence'
import { Annotation } from '../models/Annotation'
import type { DocumentState } from '../models/Document'
import { makeDoc } from '../msa/model'
import { buildAbif, strBytes, uint16Bytes, int16Bytes } from '../io/abif-testing'
import { parseAb1 } from '../io/ab1'
import type { SequencingRead } from '../sanger/read-edits'

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

const BASES = 'ATGCCGTTGTTTAATCTGTGAGTTACCGGACTTAAGGCCTTCAGGATCCAAGCTTGGTACCGAGCTCGGATCCACTAGTAACGGCCGCCAGTGTGCTGGAA'
const PRIMER = BASES.slice(10, 30)

/** A sequence with one feature of every awkward shape, a primer and a description. */
function probeDoc(): DocumentState {
  return {
    name: 'probe plasmid',
    description: 'a probe record',
    sequence: new Sequence(BASES, 'circular'),
    annotations: [
      new Annotation({ id: 'f1', name: 'plain', type: 'misc_feature', start: 5, end: 25, strand: 1, color: '#ff00aa', qualifiers: { note: ['a note'] } }),
      new Annotation({ id: 'f2', name: 'joined', type: 'CDS', start: 30, end: 70, strand: -1, segments: [[30, 40], [60, 70]] }),
      new Annotation({ id: 'f3', name: 'wraps', type: 'gene', start: 95, end: 10, strand: 1 }),
    ],
    primers: [{ id: 'p1', name: 'fwd primer', sequence: PRIMER, role: 'primer' }],
  }
}

function probeProtein(): DocumentState {
  return {
    name: 'probe protein',
    description: 'a probe protein',
    sequence: new Sequence('MKTAYIAKQRQISFVKSHFSRQLEDMPVAWK', 'linear', 'protein'),
    annotations: [
      new Annotation({ id: 'f1', name: 'plain', type: 'Region', start: 2, end: 12, strand: 1, color: '#ff00aa', qualifiers: { note: ['a note'] } }),
      new Annotation({ id: 'f2', name: 'joined', type: 'Domain', start: 14, end: 28, strand: 1, segments: [[14, 18], [24, 28]] }),
    ],
  }
}

const READ_BASES = 'ACGTACGTTTGGCCAATTGACGTTAGCCAGGTTACCGGATTCAGGATCCAAGCTTGGTACCGAGCTCGGATCCACTAGTAACGGCCGCCAGTGTGCTGGA'
const READ_QUALS = Array.from(READ_BASES, (_, i) => (i < 8 || i >= 92 ? 6 : 40))

function probeRead(): SequencingRead {
  const peaks = Array.from(READ_BASES, (_, i) => 10 + i * 15)
  const len = peaks[peaks.length - 1] + 10
  const channel = (base: string) => Array.from({ length: len }, (_, i) => (peaks.some((p, k) => p === i && READ_BASES[k] === base) ? 1000 : 50))
  const ab1 = buildAbif([
    { tag: 'PBAS', num: 2, type: 2, elemSize: 1, data: strBytes(READ_BASES) },
    { tag: 'PLOC', num: 2, type: 3, elemSize: 2, data: uint16Bytes(peaks) },
    { tag: 'PCON', num: 2, type: 1, elemSize: 1, data: READ_QUALS },
    { tag: 'FWO_', num: 1, type: 2, elemSize: 1, data: strBytes('GATC') },
    ...(['G', 'A', 'T', 'C'] as const).map((b, i) => ({ tag: 'DATA', num: 9 + i, type: 4, elemSize: 2, data: int16Bytes(channel(b)) })),
  ])
  const data = parseAb1(ab1)
  data.name = 'probe read'
  return {
    id: 'r1', data, createdAt: 0, trimStart: 8, trimEnd: 92, trimBy: 'hand',
    // One edited base, so "Edits" can be measured.
    edits: [{ type: 'substitute', pos: 20, original: data.bases[20], base: 'N' }],
    undoStack: [], redoStack: [],
  }
}

const alnDoc = () => makeDoc([
  { name: 'row one', seq: 'ACGT-ACGTACGT' },
  { name: 'row two', seq: 'ACGT-ACG--CGT', start: 101 },
], { method: 'import', at: 0 }, 'dna')

// ---------------------------------------------------------------------------
// Reading a written file back
// ---------------------------------------------------------------------------

function readSequence(format: ExportFormat, file: { data: string | ArrayBuffer }, protein: boolean): DocumentState | null {
  const text = typeof file.data === 'string' ? file.data : ''
  switch (format) {
    case 'gb': return parseGenBank(text)
    case 'embl': return protein ? null : parseEmbl(text)[0]
    case 'dna': return protein ? null : parseSnapGene(file.data as ArrayBuffer)
    case 'gff3-seq': return gff3Documents(readGff3(text))[0] ?? null
    case 'fasta': {
      const r = readFasta(text, 'x', protein)
      const rec = (protein ? r.proteins : r.records)[0]
      return rec ? { name: rec.name, description: rec.description, sequence: new Sequence(rec.bases, 'linear', protein ? 'protein' : 'dna'), annotations: [] } : null
    }
    default: return null
  }
}

/** Whether a property survived, by label, for a sequence format. */
function sequenceKept(label: string, format: ExportFormat, doc: DocumentState): boolean {
  const protein = doc.sequence.alphabet === 'protein'
  const file = itemFile({ kind: 'sequence', doc }, format)
  const text = typeof file.data === 'string' ? file.data : ''
  const back = readSequence(format, file, protein)
  const named = (n: string) => back?.annotations.find(a => a.name === n)
  switch (label) {
    case 'Sequence':
      return !!back && back.sequence.bases.toUpperCase() === doc.sequence.bases.toUpperCase()
    case 'Features':
      // Annotation-only formats are measured on the file: nothing reads a
      // feature table back on its own.
      if (!back) return doc.annotations.every(a => text.includes(a.name))
      return doc.annotations.every(a => {
        const got = named(a.name)
        return !!got && got.start === a.start && got.end === a.end && got.type === a.type
      })
    case 'Joined features': {
      if (!back) return text.split('\n').filter(l => l.includes('joined')).length > 1
      const got = named('joined')
      return !!got?.segments && got.segments.length === 2
    }
    case 'Primers': {
      if (!back) return text.includes('fwd primer')
      return (back.primers ?? []).some(p => p.name === 'fwd primer' && p.sequence.toUpperCase() === PRIMER)
    }
    case 'Colours': {
      if (!back) return text.toLowerCase().includes('#ff00aa')
      return named('plain')?.color.toLowerCase() === '#ff00aa'
    }
    case 'Topology':
      // The feature table on its own carries it on the landmark feature.
      if (!back) return /Is_circular=true/.test(text)
      return back.sequence.topology === doc.sequence.topology
    case 'Description':
      return !!back && back.description === doc.description
    default:
      throw new Error(`no measure for sequence label "${label}"`)
  }
}

function readKept(label: string, format: ExportFormat, read: SequencingRead): boolean {
  const file = itemFile({ kind: 'read', read }, format)
  const text = typeof file.data === 'string' ? file.data : ''
  const kept = READ_BASES.slice(read.trimStart, read.trimEnd)
  const edited = kept.slice(0, 12) + 'N' + kept.slice(13)
  switch (label) {
    case 'Bases':
      if (format === 'scf') return parseScf(file.data as ArrayBuffer).bases.length === READ_BASES.length
      return (format === 'fastq' ? parseFastq(text)[0].bases : readFasta(text, 'x').records[0].bases).length === kept.length
    case 'Edits': {
      if (format === 'scf') return parseScf(file.data as ArrayBuffer).bases[20] === 'N'
      const bases = format === 'fastq' ? parseFastq(text)[0].bases : readFasta(text, 'x').records[0].bases
      return bases === edited
    }
    case 'Trimming': {
      if (format === 'scf') return parseScf(file.data as ArrayBuffer).bases.length === kept.length
      const bases = format === 'fastq' ? parseFastq(text)[0].bases : readFasta(text, 'x').records[0].bases
      return bases.length === kept.length
    }
    case 'Quality scores':
      if (format === 'scf') return parseScf(file.data as ArrayBuffer).qualityScores.some(q => q > 0)
      return format === 'fastq' && parseFastq(text)[0].qualityScores.length > 0
    case 'Trace':
      return format === 'scf' && parseScf(file.data as ArrayBuffer).traces.A.length > 0
    default:
      throw new Error(`no measure for read label "${label}"`)
  }
}

function alignmentKept(label: string, format: ExportFormat): boolean {
  const doc = alnDoc()
  const file = itemFile({ kind: 'alignment', name: 'probe alignment', doc }, format)
  const back = readAlignment(file.data as string, `x${file.ext}`).doc
  switch (label) {
    case 'Names with spaces':
      return back.rows[0].name === 'row one'
    case 'Row numbering':
      return back.rows[1].start === 101
    default:
      throw new Error(`no measure for alignment label "${label}"`)
  }
}

// ---------------------------------------------------------------------------
// The claims
// ---------------------------------------------------------------------------

const claims = (kind: Parameters<typeof formatsForKind>[0], protein = false) =>
  formatsForKind(kind, protein).flatMap(f => (f.keeps ?? []).map((k: Kept) => [f.id, f.label, k] as const))

describe('what the export dialog says a file keeps', () => {
  it.each(claims('sequence'))('a DNA sequence as %s (%s): %o', (id, _label, k) => {
    expect({ label: k.label, kept: sequenceKept(k.label, id, probeDoc()) }).toEqual({ label: k.label, kept: k.kept })
  })

  it.each(claims('sequence', true))('a protein as %s (%s): %o', (id, _label, k) => {
    expect({ label: k.label, kept: sequenceKept(k.label, id, probeProtein()) }).toEqual({ label: k.label, kept: k.kept })
  })

  it.each(claims('read'))('a read as %s (%s): %o', (id, _label, k) => {
    expect({ label: k.label, kept: readKept(k.label, id, probeRead()) }).toEqual({ label: k.label, kept: k.kept })
  })

  it.each(claims('alignment'))('an alignment as %s (%s): %o', (id, _label, k) => {
    expect({ label: k.label, kept: alignmentKept(k.label, id) }).toEqual({ label: k.label, kept: k.kept })
  })
})
