/**
 * FASTA and plain-text sequence files.
 *
 * Each record is sorted into nucleotide or protein by its letters. A record
 * with letters that only occur in proteins (E, F, I, L, P, Q, …) is a
 * protein; one written only in nucleotide codes is DNA (plain RNA, with U,
 * included), unless the file says otherwise (.faa). Anything else is
 * reported rather than loaded.
 */

export interface FastaRecord {
  name: string
  bases: string
  /** The rest of the header line after the name, when there was any. */
  description?: string
}

export interface FastaRead {
  /** Nucleotide records. */
  records: FastaRecord[]
  /** Records that are proteins, opened as such. */
  proteins: FastaRecord[]
  /** Records with characters that are neither nucleotide nor amino-acid codes. */
  unreadable: string[]
}

/**
 * One sequence as a FASTA record, wrapped at 80 columns. The id is the name
 * with spaces as underscores, since readers take the first word as the id;
 * the rest of the header is the description, or the name in full when there
 * is no description, which is how `recordName` gets a name with spaces back.
 */
export function writeFastaRecord(name: string, bases: string, description?: string): string {
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim()
  const id = clean(name).replace(/\s+/g, '_') || 'sequence'
  const rest = clean(description ?? '') || (id !== clean(name) ? clean(name) : '')
  const lines = [`>${id}${rest ? ` ${rest}` : ''}`]
  for (let i = 0; i < bases.length; i += 80) lines.push(bases.slice(i, i + 80))
  return lines.join('\n') + '\n'
}

/**
 * The name and description a record was written with. An id that is its
 * description with spaces as underscores ("pUC19_mod pUC19 mod") is a name
 * with spaces, written that way by `writeFastaRecord`.
 */
export function recordName(rec: FastaRecord): { name: string; description?: string } {
  const d = rec.description
  if (d && rec.name.includes('_') && rec.name === d.replace(/\s+/g, '_')) return { name: d }
  return d ? { name: rec.name, description: d } : { name: rec.name }
}

const NUCLEOTIDE = /^[ACGTURYSWKMBDHVN]*$/
/** Letters that are amino-acid codes but not nucleotide codes. */
const PROTEIN_ONLY = /[EFIJLOPQXZ*]/
const AMINO = /^[A-Z*]*$/

/**
 * Read FASTA (or bare sequence lines) into records. Headers name records by
 * their first word, and the rest of the header line is kept as the record's
 * description; ';' comment lines, whitespace, digits and gaps are dropped.
 * `defaultName` names a record with no header.
 */
export function readFasta(text: string, defaultName: string, proteinFile = false): FastaRead {
  const raw: FastaRecord[] = []
  let name = defaultName
  let description = ''
  let chunks: string[] = []
  const flush = () => {
    if (chunks.length > 0) raw.push({ name, bases: chunks.join('').toUpperCase(), ...(description ? { description } : {}) })
    chunks = []
  }
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('>')) {
      flush()
      const header = line.slice(1).trim()
      const space = header.search(/\s/)
      name = (space < 0 ? header : header.slice(0, space)) || defaultName
      description = space < 0 ? '' : header.slice(space + 1).trim()
    } else if (!line.startsWith(';')) {
      const bases = line.replace(/[\s\d\-.]/g, '')
      if (bases) chunks.push(bases)
    }
  }
  flush()

  const out: FastaRead = { records: [], proteins: [], unreadable: [] }
  for (const rec of raw) {
    if (!proteinFile && NUCLEOTIDE.test(rec.bases)) out.records.push(rec)
    else if (AMINO.test(rec.bases) && (proteinFile || PROTEIN_ONLY.test(rec.bases))) out.proteins.push(rec)
    else out.unreadable.push(rec.name)
  }
  return out
}
