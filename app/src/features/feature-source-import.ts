/**
 * Reading a user's own feature database off disk.
 *
 * Three formats, because that is what people already have lying around: a
 * FASTA of parts, a spreadsheet exported to CSV/TSV, or an annotated GenBank
 * file whose features *are* the library. Anything that does not survive
 * validation is reported with a reason rather than dropped quietly — a
 * database that silently loses half its entries is worse than one that fails.
 */

import { parseGenBankMulti } from '../io/genbank'
import { annotationBases } from '../utils/annotation-sequence'
import type { CommonFeature } from './common-features'

export type FeatureSourceFormat = 'fasta' | 'csv' | 'genbank'

export interface SkippedEntry {
  name: string
  reason: string
}

export interface ParsedFeatureSource {
  format: FeatureSourceFormat
  features: CommonFeature[]
  skipped: SkippedEntry[]
}

/** Shorter than this a "match" is noise: a 6 bp reference hits every plasmid. */
export const MIN_FEATURE_LENGTH = 12
export const MAX_FEATURE_ENTRIES = 20_000
/** Bytes. The whole file is read into memory as text and then into IndexedDB. */
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024

const IUPAC = /^[ACGTURYSWKMBDHVN]+$/
const DEFAULT_TYPE = 'misc_feature'

export class FeatureSourceError extends Error {}

/** Normalise a raw sequence field: strip whitespace, gaps and casing. */
function cleanSequence(raw: string): string {
  return raw.replace(/[\s\-.]/g, '').toUpperCase()
}

/**
 * Collect validated entries, recording why anything was rejected.
 *
 * Deduplicates on name+sequence: re-importing a file that already contributed
 * an entry, or a GenBank library where every record repeats the same backbone
 * feature, should not multiply the reference list.
 */
class EntryCollector {
  readonly features: CommonFeature[] = []
  readonly skipped: SkippedEntry[] = []
  private readonly seen = new Set<string>()

  add(entry: { name: string; type?: string; color?: string; category?: string; sequence: string }) {
    const name = entry.name.trim()
    if (!name) {
      this.skipped.push({ name: '(unnamed)', reason: 'no name' })
      return
    }
    if (this.features.length >= MAX_FEATURE_ENTRIES) {
      this.skipped.push({ name, reason: `over the ${MAX_FEATURE_ENTRIES} entry limit` })
      return
    }
    const sequence = cleanSequence(entry.sequence)
    if (sequence.length === 0) {
      this.skipped.push({ name, reason: 'no sequence' })
      return
    }
    if (sequence.length < MIN_FEATURE_LENGTH) {
      this.skipped.push({ name, reason: `shorter than ${MIN_FEATURE_LENGTH} bp` })
      return
    }
    if (!IUPAC.test(sequence)) {
      this.skipped.push({ name, reason: 'not a nucleotide sequence' })
      return
    }
    const key = `${name}\u0000${sequence}`
    if (this.seen.has(key)) {
      this.skipped.push({ name, reason: 'duplicate' })
      return
    }
    this.seen.add(key)
    this.features.push({
      name,
      type: entry.type?.trim() || DEFAULT_TYPE,
      color: entry.color?.trim() || '',
      category: entry.category?.trim() || '',
      sequence,
    })
  }
}

/** `[type=CDS] [color=#ff0000]` tags in a FASTA header. */
function parseHeaderTags(header: string): { name: string; tags: Record<string, string> } {
  const tags: Record<string, string> = {}
  const stripped = header.replace(/\[([A-Za-z_]+)=([^\]]*)\]/g, (_, k: string, v: string) => {
    tags[k.toLowerCase()] = v.trim()
    return ''
  })
  // Everything before the first run of whitespace is the id; the rest is a
  // description, which is how FASTA has always worked.
  const name = stripped.trim().split(/\s+/)[0] ?? ''
  return { name, tags }
}

function parseFasta(text: string, defaultCategory: string): ParsedFeatureSource {
  const c = new EntryCollector()
  let header: string | null = null
  let bases: string[] = []

  const flush = () => {
    if (header === null) return
    const { name, tags } = parseHeaderTags(header)
    c.add({
      name,
      type: tags.type,
      color: tags.color,
      category: tags.category || defaultCategory,
      sequence: bases.join(''),
    })
    header = null
    bases = []
  }

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      flush()
      header = line.slice(1)
    } else if (!line.startsWith(';') && header !== null) {
      bases.push(line)
    }
  }
  flush()
  return { format: 'fasta', features: c.features, skipped: c.skipped }
}

