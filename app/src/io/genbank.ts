/**
 * GenBank flat file parser and writer.
 *
 * Handles the subset of GenBank format needed for plasmid editing:
 * LOCUS, DEFINITION, FEATURES, and ORIGIN sections.
 */

import { Sequence, Topology } from '../models/Sequence'
import { Annotation, AnnotationData } from '../models/Annotation'
import { DocumentState, type SequenceMetadata, type Strandedness } from '../models/Document'
import { cleanOligo, newPrimerId, type PrimerData } from '../primers/oligo'
import { findBindingSites } from '../primers/binding'
import { parseGenBankLocation, resolveLocation, formatGenBankLocation } from './location'

let _idPrefix = Math.random().toString(36).slice(2, 6)
let _nextId = 0
function nextId(): string {
  return `ann_${_idPrefix}_${++_nextId}`
}

/** Reset ID counter and randomize prefix. Used between parse calls to avoid collisions. */
function resetIds(): void {
  _idPrefix = Math.random().toString(36).slice(2, 6)
  _nextId = 0
}

/** Reset ID counter with deterministic prefix (for testing). */
export function _resetIdCounter(): void {
  _idPrefix = 'test'
  _nextId = 0
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * One record read from a GenBank file, as plain data: it crosses from the
 * large-file worker by structured clone, so it holds no class instances.
 * toDocument() turns it into a DocumentState.
 */
export interface GenBankRecord {
  name: string
  description?: string
  topology: Topology
  strandedness: Strandedness
  bases: string
  annotations: AnnotationData[]
  primers: PrimerData[]
  /** Things the reader could not take in as written, for the user. */
  warnings: string[]
}

/**
 * Qualifiers whose values are sequences: a wrapped line continues the same
 * word, so lines are joined without a space. Everything else is text.
 */
const UNSPACED_QUALIFIERS = new Set(['translation', 'primer_sequence', 'rpt_unit_seq'])

interface RawFeature {
  type: string
  location: string
  qualifiers: Record<string, string[]>
}

interface RecordInProgress {
  name: string
  description: string
  topology: Topology
  strandedness: Strandedness
  /** From the LOCUS line; used for locations when there is no ORIGIN. */
  locusLength: number
  features: RawFeature[]
  baseChunks: string[]
  section: 'header' | 'features' | 'origin'
  /** The header keyword the current line continues (DEFINITION spans lines). */
  headerKey: string
  feature: RawFeature | null
  /** Set while a feature's location runs on to the next line. */
  locationOpen: boolean
  qualKey: string
  qualPieces: string[]
  empty: boolean
}

function newRecord(): RecordInProgress {
  return {
    name: 'Untitled', description: '', topology: 'linear', strandedness: 'double', locusLength: 0,
    features: [], baseChunks: [], section: 'header', headerKey: '',
    feature: null, locationOpen: false, qualKey: '', qualPieces: [], empty: true,
  }
}

/** True while brackets are unbalanced or the text ends mid-list. */
function locationContinues(loc: string): boolean {
  let depth = 0
  for (const ch of loc) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
  }
  return depth > 0 || /,\s*$/.test(loc)
}

/** A qualifier's value as written: outer quotes removed, doubled quotes undone. */
function qualifierValue(raw: string): string {
  if (!raw.startsWith('"')) return raw
  const inner = raw.endsWith('"') && raw.length > 1 ? raw.slice(1, -1) : raw.slice(1)
  return inner.replace(/""/g, '"')
}

/**
 * Reads GenBank text a line at a time, so a large file can be streamed
 * through it without holding the whole text. Every record in the file is
 * read; `//` ends each one.
 */
export class GenBankReader {
  private readonly done: GenBankRecord[] = []
  private rec = newRecord()

