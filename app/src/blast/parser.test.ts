import { describe, it, expect } from 'vitest'
import { parseBlastJson } from './parser'

/** A JSON2_S response with one hit per HSP given. */
const response = (program: string, hsps: Record<string, unknown>[], queryLen = 1000) => ({
  BlastOutput2: [{
    report: {
      program,
      search_target: { db: 'core_nt' },
      results: {
        search: {
          query_len: queryLen,
          hits: hsps.map((hsp, i) => ({
            description: [{ accession: `ACC${i}`, title: `Hit ${i}`, sciname: 'Escherichia coli' }],
            len: 5000,
            hsps: [{ bit_score: 100, evalue: 1e-20, identity: 90, positive: 90, align_len: 100, qseq: '', hseq: '', midline: '', ...hsp }],
          })),
        },
      },
    },
  }],
})

describe('parseBlastJson strands and coordinates', () => {
  it('reads a blastn minus-strand hit from hit_strand and orders its coordinates', () => {
    const r = parseBlastJson(response('blastn', [
      { query_from: 1, query_to: 60, hit_from: 500, hit_to: 441, query_strand: 'Plus', hit_strand: 'Minus' },
    ]))
    const hsp = r.hits[0].hsps[0]
    expect(hsp.queryStrand).toBe(1)
    expect(hsp.hitStrand).toBe(-1)
    expect([hsp.hitFrom, hsp.hitTo]).toEqual([441, 500])
  })

  it('takes a translated side’s strand from the sign of its frame', () => {
    const r = parseBlastJson(response('blastx', [
      { query_from: 300, query_to: 1, hit_from: 1, hit_to: 100, query_frame: -2, hit_frame: 0 },
    ]))
    const hsp = r.hits[0].hsps[0]
    expect(hsp.queryStrand).toBe(-1)
    expect([hsp.queryFrom, hsp.queryTo]).toEqual([1, 300])
    expect(hsp.hitStrand).toBe(1)
    expect(hsp.queryFrame).toBe(-2)
  })

  it('falls back on coordinates that run backwards when no strand or frame is given', () => {
    const r = parseBlastJson(response('blastn', [{ query_from: 1, query_to: 60, hit_from: 90, hit_to: 31 }]))
    expect(r.hits[0].hsps[0].hitStrand).toBe(-1)
  })

  it('reads both sides of a protein search as forward', () => {
    const r = parseBlastJson(response('blastp', [{ query_from: 5, query_to: 104, hit_from: 1, hit_to: 100 }], 200))
    const hsp = r.hits[0].hsps[0]
    expect([hsp.queryStrand, hsp.hitStrand]).toEqual([1, 1])
    expect(r.hits[0].queryCoverage).toBeCloseTo(0.5)
  })

  it('puts the best HSP first and takes every per-hit number from it', () => {
    const raw = response('blastn', [{}])
    raw.BlastOutput2[0].report.results.search.hits[0].hsps = [
      { bit_score: 50, evalue: 1e-5, identity: 30, align_len: 40, query_from: 900, query_to: 939, hit_from: 1, hit_to: 40 },
      { bit_score: 200, evalue: 1e-5, identity: 99, align_len: 100, query_from: 1, query_to: 100, hit_from: 1, hit_to: 100 },
    ] as never
    const hit = parseBlastJson(raw).hits[0]
    expect(hit.hsps[0].bitScore).toBe(200)
    expect([hit.topScore, hit.topEvalue, hit.topIdentity]).toEqual([200, 1e-5, 0.99])
  })

  it('orders hits by E-value, the higher score first among equal ones', () => {
    const raw = response('blastn', [{ evalue: 0, bit_score: 100 }, { evalue: 0, bit_score: 300 }])
    expect(parseBlastJson(raw).hits.map(h => h.topScore)).toEqual([300, 100])
  })

  it('reports a search with no results as an empty hit list with its message', () => {
    const r = parseBlastJson({ BlastOutput2: [{ report: { program: 'blastn', results: { message: 'No hits found' } } }] })
    expect(r.hits).toEqual([])
    expect(r.message).toBe('No hits found')
  })

  it('rejects a response that is not a BLAST report', () => {
    expect(() => parseBlastJson({ error: 'nope' })).toThrow()
  })
})