/** One CSV/TSV row, honouring `""`-escaped fields as written by io/csv.ts. */
function splitDelimited(line: string, delim: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delim) {
      out.push(field)
      field = ''
    } else field += ch
  }
  out.push(field)
  return out.map(f => f.trim())
}

/**
 * CSV/TSV with a header row. `name` and `sequence` are required; `type`,
 * `color` and `category` are optional.
 *
 * Column names match the app's own feature CSV export (io/csv.ts) where they
 * overlap — but that export carries coordinates, not bases, so a file from it
 * needs a sequence column added before it can serve as a database.
 */
function parseDelimited(text: string, defaultCategory: string): ParsedFeatureSource {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) throw new FeatureSourceError('The file is empty.')

  const delim = lines[0].includes('\t') ? '\t' : ','
  const header = splitDelimited(lines[0], delim).map(h => h.toLowerCase())
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n)
      if (i !== -1) return i
    }
    return -1
  }
  const iName = col('name', 'feature', 'feature name')
  const iSeq = col('sequence', 'bases', 'seq')
  if (iName === -1 || iSeq === -1) {
    throw new FeatureSourceError(
      'A CSV database needs a header row with at least "name" and "sequence" columns.',
    )
  }
  const iType = col('type', 'feature type')
  const iColor = col('color', 'colour')
  const iCategory = col('category', 'group')

  const c = new EntryCollector()
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delim)
    c.add({
      name: cells[iName] ?? '',
      type: iType === -1 ? undefined : cells[iType],
      color: iColor === -1 ? undefined : cells[iColor],
      category: (iCategory === -1 ? '' : cells[iCategory]) || defaultCategory,
      sequence: cells[iSeq] ?? '',
    })
  }
  return { format: 'csv', features: c.features, skipped: c.skipped }
}

/**
 * Every annotated feature of every record becomes an entry.
 *
 * `annotationBases` handles reverse strands and origin-spanning features, so a
 * library of annotated plasmids turns into a scannable database directly.
 */
function parseGenBankLibrary(text: string, defaultCategory: string): ParsedFeatureSource {
  const c = new EntryCollector()
  let records
  try {
    records = parseGenBankMulti(text)
  } catch {
    throw new FeatureSourceError('This GenBank file could not be parsed.')
  }
  for (const record of records) {
    for (const ann of record.annotations) {
      // `source` spans the whole record — importing it would add a reference
      // that matches the entire backbone, which is never what is wanted.
      if (ann.type === 'source') continue
      c.add({
        name: ann.name,
        type: ann.type,
        color: ann.color,
        category: defaultCategory,
        sequence: annotationBases(ann, record.sequence),
      })
    }
  }
  if (c.features.length === 0 && c.skipped.length === 0) {
    throw new FeatureSourceError('This GenBank file has no annotated features to import.')
  }
  return { format: 'genbank', features: c.features, skipped: c.skipped }
}

/**
 * Parse a feature database.
 *
 * Dispatches on content rather than extension: files get renamed, and a
 * `.txt` holding FASTA is still FASTA. `fileName` only supplies the default
 * category, which is what the results filter groups custom hits under.
 */
export function parseFeatureSource(fileName: string, text: string): ParsedFeatureSource {
  if (text.length > MAX_SOURCE_BYTES) {
    throw new FeatureSourceError(
      `That file is larger than ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`,
    )
  }
  const category = fileName.replace(/\.[^.]+$/, '') || 'Custom'
  const head = text.trimStart()
  if (head.startsWith('>')) return parseFasta(text, category)
  if (head.startsWith('LOCUS')) return parseGenBankLibrary(text, category)
  if (head.length === 0) throw new FeatureSourceError('The file is empty.')
  return parseDelimited(text, category)
}

/** One line telling the user what the import actually did. */
export function describeImport(fileName: string, parsed: ParsedFeatureSource): string {
  const n = parsed.features.length
  const base = `Imported ${n} feature${n === 1 ? '' : 's'} from "${fileName}"`
  if (parsed.skipped.length === 0) return base
  const reasons = new Map<string, number>()
  for (const s of parsed.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1)
  const detail = [...reasons.entries()].map(([reason, count]) => `${count} ${reason}`).join(', ')
  return `${base} — skipped ${detail}`
}
