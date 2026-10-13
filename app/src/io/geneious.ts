/**
 * Geneious .geneious files.
 *
 * A .geneious file is an export of one Geneious folder: a ZIP holding one XML
 * file (`<name>.geneious.partial`) and, for read sets and assemblies, binary
 * side files (`fileData.N`). Older exports are plain XML. The XML is a flat
 * list of `<geneiousDocument class="...">` elements, one per document in the
 * folder, plus `<folder name="..."/>`.
 *
 * Each document is read on its own, by its class:
 *
 *   - sequences (GenBank, default and graph sequences, nucleotide or protein)
 *     open as sequences, with their own name, description, topology and
 *     features;
 *   - sequence lists open as their member sequences;
 *   - oligos go to the primer library;
 *   - everything else is reported, never opened as something it is not.
 *
 * Within a sequence document the residues are in `<charSequence>`, or in
 * `<INSDSeq_sequence>` for some GenBank downloads. `<sequence_residues>` is
 * only a 500-letter preview and is used only when it holds the whole
 * sequence. Geneious writes residues in alternating case, which means
 * nothing: they are uppercased. The features are stored twice: in
 * `<sequenceAnnotations>`, which is the current state, and in the
 * GenBank record's override properties, which is the state at download and
 * the only copy for a record that was never edited.
 */

import { unzipSync } from 'fflate'
import { Sequence, type Topology } from '../models/Sequence'
import { Annotation, type AnnotationData, type Strand } from '../models/Annotation'
import type { Alphabet } from '../models/alphabet'
import type { DocumentState } from '../models/Document'
import { cleanOligo, newPrimerId, primerOligoFromFeature, type LibraryOligo, type PrimerData } from '../primers/oligo'
import { makeDoc, type AlnDoc, type AlnKind, type RowInput } from '../msa/model'
import { parseAb1 } from './ab1'
import type { TraceData } from './trace'
import { resolveLocation, type LocationPart } from './location'
import { idSource } from './ids'
import { mergeGenesIntoCds } from './gene-cds'
import { takeSource } from './source-feature'

const ids = idSource('gen')

/** Reset ID counter with deterministic prefix (for testing). */
export function _resetIdCounter(): void {
  ids.resetForTests()
}

/** An oligo for the primer library, as `addLibraryOligos` takes it. */
export type GeneiousOligo = Omit<LibraryOligo, 'id' | 'createdAt'>

/** What a document that was not opened (or not opened whole) was. */
export type GeneiousSkipKind =
  | 'tree'        // a tree with no alignment in the file
  | 'treeAlignment' // a tree whose alignment was opened; the tree is not drawn
  | 'trace'       // a chromatogram document whose trace could not be read
  | 'structure'   // a structure with no protein chain to open
  | 'genome'      // a link to an NCBI record, with no sequence in the file
  | 'enzymeSet'
  | 'reads'       // NGS reads, stored in Geneious's own binary files
  | 'assembly'    // an NGS assembly, stored in Geneious's own binary files
  | 'partial'     // a sequence of which only a preview is in the file
  | 'unreadable'
  | 'other'

/** An alignment, a contig or the alignment behind a tree. */
export interface GeneiousAlignment {
  name: string
  doc: AlnDoc
}

export interface GeneiousSkipped {
  kind: GeneiousSkipKind
  name: string
  /** For a genome link: the accession it points to. */
  accession?: string
  /** For a genome link or a partial sequence: the full length. */
  length?: number
}

/** A Sanger read: the chromatogram file Geneious keeps whole inside the document. */
export interface GeneiousTrace {
  name: string
  data: TraceData
  /** The trim set in Geneious, as [first kept base, end) 0-based; absent when none was. */
  trim?: [number, number]
}

/** A structure's coordinates, as the PDB text Geneious keeps inside the document. */
export interface GeneiousStructure {
  name: string
  /** A file name for the text, so the structure reader knows it is PDB. */
  fileName: string
  text: string
}

