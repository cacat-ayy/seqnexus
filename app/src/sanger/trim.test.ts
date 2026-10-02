import { describe, it, expect } from 'vitest'
import type { TraceData } from '../io/trace'
import { reverseComplement } from '../models/complement'
import { DEFAULT_TRIM, errorTrim, findPrimer, planTrim, vectorEnds } from './trim'

/** Deterministic pseudo-random DNA. */
function dna(n: number, seed = 7): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += 'ACGT'[(x >> 16) & 3]
  }
  return s
}

function read(bases: string, quality?: number[]): TraceData {
  return {
    name: 'r', bases,
    peakLocations: [...bases].map((_, i) => 10 + i * 10),
    qualityScores: quality ?? new Array(bases.length).fill(40),
    traces: { A: [], C: [], G: [], T: [] }, metadata: {},
  }
}

describe('error-probability trimming', () => {
  it('keeps the stretch where bases beat the error limit', () => {
    const q = [...new Array(20).fill(8), ...new Array(300).fill(40), ...new Array(30).fill(6)]
    expect(errorTrim(q, 0.05)).toEqual([20, 320])
  })

  it('keeps more as the limit rises', () => {
    const q = [...new Array(10).fill(12), ...new Array(100).fill(40), ...new Array(10).fill(12)]
    const [a1, b1] = errorTrim(q, 0.01)
    const [a2, b2] = errorTrim(q, 0.2)
    expect(b2 - a2).toBeGreaterThan(b1 - a1)
  })

  it('keeps nothing when every base is worse than the limit', () => {
    expect(errorTrim(new Array(50).fill(3), 0.05)).toEqual([0, 0])
  })
})

describe('primer search', () => {
  const primer = 'GGTCAACAAATCATAAAGATATTGG'
  const body = dna(400)

  it('finds a primer with mismatches, and its reverse complement', () => {
    const withMm = primer.slice(0, 5) + 'T' + primer.slice(6)
    expect(findPrimer(body.slice(0, 30) + withMm + body.slice(30), primer, 2)).toMatchObject({ start: 30, end: 55, mismatches: 1, reverse: false })
    expect(findPrimer(body + reverseComplement(primer), primer, 2)).toMatchObject({ start: 400, reverse: true })
  })

  it('rejects a mismatch at the 3\' end', () => {
    const bad3 = primer.slice(0, -1) + 'C'
    expect(findPrimer(body.slice(0, 30) + bad3 + body.slice(30), primer, 2)).toBeNull()
  })

  it('accepts IUPAC codes in the primer', () => {
    expect(findPrimer(body.slice(0, 20) + 'ACGTACGTACGTAAAT' + body.slice(20), 'ACGTRYGTACGTAAAT', 0)).toMatchObject({ start: 20 })
  })
})

describe('vector ends', () => {
  const vector = dna(3000, 99)
  const insert = dna(500, 3)

  it('finds vector read before the insert', () => {
    const r = vector.slice(1200, 1280) + insert
    expect(vectorEnds(r, vector, true).startEnd).toBe(80)
    expect(vectorEnds(r, vector, true).endStart).toBeNull()
  })

  it('finds vector after the insert on the other strand', () => {
    const r = insert + reverseComplement(vector.slice(400, 470))
    // The insert's last bases may match the vector by chance and be counted with it.
    const at = vectorEnds(r, vector, true).endStart!
    expect(at).toBeGreaterThanOrEqual(494)
    expect(at).toBeLessThanOrEqual(500)
  })

  it('tolerates a few sequencing errors in the vector stretch', () => {
    const v = vector.slice(100, 200).split('')
    v[30] = v[30] === 'A' ? 'C' : 'A'
    v[61] = v[61] === 'G' ? 'T' : 'G'
    const r = v.join('') + insert
    expect(vectorEnds(r, vector, false).startEnd).toBe(100)
  })

  it('ignores a read with no vector in it', () => {
    expect(vectorEnds(insert, vector, true)).toEqual({ startEnd: null, endStart: null })
  })
})

describe('trim plan', () => {
  it('cuts after a primer near the start and before one near the end', () => {
    const p1 = 'GGTCAACAAATCATAAAGATATTGG'
    const p2 = 'TAAACTTCAGGGTGACCAAAAAATCA'
    const r = read(dna(20) + p1 + dna(300) + reverseComplement(p2) + dna(20))
    const plan = planTrim(r, [0, r.bases.length], { ...DEFAULT_TRIM, method: 'keep', primers: [{ name: 'F', sequence: p1 }, { name: 'R', sequence: p2 }] })
    expect([plan.start, plan.end]).toEqual([45, 345])
    expect(plan.notes).toHaveLength(2)
  })

  it('applies fixed cuts on top of quality trimming and only ever cuts in', () => {
    const r = read(dna(300), [...new Array(10).fill(5), ...new Array(290).fill(40)])
    const plan = planTrim(r, [0, 300], { ...DEFAULT_TRIM, cutStart: 5, cutEnd: 25 })
    expect([plan.start, plan.end]).toEqual([10, 275])
  })

  it('reports reads left too short', () => {
    const r = read(dna(80))
    const plan = planTrim(r, [0, 80], { ...DEFAULT_TRIM, method: 'keep', minLength: 100 })
    expect(plan.tooShort).toBe(true)
  })

  it('does not quality-trim a file without qualities', () => {
    const r = { ...read(dna(200), new Array(200).fill(0)), metadata: { qualityMissing: true } }
    const plan = planTrim(r, [10, 150], DEFAULT_TRIM)
    expect([plan.start, plan.end]).toEqual([0, 200])
  })
})
