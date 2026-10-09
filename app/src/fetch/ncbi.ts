/**
 * NCBI EFetch client for retrieving GenBank and GenPept records by accession.
 *
 * Uses the Entrez E-utilities API. Returns raw GenBank flat-file text; a
 * protein record (the `protein` database, GenPept format) has an `aa` LOCUS
 * line that the GenBank reader turns into a protein document.
 * See: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */

const EFETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
const TOOL = 'SeqNexus'
const EMAIL = 'seqnexus@plasmidstudio.app'

const ESUMMARY_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi'

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
    const res = await fetch(`${ESUMMARY_URL}?${params}`)
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
 * Fetch a GenBank (or, from the protein database, GenPept) record from NCBI
 * by accession. Returns the raw flat-file text.
 */
export async function fetchNCBI(accession: string, db: NcbiDatabase = 'nucleotide'): Promise<string> {
  const params = new URLSearchParams({
    db,
    id: accession.trim(),
    rettype: db === 'protein' ? 'gp' : 'gb',
    retmode: 'text',
    tool: TOOL,
    email: EMAIL,
  })

  const res = await fetch(`${EFETCH_URL}?${params}`)

  if (!res.ok) {
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