export interface GeneiousImport {
  /** The Geneious folder the file was exported from. */
  folder?: string
  sequences: DocumentState[]
  alignments: GeneiousAlignment[]
  traces: GeneiousTrace[]
  structures: GeneiousStructure[]
  oligos: GeneiousOligo[]
  /** Enzyme sets, by the names Geneious gives their enzymes; matched to the database when saved. */
  enzymeSets: { name: string; enzymes: string[] }[]
  skipped: GeneiousSkipped[]
}

/**
 * What one document leaves for the others to settle. A Sanger read is two
 * documents in Geneious: the chromatogram file (ABIPluginDocument) and the
 * sequence made from it (a graph sequence), which carries the name the user
 * gave the read, any trim and a reference to the file's URN.
 */
interface ReadContext {
  traceByUrn: Map<string, GeneiousTrace>
  graphs: { doc: DocumentState; refs: string[]; trim?: [number, number] }[]
}

/** Read a .geneious file: a ZIP of XML, or plain XML. */
export function readGeneious(buffer: ArrayBuffer): GeneiousImport {
  return readGeneiousXml(geneiousXml(buffer))
}

/** The document list of a .geneious file, out of the ZIP if it is one. */
export function geneiousXml(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (!isZip(bytes)) return new TextDecoder().decode(bytes)
  const entries = Object.entries(unzipSync(bytes))
  // The document list is the one entry that is not a binary side file.
  const main = entries.find(([name]) => /\.(partial|xml)$/i.test(name))
    ?? entries.find(([name, data]) => !/^fileData\./.test(name) && data[0] === 0x3C) // '<'
  if (!main) throw new Error('No Geneious document list in the archive')
  return new TextDecoder().decode(main[1])
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** Read the XML of a .geneious file. */
export function readGeneiousXml(xml: string): GeneiousImport {
  ids.reset()
  const chunks = topLevelDocuments(xml)
  if (chunks.length === 0) throw new Error('No Geneious documents in the file')
  const out: GeneiousImport = { sequences: [], alignments: [], traces: [], structures: [], oligos: [], enzymeSets: [], skipped: [] }
  const folder = /<folder\s+name="([^"]*)"/.exec(xml.slice(0, 4096))?.[1]
  if (folder) out.folder = decodeEntities(folder)
  const ctx: ReadContext = { traceByUrn: new Map(), graphs: [] }
  const parser = new DOMParser()
  for (const chunk of chunks) {
    const parsed = parser.parseFromString(chunk, 'text/xml')
    const root = parsed.documentElement
    // Browsers differ in where they put the error: as the root, or inside it.
    if (!root || root.localName !== 'geneiousDocument' || parsed.getElementsByTagName('parsererror').length > 0) {
      out.skipped.push({ kind: 'unreadable', name: /<cache_name>([^<]*)/.exec(chunk)?.[1] ?? 'A document' })
      continue
    }
    readDocument(root, out, ctx)
  }
  pairReads(out, ctx)
  return out
}

/**
 * The top-level `<geneiousDocument>` elements, as separate strings, so each
 * is parsed on its own and a large export never becomes one DOM.
 */
function topLevelDocuments(xml: string): string[] {
  const out: string[] = []
  const tag = /<geneiousDocument[\s>]|<\/geneiousDocument>/g
  let depth = 0
  let start = -1
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    if (m[0][1] === '/') {
      depth--
      if (depth === 0 && start >= 0) {
        out.push(xml.slice(start, m.index + m[0].length))
        start = -1
      }
    } else {
      if (depth === 0) start = m.index
      depth++
    }
  }
  return out
}

function decodeEntities(s: string): string {
  return s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!)
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) return c
  }
  return null
}

function children(el: Element | null | undefined, name: string): Element[] {
  const out: Element[] = []
  if (!el) return out
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) out.push(c)
  }
  return out
}

