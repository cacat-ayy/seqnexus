import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import { computeReadQc, contiguousReadLength } from './qc'

function read(quality: number[], over: Partial<TraceData> = {}): TraceData {
  return {
    name: 'r',
    bases: 'A'.repeat(quality.length),
    peakLocations: [],
    qualityScores: quality,
    traces: { A: [], C: [], G: [], T: [] },
    metadata: {},
    ...over,
  }
}

describe('contiguous read length', () => {
  it('spans the stretch where every 20-base window averages Q20', () => {
    const q = [...new Array(30).fill(5), ...new Array(600).fill(40), ...new Array(40).fill(5)]
    const crl = contiguousReadLength(q)
    // Windows straddling the edges still average ≥ 20 for a few bases.
    expect(crl.length).toBeGreaterThanOrEqual(600)
    expect(crl.length).toBeLessThan(625)
    expect(crl.start).toBeGreaterThan(15)
  })

  it('is zero for a read that never reaches Q20', () => {
    expect(contiguousReadLength(new Array(200).fill(12)).length).toBe(0)
  })

  it('takes the longest of several good stretches', () => {
    const q = [...new Array(100).fill(40), ...new Array(60).fill(2), ...new Array(300).fill(40)]
    const crl = contiguousReadLength(q)
    expect(crl.start).toBeGreaterThan(140)
    expect(crl.length).toBeGreaterThanOrEqual(300)
  })
})

describe('read QC', () => {
  it('passes a long high-quality read', () => {
    const qc = computeReadQc(read([...new Array(20).fill(8), ...new Array(800).fill(45), ...new Array(80).fill(10)]))
    expect(qc.verdict).toBe('good')
    expect(qc.qv20).toBe(800)
    expect(qc.traceScore).toBeGreaterThan(40)
    expect(qc.issues).toEqual([])
  })

  it('fails a read with no usable stretch', () => {
    const qc = computeReadQc(read(new Array(500).fill(10)))
    expect(qc.verdict).toBe('fail')
    expect(qc.issues[0]).toMatch(/Contiguous read length 0/)
  })

  it('asks for a look at a short read', () => {
    const qc = computeReadQc(read([...new Array(250).fill(40), ...new Array(300).fill(5)]))
    expect(qc.verdict).toBe('check')
    expect(qc.issues.some(i => i.includes('under 400'))).toBe(true)
  })

  it('reports a file without qualities instead of failing it', () => {
    const qc = computeReadQc(read(new Array(600).fill(0), { metadata: { qualityMissing: true } }))
    expect(qc.verdict).toBe('check')
    expect(qc.traceScore).toBeNull()
    expect(qc.issues).toContain('No quality values in the file')
  })

  it('counts N and IUPAC calls', () => {
    const qc = computeReadQc(read(new Array(6).fill(40), { bases: 'ANRTGY' }))
    expect(qc.ambiguous).toBe(3)
  })
})
