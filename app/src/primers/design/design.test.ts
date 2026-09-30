import { describe, it, expect } from 'vitest'
import { designPrimers } from './design'
import { DEFAULT_CONSTRAINTS, type PrimerConstraints } from '../scoring'
import type { DesignRequest } from './types'

/** Deterministic, non-repetitive template (xorshift). */
function template(n: number, seed = 42): string {
  let x = seed
  let s = ''
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    s += 'ACGT'[(x >>> 7) & 3]
  }
  return s
}

const RELAXED: PrimerConstraints = { ...DEFAULT_CONSTRAINTS, minTm: 45, maxTm: 75, optTm: 60, minGC: 30, maxGC: 70 }
const T = template(3000)

const req = (over: Partial<DesignRequest> = {}): DesignRequest => ({
  template: T,
  topology: 'linear',
  target: { start: 1000, end: 1200 },
  minProductSize: 250,
  maxProductSize: 600,
  constraints: RELAXED,
  ...over,
})

describe('designPrimers: pairs', () => {
  it('flanks the target with a forward primer upstream and a reverse downstream', () => {
    const { pairs, error } = designPrimers(req())
    expect(error).toBeUndefined()
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.forward.strand).toBe(1)
      expect(p.reverse.strand).toBe(-1)
      expect(p.forward.end).toBeLessThanOrEqual(1000)
      expect(p.reverse.start).toBeGreaterThanOrEqual(1200)
      expect(p.evaluation.productSize).toBe(p.reverse.end - p.forward.start)
      expect(p.evaluation.productSize).toBeGreaterThanOrEqual(250)
      expect(p.evaluation.productSize).toBeLessThanOrEqual(600)
    }
  })

  it('ranks pairs best first and honours maxPairs', () => {
    const { pairs } = designPrimers(req({ maxPairs: 5 }))
    expect(pairs.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1].penalty).toBeLessThanOrEqual(pairs[i].penalty)
  })

  it('reads the primer sequences off the template', () => {
    const [best] = designPrimers(req()).pairs
    expect(T.slice(best.forward.start, best.forward.end)).toBe(best.forward.sequence)
  })

  it('explains every penalty: the terms add up to it', () => {
    const [best] = designPrimers(req()).pairs
    const sum = best.forward.terms.reduce((s, t) => s + t.penalty, 0)
    expect(sum).toBeCloseTo(best.forward.penalty, 6)
    const pairSum = best.evaluation.terms.reduce((s, t) => s + t.penalty, 0)
    expect(best.evaluation.penalty).toBeCloseTo(best.forward.penalty + best.reverse.penalty + pairSum, 6)
  })
})

describe('designPrimers: the landscape', () => {
  it('keeps one candidate per 3′ end, in position order', () => {
    const { forward, reverse, counts } = designPrimers(req())
    expect(forward.length).toBeGreaterThan(0)
    expect(new Set(forward.map(c => c.linEnd)).size).toBe(forward.length)
    expect(new Set(reverse.map(c => c.linStart)).size).toBe(reverse.length)
    expect(forward.map(c => c.linEnd)).toEqual([...forward.map(c => c.linEnd)].sort((a, b) => a - b))
    expect(counts.forward).toBeGreaterThanOrEqual(forward.length)
  })

  it('reports the window and target it searched', () => {
    const r = designPrimers(req())
    expect(r.target).toEqual({ start: 1000, end: 1200 })
    expect(r.window.start).toBe(1200 - 600)
    expect(r.window.end).toBe(1000 + 600)
  })
})

describe('designPrimers: constraints and errors', () => {
  it('keeps every primer out of an avoided region', () => {
    const avoid = { start: 850, end: 1000 }
    const { forward, pairs } = designPrimers(req({ excluded: [avoid] }))
    for (const c of forward) expect(c.end <= avoid.start || c.start >= avoid.end).toBe(true)
    for (const p of pairs) expect(p.forward.end <= avoid.start || p.forward.start >= avoid.end).toBe(true)
  })

  // The old dialog silently rewrote the product size range instead.
  it('says so when the target cannot fit in the product, instead of changing the settings', () => {
    const r = designPrimers(req({ target: { start: 1000, end: 1800 }, maxProductSize: 600 }))
    expect(r.pairs).toEqual([])
    expect(r.error).toMatch(/longer than the largest product/)
  })

  it('says which side failed when no primer meets the limits', () => {
    const r = designPrimers(req({ constraints: { ...RELAXED, minTm: 90, maxTm: 95, optTm: 92 } }))
    expect(r.error).toMatch(/No forward primer/)
  })

  it('refuses a wrapping target on a linear sequence', () => {
    expect(designPrimers(req({ target: { start: 2900, end: 50 } })).error).toBeDefined()
  })
})

describe('designPrimers: circular templates', () => {
  it('designs across the origin', () => {
    const { pairs, error } = designPrimers(req({
      topology: 'circular',
      target: { start: 2950, end: 40 },
      minProductSize: 150,
      maxProductSize: 500,
    }))
    expect(error).toBeUndefined()
    expect(pairs.length).toBeGreaterThan(0)
    for (const p of pairs) {
      expect(p.evaluation.productSize).toBeGreaterThanOrEqual(150)
      expect(p.evaluation.productSize).toBeLessThanOrEqual(500)
      // Coordinates are template positions, not scan positions.
      expect(p.forward.start).toBeLessThan(3000)
      expect(p.reverse.end).toBeLessThanOrEqual(3000)
    }
  })

  it('handles a target starting at position 0', () => {
    const { pairs } = designPrimers(req({
      topology: 'circular', target: { start: 0, end: 80 }, minProductSize: 150, maxProductSize: 500,
    }))
    expect(pairs.length).toBeGreaterThan(0)
  })
})

describe('designPrimers: probes', () => {
  it('finds a probe between the primers, above their Tm', () => {
    const probe = { ...RELAXED, minLength: 18, maxLength: 30, optLength: 24, minTm: 60, maxTm: 80, optTm: 70 }
    const { pairs } = designPrimers(req({
      target: { start: 1000, end: 1060 }, minProductSize: 70, maxProductSize: 200, probe,
    }))
    const withProbe = pairs.filter(p => p.probe)
    expect(withProbe.length).toBeGreaterThan(0)
    for (const p of withProbe) {
      expect(p.probe!.linStart).toBeGreaterThanOrEqual(p.forward.linEnd)
      expect(p.probe!.linEnd).toBeLessThanOrEqual(p.reverse.linStart)
    }
  })
})