function text(el: Element | null | undefined, name: string): string | undefined {
  const t = child(el, name)?.textContent?.trim()
  return t ? t : undefined
}

/**
 * A document's field: the user's override first (a renamed document keeps
 * its new name there), then the cached value, then the plain field.
 */
function field(doc: Element, name: string): string | undefined {
  const hidden = child(doc, 'hiddenFields')
  return text(hidden, `override_${name}`) ?? text(hidden, name) ?? text(child(doc, 'fields'), name)
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** History records and assembly reports are Geneious bookkeeping, with nothing to open. */
const SILENT = /\.(OperationRecordDocument|AssemblyReportDocument)$/

const SKIPPED: [RegExp, GeneiousSkipKind][] = [
  [/\.GenomeSummaryDocument$/, 'genome'],
]

function readDocument(doc: Element, out: GeneiousImport, ctx: ReadContext): void {
  const cls = doc.getAttribute('class') ?? ''
  if (SILENT.test(cls)) return
  const name = field(doc, 'cache_name') ?? 'Untitled'
  const content = child(doc, 'originalElement')?.firstElementChild ?? null

  for (const [re, kind] of SKIPPED) {
    if (!re.test(cls)) continue
    if (kind === 'genome') out.skipped.push(genomeLink(doc, name))
    else out.skipped.push({ kind, name })
    return
  }

  if (/\.EnzymeSetDocument$/.test(cls)) {
    // Each enzyme comes with its REBASE details; its name is all a set keeps.
    const enzymes = children(child(content, 'enzymes'), 'enzyme').flatMap(e => text(e, 'name') ?? [])
    if (enzymes.length === 0) out.skipped.push({ kind: 'enzymeSet', name })
    else out.enzymeSets.push({ name, enzymes })
    return
  }

  if (/\.ABIPluginDocument$/.test(cls)) {
    // The chromatogram file itself, whole, base64 in <rawdata>.
    const raw = content ? text(content, 'rawdata') : undefined
    const data = raw ? traceFromBase64(raw) : null
    if (!data) { out.skipped.push({ kind: 'trace', name }); return }
    data.name = name.replace(/\.(ab1|abi|abif)$/i, '')
    const trace: GeneiousTrace = { name: data.name, data }
    out.traces.push(trace)
    const urn = text(child(doc, 'hiddenFields'), 'cache_urn')
    if (urn) ctx.traceByUrn.set(urn, trace)
    return
  }

  if (/\.PdbDocument$/.test(cls)) {
    // The PDB file's text in <data>; a structure of ligands alone (no
    // ATOM records) is passed on too, and found to have no protein.
    const fields = child(content, 'fields')
    const data = (child(fields, 'data') ?? child(content, 'data'))?.textContent
    if (!data || !/^(ATOM|HETATM)/m.test(data)) { out.skipped.push({ kind: 'structure', name }); return }
    const pdbName = text(fields, 'PDBname') ?? text(content, 'PDBname')
    out.structures.push({ name, fileName: `${pdbName ?? name}.pdb`, text: data.replace(/\r\n?/g, '\n') })
    return
  }

  if (/\.DefaultAlignmentDocument$/.test(cls)) {
    const alignment = content && readAlignment(content, name)
    // A contig of NGS reads keeps its reads in Geneious's own binary files.
    if (alignment) out.alignments.push(alignment)
    else out.skipped.push({ kind: content?.hasAttribute('xmlFileData') ? 'assembly' : 'unreadable', name })
    return
  }

  if (/\.(DefaultPhylogenyDocument|TreeBuilderDocument)$/.test(cls)) {
    // A tree built in Geneious carries the alignment it was built from; the
    // tree itself (NEXUS text) is not drawn here.
    const behind = child(child(content, 'alignment'), 'DefaultAlignmentDocument')
    const alignment = behind && readAlignment(behind, name)
    if (alignment) out.alignments.push(alignment)
    out.skipped.push({ kind: alignment ? 'treeAlignment' : 'tree', name })
    return
  }

  if (/\.OligoSequenceDocument$/.test(cls)) {
    const residues = content ? residuesOf(content, doc) : null
    const sequence = residues && residues !== 'placeholder' ? cleanOligo(residues) : null
    if (!sequence) { out.skipped.push({ kind: 'unreadable', name }); return }
    const description = field(doc, 'description')
    out.oligos.push({
      name,
      sequence,
      role: field(doc, 'oligoType') === 'Probe' ? 'probe' : 'primer',
      ...(description ? { notes: description } : {}),
    })
    return
  }

  if (/\.DefaultSequenceListDocument$/.test(cls)) {
    const members = content
      ? [...children(content, 'nucleotideSequence'), ...children(content, 'aminoAcidSequence')]
      : []
    // A list without its sequences in the XML is a set of NGS reads, kept in
    // Geneious's own binary files next to it.
    if (members.length === 0) { out.skipped.push({ kind: 'reads', name }); return }
    for (const m of members) {
      const memberName = text(m, 'name') ?? name
      const read = readSequence(m, null, memberName, text(m, 'description'), m.localName === 'aminoAcidSequence')
      if ('skip' in read) out.skipped.push({ kind: read.skip, name: memberName })
      else out.sequences.push(read.doc)
    }
    return
  }

  if (content && /(NucleotideSequence|AminoAcidSequence|NucleotideGraphSequence|GeneDocument)$/.test(cls)) {
    const read = readSequence(content, doc, name, field(doc, 'description'), /AminoAcid/.test(cls))
    if ('skip' in read) {
      out.skipped.push(read.skip === 'genome'
        ? genomeLink(doc, name)
        : { kind: read.skip, name, length: numberField(doc, 'sequence_length') })
    } else {
      out.sequences.push(read.doc)
      if (/NucleotideGraphSequence$/.test(cls)) {
        ctx.graphs.push({ doc: read.doc, refs: urnsOf(doc), trim: trimOf(content, read.doc.sequence.length) })
      }
    }
    return
  }

  out.skipped.push({ kind: 'other', name })
}

/** A chromatogram from the base64 text of its file, or null when it does not read. */
function traceFromBase64(base64: string): TraceData | null {
  try {
    const binary = atob(base64.replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return parseAb1(bytes.buffer)
  } catch {
    return null
  }
}

/** The documents a document refers to, as their URNs ("urn:local:.:a3-kppkcf9@0" read without the revision). */
function urnsOf(doc: Element): string[] {
  const out: string[] = []
  for (const tag of ['URN', 'referenced_documents']) {
    for (const el of Array.from(doc.getElementsByTagName(tag))) {
      const urn = el.textContent?.trim().replace(/@\d+$/, '')
      if (urn) out.push(urn)
    }
  }
  return out
}

/**
 * The trim set on a read in Geneious, from its "trimmed" annotations: one
 * from the first base cuts the start, one to the last base cuts the end.
 * Returned as [first kept base, end) 0-based; undefined when there is none.
 */
function trimOf(el: Element, length: number): [number, number] | undefined {
  let start = 0
  let end = length
  let found = false
  for (const a of children(child(el, 'sequenceAnnotations'), 'annotation')) {
    if (text(a, 'type') !== 'trimmed') continue
    for (const iv of children(child(a, 'intervals'), 'interval')) {
      const min = Number(text(iv, 'minimumIndex'))
      const max = Number(text(iv, 'maximumIndex'))
      if (min === 1 && max < length) { start = Math.max(start, max); found = true }
      else if (max === length && min > 1) { end = Math.min(end, min - 1); found = true }
    }
  }
  return found && end > start ? [start, end] : undefined
}

/**
 * Join each read's two documents: the chromatogram takes the name the read
 * was given in Geneious and its trim, and the sequence made from it is not
 * opened again beside it. A chromatogram no sequence refers to keeps its
 * file's name; a graph sequence with no chromatogram in the file stays a
 * sequence.
 */
function pairReads(out: GeneiousImport, ctx: ReadContext): void {
  const claimed = new Set<GeneiousTrace>()
  const merged = new Set<DocumentState>()
  for (const g of ctx.graphs) {
    const trace = g.refs.map(urn => ctx.traceByUrn.get(urn)).find(t => t && !claimed.has(t))
    if (!trace) continue
    claimed.add(trace)
    merged.add(g.doc)
    trace.name = g.doc.name
    trace.data.name = g.doc.name
    if (g.trim && g.doc.sequence.length === trace.data.bases.length) trace.trim = g.trim
  }
  if (merged.size > 0) out.sequences = out.sequences.filter(d => !merged.has(d))
}

function numberField(doc: Element, name: string): number | undefined {
  const n = Number(field(doc, name))
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function genomeLink(doc: Element, name: string): GeneiousSkipped {
  const accession = field(doc, 'accession') ?? text(child(doc, 'hiddenFields'), 'cache_name')
  return {
    kind: 'genome',
    name,
    ...(accession ? { accession } : {}),
    ...(numberField(doc, 'sequence_length') ? { length: numberField(doc, 'sequence_length') } : {}),
  }
}

/**
 * The residues of a sequence element. 'placeholder' for a sequence Geneious
 * did not download (a run of '?'), null when only a preview or nothing is
 * stored.
 */
function residuesOf(el: Element, doc: Element | null): string | 'placeholder' | null {
  const cs = child(el, 'charSequence')
  if (cs) {
    if (child(cs, 'xmlSerializedSequence')) return 'placeholder'
    const s = (cs.textContent ?? '').replace(/\s+/g, '')
    if (/^\?*$/.test(s)) return s.length > 0 ? 'placeholder' : null
    return s
  }
  const insd = text(el, 'INSDSeq_sequence') ?? text(el, 'GBSeq_sequence')
  if (insd) return insd.replace(/\s+/g, '')
  if (doc) {
    const preview = field(doc, 'sequence_residues')
    if (preview && preview.length === Number(field(doc, 'sequence_length'))) return preview
  }
  return null
}

type SequenceRead = { doc: DocumentState } | { skip: GeneiousSkipKind }

/**
 * One sequence: a document's content element, or a member of a list (then
 * `doc` is null and the element carries its own fields).
 */
function readSequence(el: Element, doc: Element | null, name: string, description: string | undefined, aminoAcid: boolean): SequenceRead {
  const residues = residuesOf(el, doc)
  if (residues === 'placeholder') return { skip: 'genome' }
  if (!residues) return { skip: 'partial' }

  const own = child(el, 'fields')
  const molType = (doc && field(doc, 'molType')) ?? text(own, 'molType') ?? text(el, 'INSDSeq_moltype')
  const alphabet: Alphabet = aminoAcid || molType === 'AA' ? 'protein' : 'dna'
  const override = child(el, 'GeneiousOverrideProperties')
  const topologyText = (doc && field(doc, 'topology')) ?? text(own, 'topology') ?? text(el, 'INSDSeq_topology')
  const topology: Topology = topologyText === 'circular' || override?.getAttribute('isCircular') === 'true'
    ? 'circular'
    : 'linear'

  const sequence = new Sequence(residues.toUpperCase(), topology, alphabet)
  // The current features; the override copy only when there are none.
  const container = child(el, 'sequenceAnnotations') ?? child(override, 'annotations')
  const read = readAnnotations(children(container, 'annotation'), sequence)
  const { annotations, source } = takeSource(mergeGenesIntoCds(read.annotations), sequence.length)

  return {
    doc: {
      name,
      ...(description && description !== name ? { description } : {}),
      sequence,
      annotations: annotations.map(a => new Annotation(a)),
      ...(read.primers.length > 0 ? { primers: read.primers } : {}),
      ...(source.length > 0 ? { metadata: { source } } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Alignments
// ---------------------------------------------------------------------------

/**
 * An alignment element (a DefaultAlignmentDocument, on its own, as a contig,
 * or behind a tree) as an alignment document. Each row is a gapped sequence
 * whose leading and trailing gaps Geneious keeps as counts on its
 * charSequence (gapPrefixLength, gapSuffixLength) rather than as dashes. A
 * read that went in reverse-complemented is marked so. Null when the rows
 * are not in the XML: a contig of NGS reads keeps them in binary side files.
 */
function readAlignment(el: Element, name: string): GeneiousAlignment | null {
  const rows: RowInput[] = []
  for (const s of children(child(el, 'sequences'), 'sequence')) {
    const reversed = text(s, 'reversed') === 'true' || s.getAttribute('isReferencingOriginalSequenceReversed') === 'true'
    for (const g of children(s, 'gappedSequence')) {
      const cs = child(g, 'charSequence')
      if (!cs) continue
      const lead = Number(cs.getAttribute('gapPrefixLength') ?? 0) || 0
      const trail = Number(cs.getAttribute('gapSuffixLength') ?? 0) || 0
      const rowName = text(g, 'name') ?? `Sequence ${rows.length + 1}`
      rows.push({
        name: rowName,
        seq: '-'.repeat(lead) + (cs.textContent ?? '').replace(/\s+/g, '') + '-'.repeat(trail),
        ...(reversed ? { source: { name: rowName.replace(/ \(reversed\)$/, ''), reversed: true } } : {}),
      })
    }
  }
  if (rows.length === 0) return null

  const kind: AlnKind = text(el, 'alphabet') === 'PROTEIN' ? 'protein' : 'dna'
  const doc = makeDoc(rows, { method: 'import', format: 'Geneious', at: Date.now() }, kind)
  // A contig assembled to a reference names its row.
  const ref = Number(el.getAttribute('contigReferenceSequenceIndex') ?? -1)
  return {
    name,
    doc: ref >= 0 && ref < doc.rows.length ? { ...doc, referenceId: doc.rows[ref].id } : doc,
  }
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * Geneious type names that are not INSDC feature keys, and what they are.
 * A type Geneious got from a GenBank record keeps the key in an
 * "NCBI Feature Key" qualifier, which wins over this.
 */
const TYPE_KEYS: Record<string, string> = {
  'promoter': 'promoter',
  'promoter prokaryotic': 'promoter',
  'origin of replication': 'rep_origin',
  'misc_binding': 'misc_binding',
  'polylinker': 'misc_feature',
  'restriction site': 'misc_feature',
  'extracted region': 'misc_feature',
  'trimmed': 'misc_feature',
  'source conflict': 'misc_difference',
  'chain': 'Chain',
  'domain': 'Domain',
  'metal ion binding site': 'Site',
  // Secondary structure, which GenPept writes as SecStr with /sec_str_type.
  'helix': 'SecStr',
  'strand': 'SecStr',
  'turn': 'SecStr',
  'primer_bind_reverse': 'primer_bind',
}

/**
 * Qualifiers that are Geneious bookkeeping: hidden flags, grouping ids, how
 * it joined the intervals, and the feature key itself.
 */
const DROPPED_QUALIFIER = /^(\.|annotation group$|NCBI Feature Key$|NCBI_Join_Type$)/

function featureType(type: string, qualifiers: Record<string, string[]>): string {
  // The key Geneious kept is not always a key: it writes "helix" for a SecStr.
  const key = qualifiers['NCBI Feature Key']?.[0] ?? type
  if (/^att[BPLR]\d*$/.test(key)) return 'protein_bind'
  return TYPE_KEYS[key.toLowerCase()] ?? key
}

/** The word Geneious writes for a type in a name, where it is not the key with spaces. */
const TYPE_WORDS: Record<string, string> = {
  misc_feature: 'misc',
  mat_peptide: 'peptide',
  sig_peptide: 'signal peptide',
  misc_RNA: 'RNA',
}

/** The name a GenBank import gives a feature (as the GenBank reader's featureName). */
function genbankName(q: Record<string, string[]>): string | undefined {
  return q.label?.[0] || q.gene?.[0] || q.standard_name?.[0] || q.product?.[0] || q.region_name?.[0] || q.note?.[0]
}

/**
 * A feature's name without the type Geneious appends to it.
 *
 * Geneious names a feature from a GenBank record "<name> <type>": "bla CDS",
 * "lacZalpha misc", "CAP protein binding site protein bind", and the type
 * alone when the record gives no name ("rep origin"). The type is taken off
 * only when what is left is the feature's own name from its qualifiers (or
 * another of its qualifier values, as "helix" in "helix SecStr"), so the
 * feature reads as a GenBank import of the same record names it. A name
 * typed in Geneious ("GFP CDS" on a feature with no gene) is kept, and so
 * is a number after the type ("MAPK10 exon 10").
 */
function featureName(description: string, types: (string | undefined)[], q: Record<string, string[]>): string {
  const genbank = genbankName(q)
  const lower = description.toLowerCase()
  const flat = (s: string) => s.replace(/_/g, ' ')
  const words = new Set<string>()
  for (const t of types) {
    if (!t) continue
    if (TYPE_WORDS[t]) words.add(TYPE_WORDS[t].toLowerCase())
    words.add(flat(t).toLowerCase())
  }
  for (const word of words) {
    if (lower === word) return genbank ?? description
    if (!lower.endsWith(` ${word}`)) continue
    const rest = description.slice(0, description.length - word.length - 1)
    if (genbank && flat(rest) === flat(genbank)) return rest
    if (Object.values(q).some(values => values.includes(rest))) return genbank ?? rest
  }
  return description
}

const DIRECTION: Record<string, Strand> = { leftToRight: 1, rightToLeft: -1 }

function readAnnotations(elements: Element[], sequence: Sequence): { annotations: AnnotationData[]; primers: PrimerData[] } {
  const annotations: AnnotationData[] = []
  const primers: PrimerData[] = []
  const seenPrimers = new Set<string>()
  const len = sequence.length
  const circular = sequence.topology === 'circular'

  for (const el of elements) {
    const rawType = text(el, 'type') ?? 'misc_feature'
    const qualifiers: Record<string, string[]> = {}
    for (const q of children(child(el, 'qualifiers'), 'qualifier')) {
      const key = text(q, 'name')
      const value = child(q, 'value')?.textContent?.trim()
      if (!key || value === undefined || value === '') continue
      ;(qualifiers[key] ??= []).push(value)
    }

    // Intervals, 1-based inclusive, listed 5' to 3' along the feature.
    const reverse = rawType === 'primer_bind_reverse'
    const parts: LocationPart[] = []
    for (const iv of children(child(el, 'intervals'), 'interval')) {
      const min = Number(text(iv, 'minimumIndex'))
      const max = Number(text(iv, 'maximumIndex'))
      if (!Number.isInteger(min) || !Number.isInteger(max)) continue
      const strand = DIRECTION[text(iv, 'direction') ?? ''] ?? (reverse ? -1 : 0)
      parts.push({ start: Math.max(0, min - 1), end: Math.min(len, max), strand })
    }
    const at = resolveLocation(parts, len, circular)
    if (!at) continue
    const type = featureType(rawType, qualifiers)
    const name = featureName(text(el, 'description') ?? rawType, [rawType, qualifiers['NCBI Feature Key']?.[0], type], qualifiers)

    // A primer made in Geneious records its whole oligo, tail and all. It
    // is kept as the GenBank and SnapGene readers keep primers: as an oligo
    // whose sites are found again. A primer_bind feature without one (a
    // retrovirus's primer binding site, a vector's sequencing primer sites
    // from its GenBank record) stays a feature, as a GenBank import keeps it.
    const recorded = qualifiers.Sequence
    if ((rawType === 'primer_bind' || reverse) && recorded) {
      const oligo = primerOligoFromFeature({ start: at.start, end: at.end, strand: at.strand, qualifiers: { sequence: recorded } }, sequence)
      if (oligo) {
        const key = `${name}\u0000${oligo}`
        if (!seenPrimers.has(key)) {
          seenPrimers.add(key)
          primers.push({ id: newPrimerId(), name, sequence: oligo, role: 'primer' })
        }
        continue
      }
    }

    const kept: Record<string, string[]> = {}
    for (const [key, values] of Object.entries(qualifiers)) {
      if (!DROPPED_QUALIFIER.test(key)) kept[key.replace(/\s+/g, '_')] = values
    }
    annotations.push({
      id: ids.next(),
      name,
      // A GenPept Bond is a disulfide unless its bond_type says otherwise, as in the GenBank reader.
      type: type === 'Bond' && (kept.bond_type?.[0] ?? 'disulfide') === 'disulfide' ? 'disulfide' : type,
      start: at.start,
      end: at.end,
      strand: at.strand,
      qualifiers: kept,
      ...(at.segments ? { segments: at.segments } : {}),
    })
  }
  return { annotations, primers }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const SKIP_NOUNS: Record<GeneiousSkipKind, [string, string]> = {
  tree: ['tree', 'trees'],
  treeAlignment: ['tree', 'trees'],
  trace: ['chromatogram', 'chromatograms'],
  structure: ['structure', 'structures'],
  genome: ['genome link', 'genome links'],
  enzymeSet: ['enzyme set', 'enzyme sets'],
  reads: ['NGS read set', 'NGS read sets'],
  assembly: ['NGS assembly', 'NGS assemblies'],
  partial: ['sequence stored only in part', 'sequences stored only in part'],
  unreadable: ['unreadable document', 'unreadable documents'],
  other: ['document of another kind', 'documents of other kinds'],
}

/** Why a kind was not opened, said once in the summary. */
const SKIP_REASONS: Partial<Record<GeneiousSkipKind, string>> = {
  genome: 'the file holds a link to NCBI, not the sequence',
  reads: 'kept in Geneious\'s own binary format',
  assembly: 'kept in Geneious\'s own binary format',
  partial: 'the file holds only the first 500 residues',
  tree: 'no alignment in the file, and trees are not drawn here',
  trace: 'the chromatogram file in it could not be read',
  structure: 'no protein chain in it',
  enzymeSet: 'no enzymes in it',
  treeAlignment: 'trees are not drawn here',
}

/** What the summary says happened to a kind, when it is not "not opened". */
const SKIP_VERBS: Partial<Record<GeneiousSkipKind, string>> = {
  treeAlignment: 'opened as the alignment each was built from',
}

const plural = (n: number, [one, many]: [string, string]) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** The lines of the summary that say what was not opened, one per kind. */
export function describeSkipped(skipped: readonly GeneiousSkipped[]): string[] {
  const byKind = new Map<GeneiousSkipKind, GeneiousSkipped[]>()
  for (const s of skipped) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s])
  const lines: string[] = []
  for (const [kind, items] of byKind) {
    const names = items.slice(0, 3).map(i => i.name).join(', ') + (items.length > 3 ? ', …' : '')
    const reason = SKIP_REASONS[kind]
    lines.push(`${plural(items.length, SKIP_NOUNS[kind])} ${SKIP_VERBS[kind] ?? 'not opened'} (${names})${reason ? `: ${reason}` : ''}`)
  }
  return lines
}
