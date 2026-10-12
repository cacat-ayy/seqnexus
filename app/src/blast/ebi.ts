/**
 * EMBL-EBI's BLAST service (NCBI BLAST+ run by the Job Dispatcher).
 *
 * A REST workflow in three calls: submit (POST /run, answered with a job
 * id), check the job's status (GET /status/{id}) until it is FINISHED, then
 * fetch the result (GET /result/{id}/{type}). EMBL-EBI answers any web page
 * (Access-Control-Allow-Origin: *), so this runs in the browser with no
 * server of ours, from a page opened from disk as well.
 * See: https://www.ebi.ac.uk/jdispatcher/docs/webservices/
 */

import { CONTACT_EMAIL } from '../fetch/contact'
import { evalueParam, maxHitsParam, usesMatrix } from './params'
import { PROTEIN_QUERY_PROGRAMS, SYNTHETIC_CONSTRUCT_TAXID, type BlastParams, type EbiStatus } from './types'

const EBI_URL = 'https://www.ebi.ac.uk/Tools/services/rest/ncbiblast'

/** The Job Dispatcher's page for a job, for opening it on EMBL-EBI's site. */
export function ebiJobUrl(jobId: string): string {
  return `https://www.ebi.ac.uk/jdispatcher/sss/ncbiblast/summary?jobId=${encodeURIComponent(jobId)}`
}

/** The reason in an error answer (`<error><description>…</description></error>`), or null. */
export function ebiErrorMessage(text: string): string | null {
  const m = /<description>([\s\S]*?)<\/description>/.exec(text)
  return m ? m[1].replace(/\s+/g, ' ').trim() : null
}

/**
 * The form a search is submitted with. Optional settings go only when they
 * differ from the service's defaults. EMBL-EBI names the program for what is
 * searched (blastn) and the variant as its task (megablast, blastn).
 */
export function ebiRunForm(params: BlastParams, taxid: string | null): URLSearchParams {
  const { program } = params
  const nucleotideTask = program === 'megablast' || program === 'blastn'
  const form = new URLSearchParams({
    email: CONTACT_EMAIL,
    program: program === 'megablast' ? 'blastn' : program,
    stype: PROTEIN_QUERY_PROGRAMS.includes(program) ? 'protein' : 'dna',
    database: params.database,
    sequence: params.query,
    exp: evalueParam(params.evalue),
    alignments: String(maxHitsParam(params.maxHits)),
    scores: String(maxHitsParam(params.maxHits)),
  })
  if (nucleotideTask) form.set('task', program)
  if (params.matrix && usesMatrix(program)) form.set('matrix', params.matrix)
  if (params.lowComplexity !== 'default') form.set('filter', params.lowComplexity === 'on' ? 'T' : 'F')
  if (taxid) form.set('taxids', taxid)
  if (params.excludeSynthetic) form.set('negative_taxids', String(SYNTHETIC_CONSTRUCT_TAXID))
  return form
}

/** Submit a search; returns the job id. Throws with EMBL-EBI's own reason when it refuses. */
export async function submitEbi(params: BlastParams, taxid: string | null): Promise<string> {
  const res = await fetch(`${EBI_URL}/run`, {
    method: 'POST',
    body: ebiRunForm(params, taxid).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/plain' },
  })
  const text = (await res.text()).trim()
  if (!res.ok || !text || text.startsWith('<')) {
    const reason = ebiErrorMessage(text)
    throw new Error(reason ? `EMBL-EBI refused the search: ${reason}` : `EMBL-EBI refused the search (HTTP ${res.status})`)
  }
  return text
}

const STATUSES: EbiStatus[] = ['QUEUED', 'RUNNING', 'FINISHED', 'ERROR', 'FAILURE', 'NOT_FOUND']

/** A job's status. */
export async function ebiStatus(jobId: string): Promise<EbiStatus> {
  const res = await fetch(`${EBI_URL}/status/${encodeURIComponent(jobId)}`, { headers: { Accept: 'text/plain' } })
  if (!res.ok) throw new Error(`Status check failed: HTTP ${res.status}`)
  const text = (await res.text()).trim() as EbiStatus
  return STATUSES.includes(text) ? text : 'RUNNING'
}

/** One of a finished job's results, as text. */
export async function ebiResult(jobId: string, type: string): Promise<string> {
  const res = await fetch(`${EBI_URL}/result/${encodeURIComponent(jobId)}/${type}`)
  if (!res.ok) throw new Error(`The ${type} result could not be fetched (HTTP ${res.status})`)
  return res.text()
}

/** Why a job failed, in EMBL-EBI's words, when it says. */
export async function ebiJobError(jobId: string): Promise<string | null> {
  try {
    const text = (await ebiResult(jobId, 'error')).trim()
    return text ? (ebiErrorMessage(text) ?? text.split('\n').find(l => l.trim()) ?? null) : null
  } catch {
    return null
  }
}
