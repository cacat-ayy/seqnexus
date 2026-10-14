/**
 * Reading what is typed into Import by Accession. Besides plain accessions,
 * the forms SnapGene's NCBI import takes:
 *
 *   DQ115396, NM_008740.4          several records, separated by commas
 *   672 or LOC104244181            an NCBI Gene ID: the gene's region of its chromosome
 *   AF027958 - AF027961            every accession from the first to the last
 *   NC_000072: 122552252..122565735   part of a record (REGION: may be written before it)
 *   AL589148.1 (COMPLEMENT)        the reverse complement of a record
 *   CP002686: COMPLEMENT(2459491..2463965)   the reverse complement of part of one
 *
 * Entries are separated by commas, semicolons or new lines. An entry that is
 * none of the forms above is split on spaces, so a list of plain accessions
 * separated by spaces still works. Keywords are read in any case.
 */

/** One record to fetch, as asked for. */
export interface AccessionRequest {
  /** The entry written out in one standard way, for the box, errors and the recent list. */
  text: string
  /** The accession (with or without a version), or the NCBI Gene ID when `gene` is set. */
  id: string
  gene: boolean
  /** Part of the record, 1-based and inclusive, start <= end. */
  region?: { start: number; end: number }
  /** The reverse complement. */
  complement: boolean
}

export interface ParsedAccessions {
  requests: AccessionRequest[]
  /** Entries that could not be read, each in words a user can act on. */
  errors: string[]
}

/** Accessions one range may name, so a typo can't start thousands of downloads. */
export const MAX_RANGE = 100

const ID = '[A-Za-z0-9_]+(?:\\.\\d+)?'
const SPAN = '(\\d+)\\s*(?:\\.\\.|-)\\s*(\\d+)'
const REGION_RE = new RegExp(
  `^(${ID})\\s*(?:REGION\\s*:?|:)\\s*(?:COMPLEMENT\\s*\\(\\s*${SPAN}\\s*\\)|${SPAN}(\\s*\\(\\s*COMPLEMENT\\s*\\))?)$`, 'i')
const COMPLEMENT_RE = new RegExp(`^(${ID})\\s*\\(\\s*COMPLEMENT\\s*\\)$`, 'i')
const RANGE_RE = new RegExp(`^(${ID})\\s*-\\s*(${ID})$`)
const ID_RE = new RegExp(`^${ID}$`)

/**
 * A Gene ID, or null for an accession. A bare number is a Gene ID, as in
 * SnapGene: the numeric record ids (GIs) it could otherwise mean were
 * retired by NCBI in 2016. A LOC symbol is "LOC" and the Gene ID.
 */
function geneId(id: string): string | null {
  if (/^\d+$/.test(id)) return id
  const loc = /^LOC(\d+)$/i.exec(id)
  return loc ? loc[1] : null
}

/** Every accession from `first` to `last`, or an error. */
function expandRange(first: string, last: string): string[] | string {
  const a = /^([A-Za-z_]*)(\d+)(?:\.\d+)?$/.exec(first)
  const b = /^([A-Za-z_]*)(\d+)(?:\.\d+)?$/.exec(last)
  if (!a || !b || a[1].toUpperCase() !== b[1].toUpperCase() || a[2].length !== b[2].length) {
    return `"${first} - ${last}" is not a range: both ends need the same letters and the same number of digits.`
  }
  const from = Number(a[2])
  const to = Number(b[2])
  if (to < from) return `"${first} - ${last}" runs backwards: write the lower accession first.`
  if (to - from + 1 > MAX_RANGE) return `"${first} - ${last}" names ${(to - from + 1).toLocaleString('en-US')} records; one range takes at most ${MAX_RANGE}.`
  const width = a[2].length
  const out: string[] = []
  for (let n = from; n <= to; n++) out.push(`${a[1]}${String(n).padStart(width, '0')}`)
  return out
}

/** Read one entry (no commas in it). */
function readEntry(entry: string, requests: AccessionRequest[], errors: string[]) {
  const region = REGION_RE.exec(entry)
  if (region) {
    const [, id, cs, ce, ps, pe, trailing] = region
    const complement = cs !== undefined || trailing !== undefined
    const start = Number(cs ?? ps)
    const end = Number(ce ?? pe)
    if (geneId(id) !== null) {
      errors.push(`"${entry}": a region is cut from a sequence record, so give its accession (${id} reads as a Gene ID).`)
    } else if (start < 1) {
      errors.push(`"${entry}": positions start at 1.`)
    } else if (start > end) {
      errors.push(`"${entry}": write the lower position first. For the other strand, write ${id}: COMPLEMENT(${end}..${start}).`)
    } else {
      const span = `${start}..${end}`
      requests.push({ text: `${id}: ${complement ? `COMPLEMENT(${span})` : span}`, id, gene: false, region: { start, end }, complement })
    }
    return
  }
  const whole = COMPLEMENT_RE.exec(entry)
  if (whole) {
    const id = whole[1]
    const gene = geneId(id)
    if (gene !== null) errors.push(`"${entry}": a reverse complement is made from a sequence record, so give its accession (${id} reads as a Gene ID).`)
    else requests.push({ text: `${id} (COMPLEMENT)`, id, gene: false, complement: true })
    return
  }
  const range = RANGE_RE.exec(entry)
  if (range) {
    const ids = expandRange(range[1], range[2])
    if (typeof ids === 'string') errors.push(ids)
    else for (const id of ids) readToken(id, requests)
    return
  }
  // Half-written region or range syntax: say how to write it rather than
  // reading its pieces as accessions.
  if (/[:()]|\.\./.test(entry)) {
    errors.push(`"${entry}" can't be read. Write part of a record as NC_000072: 122552252..122565735, or its other strand as NC_000072: COMPLEMENT(122552252..122565735).`)
    return
  }
  if (/-/.test(entry)) {
    errors.push(`"${entry}" can't be read. Write a range of records as AF027958 - AF027961.`)
    return
  }
  for (const token of entry.split(/\s+/).filter(Boolean)) {
    if (ID_RE.test(token)) readToken(token, requests)
    else errors.push(`"${token}" is not an accession.`)
  }
}

function readToken(token: string, requests: AccessionRequest[]) {
  const gene = geneId(token)
  requests.push(gene !== null
    ? { text: token, id: gene, gene: true, complement: false }
    : { text: token, id: token, gene: false, complement: false })
}

/**
 * Positions copied from a genome browser often carry thousands separators
 * ("122,552,252..122,565,735"). They are dropped next to "..", the only
 * place they can be told from the commas between entries.
 */
function dropThousandsSeparators(query: string): string {
  const plain = (s: string) => s.replace(/,/g, '')
  return query
    .replace(/\d{1,3}(?:,\d{3})+(?=\s*\.\.)/g, plain)
    .replace(/(\.\.\s*)(\d{1,3}(?:,\d{3})+)(?!\d)/g, (_, dots: string, n: string) => dots + plain(n))
}

/** Read the box: every record asked for, in order and once each, and what could not be read. */
export function parseAccessionQuery(query: string): ParsedAccessions {
  const requests: AccessionRequest[] = []
  const errors: string[] = []
  for (const raw of dropThousandsSeparators(query).split(/[,;\n]+/)) {
    const entry = raw.trim().replace(/\s+/g, ' ')
    if (entry) readEntry(entry, requests, errors)
  }
  const seen = new Set<string>()
  const unique = requests.filter(r => {
    const key = r.text.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { requests: unique, errors }
}
