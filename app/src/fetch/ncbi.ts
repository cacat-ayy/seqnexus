/**
 * NCBI EFetch client for retrieving GenBank and GenPept records by accession.
 *
 * Uses the Entrez E-utilities API. Returns raw GenBank flat-file text; a
 * protein record (the `protein` database, GenPept format) has an `aa` LOCUS
 * line that the GenBank reader turns into a protein document.
 * See: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */

import { CONTACT_EMAIL, TOOL_NAME } from './contact'

const EFETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
const TOOL = TOOL_NAME
const EMAIL = CONTACT_EMAIL

const ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'

/**
 * The least time between two requests to the E-utilities. NCBI takes at
 * most three a second from an address without an API key, and answers the
 * rest with HTTP 429 and no CORS headers, which a browser reports only as a
 * failed fetch. A range of records asks for a summary and a download each,
 * so without this most of them failed.
 */
const MIN_GAP_MS = 350
let nextSlot = 0

/** fetch(), queued behind earlier E-utilities requests to stay under NCBI's rate limit. */
async function eutils(url: string): Promise<Response> {
  const now = Date.now()
  const wait = Math.max(0, nextSlot - now)
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  return fetch(url)
}

export type NcbiDatabase = 'nucleotide' | 'protein'

const DB_LABEL: Record<NcbiDatabase, string> = { nucleotide: 'NCBI Nucleotide', protein: 'NCBI Protein' }

/**
 * Does this read as a protein accession? RefSeq proteins (NP_, XP_, WP_,
 * YP_, AP_), GenBank proteins (three letters and five or seven digits) and
 * PDB chains (1ABC_A). Everything else is taken for a nucleotide.
 */
export function looksLikeNcbiProtein(text: string): boolean {
  const s = text.trim()
  return /^(NP|XP|WP|YP|AP)_\d+(\.\d+)?$/i.test(s)
    || /^[A-Z]{3}\d{5}(\d{2})?(\.\d+)?$/i.test(s)
    || /^[0-9][A-Z0-9]{3}_[A-Z0-9]{1,4}$/i.test(s)
}

/**
 * A record's length and title from NCBI's summary, without downloading it:
 * typing a chromosome accession would otherwise pull hundreds of megabytes.
 * Null when the summary can't be had (the fetch itself then decides), and
 * throws when NCBI says the accession does not exist.
 */
export async function ncbiRecordSummary(accession: string, db: NcbiDatabase = 'nucleotide'): Promise<{ length: number; title: string } | null> {
  const params = new URLSearchParams({ db, id: accession.trim(), retmode: 'json', tool: TOOL, email: EMAIL })
  let data: { error?: string; result?: Record<string, unknown> & { uids?: string[] } }
  try {
    const res = await eutils(`${ESUMMARY_URL}?${params}`)
    if (!res.ok) return null
    data = await res.json()
  } catch {
    return null
  }
  const uid = data.result?.uids?.[0]
  if (!uid) {
    if (data.error) throw new Error(`Accession "${accession}" not found in ${DB_LABEL[db]}.`)
    return null
  }
  const rec = data.result?.[uid] as { slen?: number; title?: string } | undefined
  return typeof rec?.slen === 'number' ? { length: rec.slen, title: rec.title ?? '' } : null
}

/**
 * Part of a record, or its other strand. NCBI cuts the record itself
 * (EFetch's seq_start, seq_stop and strand), so only that part is
 * downloaded, with its features moved to match.
 */
export interface NcbiPart {
  /** 1-based, inclusive, start <= end. Both or neither. */
  start?: number
  end?: number
  /** The reverse complement. */
  complement?: boolean
}

/**
 * Fetch a GenBank (or, from the protein database, GenPept) record from NCBI
 * by accession, whole or in part. Returns the raw flat-file text.
 */
