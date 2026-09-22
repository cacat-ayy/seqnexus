/**
 * Addgene plasmid fetch client.
 *
 * Fetches the full GenBank sequence for an Addgene plasmid by numeric ID.
 * Addgene provides GenBank downloads at a public endpoint.
 *
 * Note: This may be blocked by CORS in browser environments. The error
 * message will indicate this clearly.
 */

const ADDGENE_BASE = 'https://www.addgene.org'

/**
 * Fetch a GenBank record from Addgene by plasmid ID.
 * Accepts numeric IDs like "12345" or "#12345".
 * Returns the raw GenBank flat-file text.
 */
export async function fetchAddgene(input: string): Promise<string> {
  // Strip leading # and whitespace
  const id = input.replace(/^#/, '').trim()

  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid Addgene ID: "${input}". Expected a numeric plasmid ID (e.g. 12345).`)
  }

  // Addgene full-sequence GenBank endpoint
  const url = `${ADDGENE_BASE}/browse/sequence/${id}/`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    // Network error - likely CORS
    throw new Error(
      `Cannot reach Addgene - this is likely a CORS restriction. ` +
      `Try downloading the GenBank file manually from addgene.org/${id} and importing it.`
    )
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Addgene plasmid #${id} not found.`)
    }
    throw new Error(`Addgene fetch failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  // Addgene may return HTML instead of GenBank if the endpoint changed
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    // Try to extract a useful error
    throw new Error(
      `Addgene returned an HTML page instead of GenBank data. ` +
      `The sequence may not be available, or the endpoint may have changed. ` +
      `Try downloading manually from addgene.org/${id}.`
    )
  }

  if (!text.startsWith('LOCUS')) {
    throw new Error(`Unexpected response from Addgene - does not appear to be a GenBank record.`)
  }

  return text
}