  line(line: string): void {
    const r = this.rec
    if (line.startsWith('//')) {
      this.endRecord()
      return
    }
    if (r.section === 'origin') {
      if (line.trim()) r.baseChunks.push(line.replace(/[\s0-9]/g, ''))
      return
    }
    if (line.startsWith('ORIGIN')) {
      this.flushFeature()
      r.section = 'origin'
      r.empty = false
      return
    }
    if (line.startsWith('FEATURES')) {
      r.section = 'features'
      r.empty = false
      return
    }

    if (r.section === 'features' && line.startsWith(' ')) {
      this.featureLine(line)
      return
    }

    // Header (or a keyword after FEATURES, such as CONTIG or BASE COUNT).
    if (/^\S/.test(line)) {
      this.flushFeature()
      r.section = 'header'
      r.headerKey = line.slice(0, 12).trim()
      const value = line.slice(12).trim()
      if (r.headerKey.startsWith('LOCUS')) {
        r.empty = false
        const parts = line.split(/\s+/)
        r.name = parts[1] || 'Untitled'
        const lower = line.toLowerCase()
        if (lower.includes('circular')) r.topology = 'circular'
        if (lower.includes('ss-dna') || lower.includes('ss-rna')) r.strandedness = 'single'
        const len = /(\d+)\s+(bp|aa)\b/i.exec(line)
        if (len) r.locusLength = parseInt(len[1], 10)
      } else if (r.headerKey === 'DEFINITION') {
        r.empty = false
        r.description = value
      }
      return
    }
    if (r.headerKey === 'DEFINITION' && line.trim()) {
      r.description += ' ' + line.trim()
    }
  }

  /** All records read, including one left unterminated at the end of the text. */
  finish(): GenBankRecord[] {
    if (!this.rec.empty) this.endRecord()
    return this.done
  }

  private featureLine(line: string): void {
    const r = this.rec
    // Feature key at column 6: "     CDS             complement(join(1..100,"
    if (/^\s{5}\S/.test(line)) {
      this.flushFeature()
      const m = /^\s{5}(\S+)\s*(.*)$/.exec(line)
      if (!m) return
      r.feature = { type: m[1], location: m[2].trim(), qualifiers: {} }
      r.locationOpen = locationContinues(r.feature.location)
      return
    }
    if (!r.feature || !/^\s{21}/.test(line)) return
    const text = line.trim()
    if (!text) return
    if (text.startsWith('/') && !r.locationOpen) {
      this.flushQualifier()
      const eq = text.indexOf('=')
      if (eq >= 0) {
        r.qualKey = text.slice(1, eq)
        r.qualPieces = [text.slice(eq + 1)]
      } else {
        r.qualKey = text.slice(1)
        r.qualPieces = []
      }
      return
    }
    if (r.locationOpen) {
      r.feature.location += text
      r.locationOpen = locationContinues(r.feature.location)
      return
    }
    if (r.qualKey) r.qualPieces.push(text)
  }

  private flushQualifier(): void {
    const r = this.rec
    if (r.qualKey && r.feature) {
      const sep = UNSPACED_QUALIFIERS.has(r.qualKey) ? '' : ' '
      const value = qualifierValue(r.qualPieces.join(sep))
      ;(r.feature.qualifiers[r.qualKey] ??= []).push(value)
    }
    r.qualKey = ''
    r.qualPieces = []
  }

  private flushFeature(): void {
    const r = this.rec
    this.flushQualifier()
    if (r.feature) r.features.push(r.feature)
    r.feature = null
    r.locationOpen = false
  }

  private endRecord(): void {
    this.flushFeature()
    const r = this.rec
    this.rec = newRecord()
    if (r.empty && r.baseChunks.length === 0) return
    this.done.push(buildRecord(r))
  }
}

function buildRecord(r: RecordInProgress): GenBankRecord {
  resetIds()
  const bases = r.baseChunks.join('').toUpperCase()
  const seqLen = bases.length || r.locusLength
  const circular = r.topology === 'circular'
  const warnings: string[] = []
  const annotations: AnnotationData[] = []

  for (const f of r.features) {
    const parsed = parseGenBankLocation(f.location)
    const resolved = parsed && resolveLocation(parsed.parts, seqLen, circular)
    const label = featureName(f)
    if (!parsed) {
      warnings.push(`${label}: location "${f.location}" could not be read, so the feature was skipped`)
      continue
    }
    if (!resolved) {
      warnings.push(`${label}: lies on another record (${f.location}), so the feature was skipped`)
      continue
    }
    if (parsed.remote > 0) {
      warnings.push(`${label}: part of it lies on another record; only the part on this sequence was kept`)
    }
    annotations.push({
      id: nextId(),
      name: label,
      type: f.type,
      start: resolved.start,
      end: resolved.end,
      strand: resolved.strand,
      qualifiers: f.qualifiers,
      ...(resolved.segments ? { segments: resolved.segments } : {}),
    })
  }

  let description = r.description
  // Remove trailing period
  if (description.endsWith('.')) description = description.slice(0, -1)
  // The writer turns spaces in a name into underscores for LOCUS and, with
  // no description, writes the name in full as DEFINITION.
  let name = r.name
  if (description && name.includes('_') && name.replace(/_/g, ' ') === description.replace(/\s+/g, ' ')) {
    name = description
    description = ''
  }

  const { primers, rest } = primersFromFeatures(annotations)
  return {
    name,
    description: description || undefined,
    topology: r.topology,
    strandedness: r.strandedness,
    bases,
    annotations: rest,
    primers,
    warnings: warnings.map(w => `${name}: ${w}`),
  }
}

