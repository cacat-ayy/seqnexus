/**
 * SnapGene public plasmid repository fetch client.
 *
 * SnapGene hosts plasmid files at snapgene.com. This client attempts to
 * fetch GenBank-format files from their repository.
 *
 * Note: This will likely be blocked by CORS in browser environments.
 * The error message will indicate this clearly and suggest manual download.
 */

const SNAPGENE_BASE = 'https://www.snapgene.com'

/**
 * Fetch a plasmid from SnapGene's public repository.
 * Accepts a plasmid name or a direct URL to a .dna or .gb file.
 * Returns the raw GenBank flat-file text.
 */
export async function fetchSnapGene(input: string): Promise<string> {
  const trimmed = input.trim()

  // If it looks like a full URL, try it directly
  let url: string
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    url = trimmed
  } else {
    // Construct a SnapGene repository URL
    // SnapGene plasmid pages are at /plasmids/{name}
    // The GenBank download is typically at a sub-path
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    url = `${SNAPGENE_BASE}/plasmids/${slug}`
  }

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(
      `Cannot reach SnapGene - this is likely a CORS restriction. ` +
      `Try downloading the file manually from snapgene.com and importing it.`
    )
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Plasmid "${trimmed}" not found on SnapGene.`)
    }
    throw new Error(`SnapGene fetch failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  // SnapGene will almost certainly return HTML due to CORS
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    throw new Error(
      `SnapGene returned an HTML page – direct download is blocked by CORS. ` +
      `Visit snapgene.com to download the file manually, then import it.`
    )
  }

  if (!text.startsWith('LOCUS')) {
    throw new Error(`Unexpected response from SnapGene – does not appear to be a GenBank record.`)
  }

  return text
}
