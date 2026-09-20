/**
 * NCBI BLAST REST API client.
 *
 * Two-phase async workflow:
 * 1. Submit search (PUT) → get RID
 * 2. Poll status (GET) every 15s until READY, then fetch JSON results
 *
 * All requests use URL-encoded form bodies to avoid CORS preflight.
 * See: https://blast.ncbi.nlm.nih.gov/doc/blast-help/urlapi.html
 */

import type { BlastParams, BlastSubmitResult, BlastStatus } from './types'

const BLAST_URL = 'https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi'
const TOOL = 'SeqNexus'
const EMAIL = 'seqnexus@plasmidstudio.app'

/**
 * Submit a BLAST search. Returns the RID and estimated time to completion.
 */
export async function submitBlast(params: BlastParams): Promise<BlastSubmitResult> {
  const body = new URLSearchParams({
    CMD: 'Put',
    QUERY: params.query,
    DATABASE: params.database,
    PROGRAM: params.program === 'megablast' ? 'blastn' : params.program,
    EXPECT: String(params.evalue),
    HITLIST_SIZE: String(params.maxHits),
    FORMAT_TYPE: 'JSON2_S',
    TOOL: TOOL,
    EMAIL: EMAIL,
  })

  if (params.program === 'megablast') {
    body.set('MEGABLAST', 'on')
  }

  const res = await fetch(BLAST_URL, {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  if (!res.ok) {
    throw new Error(`BLAST submission failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  // Parse RID from response (HTML with embedded QBlastInfo)
  const ridMatch = text.match(/RID\s*=\s*(\S+)/)
  const rtoeMatch = text.match(/RTOE\s*=\s*(\d+)/)

  if (!ridMatch) {
    // Check for error message
    const errMatch = text.match(/<p class="error">(.*?)<\/p>/s)
      || text.match(/Message\s*=\s*(.+)/i)
    throw new Error(errMatch ? errMatch[1].trim() : 'Failed to get BLAST RID from response')
  }

  return {
    rid: ridMatch[1],
    rtoe: rtoeMatch ? parseInt(rtoeMatch[1], 10) : 30,
  }
}

/**
 * Check the status of a BLAST search.
 */
export async function pollBlast(rid: string): Promise<BlastStatus> {
  const url = `${BLAST_URL}?CMD=Get&FORMAT_OBJECT=SearchInfo&RID=${encodeURIComponent(rid)}&TOOL=${TOOL}&EMAIL=${EMAIL}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`BLAST poll failed: HTTP ${res.status}`)
  }

  const text = await res.text()

  if (text.includes('Status=WAITING')) return 'WAITING'
  if (text.includes('Status=FAILED')) return 'FAILED'
  if (text.includes('Status=READY')) return 'READY'
  if (text.includes('Status=UNKNOWN')) return 'UNKNOWN'

  // If ThereAreHits=yes is present, it's ready
  if (text.includes('ThereAreHits=yes')) return 'READY'

  return 'WAITING'
}

/**
 * Fetch BLAST results as JSON2_S format.
 */
export async function fetchResults(rid: string): Promise<unknown> {
  const url = `${BLAST_URL}?CMD=Get&FORMAT_TYPE=JSON2_S&RID=${encodeURIComponent(rid)}&TOOL=${TOOL}&EMAIL=${EMAIL}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`BLAST results fetch failed: HTTP ${res.status}`)
  }

  const json = await res.json()
  return json
}