/** Use /label, /gene, /standard_name, or /product qualifier as annotation name. */
function featureName(f: RawFeature): string {
  const q = f.qualifiers
  return q['label']?.[0] || q['gene']?.[0] || q['standard_name']?.[0] || q['product']?.[0] || f.type
}

/** A record as an open-able document. */
export function toDocument(rec: GenBankRecord): DocumentState {
  const metadata: SequenceMetadata = { strandedness: rec.strandedness }
  return {
    name: rec.name,
    description: rec.description,
    sequence: new Sequence(rec.bases, rec.topology),
    annotations: rec.annotations.map(d => new Annotation(d)),
    ...(rec.primers.length > 0 ? { primers: rec.primers } : {}),
    metadata,
  }
}

/** Read every record in `text`. */
export function readGenBankRecords(text: string): GenBankRecord[] {
  const reader = new GenBankReader()
  for (const line of text.split(/\r?\n/)) reader.line(line)
  return reader.finish()
}

/**
 * Parse a GenBank file that may contain multiple records (delimited by //).
 * Returns an array of DocumentState, one per record. Problems worth telling
 * the user about are appended to `warnings`.
 */
export function parseGenBankMulti(text: string, warnings?: string[]): DocumentState[] {
  const records = readGenBankRecords(text)
  if (records.length === 0) return [toDocument(emptyRecord())]
  if (warnings) for (const r of records) warnings.push(...r.warnings)
  return records.map(toDocument)
}

/** Parse the first record of a GenBank file. */
export function parseGenBank(text: string, warnings?: string[]): DocumentState {
  const first = readGenBankRecords(text)[0] ?? emptyRecord()
  if (warnings) warnings.push(...first.warnings)
  return toDocument(first)
}

