/**
 * GenBank flat file parser and writer.
 *
 * Handles the subset of GenBank format needed for plasmid editing:
 * LOCUS, DEFINITION, FEATURES, and ORIGIN sections. A GenPept record (a
 * protein, "aa" on its LOCUS line) is read and written the same way; its
 * ORIGIN holds residues and its features sit on them.
 */

import { Sequence, Topology, type Alphabet } from '../models/Sequence'
import { Annotation, AnnotationData, defaultColorForType } from '../models/Annotation'
import { DocumentState, type SequenceMetadata, type Strandedness } from '../models/Document'
import { cleanOligo, newPrimerId, type PrimerData } from '../primers/oligo'
import { findBindingSites } from '../primers/binding'
import { parseGenBankLocation, resolveLocation, formatGenBankLocation } from './location'
import { idSource } from './ids'
import { mergeGenesIntoCds } from './gene-cds'
import { takeSource, type SourceQualifiers } from './source-feature'

const ids = idSource('ann')

/** Reset ID counter with deterministic prefix (for testing). */
export function _resetIdCounter(): void {
  ids.resetForTests()
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
  /** 'protein' for a GenPept record. */
  alphabet: Alphabet
  bases: string
  annotations: AnnotationData[]
  primers: PrimerData[]
  /** The qualifiers of the source feature over the whole record, kept out of the features. */
  source: SourceQualifiers[]
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
  alphabet: Alphabet
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
    name: 'Untitled', description: '', topology: 'linear', strandedness: 'double', alphabet: 'dna', locusLength: 0,
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

/** The start of a qualifier line: "/key=" or a bare "/key". */
const QUALIFIER_START = /^\/[A-Za-z_][\w'-]*(=|$)/

/**
 * Whether a qualifier's raw text so far opens a quote it has not closed: it
 * starts with '"' and does not end on a lone quote ('""' is an escaped one).
 */
function quoteOpen(raw: string): boolean {
  if (!raw.startsWith('"')) return false
  let k = 0
  for (let i = raw.length - 1; i > 0 && raw[i] === '"'; i--) k++
  return k % 2 === 0
}

/** ApE's feature colour qualifiers, which ApE and Benchling write and read. */
const APE_FWD_COLOR = 'ApEinfo_fwdcolor'
const APE_REV_COLOR = 'ApEinfo_revcolor'

/** A colour value the canvas can draw: a hex code or a CSS colour name. */
const COLOR_VALUE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i

/**
 * SnapGene's way of keeping a colour in GenBank: a note of its own,
 * "color: #b7e6d7", with "; direction: LEFT" when SnapGene draws the
 * arrow the other way.
 */
const SNAPGENE_COLOR_NOTE = /^color:\s*(#[0-9a-f]{3}|#[0-9a-f]{6})\s*(;\s*direction:\s*\w+\s*)?$/i

/**
 * The colour a feature's qualifiers give it, ApE's (the reverse one for a
 * reverse feature) or SnapGene's colour note, and its qualifiers without
 * them. The colour lives on the feature, and the writer puts it back as
 * ApE's qualifiers.
 */
function takeColor(qualifiers: Record<string, string[]>, strand: number): { color?: string; qualifiers: Record<string, string[]> } {
  const ape = takeApeColor(qualifiers, strand)
  if (ape.color) return ape
  const notes = qualifiers.note ?? []
  const at = notes.findIndex(v => SNAPGENE_COLOR_NOTE.test(v.trim()))
  if (at < 0) return { qualifiers }
  const color = SNAPGENE_COLOR_NOTE.exec(notes[at].trim())![1]
  const rest = { ...qualifiers, note: notes.filter((_, i) => i !== at) }
  if (rest.note.length === 0) delete (rest as Partial<typeof rest>).note
  return { color, qualifiers: rest }
}

/** ApE's colour qualifiers: the reverse one for a reverse feature. */
function takeApeColor(qualifiers: Record<string, string[]>, strand: number): { color?: string; qualifiers: Record<string, string[]> } {
  const fwd = qualifiers[APE_FWD_COLOR]?.[0]
  const rev = qualifiers[APE_REV_COLOR]?.[0]
  const color = (strand === -1 ? rev ?? fwd : fwd ?? rev)?.trim()
  if (!color || !COLOR_VALUE.test(color)) return { qualifiers }
  const rest = { ...qualifiers }
  delete rest[APE_FWD_COLOR]
  delete rest[APE_REV_COLOR]
  return { color, qualifiers: rest }
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
        // GenPept: the length is in residues, and a protein has no origin.
        if (len && len[2].toLowerCase() === 'aa') { r.alphabet = 'protein'; r.topology = 'linear' }
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
    // A line starting with "/" inside an open quoted value ("…/path/to")
    // continues it, unless it reads as a qualifier of its own.
    const continues = text.startsWith('/') && quoteOpen(r.qualPieces.join(' ')) && !QUALIFIER_START.test(text)
    if (text.startsWith('/') && !r.locationOpen && !continues) {
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
  ids.reset()
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
    const { color, qualifiers } = takeColor(f.qualifiers, resolved.strand)
    annotations.push({
      id: ids.next(),
      name: label,
      // A GenPept Bond is a disulfide unless its /bond_type says otherwise,
      // which is the key the app draws as an arc and counts for A280.
      type: f.type === 'Bond' && (f.qualifiers.bond_type?.[0] ?? 'disulfide') === 'disulfide' ? 'disulfide' : f.type,
      start: resolved.start,
      end: resolved.end,
      strand: resolved.strand,
      ...(color ? { color } : {}),
      qualifiers,
      ...(resolved.segments ? { segments: resolved.segments } : {}),
    })
  }

  let description = r.description
  // Remove trailing period
  if (description.endsWith('.')) description = description.slice(0, -1)
  // The writer turns spaces in a name into underscores for LOCUS and, with
  // no description, writes the name in full as DEFINITION. A DEFINITION
  // that is the name again is therefore no description: without this, a
  // record with none came back with its own name as its description, and
  // the next export wrote that out as one.
  let name = r.name
  if (description === name) {
    // The name had nothing to put in DEFINITION's place, so DEFINITION is
    // the name again: no description, rather than one that is the name.
    description = ''
  } else if (description && description.replace(/\s+/g, '_') === name) {
    // Spaces became underscores in LOCUS; DEFINITION kept them.
    name = description
    description = ''
  }

  const { annotations: features, source } = takeSource(mergeGenesIntoCds(annotations), seqLen)
  const { primers, rest } = primersFromFeatures(features)
  return {
    name,
    description: description || undefined,
    topology: r.topology,
    strandedness: r.strandedness,
    alphabet: r.alphabet,
    bases,
    annotations: rest,
    primers,
    source,
    warnings: warnings.map(w => `${name}: ${w}`),
  }
}

/**
 * Use /label, /gene, /standard_name, or /product qualifier as annotation
 * name; a GenPept Region is named by /region_name, and a Site by its /note
 * (its /site_type says only what kind of site it is).
 */
function featureName(f: RawFeature): string {
  const q = f.qualifiers
  return q['label']?.[0] || q['gene']?.[0] || q['standard_name']?.[0] || q['product']?.[0]
    || q['region_name']?.[0] || q['note']?.[0] || f.type
}

/** A record as an open-able document. */
export function toDocument(rec: GenBankRecord): DocumentState {
  // Strandedness is a DNA property; a protein carries no metadata from here.
  const metadata: SequenceMetadata = rec.alphabet === 'protein' ? {} : { strandedness: rec.strandedness }
  if (rec.source.length > 0) metadata.source = rec.source
  return {
    name: rec.name,
    description: rec.description,
    sequence: new Sequence(rec.bases, rec.topology, rec.alphabet),
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
    name: 'Untitled', topology: 'linear', strandedness: 'double', alphabet: 'dna',
    bases: '', annotations: [], primers: [], source: [], warnings: [],
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

  // LOCUS, in the columns of the GenBank release notes: name from 13,
  // length ending at 40, units at 42, strandedness at 45, molecule at 48,
  // topology at 56, division at 65 and the date at 69. The name is one word
  // there; a name with spaces goes in with underscores, and DEFINITION
  // carries it in full when there is no description (the reader puts the
  // two back together). The division is SYN (synthetic), as plasmid editors
  // write it: the app keeps no division of its own.
  const locusName = state.name.trim().replace(/\s+/g, '_') || 'Untitled'
  // A protein is a GenPept record: residues, no strandedness or molecule
  // type, always linear ("142 aa            linear").
  const units = seq.alphabet === 'protein'
    ? `aa ${' '.repeat(3)}${' '.repeat(6)}`
    : `bp ${state.metadata?.strandedness === 'single' ? 'ss-' : 'ds-'}${padRight('DNA', 6)}`
  lines.push(
    `LOCUS       ${padRight(locusName, 16)} ${bp.toString().padStart(11)} ${units}  ${padRight(topo, 8)} SYN ${genbankDate(new Date())}`,
  )

  // DEFINITION. One line of text: a line break would end the record's
  // header. A word too long for a line is broken, since every line of the
  // record has to fit the 79 columns of the release notes and a description
  // is free text.
  lines.push(...wrapText('DEFINITION  ', breakLongWords(`${oneLine(state.description || state.name)}.`, 79 - 12)))

  // FEATURES
  lines.push('FEATURES             Location/Qualifiers')
  // The record's source, kept out of the features, over the whole sequence as it is now.
  for (const quals of state.metadata?.source ?? []) {
    lines.push(`     source          1..${bp}`)
    for (const [key, values] of Object.entries(quals)) {
      for (const val of values) lines.push(...qualifierLines(key, val))
    }
  }
  for (const ann of [...state.annotations, ...primerFeatures(state)]) {
    // A disulfide between two residues is a GenPept bond, not a join.
    const bond = ann.type === 'disulfide' && ann.segments?.length === 2
      && ann.segments.every(([s, e]) => e - s === 1)
    const loc = bond
      ? `bond(${ann.segments![0][0] + 1},${ann.segments![1][0] + 1})`
      : formatGenBankLocation(ann, bp, seq.topology === 'circular')
    // The key fills columns 6-21; a longer one still needs a space before the location.
    const key = ann.type.length >= 16 ? `${ann.type} ` : padRight(ann.type, 16)
    lines.push(...wrapText(`     ${key}`, loc, ','))

    // Qualifiers. /label always carries the current name, so a feature
    // renamed here keeps its new name in the file.
    const quals = ann.qualifiers ?? {}
    lines.push(...qualifierLines('label', ann.name))
    // A colour of its own goes out as ApE's colour qualifiers, which ApE,
    // Benchling and this reader take in; the type's default colour is left out.
    const ownColor = !!ann.color && ann.color.toLowerCase() !== defaultColorForType(ann.type).toLowerCase()
    if (ownColor) {
      lines.push(...qualifierLines(APE_FWD_COLOR, ann.color), ...qualifierLines(APE_REV_COLOR, ann.color))
    }
    for (const [key, values] of Object.entries(quals)) {
      if (ownColor && (key === APE_FWD_COLOR || key === APE_REV_COLOR)) continue
      const rest = key === 'label' ? values.slice(1) : values
      // A value's line breaks become spaces (qualifierLines flattens them):
      // the feature table holds no line breaks, and a raw one would end the
      // table. Splitting a note at its line breaks instead turned one note
      // into several, which came back as several notes.
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

/** The primers as `primer_bind` features at every site they bind, carrying the oligo in /primer_sequence. */
export function primerFeatures(state: DocumentState): Annotation[] {
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
          // A primer's notes are one free-text field, which may hold line
          // breaks; a qualifier value may not, so each line is a /note of
          // its own and primersFromFeatures joins them back with them.
          ...(p.notes ? { note: p.notes.split(/\r?\n/) } : {}),
        },
      }))
    }
  }
  return out
}

/**
 * Names of the primers a GenBank file cannot hold: ones that bind nowhere on
 * the sequence have no location to write, so the export says so.
 */
export function unwrittenPrimers(state: DocumentState): string[] {
  const primers = state.primers ?? []
  if (primers.length === 0) return []
  const sites = findBindingSites(primers, state.sequence.bases, state.sequence.topology)
  return primers.filter(p => (sites.get(p.id) ?? []).length === 0).map(p => p.name)
}

export function primersFromFeatures(annotations: AnnotationData[]): {
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

/**
 * Qualifiers the feature table defines as carrying no value ("Value format
 * none" in the DDBJ/ENA/GenBank Feature Table definition), written bare.
 * Any other qualifier takes a value, so an empty one is written as "".
 */
const VALUELESS_QUALIFIERS = new Set([
  'circular_RNA', 'environmental_sample', 'focus', 'germline', 'macronuclear', 'partial',
  'proviral', 'pseudo', 'rearranged', 'ribosomal_slippage', 'trans_splicing', 'transgenic',
])

const QUALIFIER_INDENT = ' '.repeat(21)

/** Text on one line: line breaks and tabs become spaces. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ')
}

/** `text` with any word longer than `room` broken, so every line can fit. */
function breakLongWords(text: string, room: number): string {
  return text.split(' ').map(w => (w.length <= room ? w : (w.match(new RegExp(`.{1,${room}}`, 'g')) ?? [w]).join(' '))).join(' ')
}

/**
 * One qualifier as file lines: quoted unless numeric/symbolic, inner quotes
 * doubled, wrapped at 79 columns.
 *
 * A qualifier with nothing to say is written bare (/pseudo), which the
 * feature table allows only for the qualifiers defined that way; one that
 * takes text keeps its empty value as "" rather than turning into a flag a
 * strict reader would refuse.
 */
function qualifierLines(key: string, value: string): string[] {
  if (!value) return VALUELESS_QUALIFIERS.has(key) ? [`${QUALIFIER_INDENT}/${key}`] : [`${QUALIFIER_INDENT}/${key}=""`]
  const flat = oneLine(value)
  const text = UNQUOTED_QUALIFIERS.has(key) ? flat : `"${flat.replace(/"/g, '""')}"`
  return wrapText(`${QUALIFIER_INDENT}/${key}=`, text, UNSPACED_QUALIFIERS.has(key) ? '' : ' ', QUALIFIER_INDENT)
}

/**
 * `text` after `first`, wrapped to 79 columns with continuation lines
 * indented to `indent` (default: the width of `first`).
 *
 * With `breakAfter` ' ' (text) it breaks only at spaces, and never where the
 * next line would start with "/", which readers take as a new qualifier. A
 * word too long for a line (a URL) stays whole on a longer line: readers
 * join text lines with a space, so a break inside the word would put one
 * into it. Other separators (',' in a location) break where they can and
 * hard-break a run too long for a line; '' (a translation) always
 * hard-breaks, which is safe because those lines are joined without spaces.
 */
function wrapText(first: string, text: string, breakAfter = ' ', indent = ' '.repeat(first.length)): string[] {
  const out: string[] = []
  let prefix = first
  let rest = text
  while (prefix.length + rest.length > 79) {
    const room = 79 - prefix.length
    let cut: number
    if (breakAfter === ' ') {
      const ok = (i: number) => i > 0 && rest[i] !== '/'
      cut = rest.lastIndexOf(' ', room - 1) + 1
      while (cut > 0 && !ok(cut)) cut = rest.lastIndexOf(' ', cut - 2) + 1
      if (cut <= 0) {
        // No space in reach: the first one after it, if there is any.
        let next = rest.indexOf(' ', room)
        while (next >= 0 && !ok(next + 1)) next = rest.indexOf(' ', next + 1)
        if (next < 0) break
        cut = next + 1
      }
    } else {
      cut = breakAfter ? rest.lastIndexOf(breakAfter, room - 1) + 1 : 0
      if (cut <= 0) cut = room
    }
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