export async function fetchNCBI(accession: string, db: NcbiDatabase = 'nucleotide', part: NcbiPart = {}): Promise<string> {
  const params = new URLSearchParams({
    db,
    id: accession.trim(),
    rettype: db === 'protein' ? 'gp' : 'gb',
    retmode: 'text',
    tool: TOOL,
    email: EMAIL,
  })
  if (part.start !== undefined && part.end !== undefined) {
    params.set('seq_start', String(part.start))
    params.set('seq_stop', String(part.end))
  }
  if (part.complement) params.set('strand', '2')

  const res = await eutils(`${EFETCH_URL}?${params}`)

  if (!res.ok) {
    // A region that starts past the record's end is refused with a 400
    // (a region that only ends past it is cut short instead).
    if (res.status === 400 && part.start !== undefined) {
      // NCBI spells that message out letter by letter ("o+u+t+s+i+d+e").
      const body = await res.text().catch(() => '')
      if (/outside/i.test(body.replace(/[^a-z]/gi, ''))) {
        throw new Error(`${accession} has no base ${part.start.toLocaleString('en-US')}: the region starts past the record's end.`)
      }
    }
    if (res.status === 400 || res.status === 404) {
      throw new Error(`Accession "${accession}" not found in ${DB_LABEL[db]}.`)
    }
    throw new Error(`NCBI fetch failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  // NCBI returns HTML error pages for invalid accessions even with 200 status
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    throw new Error(`Accession "${accession}" not found in ${DB_LABEL[db]}.`)
  }

  // Verify it looks like GenBank format
  if (!text.startsWith('LOCUS')) {
    throw new Error(`Unexpected response from NCBI: does not appear to be a GenBank record.`)
  }

  return text
}

const ESEARCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi'

/**
 * The NCBI Taxonomy id of an organism named in words ("Escherichia coli"),
 * for services that limit a search by taxid only. A scientific name is tried
 * first, then any name NCBI knows the taxon by. Throws when there is none.
 */
export async function ncbiTaxid(name: string): Promise<string> {
  const term = name.trim().replace(/"/g, '')
  for (const field of ['[Scientific Name]', '']) {
    const params = new URLSearchParams({ db: 'taxonomy', term: `${term}${field}`, retmode: 'json', tool: TOOL, email: EMAIL })
    const res = await eutils(`${ESEARCH_URL}?${params}`)
    if (!res.ok) throw new Error(`NCBI Taxonomy could not be reached (HTTP ${res.status})`)
    const data = await res.json() as { esearchresult?: { idlist?: string[] } }
    const id = data.esearchresult?.idlist?.[0]
    if (id) return id
  }
  throw new Error(`NCBI Taxonomy knows no organism named "${term}". Try its scientific name or its taxid.`)
}

/** Where an NCBI Gene record lies on its chromosome, from the gene's summary. */
export interface NcbiGene {
  id: string
  /** The gene symbol, such as BRCA1 or LOC104244181. */
  symbol: string
  description: string
  organism: string
  /** The chromosome or scaffold, with its version. */
  accession: string
  /** 1-based, inclusive. */
  start: number
  end: number
  /** The gene lies on the minus strand. */
  complement: boolean
}

/**
 * Look up an NCBI Gene ID: its symbol and where it lies on the current
 * annotation of its genome. A gene ID merged into another is followed once.
 * Throws, in words a user can act on, when there is no such gene or it has
 * no place on a genome.
 */
export async function ncbiGene(id: string, followed = false): Promise<NcbiGene> {
  const params = new URLSearchParams({ db: 'gene', id, retmode: 'json', tool: TOOL, email: EMAIL })
  const res = await eutils(`${ESUMMARY_URL}?${params}`)
  if (!res.ok) throw new Error(`NCBI Gene could not be reached (HTTP ${res.status})`)
  const data = await res.json() as { result?: Record<string, unknown> & { uids?: string[] } }
  const uid = data.result?.uids?.[0]
  const rec = (uid ? data.result?.[uid] : undefined) as {
    error?: string
    name?: string
    description?: string
    currentid?: string | number
    organism?: { scientificname?: string }
    genomicinfo?: { chraccver?: string; chrstart?: number; chrstop?: number }[]
  } | undefined
  if (!rec || rec.error) throw new Error(`NCBI Gene has no gene ${id}.`)
  const place = rec.genomicinfo?.find(g => g.chraccver && typeof g.chrstart === 'number' && typeof g.chrstop === 'number')
  if (!place) {
    const current = String(rec.currentid ?? '')
    if (!followed && current && current !== '0' && current !== id) return ncbiGene(current, true)
    throw new Error(`Gene ${id}${rec.name ? ` (${rec.name})` : ''} has no place on a genome at NCBI, so there is no region to fetch.`)
  }
  // 0-based; a gene on the minus strand is given from its 5' end, so start > stop.
  const a = place.chrstart!
  const b = place.chrstop!
  return {
    id: uid!,
    symbol: rec.name || `Gene ${id}`,
    description: rec.description ?? '',
    organism: rec.organism?.scientificname ?? '',
    accession: place.chraccver!,
    start: Math.min(a, b) + 1,
    end: Math.max(a, b) + 1,
    complement: a > b,
  }
}
