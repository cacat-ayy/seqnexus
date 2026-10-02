import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import type { BaseEdit } from '../store'
import { buildTraceModel, findProblems, forwardColumn, translateShown } from './model'

/** A trace with a clean peak per call, and an optional second peak at some calls. */
function read(bases: string, quality?: number[], second: Record<number, 'A' | 'C' | 'G' | 'T'> = {}): TraceData {
  const spacing = 12
  const len = bases.length * spacing + spacing
  const traces = { A: new Array(len).fill(0), C: new Array(len).fill(0), G: new Array(len).fill(0), T: new Array(len).fill(0) }
  const peaks = [...bases].map((_, i) => spacing + i * spacing)
  const bump = (ch: number[], at: number, h: number) => {
    for (let s = at - 4; s <= at + 4; s++) ch[s] += Math.round(h * Math.exp(-((s - at) ** 2) / 8))
  }
  ;[...bases].forEach((b, i) => { if ('ACGT'.includes(b)) bump(traces[b as 'A'], peaks[i], 1000) })
  for (const [i, b] of Object.entries(second)) bump(traces[b], peaks[Number(i)], 600)
  return {
    name: 'r', bases, peakLocations: peaks,
    qualityScores: quality ?? new Array(bases.length).fill(40),
    traces, metadata: {},
  }
}

describe('trace model', () => {
  it('shows a reversed read complemented, right to left', () => {
    const m = buildTraceModel(read('AACG'), [], 0, 4, true)
    expect(m.shown).toBe('CGTT')
    expect(forwardColumn(m, 0)).toBe(3)
    expect(m.quality[0]).toBe(40)
  })

  it('reports the original call under an edit, in display orientation', () => {
    const edits: BaseEdit[] = [{ type: 'substitute', pos: 0, original: 'A', base: 'G' }]
    const fwd = buildTraceModel(read('AACG'), edits, 0, 4, false)
    expect(fwd.shown).toBe('GACG')
    expect(fwd.original[0]).toBe('A')
    const rev = buildTraceModel(read('AACG'), edits, 0, 4, true)
    expect(rev.shown).toBe('CGTC')
    expect(rev.original[3]).toBe('T')
  })

  it('measures second peaks and names their base', () => {
    const m = buildTraceModel(read('ACGT', undefined, { 1: 'T' }), [], 0, 4, false)
    expect(m.secondRatio[1]).toBeGreaterThan(0.5)
    expect(m.secondBase[1]).toBe('T')
    expect(m.secondRatio[0]).toBeLessThan(0.1)
  })

  it('translates the shown bases, skipping deleted ones', () => {
    const edits: BaseEdit[] = [{ type: 'delete', pos: 1, original: 'C' }]
    const m = buildTraceModel(read('ACTGGGTAA'), edits, 0, 9, false)
    // ATG GGT AA → M G
    const codons = translateShown(m, 0)
    expect(codons.map(c => c.aa).join('')).toBe('MG')
    expect(codons[0]).toEqual({ d0: 0, d1: 4, aa: 'M' })
  })

  it('lists places to check inside the trim, merging neighbours', () => {
    const q = [40, 40, 5, 5, 40, 40, 40, 40, 40, 40]
    const m = buildTraceModel(read('ACGTNCGTAC', q, { 7: 'A' }), [], 1, 10, false)
    const p = findProblems(m, { mixedRatio: 0.33, qualityCutoff: 20 })
    expect(p.map(x => [x.d0, x.d1])).toEqual([[2, 5], [7, 8]])
    expect(p[0].kinds).toEqual(expect.arrayContaining(['low', 'ambiguous']))
    expect(p[1].kinds).toEqual(['mixed'])
  })

  it('evens out peak heights along the read', () => {
    const m = buildTraceModel(read('ACGTACGTAC'), [], 0, 10, false)
    expect(m.envelope.length).toBe(m.n)
    for (const e of m.envelope) expect(e).toBeGreaterThan(0)
  })
})
