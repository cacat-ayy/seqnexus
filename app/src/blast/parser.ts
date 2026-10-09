/**
 * Parse NCBI BLAST JSON2_S response into normalized BlastResult.
 *
 * JSON2_S structure (simplified):
 * {
 *   BlastOutput2: [{
 *     report: {
 *       program, params, results: {
 *         search: {
 *           query_id, query_title, query_len, stat, message,
 *           hits: [{
 *             num, description: [{ id, accession, title, sciname, taxid }],
 *             len,
 *             hsps: [{
 *               num, bit_score, score, evalue,
 *               identity, positive, gaps, align_len,
 *               query_from, query_to, hit_from, hit_to,
 *               query_frame, hit_frame,
 *               qseq, hseq, midline
 *             }]
 *           }]
 *         }
 *       }
 *     }
 *   }]
 * }
 */

import type { BlastResult, BlastHit, BlastHsp } from './types'

/** The parts of NCBI's JSON2_S response that are read. Every field is optional: the parser tolerates a missing one. */
interface RawHsp {
  bit_score?: number
  evalue?: number
  identity?: number
  positive?: number
  gaps?: number
  align_len?: number
  query_from?: number
  query_to?: number
  hit_from?: number
  hit_to?: number
  query_frame?: number
  hit_frame?: number
  qseq?: string
  hseq?: string
  midline?: string
}

interface RawHit {
  description?: { id?: string; accession?: string; title?: string; sciname?: string }[]
  len?: number
  hsps?: RawHsp[]
}

interface RawReport {
  program?: string
  search_target?: { db?: string }
  error?: { message?: string }
  results?: {
    message?: string
    search?: { query_len?: number; hits?: RawHit[]; message?: string }
  }
}

interface RawResponse {
  BlastOutput2?: { report?: RawReport }[]
}

export function parseBlastJson(raw: unknown): BlastResult {
  // Navigate to the search results
  const output = (raw as RawResponse | null | undefined)?.BlastOutput2
  if (!output || !Array.isArray(output) || output.length === 0) {
    throw new Error('Invalid BLAST response: missing BlastOutput2')
  }

  const report = output[0]?.report
  if (!report) {
    throw new Error('Invalid BLAST response: missing report')
  }

  const search = report.results?.search
  if (!search) {
    // May have an error message
    const errMsg = report.results?.message || report.error?.message
    return {
      program: report.program || '',
      database: report.search_target?.db || '',
      queryLen: 0,
      hits: [],
      message: errMsg || 'No search results found',
    }
  }

  const queryLen = search.query_len || 0
  const rawHits: RawHit[] = search.hits || []

  const hits: BlastHit[] = rawHits.map((h) => {
    const desc = h.description?.[0] || {}
    const accession = desc.accession || desc.id || ''
    const description = desc.title || ''
    const sciName = desc.sciname || ''
    const length = h.len || 0

    const hsps: BlastHsp[] = (h.hsps || []).map((hsp) => ({
      bitScore: hsp.bit_score || 0,
      evalue: hsp.evalue ?? 0,
      identity: hsp.align_len ? (hsp.identity || 0) / hsp.align_len : 0,
      positives: hsp.align_len ? (hsp.positive || 0) / hsp.align_len : 0,
      gaps: hsp.gaps || 0,
      alignLen: hsp.align_len || 0,
      queryFrom: hsp.query_from || 0,
      queryTo: hsp.query_to || 0,
      hitFrom: hsp.hit_from || 0,
      hitTo: hsp.hit_to || 0,
      queryFrame: hsp.query_frame || 0,
      hitFrame: hsp.hit_frame || 0,
      qseq: hsp.qseq || '',
      hseq: hsp.hseq || '',
      midline: hsp.midline || '',
    }))

    // Best HSP for table display
    const bestHsp = hsps.reduce((a, b) => (a.evalue <= b.evalue ? a : b), hsps[0])

    // Query coverage: union of all HSP ranges / query length
    const coverage = queryLen > 0 ? computeQueryCoverage(hsps, queryLen) : 0

    return {
      accession,
      description,
      sciName,
      length,
      hsps,
      topScore: bestHsp?.bitScore || 0,
      topEvalue: bestHsp?.evalue ?? 0,
      topIdentity: bestHsp?.identity || 0,
      queryCoverage: coverage,
    }
  })

  // Sort by E-value ascending
  hits.sort((a, b) => a.topEvalue - b.topEvalue)

  return {
    program: report.program || '',
    database: report.search_target?.db || '',
    queryLen,
    hits,
    message: search.message,
  }
}

/** Compute query coverage as fraction of query covered by HSP ranges. */
function computeQueryCoverage(hsps: BlastHsp[], queryLen: number): number {
  // Merge overlapping ranges
  const ranges = hsps
    .map(h => [Math.min(h.queryFrom, h.queryTo), Math.max(h.queryFrom, h.queryTo)] as [number, number])
    .sort((a, b) => a[0] - b[0])

  const merged: [number, number][] = []
  for (const [s, e] of ranges) {
    if (merged.length > 0 && s <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e)
    } else {
      merged.push([s, e])
    }
  }

  const covered = merged.reduce((sum, [s, e]) => sum + (e - s + 1), 0)
  return Math.min(1, covered / queryLen)
}
