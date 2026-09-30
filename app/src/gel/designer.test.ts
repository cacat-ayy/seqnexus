import { describe, it, expect } from 'vitest'
import { designDigests, patternDistance, DEFAULT_DESIGN_OPTIONS } from './designer'
import { DEFAULT_CONDITIONS } from './model'
import { reverseComplement } from '../models/complement'
import type { SequenceSource } from './simulate'

/** Deterministic random DNA, so enzyme sites land the same way every run. */
function randomDna(n: number, seed: number): string {
  let s = seed
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  return Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('')
}

const src = (name: string, bases: string, topology: 'linear' | 'circular' = 'circular'): SequenceSource =>
  ({ name, bases, topology })

// A 3 kb vector with a cloning site, and a 1.2 kb insert with an off-centre
// feature, so orientation changes where things cut.
const vector = randomDna(3000, 1)
const insert = randomDna(1200, 2)
const at = 1500
const clone = vector.slice(0, at) + insert + vector.slice(at)
const reversed = vector.slice(0, at) + reverseComplement(insert) + vector.slice(at)

describe('patternDistance', () => {
  it('is the largest gap to the nearest band, both ways', () => {
    expect(patternDistance([10, 20], [10, 20], 60)).toBe(0)
    expect(patternDistance([10, 20], [10, 25], 60)).toBe(5)
    expect(patternDistance([10], [10, 30], 60)).toBe(20)
    expect(patternDistance([], [10], 60)).toBe(60)
  })
})

describe('designDigests', () => {
  it('returns nothing without candidates', () => {
    expect(designDigests([], DEFAULT_CONDITIONS)).toEqual([])
  })

  it('tells a clone from its empty vector', () => {
    const designs = designDigests([
      { id: 'clone', source: src('clone', clone) },
      { id: 'vector', source: src('vector', vector) },
    ], DEFAULT_CONDITIONS)
    expect(designs.length).toBeGreaterThan(0)
    const best = designs[0]
    expect(best.separationMm).toBeGreaterThanOrEqual(1)
    expect(best.patterns.map(p => p.id)).toEqual(['clone', 'vector'])
    // The patterns account for each whole molecule.
    expect(best.patterns[0].fragments.reduce((a, b) => a + b, 0)).toBe(clone.length)
    expect(best.patterns[1].fragments.reduce((a, b) => a + b, 0)).toBe(vector.length)
  })

  it('tells the two orientations of an insert apart', () => {
    const designs = designDigests([
      { id: 'fwd', source: src('fwd', clone) },
      { id: 'rev', source: src('rev', reversed) },
    ], DEFAULT_CONDITIONS)
    expect(designs.length).toBeGreaterThan(0)
    expect(designs[0].separationMm).toBeGreaterThanOrEqual(1)
    // Same length, so something must cut asymmetrically inside the insert.
    expect(designs[0].patterns[0].bands).not.toEqual(designs[0].patterns[1].bands)
  })

  it('ranks by score, best first, and respects the limit', () => {
    const designs = designDigests([{ id: 'c', source: src('c', clone) }], DEFAULT_CONDITIONS, { ...DEFAULT_DESIGN_OPTIONS, limit: 5 })
    expect(designs.length).toBeLessThanOrEqual(5)
    for (let i = 1; i < designs.length; i++) expect(designs[i].score).toBeLessThanOrEqual(designs[i - 1].score)
    // One candidate: a clean confirmatory digest with a few readable bands.
    expect(designs[0].patterns[0].bands.length).toBeGreaterThanOrEqual(1)
    expect(designs[0].separationMm).toBe(Infinity)
  })

  it('only uses single enzymes when pairs are off', () => {
    const designs = designDigests([{ id: 'c', source: src('c', clone) }], DEFAULT_CONDITIONS, { ...DEFAULT_DESIGN_OPTIONS, pairs: false })
    expect(designs.every(d => d.enzymes.length === 1)).toBe(true)
  })

  it('never proposes a digest that leaves a circular candidate uncut', () => {
    const designs = designDigests([
      { id: 'clone', source: src('clone', clone) },
      { id: 'vector', source: src('vector', vector) },
    ], DEFAULT_CONDITIONS)
    for (const d of designs) {
      for (const p of d.patterns) expect(p.cutCount).toBeGreaterThan(0)
    }
  })

  it('collapses isoschizomers into one result', () => {
    const designs = designDigests([{ id: 'c', source: src('c', clone) }], DEFAULT_CONDITIONS, { ...DEFAULT_DESIGN_OPTIONS, limit: 200 })
    const keys = designs.map(d => d.patterns.map(p => p.fragments.join(',')).join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('searches every 6-cutter pair across three candidates quickly', () => {
    const t0 = performance.now()
    designDigests([
      { id: 'a', source: src('a', clone) },
      { id: 'b', source: src('b', reversed) },
      { id: 'c', source: src('c', vector) },
    ], DEFAULT_CONDITIONS)
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
