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
  /** blastn only: 'Plus' or 'Minus'. The translated programs give a frame instead. */
  query_strand?: string
  hit_strand?: string
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
    const hsps: BlastHsp[] = (h.hsps || []).map((hsp) => ({
      bitScore: hsp.bit_score || 0,
      evalue: hsp.evalue ?? 0,
      identity: hsp.align_len ? (hsp.identity || 0) / hsp.align_len : 0,
      positives: hsp.align_len ? (hsp.positive || 0) / hsp.align_len : 0,
      gaps: hsp.gaps || 0,
      alignLen: hsp.align_len || 0,
      queryFrom: Math.min(hsp.query_from || 0, hsp.query_to || 0),
      queryTo: Math.max(hsp.query_from || 0, hsp.query_to || 0),
      hitFrom: Math.min(hsp.hit_from || 0, hsp.hit_to || 0),
      hitTo: Math.max(hsp.hit_from || 0, hsp.hit_to || 0),
      queryStrand: strandOf(hsp.query_strand, hsp.query_frame, hsp.query_from, hsp.query_to),
      hitStrand: strandOf(hsp.hit_strand, hsp.hit_frame, hsp.hit_from, hsp.hit_to),
      queryFrame: hsp.query_frame || 0,
      hitFrame: hsp.hit_frame || 0,
      qseq: hsp.qseq || '',
      hseq: hsp.hseq || '',
      midline: hsp.midline || '',
    }))
    return makeHit(desc.accession || desc.id || '', desc.title || '', desc.sciname || '', h.len || 0, hsps, queryLen)
  })
  sortHits(hits)

  return {
    program: report.program || '',
    database: report.search_target?.db || '',
    queryLen,
    hits,
    message: search.message,
  }
}

/**
 * A hit from its HSPs, the same way for every service: the best HSP first
 * (the highest bit score, NCBI's Max score, the lower E-value on a tie), and
 * every per-hit number in the table, and the feature a hit becomes, taken
 * from that one HSP so they describe the same alignment; coverage alone
 * counts them all, as NCBI's Query cover does.
 */
export function makeHit(
  accession: string, description: string, sciName: string, length: number, hsps: BlastHsp[], queryLen: number,
): BlastHit {
  hsps.sort((a, b) => b.bitScore - a.bitScore || a.evalue - b.evalue)
  const best = hsps[0]
  return {
    accession,
    description,
    sciName,
    length,
    hsps,
    topScore: best?.bitScore || 0,
    topEvalue: best?.evalue ?? 0,
    topIdentity: best?.identity || 0,
    queryCoverage: queryLen > 0 ? computeQueryCoverage(hsps, queryLen) : 0,
  }
}

/** Hits by E-value, the higher score first among equal ones (megablast gives many hits E = 0). */
export function sortHits(hits: BlastHit[]): void {
  hits.sort((a, b) => a.topEvalue - b.topEvalue || b.topScore - a.topScore)
}

/**
 * The strand one side of an HSP is read on. blastn names it ('Plus' or
 * 'Minus'), the translated programs give a signed frame, and a protein side
 * gives neither. Coordinates that run backwards also mean the minus strand,
 * so a report that only orders them still reads right.
 */
export function strandOf(strand: string | undefined, frame: number | undefined, from = 0, to = 0): 1 | -1 {
  const s = strand?.toLowerCase()
  if (s === 'minus') return -1
  if (s === 'plus') return 1
  if (frame) return frame < 0 ? -1 : 1
  return from > to ? -1 : 1
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