function emptyRecord(): GenBankRecord {
  return {
    name: 'Untitled', topology: 'linear', strandedness: 'double',
    bases: '', annotations: [], primers: [], warnings: [],
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function writeGenBank(state: DocumentState): string {
  const lines: string[] = []
  const seq = state.sequence
  const bp = seq.length
  const topo = seq.topology === 'circular' ? 'circular' : 'linear'

  // LOCUS. The name is one word there; a name with spaces goes in with
  // underscores, and DEFINITION carries it in full when there is no
  // description (the reader puts the two back together).
  const bpStr = bp.toString().padStart(7)
  const strandPrefix = state.metadata?.strandedness === 'single' ? 'ss-' : 'ds-'
  const locusName = state.name.trim().replace(/\s+/g, '_') || 'Untitled'
  lines.push(
    `LOCUS       ${padRight(locusName, 16)} ${bpStr} bp    ${strandPrefix}DNA     ${topo}   ${genbankDate(new Date())}`,
  )

  // DEFINITION
  lines.push(...wrapText('DEFINITION  ', `${state.description || state.name}.`))

  // FEATURES
  lines.push('FEATURES             Location/Qualifiers')
  for (const ann of [...state.annotations, ...primerFeatures(state)]) {
    const loc = formatGenBankLocation(ann, bp, seq.topology === 'circular')
    // The key fills columns 6-21; a longer one still needs a space before the location.
    const key = ann.type.length >= 16 ? `${ann.type} ` : padRight(ann.type, 16)
    lines.push(...wrapText(`     ${key}`, loc, ','))

    // Qualifiers. /label always carries the current name, so a feature
    // renamed here keeps its new name in the file.
    const quals = ann.qualifiers ?? {}
    lines.push(...qualifierLines('label', ann.name))
    for (const [key, values] of Object.entries(quals)) {
      const rest = key === 'label' ? values.slice(1) : values
      for (const val of rest) lines.push(...qualifierLines(key, val))
    }
  }

  // ORIGIN
  lines.push('ORIGIN')
  const bases = seq.bases.toLowerCase()
  for (let i = 0; i < bases.length; i += 60) {
    const num = (i + 1).toString().padStart(9)
    const chunks: string[] = []
    for (let j = i; j < Math.min(i + 60, bases.length); j += 10) {
      chunks.push(bases.slice(j, j + 10))
    }
    lines.push(`${num} ${chunks.join(' ')}`)
  }

  lines.push('//')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Primers
//
// GenBank has no primer record, only `primer_bind` features over where one
// anneals. So each binding site is written as such a feature, and the full
// oligo (which is the only place a tail exists) rides along in
// /primer_sequence. On the way back in, features carrying that qualifier are
// folded back into primers; a plain primer_bind from elsewhere stays a
// feature. A primer that binds nowhere has no location and cannot be written.
// ---------------------------------------------------------------------------

const PRIMER_SEQ = 'primer_sequence'
const PRIMER_ROLE = 'primer_role'

function primerFeatures(state: DocumentState): Annotation[] {
  const primers = state.primers ?? []
  if (primers.length === 0) return []
  const sites = findBindingSites(primers, state.sequence.bases, state.sequence.topology)
  const out: Annotation[] = []
  for (const p of primers) {
    for (const [i, site] of (sites.get(p.id) ?? []).entries()) {
      out.push(new Annotation({
        id: `${p.id}_site${i}`,
        name: p.name,
        type: 'primer_bind',
        start: site.start,
        end: site.end,
        strand: site.strand,
        qualifiers: {
          label: [p.name],
          [PRIMER_SEQ]: [p.sequence],
          ...(p.role === 'probe' ? { [PRIMER_ROLE]: ['probe'] } : {}),
          ...(p.notes ? { note: [p.notes] } : {}),
        },
      }))
    }
  }
  return out
}

function primersFromFeatures(annotations: AnnotationData[]): {
  primers: PrimerData[]
  rest: AnnotationData[]
} {
  const primers: PrimerData[] = []
  const rest: AnnotationData[] = []
  const byKey = new Map<string, PrimerData>()
  for (const ann of annotations) {
    const q = ann.qualifiers ?? {}
    const oligo = ann.type === 'primer_bind' && q[PRIMER_SEQ]?.[0] ? cleanOligo(q[PRIMER_SEQ][0]) : null
    if (!oligo) { rest.push(ann); continue }
    // One primer per name and oligo, however many sites it was written at.
    const key = `${ann.name}\u0000${oligo}`
    if (byKey.has(key)) continue
    const primer: PrimerData = {
      id: newPrimerId(),
      name: ann.name,
      sequence: oligo,
      role: q[PRIMER_ROLE]?.[0] === 'probe' ? 'probe' : 'primer',
      ...(q.note?.[0] ? { notes: q.note.join('\n') } : {}),
    }
    byKey.set(key, primer)
    primers.push(primer)
  }
  return { primers, rest }
}

/** Qualifiers whose values are numbers or symbols, written without quotes. */
const UNQUOTED_QUALIFIERS = new Set([
  'codon_start', 'transl_table', 'number', 'citation', 'estimated_length',
  'rpt_type', 'direction', 'transl_except', 'anticodon', 'rpt_unit_range', 'tag_peptide', 'mod_base',
])

const QUALIFIER_INDENT = ' '.repeat(21)

/** One qualifier as file lines: quoted unless numeric/symbolic, inner quotes doubled, wrapped at 79 columns. */
function qualifierLines(key: string, value: string): string[] {
  if (!value) return [`${QUALIFIER_INDENT}/${key}`]
  const text = UNQUOTED_QUALIFIERS.has(key) ? value : `"${value.replace(/"/g, '""')}"`
  return wrapText(`${QUALIFIER_INDENT}/${key}=`, text, UNSPACED_QUALIFIERS.has(key) ? '' : ' ', QUALIFIER_INDENT)
}

/**
 * `text` after `first`, wrapped to 79 columns with continuation lines
 * indented to `indent` (default: the width of `first`). Breaks after
 * `breakAfter` characters where it can, and hard-breaks a run too long for
 * a line (a translation, a long join); `breakAfter` '' always hard-breaks.
 */
function wrapText(first: string, text: string, breakAfter = ' ', indent = ' '.repeat(first.length)): string[] {
  const out: string[] = []
  let prefix = first
  let rest = text
  while (prefix.length + rest.length > 79) {
    const room = 79 - prefix.length
    let cut = breakAfter ? rest.lastIndexOf(breakAfter, room - 1) + 1 : 0
    if (cut <= 0) cut = room
    out.push(prefix + rest.slice(0, cut).trimEnd())
    rest = breakAfter === ' ' ? rest.slice(cut).trimStart() : rest.slice(cut)
    prefix = indent
  }
  out.push(prefix + rest)
  return out
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** GenBank's DD-MMM-YYYY. */
function genbankDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length)
}
