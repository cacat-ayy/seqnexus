/**
 * NCBI EFetch client for retrieving GenBank records by accession.
 *
 * Uses the Entrez E-utilities API. Returns raw GenBank flat-file text.
 * See: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 */

const EFETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi'
const TOOL = 'SeqNexus'
const EMAIL = 'seqnexus@plasmidstudio.app'

/**
 * Fetch a GenBank record from NCBI Nucleotide by accession.
 * Returns the raw GenBank flat-file text.
 */
export async function fetchNCBI(accession: string): Promise<string> {
  const params = new URLSearchParams({
    db: 'nucleotide',
    id: accession.trim(),
    rettype: 'gb',
    retmode: 'text',
    tool: TOOL,
    email: EMAIL,
  })

  const res = await fetch(`${EFETCH_URL}?${params}`)

  if (!res.ok) {
    if (res.status === 400 || res.status === 404) {
      throw new Error(`Accession "${accession}" not found in NCBI Nucleotide.`)
    }
    throw new Error(`NCBI fetch failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  // NCBI returns HTML error pages for invalid accessions even with 200 status
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    throw new Error(`Accession "${accession}" not found in NCBI Nucleotide.`)
  }

  // Verify it looks like GenBank format
  if (!text.startsWith('LOCUS')) {
    throw new Error(`Unexpected response from NCBI – does not appear to be a GenBank record.`)
  }

  return text
}
